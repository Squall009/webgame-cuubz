/**
 * Cuubz — Boss Entity System
 * 
 * Boss entities with health, AI state machine, attack patterns,
 * phase transitions, and quest-triggered spawning.
 * 
 * 4 unique bosses + multi-phase final boss.
 * Death triggers quest completion via callback.
 */

// ─── Boss State Machine ──────────────────────────────────────────────

const BOSS_STATES = {
  IDLE: 'idle',           // Waiting, not engaged
  PATROL: 'patrol',       // Moving around spawn area
  AGGRO: 'aggro',         // Player detected, closing in
  ATTACK: 'attack',       // Executing attack animation/logic
  PHASE_TRANSITION: 'phase_transition', // Transitioning between phases
  DEAD: 'dead',           // Defeated
};

// ─── Boss Definitions (matching quest system bossIds) ────────────────

const BOSS_DEFINITIONS = {
  // Boss 1: Forest Warden — Act II, Dungeon 1 (Corrupt biome)
  forest_warden: {
    name: 'Forest Warden',
    health: 500,
    size: { width: 3, height: 4 },           // Massive creature
    color: '#4a7c2e',                         // Corrupted green
    patrolRadius: 15,                         // Blocks from spawn
    aggroRange: 30,                           // Player detection range
    moveSpeed: 3.5,                           // blocks/s
    damageReduction: 0,                       // No shield initially
    attacks: [
      {
        name: 'Vine Lash',
        damage: 12,
        cooldown: 2.5,
        range: 8,
        type: 'melee',
        description: 'Swinging vine attack in front of boss',
      },
      {
        name: 'Poison Spores',
        damage: 6,
        cooldown: 5.0,
        range: 12,
        type: 'aoe',
        appliesDoT: { source: 'poison', duration: 3, dps: 2 },
        description: 'Cloud of poison spores in area',
      },
      {
        name: 'Root Entangle',
        damage: 8,
        cooldown: 8.0,
        range: 6,
        type: 'stun',
        stunsFor: 2.0,
        description: 'Roots burst from ground, stunning player',
      },
    ],
    phases: 2,
    phase2HealthThreshold: 0.5,
    phase2Name: 'Enraged Warden',
    phase2Effects: { attackSpeedMultiplier: 1.4, damageMultiplier: 1.3 },
    questId: 'quest_12',
    bossMechanics: ['vine_lash', 'poison_spores', 'root_entangle'],
    titleReward: 'Warden Slayer',
  },

  // Boss 2: Lava Titan — Act III, Dungeon 2 (Lava biome)
  lava_titan: {
    name: 'Lava Titan',
    health: 800,
    size: { width: 4, height: 5 },           // Towering being
    color: '#cc3300',                         // Molten red-orange
    patrolRadius: 12,
    aggroRange: 25,
    moveSpeed: 2.5,                           // Slower but tanky
    damageReduction: 0.2,                     // Natural armor (20% reduction)
    attacks: [
      {
        name: 'Ground Slam',
        damage: 18,
        cooldown: 4.0,
        range: 10,
        type: 'aoe',
        createsHazard: { blockType: 15, radius: 3, duration: 10 }, // Lava pool
        description: 'Slams ground creating shockwave + lava pools',
      },
      {
        name: 'Lava Pool Creation',
        damage: 0,
        cooldown: 7.0,
        range: 8,
        type: 'environmental',
        createsHazard: { blockType: 15, radius: 4, duration: 20 },
        description: 'Creates persistent lava pools on ground',
      },
      {
        name: 'Magma Projectile',
        damage: 15,
        cooldown: 3.5,
        range: 20,
        type: 'projectile',
        projectileSpeed: 8,                  // blocks/s
        description: 'Fires magma ball at player position',
      },
    ],
    phases: 2,
    phase2HealthThreshold: 0.4,
    phase2Name: 'Melting Titan',
    phase2Effects: { attackSpeedMultiplier: 1.5, damageMultiplier: 1.5, moveSpeed: 3.5 },
    questId: 'quest_17',
    bossMechanics: ['ground_slam', 'lava_pool_creation', 'magma_projectile'],
    titleReward: 'Titan Bane',
  },

  // Boss 3: Frost Serpent — Act IV, Dungeon 3 (Tundra biome)
  frost_serpent: {
    name: 'Frost Serpent',
    health: 1000,
    size: { width: 2, height: 6 },           // Long serpent shape
    color: '#88ccff',                         // Ice blue
    patrolRadius: 18,
    aggroRange: 35,                           // Detects from far away
    moveSpeed: 5.0,                           // Fast movement
    damageReduction: 0.1,
    attacks: [
      {
        name: 'Ice Breath',
        damage: 14,
        cooldown: 3.0,
        range: 12,
        type: 'cone',
        coneAngle: Math.PI / 3,              // 60 degree cone
        appliesSlow: { factor: 0.5, duration: 3 },
        description: 'Cone of freezing breath that slows player',
      },
      {
        name: 'Tail Swipe',
        damage: 20,
        cooldown: 5.0,
        range: 6,
        type: 'melee',
        knockback: 3,                         // blocks knocked back
        description: 'Powerful tail swipe with knockback',
      },
      {
        name: 'Ice Wall Creation',
        damage: 0,
        cooldown: 9.0,
        range: 15,
        type: 'environmental',
        createsHazard: { blockType: 10, width: 3, height: 4, depth: 1 }, // Ice wall
        description: 'Creates ice walls blocking player path',
      },
    ],
    phases: 2,
    phase2HealthThreshold: 0.35,
    phase2Name: 'Blizzard Serpent',
    phase2Effects: { attackSpeedMultiplier: 1.6, damageMultiplier: 1.4 },
    questId: 'quest_21',
    bossMechanics: ['ice_breath', 'tail_swipe', 'ice_wall_creation'],
    titleReward: 'Serpent Slayer',
  },

  // Boss 4: Corruption Overlord — Act V, Dungeon 4 (Corrupt biome)
  corruption_overlord: {
    name: 'Corruption Overlord',
    health: 1500,
    size: { width: 3.5, height: 4.5 },       // Swirling mass of energy
    color: '#8b00ff',                         // Dark purple
    patrolRadius: 10,
    aggroRange: 40,                           // Very wide detection
    moveSpeed: 4.0,
    damageReduction: 0.3,                     // High natural armor
    attacks: [
      {
        name: 'Summon Minions',
        damage: 0,
        cooldown: 15.0,
        range: 0,
        type: 'summon',
        minionCount: 3,
        minionHealth: 50,
        minionDamage: 8,
        description: 'Summons corrupt minions to attack player',
      },
      {
        name: 'Crystal Shield',
        damage: 0,
        cooldown: 12.0,
        range: 0,
        type: 'buff',
        shieldReduction: 0.5,                 // 50% damage reduction
        shieldDuration: 8,
        description: 'Creates protective crystal shield',
      },
      {
        name: 'Corruption Beam',
        damage: 25,
        cooldown: 6.0,
        range: 30,
        type: 'projectile',
        projectileSpeed: 12,
        pierces: true,                        // Goes through obstacles
        description: 'Beam of pure corruption energy',
      },
      {
        name: 'Dark Nova',
        damage: 15,
        cooldown: 10.0,
        range: 10,
        type: 'aoe',
        appliesDoT: { source: 'poison', duration: 5, dps: 3 },
        description: 'Explosion of dark energy with lingering poison',
      },
    ],
    phases: 2,
    phase2HealthThreshold: 0.5,
    phase2Name: 'Unbound Corruption',
    phase2Effects: { attackSpeedMultiplier: 1.8, damageMultiplier: 1.6 },
    questId: 'quest_24',
    bossMechanics: ['summon_minions', 'crystal_shield', 'corruption_beam', 'dark_nova'],
    titleReward: 'Corruption Vanquisher',
  },

  // Final Boss: The World Eater / Final Seal — Act V, Quest 25
  final_seal: {
    name: 'The World Eater',
    health: 2000,
    size: { width: 4, height: 5 },           // Massive final form
    color: '#ff0066',                         // Shifting elemental colors
    patrolRadius: 8,
    aggroRange: 50,                           // Full arena detection
    moveSpeed: 3.0,
    damageReduction: 0.15,
    attacks: [
      // Phase 1: Elemental Guardian — Fire attacks
      {
        name: 'Fire Storm',
        damage: 20,
        cooldown: 4.0,
        range: 15,
        type: 'aoe',
        phase: 1,
        createsHazard: { blockType: 15, radius: 3, duration: 8 },
        description: 'Fire storm AOE zone',
      },
      // Phase 2: Pure Darkness — Summon + beam
      {
        name: 'Void Summon',
        damage: 0,
        cooldown: 12.0,
        range: 0,
        type: 'summon',
        minionCount: 4,
        minionHealth: 80,
        minionDamage: 12,
        phase: 2,
        description: 'Summons void minions',
      },
      {
        name: 'Dark Beam',
        damage: 30,
        cooldown: 5.0,
        range: 30,
        type: 'projectile',
        projectileSpeed: 15,
        pierces: true,
        phase: 2,
        description: 'Piercing dark energy beam',
      },
      // Phase 3: True Form — Combined pattern (all elements)
      {
        name: 'Elemental Cyclone',
        damage: 25,
        cooldown: 6.0,
        range: 20,
        type: 'aoe',
        phase: 3,
        description: 'Combined fire/ice/corruption cyclone',
      },
      {
        name: 'Final Nova',
        damage: 40,
        cooldown: 15.0,
        range: 25,
        type: 'aoe',
        phase: 3,
        appliesDoT: { source: 'poison', duration: 8, dps: 5 },
        description: 'Ultimate attack — massive damage + DoT',
      },
    ],
    phases: 3,
    phase2HealthThreshold: 0.6,
    phase3HealthThreshold: 0.3,
    phase2Name: 'Pure Darkness',
    phase3Name: 'True Form Awakened',
    phase2Effects: { attackSpeedMultiplier: 1.5, damageMultiplier: 1.4 },
    phase3Effects: { attackSpeedMultiplier: 2.0, damageMultiplier: 1.8 },
    questId: 'quest_25',
    bossMechanics: ['elemental_attacks', 'summon_minions', 'aoe_zones', 'combined_pattern'],
    titleReward: 'World Saver',
  },
};

