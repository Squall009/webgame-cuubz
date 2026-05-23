/**
 * Cuubz — Damage System
 * Environmental damage (lava, poison), fall damage, boss attacks.
 * Integrates with SurvivalSystem for health reduction.
 * Handles damage flash visual effects on screen edges.
 */

// Damage source constants (mirrored from survival.js)
const DAMAGE_SOURCES = {
  NONE: 'none',
  LAVA: 'lava',
  POISON: 'poison',
  FALL: 'fall',
  BOSS: 'boss',
  HUNGER: 'hunger',
  THIRST: 'thirst',
};

// Environmental damage rates (damage per second while in contact)
// Keys match DAMAGE_SOURCES values (lowercase strings)
const ENVIRONMENTAL_DAMAGE_RATES = {
  [DAMAGE_SOURCES.LAVA]:    20.0,   // Rapid — kills in ~5 seconds
  [DAMAGE_SOURCES.POISON]:   5.0,   // Slower DoT — kills in ~20 seconds
};

// Poison effect configuration
const POISON_CONFIG = {
  tickInterval: 1.0,       // Damage applied every N seconds (not continuous)
  maxStacks: 3,            // Max poison stack levels
  damagePerStack: 5.0,     // Damage per tick per stack
  duration: 8.0,           // Seconds per stack level
};

// Fall damage configuration
const FALL_DAMAGE_CONFIG = {
  safeFallDistance: 3.0,   // First 3 blocks fall without damage (Minecraft-style)
  damagePerBlock: 2.0,     // Damage per block beyond safe distance
  maxDamage: 100.0,        // Cap at max health
};

// Boss attack definitions
const BOSS_ATTACKS = {
  // Boss 1: Corrupt Crystal Guardian (Dungeon 1)
  CORRUPT_GUARDIAN: {
    name: 'Corrupt Crystal Guardian',
    health: 500,
    attacks: [
      { name: 'Crystal Blast', damage: 15, cooldown: 3.0, range: 8, type: 'projectile' },
      { name: 'Poison Nova', damage: 8, cooldown: 6.0, range: 5, type: 'aoe', appliesPoison: true },
      { name: 'Crystal Shield', damage: 0, cooldown: 10.0, range: 0, type: 'buff' }, // Reduces incoming damage by 50%
    ],
    phases: 2,
  },
  // Boss 2: Lava Wurm (Dungeon 2)
  LAVA_WURM: {
    name: 'Lava Wurm',
    health: 800,
    attacks: [
      { name: 'Flame Breath', damage: 20, cooldown: 4.0, range: 10, type: 'cone' },
      { name: 'Earthquake', damage: 12, cooldown: 8.0, range: 15, type: 'aoe' },
      { name: 'Lava Eruption', damage: 25, cooldown: 12.0, range: 6, type: 'ground' }, // Leaves lava tiles
    ],
    phases: 2,
  },
  // Boss 3: Tundra Yeti King (Dungeon 3)
  YETI_KING: {
    name: 'Tundra Yeti King',
    health: 1000,
    attacks: [
      { name: 'Ice Slam', damage: 18, cooldown: 3.5, range: 4, type: 'melee' },
      { name: 'Blizzard', damage: 6, cooldown: 7.0, range: 20, type: 'aoe', appliesSlow: true },
      { name: 'Ice Spike', damage: 22, cooldown: 10.0, range: 15, type: 'projectile' },
    ],
    phases: 2,
  },
  // Boss 4: Final Corruption Overlord (Dungeon 4 — final boss)
  CORRUPTION_OVERLORD: {
    name: 'Corruption Overlord',
    health: 1500,
    attacks: [
      { name: 'Void Beam', damage: 30, cooldown: 5.0, range: 25, type: 'projectile' },
      { name: 'Dark Nova', damage: 15, cooldown: 8.0, range: 10, type: 'aoe', appliesPoison: true },
      { name: 'Summon Minions', damage: 0, cooldown: 15.0, range: 0, count: 3, type: 'summon' },
    ],
    phases: 3, // Multi-phase final boss
    phase2HealthThreshold: 0.6,  // At 60% health, enters phase 2
    phase3HealthThreshold: 0.3,  // At 30% health, enters phase 3 (enraged)
  },
};

/**
 * Check if a block type is damaging and return the damage source.
 * @param {number} blockType - Block type ID
 * @returns {string|null} Damage source or null if not damaging
 */
