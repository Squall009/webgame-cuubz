/**
 * Cuubz — render-loop step 5: multiplayer (PR 18)
 *
 * `src/main.js:577–650`, verbatim. Remote player interpolation, the player-list HUD,
 * the host's `ChunkStreamer` position feed, the `TIME_SYNC` broadcast and the queued
 * block break/place sends.
 *
 * **This is not "all the networking".** The ~20 Hz `sendMove` is in `PlayerStep`,
 * where the frame put it (main.js:443). This step is the block at main.js:577 and
 * nothing else, because its position between `CombatStep` and `WorldStep` is what
 * decides which frame's block edits go out.
 *
 * `state.session` is the `SessionManager` — set once at the top of `Game.init()`
 * (PR 18) so the loop no longer reaches for a `main.js` module local. The guard shapes
 * below are the originals: the `chunkStreamer` branch reads
 * `state.session.client.playerId` **unguarded**, exactly as main.js:603 did.
 */

/**
 * @param {import('../../../core/GameState.js').GameState} state
 */
export function networkStep(state) {
  // ─── Multiplayer: Sync remote player positions ───
  if (state.playerSync) {
    state.playerSync.update(state.game.delta);
  }

  // ─── Multiplayer: Update player list HUD positions (every 30 frames ≈ 0.5s) ───
  if (state.playerListHUD && state.frameCount % 30 === 0) {
    // Update local player position
    state.playerListHUD.addPlayer({
      id: 'local',
      position: { x: state.player.position.x, y: state.player.position.y, z: state.player.position.z },
    });
    // Update remote player positions from PlayerSyncManager
    if (state.playerSync) {
      for (const remotePlayer of state.playerSync.getActivePlayers()) {
        state.playerListHUD.addPlayer({
          id: remotePlayer.playerId,
          position: { ...remotePlayer.authoritativePosition },
        });
      }
    }
  }

  // ─── Multiplayer: Update ChunkStreamer with player positions (host) ───
  if (state.chunkStreamer) {
    // Update host player position — use actual playerId so server can route messages
    const hostPid = state.session.client.playerId || 'host';
    state.chunkStreamer.updatePlayerPosition(hostPid, {
      x: state.player.position.x,
      y: state.player.position.y,
      z: state.player.position.z,
    });
    // Update remote player positions from PlayerSyncManager
    if (state.playerSync) {
      const activePlayers = state.playerSync.getActivePlayers();
      if (activePlayers.length > 0 && state.frameCount % 60 === 0) {
        console.log(`[CHUNK_STREAM] Updating ${activePlayers.length} remote player positions in chunkStreamer`);
        for (const rp of activePlayers) {
          console.log(`[CHUNK_STREAM]   ${rp.playerId.substring(0,8)} @ (${Math.floor(rp.authoritativePosition.x)},${Math.floor(rp.authoritativePosition.z)})`);
        }
      }
      for (const remotePlayer of activePlayers) {
        state.chunkStreamer.updatePlayerPosition(remotePlayer.playerId, remotePlayer.authoritativePosition);
      }
    }
  }

  // ─── Multiplayer: Sync time of day to clients (host, every ~0.5s) ───
  if (state.session && state.session.hostingSessionId && state.skybox && state.frameCount % 30 === 0) {
    if (state.session.client && state.session.client._gameSessionConn) {
      state.session.client._gameSessionConn.send({
        type: 'TIME_SYNC',
        timeOfDay: state.skybox.timeOfDay,
        timePaused: state.skybox.timePaused,
      });
      if (state.frameCount % 300 === 0) {
        console.log(`[TIME_SYNC] Sent: timeOfDay=${state.skybox.timeOfDay.toFixed(2)}, paused=${state.skybox.timePaused}`);
      }
    }
  }

  // ─── Multiplayer: Send block changes to game session ───
  if (state.blockInteraction && state.session && state.session.client && state.session.client.isGameSessionConnected) {
    if (state.blockInteraction._lastBroken) {
      console.log(`[BREAK] Sending network break: (${state.blockInteraction._lastBroken.x},${state.blockInteraction._lastBroken.y},${state.blockInteraction._lastBroken.z})`);
      state.session.client.breakBlock(state.blockInteraction._lastBroken.x, state.blockInteraction._lastBroken.y, state.blockInteraction._lastBroken.z);
      state.blockInteraction._lastBroken = null;
    }
    if (state.blockInteraction._lastPlaced) {
      console.log(`[PLACE] Sending network place: (${state.blockInteraction._lastPlaced.x},${state.blockInteraction._lastPlaced.y},${state.blockInteraction._lastPlaced.z}) type=${state.blockInteraction._lastPlaced.blockType}`);
      state.session.client.placeBlock(state.blockInteraction._lastPlaced.x, state.blockInteraction._lastPlaced.y, state.blockInteraction._lastPlaced.z, state.blockInteraction._lastPlaced.blockType);
      state.blockInteraction._lastPlaced = null;
    }
  }
}
