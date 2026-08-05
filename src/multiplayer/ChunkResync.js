/**
 * Cuubz — Client-side chunk resync (D-116)
 *
 * A joining client renders nothing it was not sent: `ChunkManager` runs in `clientMode`,
 * so `checkRegion` and `_updateVoxelRegion` never generate, and every block it draws
 * arrived as a `CHUNK_DATA` from the host. The host, for its part, records a chunk as
 * delivered the moment it *queues* the payload (`ChunkStreamEntry.markClean`) — not when
 * the client acknowledges it. Nothing reconciled the two, so any payload lost in between
 * left a hole no code path could fill:
 *
 *   - the host force-promoted a chunk it could not generate in time to LOADED with no
 *     blocks in it, sent that empty payload, and marked it delivered (fixed in
 *     `ChunkStreamer.tick`);
 *   - `onChunkStreamed` drops the send outright when the game socket is not connected;
 *   - the client evicts chunks beyond `renderDistance + 2` from `memoryCache`
 *     (`ChunkGenerator._updateVoxelRegion`), and walking back into them asks nobody for
 *     them again;
 *   - the host's stream radius is 6 and the client's render distance is 8, so the outer
 *     ring is never streamed at all.
 *
 * This module is the client half of the fix: it names the chunks the client can see and
 * does not have, and asks for them. The logic is a pure function over a `memoryCache` and
 * a position so it can be tested in Node — the browser half is one `setInterval` in
 * `initChunkStreaming.js`.
 */

import { CHUNK_DEPTH, CHUNK_WIDTH } from '../engine/world/ChunkData.js';

export const DEFAULT_RESYNC_CONFIG = {
  interval: 1000,       // How often the client looks for holes (ms)
  cooldown: 5000,       // Don't re-ask for the same chunk within this window (ms)
  maxPerRequest: 64,    // Chunks per CHUNK_REQUEST — nearest first
};

/**
 * Chunk keys within `radius` of `position` that are absent from `memoryCache`,
 * nearest first.
 *
 * @param {{x: number, z: number}} position — player world position
 * @param {number} radius — in chunks
 * @param {Map<string, object>} memoryCache — the client's loaded chunks
 * @returns {string[]} keys `"cx,cz"`
 */
export function findMissingChunks(position, radius, memoryCache) {
  if (!position || typeof position.x !== 'number' || typeof position.z !== 'number') return [];
  if (!memoryCache || !(radius >= 0)) return [];

  const pcx = Math.floor(position.x / CHUNK_WIDTH);
  const pcz = Math.floor(position.z / CHUNK_DEPTH);
  const missing = [];

  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      const key = `${pcx + dx},${pcz + dz}`;
      if (memoryCache.has(key)) continue;
      missing.push({ key, distSq: dx * dx + dz * dz });
    }
  }

  // Nearest first: a client standing in a hole cares about the chunk under its feet long
  // before the one at the edge of its render distance.
  missing.sort((a, b) => a.distSq - b.distSq);
  return missing.map(m => m.key);
}

/**
 * Tracks what has been asked for and when, so a client that is waiting on the host does
 * not re-ask every second for the same hundred chunks.
 */
export class ChunkResyncRequester {
  /**
   * @param {object} config
   * @param {object} [config.options] — overrides for DEFAULT_RESYNC_CONFIG
   */
  constructor(config = {}) {
    this._options = Object.assign({}, DEFAULT_RESYNC_CONFIG, config.options || {});
    this._asked = new Map(); // key → timestamp of last request
  }

  get options() {
    return this._options;
  }

  /**
   * Decide what to ask for now.
   *
   * @param {{x: number, z: number}} position — player world position
   * @param {number} radius — render radius in chunks
   * @param {Map<string, object>} memoryCache — the client's loaded chunks
   * @param {number} [now] — injectable clock for tests
   * @returns {string[]} chunk keys to request; empty when there is nothing to ask for
   */
  collect(position, radius, memoryCache, now = Date.now()) {
    const missing = findMissingChunks(position, radius, memoryCache);

    // Forget chunks that have arrived, so a later eviction can be asked for again.
    for (const key of this._asked.keys()) {
      if (memoryCache && memoryCache.has(key)) this._asked.delete(key);
    }

    const request = [];
    for (const key of missing) {
      if (request.length >= this._options.maxPerRequest) break;
      const askedAt = this._asked.get(key);
      if (askedAt !== undefined && now - askedAt < this._options.cooldown) continue;
      this._asked.set(key, now);
      request.push(key);
    }

    return request;
  }

  /** Drop all request history (leaving a session, teleporting, etc.). */
  reset() {
    this._asked.clear();
  }
}
