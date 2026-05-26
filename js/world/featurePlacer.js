/**
 * Cuubz — Feature Placer
 * Trees, cacti, flowers, quest markers, dungeons in appropriate biomes.
 * Uses deterministic hash-based placement (NOT perlin noise) for uniform distribution.
 * Includes biome visual polish: flower variety, tree density variation, glowstone in caves.
 */

// Use globals from chunkData.js: BLOCK_TYPES, MIN_Y, MAX_Y
// Use global NoiseGenerator (defined by noise.js)

class FeaturePlacer {
  constructor(seed) {
    this.seed = seed;
    this.noise = new NoiseGenerator(seed);
    
    // Feature density per biome (chance per block column)
    this.featureDensity = {
      plains:   { trees: 0.02, flowers: 0.05, cacti: 0 },
      forest:   { trees: 0.08, flowers: 0.03, cacti: 0 },
      desert:   { trees: 0, flowers: 0, cacti: 0.04 },
      tundra:   { trees: 0.01, flowers: 0, cacti: 0 },
      mountains:{ trees: 0.005, flowers: 0, cacti: 0 },
      ocean:    { trees: 0, flowers: 0, cacti: 0, coral: 0.02 },
      lava:     { trees: 0, flowers: 0, cacti: 0, lavaPool: 0.03 },
      corrupt:  { trees: 0, flowers: 0, cacti: 0, toxicPool: 0.02, crystals: 0.01 },
    };

    // Flower types and their colors for variety in Plains biomes
    this.flowerTypes = [
      { type: BLOCK_TYPES.RED_FLOWER, name: 'red', color: '#cc3333' },
      { type: BLOCK_TYPES.YELLOW_FLOWER, name: 'yellow', color: '#cccc33' },
    ];

    // Forest density variation range (noise-based multiplier)
    this.forestDensityVariation = { min: 0.5, max: 1.5 };
  }

  /**
   * Place all features in a chunk based on biome data
   */
  placeFeatures(chunk, biomeAt) {
    for (let lx = 0; lx < 16; lx++) {
      for (let lz = 0; lz < 16; lz++) {
        const wx = chunk.worldX + lx;
        const wz = chunk.worldZ + lz;
        
        // Find surface height at this position
        const surfaceY = this._findSurface(chunk, lx, lz);
        if (surfaceY === null) continue;
        
        // Get biome for this position
        const biome = biomeAt ? biomeAt(wx, wz) : { id: 'plains' };
        const density = this.featureDensity[biome.id];
        if (!density) continue;
        
        // Use hash for uniform random placement (NOT perlin — perlin is spatially smooth)
        const featureRoll = this.noise.hash(wx, wz); // Uniform [0, 1)
        
        // Calculate effective tree density with noise-based variation for forests
        const effectiveTreeDensity = this._getEffectiveTreeDensity(biome.id, wx, wz, density.trees);
        
        if (featureRoll < effectiveTreeDensity && biome.id !== 'ocean' && biome.id !== 'lava' && biome.id !== 'corrupt') {
          this._placeTree(chunk, lx, surfaceY, lz, biome.id);
        } else if (featureRoll < effectiveTreeDensity + density.flowers) {
          this._placeFlower(chunk, lx, surfaceY, lz, wx, wz);
        } else if (density.cacti && featureRoll < effectiveTreeDensity + density.flowers + density.cacti) {
          this._placeCactus(chunk, lx, surfaceY, lz);
        } else if (density.coral && featureRoll < density.coral) {
          this._placeCoral(chunk, lx, surfaceY, lz);
        } else if (density.lavaPool && featureRoll < density.lavaPool) {
          this._placeLavaPool(chunk, lx, surfaceY, lz);
        } else if (density.toxicPool && featureRoll < density.toxicPool) {
          this._placeToxicPool(chunk, lx, surfaceY, lz);
        } else if (density.crystals && featureRoll < density.crystals) {
          this._placeCorruptCrystal(chunk, lx, surfaceY, lz);
        }
      }
    }
  }

  /**
   * Get effective tree density with noise-based variation for forests
   * For forest biomes, uses perlin noise to create natural clustering
   */
  _getEffectiveTreeDensity(biomeId, wx, wz, baseDensity) {
    if (biomeId !== 'forest') return baseDensity;
    
    // Use low-frequency noise for density variation (creates clusters)
    const noiseVal = this.noise.perlin2(wx * 0.01, wz * 0.01); // [-1, 1]
    const normalized = (noiseVal + 1) / 2; // [0, 1]
    const variation = this.forestDensityVariation.min + 
                      normalized * (this.forestDensityVariation.max - this.forestDensityVariation.min);
    
    return baseDensity * variation;
  }

