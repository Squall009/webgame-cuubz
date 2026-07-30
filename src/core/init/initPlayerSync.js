/**
 * Cuubz — `Game.init()` step 11, first half (PR 17)
 *
 * `PlayerSyncManager` and `PlayerListHUD`. Both are no-ops without a
 * `sessionManager.client`, which is why solo skips all of it.
 *
 * **`WELCOME`, `PLAYER_JOINED`, `PLAYER_MOVE` and `PLAYER_LEFT` are each registered
 * twice here, deliberately** — once for `PlayerSyncManager` (the 3-D avatars) and once
 * for `PlayerListHUD` (the roster overlay), each parsing the same payload separately.
 * These are two live consumers, not `BUGS.md` D-44's dead duplicate. **Do not collapse
 * them.** PR 21's `EventBus` was the thing that would have shared the parse, and it was
 * dropped (decision 32); if they are ever unified it has to be with an ordering
 * assertion, because `PlayerListHUD` reads position data `PlayerSyncManager` also
 * consumes.
 */

import { PlayerListHUD } from '../../multiplayer/PlayerListHUD.js';
import { PlayerSyncManager } from '../../multiplayer/PlayerSync.js';

/**
 * @param {import('../Game.js').Game} game
 */
export function initPlayerSync(game) {
  const state = game.state;
  const deps = game.deps;
  const log = deps.log;
  const renderer = state.renderer;
  const sm = deps.sessionManager;

  // ─── Initialize Multiplayer Player Sync ─────────
  let playerSync = null;
  if (typeof PlayerSyncManager !== 'undefined' && sm && sm.client) {
    playerSync = new PlayerSyncManager();
    playerSync.setGameMode(game.requestedMode || 'survival');

    // Wire session events to player sync
    // Handle WELCOME — it includes existing players already in the session
    sm.client.onGame('WELCOME', (data) => {
      console.log('[JOIN] WELCOME received:', JSON.stringify(data).substring(0, 300));
      if (data.players && Array.isArray(data.players) && data.players.length > 0) {
        for (const p of data.players) {
          // Skip self
          if (p.playerId === sm.client.playerId) continue;
          const remote = playerSync.addPlayer(p.playerId, {
            name: p.name || 'Player',
            color: p.color || '#888888',
            position: p.position,
          });
          if (remote.mesh && renderer.scene) renderer.scene.add(remote.mesh);
          if (remote.nameTag && renderer.scene) renderer.scene.add(remote.nameTag);
          if (remote.healthBar && renderer.scene) renderer.scene.add(remote.healthBar);
          log(`[Cuubz] Existing player from WELCOME: ${p.playerId} (${p.name})`);
        }
      }
    });

    sm.client.onGame('PLAYER_JOINED', (data) => {
      const remote = playerSync.addPlayer(data.playerId, {
        name: data.character?.name || 'Player',
        color: data.character?.color || '#888888',
        position: data.position,
      });
      if (remote.mesh && renderer.scene) renderer.scene.add(remote.mesh);
      if (remote.nameTag && renderer.scene) renderer.scene.add(remote.nameTag);
      if (remote.healthBar && renderer.scene) renderer.scene.add(remote.healthBar);
      log(`[Cuubz] Remote player joined: ${data.playerId} (${remote.name})`);
    });

    sm.client.onGame('PLAYER_MOVE', (data) => {
      playerSync.processServerUpdate(data.playerId, {
        position: data.position,
        yaw: data.rotation?.yaw,
        pitch: data.rotation?.pitch,
      });
    });

    sm.client.onGame('PLAYER_LEFT', (data) => {
      playerSync.removePlayer(data.playerId);
      log(`[Cuubz] Remote player left: ${data.playerId}`);
    });

    log('[Cuubz] PlayerSyncManager initialized for multiplayer');
  }
  state.playerSync = playerSync;

  // ─── Initialize PlayerListHUD (connected to live player data) ───
  let playerListHUD = null;
  if (typeof PlayerListHUD !== 'undefined' && sm && sm.client) {
    const overlayEl = document.getElementById('player-list-overlay');
    const countEl = document.getElementById('player-count');
    const itemsEl = document.getElementById('player-list-items');

    if (overlayEl && itemsEl) {
      playerListHUD = new PlayerListHUD({ overlay: overlayEl, count: countEl, items: itemsEl });

      // Build initial player list: include local player + any remote players
      const localChar = deps.characterManager ? deps.characterManager.getSelectedCharacter() : null;
      const initialPlayers = [];
      if (localChar) {
        initialPlayers.push({
          id: 'local',
          name: localChar.name,
          color: localChar.color || '#4CAF50',
          health: 100,
        });
      }
      playerListHUD.updatePlayers(initialPlayers);

      // Wire WELCOME — add existing players already in the session
      sm.client.onGame('WELCOME', (data) => {
        if (playerListHUD && data.players && Array.isArray(data.players)) {
          for (const p of data.players) {
            // Skip self
            if (p.playerId === sm.client.playerId) continue;
            playerListHUD.addPlayer({
              id: p.playerId,
              name: p.name || 'Player',
              color: p.color || '#888888',
              health: 100,
              position: p.position,
            });
          }
        }
      });

      // Wire PLAYER_JOINED to add to HUD
      sm.client.onGame('PLAYER_JOINED', (data) => {
        if (playerListHUD) {
          playerListHUD.addPlayer({
            id: data.playerId,
            name: data.character?.name || 'Player',
            color: data.character?.color || '#888888',
            health: data.health !== undefined ? data.health : 100,
          });
        }
      });

      // Wire PLAYER_LEFT to remove from HUD
      sm.client.onGame('PLAYER_LEFT', (data) => {
        if (playerListHUD) {
          playerListHUD.removePlayer(data.playerId);
        }
      });

      // Wire PLAYER_MOVE to update health + position in HUD
      sm.client.onGame('PLAYER_MOVE', (data) => {
        if (playerListHUD && data.playerId) {
          const update = { id: data.playerId };
          if (data.health !== undefined) update.health = data.health;
          if (data.position) update.position = data.position;
          playerListHUD.addPlayer(update);
        }
      });

      log('[Cuubz] PlayerListHUD initialized and wired to live player data');
    }
  }
  state.playerListHUD = playerListHUD;
}
