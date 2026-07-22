/**
 * Cuubz — Chunk Data & Constants (VoxelGen Overhaul)
 * Bounds: 16x256x16 | Sea Level: 64 | Bedrock: 0
 * 
 * Block definitions moved to blockRegistry.js.
 * BLOCK_TYPES, BLOCK_BY_ID, BLOCK_BY_NAME, MAX_BLOCK_ID are globals from blockRegistry.js.
 */

const CHUNK_WIDTH = 16;
const CHUNK_DEPTH = 16;
const CHUNK_HEIGHT = 256;
const MIN_Y = 0;
const MAX_Y = 256;
const SEA_LEVEL = 64;

class Chunk {
  constructor(chunkX, chunkZ) {
    this.cx = chunkX;
    this.cz = chunkZ;
    this.blocks = new Uint8Array(CHUNK_WIDTH * CHUNK_DEPTH * CHUNK_HEIGHT);
    this.dirty   = false;  // Player modified → needs flush to IndexedDB (every 5s)
    this.changed = false;  // Block changed since last frame → needs mesh rebuild now
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

if (typeof module !== 'undefined') {
  module.exports = { Chunk, CHUNK_WIDTH, CHUNK_DEPTH, CHUNK_HEIGHT, MIN_Y, MAX_Y, SEA_LEVEL };
}
