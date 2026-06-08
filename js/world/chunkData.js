/**
 * Cuubz — Chunk Data & Constants (VoxelGen Overhaul)
 * Bounds: 16x256x16 | Sea Level: 64 | Bedrock: 0
 * Generation logic matches voxelgen.html source of truth.
 *
 * NOTE: BLOCK_TYPES IDs are kept at original Cuubz values to maintain compatibility
 * with texture atlas filenames (e.g., "1_0-grass_top.png"). VoxelGen's internal block
 * IDs are translated via VOXELGEN_TO_CUUBZ in workerGeneration.js.
 */

const BLOCK_TYPES = {
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, SAND: 4, GRAVEL: 5, WATER: 6,
  WOOD_LOG: 7, LEAVES: 8, SNOW: 9, ICE: 10, BEDROCK: 11, PLANKS: 12,
  OBSIDIAN: 13, BLACKSTONE: 14, LAVA: 15, CORRUPT_STONE: 16, TOXIC_SLIME: 17,
  COAL_ORE: 18, IRON_ORE: 19, GOLD_ORE: 20, DIAMOND_ORE: 21,
  CORRUPT_CRYSTAL: 22, RED_FLOWER: 27, YELLOW_FLOWER: 28, CAVE_TORCH: 29, GLOWSTONE: 30
};

const BLOCK_PROPERTIES = {
  [BLOCK_TYPES.AIR]:       { solid: false, transparent: true, gravity: false },
  [BLOCK_TYPES.GRASS]:     { solid: true, transparent: false, hardness: 0.6 },
  [BLOCK_TYPES.DIRT]:      { solid: true, transparent: false, hardness: 0.5 },
  [BLOCK_TYPES.STONE]:     { solid: true, transparent: false, hardness: 3.0 },
  [BLOCK_TYPES.SAND]:      { solid: true, transparent: false, hardness: 0.5 },
  [BLOCK_TYPES.GRAVEL]:    { solid: true, transparent: false, hardness: 0.6 },
  [BLOCK_TYPES.WATER]:     { solid: false, transparent: true, fluid: true },
  [BLOCK_TYPES.LAVA]:      { solid: false, transparent: false, fluid: true, damage: 4 },
  [BLOCK_TYPES.BEDROCK]:   { solid: true, transparent: false, hardness: -1 },
  [BLOCK_TYPES.LEAVES]:    { solid: false, transparent: true, hardness: 0.2 },
  [BLOCK_TYPES.SNOW]:      { solid: true, transparent: false, hardness: 0.3 },
  [BLOCK_TYPES.ICE]:       { solid: true, transparent: true, hardness: 0.5 }
};

// VoxelGen internal block IDs → Cuubz BLOCK_TYPES mapping.
// Used by workerGeneration.js to translate generated blocks to our texture-compatible IDs.
const VOXELGEN_TO_CUUBZ = [
  // vg:AIR(0)      -> cu:AIR(0)
  // vg:BEDROCK(1)   -> cu:BEDROCK(11)
  // vg:STONE(2)     -> cu:STONE(3)
  // vg:DIRT(3)      -> cu:DIRT(2)
  // vg:GRASS(4)     -> cu:GRASS(1)
  // vg:SAND(5)      -> cu:SAND(4)
  // vg:GRAVEL(6)    -> cu:GRAVEL(5)
  // vg:WATER(7)     -> cu:WATER(6)
  // vg:COAL_ORE(8)   -> cu:COAL_ORE(18)
  // vg:IRON_ORE(9)   -> cu:IRON_ORE(19)
  // vg:GOLD_ORE(10)  -> cu:GOLD_ORE(20)
  // vg:DIAMOND_ORE(11)->cu:DIAMOND_ORE(21)
  // vg:CAVE_AIR(12)  -> cu:AIR(0) — cave air = regular air for rendering
  // vg:SNOW(13)      -> cu:SNOW(9)
  // vg:SNOW_STONE(14)->cu:STONE(3) — no separate snowy stone texture, use stone
  // vg:LAVA(15)      -> cu:LAVA(15)
  // vg:TERRACOTTA(16)->cu:CORRUPT_STONE(16) — closest visual match
  // vg:RED_SAND(17)  -> cu:SAND(4) — use sand texture (red tint TBD)
  // vg:ICE(18)       -> cu:ICE(10)
  // vg:CLAY(19)      -> cu:DIRT(2) — clay ≈ dirt visually
  0, 11, 3, 2, 1, 4, 5, 6, 18, 19, 20, 21, 0, 9, 3, 15, 16, 4, 10, 2
];

const CHUNK_WIDTH = 16;
const CHUNK_DEPTH = 16;
const CHUNK_HEIGHT = 256;
const MIN_Y = 0;
const MAX_Y = 256;
const SEA_LEVEL = 64;

// Water level constants (Minecraft-style: 8 levels for fluids).
const WATER_LEVEL_SOURCE = 8;
const WATER_LEVEL_FLOWING_MIN = 1;
const WATER_LEVEL_FLOWING_MAX = 7;

class Chunk {
  constructor(chunkX, chunkZ) {
    this.chunkX = chunkX;
    this.chunkZ = chunkZ;
    this.worldX = chunkX * CHUNK_WIDTH;
    this.worldZ = chunkZ * CHUNK_DEPTH;
    this.blocks = new Uint8Array(CHUNK_WIDTH * CHUNK_DEPTH * CHUNK_HEIGHT);
    // Water level metadata: 0 = no water/not fluid, 1-8 = water/lava level.
    this.waterLevels = new Uint8Array(CHUNK_WIDTH * CHUNK_DEPTH * CHUNK_HEIGHT);
    this.neighbors = { positiveX: null, negativeX: null, positiveZ: null, negativeZ: null };
    this.dirty = false;
  }