// ─── Helper Functions ────────────────────────────────────────────────

/**
 * Get boss definition by ID.
 * @param {string} bossId - Boss identifier (e.g., 'forest_warden')
 * @returns {object|null} Boss definition or null
 */
function getBossDefinition(bossId) {
  return BOSS_DEFINITIONS[bossId] || null;
}

/**
 * Get all available boss IDs.
 * @returns {string[]} Array of boss IDs
 */
function getAllBossIds() {
  return Object.keys(BOSS_DEFINITIONS);
}

/**
 * Calculate distance between two world positions.
 * @param {{x:number,y:number,z:number}} a
 * @param {{x:number,y:number,z:number}} b
 * @returns {number} Euclidean distance
 */
function distanceBetween(a, b) {
  return Math.sqrt(
    (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2
  );
}

/**
 * Calculate squared distance (avoid sqrt for comparisons).
 * @param {{x:number,y:number,z:number}} a
 * @param {{x:number,y:number,z:number}} b
 * @returns {number} Squared Euclidean distance
 */
function squaredDistance(a, b) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
}

// ─── Boss Entity Class ───────────────────────────────────────────────

/**
 * Boss entity with full AI state machine, attack system, and phase management.
 * 
 * @param {string} bossId - Boss identifier from BOSS_DEFINITIONS
 * @param {{x:number,y:number,z:number}} spawnPosition - World spawn coordinates
 * @param {object} options - Optional overrides
 */
