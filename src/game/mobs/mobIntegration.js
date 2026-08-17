/**
 * Cuubz — Mob System Integration
 * Handles initialization of the mob system and provides the update hook
 * for the main game loop. This is the single file that gets wired into main.js.
 */

import { MobManager } from './mobManager.js';
import { MobRenderer } from './rendering/mobRenderer.js';
// PR 9 moved this table to `game/data/DamageSources.js` to break a real circular
// dependency (D-26) and left `SurvivalSystem.js` re-exporting it so no import site had to
// change. That re-export was this file's only edge into SurvivalSystem.js, and it is the
// reason `src/index.js` used to call that module "reached". PR 34 deleted SurvivalSystem.js,
// so the import now points at the table's actual home. The table itself is unchanged.

export class MobIntegration {
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
   * @param {?object} deps.survivalSystem - Player survival system. There is no such class
   *   in `src/` — PR 34 deleted `SurvivalSystem.js` as never-constructed — and
   *   `core/init/initMobs.js:35` passes `null`. The `if (survivalSystem)` branch below is
   *   the wiring point a future survival PR fills in; it is not dead code pretending to be
   *   wired, because the callback it installs is only registered when one is supplied.
   * @param {number} deps.worldSeed - World seed
   * @param {function} deps.onMobDeath - Callback when mob dies
   * @returns {MobManager}
   */
  init(deps) {
    if (this.initialized) return this.mobManager;

    const { scene, player, inventory, survivalSystem, worldSeed, onMobDeath } = deps;

    // Create MobManager
    // D-110: was 60 / 8 with no hostile budget. These now restate `MobManager`'s own
    // defaults rather than overriding them — kept explicit because this is the file a
    // future tuning pass will look in, and a silent default is worse than a duplicated
    // number when the question is "why does this world feel crowded".
    this.mobManager = new MobManager({
      worldSeed: worldSeed || 0,
      mobCap: 28,
      mobsPerChunk: 3,
      hostileCap: 12,
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

    // ─── Mob attack → player damage ───────────────────────────────────────
    //
    // This was an `if (survivalSystem) { … }` block that installed `onMobAttack` with
    // its own armour-reduction arithmetic. It had been **unreachable since PR 34
    // deleted `SurvivalSystem`**: `initMobs.js` passed `survivalSystem: null` and
    // nothing else ever supplied one, so mobs could not damage the player at all (§2.2).
    //
    // S3 gives the callback a real receiver, and installs it from
    // `src/core/init/initVitals.js` instead of here — because the armour reduction has
    // to be the *same* reduction lava and a boss's slam use, and duplicating the
    // formula in two files is how one of them silently becomes wrong. It lives in
    // `PlayerVitals.applyArmor` now, and this class no longer knows what a hit point is.
    //
    // `survivalSystem` stays in the deps signature and stays unused: `initMobs.js`
    // still passes it, and removing the parameter is a rename with no behaviour and
    // three call sites.
    void survivalSystem;

    // Create MobRenderer.
    //
    // D-77: this test used to read `typeof THREE !== 'undefined' && scene`. `THREE` is
    // not a binding in this module and there is no global one, so `typeof THREE` was
    // permanently `'undefined'` and the whole branch was dead — `setRenderer()` was never
    // called and no mob has been drawn since PR 9. `no-undef` cannot see it: `typeof` is
    // the one operand ESLint exempts from the undefined-variable check, which is why 17
    // green lint runs went past it. The fix is to delete the condition, NOT to import
    // THREE — importing it would only flip the same dead guard to constant-true.
    // `scene` was always the real precondition; it is the whole test now.
    if (scene) {
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
