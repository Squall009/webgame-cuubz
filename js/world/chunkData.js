/**
 * Cuubz — Chunk Data & Constants (VoxelGen Overhaul)
 * Bounds: 16x256x16 | Sea Level: 64 | Bedrock: 0
 * Block IDs match VoxelGen generation system directly — no translation layer.
 */

const BLOCK_TYPES = {
  // ── VoxelGen terrain blocks (IDs 0-19) ──────────────────────
  AIR:          0,   BEDROCK:    1,   STONE:        2,
  DIRT:         3,   GRASS:      4,   SAND:         5,
  GRAVEL:       6,   WATER:      7,   COAL_ORE:     8,
  IRON_ORE:     9,   GOLD_ORE:   10,  DIAMOND_ORE:  11,
  CAVE_AIR:     12,  SNOW:       13,  SNOW_STONE:   14,
  LAVA:         15,  TERRACOTTA: 16,  RED_SAND:     17,
  ICE:          18,  CLAY:       19,

  // ── Cuubz-specific decorations & features (IDs 32+) ─────────
  WOOD_LOG:      32, LEAVES:      33, PLANKS:        34,
  OBSIDIAN:      35, BLACKSTONE:  36, TOXIC_SLIME:   37,
  CORRUPT_CRYSTAL:38, BED:        39, APPLE:          40,
  QUEST_KEY:     41, RED_FLOWER:  42, YELLOW_FLOWER:  43,
  CAVE_TORCH:    44, GLOWSTONE:   45
};

const BLOCK_PROPERTIES = {
  [BLOCK_TYPES.AIR]:          { solid: false, transparent: true, gravity: false },
  [BLOCK_TYPES.GRASS]:        { solid: true, transparent: false, hardness: 0.6 },
  [BLOCK_TYPES.DIRT]:         { solid: true, transparent: false, hardness: 0.5 },
  [BLOCK_TYPES.STONE]:        { solid: true, transparent: false, hardness: 3.0 },
  [BLOCK_TYPES.SAND]:         { solid: true, transparent: false, hardness: 0.5 },
  [BLOCK_TYPES.GRAVEL]:       { solid: true, transparent: false, hardness: 0.6 },
  [BLOCK_TYPES.WATER]:        { solid: false, transparent: true, fluid: true },
  [BLOCK_TYPES.LAVA]:         { solid: false, transparent: false, fluid: true, damage: 4 },
  [BLOCK_TYPES.BEDROCK]:      { solid: true, transparent: false, hardness: -1 },
  [BLOCK_TYPES.LEAVES]:       { solid: false, transparent: true, hardness: 0.2 },
  [BLOCK_TYPES.SNOW]:         { solid: true, transparent: false, hardness: 0.3 },
  [BLOCK_TYPES.ICE]:          { solid: true, transparent: true, hardness: 0.5 },
  [BLOCK_TYPES.WOOD_LOG]:     { solid: true, transparent: false, hardness: 2.0 },
  [BLOCK_TYPES.PLANKS]:       { solid: true, transparent: false, hardness: 1.5 },
  [BLOCK_TYPES.OBSIDIAN]:     { solid: true, transparent: false, hardness: -1 },
  [BLOCK_TYPES.BLACKSTONE]:   { solid: true, transparent: false, hardness: 3.0 },
  [BLOCK_TYPES.TERRACOTTA]:   { solid: true, transparent: false, hardness: 1.5 },
  [BLOCK_TYPES.RED_SAND]:     { solid: true, transparent: false, hardness: 0.5 },
  [BLOCK_TYPES.CLAY]:         { solid: true, transparent: false, hardness: 0.5 },
  [BLOCK_TYPES.SNOW_STONE]:   { solid: true, transparent: false, hardness: 3.0 },
  // Ores
  [BLOCK_TYPES.COAL_ORE]:     { solid: true, transparent: false, hardness: 3.0 },
  [BLOCK_TYPES.IRON_ORE]:     { solid: true, transparent: false, hardness: 3.0 },
  [BLOCK_TYPES.GOLD_ORE]:     { solid: true, transparent: false, hardness: 3.0 },
  [BLOCK_TYPES.DIAMOND_ORE]:  { solid: true, transparent: false, hardness: 5.0 },
  // Cave air (treated as air)
  [BLOCK_TYPES.CAVE_AIR]:     { solid: false, transparent: true, gravity: false },
  // Decorations
  [BLOCK_TYPES.RED_FLOWER]:   { solid: false, transparent: true, hardness: 0.1 },
  [BLOCK_TYPES.YELLOW_FLOWER]:{ solid: false, transparent: true, hardness: 0.1 },
  [BLOCK_TYPES.CAVE_TORCH]:   { solid: false, transparent: true, hardness: 0.1 },
  [BLOCK_TYPES.GLOWSTONE]:    { solid: true, transparent: true, hardness: 0.3 },
  [BLOCK_TYPES.TOXIC_SLIME]:  { solid: true, transparent: false, hardness: 0.5 },
  [BLOCK_TYPES.CORRUPT_CRYSTAL]: { solid: true, transparent: false, hardness: 2.0 },
  [BLOCK_TYPES.BED]:          { solid: true, transparent: false, hardness: 0.3 },
  [BLOCK_TYPES.APPLE]:        { solid: false, transparent: true, hardness: 0.1 },
  [BLOCK_TYPES.QUEST_KEY]:    { solid: false, transparent: true, hardness: 0.1 }
};

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
      if (this.blocks[i] !== BLOCK_TYPES.AIR) {
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
  module.exports = { Chunk, BLOCK_TYPES, BLOCK_PROPERTIES, CHUNK_WIDTH, CHUNK_DEPTH, CHUNK_HEIGHT, MIN_Y, MAX_Y, SEA_LEVEL };
}
