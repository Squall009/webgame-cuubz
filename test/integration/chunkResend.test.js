/**
 * Cuubz — chunks reach a joining client, and reach it again if they went missing (D-116)
 *
 * ─── WHAT THIS REPRODUCES ───────────────────────────────────────────────────
 *
 * The reported symptom was "nothing loads around a client that joins a hosted session
 * unless you move outside the initial spawn range". Driven through a real relay socket
 * with the real `initChunkStreaming` on both ends, the pre-fix host sent **113 CHUNK_DATA
 * messages of which 113 were empty**, and the client finished with **0 of 49** chunks in
 * its render radius — a permanent void, because every one of those chunks was marked
 * delivered on the way out.
 *
 * The mechanism is the host's LOADING timeout. A client's spawn area is usually terrain
 * the host has not generated yet (the host's `memoryCache` covers a radius around *its
 * own* player), so the streamer's generator returns null for those chunks; after
 * `loadingTimeout` the entry was forced to LOADED **with `data` still null**, sent as an
 * empty payload that the client drops on `if (!data.data) return`, and recorded in
 * `streamedTo`. `buildStreamQueue` never looks at a chunk a player is already down as
 * having, so the blocks — generated seconds later — were never sent. Walking far enough
 * created *fresh* entries, whose generation had long since caught up. Hence "it only
 * works when you move".
 *
 * ─── WHY THE HARNESS IS SHAPED LIKE THIS ────────────────────────────────────
 *
 * The relay (`server/session.js`), the streamer, the payload builder and the client's
 * `CHUNK_DATA` handler are all the real thing — `initChunkStreaming` is DOM-free, so both
 * halves of it run here unmodified, which is the point: the defect lived in the seam
 * between them and a unit test on either side alone was green throughout.
 *
 * What is stubbed is `ChunkManager`, which needs IndexedDB, workers and `fetch`. The
 * double keeps the two behaviours this file depends on: `getChunkData` reads a
 * `memoryCache`, and `_ensureChunkInMemory` fills it asynchronously — here after a delay
 * deliberately longer than the host's 8 s timeout, which is what the real generator does
 * under a cold spawn area.
 *
 * `PlayerSyncManager` and `networkStep` are real, so the host learns the client's position
 * exactly as the game does: `PLAYER_JOINED` → `playerSync` → `chunkStreamer` every frame.
 *
 * The waits are real seconds because the timeout being tested is 8 s of real `Date.now`
 * inside a `setInterval` the streamer owns. `test/unit/multiplayer/chunkResend.test.js`
 * covers the same two invariants against a stubbed clock; this file is the one that
 * proves the wiring.
 */

import { describe, it, expect } from 'vitest';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import Session from '../../server/session.js';
import { initChunkStreaming } from '../../src/core/init/initChunkStreaming.js';
import { networkStep } from '../../src/engine/loop/steps/NetworkStep.js';
import { PlayerSyncManager } from '../../src/multiplayer/PlayerSync.js';
import { Chunk } from '../../src/engine/world/ChunkData.js';

const HOST_ID = 'host-player';
const CLIENT_ID = 'client-player';

/** Terrain with a flat grass surface — enough that a payload is non-trivial. */
function makeChunk(cx, cz) {
  const c = new Chunk(cx, cz);
  for (let x = 0; x < 16; x++) {
    for (let z = 0; z < 16; z++) {
      for (let y = 60; y <= 64; y++) c.blocks[x + z * 16 + y * 256] = 1;
    }
  }
  return c;
}

/**
 * A `ChunkManager` double. `generationLag` is the gap between the streamer first asking
 * for a chunk and that chunk existing — set above the host's 8 s `loadingTimeout` to put
 * the client's spawn area in exactly the state that produced the void.
 */
function stubChunkManager({ generationLag = 0, renderDistance = 3 } = {}) {
  return {
    memoryCache: new Map(),
    worldSeed: 4242,
    genParams: {},
    renderDistance,
    _pending: new Set(),
    getChunkData(cx, cz) { return this.memoryCache.get(`${cx},${cz}`) || null; },
    _ensureChunkInMemory(cx, cz) {
      const key = `${cx},${cz}`;
      if (this.memoryCache.has(key) || this._pending.has(key)) return Promise.resolve();
      this._pending.add(key);
      const t = setTimeout(() => { this.memoryCache.set(key, makeChunk(cx, cz)); }, generationLag);
      if (t.unref) t.unref();
      return Promise.resolve();
    },
  };
}

/** The `SessionManager` surface `initChunkStreaming` actually touches. */
function stubSessionManager({ playerId, hosting, ws, handlers }) {
  return {
    hostingSessionId: hosting ? 'S1' : null,
    currentSessionId: 'S1',
    client: {
      playerId,
      isGameSessionConnected: true,
      _gameSessionConn: { send: (m) => ws.send(JSON.stringify(m)) },
      onGame: (type, fn) => { handlers[type] = fn; },
    },
  };
}

