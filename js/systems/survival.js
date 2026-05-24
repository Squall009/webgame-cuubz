/**
 * Cuubz — Survival System
 * Health, hunger, thirst, sleep, stamina meters.
 * Depletion over time, restoration via food/water/beds.
 * Death handling with respawn at spawn point.
 */

// Damage source constants
const DAMAGE_SOURCES = {
  NONE: 'none',
  LAVA: 'lava',
  POISON: 'poison',
  FALL: 'fall',
  BOSS: 'boss',
  HUNGER: 'hunger',    // Starvation damage when hunger reaches 0
  THIRST: 'thirst',     // Dehydration damage when thirst reaches 0
};

// Default meter configurations
const DEFAULT_METERS = {
  health:   { max: 100, depletionRate: 0 },       // No natural depletion — only damage
  hunger:   { max: 100, depletionRate: 1.5 },      // ~67 seconds to deplete from full
  thirst:   { max: 100, depletionRate: 2.0 },      // ~50 seconds to deplete from full
  sleep:    { max: 100, depletionRate: 0.8 },      // ~125 seconds to deplete from full
  stamina:  { max: 100, depletionRate: 0 },        // No natural depletion — only actions
};

// Action costs (stamina)
const STAMINA_COSTS = {
  SPRINT: 20.0,   // Per second while sprinting
  JUMP:   8.0,    // Per jump action
  BREAK:  5.0,    // Per block break
  PLACE:  3.0,    // Per block place
};

// Stamina regeneration
const STAMINA_REGEN = {
  rate: 15.0,             // Per second when resting
  delay: 0.5,             // Seconds after last action before regen starts
};

// Restoration amounts (legacy — kept for backward compat)
const RESTORATION = {
  apple:   { hunger: 25 },
  water:   { thirst: 30 },
  bed_use: { sleep: 60, health: 20 },  // Bed restores sleep + some health
};

// ─── Food Item Registry ──────────────────────────────────────────────────────
// Each food item defines what it restores when consumed.
// hunger   — restores hunger meter (0-100)
// thirst   — restores thirst meter (0-100)  (optional)
// health   — restores health meter (0-100)  (optional, for premium foods)
// saturation — how "filling" the food is; affects how fast hunger depletes after eating
//             higher saturation = slower depletion. Applied as a temporary multiplier
//             on the hunger depletion rate (lower = better). Range: 0.1 (very filling) to 2.0 (barely filling).
// eatTime  — seconds required to finish eating (animation delay, prevents instant spam)
// blockDrop — the BLOCK_TYPES enum value this food comes from when mined/broken

const FOOD_ITEMS = {
  apple: {
    hunger: 25,
    thirst: 0,
    health: 0,
    saturation: 0.8,   // Moderately filling
    eatTime: 0.5,       // Fast to eat — it's a small fruit
    blockDrop: 24,      // BLOCK_TYPES.APPLE
  },
  cooked_meat: {
    hunger: 40,
    thirst: -5,         // Meat doesn't quench thirst (slightly dehydrating)
    health: 5,
    saturation: 0.5,    // Very filling
    eatTime: 1.0,
    blockDrop: null,    // Crafted item, not a world block drop
  },
  berry: {
    hunger: 10,
    thirst: 5,
    health: 0,
    saturation: 1.2,    // Light snack — barely filling
    eatTime: 0.3,       // Very fast to eat
    blockDrop: null,    // Would be a separate item ID in full implementation
  },
  bread: {
    hunger: 30,
    thirst: 0,
    health: 0,
    saturation: 0.7,    // Fairly filling
    eatTime: 0.8,
    blockDrop: null,    // Crafted item
  },
  golden_apple: {
    hunger: 35,
    thirst: 10,
    health: 20,         // Premium food restores health too
    saturation: 0.4,    // Extremely filling
    eatTime: 1.0,
    blockDrop: null,    // Rare crafted item
  },
};

// Eating cooldown constants
const EATING = {
  defaultCooldown: 0.5,   // Seconds between bites (minimum)
  saturationDuration: 30, // How long saturation bonus lasts after eating (seconds)
};

// Drinking constants
const DRINKING = {
  drinkTime: 0.8,          // Seconds to complete drinking animation
  cooldown: 1.0,           // Seconds between drinks (minimum)
  thirstRestoration: 35,   // Thirst restored per drink from natural water source
};

