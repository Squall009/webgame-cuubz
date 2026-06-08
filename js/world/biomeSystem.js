/**
 * Cuubz — Biome System
 */
class BiomeSystem {
  constructor() {
    this.BIOMES = {
      OCEAN:     { id: 'ocean',     fluid: BLOCK_TYPES.WATER,       surface: [BLOCK_TYPES.SAND, BLOCK_TYPES.GRAVEL],   baseHeight: 18, heightScale: 0.3 },
      PLAINS:    { id: 'plains',    fluid: BLOCK_TYPES.WATER,       surface: [BLOCK_TYPES.GRASS, BLOCK_TYPES.DIRT],   baseHeight: 36, heightScale: 0.5 },
      FOREST:    { id: 'forest',    fluid: BLOCK_TYPES.WATER,       surface: [BLOCK_TYPES.GRASS, BLOCK_TYPES.DIRT],   baseHeight: 38, heightScale: 0.7 },
      DESERT:    { id: 'desert',    fluid: BLOCK_TYPES.AIR,         surface: [BLOCK_TYPES.SAND, BLOCK_TYPES.SAND],    baseHeight: 34, heightScale: 0.4 },
      TUNDRA:    { id: 'tundra',    fluid: BLOCK_TYPES.ICE,         surface: [BLOCK_TYPES.SNOW, BLOCK_TYPES.STONE],   baseHeight: 36, heightScale: 0.6 },
      MOUNTAINS: { id: 'mountains', fluid: BLOCK_TYPES.WATER,       surface: [BLOCK_TYPES.STONE, BLOCK_TYPES.STONE],  baseHeight: 55, heightScale: 2.0 },
      LAVA:      { id: 'lava',      fluid: BLOCK_TYPES.LAVA,        surface: [BLOCK_TYPES.BLACKSTONE, BLOCK_TYPES.BLACKSTONE], baseHeight: 30, heightScale: 0.8 },
      CORRUPT:   { id: 'corrupt',   fluid: BLOCK_TYPES.TOXIC_SLIME, surface: [BLOCK_TYPES.CORRUPT_STONE, BLOCK_TYPES.OBSIDIAN], baseHeight: 32, heightScale: 0.9 }
    };
  }

  getBiome(temp, humidity, continentalness, erosion) {
    // 1. Ocean check FIRST — low continentalness always means water
    if (continentalness < 0.38) return this.BIOMES.OCEAN;

    // 2. Mountains (High continentalness + moderate erosion)
    if (continentalness > 0.65 && erosion < 0.55) return this.BIOMES.MOUNTAINS;

    // 3. Climate Grid — temperature primary, humidity secondary
    // Lava is now subsurface-only, placed like caves at low depth
    const isHot = temp > 0.48;   // wider hot band → more desert/jungle territory
    const isCold = temp < 0.36;  // ~17% of land (after contrast stretch)
    const isDry = humidity < 0.42;

    if (isHot && isDry) return this.BIOMES.DESERT;       // hot + dry → desert
    if (isCold) return this.BIOMES.TUNDRA;                // cold → tundra regardless of moisture
    if (isHot) return this.BIOMES.FOREST;                 // hot + humid → forest/jungle
    
    // Moderate temperature — humidity decides: dry → plains, wet → forest
    return isDry ? this.BIOMES.PLAINS : this.BIOMES.FOREST;
  }

  /**
   * Smoothstep interpolation — S-curve for seamless biome transitions.
   */
  _smoothstep(t) {
    return t * t * (3 - 2 * t);
  }

  /**
   * Blend between two biomes' height properties for smooth terrain transitions.
   * Returns blended baseHeight and heightScale based on proximity to biome boundary.
   * blendFactor: 0 = fully primary, 1 = fully secondary.
   */
  blendBiomeHeights(primary, secondary, blendFactor) {
    const t = this._smoothstep(Math.max(0, Math.min(1, blendFactor)));
    return {
      baseHeight: primary.baseHeight + (secondary.baseHeight - primary.baseHeight) * t,
      heightScale: primary.heightScale + (secondary.heightScale - primary.heightScale) * t
    };
  }
}

if (typeof module !== 'undefined') module.exports = { BiomeSystem };