class Boss {
  constructor(bossId, spawnPosition, options = {}) {
    const def = getBossDefinition(bossId);
    if (!def) {
      throw new Error(`Unknown boss: ${bossId}`);
    }

    this.bossId = bossId;
    this.definition = def;
    
    // Core stats (deep copy to allow runtime mutation)
    this.maxHealth = def.health;
    this.currentHealth = def.health;
    this.size = { ...def.size };
    this.color = def.color;
    
    // Position — starts at spawn point
    this.position = { x: spawnPosition.x, y: spawnPosition.y, z: spawnPosition.z };
    this.spawnPosition = { ...spawnPosition };
    
    // AI state
    this.state = BOSS_STATES.IDLE;
    this.aggroRange = def.aggroRange;
    this.patrolRadius = def.patrolRadius;
    this.moveSpeed = def.moveSpeed;
    
    // Phase tracking
    this.currentPhase = 1;
    this.phasesCompleted = 0;
    
    // Attack system
    this.attackCooldowns = new Map(); // attackName → remaining cooldown (seconds)
    this.currentAttack = null;        // Currently executing attack
    this.attackTimer = 0;             // Time spent in current attack
    
    // Buff tracking
    this.activeBuffs = [];            // Active buffs (shields, etc.)
    
    // Minions (for summon attacks)
    this.minions = [];                // Active minion entities
    
    // Patrol state
    this.patrolTarget = null;         // Current patrol destination
    this.patrolTimer = 0;             // Time since last patrol direction change
    this.patrolInterval = 5;          // Seconds between patrol direction changes
    
    // Aggro tracking
    this.targetPlayer = null;         // Player being targeted
    this.aggroTimer = 0;              // Time since player was last in range
    this.lostAggroTime = 10;          // Seconds without player to lose aggro
    
    // Damage reduction from buffs
    this.damageReduction = def.damageReduction || 0;
    
    // Callbacks (set externally)
    this.onDeath = options.onDeath || null;       // Called when boss dies
    this.onPhaseChange = options.onPhaseChange || null; // Called on phase transition
    this.onAttack = options.onAttack || null;     // Called when attack lands
    
    // Timing
    this.age = 0;                      // Total time alive (seconds)
    this.isDead = false;
    
    // Animation state
    this.attackAnimationProgress = 0;  // 0-1 progress of current attack animation
  }

