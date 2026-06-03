/**
 * Cuubz — Biome System
 */
class BiomeSystem {
  constructor() {
    this.BIOMES = {
      OCEAN:     { id: 'ocean',     fluid: BLOCK_TYPES.WATER,       surface: [BLOCK_TYPES.SAND, BLOCK_TYPES.GRAVEL] },
      PLAINS:    { id: 'plains',    fluid: BLOCK_TYPES.WATER,       surface: [BLOCK_TYPES.GRASS, BLOCK_TYPES.DIRT] },
      FOREST:    { id: 'forest',    fluid: BLOCK_TYPES.WATER,       surface: [BLOCK_TYPES.GRASS, BLOCK_TYPES.DIRT] },
      DESERT:    { id: 'desert',    fluid: BLOCK_TYPES.AIR,         surface: [BLOCK_TYPES.SAND, BLOCK_TYPES.SAND] },
      TUNDRA:    { id: 'tundra',    fluid: BLOCK_TYPES.ICE,         surface: [BLOCK_TYPES.SNOW, BLOCK_TYPES.STONE] },
      MOUNTAINS: { id: 'mountains', fluid: BLOCK_TYPES.WATER,       surface: [BLOCK_TYPES.STONE, BLOCK_TYPES.STONE] },
      LAVA:      { id: 'lava',      fluid: BLOCK_TYPES.LAVA,        surface: [BLOCK_TYPES.BLACKSTONE, BLOCK_TYPES.BLACKSTONE] },
      CORRUPT:   { id: 'corrupt',   fluid: BLOCK_TYPES.TOXIC_SLIME, surface: [BLOCK_TYPES.CORRUPT_STONE, BLOCK_TYPES.OBSIDIAN] }
    };
  }

  getBiome(temp, humidity, continentalness, erosion) {
    // 1. Continentalness (Ocean vs Land)
    if (continentalness < 0.35) return this.BIOMES.OCEAN;
    
    // 2. Erosion Extremes (Lava/Corrupt)
    if (erosion > 0.8) {
      return temp > 0.5 ? this.BIOMES.LAVA : this.BIOMES.CORRUPT;
    }

    // 3. Mountains (High land + low erosion)
    if (continentalness > 0.7 && erosion < 0.4) return this.BIOMES.MOUNTAINS;

    // 4. Climate Grid (Temp vs Humidity)
    if (temp > 0.6) {
      return humidity < 0.35 ? this.BIOMES.DESERT : this.BIOMES.FOREST;
    }
    if (temp < 0.35) return this.BIOMES.TUNDRA;
    
    return humidity > 0.5 ? this.BIOMES.FOREST : this.BIOMES.PLAINS;
  }
}

if (typeof module !== 'undefined') module.exports = { BiomeSystem };