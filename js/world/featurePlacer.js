/**
 * Cuubz — Feature Placer
 * Trees, cacti, flowers, quest markers, dungeons in appropriate biomes.
 */

const { BLOCK_TYPES } = require('./chunkData');
const NoiseGenerator = require('./noise');

class FeaturePlacer {
  constructor(seed) {
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
        
        // Use noise to determine feature placement (deterministic per position)
        const featureRoll = this.noise.perlin2(wx * 0.1, wz * 0.1);
        const normalized = (featureRoll + 1) / 2; // 0-1
        
        if (normalized < density.trees && biome.id !== 'ocean' && biome.id !== 'lava' && biome.id !== 'corrupt') {
          this._placeTree(chunk, lx, surfaceY, lz);
        } else if (normalized < density.trees + density.flowers) {
          this._placeFlower(chunk, lx, surfaceY, lz);
        } else if (density.cacti && normalized < density.trees + density.flowers + density.cacti) {
          this._placeCactus(chunk, lx, surfaceY, lz);
        } else if (density.coral && normalized < density.coral) {
          this._placeCoral(chunk, lx, surfaceY, lz);
        } else if (density.lavaPool && normalized < density.lavaPool) {
          this._placeLavaPool(chunk, lx, surfaceY, lz);
        } else if (density.toxicPool && normalized < density.toxicPool) {
          this._placeToxicPool(chunk, lx, surfaceY, lz);
        } else if (density.crystals && normalized < density.crystals) {
          this._placeCorruptCrystal(chunk, lx, surfaceY, lz);
        }
      }
    }
  }

  /**
   * Find the surface Y at a position in the chunk
   */
  _findSurface(chunk, lx, lz) {
    // Search from top down
    for (let y = 64; y >= -32; y--) {
      const block = chunk.getBlock(lx, y, lz);
      if (block !== BLOCK_TYPES.AIR && block !== BLOCK_TYPES.WATER && block !== BLOCK_TYPES.LEAVES) {
        return y + 1; // Return the air block above surface
      }
    }
    return null;
  }

  /**
   * Place a tree at the given position
   */
  _placeTree(chunk, lx, surfaceY, lz) {
    const trunkHeight = 4 + Math.floor(Math.random() * 2); // 4-5 blocks tall
    
    // Trunk
    for (let y = 0; y < trunkHeight; y++) {
      chunk.setBlock(lx, surfaceY + y, lz, BLOCK_TYPES.WOOD_LOG);
    }
    
    // Leaves — sphere-like canopy
    const leafRadius = 2;
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
    
    // Place apples on some trees
    if (Math.random() < 0.3) {
      const appleY = leafStart + 1;
      const appleX = lx + (Math.random() > 0.5 ? 1 : -1);
      const appleZ = lz;
      if (appleX >= 0 && appleX < 16) {
        chunk.setBlock(appleX, appleY, appleZ, BLOCK_TYPES.APPLE);
      }
    }
  }

  /**
   * Place a flower on the surface
   */
  _placeFlower(chunk, lx, surfaceY, lz) {
    // Flowers are decorative — just mark with a special block for now
    // In full implementation, would use a separate entity system
  }

  /**
   * Place a cactus in desert biome
   */
  _placeCactus(chunk, lx, surfaceY, lz) {
    const height = 2 + Math.floor(Math.random() * 3); // 2-4 blocks tall
    
    for (let y = 0; y < height; y++) {
      chunk.setBlock(lx, surfaceY + y, lz, BLOCK_TYPES.WOOD_LOG); // Using wood_log as cactus placeholder
    }
  }

  /**
   * Place coral structures in ocean biome
   */
  _placeCoral(chunk, lx, surfaceY, lz) {
    const height = 2 + Math.floor(Math.random() * 2);
    
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

module.exports = FeaturePlacer;
