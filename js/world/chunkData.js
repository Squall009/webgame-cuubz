/**
 * Cuubz — Chunk Data Structure
 * 16×16×96 block array (Z: -32 to +64, layer 0 = sea level)
 */

// Block type registry
const BLOCK_TYPES = {
  AIR:             0,
  GRASS:           1,
  DIRT:            2,
  STONE:           3,
  SAND:            4,
  GRAVEL:          5,
  WATER:           6,
  WOOD_LOG:        7,
  LEAVES:          8,
  SNOW:            9,
  ICE:             10,
  BEDROCK:         11,
  PLANKS:          12,
  OBSIDIAN:        13,
  BLACKSTONE:      14,
  LAVA:            15,
  CORRUPT_STONE:   16,
  TOXIC_SLIME:     17,
  COAL_ORE:        18,
  IRON_ORE:        19,
  GOLD_ORE:        20,
  DIAMOND_ORE:     21,
  CORRUPT_CRYSTAL: 22,
  BED:             23,
  APPLE:           24,
  QUEST_KEY:       25,
  BOSS_SPAWN:      26,
};

// Block properties
const BLOCK_PROPERTIES = {
  [BLOCK_TYPES.AIR]:             { solid: false, transparent: true, hardness: 0, damage: 0, drop: null },
  [BLOCK_TYPES.GRASS]:           { solid: true, transparent: false, hardness: 0.6, damage: 0, drop: BLOCK_TYPES.DIRT },
  [BLOCK_TYPES.DIRT]:            { solid: true, transparent: false, hardness: 0.5, damage: 0, drop: null },
  [BLOCK_TYPES.STONE]:           { solid: true, transparent: false, hardness: 3.0, damage: 0, drop: null },
  [BLOCK_TYPES.SAND]:            { solid: true, transparent: false, hardness: 0.5, damage: 0, drop: null },
  [BLOCK_TYPES.GRAVEL]:          { solid: true, transparent: false, hardness: 0.6, damage: 0, drop: null },
  [BLOCK_TYPES.WATER]:           { solid: false, transparent: true, hardness: 0, damage: 0, drop: null, drinkable: true },
  [BLOCK_TYPES.WOOD_LOG]:        { solid: true, transparent: false, hardness: 2.0, damage: 0, drop: null, craftable: true },
  [BLOCK_TYPES.LEAVES]:          { solid: false, transparent: true, hardness: 0.2, damage: 0, drop: null },
  [BLOCK_TYPES.SNOW]:            { solid: true, transparent: false, hardness: 0.3, damage: 0, drop: null },
  [BLOCK_TYPES.ICE]:             { solid: true, transparent: false, hardness: 0.5, damage: 0, drop: null, slippery: true },
  [BLOCK_TYPES.BEDROCK]:         { solid: true, transparent: false, hardness: -1, damage: 0, drop: null }, // unbreakable
  [BLOCK_TYPES.PLANKS]:          { solid: true, transparent: false, hardness: 2.0, damage: 0, drop: null, craftable: true },
  [BLOCK_TYPES.OBSIDIAN]:        { solid: true, transparent: false, hardness: 50.0, damage: 0, drop: null }, // very hard
  [BLOCK_TYPES.BLACKSTONE]:      { solid: true, transparent: false, hardness: 4.0, damage: 0, drop: null },
  [BLOCK_TYPES.LAVA]:            { solid: false, transparent: true, hardness: 0, damage: 4, drop: null, animated: true },
  [BLOCK_TYPES.CORRUPT_STONE]:   { solid: true, transparent: false, hardness: 3.5, damage: 0, drop: null },
  [BLOCK_TYPES.TOXIC_SLIME]:     { solid: false, transparent: true, hardness: 0, damage: 2, drop: null, animated: true }, // DoT
  [BLOCK_TYPES.COAL_ORE]:        { solid: true, transparent: false, hardness: 3.0, damage: 0, drop: 'coal', mineable: true },
  [BLOCK_TYPES.IRON_ORE]:        { solid: true, transparent: false, hardness: 3.0, damage: 0, drop: 'iron_ore', mineable: true },
  [BLOCK_TYPES.GOLD_ORE]:        { solid: true, transparent: false, hardness: 3.0, damage: 0, drop: 'gold_ore', mineable: true },
  [BLOCK_TYPES.DIAMOND_ORE]:     { solid: true, transparent: false, hardness: 3.0, damage: 0, drop: 'diamond', mineable: true },
  [BLOCK_TYPES.CORRUPT_CRYSTAL]: { solid: true, transparent: false, hardness: 2.0, damage: 0, drop: 'corrupt_crystal', questItem: true },
  [BLOCK_TYPES.BED]:             { solid: true, transparent: false, hardness: 0.5, damage: 0, drop: null, placeable: true },
  [BLOCK_TYPES.APPLE]:           { solid: false, transparent: true, hardness: 0, damage: 0, drop: 'apple', foodItem: true },
  [BLOCK_TYPES.QUEST_KEY]:       { solid: true, transparent: false, hardness: 0.5, damage: 0, drop: null, questItem: true },
  [BLOCK_TYPES.BOSS_SPAWN]:      { solid: false, transparent: true, hardness: -1, damage: 0, drop: null }, // invisible trigger
};

const CHUNK_WIDTH = 16;
const CHUNK_DEPTH = 16;
const CHUNK_HEIGHT = 96; // Z: -32 to +64
const SEA_LEVEL = 0;
const MIN_Y = -32;
const MAX_Y = 64;

