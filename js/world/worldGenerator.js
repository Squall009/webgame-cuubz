/**
 * Cuubz — World Generator (Rewritten)
 * Terrain generation with clear layer structure:
 * - Layer 0: Bedrock
 * - Layers 1-32: Ground and caves (at or below sea level)
 * - Layers 33-96: Mountains, air, trees
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
    
    // Water level at sea level (layer 32)
    this.waterLevel = SEA_LEVEL;
  }

  /**
   * Generate a complete chunk at the given coordinates
   */
  generateChunk(chunkX, chunkZ) {
    const chunk = new Chunk(chunkX, chunkZ);

    const worldStartX = chunk.worldX;
    const worldStartZ = chunk.worldZ;

    // Pre-compute biome for this chunk
    const biomeKey = `${Math.floor(worldStartX / 16)},${Math.floor(worldStartZ / 16)}`;
    const biome = this.biomeSystem.getBiome(worldStartX, worldStartZ);

    let totalBlocksGenerated = 0;

    // Generate terrain column by column
    for (let lx = 0; lx < CHUNK_WIDTH; lx++) {
      for (let lz = 0; lz < CHUNK_DEPTH; lz++) {
        const wx = worldStartX + lx;
        const wz = worldStartZ + lz;

        // Calculate surface height based on noise and biome
        const surfaceHeight = this._getSurfaceHeight(wx, wz, biome);

        // Fill column from bottom to top
        for (let y = MIN_Y; y < MAX_Y; y++) {
          let blockType = BLOCK_TYPES.AIR;

          if (y === 0) {
            // Layer 0: Bedrock
            blockType = BLOCK_TYPES.BEDROCK;
          } else if (y < surfaceHeight - 4 && y <= SEA_LEVEL) {
            // Deep underground (below sea level): stone with ores/caves
            blockType = this._getUndergroundBlock(wx, y, wz, biome);
            
            // Cave generation using noise
            const caveValue = this.caveNoise.perlin3(wx * 0.05, y * 0.1, wz * 0.05);
            if (caveValue > 0.6 && y < surfaceHeight - 2) {
              blockType = BLOCK_TYPES.AIR; // Cave!
            }
          } else if (y < surfaceHeight && y <= SEA_LEVEL) {
            // Transition zone near surface (below sea level): dirt/stone mix
            const distFromSurface = surfaceHeight - y;
            blockType = distFromSurface <= 2 ? BLOCK_TYPES.DIRT : BLOCK_TYPES.STONE;
            
            // Water fill if below sea level and no solid ground
            if (y < this.waterLevel && blockType === BLOCK_TYPES.AIR) {
              blockType = BLOCK_TYPES.WATER;
            }
          } else if (y === surfaceHeight) {
            // Surface block based on biome
            if (biome === BIOMES.DESERT) {
              blockType = BLOCK_TYPES.SAND;
            } else if (biome === BIOMES.TUNDRA && y >= SEA_LEVEL) {
              blockType = BLOCK_TYPES.SNOW;
            } else if (biome === BIOMES.LAVA) {
              blockType = BLOCK_TYPES.BLACKSTONE;
            } else if (biome === BIOMES.CORRUPT) {
              blockType = BLOCK_TYPES.CORRUPT_STONE;
            } else {
              blockType = BLOCK_TYPES.GRASS; // Default: grass
            }
            
            // Water fill if surface is below sea level
            if (y < this.waterLevel && blockType !== BLOCK_TYPES.WATER) {
              blockType = BLOCK_TYPES.WATER;
            }
          } else if (y > surfaceHeight && y <= SEA_LEVEL) {
            // Above surface but still at or below sea level: water fill
            if (y <= this.waterLevel) {
              blockType = BLOCK_TYPES.WATER;
            }
          }

          if (blockType !== 0) totalBlocksGenerated++;
          chunk.setBlock(lx, y, lz, blockType);
        }

        // Generate trees on surface (only above sea level)
        if (surfaceHeight > SEA_LEVEL && surfaceHeight < MAX_Y - 10) {
          const treeNoise = this.heightNoise.perlin2(wx * 0.5, wz * 0.5);
          if (treeNoise > 0.7 && Math.random() < 0.3) {
            this._generateTree(chunk, lx, surfaceHeight + 1, lz);
          }
        }
      }
    }

    console.log(`[WorldGen] Chunk ${chunkX},${chunkZ}: generated ${totalBlocksGenerated} blocks.`);

    return chunk;
  }

  /**
   * Calculate surface height at world coordinates
   */
  _getSurfaceHeight(wx, wz, biome) {
    // Base height from noise (multi-octave for detail)
    const baseHeight = this.heightNoise.octaveNoise2(
      wx * 0.015, wz * 0.015, 4, 0.5
    );
    
    // Apply biome height modifier
    const modifier = biome ? biome.heightModifier : 0.4;
    
    // Map noise (-1 to 1) to height range based on biome
    const normalizedHeight = (baseHeight + 1) / 2; // 0-1
    
    let minHeight, maxHeight;
    if (biome === BIOMES.OCEAN) {
      minHeight = SEA_LEVEL - 5;
      maxHeight = SEA_LEVEL - 2;
    } else if (biome === BIOMES.MOUNTAINS) {
      minHeight = SEA_LEVEL + 10;
      maxHeight = MAX_Y - 10;
    } else if (biome === BIOMES.LAVA) {
      minHeight = SEA_LEVEL - 2;
      maxHeight = SEA_LEVEL + 3;
    } else if (biome === BIOMES.CORRUPT) {
      minHeight = SEA_LEVEL - 1;
      maxHeight = SEA_LEVEL + 4;
    } else {
      // Plains, Forest, Desert, Tundra: moderate terrain
      minHeight = SEA_LEVEL - 5;
      maxHeight = SEA_LEVEL + 20;
    }
    
    return Math.floor(minHeight + normalizedHeight * (maxHeight - minHeight));
  }

  /**
   * Get underground block with ore generation and caves
   */
  _getUndergroundBlock(wx, y, wz, biome) {
    // Start with stone
    let block = BLOCK_TYPES.STONE;
    
    // Ore generation based on depth and noise
    const oreValue = this.oreNoise.perlin3(wx * 0.1, y * 0.1, wz * 0.1);
    
    if (y < SEA_LEVEL - 20 && oreValue > 0.7) {
      block = BLOCK_TYPES.DIAMOND_ORE; // Diamond deep underground
    } else if (y < SEA_LEVEL - 10 && oreValue > 0.6) {
      block = BLOCK_TYPES.GOLD_ORE; // Gold at medium depth
    } else if (y < SEA_LEVEL && oreValue > 0.5) {
      block = BLOCK_TYPES.IRON_ORE; // Iron above sea level underground
    } else if (oreValue > 0.45) {
      block = BLOCK_TYPES.COAL_ORE; // Coal everywhere shallow
    }
    
    // Biome-specific underground
    if (biome === BIOMES.LAVA && y < SEA_LEVEL - 10 && Math.random() < 0.02) {
      block = BLOCK_TYPES.LAVA;
    }
    if (biome === BIOMES.CORRUPT && y < SEA_LEVEL && Math.random() < 0.01) {
      block = BLOCK_TYPES.CORRUPT_CRYSTAL;
    }
    
    return block;
  }

  /**
   * Generate a tree at the given position
   */
  _generateTree(chunk, x, y, z) {
    const trunkHeight = 4 + Math.floor(Math.random() * 3); // 4-6 blocks tall
    
    // Trunk
    for (let i = 0; i < trunkHeight && y + i < MAX_Y; i++) {
      chunk.setBlock(x, y + i, z, BLOCK_TYPES.WOOD_LOG);
    }
    
    // Leaves (simple sphere-ish shape)
    const leafStartY = y + trunkHeight - 2;
    const leafEndY = y + trunkHeight + 1;
    for (let ly = leafStartY; ly <= leafEndY && ly < MAX_Y; ly++) {
      for (let lx = x - 2; lx <= x + 2; lx++) {
        for (let lz = z - 2; lz <= z + 2; lz++) {
          if (lx >= 0 && lx < CHUNK_WIDTH && lz >= 0 && lz < CHUNK_DEPTH) {
            const dist = Math.abs(lx - x) + Math.abs(ly - y - trunkHeight) + Math.abs(lz - z);
            if (dist <= 3) {
              // Don't overwrite trunk
              if (!(lx === x && lz === z && ly >= y && ly < y + trunkHeight)) {
                chunk.setBlock(lx, ly, lz, BLOCK_TYPES.LEAVES);
              }
            }
          }
        }
      }
    }
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
