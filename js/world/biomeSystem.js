/**
 * Cuubz — Biome System (VoxelGen Overhaul)
 * Ported from voxelgen.html — domain-warped climate sampling, Gaussian blending, spline continentalness.
 */

// Continentalness spline control points — maps raw noise to landmass distribution.
const CONT_SPLINE = [
  [-1.0, -1.1], [-0.4, -0.6], [-0.1, -0.1], [0.1, 0.2], [0.25, 0.6], [0.5, 0.85], [1.0, 1.1]
];

// Biome definitions — surfaceBlock/subBlock match VoxelGen block IDs directly.
// surfaceVariants/subVariants/stoneVariants: [blockId, weight] arrays for noise-driven mixing.
const BIOME_DEFS = {
  DEEP_OCEAN:   {
    baseY: 32,  amplitude: 9,
    surfaceBlock: BLOCK_TYPES.GRAVEL, subBlock: BLOCK_TYPES.GRAVEL,
    surfaceVariants: [[BLOCK_TYPES.GRAVEL, 60], [BLOCK_TYPES.SAND, 25], [BLOCK_TYPES.CLAY, 15]],
    subVariants:     [[BLOCK_TYPES.GRAVEL, 70], [BLOCK_TYPES.SAND, 30]],
    stoneVariants:   [[BLOCK_TYPES.STONE, 70], [BLOCK_TYPES.ANDESITE, 10], [BLOCK_TYPES.DIORITE, 10], [BLOCK_TYPES.GRANITE, 10]],
    color: '#051d3b', name: 'Deep Ocean'
  },
  OCEAN:        {
    baseY: 46,  amplitude: 9,
    surfaceBlock: BLOCK_TYPES.SAND, subBlock: BLOCK_TYPES.GRAVEL,
    surfaceVariants: [[BLOCK_TYPES.SAND, 65], [BLOCK_TYPES.GRAVEL, 20], [BLOCK_TYPES.CLAY, 15]],
    subVariants:     [[BLOCK_TYPES.GRAVEL, 60], [BLOCK_TYPES.SAND, 40]],
    stoneVariants:   [[BLOCK_TYPES.STONE, 70], [BLOCK_TYPES.ANDESITE, 10], [BLOCK_TYPES.DIORITE, 10], [BLOCK_TYPES.GRANITE, 10]],
    color: '#1565C0', name: 'Ocean'
  },
  BEACH:        {
    baseY: 64,  amplitude: 3,
    surfaceBlock: BLOCK_TYPES.SAND, subBlock: BLOCK_TYPES.SAND,
    surfaceVariants: [[BLOCK_TYPES.SAND, 85], [BLOCK_TYPES.GRAVEL, 15]],
    subVariants:     [[BLOCK_TYPES.SAND, 90], [BLOCK_TYPES.CLAY, 10]],
    stoneVariants:   [[BLOCK_TYPES.STONE, 70], [BLOCK_TYPES.ANDESITE, 10], [BLOCK_TYPES.DIORITE, 10], [BLOCK_TYPES.GRANITE, 10]],
    color: '#d4b483', name: 'Beach'
  },
  PLAINS:       {
    baseY: 68,  amplitude: 6,
    surfaceBlock: BLOCK_TYPES.GRASS, subBlock: BLOCK_TYPES.DIRT,
    surfaceVariants: [[BLOCK_TYPES.GRASS, 70], [BLOCK_TYPES.COARSE_DIRT, 15], [BLOCK_TYPES.MOSS_BLOCK, 8], [BLOCK_TYPES.MYCELIUM, 7]],
    subVariants:     [[BLOCK_TYPES.DIRT, 80], [BLOCK_TYPES.COARSE_DIRT, 20]],
    stoneVariants:   [[BLOCK_TYPES.STONE, 60], [BLOCK_TYPES.ANDESITE, 13], [BLOCK_TYPES.DIORITE, 12], [BLOCK_TYPES.GRANITE, 15]],
    color: '#5a8a3c', name: 'Plains'
  },
  FOREST:       {
    baseY: 70,  amplitude: 10,
    surfaceBlock: BLOCK_TYPES.PODZOL, subBlock: BLOCK_TYPES.DIRT,
    surfaceVariants: [[BLOCK_TYPES.PODZOL, 50], [BLOCK_TYPES.MYCELIUM, 20], [BLOCK_TYPES.MOSS_BLOCK, 15], [BLOCK_TYPES.GRASS, 15]],
    subVariants:     [[BLOCK_TYPES.DIRT, 60], [BLOCK_TYPES.COARSE_DIRT, 25], [BLOCK_TYPES.PODZOL, 15]],
    stoneVariants:   [[BLOCK_TYPES.STONE, 55], [BLOCK_TYPES.ANDESITE, 15], [BLOCK_TYPES.DIORITE, 15], [BLOCK_TYPES.GRANITE, 15]],
    color: '#2d6e2d', name: 'Forest'
  },
  BADLANDS:     {
    baseY: 74,  amplitude: 14,
    surfaceBlock: BLOCK_TYPES.RED_SAND, subBlock: BLOCK_TYPES.TERRACOTTA,
    surfaceVariants: [[BLOCK_TYPES.RED_SAND, 55], [BLOCK_TYPES.TERRACOTTA, 25], [BLOCK_TYPES.COARSE_DIRT, 10], [BLOCK_TYPES.STONE, 10]],
    subVariants:     [[BLOCK_TYPES.TERRACOTTA, 60], [BLOCK_TYPES.RED_SAND, 25], [BLOCK_TYPES.STONE, 15]],
    stoneVariants:   [[BLOCK_TYPES.STONE, 50], [BLOCK_TYPES.ANDESITE, 15], [BLOCK_TYPES.DIORITE, 10], [BLOCK_TYPES.GRANITE, 15], [BLOCK_TYPES.TUFF, 10]],
    color: '#b5623e', name: 'Badlands'
  },
  TUNDRA:       {
    baseY: 64,  amplitude: 7,
    surfaceBlock: BLOCK_TYPES.SNOW, subBlock: BLOCK_TYPES.COARSE_DIRT,
    surfaceVariants: [[BLOCK_TYPES.SNOW, 70], [BLOCK_TYPES.GRASS, 10], [BLOCK_TYPES.COARSE_DIRT, 12], [BLOCK_TYPES.MOSS_BLOCK, 8]],
    subVariants:     [[BLOCK_TYPES.COARSE_DIRT, 60], [BLOCK_TYPES.DIRT, 40]],
    stoneVariants:   [[BLOCK_TYPES.STONE, 60], [BLOCK_TYPES.ANDESITE, 13], [BLOCK_TYPES.DIORITE, 12], [BLOCK_TYPES.GRANITE, 15]],
    color: '#c8dde8', name: 'Tundra'
  },
  DESERT:       {
    baseY: 68,  amplitude: 4,
    surfaceBlock: BLOCK_TYPES.SAND, subBlock: BLOCK_TYPES.CLAY,
    surfaceVariants: [[BLOCK_TYPES.SAND, 80], [BLOCK_TYPES.CLAY, 10], [BLOCK_TYPES.GRAVEL, 10]],
    subVariants:     [[BLOCK_TYPES.CLAY, 55], [BLOCK_TYPES.SAND, 30], [BLOCK_TYPES.GRAVEL, 15]],
    stoneVariants:   [[BLOCK_TYPES.STONE, 65], [BLOCK_TYPES.ANDESITE, 10], [BLOCK_TYPES.DIORITE, 10], [BLOCK_TYPES.GRANITE, 15]],
    color: '#d1b247', name: 'Desert'
  },
  MOUNTAINS:    {
    baseY: 90,  amplitude: 20,
    surfaceBlock: BLOCK_TYPES.GRASS, subBlock: BLOCK_TYPES.STONE,
    surfaceVariants: [[BLOCK_TYPES.GRASS, 35], [BLOCK_TYPES.STONE, 25], [BLOCK_TYPES.ANDESITE, 12], [BLOCK_TYPES.DIORITE, 10], [BLOCK_TYPES.GRANITE, 10], [BLOCK_TYPES.COARSE_DIRT, 8]],
    subVariants:     [[BLOCK_TYPES.STONE, 55], [BLOCK_TYPES.ANDESITE, 15], [BLOCK_TYPES.DIORITE, 12], [BLOCK_TYPES.GRANITE, 10], [BLOCK_TYPES.DIRT, 8]],
    stoneVariants:   [[BLOCK_TYPES.STONE, 40], [BLOCK_TYPES.ANDESITE, 18], [BLOCK_TYPES.DIORITE, 15], [BLOCK_TYPES.GRANITE, 17], [BLOCK_TYPES.TUFF, 10]],
    color: '#607d8b', name: 'Mountains'
  },
  FROZEN_PEAKS: {
    baseY: 100, amplitude: 20,
    surfaceBlock: BLOCK_TYPES.SNOW, subBlock: BLOCK_TYPES.COARSE_DIRT,
    surfaceVariants: [[BLOCK_TYPES.SNOW, 65], [BLOCK_TYPES.STONE, 15], [BLOCK_TYPES.ANDESITE, 8], [BLOCK_TYPES.DIORITE, 7], [BLOCK_TYPES.GRANITE, 5]],
    subVariants:     [[BLOCK_TYPES.COARSE_DIRT, 50], [BLOCK_TYPES.STONE, 30], [BLOCK_TYPES.DIRT, 20]],
    stoneVariants:   [[BLOCK_TYPES.STONE, 40], [BLOCK_TYPES.ANDESITE, 18], [BLOCK_TYPES.DIORITE, 15], [BLOCK_TYPES.GRANITE, 17], [BLOCK_TYPES.TUFF, 10]],
    color: '#e0f7fa', name: 'Frozen Peaks'
  }
};