  /**
   * Get remaining health percentage (0.0 to 1.0).
   * @returns {number}
   */
  getHealthPercent() {
    return Math.max(0, this.currentHealth / this.maxHealth);
  }

  /**
   * Get all attacks available in current phase.
   * @returns {object[]} Filtered attack definitions for current phase
   */
  getAvailableAttacks() {
    const def = this.definition;
    return def.attacks.filter(attack => {
      // If attack has no phase restriction, it's always available
      if (attack.phase === undefined || attack.phase === null) return true;
      return attack.phase <= this.currentPhase;
    });
  }

  /**
   * Get phase-specific effects multiplier.
   * @returns {object} Multipliers for current phase
   */
  getPhaseEffects() {
    const def = this.definition;
    if (this.currentPhase === 1) return { attackSpeedMultiplier: 1, damageMultiplier: 1 };
    
    const key = `phase${this.currentPhase}Effects`;
    return def[key] || { attackSpeedMultiplier: 1, damageMultiplier: 1 };
  }

  /**
   * Take damage from an attack.
   * @param {number} rawDamage - Raw damage before reductions
   * @returns {object} Result with actual damage dealt and remaining health
   */
  takeDamage(rawDamage) {
    if (this.isDead) return { damageDealt: 0, remainingHealth: 0, died: false };
    
    // Apply damage reduction (natural armor + active shields)
    let totalReduction = this.damageReduction;
    
    // Check for active shield buffs
    for (const buff of this.activeBuffs) {
      if (buff.type === 'shield' && buff.remaining > 0) {
        totalReduction += buff.shieldReduction || 0;
      }
    }
    
    totalReduction = Math.min(totalReduction, 0.8); // Cap at 80% reduction
    
    const actualDamage = Math.floor(rawDamage * (1 - totalReduction));
    this.currentHealth = Math.max(0, this.currentHealth - actualDamage);
    
    const died = this.currentHealth <= 0;
    
    if (died) {
      this.die();
    }
    
    return { damageDealt: actualDamage, remainingHealth: this.currentHealth, died };
  }

  /**
   * Handle boss death.
   */
  die() {
    this.isDead = true;
    this.state = BOSS_STATES.DEAD;
    this.currentHealth = 0;
    
    // Clear all minions
    this.minions = [];
    
    // Trigger death callback (quest completion)
    if (this.onDeath) {
      this.onDeath({
        bossId: this.bossId,
        questId: this.definition.questId,
        titleReward: this.definition.titleReward,
        position: { ...this.position },
      });
    }
  }

  /**
   * Check and execute phase transitions based on health thresholds.
   */
  checkPhaseTransition() {
    const def = this.definition;
    const hpPercent = this.getHealthPercent();
    
    // Phase 2 threshold
    if (this.currentPhase === 1 && def.phases >= 2) {
      const threshold = def.phase2HealthThreshold || 0.5;
      if (hpPercent <= threshold) {
        this.transitionToPhase(2);
        return;
      }
    }
    
    // Phase 3 threshold
    if (this.currentPhase === 2 && def.phases >= 3) {
      const threshold = def.phase3HealthThreshold || 0.3;
      if (hpPercent <= threshold) {
        this.transitionToPhase(3);
        return;
      }
    }
  }

