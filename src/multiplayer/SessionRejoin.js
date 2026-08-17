import { createSessionManager } from './SessionManager.js';
import { attachHostManager } from './SessionHosting.js';
import { readLastSession } from '../util/StorageHelper.js';
import { createQuestState } from '../game/data/QuestState.js';

/**
 * Cuubz — the rejoin panel and the manual rejoin (PR 16, refactor.md §8.3)
 *
 * Split out of `SessionManager.js` to keep that file under the 400-line ceiling §8.2 and
 * §8.6 set. The dependency runs one way — this file imports `createSessionManager`, and
 * `SessionManager.js` imports nothing from here; it reaches the panel through
 * `deps.updateRejoinPanel()`, which `main.js` already exposed on the bridge. That is
 * deliberate: `BUGS.md` D-26 is what an import cycle costs under real ES modules, and the
 * obvious `SessionRejoin ↔ SessionManager` pair would have been one.
 *
 * The **automatic** rejoin — the block at the end of `init()` that probes the relay's
 * `/sessions` endpoint before showing the main menu — is deliberately still in `main.js`.
 * `refactor.md` §8.6 gives it to PR 19 along with the bootstrap, and it is entangled with
 * the loading screen and `showScreen`.
 */

/**
 * Show or hide `#rejoin-panel` according to whether there is a session worth offering.
 */
export function updateRejoinPanel() {
  const panel = document.getElementById('rejoin-panel');
  const nameEl = document.getElementById('rejoin-session-name');
  if (!panel) return;

  const session = readLastSession();
  if (session) {
    panel.classList.remove('hidden');
    if (nameEl) {
      // Reads `mode` straight out of the record, which is exactly why D-43 was
      // player-visible: this line rendered "joined, survival" for a creative session.
      nameEl.textContent = `${session.name} (${session.isHost ? 'hosting' : 'joined'}, ${session.mode})`;
    }
  } else {
    panel.classList.add('hidden');
  }
}

/**
 * Rejoin the last session, from the `#btn-rejoin-session` button.
 *
 * @param {Object} deps — `main.js`'s `uiDeps`.
 * @param {function(SessionManager):void} adoptSessionManager — called with the manager
 *   this function creates when there was none, so `main.js` can assign it to its own
 *   `let sessionManager` binding. That binding stays in `main.js` until PR 17 makes it a
 *   field on `Game`; ~45 reads inside `startGame()` name it directly and this PR leaves
 *   every one of them untouched.
 */
export async function rejoinSession(deps, adoptSessionManager) {
  const session = readLastSession();
  if (!session) return;

  const characterManager = deps.characterManager;
  const worldManager = deps.worldManager;

  // Ensure a character is selected (use the first available if none).
  const characters = characterManager ? characterManager.getAllCharacters() : [];
  if (characters.length > 0) {
    await characterManager.selectCharacter(characters[0].id);
  }

  // Ensure a world is selected.
  if (session.isHost && session.seed) {
    // Re-hosting: find or fall back to a world carrying the session's seed.
    const worlds = worldManager ? worldManager.getAllWorlds() : [];
    const existingWorld = worlds.find(w => w.seed === session.seed);
    if (existingWorld) {
      await worldManager.selectWorld(existingWorld.id);
    } else if (worlds.length > 0) {
      await worldManager.selectWorld(worlds[0].id);
    }
  } else if (!session.isHost && session.seed) {
    // Re-joining: stand up a temp world carrying the session's seed, exactly as
    // `LobbyScreen._joinSession` does on a fresh join. Pushed straight onto `worlds`
    // rather than created, so it is never persisted and consumes no world slot.
    //
    // **This branch was unreachable for a joiner before PR 16.** The `beforeunload`
    // handler that won wrote no `seed` for a joiner at all, so `session.seed` was
    // undefined and the rejoin fell through to selecting the player's own first world —
    // different seed, different terrain. One writer with one shape is what fixed it.
    const tempWorld = {
      id: `temp_${session.sessionId}`,
      name: session.name || 'Remote World',
      seed: session.seed,
      biomeMap: { dominantBiomes: ['Plains'], seed: session.seed },
      questState: createQuestState(),
      chunkReferences: [],
    };
    worldManager.worlds.push(tempWorld);
    worldManager.selectedId = tempWorld.id;
  } else if (worldManager && worldManager.getAllWorlds().length > 0) {
    await worldManager.selectWorld(worldManager.getAllWorlds()[0].id);
  }

  let sessionManager = deps.sessionManager;
  if (!sessionManager) {
    sessionManager = createSessionManager(deps);
    adoptSessionManager(sessionManager);
  }

  // Carry the stored session's identity into the manager, so that if the page is closed
  // again before HOST_CREATED / JOIN_ACCEPTED arrives, the record rewritten on unload says
  // the same thing this one did rather than reverting to the 'survival' default.
  sessionManager._gameMode = session.mode || 'survival';
  sessionManager._sessionName = session.name || null;
  sessionManager._sessionSeed = session.seed !== undefined ? session.seed : null;

  sessionManager.updateConnectionStatus('connecting');

  if (session.isHost && sessionManager.client) {
    try {
      // Reclaim the stored session rather than creating a same-named twin beside it —
      // see `AutoRejoin.js`'s copy of this branch and `SessionManager.reclaimHostedSession`
      // for why `HOST` is the wrong verb here. D-109. Unlike the automatic path this one
      // has *not* probed `/sessions` first, so the reclaim may find nothing; a `JOIN` for
      // a session the relay has collected comes back as `JOIN_REJECTED` and the lobby's
      // error banner reports it, which is the same failure report this button already had.
      const reclaimed = await sessionManager.reclaimHostedSession(
        session.sessionId, session, session.playerId
      );
      if (reclaimed) {
        attachHostManager(sessionManager);
        deps.log(`[Cuubz] Reclaimed hosted session: ${session.sessionId}`);
      } else {
        await sessionManager.client.hostSession({
          name: session.name,
          seed: session.seed || Math.floor(Math.random() * 0xFFFFFFFF),
          mode: session.mode,
        });
        deps.log(`[Cuubz] Re-hosting session (no stored player id): ${session.name}`);
      }
    } catch (err) {
      sessionManager.updateConnectionStatus('disconnected');
      deps.ui.lobby.showHostError(`Failed to re-host: ${err.message}`);
    }
  } else if (sessionManager.client) {
    try {
      sessionManager.client.setPlayerId(session.playerId);
      await sessionManager.joinSession(session.sessionId, session);
      deps.log(`[Cuubz] Re-joining session: ${session.sessionId}`);
    } catch (err) {
      sessionManager.updateConnectionStatus('disconnected');
      deps.ui.lobby.showHostError(`Failed to rejoin: ${err.message}`);
    }
  }

  deps.startGame(session.mode || 'survival');
}
