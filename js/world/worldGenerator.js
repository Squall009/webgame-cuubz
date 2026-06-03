/**
 * Cuubz — 3D Density World Generator
 * Implements 12-Phase Pipeline
 */
class WorldGenerator {
  constructor(seed) {
    this.seed = seed;
    this.noise = new NoiseGenerator(seed);
    this.biomes = new BiomeSystem();
    
    this.freq = {
      temp: 0.00195, humid: 0.00195, cont: 0.00048, eros: 0.0039, 
      ridge: 0.0078, detail: 0.0312, aquifer: 0.0039, 
      caveL: 0.0078, caveH: 0.0312, river: 0.0019
    };
  }

  generateChunk(chunkX, chunkZ) {
    const chunk = new Chunk(chunkX, chunkZ);
    const climateCache = this._sampleClimate(chunk.worldX, chunk.worldZ);

    // PHASES 1-9: Terrain, Caves, Aquifers
    for (let x = 0; x < 16; x++) {
      for (let z = 0; z < 16; z++) {
        const climate = climateCache[x][z];
        const biome = this.biomes.getBiome(climate.t, climate.h, climate.c, climate.e);
        
        for (let y = 0; y < 96; y++) {
          if (y === 0) { chunk.setBlock(x, y, z, BLOCK_TYPES.BEDROCK); continue; }

          const density = this._calculateDensity(chunk.worldX + x, y, chunk.worldZ + z, climate, biome);
          const isCave = this._sampleCaves(chunk.worldX + x, y, chunk.worldZ + z, biome);

          if (density > 0 && !isCave) {
            // Check Ores (Phase 11 context)
            const ore = this._getOreAt(chunk.worldX + x, y, chunk.worldZ + z);
            chunk.setBlock(x, y, z, ore || BLOCK_TYPES.STONE);
          } else {
            // Aquifer Resolution
            const aqNoise = this.noise.perlin3((chunk.worldX+x)*this.freq.aquifer, y*this.freq.aquifer, (chunk.worldZ+z)*this.freq.aquifer);
            const aquiferLevel = 32 + aqNoise * 12;
            if (y <= aquiferLevel && y <= 32) chunk.setBlock(x, y, z, biome.fluid);
          }
        }
      }
    }

    // PHASE 10: Carvers
    this._applyCarvers(chunk);

    // PHASE 11-13: Surface & Decorations
    for (let x = 0; x < 16; x++) {
      for (let z = 0; z < 16; z++) {
        const climate = climateCache[x][z];
        const biome = this.biomes.getBiome(climate.t, climate.h, climate.c, climate.e);
        this._applySurfacePass(chunk, x, z, biome);
      }
    }
    return chunk;
  }

  _calculateDensity(wx, y, wz, climate, biome) {
    // 1. Base Continentalness (Offset to keep Plains low)
    let baseCont = (climate.c * 2.0 - 1.1) * 32; 
    
    // 2. Noise Terms
    let dEros = (climate.e * 2.0 - 1.0) * 16;
    let dRidge = this.noise.octaveNoise3(wx * this.freq.ridge, y * this.freq.ridge, wz * this.freq.ridge, 4) * 12;
    let dDetail = this.noise.octaveNoise3(wx * this.freq.detail, y * this.freq.detail, wz * this.freq.detail, 2) * 4;
    
    // 3. EXPONENTIAL GRAVITY (Prevents Sky Plateaus)
    let heightDiff = y - 32;
    let gravity = heightDiff > 0 ? Math.pow(heightDiff, 1.2) : heightDiff * 0.8;

    // 4. Biome Shaping
    if (biome.id === 'mountains') {
        gravity *= 0.6; // Mountains resist gravity to form peaks
        dRidge *= 1.8;
    } else if (biome.id === 'plains') {
        dRidge *= 0.3; // Flatten plains
        gravity *= 1.2; // Push plains down
    }

    let density = baseCont + dEros + dRidge + dDetail - gravity;

    // Phase 12: River Carving
    const river = Math.abs(this.noise.perlin2(wx * this.freq.river, wz * this.freq.river));
    if (river < 0.015) density -= 25 * (1.0 - river/0.015);

    return density;
  }

  _sampleClimate(wx, wz) {
    let grid = Array(16).fill().map(() => Array(16));
    for (let x = 0; x < 16; x++) {
      for (let z = 0; z < 16; z++) {
        let t = this.noise.octaveNoise2((wx+x)*this.freq.temp, (wz+z)*this.freq.temp, 2);
        let h = this.noise.octaveNoise2((wx+x)*this.freq.humid, (wz+z)*this.freq.humid, 2);
        let c = this.noise.octaveNoise2((wx+x)*this.freq.cont, (wz+z)*this.freq.cont, 3);
        let e = this.noise.octaveNoise2((wx+x)*this.freq.eros, (wz+z)*this.freq.eros, 3);
        // Contrast Stretching
        grid[x][z] = {
          t: Math.max(0, Math.min(1, t * 1.6 + 0.5)),
          h: Math.max(0, Math.min(1, h * 1.6 + 0.5)),
          c: Math.max(0, Math.min(1, c * 1.3 + 0.5)),
          e: Math.max(0, Math.min(1, e * 1.3 + 0.5))
        };
      }
    }
    return grid;
  }

