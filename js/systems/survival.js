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

// Restoration amounts
const RESTORATION = {
  apple:   { hunger: 25 },
  water:   { thirst: 30 },
  bed_use: { sleep: 60, health: 20 },  // Bed restores sleep + some health
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
  }

  /**
   * Update all survival meters over time delta (seconds).
   * Called each frame by the game loop.
   */
  update(deltaTime, context = {}) {
    if (this.isDead) return;

    const { isSprinting, isJumping, isMoving, biome } = context;

    // --- Deplete meters over time ---
    this._depleteMeter('hunger', deltaTime);
    this._depleteMeter('thirst', deltaTime);
    this._depleteMeter('sleep', deltaTime);

    // --- Stamina: consume on actions ---
    if (isSprinting && isMoving) {
      this._consumeStamina(STAMINA_COSTS.SPRINT * deltaTime);
      this._markStaminaAction();
    }
    if (isJumping) {
      this._markStaminaAction();
    }

    // --- Stamina: regenerate when resting ---
    const timeSinceAction = context.currentTime ? (context.currentTime - this.lastStaminaActionTime) : Infinity;
    if (!isSprinting && !isJumping && timeSinceAction > STAMINA_REGEN.delay) {
      const regenRate = STAMINA_REGEN.rate * this.staminaRegenMultiplier;
      this.meters.stamina = Math.min(this.config.stamina.max, this.meters.stamina + regenRate * deltaTime);
    }

    // --- Starvation/Dehydration damage ---
    if (this.meters.hunger <= 0) {
      this.meters.hunger = 0;
      this.takeDamage(2.0 * deltaTime, DAMAGE_SOURCES.HUNGER);
    }
    if (this.meters.thirst <= 0) {
      this.meters.thirst = 0;
      this.takeDamage(3.0 * deltaTime, DAMAGE_SOURCES.THIRST);
    }

    // --- Low sleep penalty: slower stamina regen ---
    if (this.meters.sleep < 20) {
      this.staminaRegenMultiplier = Math.max(0.2, this.meters.sleep / 100);
    } else {
      this.staminaRegenMultiplier = 1.0;
    }

    // --- Low hunger penalty: slower health regen (if any) ---
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
   * Returns true if food was consumed (not dead).
   */
  eatApple() {
    if (this.isDead) return false;
    this.meters.hunger = Math.min(this.config.hunger.max, this.meters.hunger + RESTORATION.apple.hunger);
    return true;
  }

  /**
   * Drink water — restores thirst.
   * Returns true if water was consumed (not dead).
   */
  drinkWater() {
    if (this.isDead) return false;
    this.meters.thirst = Math.min(this.config.thirst.max, this.meters.thirst + RESTORATION.water.thirst);
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

module.exports = { SurvivalSystem, DAMAGE_SOURCES, DEFAULT_METERS, STAMINA_COSTS, RESTORATION };
