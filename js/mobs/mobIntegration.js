/**
 * Cuubz — Mob System Integration
 * Handles initialization of the mob system and provides the update hook
 * for the main game loop. This is the single file that gets wired into main.js.
 */

class MobIntegration {
  constructor() {
    this.mobManager = null;
    this.mobRenderer = null;
    this.initialized = false;
  }

  /**
   * Initialize the mob system with all dependencies.
   * Call this after the world, renderer, and player are ready.
   * @param {object} deps
   * @param {THREE.Scene} deps.scene - Three.js scene
   * @param {object} deps.player - Player instance (for inventory reference)
   * @param {Inventory} deps.inventory - Player inventory
   * @param {SurvivalSystem} deps.survivalSystem - Player survival system
   * @param {number} deps.worldSeed - World seed
   * @param {function} deps.onMobDeath - Callback when mob dies
   * @returns {MobManager}
   */
  init(deps) {
    if (this.initialized) return this.mobManager;

    const { scene, player, inventory, survivalSystem, worldSeed, onMobDeath } = deps;

    // Create MobManager
    this.mobManager = new MobManager({
      worldSeed: worldSeed || 0,
      mobCap: 60,
      mobsPerChunk: 8,
      spawnInterval: 2.0,
    });

    // Set player inventory reference for auto-loot
    if (inventory) {
      this.mobManager.setPlayerInventory(inventory);
    }

    // Wire death callback
    this.mobManager.onMobDeath = (mob, drops) => {
      if (onMobDeath) onMobDeath(mob, drops);
    };

    // Wire mob attack callback — deal damage to player
    if (survivalSystem) {
      this.mobManager.onMobAttack = (mob, damage) => {
        if (survivalSystem && !survivalSystem.isDead) {
          // Apply armor reduction
          let actualDamage = damage;
          const inventory = deps.inventory;
          if (inventory && typeof inventory.getEquipmentStats === 'function') {
            const stats = inventory.getEquipmentStats();
            const armorValue = stats.totalArmor || 0;
            const reduction = Math.min(0.8, armorValue / 30);
            actualDamage = Math.floor(damage * (1 - reduction));
          }
          survivalSystem.takeDamage(actualDamage, DAMAGE_SOURCES.MOB);
        }
      };
    }

    // Create MobRenderer
    if (typeof THREE !== 'undefined' && scene) {
      this.mobRenderer = new MobRenderer(scene, this.mobManager);
      if (deps.camera) {
        this.mobRenderer.setCamera(deps.camera);
      }
      this.mobManager.setRenderer(this.mobRenderer);
    }

    this.initialized = true;
    console.log('[MobIntegration] Mob system initialized');
    return this.mobManager;
  }

  /**
   * Update the mob system — called every frame from the render loop.
   * @param {number} deltaTime
   * @param {object} blockAccess - World block access interface
   * @param {{x:number,y:number,z:number}} playerPosition
   * @param {number} renderDistance - In chunks
   * @param {function} getBiomeFn - (wx, wz) => biomeName string
   */
  update(deltaTime, blockAccess, playerPosition, renderDistance, getBiomeFn) {
    if (!this.initialized || !this.mobManager) return;
    this.mobManager.update(deltaTime, blockAccess, playerPosition, renderDistance || 6, getBiomeFn);
  }

  /**
   * Get the MobManager instance.
   * @returns {MobManager|null}
   */
  getManager() {
    return this.mobManager;
  }

  /**
   * Get the MobRenderer instance.
   * @returns {MobRenderer|null}
   */
  getRenderer() {
    return this.mobRenderer;
  }

  /**
   * Clean up on world unload.
   */
  destroy() {
    if (this.mobManager) {
      this.mobManager.clear();
    }
    this.mobManager = null;
    this.mobRenderer = null;
    this.initialized = false;
  }
}

// Global singleton for browser context
if (typeof window !== 'undefined') {
  window.MobIntegration = MobIntegration;
}