class SurvivalSystem {
  constructor(options = {}) {
    // Meter configurations (override defaults)
    this.config = { ...DEFAULT_METERS };
    Object.keys(options.config || {}).forEach(key => {
      if (this.config[key]) {
        this.config[key] = { ...this.config[key], ...(options.config[key] || {}) };
      }
    });

    // Current meter values
    this.meters = {
      health:  this.config.health.max,
      hunger:  this.config.hunger.max,
      thirst:  this.config.thirst.max,
      sleep:   this.config.sleep.max,
      stamina: this.config.stamina.max,
    };

    // State tracking
    this.isDead = false;
    this.lastDamageSource = DAMAGE_SOURCES.NONE;
    this.lastStaminaActionTime = 0;  // Timestamp of last stamina-consuming action
    this.fallStartY = null;          // Y position when fall started (for fall damage calc)

    // Callbacks (set by game loop)
    this.onDeath = options.onDeath || null;
    this.onDamage = options.onDamage || null;
    this.onRespawn = options.onRespawn || null;

    // Spawn point for respawn
    this.spawnPoint = { x: 0, y: 20, z: 0 };

    // Desert biome multiplier (faster thirst depletion)
    this.thirstMultiplier = 1.0;

    // Tundra biome modifier (slower stamina regen on slippery ground)
    this.staminaRegenMultiplier = 1.0;

    // ─── Food System State ──────────────────────────────────────────────────
    this.isEating = false;           // Currently in the middle of eating animation
    this.eatingProgress = 0;         // Progress through current eatTime (0 to food.eatTime)
    this.currentFoodItem = null;     // Which food is being eaten right now
    this.lastEatTime = 0;            // Timestamp when last eating action finished (cooldown)
    this.saturationTimer = 0;        // Remaining time with active saturation bonus
    this.activeSaturation = 1.0;     // Current hunger depletion multiplier from saturation (1.0 = no bonus)

    // ─── Drinking System State ──────────────────────────────────────────────
    this.isDrinking = false;         // Currently in the middle of drinking animation
    this.drinkingProgress = 0;       // Progress through DRINKING.drinkTime (0 to drinkTime)
    this.lastDrinkTime = 0;          // Timestamp when last drinking action finished (cooldown)
    this.isNearWaterSource = false;  // Whether player is standing in/near a water block
  }

  /**
   * Update all survival meters over time delta (seconds).
   * Called each frame by the game loop.
   */
  update(deltaTime, context = {}) {
    if (this.isDead) return;

    const { isSprinting, isJumping, isMoving, biome, currentTime } = context;
    const now = currentTime || Date.now() / 1000;

    // ─── Food System: Update eating progress ──────────────────────────────
    if (this.isEating && this.currentFoodItem) {
      this.eatingProgress += deltaTime;

      if (this.eatingProgress >= this.currentFoodItem.eatTime) {
        // Eating complete — apply restoration
        this._finishEating(this.currentFoodItem);
        this.isEating = false;
        this.eatingProgress = 0;
        this.lastEatTime = now;
        this.currentFoodItem = null;
      }
    }

    // ─── Drinking System: Update drinking progress ────────────────────────
    if (this.isDrinking) {
      this.drinkingProgress += deltaTime;

      if (this.drinkingProgress >= DRINKING.drinkTime) {
        // Drinking complete — apply thirst restoration
        this._finishDrinking();
        this.isDrinking = false;
        this.drinkingProgress = 0;
        this.lastDrinkTime = now;
      }
    }

    // ─── Food System: Update saturation timer ─────────────────────────────
    if (this.saturationTimer > 0) {
      this.saturationTimer -= deltaTime;
      if (this.saturationTimer <= 0) {
        this.saturationTimer = 0;
        this.activeSaturation = 1.0; // Reset to normal depletion rate
      }
    }

    // ─── Deplete meters over time ─────────────────────────────────────────
    this._depleteMeter('hunger', deltaTime);
    this._depleteMeter('thirst', deltaTime);
    this._depleteMeter('sleep', deltaTime);

    // ─── Stamina: consume on actions ──────────────────────────────────────
    if (isSprinting && isMoving) {
      this._consumeStamina(STAMINA_COSTS.SPRINT * deltaTime);
      this._markStaminaAction();
    }
    if (isJumping) {
      this._markStaminaAction();
    }

    // ─── Stamina: regenerate when resting ─────────────────────────────────
    const timeSinceAction = currentTime ? (currentTime - this.lastStaminaActionTime) : Infinity;
    if (!isSprinting && !isJumping && timeSinceAction > STAMINA_REGEN.delay) {
      const regenRate = STAMINA_REGEN.rate * this.staminaRegenMultiplier;
      this.meters.stamina = Math.min(this.config.stamina.max, this.meters.stamina + regenRate * deltaTime);
    }

    // ─── Starvation/Dehydration damage ────────────────────────────────────
    if (this.meters.hunger <= 0) {
      this.meters.hunger = 0;
      this.takeDamage(2.0 * deltaTime, DAMAGE_SOURCES.HUNGER);
    }
    if (this.meters.thirst <= 0) {
      this.meters.thirst = 0;
      this.takeDamage(3.0 * deltaTime, DAMAGE_SOURCES.THIRST);
    }

    // ─── Low sleep penalty: slower stamina regen ──────────────────────────
    if (this.meters.sleep < 20) {
      this.staminaRegenMultiplier = Math.max(0.2, this.meters.sleep / 100);
    } else {
      this.staminaRegenMultiplier = 1.0;
    }

    // ─── Low hunger penalty: slower health regen (if any) ─────────────────
    if (this.meters.hunger < 30) {
      // At very low hunger, health doesn't regenerate naturally
    }
  }