function getBlockDamageSource(blockType) {
  // Block type IDs from the registry in todo.md
  const LAVA_ID = 15;
  const TOXIC_SLIME_ID = 17;

  if (blockType === LAVA_ID) return DAMAGE_SOURCES.LAVA;
  if (blockType === TOXIC_SLIME_ID) return DAMAGE_SOURCES.POISON;
  return null;
}

/**
 * Check if a block type is a damaging block.
 * @param {number} blockType - Block type ID
 * @returns {boolean}
 */
function isDamagingBlock(blockType) {
  return getBlockDamageSource(blockType) !== null;
}

/**
 * Calculate fall damage based on distance fallen (in blocks).
 * Minecraft-style: first 3 blocks are safe, then 2 damage per block.
 * @param {number} fallDistance - Distance fallen in blocks
 * @returns {number} Damage amount (0 if below threshold)
 */
function calculateFallDamage(fallDistance) {
  if (fallDistance <= FALL_DAMAGE_CONFIG.safeFallDistance) return 0;
  const rawDamage = (fallDistance - FALL_DAMAGE_CONFIG.safeFallDistance) * FALL_DAMAGE_CONFIG.damagePerBlock;
  return Math.min(Math.floor(rawDamage), FALL_DAMAGE_CONFIG.maxDamage);
}

/**
 * Get the environmental damage rate for a source.
 * @param {string} source - Damage source from DAMAGE_SOURCES
 * @returns {number} Damage per second (0 if not an environmental hazard)
 */
function getEnvironmentalDamageRate(source) {
  return ENVIRONMENTAL_DAMAGE_RATES[source] || 0;
}

/**
 * Get boss definition by key.
 * @param {string} bossKey - Key from BOSS_ATTACKS
 * @returns {object|null} Boss definition or null
 */
function getBossDefinition(bossKey) {
  return BOSS_ATTACKS[bossKey] || null;
}

/**
 * Calculate damage for a boss attack with optional phase multiplier.
 * @param {object} attack - Attack definition from BOSS_ATTACKS
 * @param {number} phase - Current boss phase (1-based)
 * @returns {number} Damage amount
 */
function calculateBossAttackDamage(attack, phase = 1) {
  // Each phase increases damage by 20%
  const phaseMultiplier = 1.0 + (phase - 1) * 0.2;
  return Math.floor(attack.damage * phaseMultiplier);
}

/**
 * Get all boss keys available in the game.
 * @returns {string[]} Array of boss definition keys
 */
function getBossKeys() {
  return Object.keys(BOSS_ATTACKS);
}

/**
 * DamageFlashEffect — Visual damage flash on screen edges.
 * Triggers when player takes damage, fades out over time.
 */
class DamageFlashEffect {
  constructor() {
    this.active = false;
    this.intensity = 0;        // 0.0 to 1.0 — alpha of flash overlay
    this.fadeRate = 2.0;       // Intensity units per second fade out
    this.source = DAMAGE_SOURCES.NONE;
    this.triggeredAt = 0;
  }

  /**
   * Trigger a damage flash effect.
   * @param {string} source - Damage source that caused the flash
   * @param {number} amount - Amount of damage taken (used to scale intensity)
   * @param {number} maxHealth - Player max health for normalization
   */
  trigger(source, amount, maxHealth = 100) {
    this.active = true;
    // Scale intensity based on how much damage relative to max health
    this.intensity = Math.min(1.0, amount / maxHealth);
    this.source = source;
    this.triggeredAt = Date.now() / 1000;
  }

  /**
   * Update the flash effect over time (called each frame).
   * @param {number} deltaTime - Time since last frame in seconds
   * @returns {boolean} True if still active, false if faded out
   */
  update(deltaTime) {
    if (!this.active) return false;

    this.intensity -= this.fadeRate * deltaTime;

    if (this.intensity <= 0) {
      this.active = false;
      this.intensity = 0;
      return false;
    }
    return true;
  }

  /**
   * Get the color for the flash based on damage source.
   * @returns {string} CSS color string (RGBA with alpha from intensity)
   */
  getColor() {
    const alpha = Math.max(0, this.intensity).toFixed(3);
    switch (this.source) {
      case DAMAGE_SOURCES.LAVA:
        return `rgba(255, 80, 0, ${alpha})`;     // Orange-red for lava
      case DAMAGE_SOURCES.POISON:
        return `rgba(160, 32, 240, ${alpha})`;   // Purple for poison
      case DAMAGE_SOURCES.FALL:
        return `rgba(255, 255, 255, ${alpha})`;  // White flash for fall impact
      case DAMAGE_SOURCES.BOSS:
        return `rgba(200, 0, 100, ${alpha})`;    // Deep red for boss attacks
      case DAMAGE_SOURCES.HUNGER:
        return `rgba(139, 69, 19, ${alpha * 0.5})`; // Brown, subtle for starvation
      case DAMAGE_SOURCES.THIRST:
        return `rgba(70, 130, 180, ${alpha * 0.5})`; // Steel blue, subtle for dehydration
      default:
        return `rgba(255, 0, 0, ${alpha})`;       // Generic red
    }
  }

