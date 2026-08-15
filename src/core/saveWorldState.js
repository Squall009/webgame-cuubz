/**
 * Cuubz — persist the world's quest state (S0)
 *
 * The sibling to `savePlayerState.js`, and deliberately **not** part of it.
 *
 * ─── WHY IT IS NOT FOLDED INTO `savePlayerState` ────────────────────────────
 *
 * That function's contract is *"the selected character"* — its inventory, its equipment,
 * its spawn point, written through `persistence.saveCharacter()`. Quest state is the
 * **world's**, shared by everyone in it, and in a session it is the host's world that
 * advances (§5.2). Two different objects, two different storage keys, two different
 * owners. Folding them together would mean a guest's character save writing the host's
 * quest progress into the guest's own world slot, which is precisely the accumulation
 * §5.2 says a guest's device must not do.
 *
 * ─── WHY IT HAS TO EXIST AT ALL ─────────────────────────────────────────────
 *
 * The world config is written by `createWorld`, `updateWorld` and `selectWorld`
 * (`WorldManager.js`) and by **nothing during play**. Before this file, a quest completed
 * at minute 40 of a session survived only if the player happened to go back to the world
 * screen afterwards; a crash, a tab close or a power cut lost the lot. `savePlayerState`
 * has run on a 30 s interval since PR 17 and quest state had no equivalent.
 *
 * So: the same three call sites as `savePlayerState` — the 30 s interval, the Escape
 * handler, and `Game.stop()` (`DEPLOY.md` §7) — plus `saveWorldStateNow()` for the three
 * events that are expensive to lose (a quest completed, a seal changed, a boss defeated).
 * Those are rare enough that an immediate write costs nothing, and each of them is a
 * thing a player would quit over losing.
 *
 * ─── A GUEST WRITES NOTHING ─────────────────────────────────────────────────
 *
 * `SessionRejoin`, `AutoRejoin` and `LobbyScreen` build a *temporary* world object and
 * push it onto `worldManager.worlds` without going through `createWorld`, so it has no
 * slot and is never persisted. This function checks for that and returns early rather
 * than relying on the storage layer to refuse — a guest holds a view of the host's quest
 * state (§5.2), and writing it to their own device would leave a half-finished copy of
 * someone else's world behind.
 */

import { CuubzLogger } from '../util/Logger.js';
import { serializeQuestState } from '../game/data/QuestState.js';

const _gameLog = CuubzLogger.log;

/** Temporary guest worlds are pushed onto `worldManager.worlds` with this id prefix. */
const TEMP_WORLD_PREFIX = 'temp_';

/**
 * Is this world one a guest fabricated for a session it joined?
 * @param {object|null} world
 */
export function isTemporaryWorld(world) {
  return !!(world && typeof world.id === 'string' && world.id.startsWith(TEMP_WORLD_PREFIX));
}

/**
 * Persist the current world's quest state.
 *
 * Mirrors `savePlayerState(state, deps)` exactly in signature and in tolerance: every
 * failure path is a silent early return, because this runs on a timer and a warning per
 * tick would be worse than the missed write.
 *
 * @param {import('./GameState.js').GameState} state
 * @param {object} deps — the `gameDeps` object; `worldManager` and `log` are read.
 *   Passed **by reference and never spread** — it is `Object.create(uiDeps, …)`, so
 *   `worldManager` is a live getter on the prototype and a spread would drop it (D-49).
 */
export function saveWorldState(state, deps) {
  const world = state.currentWorld;
  if (!world) return;

  // A guest's view is not saved anywhere. §5.2.
  if (isTemporaryWorld(world)) return;

  // In a session the host's authoritative state is the truth; `state.questSystem` holds
  // a reference to the same object on the host, and to the host's last broadcast on a
  // guest — which the guard above has already excluded.
  const questState = state.questSystem ? state.questSystem.getState() : world.questState;
  if (!questState) return;

  world.questState = questState;

  if (!state.persistence) return;
  try {
    // Serialized here rather than inside the storage layer so the size the budget
    // applies to is the size that actually goes to `localStorage`.
    state.persistence.saveWorld({ ...world, questState: serializeQuestState(questState) });
  } catch (err) {
    console.warn('[Cuubz] saveWorldState failed:', err && err.message);
    return;
  }
  (deps.log || _gameLog)('[Cuubz] Saved world state');
}

/**
 * Save immediately, for the three events §5.1 names as expensive to lose: a quest
 * completed, a seal state changed, a boss defeated.
 *
 * Identical to `saveWorldState` today — it exists as its own name so the call sites read
 * as what they are, and so that a future debounce can be added here without touching the
 * six places that ask for it.
 */
export function saveWorldStateNow(state, deps) {
  saveWorldState(state, deps);
}