  /**
   * Transition to a new phase.
   * @param {number} newPhase - Target phase number
   */
  transitionToPhase(newPhase) {
    if (newPhase <= this.currentPhase || newPhase > this.definition.phases) return;
    
    this.state = BOSS_STATES.PHASE_TRANSITION;
    this.currentPhase = newPhase;
    this.phasesCompleted++;
    
    // Reset attack cooldowns for fresh phase
    this.attackCooldowns.clear();
    
    // Apply phase effects to move speed if defined
    const effects = this.getPhaseEffects();
    if (effects.moveSpeed) {
      this.moveSpeed = effects.moveSpeed;
    }
    
    // Trigger callback
    if (this.onPhaseChange) {
      this.onPhaseChange({
        bossId: this.bossId,
        fromPhase: newPhase - 1,
        toPhase: newPhase,
        phaseName: this.definition[`phase${newPhase}Name`] || `Phase ${newPhase}`,
      });
    }
    
    // Phase transition lasts 3 seconds before resuming combat
    this.phaseTransitionTimer = 3;
  }

  /**
   * Get the next attack to execute based on cooldowns.
   * @returns {object|null} Attack definition or null if no attacks ready
   */
  getNextAttack() {
    const available = this.getAvailableAttacks();
    const effects = this.getPhaseEffects();
    
    for (const attack of available) {
      const remaining = this.attackCooldowns.get(attack.name) || 0;
      // Apply attack speed multiplier from phase effects
      const adjustedCooldown = attack.cooldown / (effects.attackSpeedMultiplier || 1);
      
      if (remaining <= 0) {
        return attack;
      }
    }
    
    return null;
  }

  /**
   * Execute an attack against a target player.
   * @param {{x:number,y:number,z:number}} playerPosition - Target position
   * @returns {object|null} Attack result or null if no attack executed
   */
  executeAttack(playerPosition) {
    const attack = this.getNextAttack();
    if (!attack) return null;
    
    // Check range
    const dist = distanceBetween(this.position, playerPosition);
    if (attack.range > 0 && dist > attack.range) return null;
    
    // Start attack execution
    this.currentAttack = attack;
    this.attackAnimationProgress = 0;
    this.state = BOSS_STATES.ATTACK;
    
    // Set cooldown for next use
    const effects = this.getPhaseEffects();
    const adjustedCooldown = attack.cooldown / (effects.attackSpeedMultiplier || 1);
    this.attackCooldowns.set(attack.name, adjustedCooldown);
    
    // Calculate damage with phase multiplier
    let damage = attack.damage;
    if (attack.damage > 0) {
      damage = Math.floor(damage * (effects.damageMultiplier || 1));
    }
    
    const result = {
      attack: { ...attack },
      damage,
      bossId: this.bossId,
      phase: this.currentPhase,
      position: { ...this.position },
    };
    
    // Handle special attack types
    if (attack.type === 'summon') {
      result.minionsSpawned = this._spawnMinions(attack);
    }
    
    if (attack.type === 'buff' && attack.name === 'Crystal Shield') {
      result.shieldApplied = this._applyShield(attack);
    }
    
    // Trigger callback
    if (this.onAttack) {
      this.onAttack(result);
    }
    
    return result;
  }

  /**
   * Spawn minions from a summon attack.
   * @param {object} attack - Attack definition with minion properties
   * @returns {object[]} Array of spawned minions
   */
  _spawnMinions(attack) {
    const count = attack.minionCount || 1;
    const spawned = [];
    
    for (let i = 0; i < count; i++) {
      // Spawn around boss in a circle
      const angle = (Math.PI * 2 * i) / count;
      const offset = 3; // blocks from boss
      
      const minion = {
        id: `${this.bossId}_minion_${Date.now()}_${i}`,
        health: attack.minionHealth || 50,
        maxHealth: attack.minionHealth || 50,
        damage: attack.minionDamage || 8,
        position: {
          x: this.position.x + Math.cos(angle) * offset,
          y: this.position.y,
          z: this.position.z + Math.sin(angle) * offset,
        },
        targetPlayer: null,
        attackCooldown: 2.0,
        moveSpeed: 3.0,
      };
      
      spawned.push(minion);
      this.minions.push(minion);
    }
    
    return spawned;
  }

  /**
   * Apply a shield buff to the boss.
   * @param {object} attack - Attack definition with shield properties
   * @returns {object} Applied buff info
   */
  _applyShield(attack) {
    const buff = {
      type: 'shield',
      shieldReduction: attack.shieldReduction || 0.5,
      remaining: attack.shieldDuration || 8,
      maxDuration: attack.shieldDuration || 8,
    };
    
    this.activeBuffs.push(buff);
    return buff;
  }