  /**
   * Generate HTML overlay for damage flash effect.
   * @returns {string} HTML string with the flash overlay div
   */
  generateHTML() {
    if (!this.active || this.intensity <= 0) return '';

    const color = this.getColor();
    // Creates a border-style flash using box-shadow inset
    const shadowSize = Math.floor(this.intensity * 40);
    return `<div id="damage-flash" style="position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;box-shadow:inset 0 0 ${shadowSize}px ${Math.floor(shadowSize * 0.5)}px ${color};"></div>`;
  }

  /**
   * Reset the flash effect completely.
   */
  reset() {
    this.active = false;
    this.intensity = 0;
    this.source = DAMAGE_SOURCES.NONE;
    this.triggeredAt = 0;
  }
}

/**
 * DamageSystem — Central damage management system.
 * Coordinates environmental hazards, fall tracking, boss attacks, and visual feedback.
 */
class DamageSystem {
  constructor(options = {}) {
    this.flashEffect = new DamageFlashEffect();
    this.poisonStacks = 0;
    this.poisonTimer = 0;           // Countdown to next poison tick
    this.fallStartY = null;         // Y position when fall started
    this.lastGroundedY = null;      // Last known grounded Y position

    // Callbacks (set by game loop)
    this.onDamage = options.onDamage || null;
    this.onDeath = options.onDeath || null;

    // Boss state
    this.activeBosses = new Map();  // bossId → { definition, health, phase, attackCooldowns }

    // Configuration overrides
    this.config = {
      fall: { ...FALL_DAMAGE_CONFIG },
      poison: { ...POISON_CONFIG },
      environmental: { ...ENVIRONMENTAL_DAMAGE_RATES },
    };
    Object.keys(options.config || {}).forEach(key => {
      if (this.config[key]) {
        this.config[key] = { ...this.config[key], ...(options.config[key] || {}) };
      }
    });

    // Internal references (set by game loop)
    this.survivalSystem = null;     // Reference to SurvivalSystem instance
  }

  /**
   * Link to the survival system for health management.
   * @param {SurvivalSystem} survival - The player's survival system
   */
  linkSurvivalSystem(survival) {
    this.survivalSystem = survival;
  }

  /**
   * Update all damage systems over time delta.
   * Called each frame by the game loop.
   * @param {number} deltaTime - Time since last frame in seconds
   * @param {object} context - Current player context
   * @returns {object} Damage results for this frame
   */
  update(deltaTime, context = {}) {
    const results = { damageDealt: 0, source: DAMAGE_SOURCES.NONE };

    if (!this.survivalSystem || this.survivalSystem.isDead) return results;

    // --- Update flash effect ---
    this.flashEffect.update(deltaTime);

    // --- Environmental damage check ---
    const envDamage = this._checkEnvironmentalDamage(deltaTime, context);
    if (envDamage > 0) {
      results.damageDealt += envDamage;
      results.source = context.currentHazard || DAMAGE_SOURCES.LAVA;
      this.survivalSystem.takeDamage(envDamage, results.source);
      this.flashEffect.trigger(results.source, envDamage, this.survivalSystem.config.health.max);
    }

    // --- Poison DoT ticks ---
    const poisonDamage = this._updatePoison(deltaTime);
    if (poisonDamage > 0) {
      results.damageDealt += poisonDamage;
      results.source = DAMAGE_SOURCES.POISON;
      this.survivalSystem.takeDamage(poisonDamage, DAMAGE_SOURCES.POISON);
      this.flashEffect.trigger(DAMAGE_SOURCES.POISON, poisonDamage, this.survivalSystem.config.health.max);
    }

    // --- Fall tracking ---
    this._updateFallTracking(context);

    // --- Boss AI updates ---
    this._updateBosses(deltaTime, context);

    return results;
  }

