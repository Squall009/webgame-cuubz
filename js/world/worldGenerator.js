/**
 * Cuubz — World Generator
 * Terrain generation with edge-seamless matching.
 */

// Use globals from chunkData.js: Chunk, BLOCK_TYPES, SEA_LEVEL, MIN_Y, MAX_Y, CHUNK_WIDTH, CHUNK_DEPTH
// Use global NoiseGenerator (defined by noise.js)
// Use globals from biomeSystem.js: BiomeSystem, BIOMES

class WorldGenerator {
  constructor(seed = Math.floor(Math.random() * 100000)) {
    this.seed = seed;
    
    // Noise generators with different seeds for variety
    this.heightNoise = new NoiseGenerator(seed);
    this.biomeTempNoise = new NoiseGenerator(seed + 1);
    this.biomeMoistureNoise = new NoiseGenerator(seed + 2);
    this.caveNoise = new NoiseGenerator(seed + 3);
    this.oreNoise = new NoiseGenerator(seed + 4);
    
    this.biomeSystem = new BiomeSystem(this.biomeTempNoise, this.biomeMoistureNoise);
    
    // Water level
    this.waterLevel = SEA_LEVEL;
  }

  /**
   * Generate a complete chunk at the given coordinates
   */
  generateChunk(chunkX, chunkZ) {
    const chunk = new Chunk(chunkX, chunkZ);
    
    const worldStartX = chunk.worldX;
    const worldStartZ = chunk.worldZ;
    
    // Pre-compute biome for each column (for performance)
    const biomeCache = new Map();
    
    for (let lx = 0; lx < CHUNK_WIDTH; lx++) {
      for (let lz = 0; lz < CHUNK_DEPTH; lz++) {
        const wx = worldStartX + lx;
        const wz = worldStartZ + lz;
        
        // Get biome for this column
        const biomeKey = `${Math.floor(wx / 16)},${Math.floor(wz / 16)}`;
        if (!biomeCache.has(biomeKey)) {
          biomeCache.set(biomeKey, this.biomeSystem.getBiome(wx, wz));
        }
        const biome = biomeCache.get(biomeKey);
        
        // Generate heightmap for this column
        const height = this._getHeight(wx, wz, biome);
        
        // Fill column from bottom to top
        for (let y = MIN_Y; y <= MAX_Y; y++) {
          let blockType = BLOCK_TYPES.AIR;
          
          if (y < MIN_Y + 2) {
            // Bedrock layer at bottom
            blockType = BLOCK_TYPES.BEDROCK;
          } else if (y < height - 4) {
            // Deep underground — stone with potential ores/caves
            blockType = this._getUndergroundBlock(wx, y, wz, biome);
          } else if (y < height) {
            // Transition zone — dirt/stone mix
            blockType = this._getTransitionBlock(y, height, biome);
          } else if (y === height) {
            // Surface block based on biome
            blockType = this.biomeSystem.getSurfaceBlock(biome, height);
            
            // Special biome surfaces
            if (biome === BIOMES.DESERT) blockType = BLOCK_TYPES.SAND;
            else if (biome === BIOMES.TUNDRA && height >= SEA_LEVEL) blockType = BLOCK_TYPES.SNOW;
            else if (biome === BIOMES.LAVA) blockType = BLOCK_TYPES.BLACKSTONE;
            else if (biome === BIOMES.CORRUPT) blockType = BLOCK_TYPES.CORRUPT_STONE;
          } else if (y <= this.waterLevel && y > height) {
            // Water fill up to sea level
            blockType = BLOCK_TYPES.WATER;
          }
          
          chunk.setBlock(lx, y, lz, blockType);
        }
      }
    }
    
    return chunk;
  }

