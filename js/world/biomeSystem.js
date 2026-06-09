/**
 * Cuubz — Biome System (VoxelGen Overhaul)
 * Ported from voxelgen.html — domain-warped climate sampling, Gaussian blending, spline continentalness.
 */

// Continentalness spline control points — maps raw noise to landmass distribution.
const CONT_SPLINE = [
  [-1.0, -1.1], [-0.4, -0.6], [-0.1, -0.1], [0.1, 0.2], [0.25, 0.6], [0.5, 0.85], [1.0, 1.1]
];

// Biome definitions — surfaceBlock/subBlock match VoxelGen block IDs directly.
const BIOME_DEFS = {
  DEEP_OCEAN:   { baseY: 32,  amplitude: 9,  surfaceBlock: BLOCK_TYPES.GRAVEL,    subBlock: BLOCK_TYPES.GRAVEL,     color: '#051d3b', name: 'Deep Ocean' },
  OCEAN:        { baseY: 46,  amplitude: 9,  surfaceBlock: BLOCK_TYPES.SAND,      subBlock: BLOCK_TYPES.GRAVEL,    color: '#1565C0', name: 'Ocean' },
  BEACH:        { baseY: 64,  amplitude: 3,  surfaceBlock: BLOCK_TYPES.SAND,      subBlock: BLOCK_TYPES.SAND,     color: '#d4b483', name: 'Beach' },
  PLAINS:       { baseY: 68,  amplitude: 6,  surfaceBlock: BLOCK_TYPES.GRASS,     subBlock: BLOCK_TYPES.DIRT,     color: '#5a8a3c', name: 'Plains' },
  FOREST:       { baseY: 70,  amplitude: 10, surfaceBlock: BLOCK_TYPES.GRASS,     subBlock: BLOCK_TYPES.DIRT,     color: '#2d6e2d', name: 'Forest' },
  BADLANDS:     { baseY: 74,  amplitude: 14, surfaceBlock: BLOCK_TYPES.RED_SAND,  subBlock: BLOCK_TYPES.TERRACOTTA, color: '#b5623e', name: 'Badlands' },
  TUNDRA:       { baseY: 64,  amplitude: 7,  surfaceBlock: BLOCK_TYPES.SNOW,      subBlock: BLOCK_TYPES.DIRT,     color: '#c8dde8', name: 'Tundra' },
  DESERT:       { baseY: 68,  amplitude: 4,  surfaceBlock: BLOCK_TYPES.SAND,      subBlock: BLOCK_TYPES.CLAY,     color: '#d1b247', name: 'Desert' },
  MOUNTAINS:    { baseY: 90,  amplitude: 20, surfaceBlock: BLOCK_TYPES.GRASS,     subBlock: BLOCK_TYPES.STONE,    color: '#607d8b', name: 'Mountains' },
  FROZEN_PEAKS: { baseY: 100, amplitude: 20, surfaceBlock: BLOCK_TYPES.SNOW,      subBlock: BLOCK_TYPES.SNOW_STONE, color: '#e0f7fa', name: 'Frozen Peaks' }
};

/**
 * Select biome from climate parameters.
 * Continent-first waterfall logic with temp/hum/erosion refinement.
 */
function selectBiome(cont, eros, temp, hum) {
  const isCold = temp < -0.35;

  if (cont < -0.4) return Object.assign({}, BIOME_DEFS.DEEP_OCEAN, { frozenWater: isCold });
  if (cont < -0.15) return Object.assign({}, BIOME_DEFS.OCEAN, { frozenWater: isCold });
  if (cont < 0.02) return Object.assign({}, BIOME_DEFS.BEACH, { frozenWater: isCold });

  // Desert ocean band — hot + dry creates inland sea
  if (!isCold && temp > 0.45 && hum < -0.1) {
    if (cont < -0.35) return BIOME_DEFS.DEEP_OCEAN;
    if (cont < 0)     return BIOME_DEFS.OCEAN;
    if (cont < 0.05)  return BIOME_DEFS.BEACH;
  } else {
    if (cont < -0.4)  return BIOME_DEFS.DEEP_OCEAN;
    if (cont < -0.15) return BIOME_DEFS.OCEAN;
    if (cont < 0.02)  return BIOME_DEFS.BEACH;
  }

  // Mountain peaks — high continentalness + low erosion
  if (cont > 0.45 && eros < 0) {
    return isCold ? BIOME_DEFS.FROZEN_PEAKS : BIOME_DEFS.MOUNTAINS;
  }

  // Hot biomes
  if (temp > 0.45) {
    return hum < -0.1 ? BIOME_DEFS.DESERT : BIOME_DEFS.BADLANDS;
  }

  // Cold land
  if (isCold) {
    return BIOME_DEFS.TUNDRA;
  }

  // Default: forest or plains based on humidity / continentalness
  if (hum > 0.2) return BIOME_DEFS.FOREST;
  if (cont > 0.35) return BIOME_DEFS.PLAINS;
  return BIOME_DEFS.PLAINS;
}