  /**
   * Update AI state machine for one game tick.
   * @param {number} deltaTime - Time elapsed since last update (seconds)
   * @param {{x:number,y:number,z:number}|null} playerPosition - Player position or null
   */
  update(deltaTime, playerPosition) {
    if (this.isDead) return;
    
    this.age += deltaTime;
    
    // Update attack cooldowns
    for (const [name, remaining] of this.attackCooldowns.entries()) {
      const newRemaining = Math.max(0, remaining - deltaTime);
      this.attackCooldowns.set(name, newRemaining);
    }
    
    // Update active buffs
    for (let i = this.activeBuffs.length - 1; i >= 0; i--) {
      this.activeBuffs[i].remaining -= deltaTime;
      if (this.activeBuffs[i].remaining <= 0) {
        this.activeBuffs.splice(i, 1);
      }
    }
    
    // Update minions
    this._updateMinions(deltaTime, playerPosition);
    
    // State machine
    switch (this.state) {
      case BOSS_STATES.IDLE:
        this._updateIdle(deltaTime);
        if (playerPosition && this._isPlayerInRange(playerPosition)) {
          this.state = BOSS_STATES.AGGRO;
          this.targetPlayer = playerPosition;
        }
        break;
        
      case BOSS_STATES.PATROL:
        this._updatePatrol(deltaTime, playerPosition);
        if (playerPosition && this._isPlayerInRange(playerPosition)) {
          this.state = BOSS_STATES.AGGRO;
          this.targetPlayer = playerPosition;
        }
        break;
        
      case BOSS_STATES.AGGRO:
        this._updateAggro(deltaTime, playerPosition);
        if (!playerPosition || !this._isPlayerInRange(playerPosition)) {
          this.aggroTimer += deltaTime;
          if (this.aggroTimer >= this.lostAggroTime) {
            this.state = BOSS_STATES.PATROL;
            this.targetPlayer = null;
            this.aggroTimer = 0;
          }
        } else {
          this.aggroTimer = 0;
        }
        break;
        
      case BOSS_STATES.ATTACK:
        this.attackAnimationProgress += deltaTime / 1.0; // 1 second attack animation
        if (this.attackAnimationProgress >= 1.0) {
          this.currentAttack = null;
          this.state = BOSS_STATES.AGGRO;
        }
        break;
        
      case BOSS_STATES.PHASE_TRANSITION:
        this.phaseTransitionTimer -= deltaTime;
        if (this.phaseTransitionTimer <= 0) {
          this.state = BOSS_STATES.AGGRO;
        }
        break;
    }
    
    // Always check for phase transitions when not dead
    if (this.state !== BOSS_STATES.DEAD && this.state !== BOSS_STATES.PHASE_TRANSITION) {
      this.checkPhaseTransition();
    }
  }

  /**
   * Update idle state — transition to patrol after a delay.
   * @param {number} deltaTime
   */
  _updateIdle(deltaTime) {
    this.patrolTimer += deltaTime;
    if (this.patrolTimer >= 3) { // Transition to patrol after 3 seconds
      this.state = BOSS_STATES.PATROL;
      this._setPatrolTarget();
    }
  }

  /**
   * Update patrol state — move toward patrol target.
   * @param {number} deltaTime
   * @param {{x:number,y:number,z:number}|null} playerPosition
   */
  _updatePatrol(deltaTime, playerPosition) {
    this.patrolTimer += deltaTime;
    
    if (this.patrolTarget) {
      // Move toward patrol target
      const dx = this.patrolTarget.x - this.position.x;
      const dz = this.patrolTarget.z - this.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      
      if (dist > 0.5) {
        const speed = this.moveSpeed * deltaTime;
        this.position.x += (dx / dist) * speed;
        this.position.z += (dz / dist) * speed;
      } else {
        // Reached patrol target, set new one
        this._setPatrolTarget();
      }
    }
    
    // Change patrol direction periodically
    if (this.patrolTimer >= this.patrolInterval) {
      this._setPatrolTarget();
    }
  }