  /**
   * Calculate terrain height at world coordinates
   */
  _getHeight(wx, wz, biome) {
    // Base height from noise (multi-octave for detail)
    const baseHeight = this.heightNoise.octaveNoise2(
      wx * 0.005, wz * 0.005, 4, 0.5
    );
    
    // Apply biome height modifier
    const modifier = biome ? biome.heightModifier : 0.4;
    
    // Map noise (-1 to 1) to height range
    const normalizedHeight = (baseHeight + 1) / 2; // 0-1
    
    let minHeight, maxHeight;
    if (biome === BIOMES.OCEAN) {
      minHeight = -30;
      maxHeight = -5;
    } else if (biome === BIOMES.MOUNTAINS) {
      minHeight = 8;
      maxHeight = 45;
    } else if (biome === BIOMES.LAVA) {
      minHeight = -2;
      maxHeight = 3;
    } else if (biome === BIOMES.CORRUPT) {
      minHeight = -1;
      maxHeight = 4;
    } else {
      minHeight = -5;
      maxHeight = 15;
    }
    
    return Math.floor(minHeight + normalizedHeight * (maxHeight - minHeight) * modifier);
  }

  /**
   * Get underground block with cave and ore generation
   */
  _getUndergroundBlock(wx, y, wz, biome) {
    // Cave detection using 3D noise thresholding
    const caveValue = this.caveNoise.octaveNoise3(
      wx * 0.05, y * 0.08, wz * 0.05, 3, 0.5
    );
    
    if (caveValue > 0.3) {
      return BLOCK_TYPES.AIR; // Cave space
    }
    
    // Start with stone
    let block = BLOCK_TYPES.STONE;
    
    // Ore generation based on depth and noise
    const oreValue = this.oreNoise.perlin3(wx * 0.1, y * 0.1, wz * 0.1);
    
    if (y < -20 && oreValue > 0.7) {
      block = BLOCK_TYPES.DIAMOND_ORE; // Diamond deep underground
    } else if (y < -10 && oreValue > 0.6) {
      block = BLOCK_TYPES.GOLD_ORE; // Gold at medium depth
    } else if (y < 0 && oreValue > 0.5) {
      block = BLOCK_TYPES.IRON_ORE; // Iron above sea level underground
    } else if (oreValue > 0.45) {
      block = BLOCK_TYPES.COAL_ORE; // Coal everywhere shallow
    }
    
    // Biome-specific underground
    if (biome === BIOMES.LAVA && y < -10 && Math.random() < 0.02) {
      block = BLOCK_TYPES.LAVA;
    }
    if (biome === BIOMES.CORRUPT && y < 0 && Math.random() < 0.01) {
      block = BLOCK_TYPES.CORRUPT_CRYSTAL;
    }
    
    return block;
  }

  /**
   * Get transition zone block (between bedrock/stone and surface)
   */
  _getTransitionBlock(y, height, biome) {
    const distFromSurface = height - y;
    
    if (biome === BIOMES.DESERT) return BLOCK_TYPES.SAND;
    if (biome === BIOMES.TUNDRA) return distFromSurface <= 2 ? BLOCK_TYPES.SNOW : BLOCK_TYPES.STONE;
    if (biome === BIOMES.LAVA) return BLOCK_TYPES.BLACKSTONE;
    if (biome === BIOMES.CORRUPT) return BLOCK_TYPES.CORRUPT_STONE;
    
    // Plains, Forest, Mountains: dirt near surface, stone below
    return distFromSurface <= 3 ? BLOCK_TYPES.DIRT : BLOCK_TYPES.STONE;
  }

  /**
   * Generate a world with a given seed (for testing/reproducibility)
   */
  generateWorld(seed, chunkCount = 100) {
    this.seed = seed;
    this.heightNoise = new NoiseGenerator(seed);
    this.biomeTempNoise = new NoiseGenerator(seed + 1);
    this.biomeMoistureNoise = new NoiseGenerator(seed + 2);
    this.caveNoise = new NoiseGenerator(seed + 3);
    this.oreNoise = new NoiseGenerator(seed + 4);
    this.biomeSystem = new BiomeSystem(this.biomeTempNoise, this.biomeMoistureNoise);
    
    const chunks = [];
    for (let i = 0; i < chunkCount; i++) {
      const cx = Math.floor(i / 10) - 5;
      const cz = i % 10 - 5;
      chunks.push(this.generateChunk(cx, cz));
    }
    
    return chunks;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = WorldGenerator;

}