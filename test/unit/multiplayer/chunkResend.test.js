/**
 * Cuubz — a chunk the client never got has to be sendable again (D-116)
 *
 * ─── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 *
 * A joining client renders nothing it was not sent — `ChunkManager` runs in `clientMode`,
 * so it never generates. The host, meanwhile, records a chunk as delivered the moment it
 * *queues* the payload (`ChunkStreamEntry.markClean`), and `buildStreamQueue` will not
 * look at that chunk for that player again. Delivery was assumed, never confirmed, and
 * nothing anywhere could ask for a second copy. Two consequences, both reproduced below:
 *
 *   1. `tick()` used to force a chunk that missed `loadingTimeout` from LOADING to LOADED
 *      **with `data` still null**, send that empty payload — which the client drops on its
 *      `if (!data.data) return` — and mark it delivered. The blocks, once generated, were
 *      never sent. A client whose spawn area still needed generating therefore stood in a
 *      permanent void that ended only where it walked into chunks the host had not yet
 *      poisoned. That is the reported symptom, exactly.
 *   2. Anything else that loses a payload — a socket not connected when `onChunkStreamed`
 *      fires, a client still initialising, a chunk the client evicted from `memoryCache`
 *      to bound memory — was equally permanent.
 *
 * The fix is a retry rather than a fabrication for (1), and a client→host `CHUNK_REQUEST`
 * for (2). `test/integration/chunkResend.test.js` is the same two failures driven through
 * a real relay socket; these are the unit-level invariants.
 *
 * `Date.now` is stubbed rather than using fake timers because `ChunkStreamer` reads it
 * directly for `loadTime` and `lastStreamed` and is ticked by hand here — there is no
 * timer to fake.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ChunkStreamer, CHUNK_STATE } from '../../../src/multiplayer/ChunkStreamer.js';
import { ChunkResyncRequester, findMissingChunks } from '../../../src/multiplayer/ChunkResync.js';

const HOST = 'host-id';
const CLIENT = 'client-id';

/** A chunk grid whose terrain only exists after `availableAt`. */
function laggyGrid(clock, availableAt) {
  return {
    memoryCache: new Map(),
    getChunkData() {
      if (clock.now < availableAt) return null;
      return { blocks: new Uint8Array(16 * 16 * 256).fill(1) };
    },
    _ensureChunkInMemory: () => Promise.resolve(),
  };
}

function streamerWith(grid, options) {
  const s = new ChunkStreamer({
    chunkGrid: grid,
    options: Object.assign({ loadRadius: 1, unloadRadius: 4, maxChunksPerTick: 100 }, options),
  });
  s.updatePlayerPosition(HOST, { x: 8, y: 40, z: 8 });
  s.updatePlayerPosition(CLIENT, { x: 8, y: 40, z: 8 });
  return s;
}

describe('a chunk whose data is not ready yet', () => {
  const realNow = Date.now;
  afterEach(() => { Date.now = realNow; });

  it('is never sent as an empty payload, and is sent for real once generated', () => {
    const clock = { now: 1_000_000 };
    const start = clock.now;
    Date.now = () => clock.now;

    // Generation takes 20 s — well past the 8 s loading timeout that used to fabricate a
    // LOADED chunk with no blocks in it.
    const s = streamerWith(laggyGrid(clock, start + 20_000), { loadingTimeout: 8000 });
    const sent = [];
    s.onChunkStreamed = (p) => sent.push(p);

    // 19 s of ticks — past the 8 s timeout, before the terrain exists.
    for (let i = 0; i < 38; i++) { clock.now += 500; s.tick(); }

    expect(sent.filter(p => p.data === undefined)).toHaveLength(0);
    expect(sent).toHaveLength(0); // nothing to send yet — and nothing marked delivered
    expect(s.getChunkEntry(0, 0).streamedTo.size).toBe(0);

    // Terrain arrives. The chunk must still be sendable.
    for (let i = 0; i < 6; i++) { clock.now += 500; s.tick(); }

    const forClient = sent.filter(p => p.players.includes(CLIENT));
    expect(forClient.length).toBeGreaterThan(0);
    expect(forClient[0].data.length).toBeGreaterThan(0);
    expect(s.getChunkEntry(0, 0).state).toBe(CHUNK_STATE.LOADED);
  });

  it('is retried rather than abandoned when it misses the loading timeout', () => {
    const clock = { now: 2_000_000 };
    Date.now = () => clock.now;

    const grid = laggyGrid(clock, Infinity); // never generates
    let ensured = 0;
    grid._ensureChunkInMemory = () => { ensured++; return Promise.resolve(); };

    const s = streamerWith(grid, { loadingTimeout: 8000 });
    for (let i = 0; i < 40; i++) { clock.now += 500; s.tick(); }

    // Still trying: the entry is not sitting in a LOADED state that claims blocks it
    // does not have.
    expect(s.getChunkEntry(0, 0).state).not.toBe(CHUNK_STATE.LOADED);
    expect(ensured).toBeGreaterThan(1);
  });
});