  _sampleCaves(wx, y, wz, biome) {
    const low = this.noise.octaveNoise3(wx*this.freq.caveL, y*this.freq.caveL, wz*this.freq.caveL, 3);
    const high = this.noise.octaveNoise3(wx*this.freq.caveH, y*this.freq.caveH, wz*this.freq.caveH, 2);
    let caveDensity = low - Math.abs(high);
    return caveDensity > 0.4;
  }

  _applySurfacePass(chunk, lx, lz, biome) {
    let found = false;
    for (let y = 95; y >= 0; y--) {
      const block = chunk.getBlock(lx, y, lz);
      if (block === BLOCK_TYPES.STONE || (block >= 18 && block <= 21)) { // Stone or Ores
        if (!found) {
          const topBlock = (biome.id === 'mountains' && y > 78) ? BLOCK_TYPES.SNOW : biome.surface[0];
          chunk.setBlock(lx, y, lz, topBlock);
          chunk.setBlock(lx, y-1, lz, biome.surface[1]);
          chunk.setBlock(lx, y-2, lz, biome.surface[1]);
          found = true;
          this._placeDecor(chunk, lx, y + 1, lz, biome);
        }
      } else if (block === biome.fluid || block === BLOCK_TYPES.WATER) found = true;
    }
  }

  _getOreAt(wx, wy, wz) {
    const n = this.noise.octaveNoise3(wx*0.1, wy*0.1, wz*0.1, 2);
    if (n < 0.65) return null;
    if (wy < 12) return BLOCK_TYPES.DIAMOND_ORE;
    if (wy < 22) return BLOCK_TYPES.GOLD_ORE;
    if (wy < 35) return BLOCK_TYPES.IRON_ORE;
    return BLOCK_TYPES.COAL_ORE;
  }

  _applyCarvers(chunk) {
    const h = this.noise.hash(chunk.chunkX, chunk.chunkZ);
    if (h < 0.03) {
      const rng = this.noise.createPRNG(h * 1000);
      let cx = chunk.worldX + 8, cz = chunk.worldZ + 8, cy = 20 + rng() * 15;
      for (let i = 0; i < 30; i++) {
        cx += (rng()-0.5)*6; cz += (rng()-0.5)*6; cy += (rng()-0.5)*2;
        this._carveSphere(chunk, cx, cy, cz, 3);
      }
    }
  }

  _carveSphere(chunk, wx, wy, wz, r) {
    const rSq = r * r;
    for (let lx = 0; lx < 16; lx++) {
      for (let lz = 0; lz < 16; lz++) {
        for (let ly = 1; ly < 95; ly++) {
          const dx = (chunk.worldX+lx)-wx, dy = ly-wy, dz = (chunk.worldZ+lz)-wz;
          if (dx*dx+dy*dy+dz*dz < rSq) {
            if (ly > 32 || chunk.getBlock(lx, ly, lz) !== BLOCK_TYPES.WATER) chunk.setBlock(lx, ly, lz, BLOCK_TYPES.AIR);
          }
        }
      }
    }
  }

  _placeDecor(chunk, x, y, z, biome) {
    const r = this.noise.hash(chunk.worldX + x, chunk.worldZ + z);
    if (biome.id === 'forest' && r < 0.12) this._spawnTree(chunk, x, y, z);
    if (biome.id === 'desert' && r < 0.03) this._spawnCactus(chunk, x, y, z);
    if (biome.id === 'plains' && r < 0.02) chunk.setBlock(x, y, z, BLOCK_TYPES.RED_FLOWER);
  }

  _spawnTree(chunk, x, y, z) {
    for (let i = 0; i < 5; i++) chunk.setBlock(x, y+i, z, BLOCK_TYPES.WOOD_LOG);
    for (let ox=-2; ox<=2; ox++) {
      for (let oz=-2; oz<=2; oz++) {
        if (Math.abs(ox)+Math.abs(oz) < 4) chunk.setBlock(x+ox, y+4, z+oz, BLOCK_TYPES.LEAVES);
      }
    }
  }

  _spawnCactus(chunk, x, y, z) {
    for (let i = 0; i < 3; i++) chunk.setBlock(x, y+i, z, BLOCK_TYPES.WOOD_LOG);
  }
}