  /**
   * Deplete a single meter over time delta
   */
  _depleteMeter(meterName, deltaTime) {
    const rate = this.config[meterName].depletionRate;
    if (rate <= 0) return;

    let effectiveRate = rate;
    if (meterName === 'thirst') {
      effectiveRate *= this.thirstMultiplier;
    }
    if (meterName === 'hunger' && this.saturationTimer > 0) {
      // Saturation bonus: multiply depletion rate by activeSaturation (lower = slower depletion)
      effectiveRate *= this.activeSaturation;
    }

    this.meters[meterName] -= effectiveRate * deltaTime;
    this.meters[meterName] = Math.max(0, this.meters[meterName]);
  }

  /**
   * Consume stamina for an action. Returns true if action was successful (had enough stamina).
   */
  _consumeStamina(amount) {
    if (this.meters.stamina >= amount) {
      this.meters.stamina -= amount;
      return true;
    }
    // If not enough stamina, set to 0 and reject action
    this.meters.stamina = 0;
    return false;
  }

  /**
   * Mark that a stamina-consuming action just occurred.
   */
  _markStaminaAction() {
    this.lastStaminaActionTime = Date.now() / 1000;
  }

  /**
   * Take damage from a source. Clamps health to 0 minimum.
   * Calls death handler if health reaches 0.
   */
  takeDamage(amount, source = DAMAGE_SOURCES.NONE) {
    if (this.isDead) return;

    this.meters.health -= amount;
    this.lastDamageSource = source;

    // Clamp to 0
    if (this.meters.health <= 0) {
      this.meters.health = 0;
      this._onDeath();
    }

    // Notify damage callback
    if (this.onDamage) {
      this.onDamage({ amount, source, remaining: this.meters.health });
    }
  }

  /**
   * Handle death event.
   */
  _onDeath() {
    this.isDead = true;
    if (this.onDeath) {
      this.onDeath({ lastDamageSource: this.lastDamageSource, spawnPoint: this.spawnPoint });
    }
  }

  /**
   * Respawn player at spawn point. Restores all meters to full.
   */
  respawn() {
    this.isDead = false;
    this.meters.health   = this.config.health.max;
    this.meters.hunger   = this.config.hunger.max;
    this.meters.thirst   = this.config.thirst.max;
    this.meters.sleep    = this.config.sleep.max;
    this.meters.stamina  = this.config.stamina.max;
    this.lastDamageSource = DAMAGE_SOURCES.NONE;

    if (this.onRespawn) {
      this.onRespawn({ spawnPoint: this.spawnPoint });
    }
  }

  /**
   * Set spawn point (e.g., from bed placement).
   */
  setSpawnPoint(x, y, z) {
    this.spawnPoint = { x, y, z };
  }

  /**
   * Get current spawn point.
   */
  getSpawnPoint() {
    return { ...this.spawnPoint };
  }

