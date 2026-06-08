/**
 * Cuubz — 3D Density World Generator
 * Implements Phase 1-14 Pipeline with biome-aware terrain generation
 */
class WorldGenerator {
  constructor(seed) {
    // FNV-1a hash for string/number seeds → consistent 32-bit unsigned integer
    this.seed = typeof seed === 'string' ? this._fnv1aHash(seed) : (Number(seed) || 0);
    this.noise = new NoiseGenerator(this.seed);
    this.biomes = new BiomeSystem();

    this.freq = {
      temp: 0.002, humid: 0.002, cont: 0.0006, eros: 0.004,
      ridge: 0.008, detail: 0.032, aquifer: 0.004,
      caveL: 0.008, caveH: 0.032, river: 0.002
    };

    // Pre-cache biome references by ID for quick lookup
    this._biomeMap = {};
    for (const key in this.biomes.BIOMES) {
      this._biomeMap[this.biomes.BIOMES[key].id] = this.biomes.BIOMES[key];
    }
  }

  /**
   * FNV-1a hash — converts string seeds to consistent 32-bit unsigned integers.
   */
  _fnv1aHash(str) {
    let hash = 0x811c9dc5; // FNV offset basis
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193); // FNV prime
    }
    return hash >>> 0; // Unsigned 32-bit
  }

  generateChunk(chunkX, chunkZ) {
    const chunk = new Chunk(chunkX, chunkZ);
    const climateCache = this._sampleClimate(chunk.worldX, chunk.worldZ);
    const biomeCache = Array(16).fill().map(() => Array(16));

    // PHASE 1-2: Sample climates & biomes for entire chunk
    for (let x = 0; x < 16; x++) {
      for (let z = 0; z < 16; z++) {
        const climate = climateCache[x][z];
        biomeCache[x][z] = this.biomes.getBiome(climate.t, climate.h, climate.c, climate.e);
      }
    }

    // PHASE 3-9: Terrain generation with density + caves
    for (let x = 0; x < 16; x++) {
      for (let z = 0; z < 16; z++) {
        const biome = biomeCache[x][z];
        const climate = climateCache[x][z];

        for (let y = 0; y < 96; y++) {
          if (y === 0) { chunk.setBlock(x, y, z, BLOCK_TYPES.BEDROCK); continue; }

          // Biome-blended density calculation
          const density = this._calculateDensityBlended(
            chunk.worldX + x, y, chunk.worldZ + z, biomeCache[x][z], climateCache
          );

          if (density > 0) {
            // Solid terrain — apply cave carving
            const isCave = this._sampleCaves(chunk.worldX + x, y, chunk.worldZ + z);
            if (!isCave) {
              // Check for subsurface lava pockets (never above surface)
              const isLava = this._sampleSubsurfaceLava(chunk.worldX + x, y, chunk.worldZ + z);
              if (isLava) {
                chunk.setBlock(x, y, z, BLOCK_TYPES.LAVA);
              } else {
                // Check Ores
                const ore = this._getOreAt(chunk.worldX + x, y, chunk.worldZ + z);
                chunk.setBlock(x, y, z, ore || BLOCK_TYPES.STONE);
              }
            }
          } else {
            // Air — check for aquifer (underground water, clamped below sea level)
            if (y < 28) {
              const aqNoise = this.noise.perlin3(
                (chunk.worldX + x) * this.freq.aquifer,
                y * this.freq.aquifer,
                (chunk.worldZ + z) * this.freq.aquifer
              );
              if (aqNoise > 0.25) {
                chunk.setBlock(x, y, z, biome.fluid);
              }
            }
          }
        }
      }
    }

    // PHASE 10: River carving post-process pass
    this._carveRivers(chunk, climateCache);

    // PHASE 11: Water fill — flood-fill from ocean biomes up to SEA_LEVEL
    this._fillWater(chunk, biomeCache);

    // PHASE 12: Carvers (large-scale structural features)
    this._applyCarvers(chunk);

    // PHASE 13-14: Surface pass & decorations
    for (let x = 0; x < 16; x++) {
      for (let z = 0; z < 16; z++) {
        const biome = biomeCache[x][z];
        this._applySurfacePass(chunk, x, z, biome);
      }
    }

    return chunk;
  }

  /**
   * Calculate density for a single biome using its baseHeight and heightScale.
   */
  _densityForBiome(wx, y, wz, biome) {
    // Noise terms — ridge noise provides mountain structure
    let dRidge = this.noise.octaveNoise3(
      wx * this.freq.ridge, y * this.freq.ridge, wz * this.freq.ridge, 4
    ) * biome.heightScale;

    let dDetail = this.noise.octaveNoise3(
      wx * this.freq.detail, y * this.freq.detail, wz * this.freq.detail, 2
    ) * 6;

    // Gravity pulls terrain toward baseHeight
    let heightDiff = y - biome.baseHeight;
    let gravity = heightDiff > 0 ? Math.pow(heightDiff, 1.4) : heightDiff * 1.0;

    // Biome-specific shaping
    if (biome.id === 'mountains') {
      gravity *= 0.3; // Mountains resist gravity for tall peaks
      dRidge *= 2.5;
    } else if (biome.id === 'plains') {
      dRidge *= 0.1; // Flatten plains
      gravity *= 2.0; // Push terrain down harder
    }

    return dRidge + dDetail - gravity;
  }

  /**
   * Biome-blended density — determines primary biome and blends with neighbors
   * for smooth transitions at boundaries.
   */
  _calculateDensityBlended(wx, y, wz, primaryBiome, climateCache) {
    // Get local chunk coordinates from world coords
    const lx = ((wx % 16) + 16) % 16;
    const lz = ((wz % 16) + 16) % 16;

    // Check if we're near a biome boundary (within 3 blocks of chunk edge)
    const blendRadius = 3;
    let blendedHeight = primaryBiome.baseHeight;
    let blendedScale = primaryBiome.heightScale;

    // For ocean biomes, force terrain below sea level
    if (primaryBiome.id === 'ocean') {
      blendedHeight = Math.min(primaryBiome.baseHeight, SEA_LEVEL - 4);
      blendedScale *= 0.5;
    }

    // Check neighboring positions for biome blending
    const neighbors = [
      lx > 0 ? { dx: -1, lx2: lx - 1, lz2: lz } : null,
      lx < 15 ? { dx: 1, lx2: lx + 1, lz2: lz } : null,
      lz > 0 ? { dx: 0, lx2: lx, lz2: lz - 1 } : null,
      lz < 15 ? { dx: 0, lx2: lx, lz2: lz + 1 } : null
    ];

    for (const n of neighbors) {
      if (!n) continue;
      const neighborBiome = climateCache[n.lx2]?.[n.lz2] !== undefined
        ? this.biomes.getBiome(
            climateCache[n.lx2][n.lz2].t,
            climateCache[n.lx2][n.lz2].h,
            climateCache[n.lx2][n.lz2].c,
            climateCache[n.lx2][n.lz2].e
          ) : primaryBiome;

      if (neighborBiome.id !== primaryBiome.id) {
        // Calculate blend factor based on distance from edge
        const dist = n.dx !== 0 ? Math.abs(lx - (lx + n.dx)) : Math.abs(lz - (lz + n.lz2));
        const blendFactor = Math.max(0, 1 - dist / blendRadius);

        // Only blend if within the radius of a boundary
        const distanceFromEdge = n.dx < 0 ? lx : (n.dx > 0 ? 15 - lx : (n.lz2 < lz ? lz : 15 - lz));
        if (distanceFromEdge < blendRadius) {
          const bf = Math.max(0, 1 - distanceFromEdge / blendRadius);
          const blended = this.biomes.blendBiomeHeights(primaryBiome, neighborBiome, bf);
          // Weight by how close we are to the boundary
          blendedHeight += (blended.baseHeight - primaryBiome.baseHeight) * bf;
          blendedScale += (blended.heightScale - primaryBiome.heightScale) * bf;
        }
      }
    }

    // Calculate density using blended values
    let dRidge = this.noise.octaveNoise3(
      wx * this.freq.ridge, y * this.freq.ridge, wz * this.freq.ridge, 4
    ) * blendedScale;

    let dDetail = this.noise.octaveNoise3(
      wx * this.freq.detail, y * this.freq.detail, wz * this.freq.detail, 2
    ) * 6;

    let heightDiff = y - blendedHeight;
    let gravity = heightDiff > 0 ? Math.pow(heightDiff, 1.4) : heightDiff * 1.0;

    // Biome-specific shaping on primary biome
    if (primaryBiome.id === 'mountains') {
      gravity *= 0.3;
      dRidge *= 2.5;
    } else if (primaryBiome.id === 'plains') {
      dRidge *= 0.1;
      gravity *= 2.0;
    }

    return dRidge + dDetail - gravity;
  }

  _sampleClimate(wx, wz) {
    let grid = Array(16).fill().map(() => Array(16));
    for (let x = 0; x < 16; x++) {
      for (let z = 0; z < 16; z++) {
        let t = this.noise.octaveNoise2((wx + x) * this.freq.temp, (wz + z) * this.freq.temp, 2);
        let h = this.noise.octaveNoise2((wx + x) * this.freq.humid, (wz + z) * this.freq.humid, 2);
        let c = this.noise.octaveNoise2((wx + x) * this.freq.cont, (wz + z) * this.freq.cont, 3);
        let e = this.noise.octaveNoise2((wx + x) * this.freq.eros, (wz + z) * this.freq.eros, 3);
        // Contrast Stretching — calibrated for target biome distribution:
        // ~20% ocean, 10% tundra, 10% desert, 25% plains, 20% forest, 15% mountains
        grid[x][z] = {
          t: Math.max(0, Math.min(1, t * 1.0 + 0.48)),   // temp: full range [~0, ~0.96]
          h: Math.max(0, Math.min(1, h * 1.2 + 0.35)),   // humidity: shifted LOW → more room for dry biomes (desert/plains)
          c: Math.max(0, Math.min(1, c * 0.7 + 0.48)),   // continentalness: shifted down → more ocean and mountains
          e: Math.max(0, Math.min(1, e * 0.6 + 0.4))     // erosion: less contrast — lava/corrupt are subsurface-only now
        };
      }
    }
    return grid;
  }

  /**
   * Cave sampling using worm technique — continuous paths instead of blobby spheres.
   * Depth-gated: caves only generate below a minimum depth threshold.
   */
  _sampleCaves(wx, y, wz) {
    // No caves in top layers (bedrock layer and shallow surface)
    if (y < 2 || y > 80) return false;

    const low = this.noise.octaveNoise3(
      wx * this.freq.caveL, y * this.freq.caveL, wz * this.freq.caveL, 3
    );
    const high = this.noise.octaveNoise3(
      wx * this.freq.caveH, y * this.freq.caveH, wz * this.freq.caveH, 2
    );

    // Worm technique: sum-of-squares creates elongated tunnel-like voids
    const caveDensity = low * low + high * high;
    const threshold = 0.04; // Smaller = narrower tunnels

    // Depth gating: caves more common at medium depths, rare near surface and bedrock
    const depthFactor = y < 20 ? (y - 2) / 18 : (y > 60 ? (80 - y) / 20 : 1);
    
    return caveDensity < threshold * depthFactor;
  }

  /**
   * Subsurface lava pockets — random molten blobs deep underground.
   * Never generates above surface. Uses similar worm technique to caves but at low depth.
   */
  _sampleSubsurfaceLava(wx, y, wz) {
    // Only in deep layers — never near or above surface
    if (y > 15 || y < 2) return false;

    const n = this.noise.octaveNoise3(
      wx * 0.02 + 7919, y * 0.04 + 104729, wz * 0.02 + 31337, 3
    );

    // Lava pockets: small isolated blobs, more common near bedrock
    const depthFactor = y < 5 ? (y - 1) / 4 : 1; // Increases from 0 at y=2 to 1.0 at y>=6
    return n > 0.70 * depthFactor; // High threshold → rare pockets, ~3-5% of deep terrain
  }

  /**
   * Post-process river carving pass — digs channels along river paths.
   * Rivers flow downhill from source to sea level.
   */
  _carveRivers(chunk, climateCache) {
    // Sample river network across the chunk
    for (let x = 0; x < 16; x++) {
      for (let z = 0; z < 16; z++) {
        const wx = chunk.worldX + x;
        const wz = chunk.worldZ + z;

        // River path determined by low river noise values
        const riverVal = Math.abs(this.noise.perlin2(wx * this.freq.river, wz * this.freq.river));

        if (riverVal < 0.12) {
          // Find surface height at this position — skip water blocks
          let surfaceY = -1;
          for (let y = 95; y >= 0; y--) {
            const block = chunk.getBlock(x, y, z);
            if (block !== BLOCK_TYPES.AIR && block > 0) {
              // Skip water/lava blocks — find actual terrain below
              if (block === BLOCK_TYPES.WATER || block === BLOCK_TYPES.LAVA) continue;
              surfaceY = y;
              break;
            }
          }

          if (surfaceY < 0) continue;

          // Only carve rivers into non-ocean terrain near sea level
          const biomeAtPos = climateCache[x][z] ? this.biomes.getBiome(
            climateCache[x][z].t, climateCache[x][z].h, climateCache[x][z].c, climateCache[x][z].e
          ) : null;
          if (biomeAtPos && biomeAtPos.id === 'ocean') continue;

          // Carve river channel — depth proportional to how "river" the noise value is
          const riverDepth = Math.floor(3 * (1.0 - riverVal / 0.12));
          for (let dy = 0; dy <= riverDepth && surfaceY - dy >= SEA_LEVEL; dy++) {
            const targetY = surfaceY - dy;
            const block = chunk.getBlock(x, targetY, z);
            if (block !== BLOCK_TYPES.AIR) {
              // Fill carved channel with water at/near sea level, stone below
              if (targetY >= SEA_LEVEL) {
                chunk.setBlock(x, targetY, z, BLOCK_TYPES.WATER);
              } else {
                chunk.setBlock(x, targetY, z, BLOCK_TYPES.STONE);
              }
            }
          }
        }
      }
    }
  }

  /**
   * Flood-fill water from ocean biomes up to SEA_LEVEL.
   * Replaces the old aquifer-based water fill with proper ocean/lake filling.
   */
  _fillWater(chunk, biomeCache) {
    for (let x = 0; x < 16; x++) {
      for (let z = 0; z < 16; z++) {
        const biome = biomeCache[x][z];

        // Find surface height
        let surfaceY = -1;
        for (let y = 95; y >= 0; y--) {
          const block = chunk.getBlock(x, y, z);
          if (block !== BLOCK_TYPES.AIR && block > 0) {
            surfaceY = y;
            break;
          }
        }

        if (surfaceY < 0) continue;

        // Ocean biome: fill from surface up to sea level with water
        if (biome.id === 'ocean') {
          for (let y = surfaceY + 1; y <= SEA_LEVEL; y++) {
            chunk.setBlock(x, y, z, BLOCK_TYPES.WATER);
          }
          // Shoreline leveling: flatten terrain at sea level for oceans
          if (surfaceY > SEA_LEVEL) {
            // Gradually slope down to sea level over 3 blocks
            const steps = Math.min(surfaceY - SEA_LEVEL, 3);
            for (let step = 1; step <= steps; step++) {
              const targetY = surfaceY - step;
              if (targetY >= SEA_LEVEL) {
                chunk.setBlock(x, targetY, z, BLOCK_TYPES.SAND);
              }
            }
          }
        }

        // Non-ocean biomes with terrain below sea level: fill water in valleys
        if (biome.id !== 'ocean' && surfaceY < SEA_LEVEL) {
          for (let y = surfaceY + 1; y <= SEA_LEVEL; y++) {
            chunk.setBlock(x, y, z, biome.fluid);
          }
        }
      }
    }
  }

  getBiomeAtWorldPos(wx, wz) {
    let t = this.noise.octaveNoise2(wx * this.freq.temp, wz * this.freq.temp, 2);
    let h = this.noise.octaveNoise2(wx * this.freq.humid, wz * this.freq.humid, 2);
    let c = this.noise.octaveNoise2(wx * this.freq.cont, wz * this.freq.cont, 3);
    let e = this.noise.octaveNoise2(wx * this.freq.eros, wz * this.freq.eros, 3);
    // Contrast Stretching (matches _sampleClimate)
    t = Math.max(0, Math.min(1, t * 1.0 + 0.48));
    h = Math.max(0, Math.min(1, h * 1.2 + 0.35));
    c = Math.max(0, Math.min(1, c * 0.7 + 0.48));
    e = Math.max(0, Math.min(1, e * 0.6 + 0.4));

    return this.biomes.getBiome(t, h, c, e);
  }

  _applySurfacePass(chunk, lx, lz, biome) {
    // Find surface by scanning from top — look for first solid block with air above it
    let surfaceY = -1;
    for (let y = 95; y >= 0; y--) {
      const block = chunk.getBlock(lx, y, lz);
      if (block !== BLOCK_TYPES.AIR && block > 0) {
        // Check if the block above is air — this is our true surface
        const above = chunk.getBlock(lx, y + 1, lz);
        if (above === BLOCK_TYPES.AIR || above === 0 || y >= 95) {
          surfaceY = y;
          break;
        }
      }
    }

    if (surfaceY < 0) return;

    // For ocean biomes, find the ACTUAL terrain below any water column
    const topBlockAtSurface = chunk.getBlock(lx, surfaceY, lz);
    if (biome.id === 'ocean' && topBlockAtSurface === BLOCK_TYPES.WATER) {
      // Scan down through water to find real ground
      for (let y = surfaceY - 1; y >= 0; y--) {
        const b = chunk.getBlock(lx, y, lz);
        if (b !== BLOCK_TYPES.AIR && b !== BLOCK_TYPES.WATER && b > 0) {
          surfaceY = y;
          break;
        }
      }
    }

    // Don't apply surface blocks above sea level for ocean biomes (that's water territory)
    if (biome.id === 'ocean' && surfaceY >= SEA_LEVEL) return;

    // Shoreline leveling: smooth transition at water's edge
    const isAtShoreline = biome.id !== 'ocean' && surfaceY <= SEA_LEVEL + 2;

    // Apply surface blocks
    const topBlock = (biome.id === 'mountains' && surfaceY > 70) ? BLOCK_TYPES.SNOW : biome.surface[0];
    chunk.setBlock(lx, surfaceY, lz, topBlock);

    // Dirt/substrate layer below surface — depth varies by biome
    const substrateDepth = isAtShoreline ? 2 : Math.min(3 + (biome.heightScale * 2) | 0, 6);
    for (let dy = 1; dy <= substrateDepth && surfaceY - dy >= 0; dy++) {
      chunk.setBlock(lx, surfaceY - dy, lz, biome.surface[1]);
    }

    // TODO: Place decorations on the surface block — disabled until terrain is finalized
    // this._placeDecor(chunk, lx, surfaceY, lz, biome);
  }

  _getOreAt(wx, wy, wz) {
    const n = this.noise.octaveNoise3(wx * 0.1, wy * 0.1, wz * 0.1, 2);
    if (n < 0.60) return null; // Ore rarity threshold
    if (wy < 10) return BLOCK_TYPES.DIAMOND_ORE;
    if (wy < 20) return BLOCK_TYPES.GOLD_ORE;
    if (wy < 32) return BLOCK_TYPES.IRON_ORE;
    return BLOCK_TYPES.COAL_ORE;
  }

  _applyCarvers(chunk) {
    const h = this.noise.hash(chunk.chunkX, chunk.chunkZ);
    if (h < 0.04) {
      const rng = this.noise.createPRNG(h * 1000 + chunk.chunkX * 7919 + chunk.chunkZ * 104729);
      let cx = chunk.worldX + 8, cz = chunk.worldZ + 8;
      let cy = 15 + rng() * 30; // Carvers start below surface
      for (let i = 0; i < 40; i++) {
        cx += (rng() - 0.5) * 8;
        cz += (rng() - 0.5) * 8;
        cy += (rng() - 0.5) * 3;
        // Keep carvers underground
        cy = Math.max(2, Math.min(cy, 70));
        this._carveSphere(chunk, cx, cy, cz, 4);
      }
    }
  }

  _carveSphere(chunk, wx, wy, wz, r) {
    const rSq = r * r;
    for (let lx = 0; lx < 16; lx++) {
      for (let lz = 0; lz < 16; lz++) {
        for (let ly = 1; ly < 95; ly++) {
          const dx = (chunk.worldX + lx) - wx, dy = ly - wy, dz = (chunk.worldZ + lz) - wz;
          if (dx * dx + dy * dy + dz * dz < rSq) {
            // Don't carve above sea level to prevent surface holes
            if (ly > SEA_LEVEL || chunk.getBlock(lx, ly, lz) !== BLOCK_TYPES.WATER) {
              chunk.setBlock(lx, ly, lz, BLOCK_TYPES.AIR);
            }
          }
        }
      }
    }
  }

  /**
   * Place decorations using separate hashes per type to avoid correlation.
   * Includes OOB bounds checking before placement.
   */
  _placeDecor(chunk, x, y, z, biome) {
    // Separate hash seeds per decoration category — prevents correlated placement
    const treeHash = this.noise.hash(
      chunk.worldX + x + 31337, chunk.worldZ + z + 73331
    );
    const flowerHash = this.noise.hash(
      chunk.worldX + x + 98245, chunk.worldZ + z + 167853
    );
    const cactusHash = this.noise.hash(
      chunk.worldX + x + 54321, chunk.worldZ + z + 87654
    );

    // OOB bounds check — decorations must fit within chunk/world
    const canPlaceTree = y + 5 < MAX_Y && x >= 0 && x < 16 && z >= 0 && z < 16;
    const canPlaceCactus = y + 3 < MAX_Y && x >= 0 && x < 16 && z >= 0 && z < 16;

    if (biome.id === 'forest' && treeHash < 0.03 && canPlaceTree) {
      this._spawnTree(chunk, x, y, z);
    } else if (biome.id === 'plains' && treeHash < 0.01 && canPlaceTree) {
      this._spawnTree(chunk, x, y, z);
    }

    if (biome.id === 'desert' && cactusHash < 0.03 && canPlaceCactus) {
      this._spawnCactus(chunk, x, y, z);
    }

    // Flowers — use separate hash to avoid competing with trees for same positions
    if (flowerHash < 0.02 && biome.id !== 'ocean' && biome.id !== 'desert') {
      chunk.setBlock(x, y + 1, z, BLOCK_TYPES.RED_FLOWER);
    }
  }

  _spawnTree(chunk, x, y, z) {
    for (let i = 0; i < 5; i++) {
      if (y + i < MAX_Y) chunk.setBlock(x, y + i, z, BLOCK_TYPES.WOOD_LOG);
    }
    // Leaf canopy
    for (let ox = -2; ox <= 2; ox++) {
      for (let oz = -2; oz <= 2; oz++) {
        if (Math.abs(ox) + Math.abs(oz) < 4) {
          const nx = x + ox, nz = z + oz;
          // Only place leaves within chunk bounds or they'll be silently dropped
          if (nx >= 0 && nx < 16 && nz >= 0 && nz < 16 && y + 4 < MAX_Y) {
            chunk.setBlock(nx, y + 4, nz, BLOCK_TYPES.LEAVES);
          }
        }
      }
    }
  }

  _spawnCactus(chunk, x, y, z) {
    for (let i = 0; i < 3; i++) {
      if (y + i < MAX_Y) chunk.setBlock(x, y + i, z, BLOCK_TYPES.SAND);
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = WorldGenerator;
}
