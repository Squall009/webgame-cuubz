/**
 * Cuubz — render-loop step 2: the player (PR 18)
 *
 * `src/main.js:439–485`, verbatim and **in that order**. Physics, then the ~20 Hz
 * `sendMove`, then the touch look deltas, the mobile inventory toggle, the fly
 * indicator and the periodic armour HUD.
 *
 * ─── WHY `sendMove` IS IN HERE AND NOT IN `NetworkStep` ─────────────────────
 *
 * Because it is where the frame put it: between `player.update()` and the touch-look
 * application. Moving it down to the network step would send the *pre-look* rotation
 * one frame late for every touch player. Grouping by subject must not reorder the
 * frame — `NetworkStep` is the block at main.js:577, and only that block.
 */

/**
 * @param {import('../../../core/GameState.js').GameState} state
 * @param {object} inputState — the merged input from `inputStep()`
 */
export function playerStep(state, inputState) {
  // Update player physics with input (pass chunkWorld for collision)
  state.player.update(state.game.delta, inputState, state.chunkWorld);

  // ─── Multiplayer: Send movement updates (~20Hz) ───
  if (state.session && state.session.client && state.session.client.isGameSessionConnected && state.frameCount % 3 === 0) {
    state.session.client.sendMove(
      { x: state.player.position.x, y: state.player.position.y, z: state.player.position.z },
      { yaw: state.player.yaw, pitch: state.player.pitch }
    );
  }

  // Apply touch look deltas to player rotation (swipe right half of screen)
  const look = state.touch.consumeLookDeltas();
  if (look.x !== 0 || look.y !== 0) {
    state.player.yaw -= look.x * state.sensitivity;
    state.player.pitch -= look.y * state.sensitivity;
    // Clamp pitch to avoid flipping at gimbal lock limits
    state.player.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, state.player.pitch));
  }

  // Mobile inventory toggle
  if (state.touch.inventoryToggled) {
    state.toggleInventoryScreen();
  }

  // Update fly mode indicator HUD (creative only)
  const flyIndicator = document.getElementById('fly-mode-indicator');
  if (state.player.flyMode && !state.player.gravityEnabled) {
    if (flyIndicator) flyIndicator.classList.remove('hidden');
  } else {
    if (flyIndicator) flyIndicator.classList.add('hidden');
  }

  // Update HUD armor indicator periodically
  if (state.frameCount % 10 === 0) {
    const armorStats = state.inventory.getEquipmentStats();
    const armorHud = document.getElementById('armor-indicator');
    const hudDefense = document.getElementById('hud-defense');
    if (armorHud && hudDefense) {
      if (armorStats.totalArmor > 0) {
        hudDefense.textContent = armorStats.totalArmor;
        armorHud.classList.remove('hidden');
      } else {
        armorHud.classList.add('hidden');
      }
    }
  }

  // Debug: log player state every 60 frames (disabled — too verbose)
}
