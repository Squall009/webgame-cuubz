/**
 * Cuubz — render-loop step 7: quests, hazards and bosses (S1)
 *
 * A step of its own rather than four more lines at the bottom of `WorldStep`.
 * `WorldStep` is the world and the draw, and its header is explicit that the draw sits
 * in its *middle* deliberately — appending gameplay ticks after `renderer.render()`
 * would put quest evaluation and hazard damage on the far side of the present, one frame
 * behind everything that reads them.
 *
 * ─── IT RUNS LAST, AND THAT IS THE POINT ────────────────────────────────────
 *
 * Everything here reads state the earlier steps produced: the tracker polls an inventory
 * that block-breaking may have filled this frame, the hazard system reads the block under
 * a player that physics has already moved, and the boss encounter reads hits that
 * `CombatStep` registered. Running it before any of those would make every reading one
 * frame stale — invisible in a HUD counter, and not invisible at all in a lava pool.
 *
 * Every system here is optional and null-guarded: S1 ships the tracker, S3 adds vitals,
 * S4 adds hazards and S6 adds the encounter, and each stage leaves the tree green.
 */

import { reportStepError } from '../reportStepError.js';

/**
 * @param {import('../../../core/GameState.js').GameState} state
 */
export function questStep(state) {
  // ─── Quest objective polling (~2 Hz) ───────────────────────
  // The tracker owns its own throttle so the interval is defined next to the reason for
  // it, rather than as a `% 30` in this file that nothing explains.
  if (state.questTracker) {
    try {
      state.questTracker.tick(state.frameCount, state.player ? state.player.position : null);
    } catch (e) {
      reportStepError(state, 'Quest tracker', e);
    }
  }

  // ─── Environmental damage (S4) ─────────────────────────────
  if (state.hazardSystem) {
    try {
      state.hazardSystem.update(state.game.delta);
    } catch (e) {
      reportStepError(state, 'Hazard system', e);
    }
  }

  // ─── Vitals: regeneration, death, the health meter (S3) ────
  if (state.playerVitals) {
    try {
      state.playerVitals.update(state.game.delta);
    } catch (e) {
      reportStepError(state, 'Vitals', e);
    }
  }

  // ─── Eating (S10) ──────────────────────────────────────────
  // Only the cooldown ticks here; the bite itself is driven by right-click through
  // `BlockInteraction.onUseItem`. After vitals so a bite taken this frame is already in
  // the health the meter drew.
  if (state.eatingSystem) {
    try {
      state.eatingSystem.update(state.game.delta);
    } catch (e) {
      reportStepError(state, 'Eating system', e);
    }
  }

  // ─── Seal proximity, altar interaction, and the HUD marker (S5) ──
  if (state.sealSystem) {
    try {
      const position = state.player ? state.player.position : null;
      state.sealSystem.update(state.game.delta, position);

      // The marker is repainted on the tracker's own cadence, not every frame: the HUD
      // writer fingerprints what it drew and drops an identical redraw, and the
      // fingerprint rounds distance to 8 m so walking does not rebuild the panel
      // sixty times a second.
      if (state.questTrackerHUD && state.questSystem && state.frameCount % 15 === 0) {
        state.questTrackerHUD.render(
          state.questSystem.getTrackerView(),
          state.sealSystem.getMarker(position)
        );
      }
    } catch (e) {
      reportStepError(state, 'Seal system', e);
    }
  }

  // ─── Boss encounter, host-side (S6) ────────────────────────
  if (state.bossEncounter) {
    try {
      state.bossEncounter.update(state.game.delta);
    } catch (e) {
      reportStepError(state, 'Boss encounter', e);
    }
  }

  // ─── Boss interpolation, client-side (S6) ──────────────────
  if (state.bossSync) {
    try {
      state.bossSync.update(state.game.delta);
    } catch (e) {
      reportStepError(state, 'Boss sync', e);
    }
  }
}