class Chunk {
  /**
   * @param {number} chunkX - Chunk X coordinate
   * @param {number} chunkZ - Chunk Z coordinate
   */
  constructor(chunkX, chunkZ) {
    this.chunkX = chunkX;
    this.chunkZ = chunkZ;
    
    // World position of this chunk's origin
    this.worldX = chunkX * CHUNK_WIDTH;
    this.worldZ = chunkZ * CHUNK_DEPTH;
    
    // Block data: [x][z][y] → blockTypeId
    // Flattened for efficiency: index = x + z*16 + (y-32)*16*16
    this.blocks = new Uint8Array(CHUNK_WIDTH * CHUNK_DEPTH * CHUNK_HEIGHT);
    
    // Neighbor references (set by chunkGrid)
    this.neighbors = {
      positiveX: null, negativeX: null,
      positiveZ: null, negativeZ: null,
    };
    
    // Dirty flag — true if blocks changed since last save
    this.dirty = false;
    
    // Mesh data (set by chunkMeshBuilder)
    this.meshData = null;
  }

  /**
   * Get block at local coordinates
   */
  getBlock(x, y, z) {
    if (x < 0 || x >= CHUNK_WIDTH || z < 0 || z >= CHUNK_DEPTH || y < MIN_Y || y >= MAX_Y) {
      return BLOCK_TYPES.AIR; // Out of bounds = air
    }
    const index = this._localIndex(x, y, z);
    return this.blocks[index];
  }

  /**
   * Set block at local coordinates
   */
  setBlock(x, y, z, type) {
    if (x < 0 || x >= CHUNK_WIDTH || z < 0 || z >= CHUNK_DEPTH || y < MIN_Y || y >= MAX_Y) {
      return; // Out of bounds
    }
    const index = this._localIndex(x, y, z);
    this.blocks[index] = type;
    this.dirty = true;
  }

  /**
   * Convert local coordinates to flat array index
   */
  _localIndex(x, y, z) {
    return x + z * CHUNK_WIDTH + (y - MIN_Y) * CHUNK_WIDTH * CHUNK_DEPTH;
  }

  /**
   * Get block at world coordinates (returns null if not in this chunk)
   */
  getBlockAtWorld(wx, wy, wz) {
    const lx = wx - this.worldX;
    const lz = wz - this.worldZ;
    
    // Check if the world position falls within THIS chunk's bounds
    if (lx < 0 || lx >= CHUNK_WIDTH || lz < 0 || lz >= CHUNK_DEPTH) {
      return null; // Not in this chunk
    }
    
    return this.getBlock(lx, wy, lz);
  }

  /**
   * Get edge boundary data for seamless neighbor joining
   */
  getEdgeData(edge) {
    const data = new Uint8Array(CHUNK_HEIGHT * CHUNK_WIDTH);
    
    for (let y = MIN_Y; y < MAX_Y; y++) {
      for (let x = 0; x < CHUNK_WIDTH; x++) {
        let z;
        switch (edge) {
          case 'positiveZ': z = CHUNK_DEPTH - 1; break;
          case 'negativeZ': z = 0; break;
          case 'positiveX': 
            // Transpose for X edges
            data[(y - MIN_Y) * CHUNK_WIDTH + x] = this.getBlock(x, y, edge === 'positiveX' ? CHUNK_DEPTH - 1 : 0);
            continue;
          default: z = 0;
        }
        data[(y - MIN_Y) * CHUNK_WIDTH + x] = this.getBlock(x, y, z);
      }
    }
    
    return data;
  }

  /**
   * Serialize chunk to compressed JSON-like structure
   */
  serialize() {
    // Only save non-air blocks for compression
    // Use separate arrays: indices (uint16) and types (uint8) to avoid truncation
    const indices = [];
    const types = [];
    const len = this.blocks.length;
    
    for (let i = 0; i < len; i++) {
      if (this.blocks[i] !== BLOCK_TYPES.AIR) {
        indices.push(i);
        types.push(this.blocks[i]);
      }
    }
    
    return {
      chunkX: this.chunkX,
      chunkZ: this.chunkZ,
      indices: indices,
      types: types,
      dirty: this.dirty,
    };
  }

  /**
   * Deserialize chunk from saved data
   */
  static deserialize(serialized) {
    const chunk = new Chunk(serialized.chunkX, serialized.chunkZ);
    
    const indices = serialized.indices || [];
    const types = serialized.types || [];
    
    for (let i = 0; i < indices.length; i++) {
      const index = indices[i];
      const type = types[i];
      if (index >= 0 && index < chunk.blocks.length) {
        chunk.blocks[index] = type;
      }
    }
    
    return chunk;
  }

  /**
   * Check if this chunk is empty (all air)
   */
  isEmpty() {
    for (let i = 0; i < this.blocks.length; i++) {
      if (this.blocks[i] !== BLOCK_TYPES.AIR) return false;
    }
    return true;
  }

  /**
   * Reset dirty flag after save
   */
  markClean() {
    this.dirty = false;
  }
}

module.exports = { Chunk, BLOCK_TYPES, BLOCK_PROPERTIES, CHUNK_WIDTH, CHUNK_DEPTH, CHUNK_HEIGHT, SEA_LEVEL, MIN_Y, MAX_Y };
