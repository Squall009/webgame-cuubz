/**
 * Cuubz — the automatic rejoin (PR 18)
 *
 * `src/main.js:762–866` — the block at the end of `init()` that probes the relay's
 * `/sessions` endpoint before the main menu is shown. `refactor.md` §8.6 held it back
 * from PR 16 because it is entangled with the loading screen and `showScreen`; both
 * arrive through `deps` now.
 *
 * ─── AUTOMATIC vs MANUAL ────────────────────────────────────────────────────
 *
 * `SessionRejoin.js` owns the **manual** rejoin — the `#btn-rejoin-session` button —
 * and the rejoin panel. This file owns the **automatic** one, which runs once per page
 * load and only when the relay still lists the stored session as active. They are
 * deliberately not merged: the manual path reports failure through the lobby's host
 * error and leaves the player on the menu, while this one owns the loading screen and
 * has to tell its caller whether the main menu should be shown at all.
 *
 * ─── WHAT IS PRESERVED ──────────────────────────────────────────────────────
 *
 * Every step and its order, including:
 *
 *   • the three `_gameMode` / `_sessionName` / `_sessionSeed` assignments made **before**
 *     anything can write a new record — that is D-43's fix, and without it a page closed
 *     during the re-host handshake rewrites `mode` as the `'survival'` default;
 *   • both early exits. A re-host or re-join failure shows the main menu and returns
 *     `true`, because the menu has already been shown — the caller must not show it
 *     again, exactly as `init()`'s bare `return` used to skip it.
 */

import { createSessionManager } from './SessionManager.js';
import { getRelayUrl } from './RelayUrl.js';
import { readLastSession } from '../util/StorageHelper.js';

/**
 * Try to resume the session this page was in before it was refreshed.
 *
 * @param {object} deps — the bootstrap's live-getter object: `characterManager`,
 *   `worldManager`, `showScreen(name)`, `startGame(mode)` and `log(...)`.
 * @param {function(object):void} adoptSessionManager — called with the manager this
 *   function creates, so the bootstrap can assign it to its own `sessionManager`
 *   binding. Same contract as `SessionRejoin.rejoinSession`.
 * @returns {Promise<boolean>} `true` if this function took over the page — i.e. the
 *   caller must **not** go on to show the main menu.
 */
export async function attemptAutoRejoin(deps, adoptSessionManager) {
  const log = deps.log;
  const characterManager = deps.characterManager;
  const worldManager = deps.worldManager;

  const lastSession = readLastSession();
  if (!lastSession || !lastSession.sessionId) return false;

  log(`[Cuubz] Found saved session: ${lastSession.sessionId} (${lastSession.isHost ? 'host' : 'joiner'})`);

  // Check if the relay still has this session active
  try {
    const relayUrl = getRelayUrl();
    const httpUrl = relayUrl.replace('wss://', 'https://').replace('ws://', 'http://');
    const resp = await fetch(`${httpUrl}/sessions`, { signal: AbortSignal.timeout(3000) });
    if (resp.ok) {
      const sessions = await resp.json();
      const activeSession = sessions.find(s => s.sessionId === lastSession.sessionId);
      if (activeSession) {
        log(`[Cuubz] Session ${lastSession.sessionId} is still active on relay — auto-rejoining`);

        // Ensure character is selected
        const characters = characterManager.getAllCharacters();
        if (characters.length > 0) {
          await characterManager.selectCharacter(characters[0].id);
        }

        // Ensure world is selected (for host) or create temp world (for joiner)
        if (lastSession.isHost && lastSession.seed) {
          const worlds = worldManager.getAllWorlds();
          const existingWorld = worlds.find(w => w.seed === lastSession.seed);
          if (existingWorld) {
            await worldManager.selectWorld(existingWorld.id);
          } else if (worlds.length > 0) {
            await worldManager.selectWorld(worlds[0].id);
          }
        } else if (!lastSession.isHost && lastSession.seed) {
          const tempWorld = {
            id: `temp_${lastSession.sessionId}`,
            name: lastSession.name || 'Remote World',
            seed: lastSession.seed,
            biomeMap: { dominantBiomes: ['Plains'], seed: lastSession.seed },
            questProgress: {},
            chunkReferences: [],
          };
          worldManager.worlds.push(tempWorld);
          worldManager.selectedId = tempWorld.id;
        } else if (worldManager.getAllWorlds().length > 0) {
          await worldManager.selectWorld(worldManager.getAllWorlds()[0].id);
        }

        // Initialize session manager and rejoin. `createSessionManager` also
        // resolves the relay URL, which is the same value `relayUrl` above holds —
        // that one is kept because the `/sessions` probe wanted an HTTP form of it.
        const sessionManager = createSessionManager(deps);
        adoptSessionManager(sessionManager);

        // PR 16 — carry the stored session's identity onto the manager before
        // anything can write a new record. Without this a page closed during the
        // re-host handshake would rewrite `mode` as the `'survival'` default and
        // reproduce D-43 by a different route.
        sessionManager._gameMode = lastSession.mode || 'survival';
        sessionManager._sessionName = lastSession.name || null;
        sessionManager._sessionSeed = lastSession.seed !== undefined ? lastSession.seed : null;

        sessionManager.updateConnectionStatus('connecting');
        deps.showScreen('loadingScreen');
        document.getElementById('loading-status').textContent =
          lastSession.isHost ? 'Re-hosting session...' : 'Re-joining session...';

        if (lastSession.isHost && sessionManager.client) {
          try {
            await sessionManager.client.hostSession({
              name: lastSession.name,
              seed: lastSession.seed || Math.floor(Math.random() * 0xFFFFFFFF),
              mode: lastSession.mode || 'survival',
            });
            log(`[Cuubz] Re-hosting session: ${lastSession.name}`);
          } catch (err) {
            log(`[Cuubz] Re-host failed: ${err.message}`);
            deps.showScreen('mainMenu');
            return true; // the menu is already up — `init()`'s bare `return`
          }
        } else if (sessionManager.client) {
          try {
            await sessionManager.joinSession(lastSession.sessionId);
            log(`[Cuubz] Re-joining session: ${lastSession.sessionId}`);
          } catch (err) {
            log(`[Cuubz] Re-join failed: ${err.message}`);
            deps.showScreen('mainMenu');
            return true; // the menu is already up — `init()`'s bare `return`
          }
        }

        // Start the game
        deps.startGame(lastSession.mode || 'survival');
        // console.info, not console.error — this is a success milestone.
        // CuubzLogger.log is console.log gated on DEBUG=false (src/util/Logger.js),
        // i.e. silent in production, which is why someone reached for console.error
        // to force visibility. The logger is correct; the severity was not.
        console.info('[Cuubz] === AUTO-REJOIN COMPLETE ===');
        return true; // Skip showing main menu
      }
    }
  } catch (err) {
    log(`[Cuubz] Could not check relay for auto-rejoin: ${err.message}`);
  }

  // Session not found on relay — show main menu with rejoin panel
  log(`[Cuubz] Session ${lastSession.sessionId} no longer active on relay`);
  return false;
}