describe('CHUNK_REQUEST', () => {
  /** A grid whose terrain is always ready. */
  const readyGrid = () => ({
    memoryCache: new Map(),
    getChunkData: () => ({ blocks: new Uint8Array(16 * 16 * 256).fill(1) }),
    _ensureChunkInMemory: () => Promise.resolve(),
  });

  it('re-sends a chunk the client says it is missing', () => {
    const s = streamerWith(readyGrid());

    const first = s.tick();
    expect(first.length).toBeGreaterThan(0);
    expect(s.tick()).toHaveLength(0); // one shot, as before

    s.requestChunks(CLIENT, ['0,0']);
    const resent = s.tick();

    expect(resent).toHaveLength(1);
    expect(resent[0].chunkX).toBe(0);
    expect(resent[0].chunkZ).toBe(0);
    expect(resent[0].players).toContain(CLIENT);
    expect(resent[0].data.length).toBeGreaterThan(0);

    // And it settles again rather than looping.
    expect(s.tick()).toHaveLength(0);
  });

  it('serves a chunk outside the stream radius — the client renders wider than the host streams', () => {
    const s = streamerWith(readyGrid(), { loadRadius: 1, unloadRadius: 2 });
    s.tick();

    // `5,5` is far outside loadRadius 1, which is exactly the case the client's
    // renderDistance-8 view produces against the host's radius-6 stream.
    s.requestChunks(CLIENT, ['5,5']);
    const payloads = [...s.tick(), ...s.tick()];

    const served = payloads.find(p => p.chunkX === 5 && p.chunkZ === 5);
    expect(served).toBeDefined();
    expect(served.players).toContain(CLIENT);
  });

  it('accepts coordinate pairs as well as keys, and ignores rubbish', () => {
    const s = streamerWith(readyGrid());
    expect(s.requestChunks(CLIENT, [{ cx: 1, cz: 2 }])).toBe(1);
    expect(s.requestChunks(CLIENT, ['not,a,chunk', 'x,y', null, 7])).toBe(0);
    expect(s.requestChunks(null, ['0,0'])).toBe(0);
    expect(s.requestChunks(CLIENT, 'nope')).toBe(0);
  });

  it('does not resurrect a departed player', () => {
    const s = streamerWith(readyGrid());
    s.tick();
    s.requestChunks(CLIENT, ['0,0']);
    s.removePlayer(CLIENT);

    for (const p of s.tick()) expect(p.players).not.toContain(CLIENT);
  });
});

describe('the client side of the resync', () => {
  it('names the chunks in view that it does not have, nearest first', () => {
    const cache = new Map([['0,0', {}], ['1,0', {}]]);
    const missing = findMissingChunks({ x: 8, z: 8 }, 2, cache);

    expect(missing).not.toContain('0,0');
    expect(missing).not.toContain('1,0');
    expect(missing).toContain('2,2');
    // Nearest first — the chunk under your feet before the one at the edge of view.
    // (`0,0` and `1,0` are cached, so the nearest missing are the three at distance 1.)
    expect(['-1,0', '0,-1', '0,1']).toContain(missing[0]);
    expect(missing[missing.length - 1]).toMatch(/^-?2,-?2$/);
  });

  it('does not re-ask for the same chunk until the cooldown expires', () => {
    const r = new ChunkResyncRequester({ options: { cooldown: 5000, maxPerRequest: 10 } });
    const cache = new Map();

    const first = r.collect({ x: 0, z: 0 }, 1, cache, 1000);
    expect(first).toHaveLength(9);
    expect(r.collect({ x: 0, z: 0 }, 1, cache, 2000)).toHaveLength(0);
    expect(r.collect({ x: 0, z: 0 }, 1, cache, 6500)).toHaveLength(9);
  });

  it('asks again for a chunk that arrived and was later evicted', () => {
    const r = new ChunkResyncRequester({ options: { cooldown: 5000 } });
    const cache = new Map();

    r.collect({ x: 0, z: 0 }, 0, cache, 1000);          // asked for 0,0
    cache.set('0,0', {});                                // it arrived
    expect(r.collect({ x: 0, z: 0 }, 0, cache, 1500)).toHaveLength(0);

    cache.delete('0,0');                                 // _updateVoxelRegion evicted it
    // Cooldown does not apply: the arrival cleared the record.
    expect(r.collect({ x: 0, z: 0 }, 0, cache, 2000)).toEqual(['0,0']);
  });

  it('caps one request so a client in a void does not ask for its whole view at once', () => {
    const r = new ChunkResyncRequester({ options: { maxPerRequest: 8 } });
    expect(r.collect({ x: 0, z: 0 }, 8, new Map(), 1000)).toHaveLength(8);
  });
});
