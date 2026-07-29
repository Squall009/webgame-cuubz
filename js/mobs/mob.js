/**
 * Cuubz — Base Mob Class
 * Shared by all mob types. Handles health, position, state, drops, and serialization.
 * AI and movement are delegated to separate modules.
 */

class Mob {
  /**
   * @param {string} mobType - Key into MOB_DEFINITIONS
   * @param {{x:number,y:number,z:number}} position - Spawn position
   * @param {number} [seed] - World seed for deterministic drops
   */
  constructor(mobType, position, seed) {
    const def = getMobDefinition(mobType);
    if (!def) throw new Error(`Unknown mob type: ${mobType}`);

    this.mobType = mobType;
    this.definition = def;

    // Identity
    this.id = Mob._generateId();

    // Stats
    this.maxHealth = def.health;
    this.health = def.health;
    this.speed = def.speed;
    this.damage = def.damage || 0;
    this.knockback = def.knockback || 0;

    // Position & movement
    this.position = { x: position.x, y: position.y, z: position.z };
    this.spawnPosition = { x: position.x, y: position.y, z: position.z };
    this.velocity = { x: 0, y: 0, z: 0 };
    this.yaw = Math.random() * Math.PI * 2;
    this.onGround = false;
    this.isFlying = !!def.flying;

    // AI state
    this.aiState = AI_STATES.IDLE;
    this.aiTimer = 2 + Math.random() * 3; // Initial idle timer
    this.attackCooldownTimer = 0;
    this.stuckTimer = 0;
    this.targetEntity = null;
    this.wanderTarget = null;
    this.fleeTarget = null;

    // Animation
    this.animationTimer = 0;
    this.animationState = this.aiState;

    // Flee cooldown (prevents constant fleeing)
    this.fleeCooldownTimer = 0;

    // Death
    this.isDead = false;
    this.deathTimer = 0;
    this.alive = true;

    // Pathfinding (A* waypoints)
    this.path = [];
    this.pathIndex = 0;

    // Seed for deterministic drops
    this._seed = seed || 0;

    // Hurt state
    this.hurtTimer = 0;
    this.lastDamageSource = null;
  }

  /**
   * Generate a unique mob ID.
   * @returns {string}
   */
  static _generateId() {
    const ts = Date.now().toString(36);
    const rnd = Math.random().toString(36).substring(2, 8);
    return `mob_${ts}_${rnd}`;
  }

  /**
   * Update the mob for one game tick.
   * @param {number} deltaTime - Seconds since last tick
   * @param {object} blockAccess - World interface with getBlockAtWorld(x,y,z)
   * @param {{x:number,y:number,z:number}|null} playerPosition
   * @param {Mob[]} otherMobs - Array of other mobs (for pack aggro)
   */
  update(deltaTime, blockAccess, playerPosition, otherMobs) {
    if (this.isDead) {
      this.deathTimer += deltaTime;
      return;
    }

    // Update cooldowns
    if (this.attackCooldownTimer > 0) {
      this.attackCooldownTimer -= deltaTime;
    }

    // Decrement hurt timer
    if (this.hurtTimer > 0) {
      this.hurtTimer -= deltaTime;
      if (this.hurtTimer <= 0) {
        this.hurtTimer = 0;
        // Transition back to appropriate state after hurt
        if (this.definition.behavior === MOB_BEHAVIORS.AGGRESSIVE && this.targetEntity) {
          this.aiState = AI_STATES.CHASE;
        } else {
          this.aiState = AI_STATES.IDLE;
          this.aiTimer = 1 + Math.random() * 2;
        }
      }
    }

    // Animation timer
    this.animationTimer += deltaTime;
  }

  /**
   * Take damage from a source.
   * @param {number} amount - Raw damage amount
   * @param {string} [source] - Damage source identifier
   * @returns {{damageDealt:number, died:boolean}}
   */
  takeDamage(amount, source) {
    if (this.isDead) return { damageDealt: 0, died: false };

    this.health -= amount;
    this.lastDamageSource = source || 'generic';

    // Enter hurt state
    if (this.definition.animations && this.definition.animations.hurt) {
      this.aiState = AI_STATES.HURT;
      this.hurtTimer = this.definition.animations.hurt.duration || 0.25;
      this.animationTimer = 0;
    }

    // Die if health reaches 0
    if (this.health <= 0) {
      this.health = 0;
      this.die();
      return { damageDealt: amount, died: true };
    }

    return { damageDealt: amount, died: false };
  }