  /**
   * Find the surface Y at a position in the chunk
   */
  _findSurface(chunk, lx, lz) {
    // Search from top down (MAX_Y - 1 is the highest valid Y)
    for (let y = MAX_Y - 1; y >= MIN_Y; y--) {
      const block = chunk.getBlock(lx, y, lz);
      if (block !== BLOCK_TYPES.AIR && block !== BLOCK_TYPES.WATER && block !== BLOCK_TYPES.LEAVES) {
        return y + 1; // Return the air block above surface
      }
    }
    return null;
  }

  /**
   * Place a tree at the given position
   * Forest trees are taller with wider canopies than plains trees
   */
  _placeTree(chunk, lx, surfaceY, lz, biomeId) {
    // Use seeded PRNG for deterministic trunk height and apple placement
    const rng = this.noise.createPRNG(lx * 1000 + lz);
    
    let trunkHeight, leafRadius;
    if (biomeId === 'forest') {
      // Forest trees: taller (5-7 blocks), wider canopy (radius 2-3)
      trunkHeight = 5 + Math.floor(rng() * 3); // 5-7 blocks tall
      leafRadius = 2 + Math.floor(rng() * 2); // radius 2-3
    } else {
      // Plains/mountain trees: shorter (4-5 blocks), standard canopy
      trunkHeight = 4 + Math.floor(rng() * 2); // 4-5 blocks tall
      leafRadius = 2;
    }
    
    // Trunk
    for (let y = 0; y < trunkHeight; y++) {
      chunk.setBlock(lx, surfaceY + y, lz, BLOCK_TYPES.WOOD_LOG);
    }
    
    // Leaves — sphere-like canopy
    const leafStart = surfaceY + trunkHeight - 2;
    
    for (let dx = -leafRadius; dx <= leafRadius; dx++) {
      for (let dy = -1; dy <= 2; dy++) {
        for (let dz = -leafRadius; dz <= leafRadius; dz++) {
          const nx = lx + dx;
          const ny = leafStart + dy;
          const nz = lz + dz;
          
          if (nx < 0 || nx >= 16 || nz < 0 || nz >= 16) continue;
          
          const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
          if (dist <= leafRadius) {
            const existing = chunk.getBlock(nx, ny, nz);
            if (existing === BLOCK_TYPES.AIR) {
              chunk.setBlock(nx, ny, nz, BLOCK_TYPES.LEAVES);
            }
          }
        }
      }
    }
    
    // Place apples on some trees (30% chance, deterministic)
    if (rng() < 0.3) {
      const appleY = leafStart + 1;
      const appleX = lx + (rng() > 0.5 ? 1 : -1);
      const appleZ = lz;
      if (appleX >= 0 && appleX < 16) {
        chunk.setBlock(appleX, appleY, appleZ, BLOCK_TYPES.APPLE);
      }
    }
  }

  /**
   * Place a flower on the surface — variety based on world position hash
   */
  _placeFlower(chunk, lx, surfaceY, lz, wx, wz) {
    // Deterministic flower type selection based on world position
    const flowerHash = this.noise.hash(wx + 100, wz + 100); // Offset to avoid collision with feature hash
    
    if (flowerHash < 0.5) {
      chunk.setBlock(lx, surfaceY, lz, BLOCK_TYPES.RED_FLOWER);
    } else {
      chunk.setBlock(lx, surfaceY, lz, BLOCK_TYPES.YELLOW_FLOWER);
    }

    // Sometimes place a second flower nearby for clusters (20% chance)
    if (flowerHash > 0.8 && flowerHash < 0.95) {
      const dx = Math.floor(this.noise.hash(wx + 200, wz)) * 3 - 1; // -1, 0, or 1
      const dz = Math.floor(this.noise.hash(wx, wz + 200)) * 3 - 1;
      const nx = lx + dx;
      const nz = lz + dz;
      if (nx >= 0 && nx < 16 && nz >= 0 && nz < 16) {
        const secondaryType = flowerHash < 0.5 ? BLOCK_TYPES.YELLOW_FLOWER : BLOCK_TYPES.RED_FLOWER;
        chunk.setBlock(nx, surfaceY, nz, secondaryType);
      }
    }
  }

  /**
   * Place a cactus in desert biome
   */
  _placeCactus(chunk, lx, surfaceY, lz) {
    const rng = this.noise.createPRNG(lx * 1000 + lz + 777);
    const height = 2 + Math.floor(rng() * 3); // 2-4 blocks tall
    
    for (let y = 0; y < height; y++) {
      chunk.setBlock(lx, surfaceY + y, lz, BLOCK_TYPES.WOOD_LOG); // Using wood_log as cactus placeholder
    }
  }