  _localIndex(x, y, z) {
    return x + (z * CHUNK_WIDTH) + (y * CHUNK_WIDTH * CHUNK_DEPTH);
  }

  getBlock(x, y, z) {
    if (y < 0 || y >= CHUNK_HEIGHT) return BLOCK_TYPES.AIR;
    if (x < 0 && this.neighbors.negativeX) return this.neighbors.negativeX.getBlock(CHUNK_WIDTH + x, y, z);
    if (x >= CHUNK_WIDTH && this.neighbors.positiveX) return this.neighbors.positiveX.getBlock(x - CHUNK_WIDTH, y, z);
    if (z < 0 && this.neighbors.negativeZ) return this.neighbors.negativeZ.getBlock(x, y, CHUNK_DEPTH + z);
    if (z >= CHUNK_DEPTH && this.neighbors.positiveZ) return this.neighbors.positiveZ.getBlock(x, y, z - CHUNK_DEPTH);
    if (x < 0 || x >= CHUNK_WIDTH || z < 0 || z >= CHUNK_DEPTH) return BLOCK_TYPES.AIR;
    return this.blocks[this._localIndex(x, y, z)];
  }

  setBlock(x, y, z, type) {
    if (x < 0 || x >= CHUNK_WIDTH || z < 0 || z >= CHUNK_DEPTH || y < 0 || y >= CHUNK_HEIGHT) return;
    const idx = this._localIndex(x, y, z);
    if (this.blocks[idx] !== type) {
      this.blocks[idx] = type;
      if ((type === BLOCK_TYPES.WATER || type === BLOCK_TYPES.LAVA)) {
        this.waterLevels[idx] = WATER_LEVEL_SOURCE;
      } else {
        this.waterLevels[idx] = 0;
      }
      this.dirty = true;
    }
  }

  getWaterLevel(x, y, z) {
    if (y < 0 || y >= CHUNK_HEIGHT) return 0;
    if (x < 0 && this.neighbors.negativeX) return this.neighbors.negativeX.getWaterLevel(CHUNK_WIDTH + x, y, z);
    if (x >= CHUNK_WIDTH && this.neighbors.positiveX) return this.neighbors.positiveX.getWaterLevel(x - CHUNK_WIDTH, y, z);
    if (z < 0 && this.neighbors.negativeZ) return this.neighbors.negativeZ.getWaterLevel(x, y, CHUNK_DEPTH + z);
    if (z >= CHUNK_DEPTH && this.neighbors.positiveZ) return this.neighbors.positiveZ.getWaterLevel(x, y, z - CHUNK_DEPTH);
    if (x < 0 || x >= CHUNK_WIDTH || z < 0 || z >= CHUNK_DEPTH) return 0;
    const blockType = this.blocks[this._localIndex(x, y, z)];
    if (blockType !== BLOCK_TYPES.WATER && blockType !== BLOCK_TYPES.LAVA) return 0;
    return this.waterLevels[this._localIndex(x, y, z)];
  }

  setWaterLevel(x, y, z, level) {
    if (x < 0 || x >= CHUNK_WIDTH || z < 0 || z >= CHUNK_DEPTH || y < 0 || y >= CHUNK_HEIGHT) return;
    const idx = this._localIndex(x, y, z);
    const blockType = this.blocks[idx];
    if (blockType !== BLOCK_TYPES.WATER && blockType !== BLOCK_TYPES.LAVA) return;
    const clampedLevel = Math.max(0, Math.min(WATER_LEVEL_SOURCE, level));
    if (this.waterLevels[idx] !== clampedLevel) {
      this.waterLevels[idx] = clampedLevel;
      this.dirty = true;
    }
  }

  isWaterSource(x, y, z) {
    return this.getWaterLevel(x, y, z) === WATER_LEVEL_SOURCE;
  }

  serialize() {
    const indices = [], types = [];
    const waterLevelIndices = [], waterLevelValues = [];
    for (let i = 0; i < this.blocks.length; i++) {
      if (this.blocks[i] !== BLOCK_TYPES.AIR) {
        // Include CAVE_AIR in serialization so cave data persists.
        indices.push(i); types.push(this.blocks[i]);
      }
      if (this.waterLevels[i] > 0 && this.waterLevels[i] < WATER_LEVEL_SOURCE) {
        waterLevelIndices.push(i); waterLevelValues.push(this.waterLevels[i]);
      }
    }
    return { chunkX: this.chunkX, chunkZ: this.chunkZ, indices, types, dirty: this.dirty,
             waterLevelIndices, waterLevelValues };
  }

  static deserialize(data) {
    const chunk = new Chunk(data.chunkX, data.chunkZ);
    for (let i = 0; i < data.indices.length; i++) chunk.blocks[data.indices[i]] = data.types[i];
    for (let i = 0; i < chunk.blocks.length; i++) {
      if ((chunk.blocks[i] === BLOCK_TYPES.WATER || chunk.blocks[i] === BLOCK_TYPES.LAVA)) {
        chunk.waterLevels[i] = WATER_LEVEL_SOURCE;
      }
    }
    if (data.waterLevelIndices) {
      for (let i = 0; i < data.waterLevelIndices.length; i++) chunk.waterLevels[data.waterLevelIndices[i]] = data.waterLevelValues[i];
    }
    chunk.dirty = data.dirty;
    return chunk;
  }
}

if (typeof module !== 'undefined') {
  module.exports = { Chunk, BLOCK_TYPES, BLOCK_PROPERTIES, CHUNK_WIDTH, CHUNK_DEPTH, CHUNK_HEIGHT, MIN_Y, MAX_Y, SEA_LEVEL, VOXELGEN_TO_CUUBZ };
}