  /**
   * Eat an apple — restores hunger.
   * @deprecated Use startEating('apple') or eatFood('apple') instead.
   * Kept for backward compatibility.
   */
  eatApple() {
    return this.eatFood('apple');
  }

  /**
   * Start eating a food item (animated — takes eatTime seconds).
   * Returns true if eating started successfully.
   * Returns false if: player is dead, already eating, on cooldown, or invalid food type.
   *
   * @param {string} foodType — Key from FOOD_ITEMS registry (e.g., 'apple', 'bread')
   * @returns {boolean} Whether eating was initiated
   */
  startEating(foodType) {
    if (this.isDead) return false;
    if (this.isEating) return false; // Already in the middle of eating

    const food = FOOD_ITEMS[foodType];
    if (!food) return false; // Unknown food type

    // Check cooldown
    const now = Date.now() / 1000;
    if (now - this.lastEatTime < EATING.defaultCooldown) {
      return false; // Still on cooldown
    }

    this.isEating = true;
    this.eatingProgress = 0;
    this.currentFoodItem = food;
    return true;
  }

  /**
   * Cancel the current eating action (e.g., player moved away, interrupted).
   * No restoration is applied.
   */
  cancelEating() {
    if (!this.isEating) return;
    this.isEating = false;
    this.eatingProgress = 0;
    this.currentFoodItem = null;
  }

  /**
   * Eat a food item instantly (no animation delay).
   * Used for testing or non-animated contexts.
   * Returns true if food was consumed successfully.
   *
   * @param {string} foodType — Key from FOOD_ITEMS registry
   * @returns {boolean} Whether food was consumed
   */
  eatFood(foodType) {
    if (this.isDead) return false;

    const food = FOOD_ITEMS[foodType];
    if (!food) return false; // Unknown food type

    this._applyFoodRestoration(food);
    return true;
  }

  /**
   * Apply the restoration effects of a completed eat action.
   * Called internally when eating animation finishes.
   *
   * @private
   * @param {object} food — Food item definition from FOOD_ITEMS
   */
  _finishEating(food) {
    this._applyFoodRestoration(food);

    // Start saturation bonus timer
    this.saturationTimer = EATING.saturationDuration;
    this.activeSaturation = food.saturation;
  }

  /**
   * Apply the raw restoration values from a food item to meters.
   * Clamps all values to their max. Negative values are applied (e.g., meat dehydrates).
   *
   * @private
   * @param {object} food — Food item definition from FOOD_ITEMS
   */
  _applyFoodRestoration(food) {
    if (food.hunger !== undefined && food.hunger !== 0) {
      this.meters.hunger = Math.min(this.config.hunger.max,
        Math.max(0, this.meters.hunger + food.hunger));
    }
    if (food.thirst !== undefined && food.thirst !== 0) {
      this.meters.thirst = Math.min(this.config.thirst.max,
        Math.max(0, this.meters.thirst + food.thirst));
    }
    if (food.health !== undefined && food.health !== 0) {
      this.meters.health = Math.min(this.config.health.max,
        Math.max(0, this.meters.health + food.health));
    }

    // Notify callbacks about food consumption
    if (this.onFoodEaten) {
      this.onFoodEaten({ foodType: this._findFoodKeyName(food), food });
    }
  }

  /**
   * Find the key name for a food item in FOOD_ITEMS registry.
   * Used for callbacks to report which food was eaten.
   *
   * @private
   * @param {object} food — Food item definition
   * @returns {string} Key name or 'unknown'
   */
  _findFoodKeyName(food) {
    for (const [key, item] of Object.entries(FOOD_ITEMS)) {
      if (item === food) return key;
    }
    return 'unknown';
  }

  /**
   * Check if a food type is valid (exists in FOOD_ITEMS registry).
   *
   * @param {string} foodType — Key to check
   * @returns {boolean}
   */
  isValidFood(foodType) {
    return !!FOOD_ITEMS[foodType];
  }

  /**
   * Get the food item definition by type.
   *
   * @param {string} foodType — Key from FOOD_ITEMS
   * @returns {object|null} Food definition or null if not found
   */
  getFoodItem(foodType) {
    return FOOD_ITEMS[foodType] || null;
  }

