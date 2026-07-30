/**
 * Cuubz — Chunk Data & Constants (VoxelGen Overhaul)
 * Bounds: 16x256x16 | Sea Level: 64 | Bedrock: 0
 * 
 * Block definitions moved to blockRegistry.js.
 * BLOCK_TYPES, BLOCK_BY_ID, BLOCK_BY_NAME, MAX_BLOCK_ID are globals from blockRegistry.js.
 */

import { BLOCK_BY_ID, BLOCK_BY_NAME, BLOCK_PROPERTIES, BLOCK_TYPES } from './BlockRegistry.js';

// Node.js: require the block registry lookups; browser: use globals (script-tag load order).
// These are re-exported below because several tests destructure them from this module —
// chunkData is where block IDs are consumed, so it doubles as their entry point.
// Each symbol is guarded separately. Guarding the whole block on BLOCK_TYPES alone
// made these shims order-dependent: a module that set only a subset (say
// BLOCK_TYPES + BLOCK_PROPERTIES) would satisfy the guard here and leave
export const CHUNK_WIDTH = 16;
export const CHUNK_DEPTH = 16;
export const CHUNK_HEIGHT = 256;
export const MIN_Y = 0;
export const MAX_Y = 256;
export const SEA_LEVEL = 64;

/** Size of a 1-deep edge strip (16 × 256) used for virtual neighbor data in multiplayer. */
export const EDGE_STRIP_SIZE = CHUNK_WIDTH * CHUNK_HEIGHT; // 16 × 256 = 4096

export class Chunk {
  constructor(chunkX, chunkZ) {
    this.cx = chunkX;
    this.cz = chunkZ;
    this.blocks = new Uint8Array(CHUNK_WIDTH * CHUNK_DEPTH * CHUNK_HEIGHT);
    this.humidityMap = null;  // Float32Array(256) — normalized 0..1 humidity per column, for vertex color tinting
    this.dirty   = false;  // Player modified → needs flush to IndexedDB (every 5s)
    this.changed = false;  // Block changed since last frame → needs mesh rebuild now

    // ── Multiplayer: virtual neighbor edge strips ────────────────────────
    // When a chunk is received from the host without its real neighbors,
    // these 1-deep edge strips (16 × 256 each) provide boundary data so
    // the mesh builder can correctly cull faces at chunk edges.
    // Each strip is a Uint8Array(4096) or null if unavailable.
    // Format per direction:
    //   positiveX/negativeX: strip[z * 256 + y]
    //   positiveZ/negativeZ: strip[x * 256 + y]
    this.neighborEdges = {
      positiveX: null,
      negativeX: null,
      positiveZ: null,
      negativeZ: null,
    };
  }

  _idx(x, y, z) {
    return x + (z * CHUNK_WIDTH) + (y * CHUNK_WIDTH * CHUNK_DEPTH);
  }

  getBlock(lx, ly, lz) {
    if (ly < 0 || ly >= CHUNK_HEIGHT) return BLOCK_TYPES.AIR;
    if (lx < 0 || lx >= CHUNK_WIDTH || lz < 0 || lz >= CHUNK_DEPTH) return -1; // out of bounds → caller handles neighbor lookup
    return this.blocks[this._idx(lx, ly, lz)];
  }

  setBlock(lx, ly, lz, type) {
    if (lx < 0 || lx >= CHUNK_WIDTH || lz < 0 || lz >= CHUNK_DEPTH || ly < 0 || ly >= CHUNK_HEIGHT) return false;
    const idx = this._idx(lx, ly, lz);
    if (this.blocks[idx] !== type) {
      this.blocks[idx] = type;
      this.dirty = true;
      this.changed = true;
      return true; // block actually changed
    }
    return false; // no change
  }

  serialize() {
    const indices = [], types = [];
    for (let i = 0; i < this.blocks.length; i++) {
      if (this.blocks[i] !== 0) {
        indices.push(i); types.push(this.blocks[i]);
      }
    }
    return { cx: this.cx, cz: this.cz, indices, types, dirty: this.dirty };
  }

  static deserialize(data) {
    const chunk = new Chunk(data.cx ?? data.chunkX, data.cz ?? data.chunkZ);
    for (let i = 0; i < data.indices.length; i++) chunk.blocks[data.indices[i]] = data.types[i];
    chunk.dirty = data.dirty;
    return chunk;
  }
}

// Re-exported for compatibility with the CommonJS surface these files had
// before PR 9 (tests import them from here).
export { BLOCK_BY_ID, BLOCK_BY_NAME, BLOCK_PROPERTIES, BLOCK_TYPES };