  /**
   * Update aggro state — chase player and attack.
   * @param {number} deltaTime
   * @param {{x:number,y:number,z:number}|null} playerPosition
   */
  _updateAggro(deltaTime, playerPosition) {
    if (!playerPosition) return;
    
    this.targetPlayer = playerPosition;
    
    // Move toward player
    const dx = playerPosition.x - this.position.x;
    const dz = playerPosition.z - this.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    
    // Stop at attack range for ranged attacks, get closer for melee
    const availableAttacks = this.getAvailableAttacks();
    const maxRange = Math.max(...availableAttacks.map(a => a.range || 0));
    const stopDistance = Math.min(maxRange - 1, 4); // Stop slightly before max range
    
    if (dist > stopDistance) {
      const speed = this.moveSpeed * deltaTime;
      this.position.x += (dx / dist) * speed;
      this.position.z += (dz / dist) * speed;
    }
    
    // Try to attack
    this.executeAttack(playerPosition);
  }

  /**
   * Set a new patrol target within spawn radius.
   */
  _setPatrolTarget() {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * this.patrolRadius;
    
    this.patrolTarget = {
      x: this.spawnPosition.x + Math.cos(angle) * radius,
      y: this.spawnPosition.y,
      z: this.spawnPosition.z + Math.sin(angle) * radius,
    };
    this.patrolTimer = 0;
  }

  /**
   * Check if player is within aggro range.
   * @param {{x:number,y:number,z:number}} playerPosition
   * @returns {boolean}
   */
  _isPlayerInRange(playerPosition) {
    const distSq = squaredDistance(this.position, playerPosition);
    return distSq <= this.aggroRange * this.aggroRange;
  }

  /**
   * Update minion entities.
   * @param {number} deltaTime
   * @param {{x:number,y:number,z:number}|null} playerPosition
   */
  _updateMinions(deltaTime, playerPosition) {
    for (let i = this.minions.length - 1; i >= 0; i--) {
      const minion = this.minions[i];
      
      // Remove dead minions
      if (minion.health <= 0) {
        this.minions.splice(i, 1);
        continue;
      }
      
      // Move toward player or boss target
      if (playerPosition) {
        const dx = playerPosition.x - minion.position.x;
        const dz = playerPosition.z - minion.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        
        if (dist > 2) { // Stop near player to attack
          minion.position.x += (dx / dist) * minion.moveSpeed * deltaTime;
          minion.position.z += (dz / dist) * minion.moveSpeed * deltaTime;
        }
      }
    }
  }

  /**
   * Damage a specific minion.
   * @param {string} minionId - Minion ID to damage
   * @param {number} damage - Damage amount
   * @returns {object|null} Damage result or null if minion not found
   */
  damageMinion(minionId, damage) {
    const minion = this.minions.find(m => m.id === minionId);
    if (!minion) return null;
    
    minion.health = Math.max(0, minion.health - damage);
    
    if (minion.health <= 0) {
      const idx = this.minions.indexOf(minion);
      if (idx >= 0) this.minions.splice(idx, 1);
    }
    
    return { minionId, remainingHealth: minion.health, alive: minion.health > 0 };
  }

  /**
   * Reset the boss to full health at spawn position.
   */
  reset() {
    this.currentHealth = this.maxHealth;
    this.position = { ...this.spawnPosition };
    this.state = BOSS_STATES.IDLE;
    this.currentPhase = 1;
    this.phasesCompleted = 0;
    this.attackCooldowns.clear();
    this.activeBuffs = [];
    this.minions = [];
    this.isDead = false;
    this.age = 0;
    this.targetPlayer = null;
    this.aggroTimer = 0;
    this.patrolTimer = 0;
  }

  /**
   * Serialize boss state for persistence.
   * @returns {object} Serializable state
   */
  serialize() {
    return {
      bossId: this.bossId,
      position: { ...this.position },
      spawnPosition: { ...this.spawnPosition },
      currentHealth: this.currentHealth,
      maxHealth: this.maxHealth,
      currentPhase: this.currentPhase,
      state: this.state,
      isDead: this.isDead,
      age: this.age,
      minions: this.minions.map(m => ({
        id: m.id,
        health: m.health,
        maxHealth: m.maxHealth,
        position: { ...m.position },
      })),
    };
  }