  /**
   * Get all registered food item keys.
   *
   * @returns {string[]} Array of food type names
   */
  getAvailableFoods() {
    return Object.keys(FOOD_ITEMS);
  }

  /**
   * Check if player can eat (not dead, not already eating, off cooldown).
   *
   * @returns {boolean}
   */
  canEat() {
    if (this.isDead) return false;
    if (this.isEating) return false;
    const now = Date.now() / 1000;
    return (now - this.lastEatTime) >= EATING.defaultCooldown;
  }

  /**
   * Get eating state for HUD/animation systems.
   *
   * @returns {object} Eating state: isEating, progress (0-1), foodType
   */
  getEatingState() {
    if (!this.isEating || !this.currentFoodItem) {
      return { isEating: false, progress: 0, foodType: null };
    }
    const progress = this.eatingProgress / this.currentFoodItem.eatTime;
    return {
      isEating: true,
      progress: Math.min(1, progress),
      foodType: this._findFoodKeyName(this.currentFoodItem),
    };
  }

  /**
   * Get saturation state for HUD display.
   *
   * @returns {object} Saturation state: active, timeRemaining, multiplier
   */
  getSaturationState() {
    return {
      active: this.saturationTimer > 0,
      timeRemaining: Math.max(0, this.saturationTimer),
      multiplier: this.activeSaturation,
    };
  }

  /**
   * Set whether player is near a water source (pond, ocean, river).
   * Called by the game loop based on chunk data around player position.
   *
   * @param {boolean} nearWater — true if player is standing in or adjacent to a water block
   */
  setNearWaterSource(nearWater) {
    this.isNearWaterSource = !!nearWater;
  }

  /**
   * Check if player can drink (not dead, not already drinking, off cooldown, near water).
   *
   * @returns {boolean}
   */
  canDrink() {
    if (this.isDead) return false;
    if (this.isDrinking) return false;
    if (!this.isNearWaterSource) return false;
    const now = Date.now() / 1000;
    return (now - this.lastDrinkTime) >= DRINKING.cooldown;
  }

  /**
   * Start drinking water from a nearby source (animated — takes drinkTime seconds).
   * Returns true if drinking started successfully.
   * Returns false if: player is dead, already drinking, on cooldown, or not near water.
   *
   * @returns {boolean} Whether drinking was initiated
   */
  startDrinking() {
    if (this.isDead) return false;
    if (this.isDrinking) return false; // Already in the middle of drinking
    if (!this.isNearWaterSource) return false; // No water nearby

    // Check cooldown
    const now = Date.now() / 1000;
    if (now - this.lastDrinkTime < DRINKING.cooldown) {
      return false; // Still on cooldown
    }

    this.isDrinking = true;
    this.drinkingProgress = 0;
    return true;
  }

  /**
   * Cancel the current drinking action (e.g., player moved away from water).
   * No restoration is applied.
   */
  cancelDrinking() {
    if (!this.isDrinking) return;
    this.isDrinking = false;
    this.drinkingProgress = 0;
  }

  /**
   * Finish drinking — apply thirst restoration.
   * Called internally when drinking animation completes.
   *
   * @private
   */
  _finishDrinking() {
    this.meters.thirst = Math.min(this.config.thirst.max,
      this.meters.thirst + DRINKING.thirstRestoration);

    // Notify callbacks about drinking
    if (this.onWaterDrunk) {
      this.onWaterDrunk({ thirstRestored: DRINKING.thirstRestoration });
    }
  }

  /**
   * Get drinking state for HUD/animation systems.
   *
   * @returns {object} Drinking state: isDrinking, progress (0-1), nearWaterSource
   */
  getDrinkingState() {
    return {
      isDrinking: this.isDrinking,
      progress: this.isDrinking ? Math.min(1, this.drinkingProgress / DRINKING.drinkTime) : 0,
      nearWaterSource: this.isNearWaterSource,
    };
  }

  /**
   * Drink water — restores thirst.
   * @deprecated Use startDrinking() for animated drinking or drinkWaterInstant() for testing.
   * Kept for backward compatibility.
   */
  drinkWater() {
    if (this.isDead) return false;
    this.meters.thirst = Math.min(this.config.thirst.max, this.meters.thirst + RESTORATION.water.thirst);
    return true;
  }