/**
 * Select biome from climate parameters.
 * Continent-first waterfall logic with temp/hum/erosion refinement.
 * Widened thresholds: lower humidity cutoff for forest, added highlands biome,
 * reduced plains catch-all area.
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

  // Hot biomes (checked before highlands so deserts/badlands aren't overridden)
  if (temp > 0.45) {
    return hum < -0.1 ? BIOME_DEFS.DESERT : BIOME_DEFS.BADLANDS;
  }

  // Highlands — elevated continental areas in temperate/cold zones
  if (cont > 0.35 && eros < 0.05) {
    return isCold ? BIOME_DEFS.FROZEN_PEAKS : BIOME_DEFS.MOUNTAINS;
  }

  // Cold land
  if (isCold) {
    return BIOME_DEFS.TUNDRA;
  }

  // Default: forest or plains — widened forest range (hum > 0.0 instead of 0.2)
  if (hum > 0.0) return BIOME_DEFS.FOREST;

  // Semi-arid interior: badlands instead of plains
  if (hum < -0.2) return BIOME_DEFS.BADLANDS;

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

/**
 * Noise infrastructure (mirrors workerGeneration.js for main-thread humidity recomputation).
 */
function _mulberry32(seed) {
  var s = seed | 0;
  return function () {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    var t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function _hashString(str) {
  var h = 0x811c9dc5;
  for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

function _createPerlin(seed) {
  var rng = _mulberry32(seed);
  var p = new Uint8Array(256);
  for (var i = 0; i < 256; i++) p[i] = i;
  for (var i = 255; i > 0; i--) { var j = Math.floor(rng() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  var perm = new Uint8Array(512);
  for (var i = 0; i < 512; i++) perm[i] = p[i & 255];

  function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  function lerp(a, b, t) { return a + t * (b - a); }
  function grad3(h, x, y, z) {
    h &= 15; var u = h < 8 ? x : y, v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
    return (h & 1 ? -u : u) + (h & 2 ? -v : v);
  }

  function noise2(x, y) {
    var X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    x -= Math.floor(x); y -= Math.floor(y);
    var u = fade(x), v = fade(y);
    var a = perm[X] + Y, aa = perm[a], ab = perm[a + 1];
    var b = perm[X + 1] + Y, ba = perm[b], bb = perm[b + 1];
    return lerp(lerp(grad3(perm[aa], x, y, 0), grad3(perm[ba], x - 1, y, 0), u),
                lerp(grad3(perm[ab], x, y - 1, 0), grad3(perm[bb], x - 1, y - 1, 0), u), v);
  }

  return { noise2: noise2 };
}

function _fbm2(perlin, x, y, octaves, persistence, lacunarity) {
  var val = 0, amp = 1, freq = 1, maxV = 0;
  for (var i = 0; i < octaves; i++) {
    val += perlin.noise2(x * freq, y * freq) * amp;
    maxV += amp; amp *= persistence; freq *= lacunarity;
  }
  return val / maxV;
}

function _applySpline(val, points) {
  if (val <= points[0][0]) return points[0][1];
  if (val >= points[points.length - 1][0]) return points[points.length - 1][1];
  for (var i = 0; i < points.length - 1; i++) {
    if (val < points[i + 1][0]) {
      var t = (val - points[i][0]) / (points[i + 1][0] - points[i][0]);
      return points[i][1] + (points[i + 1][1] - points[i][1]) * t;
    }
  }
}

function _createSharedPerlin(seed) {
  var sInt = _hashString(String(seed));
  return {
    cont:   _createPerlin(sInt ^ 0x1111), eros: _createPerlin(sInt ^ 0x2222),
    temp:   _createPerlin(sInt ^ 0x3333), hum:  _createPerlin(sInt ^ 0x4444),
    det:    _createPerlin(sInt ^ 0x5555), c1:   _createPerlin(sInt ^ 0x6666),
    c2:     _createPerlin(sInt ^ 0x7777), river:_createPerlin(sInt ^ 0x8888),
    jitter: _createPerlin(sInt ^ 0xBBBB)
  };
}

/**
 * Recompute humidityMap for a chunk (used when loading cached chunks from IndexedDB).
 * Returns Float32Array(256) with normalized 0..1 humidity per column.
 */
function computeHumidityMap(seed, chunkX, chunkZ, params) {
  var p = _createSharedPerlin(seed);
  var humidityMap = new Float32Array(256);
  var RADIUS = 1, STEP = 8, WARP = 120;

  for (var lx = 0; lx < 16; lx++) {
    for (var lz = 0; lz < 16; lz++) {
      var wx = chunkX * 16 + lx, wz = chunkZ * 16 + lz;

      var warpGX = p.jitter.noise2(wx / 95 + 142.5, wz / 95 + 398.2) * WARP;
      var warpGZ = p.jitter.noise2(wx / 95 + 573.1, wz / 95 + 821.6) * WARP;

      var sumHum = 0, sumW = 0;
      for (var dx = -RADIUS; dx <= RADIUS; dx++) {
        for (var dz = -RADIUS; dz <= RADIUS; dz++) {
          var sx = wx + dx * STEP, sz = wz + dz * STEP;
          var hum = p.hum.noise2((sx + warpGX) / params.humScale, (sz + warpGZ) / params.humScale);
          hum += _fbm2(p.jitter, sx / 15 + 777, sz / 15 + 777, 3, 0.5, 2.0) * 0.04;
          var dist2 = dx * dx + dz * dz;
          var w = Math.exp(-dist2 * 0.6);
          sumHum += hum * w;
          sumW += w;
        }
      }
      var blendedHum = sumHum / sumW;
      humidityMap[lx * 16 + lz] = Math.max(0, Math.min(1, blendedHum * 0.5 + 0.5));
    }
  }
  return humidityMap;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BIOME_DEFS, CONT_SPLINE, selectBiome, sampleBiomeParams, computeHumidityMap };
}
