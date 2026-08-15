/**
 * Cuubz — `Game.init()` step 7 (PR 17)
 *
 * The chunk manager, and everything that hangs off deciding host-vs-joining-client:
 * the manifest load-or-create, the 5 s dirty flush timer, the initial `checkRegion(0,0)`
 * and the host/client remote-block-change callbacks. The slowest step in the init.
 *
 * `game.isJoiningClient` is computed here and read by step 8. It was a `startGame()`
 * local (`isJoiningClient`) that three later lines read; decision 23 says it moves onto
 * the object as the step lifts, and it is init-only, so it is a `Game` field rather than
 * a `GameState` one.
 *
 * **Nothing about the flush timer changed.** `DEPLOY.md` §7 has the timing table and the
 * e2e block-edit assertions call `chunkManager.flushDirty()` directly because the game is
 * paused there.
 */

import { CHUNK_D, CHUNK_W, ChunkManager } from '../../engine/world/ChunkManager.js';

/**
 * @param {import('../Game.js').Game} game
 */
export async function initWorld(game) {
  const state = game.state;
  const deps = game.deps;
  const log = deps.log;
  const currentWorld = state.currentWorld;

  // Determine if this is a joining client (not host) — clients don't generate chunks
  const sm = deps.sessionManager;
  const isJoiningClient = game.isJoiningClient = !!(sm && sm.currentSessionId && !sm.hostingSessionId);
  console.log(`[JOIN] isJoiningClient=${isJoiningClient} currentSessionId=${sm?.currentSessionId} hostingSessionId=${sm?.hostingSessionId}`);

  // Initialize Chunk Manager (monolith — workers + IndexedDB + flush + region tracking)
  game.loadingStatus.textContent = 'Loading chunks...';
  if (game.loadingProgress) game.loadingProgress.style.width = '85%';

  const worldName = state.worldName = currentWorld.id;
  const renderDist = deps.perfSettings ? deps.perfSettings.get('renderDistance') : 8;
  const chunkManager = state.chunkManager = new ChunkManager({
    renderer: state.renderer,
    worldName: worldName,
    worldSeed: currentWorld.seed,
    // §3.1 — the world's own generator version, threaded to the worker through
    // `genParams` (`ChunkGenerator.js` already forwards this object verbatim). A world
    // created before the Corrupt and Lava biomes has no such field, defaults to 1, and
    // generates exactly the terrain it always did; only a v2 world samples the masks.
    genParams: { worldgenVersion: currentWorld.worldgenVersion || 1 },
    renderDistance: renderDist,
    regionRadius: 16,   // 32×32 pre-generation range
    textureAtlas: state.textureAtlas,
    clientMode: isJoiningClient, // Clients receive all chunks from host
  });

  await chunkManager.init();

  if (isJoiningClient) {
    // Client: no local generation, no IndexedDB, no flush — all chunks come from host
    log('[Cuubz] Client mode: chunk generation disabled, awaiting chunks from host');
  } else {
    // Host: load existing world or create new manifest
    const manifest = await chunkManager.loadManifest();
    if (!manifest) {
      await chunkManager.createNewWorld();
      log(`[Cuubz] Created new world manifest for "${worldName}"`);
    } else {
      log(`[Cuubz] Loaded existing world manifest (${manifest.generatedChunks.length} chunks saved)`);
    }

    // Start timers: flush dirty every 5s
    chunkManager.startFlushTimer(5000);

    // Trigger initial load around spawn position (awaits completion)
    await chunkManager.checkRegion(0, 0);

    // Safety net: drain any remaining generation queue items
    let genWait = 0;
    while ((chunkManager._genQueue.length > 0 || chunkManager._generating.size > 0) && genWait < 30) {
      await new Promise(r => setTimeout(r, 200));
      genWait++;
    }
  }

  chunkManager.updateRenderChunks(0, 0);

  // Graceful shutdown handlers
  chunkManager._setupGracefulShutdown();

  // Wire up host block validation callbacks for multiplayer persistence to IndexedDB.
  if (sm && sm.hostingSessionId) {
    const applyRemoteBlockChange = (data, newBlockType) => {
      try {
        chunkManager.applyBlockChange(data.x, data.y, data.z, newBlockType);
      } catch (err) {
        console.error('[Cuubz] Error applying remote block change:', err.message);
      }
    };

    sm.registerHostCallbacks(
      (data) => applyRemoteBlockChange(data, 0),
      (data) => applyRemoteBlockChange(data, data.blockType || 1)
    );
  } else if (sm && sm.currentSessionId) {
    const applyRemoteDelta = (data, newBlockType) => {
      try {
        // Client applies visually without persisting — mark dirty=false after
        chunkManager.applyBlockChange(data.x, data.y, data.z, newBlockType);
        // Clear dirty flag since client shouldn't flush to storage
        const cx = Math.floor(data.x / CHUNK_W);
        const cz = Math.floor(data.z / CHUNK_D);
        const key = ChunkManager.key(cx, cz);
        const chunk = chunkManager.memoryCache.get(key);
        if (chunk) chunk.dirty = false;
      } catch (err) {
        console.error('[Cuubz] Error applying client delta:', err.message);
      }
    };

    sm.registerClientCallbacks(
      (data) => applyRemoteDelta(data, 0),
      (data) => applyRemoteDelta(data, data.blockType || 1)
    );
  }
}