  /**
   * Instantly drink water (no animation delay).
   * Used for testing or non-animated contexts.
   * Requires player to be near a water source.
   * Returns true if water was consumed successfully.
   *
   * @returns {boolean} Whether water was consumed
   */
  drinkWaterInstant() {
    if (this.isDead) return false;
    if (!this.isNearWaterSource) return false;

    // Check cooldown even for instant drinking
    const now = Date.now() / 1000;
    if (now - this.lastDrinkTime < DRINKING.cooldown) {
      return false;
    }

    this.meters.thirst = Math.min(this.config.thirst.max,
      this.meters.thirst + DRINKING.thirstRestoration);
    this.lastDrinkTime = now;

    if (this.onWaterDrunk) {
      this.onWaterDrunk({ thirstRestored: DRINKING.thirstRestoration });
    }
    return true;
  }

  /**
   * Use a bed — restores sleep and some health, sets spawn point.
   * @param {number} x - Bed position X
   * @param {number} y - Bed position Y
   * @param {number} z - Bed position Z
   */
  useBed(x, y, z) {
    if (this.isDead) return false;
    this.meters.sleep  = Math.min(this.config.sleep.max, this.meters.sleep + RESTORATION.bed_use.sleep);
    this.meters.health = Math.min(this.config.health.max, this.meters.health + RESTORATION.bed_use.health);
    this.setSpawnPoint(x, y, z);
    return true;
  }

  /**
   * Calculate fall damage based on distance fallen.
   * Called when player lands after a fall.
   * Damage = max(0, fallDistance - 3) — first 3 blocks are safe.
   */
  calculateFallDamage(fallDistance) {
    if (fallDistance <= 3) return 0;
    return Math.floor((fallDistance - 3) * 2);
  }

  /**
   * Apply fall damage when player lands.
   */
  applyFallDamage(landY, startFallY) {
    if (this.isDead || startFallY === null) return;
    const distance = startFallY - landY;
    if (distance <= 0) return;

    const damage = this.calculateFallDamage(distance);
    if (damage > 0) {
      this.takeDamage(damage, DAMAGE_SOURCES.FALL);
    }
  }

  /**
   * Apply environmental damage (lava contact, poison).
   */
  applyEnvironmentalDamage(source, deltaTime) {
    if (this.isDead) return;

    switch (source) {
      case DAMAGE_SOURCES.LAVA:
        this.takeDamage(20.0 * deltaTime, DAMAGE_SOURCES.LAVA);
        break;
      case DAMAGE_SOURCES.POISON:
        this.takeDamage(5.0 * deltaTime, DAMAGE_SOURCES.POISON);
        break;
      default:
        break;
    }
  }

  /**
   * Set thirst multiplier (e.g., 2.0 in desert biome).
   */
  setThirstMultiplier(multiplier) {
    this.thirstMultiplier = Math.max(1.0, multiplier);
  }

  /**
   * Get all meter values as a normalized object (0.0 to 1.0 for each).
   * Useful for HUD rendering.
   */
  getNormalizedMeters() {
    return {
      health:  this.meters.health / this.config.health.max,
      hunger:  this.meters.hunger / this.config.hunger.max,
      thirst:  this.meters.thirst / this.config.thirst.max,
      sleep:   this.meters.sleep / this.config.sleep.max,
      stamina: this.meters.stamina / this.config.stamina.max,
    };
  }

  /**
   * Get raw meter values.
   */
  getMeters() {
    return { ...this.meters };
  }

  /**
   * Check if player can sprint (has enough stamina).
   */
  canSprint() {
    return this.meters.stamina > STAMINA_COSTS.SPRINT * 0.1; // Can sustain at least 100ms of sprint
  }

  /**
   * Reset all meters to maximum values.
   * Used for game mode switches (e.g., creative → survival).
   */
  resetToMax() {
    this.meters.health   = this.config.health.max;
    this.meters.hunger   = this.config.hunger.max;
    this.meters.thirst   = this.config.thirst.max;
    this.meters.sleep    = this.config.sleep.max;
    this.meters.stamina  = this.config.stamina.max;
    this.isDead = false;
    this.lastDamageSource = DAMAGE_SOURCES.NONE;
  }