  /**
   * Handle mob death — set state and trigger death timer.
   */
  die() {
    this.isDead = true;
    this.alive = false;
    this.aiState = AI_STATES.DEAD;
    this.animationTimer = 0;
    this.deathTimer = 0;
    this.velocity.x = 0;
    this.velocity.y = 0;
    this.velocity.z = 0;
  }

  /**
   * Apply knockback impulse.
   * @param {number} dx - X direction
   * @param {number} dz - Z direction
   * @param {number} [force] - Knockback force (defaults to mob definition knockback)
   */
  knockback(dx, dz, force) {
    const kb = force !== undefined ? force : this.knockback;
    if (kb <= 0) return;
    this.velocity.x += dx * kb;
    this.velocity.z += dz * kb;
    if (this.velocity.y < 2) this.velocity.y = 2; // Pop up slightly
  }

  /**
   * Roll the drop table and return items.
   * @returns {{typeId:*, count:number}[]}
   */
  getDropItems() {
    const items = [];
    const drops = this.definition.drops || [];
    for (const entry of drops) {
      const roll = Math.random() * 100;
      if (roll < entry.weight) {
        const count = entry.minCount + Math.floor(Math.random() * (entry.maxCount - entry.minCount + 1));
        if (count > 0) {
          items.push({ typeId: entry.item, count });
        }
      }
    }
    return items;
  }

  /**
   * Get the death animation duration for this mob type.
   * @returns {number} Seconds
   */
  getDeathDuration() {
    const anim = this.definition.animations && this.definition.animations.dead;
    return anim ? anim.duration : 1.0;
  }

  /**
   * Euclidean distance to a point.
   * @param {{x:number,y:number,z:number}} target
   * @returns {number}
   */
  distanceTo(target) {
    if (!target) return Infinity;
    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  /**
   * Squared distance (avoids sqrt for comparisons).
   * @param {{x:number,y:number,z:number}} target
   * @returns {number}
   */
  distanceSq(target) {
    if (!target) return Infinity;
    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    return dx * dx + dz * dz;
  }

  /**
   * Compute yaw angle to face a target.
   * @param {{x:number,y:number,z:number}} target
   * @returns {number} Yaw in radians
   */
  facingAngleToward(target) {
    if (!target) return this.yaw;
    return Math.atan2(target.x - this.position.x, target.z - this.position.z);
  }

  /**
   * Check line of sight to a target (raycast through blocks).
   * @param {{x:number,y:number,z:number}} target
   * @param {object} blockAccess - World block access
   * @returns {boolean}
   */
  canSee(target, blockAccess) {
    if (!target || !blockAccess) return false;

    const eyeY = this.position.y + (this.definition.hitbox.height * 0.7);
    const targetEyeY = target.y + 1.0; // Player eye height

    const dx = target.x - this.position.x;
    const dy = targetEyeY - eyeY;
    const dz = target.z - this.position.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist <= 0) return true;

    const steps = Math.ceil(dist * 2); // 2 samples per block
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const px = this.position.x + dx * t;
      const py = eyeY + dy * t;
      const pz = this.position.z + dz * t;
      const block = blockAccess.getBlockAtWorld
        ? blockAccess.getBlockAtWorld(Math.floor(px), Math.floor(py), Math.floor(pz))
        : 0;
      // Non-air blocks block line of sight
      if (block !== 0 && block !== 12) {
        if (i > 0) return false; // Allow starting voxel
      }
    }
    return true;
  }

  /**
   * Serialize mob state for persistence.
   * @returns {object}
   */
  serialize() {
    return {
      mobType: this.mobType,
      id: this.id,
      position: { ...this.position },
      spawnPosition: { ...this.spawnPosition },
      health: this.health,
      maxHealth: this.maxHealth,
      yaw: this.yaw,
      aiState: this.aiState,
      isDead: this.isDead,
      alive: this.alive,
    };
  }

  /**
   * Deserialize mob state from saved data.
   * @param {object} data - Serialized mob data
   * @param {number} [seed] - World seed
   * @returns {Mob}
   */
  static deserialize(data, seed) {
    const mob = new Mob(data.mobType, data.position, seed);
    mob.id = data.id;
    mob.spawnPosition = data.spawnPosition || { ...data.position };
    mob.health = data.health || mob.maxHealth;
    mob.yaw = data.yaw || 0;
    mob.aiState = data.aiState || AI_STATES.IDLE;
    mob.isDead = data.isDead || false;
    mob.alive = data.alive !== undefined ? data.alive : !mob.isDead;
    return mob;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Mob };
}