  /**
   * Check for environmental hazards at player position.
   * @param {number} deltaTime
   * @param {object} context - Must include currentHazard (DAMAGE_SOURCES or null)
   * @returns {number} Damage amount for this frame
   */
  _checkEnvironmentalDamage(deltaTime, context) {
    if (!context.currentHazard) return 0;

    const rate = this.config.environmental[context.currentHazard];
    if (!rate) return 0;

    // Lava is continuous damage, poison adds stacks (handled separately)
    if (context.currentHazard === DAMAGE_SOURCES.POISON) {
      this._applyPoisonStack();
      return 0; // Poison damage comes from DoT ticks, not per-frame
    }

    return rate * deltaTime;
  }

  /**
   * Apply a poison stack when player contacts toxic slime.
   */
  _applyPoisonStack() {
    if (this.poisonStacks >= this.config.poison.maxStacks) return;
    this.poisonStacks++;
    this.poisonTimer = this.config.poison.duration;
  }

  /**
   * Update poison DoT timer and apply damage on ticks.
   * @param {number} deltaTime
   * @returns {number} Poison damage dealt this frame (0 if no tick)
   */
  _updatePoison(deltaTime) {
    if (this.poisonStacks <= 0) return 0;

    this.poisonTimer -= deltaTime;
    if (this.poisonTimer > 0) return 0;

    // Tick: deal damage based on stacks
    const tickDamage = this.config.poison.damagePerStack * this.poisonStacks;
    this.poisonTimer = this.config.poison.tickInterval;

    // Reduce stacks after each full duration cycle
    if (this.poisonTimer <= this.config.poison.tickInterval) {
      // Check if we should reduce a stack at next tick
    }

    return tickDamage;
  }

  /**
   * Track player fall state for fall damage calculation.
   * @param {object} context - Must include: isGrounded, position.y
   */
  _updateFallTracking(context) {
    if (!context.position) return;

    if (context.isGrounded) {
      // Player just landed — calculate fall damage
      if (this.fallStartY !== null && this.lastGroundedY !== null) {
        const fallDistance = this.fallStartY - context.position.y;
        if (fallDistance > 0) {
          const damage = this.calculateFallDamage(fallDistance);
          if (damage > 0 && this.survivalSystem) {
            this.survivalSystem.takeDamage(damage, DAMAGE_SOURCES.FALL);
            this.flashEffect.trigger(DAMAGE_SOURCES.FALL, damage, this.survivalSystem.config.health.max);
          }
        }
      }
      this.fallStartY = context.position.y;
      this.lastGroundedY = context.position.y;
    } else {
      // Player is falling — track highest point since last grounded
      if (this.fallStartY === null) {
        this.fallStartY = context.position.y;
      } else {
        this.fallStartY = Math.max(this.fallStartY, context.position.y);
      }
    }
  }

  /**
   * Calculate boss attack damage with phase multiplier.
   * Instance method wrapper for the module-level function.
   * @param {object} attack - Attack definition from BOSS_ATTACKS
   * @param {number} phase - Current boss phase (1-based)
   * @returns {number} Damage amount
   */
  calculateBossAttackDamage(attack, phase = 1) {
    return calculateBossAttackDamage(attack, phase);
  }

  /**
   * Update all active boss entities.
   * @param {number} deltaTime
   * @param {object} context - Must include: position (player position)
   */
  _updateBosses(deltaTime, context) {
    const playerPos = context.position || { x: 0, y: 0, z: 0 };

    for (const [bossId, boss] of this.activeBosses.entries()) {
      // Update attack cooldowns
      for (const attack of boss.attackCooldowns) {
        if (attack.cooldownRemaining > 0) {
          attack.cooldownRemaining -= deltaTime;
        }
      }

      // Simple AI: attack player if in range and cooldown ready
      const distance = Math.sqrt(
        Math.pow(boss.position.x - playerPos.x, 2) +
        Math.pow(boss.position.z - playerPos.z, 2)
      );

      for (const attack of boss.attackCooldowns) {
        if (attack.cooldownRemaining <= 0 && distance <= attack.def.range) {
          // Execute attack
          const damage = this.calculateBossAttackDamage(attack.def, boss.phase);
          if (damage > 0 && this.survivalSystem) {
            this.survivalSystem.takeDamage(damage, DAMAGE_SOURCES.BOSS);
            this.flashEffect.trigger(DAMAGE_SOURCES.BOSS, damage, this.survivalSystem.config.health.max);
          }
          attack.cooldownRemaining = attack.def.cooldown;

          // Apply additional effects
          if (attack.def.appliesPoison) {
            this._applyPoisonStack();
          }
        }
      }
    }
  }

