/**
 * Cuubz — Mob Manager
 * Central orchestrator for all mobs in the world.
 * Handles spawning, updating, despawning, and coordinates AI + movement + rendering.
 */

import { updateAI } from './ai/mobAI.js';
import { addDropsToInventory } from './drops/mobDropTable.js';
import { Mob } from './mob.js';
import { AI_STATES, getMobDefinition, selectMobForBiome } from './mobDefinitions.js';
import { applyMovement } from './movement/mobMovement.js';

export class MobManager {
  constructor(options = {}) {
    /** @type {Map<string, Mob>} mobId → Mob */
    this.mobs = new Map();

    /** @type {import('./rendering/mobRenderer.js').MobRenderer|null} */
    this.renderer = null;

    // Configuration
    this.mobCap = options.mobCap || 60;
    this.mobsPerChunk = options.mobsPerChunk || 8;
    this.spawnInterval = options.spawnInterval || 2.0; // Seconds between spawn ticks
    this.spawnTimer = 0;

    // World seed for deterministic behavior
    this.worldSeed = options.worldSeed || 0;

    // Callbacks
    this.onMobDeath = options.onMobDeath || null; // (mob, drops) => void
    this.onMobAttack = options.onMobAttack || null; // (mob, damage) => void

    // Reference to player inventory for auto-loot
    this.playerInventory = null;

    // Track death timers for removal
    this._removeQueue = [];
  }

  /**
   * Set the player inventory reference for auto-loot.
   * @param {Inventory} inventory
   */
  setPlayerInventory(inventory) {
    this.playerInventory = inventory;
  }

  /**
   * Link a MobRenderer for 3D rendering.
   * @param {MobRenderer} renderer
   */
  setRenderer(renderer) {
    this.renderer = renderer;
  }

  /**
   * Main update — called every frame from the game loop.
   * @param {number} deltaTime
   * @param {object} blockAccess - World block access interface
   * @param {{x:number,y:number,z:number}} playerPosition
   * @param {number} renderDistance - In chunks
   * @param {string|undefined} biomeAtPlayer - Current player biome
   */
  update(deltaTime, blockAccess, playerPosition, renderDistance, biomeAtPlayer) {
    // Remove dead mobs whose death animation has finished
    this._processRemovals(deltaTime);

    // Run spawn tick on cooldown
    this.spawnTimer += deltaTime;
    if (this.spawnTimer >= this.spawnInterval) {
      this.spawnTimer = 0;
      this._spawnTick(blockAccess, playerPosition, renderDistance, biomeAtPlayer);
    }

    // Update all mobs
    for (const [id, mob] of this.mobs) {
      // Get player position for this mob's updates
      const playerPos = playerPosition || null;

      // Run AI state machine
      if (mob.definition && !mob.isDead) {
        // AI update
        updateAI(mob, deltaTime, blockAccess, playerPos, Array.from(this.mobs.values()), applyMovement);

        // Handle attack state — deal damage to player
        if (mob.aiState === AI_STATES.ATTACK && mob.animationTimer >= (mob.definition.animations.attack ? mob.definition.animations.attack.duration * 0.5 : 0.15)) {
          // Only deal damage once per attack (at the midpoint of the animation)
          if (!mob._attackDamageDealt) {
            mob._attackDamageDealt = true;
            if (this.onMobAttack) {
              this.onMobAttack(mob, mob.definition.damage || 0);
            }
          }
        } else if (mob.aiState !== AI_STATES.ATTACK) {
          mob._attackDamageDealt = false;
        }

        // Movement is now handled inside updateAI via applyMovement
      }

      // Update base mob state (cooldowns, timers)
      mob.update(deltaTime, blockAccess, playerPos, Array.from(this.mobs.values()));

      // Check despawn
      if (!mob.isDead && playerPos) {
        const dist = mob.distanceTo(playerPos);
        if (dist > mob.definition.despawnDistance) {
          this._removeMob(id);
          continue;
        }
      }
    }

    // Update renderer
    if (this.renderer) {
      this.renderer.update(deltaTime);
    }
  }

  /**
   * Spawn tick — checks loaded chunks and spawns new mobs.
   */
  _spawnTick(blockAccess, playerPosition, renderDistance, getBiomeFn) {
    if (!blockAccess || !playerPosition) return;

    const currentCount = this.mobs.size;
    if (currentCount >= this.mobCap) return;

    // Try to spawn mobs in chunks around the player
    const chunkRadius = Math.min(renderDistance || 6, 6);
    const px = Math.floor(playerPosition.x / 16);
    const pz = Math.floor(playerPosition.z / 16);

    // Pick a few random chunks each tick (spread across the area)
    const allChunks = [];
    for (let cx = px - chunkRadius; cx <= px + chunkRadius; cx++) {
      for (let cz = pz - chunkRadius; cz <= pz + chunkRadius; cz++) {
        allChunks.push({ cx, cz });
      }
    }

    // Shuffle to spread spawns evenly across the area
    for (let i = allChunks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allChunks[i], allChunks[j]] = [allChunks[j], allChunks[i]];
    }

