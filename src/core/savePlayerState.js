/**
 * Cuubz — persist the selected character's session state (PR 18)
 *
 * `Game.savePlayerState()`, split out of `src/core/Game.js` for the §8.2 400-line ceiling.
 * **Decision 33 applied a third time**: `Game.js` stood at exactly 400 after PR 17, and
 * PR 18's `stop()` guard — the one that keeps a failed save from carrying the **D-50**
 * teardown and the **D-54** `clearInterval` away with it — pushed it to 410. The ceiling
 * wins and the cut is a seam: this function reads `deps.characterManager` and writes
 * `state.persistence`, and touches nothing else on the class.
 *
 * It stays a plain function taking `(state, deps)` rather than becoming a method on
 * anything, because `Game.savePlayerState()` has three callers with three different
 * reasons — the 30 s interval, the Escape handler, and `stop()` (`DEPLOY.md` §7) — and a
 * class would only be a namespace for one of them. `Game` keeps a one-line delegate so
 * every existing call site is unchanged.
 *
 * `deps` arrives **by reference and is never spread** — it is `Object.create(uiDeps, …)`,
 * so `characterManager` is a live getter on the prototype and a spread would drop it.
 */

import { CuubzLogger } from '../util/Logger.js';

/** Same fallback `Game.js` uses — `CuubzLogger.log` is gated on `DEBUG`. */
const _gameLog = typeof CuubzLogger !== 'undefined' ? CuubzLogger.log : function() {};

/**
 * Persist the selected character's inventory, equipment and spawn point.
 *
 * Re-reads the selected character rather than using `state.currentCharacter`, exactly as
 * the `startGame` closure did.
 *
 * @param {import('./GameState.js').GameState} state
 * @param {object} deps — the `gameDeps` object; `characterManager` and `log` are read.
 */
export function savePlayerState(state, deps) {
  const selected = deps.characterManager ? deps.characterManager.getSelectedCharacter() : null;
  if (!selected) return;

  // Save inventory
  const serialized = state.inventory.serialize();
  selected.inventory = serialized.slots;
  selected.equipment = serialized.equipment;

  // Save spawn point
  selected.spawnPoints = selected.spawnPoints || {};
  selected.spawnPoints[state.currentWorld.id] = {
    x: state.player.position.x,
    y: state.player.position.y,
    z: state.player.position.z,
  };

  // D-37: was `characterManager.persistence.saveCharacter(...)`. `state.persistence` is
  // the same object and is set at step 8; reading it here is what keeps that field honest.
  if (!state.persistence) return;
  state.persistence.saveCharacter(selected);
  (deps.log || _gameLog)('[Cuubz] Saved player state');
}