  /**
   * Place coral structures in ocean biome
   */
  _placeCoral(chunk, lx, surfaceY, lz) {
    const rng = this.noise.createPRNG(lx * 1000 + lz + 888);
    const height = 2 + Math.floor(rng() * 2);
    
    for (let y = 0; y < height; y++) {
      chunk.setBlock(lx, surfaceY - y, lz, BLOCK_TYPES.LEAVES); // Coral placeholder
    }
  }

  /**
   * Place a lava pool in lava biome
   */
  _placeLavaPool(chunk, lx, surfaceY, lz) {
    const radius = 2;
    
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const nx = lx + dx;
        const nz = lz + dz;
        
        if (nx < 0 || nx >= 16 || nz < 0 || nz >= 16) continue;
        
        const dist = Math.sqrt(dx*dx + dz*dz);
        if (dist <= radius) {
          chunk.setBlock(nx, surfaceY - 1, nz, BLOCK_TYPES.LAVA);
        }
      }
    }
  }

  /**
   * Place toxic pool in corrupt biome
   */
  _placeToxicPool(chunk, lx, surfaceY, lz) {
    const radius = 2;
    
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const nx = lx + dx;
        const nz = lz + dz;
        
        if (nx < 0 || nx >= 16 || nz < 0 || nz >= 16) continue;
        
        const dist = Math.sqrt(dx*dx + dz*dz);
        if (dist <= radius) {
          chunk.setBlock(nx, surfaceY - 1, nz, BLOCK_TYPES.TOXIC_SLIME);
        }
      }
    }
  }

  /**
   * Place corrupt crystal (quest item) in corrupt biome
   */
  _placeCorruptCrystal(chunk, lx, surfaceY, lz) {
    chunk.setBlock(lx, surfaceY, lz, BLOCK_TYPES.CORRUPT_CRYSTAL);
  }

  /**
   * Place glowstone veins in cave systems
   * Called during cave generation to add light sources underground
   */
  placeGlowstoneInCaves(chunk, biomeAt) {
    // Glowstone appears rarely in cave spaces (air pockets below surface)
    for (let lx = 0; lx < 16; lx++) {
      for (let lz = 0; lz < 16; lz++) {
        const wx = chunk.worldX + lx;
        const wz = chunk.worldZ + lz;
        
        // Check columns in underground region (below surface)
        const surfaceY = this._findSurface(chunk, lx, lz);
        if (surfaceY === null) continue;
        
        for (let y = MIN_Y + 1; y < Math.max(MIN_Y + 1, surfaceY - 5); y++) {
          const block = chunk.getBlock(lx, y, lz);
          
          // Only place in cave air spaces (not bedrock level)
          if (block !== BLOCK_TYPES.AIR) continue;
          
          // Check if this is a cave space (surrounded by stone on multiple sides)
          const surroundingSolid = 
            chunk.getBlock(lx, y + 1, lz) !== BLOCK_TYPES.AIR ||
            (lx > 0 && chunk.getBlock(lx - 1, y, lz) !== BLOCK_TYPES.AIR) ||
            (lx < 15 && chunk.getBlock(lx + 1, y, lz) !== BLOCK_TYPES.AIR) ||
            (lz > 0 && chunk.getBlock(lx, y, lz - 1) !== BLOCK_TYPES.AIR) ||
            (lz < 15 && chunk.getBlock(lx, y, lz + 1) !== BLOCK_TYPES.AIR);
          
          if (!surroundingSolid) continue; // Open space, not a cave
            
          // Rare placement: ~0.3% chance per underground air block
          const glowstoneRoll = this.noise.hash(wx + 500, wz + 500 + y * 7);
          if (glowstoneRoll < 0.003) {
            chunk.setBlock(lx, y, lz, BLOCK_TYPES.GLOWSTONE);
          }
        }
      }
    }
  }

  /**
   * Place quest markers at deterministic locations based on world seed
   */
  placeQuestMarkers(worldSeed, questCount = 25) {
    const markerNoise = new NoiseGenerator(worldSeed + 999);
    const markers = [];
    
    for (let i = 0; i < questCount; i++) {
      // Deterministic position based on quest index and seed
      const x = Math.floor(markerNoise.perlin2(i * 7.1, 3.3) * 500);
      const z = Math.floor(markerNoise.perlin2(i * 3.7, 7.1) * 500);
      
      markers.push({
        questId: i + 1,
        worldX: x,
        worldZ: z,
        chunkX: Math.floor(x / 16),
        chunkZ: Math.floor(z / 16),
      });
    }
    
    return markers;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FeaturePlacer;

}