    // Check up to 20 chunks per tick (spread, not clustered)
    const maxChecks = Math.min(20, allChunks.length);

    for (let i = 0; i < maxChecks && this.mobs.size < this.mobCap; i++) {
      const { cx, cz } = allChunks[i];

      // Check mob density in this chunk
      const countInChunk = this._countMobsInChunk(cx, cz);
      if (countInChunk >= this.mobsPerChunk) continue;

      // Determine biome at this chunk's center
      let spawnBiome = 'plains';
      if (getBiomeFn) {
        try {
          const biomeResult = getBiomeFn(cx * 16 + 8, cz * 16 + 8);
          if (biomeResult) spawnBiome = biomeResult;
        } catch(e) { /* ignore biome errors */ }
      }

      // Select a mob type for this chunk's biome
      const mobType = selectMobForBiome(spawnBiome);
      if (!mobType) continue;

      const def = getMobDefinition(mobType);
      if (!def) continue;

      // Find a valid spawn position
      const spawnPos = this._findSpawnPosition(cx, cz, def, blockAccess);
      if (!spawnPos) continue;

      // Spawn the mob
      const mob = new Mob(mobType, spawnPos, this.worldSeed);
      this.mobs.set(mob.id, mob);

      // Notify renderer
      if (this.renderer) {
        this.renderer.addMob(mob);
      }
    }
  }

  /**
   * Count active mobs within a chunk.
   */
  _countMobsInChunk(cx, cz) {
    let count = 0;
    const chunkMinX = cx * 16;
    const chunkMinZ = cz * 16;
    const chunkMaxX = chunkMinX + 16;
    const chunkMaxZ = chunkMinZ + 16;

    for (const [, mob] of this.mobs) {
      if (mob.position.x >= chunkMinX && mob.position.x < chunkMaxX &&
          mob.position.z >= chunkMinZ && mob.position.z < chunkMaxZ) {
        count++;
      }
    }
    return count;
  }

  /**
   * Find a valid spawn position for a mob within / near a chunk.
   */
  _findSpawnPosition(cx, cz, def, blockAccess) {
    const halfWidth = Math.ceil(def.hitbox.width / 2);

    for (let attempt = 0; attempt < 5; attempt++) {
      const x = (cx * 16) + 4 + Math.random() * 8;
      const z = (cz * 16) + 4 + Math.random() * 8;
      const minY = def.spawnMinY || 0;
      const maxY = def.spawnMaxY || 80;

      // Find surface Y by scanning down
      let y = maxY;
      while (y > minY) {
        const block = blockAccess.getBlockAtWorld ? blockAccess.getBlockAtWorld(Math.floor(x), y, Math.floor(z)) : 0;
        if (block !== 0 && block !== 12 && block !== 7 && block !== 15) {
          // Found ground
          y += 1; // Stand on top
          break;
        }
        y--;
      }

      if (y <= minY) continue;

      // Check for flying mobs
      if (def.flying) {
        y += 2 + Math.random() * 4; // Hover above ground
      }

      // Verify head space
      const headBlock = blockAccess.getBlockAtWorld ? blockAccess.getBlockAtWorld(Math.floor(x), Math.floor(y + def.hitbox.height), Math.floor(z)) : 0;
      if (headBlock !== 0 && headBlock !== 12) continue;

      // Verify no existing mob nearby
      let nearbyMob = false;
      for (const [, other] of this.mobs) {
        const dx = other.position.x - x;
        const dz = other.position.z - z;
        if (dx * dx + dz * dz < 25) { // Within 5 blocks
          nearbyMob = true;
          break;
        }
      }
      if (nearbyMob) continue;

      return { x, y, z };
    }

    return null;
  }

  /**
   * Process the removal queue — removes mobs after their death animation finishes.
   */
  /**
   * Raycast against all alive mobs and return the closest hit.
   * @param {{x:number,y:number,z:number}} origin - Ray origin (camera position)
   * @param {{x:number,y:number,z:number}} direction - Normalized ray direction
   * @param {number} maxDist - Maximum ray distance
   * @returns {{mob:Mob, distance:number, point:object}|null}
   */
  raycastMobs(origin, direction, maxDist) {
    let closest = null;
    let closestDist = maxDist;

    for (const [, mob] of this.mobs) {
      if (mob.isDead) continue;

      const hw = (mob.definition.hitbox.width || 0.8) / 2;
      const hh = mob.definition.hitbox.height || 0.9;

      // AABB
      const min = { x: mob.position.x - hw, y: mob.position.y, z: mob.position.z - hw };
      const max = { x: mob.position.x + hw, y: mob.position.y + hh, z: mob.position.z + hw };

      let tmin = -Infinity, tmax = Infinity;

      if (direction.x !== 0) {
        const t1 = (min.x - origin.x) / direction.x;
        const t2 = (max.x - origin.x) / direction.x;
        tmin = Math.max(tmin, Math.min(t1, t2));
        tmax = Math.min(tmax, Math.max(t1, t2));
      } else if (origin.x < min.x || origin.x > max.x) continue;

      if (direction.y !== 0) {
        const t1 = (min.y - origin.y) / direction.y;
        const t2 = (max.y - origin.y) / direction.y;
        tmin = Math.max(tmin, Math.min(t1, t2));
        tmax = Math.min(tmax, Math.max(t1, t2));
      } else if (origin.y < min.y || origin.y > max.y) continue;

      if (direction.z !== 0) {
        const t1 = (min.z - origin.z) / direction.z;
        const t2 = (max.z - origin.z) / direction.z;
        tmin = Math.max(tmin, Math.min(t1, t2));
        tmax = Math.min(tmax, Math.max(t1, t2));
      } else if (origin.z < min.z || origin.z > max.z) continue;

      if (tmin > tmax || tmax < 0) continue;
      const dist = tmin < 0 ? tmax : tmin;

      if (dist < closestDist && dist > 0) {
        closestDist = dist;
        closest = { mob, distance: dist, point: { x: origin.x + direction.x * dist, y: origin.y + direction.y * dist, z: origin.z + direction.z * dist } };
      }
    }

    return closest;
  }

  /**
   * Process the removal queue — removes mobs after their death animation finishes.
   */
  _processRemovals(deltaTime) {
    const toRemove = [];
    for (const [id, mob] of this.mobs) {
      if (mob.isDead) {
        const deathDuration = mob.getDeathDuration();
        if (mob.deathTimer > deathDuration) {
          toRemove.push(id);
        }
      }
    }
    for (const id of toRemove) {
      this._removeMob(id);
    }
  }

  /**
   * Remove a mob from the world.
   */
  _removeMob(id) {
    const mob = this.mobs.get(id);
    if (!mob) return;

    // Handle drops if the mob died
    if (mob.isDead && mob.deathTimer > 0) {
      const drops = mob.getDropItems();
      if (drops.length > 0 && this.onMobDeath) {
        this.onMobDeath(mob, drops);
      }
      // Auto-loot to inventory
      if (drops.length > 0 && this.playerInventory) {
        addDropsToInventory(drops, this.playerInventory);
      }
    }

    // Remove from renderer
    if (this.renderer) {
      this.renderer.removeMob(id);
    }

    this.mobs.delete(id);
  }

  /**
   * Manually spawn a mob at a specific position.
   * @param {string} mobType
   * @param {{x:number,y:number,z:number}} position
   * @returns {Mob|null}
   */
  spawnMobAt(mobType, position) {
    const def = getMobDefinition(mobType);
    if (!def) return null;

    const mob = new Mob(mobType, position, this.worldSeed);
    this.mobs.set(mob.id, mob);

    if (this.renderer) {
      this.renderer.addMob(mob);
    }

    return mob;
  }

  /**
   * Get a mob by ID.
   * @param {string} id
   * @returns {Mob|null}
   */
  getMob(id) {
    return this.mobs.get(id) || null;
  }

  /**
   * Get all mobs as an array.
   * @returns {Mob[]}
   */
  getAllMobs() {
    return Array.from(this.mobs.values());
  }

  /**
   * Get all alive mobs.
   * @returns {Mob[]}
   */
  getAliveMobs() {
    return Array.from(this.mobs.values()).filter(m => !m.isDead);
  }

  /**
   * Get mobs within a radius of a position.
   * @param {{x:number,y:number,z:number}} position
   * @param {number} radius
   * @returns {Mob[]}
   */
  getMobsInRadius(position, radius) {
    const result = [];
    const rSq = radius * radius;
    for (const [, mob] of this.mobs) {
      const dx = mob.position.x - position.x;
      const dz = mob.position.z - position.z;
      if (dx * dx + dz * dz <= rSq) {
        result.push(mob);
      }
    }
    return result;
  }

  /**
   * Clear all mobs (on world unload).
   */
  clear() {
    if (this.renderer) {
      this.renderer.clear();
    }
    this.mobs.clear();
  }

  /**
   * Get debug stats.
   * @returns {object}
   */
  getStats() {
    const typeCounts = {};
    let alive = 0;
    let dead = 0;

    for (const [, mob] of this.mobs) {
      typeCounts[mob.mobType] = (typeCounts[mob.mobType] || 0) + 1;
      if (mob.isDead) dead++;
      else alive++;
    }

    return {
      total: this.mobs.size,
      alive,
      dead,
      cap: this.mobCap,
      types: typeCounts,
    };
  }
}