/**
 * Sample blended biome parameters at a world position.
 * Uses Gaussian-weighted grid sampling with domain warping for seamless transitions.
 */
function sampleBiomeParams(p, wx, wz, continentScale, contScale, tempScale, humScale, erosScale) {
  const RADIUS = 1;
  const STEP = 8;

  // Domain warp — jitter noise displaces coordinates for organic boundaries.
  const WARP = 120;
  const warpCX = p.jitter.noise2(wx / 80, wz / 80) * WARP;
  const warpCZ = p.jitter.noise2(wx / 80 + 317.7, wz / 80 + 961.3) * WARP;
  const warpGX = p.jitter.noise2(wx / 95 + 142.5, wz / 95 + 398.2) * WARP;
  const warpGZ = p.jitter.noise2(wx / 95 + 573.1, wz / 95 + 821.6) * WARP;

  // Blend temperature and humidity across grid.
  let sumTemp = 0, sumHum = 0, sumW = 0;
  for (let dx = -RADIUS; dx <= RADIUS; dx++) {
    for (let dz = -RADIUS; dz <= RADIUS; dz++) {
      const sx = wx + dx * STEP, sz = wz + dz * STEP;
      let temp = p.temp.noise2((sx + warpCX) / tempScale, (sz + warpCZ) / tempScale);
      let hum  = p.hum.noise2((sx + warpGX) / humScale, (sz + warpGZ) / humScale);
      // Per-sample jitter for smooth biome transitions.
      temp += fbm2(p.jitter, sx / 15 + 999, sz / 15 + 999, 3, 0.5, 2.0) * 0.04;
      hum  += fbm2(p.jitter, sx / 15 + 777, sz / 15 + 777, 3, 0.5, 2.0) * 0.04;

      const dist2 = dx * dx + dz * dz;
      const w = Math.exp(-dist2 * 0.6);
      sumTemp += temp * w;
      sumHum  += hum  * w;
      sumW    += w;
    }
  }
  const blendedTemp = sumTemp / sumW;
  const blendedHum  = sumHum  / sumW;

  // Blend biome heights across grid.
  sumBase = 0; sumAmp = 0; sumW = 0;
  let dominantBiome = null, dominantW = -1;

  for (let dx = -RADIUS; dx <= RADIUS; dx++) {
    for (let dz = -RADIUS; dz <= RADIUS; dz++) {
      const sx = wx + dx * STEP, sz = wz + dz * STEP;
      // Two-tier continentalness: apply spline independently then blend.
      const continentRaw = p.cont.noise2((sx + warpCX) / continentScale, (sz + warpCZ) / continentScale);
      const detailRaw    = p.cont.noise2((sx + warpCX) / contScale,      (sz + warpCZ) / contScale);
      let cont = applySpline(continentRaw, CONT_SPLINE) * 0.7 + applySpline(detailRaw, CONT_SPLINE) * 0.3;
      cont = Math.max(-1.1, Math.min(1.1, cont));
      cont += fbm2(p.jitter, sx / 15, sz / 15, 3, 0.5, 2.0) * 0.08;

      const eros = p.eros.noise2((sx + warpGX) / erosScale, (sz + warpGZ) / erosScale);
      const biome = selectBiome(cont, eros, blendedTemp, blendedHum);

      const dist2 = dx * dx + dz * dz;
      const w = Math.exp(-dist2 * 0.6);
      sumBase += biome.baseY   * w;
      sumAmp  += biome.amplitude * w;
      sumW    += w;
      if (w > dominantW) { dominantW = w; dominantBiome = biome; }
    }
  }

  return {
    baseY: sumBase / sumW,
    amplitude: sumAmp / sumW,
    biome: dominantBiome,
    isCold: blendedTemp < -0.35
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BIOME_DEFS, CONT_SPLINE, selectBiome, sampleBiomeParams };
}
