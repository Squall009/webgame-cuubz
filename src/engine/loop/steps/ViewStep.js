/**
 * Cuubz — render-loop step 3: the view (PR 18)
 *
 * `src/main.js:489–519`, verbatim. Camera, sky dome position, shadow camera, the
 * day/night cycle, block interaction and the first-person hand.
 *
 * ─── `camPos` CROSSES INTO `WorldStep` ──────────────────────────────────────
 *
 * It was a `const` in the old single-function loop and `biomeEffects.setCameraPosition`
 * reads it 220 lines later (main.js:717). It is a **declared** field on `GameState` now
 * (decision 23 — never grow the shape by assigning to it), and this step assigns a
 * **fresh** `THREE.Vector3` every frame exactly as the `const` did. Do not turn it into
 * a reused vector with `.set()`: that would hand `WorldStep` an object that other code
 * could mutate underneath it, and it would change the allocation profile of the frame.
 */

import * as THREE from 'three';

/**
 * @param {import('../../../core/GameState.js').GameState} state
 */
export function viewStep(state) {
  // Update camera to follow player at eye level.
  // This MUST happen before blockInteraction.update() so raycasting
  // uses the current frame's camera position/direction, not stale data
  // from the previous frame. Without this, moving while interacting
  // causes the raycast to be misaligned with the crosshair.
  state.camPos = new THREE.Vector3(state.player.position.x, state.player.position.y + 1.6, state.player.position.z);
  state.renderer.updateCamera(state.camPos, state.player.yaw, state.player.pitch);

  // Update sky dome to follow the player (prevents seeing through the skybox)
  state.renderer.updateSkyPosition(state.camPos);

  // Update shadow camera to follow the player
  state.renderer.updateShadowCamera(state.player.position);

  // Update day/night cycle (advances time, updates sky color, sun/moon, fog, clouds)
  if (state.skybox) {
    state.skybox.update(state.game.delta, state.player.position);
  }

  // Update block interaction (break/place/attack)
  // Runs AFTER camera update so raycasting uses the current frame's
  // camera position/direction. This ensures accurate targeting while
  // the player is moving.
  if (state.blockInteraction) {
    state.blockInteraction.update(state.game.delta);
  }

  // Update first-person hand animation
  if (state.firstPersonHand) {
    state.firstPersonHand.update(state.game.delta);
  }
}
