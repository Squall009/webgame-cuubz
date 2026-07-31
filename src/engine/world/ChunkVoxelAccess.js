/**
 * Cuubz — Voxel read/write against the memory cache (PR 23)
 *
 * Split out of ChunkManager.js. A PROTOTYPE MIXIN: every method below is the byte-identical
 * body it had as a class member and `this` is still the ChunkManager instance, so no call
 * site — internal or external — changed. These four are among the most-called methods in
 * `src/`: `getVoxel` is the collision and face-culling primitive, `applyBlockChange` is
 * what every place/break in `BlockInteractionSystem` goes through.
 *
 * FIELDS CROSSING THIS BOUNDARY: 3 — `memoryCache`, `_flushQueue`, `_disposed`. The
 * LOWEST count of any instance-method group in the split, which is exactly why this is
 * where the last cut was made: after the named cuts ChunkManager.js was still over the
 * 400-line ceiling, and the rule for choosing an extra seam is fewest fields crossing,
 * not most coherent topic.
 *
 * `getVoxel` returning AIR for an unloaded chunk is deliberate and load-bearing: it is
 * the safe default for face culling at a chunk boundary whose neighbour has not arrived.
 * Do not "fix" it into a null or a throw.
 */

import { CHUNK_W, CHUNK_D } from './ChunkConstants.js';
import { BLOCK_TYPES } from './BlockRegistry.js';
import { chunkKey } from './ChunkKeys.js';

export const ChunkVoxelAccessMethods = {
  // ============================================================
  // VOXEL QUERY (neighbor-aware block lookup)
  // ============================================================

  /** Query any voxel by world coordinates. Handles cross-chunk neighbor lookups. */
  getVoxel(wx, wy, wz) {
    const cx = Math.floor(wx / CHUNK_W);
    const cz = Math.floor(wz / CHUNK_D);
    const key = chunkKey(cx, cz);
    const chunk = this.memoryCache.get(key);
    if (!chunk) return BLOCK_TYPES.AIR; // Not loaded → treat as air (safe default for face culling)

    const lx = ((wx % CHUNK_W) + CHUNK_W) % CHUNK_W;
    const lz = ((wz % CHUNK_D) + CHUNK_D) % CHUNK_D;
    return chunk.getBlock(lx, wy, lz);
  },

  /** Get chunk data for a loaded chunk. */
  getChunkData(cx, cz) {
    return this.memoryCache.get(chunkKey(cx, cz)) || null;
  },

  // ============================================================
  // BLOCK MODIFICATION (called by gameplay / interaction)
  // ============================================================

  /** Apply a block change at world coordinates. */
  applyBlockChange(wx, wy, wz, newType) {
    if (this._disposed) return false;

    const cx = Math.floor(wx / CHUNK_W);
    const cz = Math.floor(wz / CHUNK_D);
    const key = chunkKey(cx, cz);

    const chunk = this.memoryCache.get(key);
    if (!chunk) {
      // Chunk not in memory — queue it for loading
      this._ensureChunkInMemory(cx, cz).catch(() => {});
      return false;
    }

    const lx = ((wx % CHUNK_W) + CHUNK_W) % CHUNK_W;
    const lz = ((wz % CHUNK_D) + CHUNK_D) % CHUNK_D;

    if (chunk.setBlock(lx, wy, lz, newType)) {
      // Block actually changed — queue for flush
      this._flushQueue.add(key);
      return true;
    }
    return false;
  },

  /** Mark a chunk as dirty and changed (for remote player changes). */
  markChunkDirty(cx, cz) {
    const key = chunkKey(cx, cz);
    const chunk = this.memoryCache.get(key);
    if (chunk) {
      chunk.dirty = true;
      chunk.changed = true;
      this._flushQueue.add(key);
    }
  },
};