  /**
   * Deserialize boss state from saved data.
   * @param {object} data - Serialized boss state
   * @param {object} options - Callback options (onDeath, onPhaseChange, onAttack)
   * @returns {Boss} Reconstructed boss instance
   */
  static deserialize(data, options = {}) {
    const boss = new Boss(data.bossId, data.spawnPosition, options);
    boss.position = { ...data.position };
    boss.currentHealth = data.currentHealth;
    boss.maxHealth = data.maxHealth;
    boss.currentPhase = data.currentPhase;
    boss.state = data.state;
    boss.isDead = data.isDead;
    boss.age = data.age || 0;
    
    if (data.minions) {
      boss.minions = data.minions.map(m => ({
        id: m.id,
        health: m.health,
        maxHealth: m.maxHealth,
        damage: 8, // Default, could be stored
        position: { ...m.position },
        targetPlayer: null,
        attackCooldown: 2.0,
        moveSpeed: 3.0,
      }));
    }
    
    return boss;
  }

  /**
   * Get a summary of the boss's current state (for debugging/HUD).
   * @returns {object} State summary
   */
  getStateSummary() {
    const effects = this.getPhaseEffects();
    return {
      bossId: this.bossId,
      name: this.definition.name,
      phaseName: this.definition[`phase${this.currentPhase}Name`] || `Phase ${this.currentPhase}`,
      health: this.currentHealth,
      maxHealth: this.maxHealth,
      healthPercent: this.getHealthPercent(),
      currentPhase: this.currentPhase,
      totalPhases: this.definition.phases,
      state: this.state,
      activeBuffs: this.activeBuffs.length,
      minionCount: this.minions.length,
      attackSpeedMultiplier: effects.attackSpeedMultiplier || 1,
      damageMultiplier: effects.damageMultiplier || 1,
    };
  }
}

// ─── Boss Manager (handles multiple boss instances) ──────────────────

/**
 * Manages all active boss instances in the game world.
 */
class BossManager {
  constructor() {
    /** @type {Map<string, Boss>} bossId → Boss instance */
    this.activeBosses = new Map();
    
    // Callbacks
    this.onBossDeath = null;
    this.onBossSpawn = null;
    this.onPhaseChange = null;
  }

  /**
   * Spawn a boss at the given position.
   * @param {string} bossId - Boss identifier
   * @param {{x:number,y:number,z:number}} position - Spawn position
   * @returns {Boss} The spawned boss instance
   */
  spawnBoss(bossId, position) {
    // Check if boss is already active
    if (this.activeBosses.has(bossId)) {
      const existing = this.activeBosses.get(bossId);
      if (!existing.isDead) {
        return existing; // Already alive, return existing instance
      }
      // Dead boss — reset it
      existing.reset();
      return existing;
    }
    
    const onDeathCallback = (data) => {
      if (this.onBossDeath) this.onBossDeath(data);
    };
    
    const onPhaseChangeCallback = (data) => {
      if (this.onPhaseChange) this.onPhaseChange(data);
    };
    
    const boss = new Boss(bossId, position, {
      onDeath: onDeathCallback,
      onPhaseChange: onPhaseChangeCallback,
    });
    
    this.activeBosses.set(bossId, boss);
    
    if (this.onBossSpawn) {
      this.onBossSpawn({ bossId, position });
    }
    
    return boss;
  }

  /**
   * Get an active boss by ID.
   * @param {string} bossId
   * @returns {Boss|null}
   */
  getBoss(bossId) {
    return this.activeBosses.get(bossId) || null;
  }

  /**
   * Remove a boss (after death or despawn).
   * @param {string} bossId
   */
  removeBoss(bossId) {
    this.activeBosses.delete(bossId);
  }

  /**
   * Update all active bosses.
   * @param {number} deltaTime
   * @param {{x:number,y:number,z:number}|null} playerPosition
   */
  update(deltaTime, playerPosition) {
    for (const [, boss] of this.activeBosses) {
      boss.update(deltaTime, playerPosition);
    }
  }

  /**
   * Get all alive bosses.
   * @returns {Boss[]}
   */
  getAliveBosses() {
    return Array.from(this.activeBosses.values()).filter(b => !b.isDead);
  }

  /**
   * Check if a specific boss is currently active and alive.
   * @param {string} bossId
   * @returns {boolean}
   */
  isBossActive(bossId) {
    const boss = this.activeBosses.get(bossId);
    return boss !== undefined && !boss.isDead;
  }

  /**
   * Get summary of all bosses for HUD/debugging.
   * @returns {object[]}
   */
  getAllSummaries() {
    return Array.from(this.activeBosses.values()).map(b => b.getStateSummary());
  }
}

// ─── Module Exports ──────────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    BOSS_STATES,
    BOSS_DEFINITIONS,
    Boss,
    BossManager,
    getBossDefinition,
    getAllBossIds,
    distanceBetween,
    squaredDistance,
  };

}