  /**
   * Serialize survival state for save/load.
   */
  serialize() {
    return {
      meters: { ...this.meters },
      isDead: this.isDead,
      spawnPoint: { ...this.spawnPoint },
      lastDamageSource: this.lastDamageSource,
      // Food system state
      isEating: this.isEating,
      eatingProgress: this.eatingProgress,
      currentFoodItemKey: this.currentFoodItem ? this._findFoodKeyName(this.currentFoodItem) : null,
      lastEatTime: this.lastEatTime,
      saturationTimer: this.saturationTimer,
      activeSaturation: this.activeSaturation,
      // Drinking system state
      isDrinking: this.isDrinking,
      drinkingProgress: this.drinkingProgress,
      lastDrinkTime: this.lastDrinkTime,
    };
  }

  /**
   * Deserialize survival state from save data.
   */
  deserialize(data) {
    if (!data) return;
    if (data.meters) {
      Object.keys(this.meters).forEach(key => {
        if (data.meters[key] !== undefined) {
          this.meters[key] = Math.max(0, Math.min(this.config[key].max, data.meters[key]));
        }
      });
    }
    if (data.isDead !== undefined) this.isDead = data.isDead;
    if (data.spawnPoint) this.spawnPoint = { ...data.spawnPoint };
    if (data.lastDamageSource) this.lastDamageSource = data.lastDamageSource;

    // Food system state
    if (data.isEating !== undefined) this.isEating = data.isEating;
    if (data.eatingProgress !== undefined) this.eatingProgress = data.eatingProgress;
    if (data.currentFoodItemKey) {
      this.currentFoodItem = FOOD_ITEMS[data.currentFoodItemKey] || null;
    } else {
      this.currentFoodItem = null;
    }
    if (data.lastEatTime !== undefined) this.lastEatTime = data.lastEatTime;
    if (data.saturationTimer !== undefined) this.saturationTimer = data.saturationTimer;
    if (data.activeSaturation !== undefined) this.activeSaturation = data.activeSaturation;

    // Drinking system state
    if (data.isDrinking !== undefined) this.isDrinking = data.isDrinking;
    if (data.drinkingProgress !== undefined) this.drinkingProgress = data.drinkingProgress;
    if (data.lastDrinkTime !== undefined) this.lastDrinkTime = data.lastDrinkTime;
  }

  /**
   * Generate HUD HTML for survival meters.
   * Returns HTML string with meter bars.
   */
  generateHUDHTML() {
    const meters = this.getNormalizedMeters();
    const raw = this.getMeters();
    
    const meterDefs = [
      { key: 'health',  label: '❤️ Health',  color: '#e74c3c' },
      { key: 'hunger',  label: '🍖 Hunger',  color: '#e67e22' },
      { key: 'thirst',  label: '💧 Thirst',  color: '#3498db' },
      { key: 'sleep',   label: '😴 Sleep',   color: '#9b59b6' },
      { key: 'stamina', label: '⚡ Stamina', color: '#f1c40f' },
    ];

    let html = '<div id="survival-hud" style="position:fixed;top:10px;left:10px;z-index:1000;font-family:monospace;font-size:12px;">';
    for (const m of meterDefs) {
      const pct = Math.round(meters[m.key] * 100);
      html += `<div style="margin-bottom:4px;display:flex;align-items:center;gap:4px;">`;
      html += `<span style="width:70px;text-align:right;color:#fff;text-shadow:1px 1px 2px #000;">${m.label}</span>`;
      html += `<div style="width:120px;height:10px;background:rgba(0,0,0,0.6);border:1px solid rgba(255,255,255,0.3);border-radius:2px;overflow:hidden;">`;
      html += `<div style="width:${pct}%;height:100%;background:${m.color};transition:width 0.2s;"></div>`;
      html += `</div>`;
      html += `<span style="color:#fff;text-shadow:1px 1px 2px #000;min-width:35px;">${Math.round(raw[m.key])}/${this.config[m.key].max}</span>`;
      html += `</div>`;
    }

    if (this.isDead) {
      html += `<div style="color:#e74c3c;font-weight:bold;margin-top:8px;text-shadow:1px 1px 2px #000;">☠️ YOU DIED — Respawning...</div>`;
    }

    html += '</div>';
    return html;
  }
}

module.exports = { SurvivalSystem, DAMAGE_SOURCES, DEFAULT_METERS, STAMINA_COSTS, RESTORATION, FOOD_ITEMS, EATING, DRINKING };
