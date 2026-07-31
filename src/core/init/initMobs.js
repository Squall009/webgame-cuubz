/**
 * Cuubz — `Game.init()` steps 9 and 10 (PR 17)
 *
 * The mob system, the initial camera placement and the first-person hand.
 *
 * **The mob system is constructed before the inventory exists and is handed it in step
 * 13.** The `inventory: null` in its deps is that, not an oversight — `refactor.md` §8.4
 * and `BUGS.md` **D-36**. A PR that "corrects" the order breaks auto-loot with no failing
 * test.
 */

import * as THREE from 'three';
import { MobIntegration } from '../../game/mobs/mobIntegration.js';
import { FirstPersonHand } from '../../engine/renderer/FirstPersonHand.js';

/**
 * @param {import('../Game.js').Game} game
 */
export function initMobs(game) {
  const state = game.state;
  const log = game.deps.log;
  const renderer = state.renderer;
  const player = state.player;

  // ══ Step 9 — mob system ═══════════════════════════════════════════════════════════════

  // ─── Initialize Mob System (stub — inventory + survival set after their init) ──
  try {
    const mobIntegration = state.mobIntegration = new MobIntegration();
    const mobDeps = {
      scene: renderer.scene,
      camera: renderer.camera,
      player: player,
      inventory: null, // Set after Inventory constructor below
      survivalSystem: null, // Not wired yet
      worldSeed: state.currentWorld.seed,
      onMobDeath: (mob, drops) => {
        log(`[Cuubz] Mob died: ${mob.mobType}, drops:`, drops);
      },
    };
    mobIntegration.init(mobDeps);
    log('[Cuubz] Mob system initialized');
  } catch (e) {
    console.warn('[Cuubz] Failed to init mob system:', e.message);
  }

  // Set up camera at player eye level — looking slightly downward to see terrain
  const initCamPos = new THREE.Vector3(player.position.x, player.position.y + 1.6, player.position.z);
  renderer.updateCamera(initCamPos, 0, -Math.PI / 8);

  // ══ Step 10 — first-person hand ═══════════════════════════════════════════════════════

  // ─── Initialize First-Person Hand ──────────────
  // D-27: was wrapped in `if (typeof FirstPersonHand !== 'undefined')`, whose `null`
  // fall-through was unreachable — `FirstPersonHand` is a module import.
  state.firstPersonHand = new FirstPersonHand(renderer.camera, { itemAtlas: state.itemAtlas });
}