describe('chunk streaming to a joining client', () => {
  it('fills the client\'s render radius even when the host has to generate it first', async () => {
    const rig = await startRig({ generationLag: 9000 });

    // 9 s generation + the 8 s timeout it blows through, plus streaming and a resync pass.
    await rig.wait(16000);

    const view = rig.renderRadiusKeys();
    const have = view.filter(k => rig.clientCm.memoryCache.has(k));

    expect(rig.emptyPayloads).toBe(0);
    expect(have.length).toBe(view.length);

    await rig.stop();
  }, 45000);

  it('re-sends chunks the client lost — nothing else can put them back', async () => {
    const rig = await startRig({ generationLag: 0 });

    await rig.wait(3000);
    expect(rig.clientCm.memoryCache.size).toBeGreaterThan(0);

    // Everything the client had is gone: this is what `_updateVoxelRegion` does to bound
    // memory in `clientMode`, and what a socket blip does in flight. The host believes it
    // has already delivered all of it.
    rig.clientCm.memoryCache.clear();

    await rig.wait(4000);

    const view = rig.renderRadiusKeys();
    const have = view.filter(k => rig.clientCm.memoryCache.has(k));
    expect(have.length).toBe(view.length);

    await rig.stop();
  }, 45000);
});

// ─── Rig ──────────────────────────────────────────────────────────────────────

async function startRig({ generationLag }) {
  const httpServer = http.createServer();
  await new Promise(r => httpServer.listen(0, r));
  const port = httpServer.address().port;
  const wss = new WebSocketServer({ server: httpServer });
  const session = new Session({
    wss, sessionId: 'S1', sessionName: 'chunk-resend', hostId: HOST_ID,
    worldSeed: 4242, maxPlayers: 4, claimTimeout: 0, hostGrace: 0,
  });

  const connect = () => new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    ws.on('open', () => resolve(ws));
  });

  // ── host ──
  const hostWs = await connect();
  const hostHandlers = {};
  const hostCm = stubChunkManager({ generationLag });
  const hostSm = stubSessionManager({ playerId: HOST_ID, hosting: true, ws: hostWs, handlers: hostHandlers });
  const hostState = {
    chunkManager: hostCm,
    player: { position: { x: 8, y: 70, z: 8 } },
    session: hostSm,
    frameCount: 0,
    game: { delta: 1 / 60 },
    skybox: null,
    blockInteraction: null,
    playerListHUD: null,
    playerSync: new PlayerSyncManager(),
  };
  initChunkStreaming({ state: hostState, deps: { log: () => {}, sessionManager: hostSm } });

  hostWs.on('message', (buf) => {
    const data = JSON.parse(buf.toString());
    // The two wirings `initPlayerSync.js` makes for the same messages.
    if (data.type === 'PLAYER_JOINED') {
      hostState.playerSync.addPlayer(data.playerId, { name: 'p', position: data.position });
    } else if (data.type === 'PLAYER_MOVE') {
      hostState.playerSync.processServerUpdate(data.playerId, { position: data.position });
    }
    if (hostHandlers[data.type]) hostHandlers[data.type](data);
  });
  hostWs.send(JSON.stringify({
    type: 'JOIN', playerId: HOST_ID, character: { name: 'host' },
    position: { x: 8, y: 70, z: 8 }, rotation: { yaw: 0, pitch: 0 },
  }));
  const hostLoop = setInterval(() => { hostState.frameCount++; networkStep(hostState); }, 16);

  await new Promise(r => setTimeout(r, 200));

  // ── joining client ──
  const clientWs = await connect();
  const clientHandlers = {};
  const clientCm = stubChunkManager({ renderDistance: 3 });
  const clientSm = stubSessionManager({ playerId: CLIENT_ID, hosting: false, ws: clientWs, handlers: clientHandlers });
  const clientState = { chunkManager: clientCm, player: { position: { x: 8, y: 66, z: 8 } } };
  initChunkStreaming({ state: clientState, deps: { log: () => {}, sessionManager: clientSm } });

  const rig = { clientCm, emptyPayloads: 0, chunkMessages: 0 };

  clientWs.on('message', (buf) => {
    const data = JSON.parse(buf.toString());
    if (data.type === 'CHUNK_DATA') {
      rig.chunkMessages++;
      // A payload with no blocks is the D-116 signature: the client drops it, the host
      // records it as delivered.
      if (!data.data) rig.emptyPayloads++;
    }
    if (clientHandlers[data.type]) clientHandlers[data.type](data);
  });
  clientWs.send(JSON.stringify({
    type: 'JOIN', playerId: CLIENT_ID, character: { name: 'client' },
    position: { x: 8, y: 66, z: 8 }, rotation: { yaw: 0, pitch: 0 },
  }));

  // The ~20 Hz `sendMove` of `PlayerStep`, which is how the host tracks the client.
  const clientLoop = setInterval(() => {
    clientWs.send(JSON.stringify({
      type: 'MOVE', position: clientState.player.position, rotation: { yaw: 0, pitch: 0 },
    }));
  }, 50);

  rig.wait = (ms) => new Promise(r => setTimeout(r, ms));
  rig.renderRadiusKeys = () => {
    const keys = [];
    const rd = clientCm.renderDistance;
    for (let dx = -rd; dx <= rd; dx++) for (let dz = -rd; dz <= rd; dz++) keys.push(`${dx},${dz}`);
    return keys;
  };
  rig.stop = async () => {
    clearInterval(hostLoop);
    clearInterval(clientLoop);
    clearInterval(clientState.chunkResyncTimerId);
    hostState.chunkStreamer.dispose();
    hostWs.close();
    clientWs.close();
    session.dispose();
    wss.close();
    await new Promise(r => httpServer.close(r));
  };

  return rig;
}
