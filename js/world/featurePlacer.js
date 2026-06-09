/**
 * Cuubz — Feature Placer
 * Cacti, flowers, quest markers, dungeons in appropriate biomes.
 * Uses deterministic hash-based placement (NOT perlin noise) for uniform distribution.
 * Includes biome visual polish: flower variety, glowstone in caves.
 *
 * NOTE: Tree spawning is handled exclusively by WorldGenerator._spawnTree().
 * Do NOT add tree placement here — see worldGenerator.js as the single source of truth.
 */

// Use globals from chunkData.js: BLOCK_TYPES, MIN_Y, MAX_Y
// Use global NoiseGenerator (defined by noise.js)

class FeaturePlacer {
  constructor(seed) {
    this.seed = seed;
    this.noise = new NoiseGenerator(seed);
    
    // Feature density per biome — keys match biome name lowercased with spaces removed.
    this.featureDensity = {
      plains:     { flowers: 0.05, cacti: 0 },
      forest:     { flowers: 0.03, cacti: 0 },
      desert:     { flowers: 0, cacti: 0.04 },
      tundra:     { flowers: 0, cacti: 0 },
      mountains:  { flowers: 0, cacti: 0 },
      frozenpeaks:{ flowers: 0, cacti: 0 },
      badlands:   { flowers: 0, cacti: 0.02 },
      beach:      { flowers: 0, cacti: 0 },
      ocean:      { flowers: 0, cacti: 0, coral: 0.02 },        // Deep Ocean → 'ocean' key via biome.id fallback
      deepocean:  { flowers: 0, cacti: 0, coral: 0.01 },         // Deep Ocean biome
    };
    this.flowerTypes = [
      { type: BLOCK_TYPES.RED_FLOWER, name: 'red', color: '#cc3333' },
      { type: BLOCK_TYPES.YELLOW_FLOWER, name: 'yellow', color: '#cccc33' },
    ];

    // Quest marker positions cache
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
        
        // Get biome for this position — supports old {id:'plains'} and VoxelGen {name:'Plains'}.
        const biome = biomeAt ? biomeAt(wx, wz) : { name: 'Plains', id: 'plains' };
        const biomeKey = biome.id || (biome.name ? biome.name.toLowerCase().replace(/\s+/g, '') : '');
        const density = this.featureDensity[biomeKey];
        if (!density) continue;
        
        // Use hash for uniform random placement (NOT perlin — perlin is spatially smooth)
        const featureRoll = this.noise.hash(wx, wz); // Uniform [0, 1)

        if (featureRoll < density.flowers) {
          this._placeFlower(chunk, lx, surfaceY, lz, wx, wz);
        } else if (density.cacti && featureRoll < density.flowers + density.cacti) {
          this._placeCactus(chunk, lx, surfaceY, lz);
        } else if (density.coral && featureRoll < density.coral) {
          this._placeCoral(chunk, lx, surfaceY, lz);
        }
      }
    }
  }

  /**
   * Find the surface Y at a position in the chunk
   */
  _findSurface(chunk, lx, lz) {
    // Search from top down (MAX_Y - 1 is the highest valid Y)
    for (let y = MAX_Y - 1; y >= MIN_Y; y--) {
      const block = chunk.getBlock(lx, y, lz);
      if (block !== BLOCK_TYPES.AIR && block !== BLOCK_TYPES.WATER && block !== BLOCK_TYPES.LEAVES) {
        return Math.min(y + 1, MAX_Y - 1); // Clamp to valid bounds
      }
    }
    return null;
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