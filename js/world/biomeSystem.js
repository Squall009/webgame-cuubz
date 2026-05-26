/**
 * Cuubz — Biome System
 * Temperature/moisture noise maps for biome distribution.
 */

// Use global BLOCK_TYPES (defined by chunkData.js) — require() only works in Node.js
const _BLOCK_TYPES = typeof BLOCK_TYPES !== 'undefined' ? BLOCK_TYPES : {};

// Biome definitions with surface blocks, height modifiers, and features
const BIOMES = {
  PLAINS: {
    id: 'plains',
    name: 'Plains',
    surfaceBlocks: [_BLOCK_TYPES.GRASS, _BLOCK_TYPES.DIRT],
    minHeight: -5, maxHeight: 8,
    heightModifier: 0.3,
    features: ['trees_sparse', 'flowers'],
    hazards: [],
    items: ['apples_on_trees'],
    temperature: 0.5, moisture: 0.5,
  },
  FOREST: {
    id: 'forest',
    name: 'Forest',
    surfaceBlocks: [_BLOCK_TYPES.GRASS, _BLOCK_TYPES.DIRT],
    minHeight: -3, maxHeight: 12,
    heightModifier: 0.4,
    features: ['trees_dense', 'tall_trunks'],
    hazards: [],
    items: ['apples_on_trees'],
    temperature: 0.5, moisture: 0.7,
  },
  DESERT: {
    id: 'desert',
    name: 'Desert',
    surfaceBlocks: [_BLOCK_TYPES.SAND, _BLOCK_TYPES.GRAVEL],
    minHeight: -2, maxHeight: 6,
    heightModifier: 0.35,
    features: ['cacti'],
    hazards: ['dehydration_faster'],
    items: [],
    temperature: 0.9, moisture: 0.1,
  },
  TUNDRA: {
    id: 'tundra',
    name: 'Tundra',
    surfaceBlocks: [_BLOCK_TYPES.SNOW, _BLOCK_TYPES.ICE],
    minHeight: -2, maxHeight: 8,
    heightModifier: 0.35,
    features: ['sparse_vegetation', 'snow_layers'],
    hazards: ['slippery_ground'],
    items: [],
    temperature: 0.1, moisture: 0.4,
  },
  MOUNTAINS: {
    id: 'mountains',
    name: 'Mountains',
    surfaceBlocks: [_BLOCK_TYPES.STONE, _BLOCK_TYPES.GRAVEL],
    minHeight: 5, maxHeight: 50,
    heightModifier: 0.8,
    features: ['exposed_ores'],
    hazards: ['fall_damage_risk'],
    items: ['ore_common'],
    temperature: 0.3, moisture: 0.3,
  },
  OCEAN: {
    id: 'ocean',
    name: 'Ocean',
    surfaceBlocks: [_BLOCK_TYPES.SAND], // ocean floor
    minHeight: -32, maxHeight: -1,
    heightModifier: 0.1,
    features: ['coral_structures'],
    hazards: ['drowning'],
    items: ['water_drinkable'],
    temperature: 0.4, moisture: 1.0,
  },
  LAVA: {
    id: 'lava',
    name: 'Lava',
    surfaceBlocks: [_BLOCK_TYPES.OBSIDIAN, _BLOCK_TYPES.BLACKSTONE],
    minHeight: -5, maxHeight: 5,
    heightModifier: 0.3,
    features: ['lava_pools'],
    hazards: ['lava_damage'],
    items: [],
    temperature: 1.0, moisture: 0.0,
  },
  CORRUPT: {
    id: 'corrupt',
    name: 'Corrupt',
    surfaceBlocks: [_BLOCK_TYPES.CORRUPT_STONE],
    minHeight: -3, maxHeight: 5,
    heightModifier: 0.35,
    features: ['toxic_pools', 'quest_markers'],
    hazards: ['poison_dot'],
    items: ['corrupt_crystals'],
    temperature: 0.2, moisture: 0.8,
  },
};

const BIOME_LIST = Object.values(BIOMES);

class BiomeSystem {
  constructor(temperatureNoise, moistureNoise) {
    this.tempNoise = temperatureNoise;
    this.moistureNoise = moistureNoise;
  }

  /**
   * Determine biome at world coordinates based on temperature and moisture noise
   */
  getBiome(wx, wz, scale = 0.01) {
    const temp = (this.tempNoise.perlin2(wx * scale, wz * scale) + 1) / 2; // 0-1
    const moist = (this.moistureNoise.perlin2(wx * scale + 1000, wz * scale + 1000) + 1) / 2; // 0-1
    
    return this.biomeFromValues(temp, moist);
  }

  /**
   * Map temperature/moisture values to biome
   */
  biomeFromValues(temp, moist) {
    // Ocean: always wet and low temp range
    if (moist > 0.85 && temp < 0.6) return BIOMES.OCEAN;
    
    // Lava: extremely hot, dry
    if (temp > 0.9 && moist < 0.2) return BIOMES.LAVA;
    
    // Corrupt: cold + very wet (toxic pools)
    if (temp < 0.3 && moist > 0.75) return BIOMES.CORRUPT;
    
    // Mountains: moderate temp, low moisture
    if (temp > 0.4 && temp < 0.7 && moist < 0.35) return BIOMES.MOUNTAINS;
    
    // Desert: hot + dry
    if (temp > 0.7 && moist < 0.35) return BIOMES.DESERT;
    
    // Tundra: cold + not too wet
    if (temp < 0.35 && moist < 0.65) return BIOMES.TUNDRA;
    
    // Forest: moderate temp + high moisture
    if (temp > 0.4 && temp < 0.7 && moist > 0.55) return BIOMES.FOREST;
    
    // Plains: default fallback
    return BIOMES.PLAINS;
  }

  /**
   * Get biome with blending — returns primary and secondary biomes at borders
   */
  getBlendedBiome(wx, wz, scale = 0.01) {
    const temp = (this.tempNoise.perlin2(wx * scale, wz * scale) + 1) / 2;
    const moist = (this.moistureNoise.perlin2(wx * scale + 1000, wz * scale + 1000) + 1) / 2;
    
    const primary = this.biomeFromValues(temp, moist);
    
    // Check neighbors for border blending
    const neighborTemp = temp + (this.tempNoise.perlin2((wx+16) * scale, wz * scale) - temp) * 0.1;
    const neighborMoist = moist + (this.moistureNoise.perlin2((wx+16) * scale + 1000, wz * scale + 1000) - moist) * 0.1;
    
    const secondary = this.biomeFromValues(neighborTemp, neighborMoist);
    
    return { primary, secondary, blend: (temp !== neighborTemp || moist !== neighborMoist) };
  }

  /**
   * Get surface block type for a biome at given height
   */
  getSurfaceBlock(biome, height) {
    if (biome.surfaceBlocks.length === 0) return _BLOCK_TYPES.STONE;
    
    // Use height to pick between surface variants
    const idx = Math.min(1, Math.max(0, Math.floor((height - biome.minHeight) / (biome.maxHeight - biome.minHeight))));
    return biome.surfaceBlocks[idx] || biome.surfaceBlocks[0];
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BiomeSystem, BIOMES, BIOME_LIST };

}