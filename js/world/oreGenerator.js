/**
 * Cuubz — Ore Generator
 * Ore vein placement in caves and mountains with depth-based rarity.
 */

// Use global BLOCK_TYPES from chunkData.js
// Use global NoiseGenerator (defined by noise.js)

class OreGenerator {
  constructor(seed) {
    this.noise = new NoiseGenerator(seed);
    
    // Ore definitions with depth ranges and rarity
    this.ores = {
      [BLOCK_TYPES.COAL_ORE]:     { minY: -50, maxY: 30, rarity: 0.08, veinSize: 4 },
      [BLOCK_TYPES.IRON_ORE]:     { minY: -40, maxY: 0, rarity: 0.05, veinSize: 3 },
      [BLOCK_TYPES.GOLD_ORE]:     { minY: -32, maxY: -5, rarity: 0.03, veinSize: 3 },
      [BLOCK_TYPES.DIAMOND_ORE]:  { minY: -32, maxY: -15, rarity: 0.01, veinSize: 2 },
    };
  }

  /**
   * Place ore veins in a chunk
   * Uses clustered vein patterns (not single scattered blocks)
   */
  placeOres(chunk) {
    for (const [oreType, config] of Object.entries(this.ores)) {
      this._placeVeins(chunk, parseInt(oreType), config);
    }
  }

  /**
   * Place veins of a specific ore type in a chunk
   */
  _placeVeins(chunk, oreType, config) {
    // Find potential vein centers using noise clustering
    const worldX = chunk.worldX;
    const worldZ = chunk.worldZ;
    
    for (let lx = 0; lx < 16; lx++) {
      for (let lz = 0; lz < 16; lz++) {
        const wx = worldX + lx;
        const wz = worldZ + lz;
        
        // Vein center detection using noise clusters
        const clusterValue = this.noise.octaveNoise3(
          wx * 0.08, 0, wz * 0.08, 2, 0.5
        );
        
        if (clusterValue < (1 - config.rarity * 3)) continue; // Not a vein center
        
        // Place a vein around this point
        const rng = this.noise.createPRNG(wx * 1000 + wz);
        const veinRadius = config.veinSize + Math.floor(rng() * 2);
        
        for (let dx = -veinRadius; dx <= veinRadius; dx++) {
          for (let dy = -veinRadius; dy <= veinRadius; dy++) {
            for (let dz = -veinRadius; dz <= veinRadius; dz++) {
              const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
              if (dist > veinRadius) continue;
              
              // Organic vein shape using noise
              const veinNoise = this.noise.perlin3(
                (wx + dx) * 0.2, (dy) * 0.2, (wz + dz) * 0.2
              );
              if (veinNoise < 0.2) continue; // Not part of vein shape
              
              const nx = lx + dx;
              const nz = lz + dz;
              
              if (nx < 0 || nx >= 16 || nz < 0 || nz >= 16) continue;
              
              // Find the surface at this x,z and place ore below it
              for (let y = config.maxY; y >= config.minY; y--) {
                const block = chunk.getBlock(nx, y, nz);
                
                if (block === BLOCK_TYPES.STONE || block === BLOCK_TYPES.GRAVEL) {
                  // Replace with ore
                  chunk.setBlock(nx, y, nz, oreType);
                  break;
                }
                
                if (block === BLOCK_TYPES.AIR) continue; // Already in cave or above surface
              }
            }
          }
        }
      }
    }
  }

  /**
   * Get expected ore density at a given depth
   */
  getOreDensity(y, oreType) {
    const config = this.ores[oreType];
    if (!config) return 0;
    
    if (y < config.minY || y > config.maxY) return 0;
    
    // Peak density in the middle of the range
    const mid = (config.minY + config.maxY) / 2;
    const halfRange = (config.maxY - config.minY) / 2;
    const distanceFromMid = Math.abs(y - mid);
    
    if (distanceFromMid > halfRange) return 0;
    
    // Gaussian-like distribution
    return config.rarity * Math.exp(-Math.pow(distanceFromMid / halfRange, 2));
  }

  /**
   * List all available ore types sorted by rarity (rarest first)
   */
  getOreList() {
    return Object.entries(this.ores)
      .map(([type, config]) => ({
        type: parseInt(type),
        blockType: BLOCK_TYPES[parseInt(type)],
        ...config,
      }))
      .sort((a, b) => a.rarity - b.rarity);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = OreGenerator;

}