  /**
   * Calculate fall damage with current config.
   * @param {number} fallDistance - Distance fallen in blocks
   * @returns {number} Damage amount
   */
  calculateFallDamage(fallDistance) {
    if (fallDistance <= this.config.fall.safeFallDistance) return 0;
    const raw = (fallDistance - this.config.fall.safeFallDistance) * this.config.fall.damagePerBlock;
    return Math.min(Math.floor(raw), this.config.fall.maxDamage);
  }

  /**
   * Spawn a boss entity.
   * @param {string} bossKey - Key from BOSS_ATTACKS (e.g., 'CORRUPT_GUARDIAN')
   * @param {object} position - { x, y, z } spawn position
   * @param {string} bossId - Unique ID for this boss instance
   * @returns {object|null} Boss instance or null if invalid key
   */
  spawnBoss(bossKey, position, bossId) {
    const def = getBossDefinition(bossKey);
    if (!def) return null;

    const bossInstance = {
      definition: def,
      id: bossId,
      health: def.health,
      maxHealth: def.health,
      phase: 1,
      position: { ...position },
      attackCooldowns: def.attacks.map(a => ({
        def: a,
        cooldownRemaining: 0, // Ready to attack immediately
      })),
    };

    this.activeBosses.set(bossId, bossInstance);
    return bossInstance;
  }

  /**
   * Remove a boss entity (e.g., on death).
   * @param {string} bossId - Boss instance ID to remove
   */
  removeBoss(bossId) {
    this.activeBosses.delete(bossId);
  }

  /**
   * Get all active bosses.
   * @returns {Map<string, object>} Map of bossId → boss instance
   */
  getActiveBosses() {
    return new Map(this.activeBosses);
  }

  /**
   * Apply direct damage to a boss.
   * @param {string} bossId
   * @param {number} damage
   * @returns {boolean} True if boss died from this hit
   */
  damageBoss(bossId, damage) {
    const boss = this.activeBosses.get(bossId);
    if (!boss) return false;

    boss.health -= damage;

    // Check phase transitions
    const def = boss.definition;
    if (def.phases >= 2 && boss.phase === 1) {
      const threshold = def.phase2HealthThreshold || 0.5;
      if (boss.health <= boss.maxHealth * threshold) {
        boss.phase = 2;
      }
    }
    if (def.phases >= 3 && boss.phase === 2) {
      const threshold = def.phase3HealthThreshold || 0.25;
      if (boss.health <= boss.maxHealth * threshold) {
        boss.phase = 3;
      }
    }

    // Boss death
    if (boss.health <= 0) {
      this.removeBoss(bossId);
      return true;
    }
    return false;
  }

  /**
   * Get the current damage flash HTML overlay.
   * @returns {string} HTML string for the flash overlay
   */
  getFlashHTML() {
    return this.flashEffect.generateHTML();
  }

  /**
   * Serialize damage system state for save/load.
   * @returns {object} Serializable state
   */
  serialize() {
    const bosses = [];
    for (const [id, boss] of this.activeBosses.entries()) {
      bosses.push({
        id,
        key: boss.definition.name, // Store name to reconstruct
        health: boss.health,
        phase: boss.phase,
        position: { ...boss.position },
      });
    }

    return {
      poisonStacks: this.poisonStacks,
      poisonTimer: this.poisonTimer,
      bosses,
    };
  }

  /**
   * Deserialize damage system state from save data.
   * @param {object} data
   */
  deserialize(data) {
    if (!data) return;

    if (data.poisonStacks !== undefined) this.poisonStacks = data.poisonStacks;
    if (data.poisonTimer !== undefined) this.poisonTimer = data.poisonTimer;

    // Reconstruct bosses
    if (data.bosses) {
      for (const bossData of data.bosses) {
        // Find the boss definition by name
        const bossKey = Object.keys(BOSS_ATTACKS).find(k => BOSS_ATTACKS[k].name === bossData.key);
        if (bossKey) {
          const instance = this.spawnBoss(bossKey, bossData.position, bossData.id);
          if (instance) {
            instance.health = bossData.health;
            instance.phase = bossData.phase || 1;
          }
        }
      }
    }
  }
}

// Export all public interfaces
module.exports = {
  DamageSystem,
  DamageFlashEffect,
  DAMAGE_SOURCES,
  ENVIRONMENTAL_DAMAGE_RATES,
  POISON_CONFIG,
  FALL_DAMAGE_CONFIG,
  BOSS_ATTACKS,
  getBlockDamageSource,
  isDamagingBlock,
  calculateFallDamage,
  getEnvironmentalDamageRate,
  getBossDefinition,
  calculateBossAttackDamage,
  getBossKeys,
};
