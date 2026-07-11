/**
 * Cuubz — Worker-Side Chunk Generation (VoxelGen Overhaul)
 * Ported from voxelgen.html blob worker source.
 * 
 * Dual-mode: loaded as Web Worker via Blob URL, OR via <script> tag for inline fallback.
 * All code is scoped inside an IIFE to avoid global pollution on main thread.
 */

(function (globalScope) {
  'use strict';
  console.log('[workerGeneration] *** v2 with feature placement loaded ***');

  // ── Chunk constants (must match main thread) ───────────────────────
  var CHUNK_W = 16;
  var CHUNK_D = 16;
  var CHUNK_H = 256;
  var STRIDE = CHUNK_H * CHUNK_D; // x-stride for cidx helper

  function cidx(x, y, z) { return x * STRIDE + y * CHUNK_D + z; }

  // ── Block types (subset used in generation — IDs match chunkData.js) ─
  var BLOCK = {
    AIR: 0, BEDROCK: 1, STONE: 2, DIRT: 3, GRASS: 4, SAND: 5, GRAVEL: 6,
    WATER: 7, COAL_ORE: 8, IRON_ORE: 9, GOLD_ORE: 10, DIAMOND_ORE: 11,
    CAVE_AIR: 12, SNOW: 13, SNOW_STONE: 14, LAVA: 15, TERRACOTTA: 16,
    RED_SAND: 17, ICE: 18, CLAY: 19,
    // Decoration blocks (IDs match chunkData.js)
    WOOD_LOG: 32, LEAVES: 33, RED_FLOWER: 42, YELLOW_FLOWER: 43
  };

  // ── Biome definitions (must match biomeSystem.js) ───────────────────
  var BIOME = {
    DEEP_OCEAN:   { baseY: 32,  amplitude: 9,  surfaceBlock: BLOCK.GRAVEL,    subBlock: BLOCK.GRAVEL,     color: '#051d3b', name: 'Deep Ocean' },
    OCEAN:        { baseY: 46,  amplitude: 9,  surfaceBlock: BLOCK.SAND,      subBlock: BLOCK.GRAVEL,     color: '#1565C0', name: 'Ocean' },
    BEACH:        { baseY: 64,  amplitude: 3,  surfaceBlock: BLOCK.SAND,      subBlock: BLOCK.SAND,       color: '#d4b483', name: 'Beach' },
    PLAINS:       { baseY: 68,  amplitude: 6,  surfaceBlock: BLOCK.GRASS,     subBlock: BLOCK.DIRT,       color: '#5a8a3c', name: 'Plains' },
    FOREST:       { baseY: 70,  amplitude: 10, surfaceBlock: BLOCK.GRASS,     subBlock: BLOCK.DIRT,       color: '#2d6e2d', name: 'Forest' },
    BADLANDS:     { baseY: 74,  amplitude: 14, surfaceBlock: BLOCK.RED_SAND,  subBlock: BLOCK.TERRACOTTA, color: '#b5623e', name: 'Badlands' },
    TUNDRA:       { baseY: 64,  amplitude: 7,  surfaceBlock: BLOCK.SNOW,      subBlock: BLOCK.DIRT,       color: '#c8dde8', name: 'Tundra' },
    DESERT:       { baseY: 68,  amplitude: 4,  surfaceBlock: BLOCK.SAND,      subBlock: BLOCK.CLAY,       color: '#d1b247', name: 'Desert' },
    MOUNTAINS:    { baseY: 90,  amplitude: 20, surfaceBlock: BLOCK.GRASS,     subBlock: BLOCK.STONE,      color: '#607d8b', name: 'Mountains' },
    FROZEN_PEAKS: { baseY: 100, amplitude: 20, surfaceBlock: BLOCK.SNOW,      subBlock: BLOCK.SNOW_STONE, color: '#e0f7fa', name: 'Frozen Peaks' }
  };

  var CONT_SPLINE = [
    [-1.0, -1.1], [-0.4, -0.6], [-0.1, -0.1], [0.1, 0.2], [0.25, 0.6], [0.5, 0.85], [1.0, 1.1]
  ];

  var SEA_LEVEL = 64;

  // ── Feature placement rates per biome ─────────────────────────────
  // treeChance: per-column probability of attempting tree placement
  // redFlowerChance / yellowFlowerChance: per-column probability of placing a flower
  // treeMaxY: trees won't place above this height
  // flowerMaxY: flowers won't place above this height
  var FEATURE_RATES = {
    'Forest':       { treeChance: 0.35, redFlowerChance: 0.06, yellowFlowerChance: 0.06, treeMaxY: 125, flowerMaxY: 120 },
    'Plains':       { treeChance: 0.15, redFlowerChance: 0.12, yellowFlowerChance: 0.12, treeMaxY: 125, flowerMaxY: 120 },
    'Mountains':    { treeChance: 0.08, redFlowerChance: 0.02, yellowFlowerChance: 0.02, treeMaxY: 110, flowerMaxY: 115 },
    'Beach':        { treeChance: 0.03, redFlowerChance: 0.01, yellowFlowerChance: 0.01, treeMaxY: 125, flowerMaxY: 120 },
    'Tundra':       { treeChance: 0.00, redFlowerChance: 0.00, yellowFlowerChance: 0.00, treeMaxY: 125, flowerMaxY: 120 },
    'Desert':       { treeChance: 0.00, redFlowerChance: 0.00, yellowFlowerChance: 0.00, treeMaxY: 125, flowerMaxY: 120 },
    'Badlands':     { treeChance: 0.00, redFlowerChance: 0.00, yellowFlowerChance: 0.00, treeMaxY: 125, flowerMaxY: 120 },
    'Frozen Peaks': { treeChance: 0.00, redFlowerChance: 0.00, yellowFlowerChance: 0.00, treeMaxY: 125, flowerMaxY: 120 },
    'Ocean':        { treeChance: 0.00, redFlowerChance: 0.00, yellowFlowerChance: 0.00, treeMaxY: 125, flowerMaxY: 120 },
    'Deep Ocean':   { treeChance: 0.00, redFlowerChance: 0.00, yellowFlowerChance: 0.00, treeMaxY: 125, flowerMaxY: 120 }
  };

  // ── Ore definitions ────────────────────────────────────────────────
  var ORE_DEFS = [
    { type: BLOCK.COAL_ORE,    minY: 5,   maxY: 120, chance: 0.018, vein: 8 },
    { type: BLOCK.IRON_ORE,    minY: 5,   maxY: 85,  chance: 0.014, vein: 6 },
    { type: BLOCK.GOLD_ORE,    minY: 5,   maxY: 42,  chance: 0.006, vein: 4 },
    { type: BLOCK.DIAMOND_ORE, minY: 5,   maxY: 24,  chance: 0.003, vein: 3 }
  ];

  // ── Noise infrastructure (self-contained for worker) ────────────────
  function mulberry32(seed) {
    var s = seed | 0;
    return function () {
      s |= 0; s = s + 0x6D2B79F5 | 0;
      var t = Math.imul(s ^ s >>> 15, 1 | s);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function hashString(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }

  function createPerlin(seed) {
    var rng = mulberry32(seed);
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

    function noise3(x, y, z) {
      var X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
      x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
      var u = fade(x), v = fade(y), w = fade(z);
      var A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z;
      var B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
      return lerp(lerp(lerp(grad3(perm[AA], x, y, z), grad3(perm[BA], x - 1, y, z), u),
                       lerp(grad3(perm[AB], x, y - 1, z), grad3(perm[BB], x - 1, y - 1, z), u), v),
                  lerp(lerp(grad3(perm[AA + 1], x, y, z - 1), grad3(perm[BA + 1], x - 1, y, z - 1), u),
                       lerp(grad3(perm[AB + 1], x, y - 1, z - 1), grad3(perm[BB + 1], x - 1, y - 1, z - 1), u), v), w);
    }

    return { noise2: noise2, noise3: noise3 };
  }

  function fbm2(perlin, x, y, octaves, persistence, lacunarity) {
    var val = 0, amp = 1, freq = 1, maxV = 0;
    for (var i = 0; i < octaves; i++) {
      val += perlin.noise2(x * freq, y * freq) * amp;
      maxV += amp; amp *= persistence; freq *= lacunarity;
    }
    return val / maxV;
  }

  function applySpline(val, points) {
    if (val <= points[0][0]) return points[0][1];
    if (val >= points[points.length - 1][0]) return points[points.length - 1][1];
    for (var i = 0; i < points.length - 1; i++) {
      if (val < points[i + 1][0]) {
        var t = (val - points[i][0]) / (points[i + 1][0] - points[i][0]);
        return points[i][1] + (points[i + 1][1] - points[i][1]) * t;
      }
    }
  }

  function createSharedPerlin(seed) {
    var sInt = hashString(String(seed));
    return {
      cont:   createPerlin(sInt ^ 0x1111), eros: createPerlin(sInt ^ 0x2222),
      temp:   createPerlin(sInt ^ 0x3333), hum:  createPerlin(sInt ^ 0x4444),
      det:    createPerlin(sInt ^ 0x5555), c1:   createPerlin(sInt ^ 0x6666),
      c2:     createPerlin(sInt ^ 0x7777), river:createPerlin(sInt ^ 0x8888),
      jitter: createPerlin(sInt ^ 0xBBBB)
    };
  }

  // ── Biome selection (matches biomeSystem.js) ────────────────────────
  function selectBiome(cont, eros, temp, hum) {
    var isCold = temp < -0.35;
    if (cont < -0.4)  return Object.assign({}, BIOME.DEEP_OCEAN, { frozenWater: isCold });
    if (cont < -0.15) return Object.assign({}, BIOME.OCEAN,      { frozenWater: isCold });
    if (cont < 0.02)  return Object.assign({}, BIOME.BEACH,       { frozenWater: isCold });
    if (!isCold && temp > 0.45 && hum < -0.1) {
      if (cont < -0.35) return BIOME.DEEP_OCEAN;
      if (cont < 0)     return BIOME.OCEAN;
      if (cont < 0.05)  return BIOME.BEACH;
    } else {
      if (cont < -0.4)  return BIOME.DEEP_OCEAN;
      if (cont < -0.15) return BIOME.OCEAN;
      if (cont < 0.02)  return BIOME.BEACH;
    }
    if (cont > 0.45 && eros < 0) {
      return isCold ? BIOME.FROZEN_PEAKS : BIOME.MOUNTAINS;
    }
    if (temp > 0.45) {
      return hum < -0.1 ? BIOME.DESERT : BIOME.BADLANDS;
    }
    if (isCold) return BIOME.TUNDRA;
    if (hum > 0.2) return BIOME.FOREST;
    if (cont > 0.35) return BIOME.PLAINS;
    return BIOME.PLAINS;
  }

  // ── Biome parameter sampling with Gaussian blending + domain warp ───
  function sampleBiomeParams(p, wx, wz, continentScale, contScale, tempScale, humScale, erosScale) {
    var RADIUS = 1, STEP = 8;
    var sumBase = 0, sumAmp = 0, sumW = 0;
    var dominantBiome = null, dominantW = -1;

    var WARP = 120;
    var warpCX = p.jitter.noise2(wx / 80, wz / 80) * WARP;
    var warpCZ = p.jitter.noise2(wx / 80 + 317.7, wz / 80 + 961.3) * WARP;
    var warpGX = p.jitter.noise2(wx / 95 + 142.5, wz / 95 + 398.2) * WARP;
    var warpGZ = p.jitter.noise2(wx / 95 + 573.1, wz / 95 + 821.6) * WARP;

    var sumTemp = 0, sumHum = 0;
    for (var dx = -RADIUS; dx <= RADIUS; dx++) {
      for (var dz = -RADIUS; dz <= RADIUS; dz++) {
        var sx = wx + dx * STEP, sz = wz + dz * STEP;
        var temp = p.temp.noise2((sx + warpCX) / tempScale, (sz + warpCZ) / tempScale);
        var hum  = p.hum.noise2((sx + warpGX) / humScale, (sz + warpGZ) / humScale);
        temp += fbm2(p.jitter, sx / 15 + 999, sz / 15 + 999, 3, 0.5, 2.0) * 0.04;
        hum  += fbm2(p.jitter, sx / 15 + 777, sz / 15 + 777, 3, 0.5, 2.0) * 0.04;
        var dist2 = dx * dx + dz * dz;
        var w = Math.exp(-dist2 * 0.6);
        sumTemp += temp * w;
        sumHum  += hum  * w;
        sumW    += w;
      }
    }
    var blendedTemp = sumTemp / sumW;
    var blendedHum  = sumHum  / sumW;

    sumBase = 0; sumAmp = 0; sumW = 0; dominantBiome = null; dominantW = -1;
    for (var dx = -RADIUS; dx <= RADIUS; dx++) {
      for (var dz = -RADIUS; dz <= RADIUS; dz++) {
        var sx = wx + dx * STEP, sz = wz + dz * STEP;
        var continentRaw = p.cont.noise2((sx + warpCX) / continentScale, (sz + warpCZ) / continentScale);
        var detailRaw    = p.cont.noise2((sx + warpCX) / contScale,      (sz + warpCZ) / contScale);
        var cont = applySpline(continentRaw, CONT_SPLINE) * 0.7 + applySpline(detailRaw, CONT_SPLINE) * 0.3;
        cont = Math.max(-1.1, Math.min(1.1, cont));
        cont += fbm2(p.jitter, sx / 15, sz / 15, 3, 0.5, 2.0) * 0.08;
        var eros = p.eros.noise2((sx + warpGX) / erosScale, (sz + warpGZ) / erosScale);
        var biome = selectBiome(cont, eros, blendedTemp, blendedHum);
        var dist2 = dx * dx + dz * dz;
        var w = Math.exp(-dist2 * 0.6);
        sumBase += biome.baseY     * w;
        sumAmp  += biome.amplitude * w;
        sumW    += w;
        if (w > dominantW) { dominantW = w; dominantBiome = biome; }
      }
    }

    return { baseY: sumBase / sumW, amplitude: sumAmp / sumW, biome: dominantBiome, isCold: blendedTemp < -0.35 };
  }

  // ── Feature placement (trees + flowers) ─────────────────────────────
  // Called as Phase 4 after terrain, caves, and ores are complete.
  // Receives biomeMap (256 entries, one per column) with biome names from Phase 1.
  function placeFeatures(chunk, surfaceMap, biomeMap, rng) {
    var placedTrees = []; // [{lx, lz}] for exclusion zone checks

    // ── Debug: count biome distribution and grass columns ──────────
    var debugCounts = {};
    var grassCols = 0, eligibleCols = 0;
    for (var dbg = 0; dbg < 256; dbg++) {
      var dbgName = biomeMap[dbg];
      debugCounts[dbgName] = (debugCounts[dbgName] || 0) + 1;
      var dbgY = surfaceMap[dbg];
      var dbgLx = dbg % 16, dbgLz = Math.floor(dbg / 16);
      if (chunk[cidx(dbgLx, dbgY, dbgLz)] === BLOCK.GRASS) grassCols++;
      if (chunk[cidx(dbgLx, dbgY, dbgLz)] === BLOCK.GRASS && FEATURE_RATES[dbgName] && FEATURE_RATES[dbgName].treeChance > 0) eligibleCols++;
    }
    console.log('[placeFeatures] biomeMap:', JSON.stringify(debugCounts), 'grassCols:', grassCols, 'eligibleCols:', eligibleCols);

    // ── Tree placement pass ────────────────────────────────────────
    for (var lx = 0; lx < 16; lx++) {
      for (var lz = 0; lz < 16; lz++) {
        var surfY = surfaceMap[lx * 16 + lz];
        if (surfY < 2 || surfY >= CHUNK_H - 10) continue;

        // Trees only on grass blocks.
        if (chunk[cidx(lx, surfY, lz)] !== BLOCK.GRASS) continue;

        // Look up biome rates.
        var biomeName = biomeMap[lx * 16 + lz];
        var rates = FEATURE_RATES[biomeName];
        if (!rates || rates.treeChance <= 0) continue;

        // Elevation cap.
        if (surfY > rates.treeMaxY) continue;

        // Roll against per-column chance.
        if (rng() > rates.treeChance) continue;

        // Check exclusion zone (4-block radius from any placed tree).
        var tooClose = false;
        for (var t = 0; t < placedTrees.length; t++) {
          var dx = lx - placedTrees[t].lx;
          var dz = lz - placedTrees[t].lz;
          if (Math.abs(dx) < 4 && Math.abs(dz) < 4) { tooClose = true; break; }
        }
        if (tooClose) continue;

        // Place tree: 4-block trunk + 5×5×5 leaf canopy.
        var trunkH = 4;
        var baseY = surfY + 1; // First log sits on top of grass.

        // Trunk.
        for (var ty = 0; ty < trunkH; ty++) {
          var logY = baseY + ty;
          if (logY < CHUNK_H) {
            chunk[cidx(lx, logY, lz)] = BLOCK.WOOD_LOG;
          }
        }

        // Leaf canopy: 5×5×5 centered at top of trunk.
        var canopyCenterY = baseY + trunkH;
        for (var cx = -2; cx <= 2; cx++) {
          for (var cy = -2; cy <= 2; cy++) {
            for (var cz = -2; cz <= 2; cz++) {
              var bx = lx + cx;
              var by = canopyCenterY + cy;
              var bz = lz + cz;

              // Skip trunk area (center column below canopy center).
              if (cx === 0 && cz === 0 && cy < 0) continue;

              // Round corners: skip if all three axes are at edge.
              if (Math.abs(cx) === 2 && Math.abs(cy) === 2 && Math.abs(cz) === 2) continue;

              // Bounds check.
              if (bx >= 0 && bx < 16 && bz >= 0 && bz < 16 && by >= 0 && by < CHUNK_H) {
                // Only place in air or replace existing leaves.
                var existing = chunk[cidx(bx, by, bz)];
                if (existing === BLOCK.AIR || existing === BLOCK.CAVE_AIR || existing === BLOCK.LEAVES) {
                  chunk[cidx(bx, by, bz)] = BLOCK.LEAVES;
                }
              }
            }
          }
        }

        placedTrees.push({ lx: lx, lz: lz });
      }
    }

    // ── Flower placement pass ──────────────────────────────────────
    for (var lx = 0; lx < 16; lx++) {
      for (var lz = 0; lz < 16; lz++) {
        var surfY = surfaceMap[lx * 16 + lz];
        if (surfY < 1 || surfY >= CHUNK_H - 1) continue;

        // Flowers only on grass blocks.
        if (chunk[cidx(lx, surfY, lz)] !== BLOCK.GRASS) continue;

        // Look up biome rates.
        var biomeName = biomeMap[lx * 16 + lz];
        var rates = FEATURE_RATES[biomeName];
        if (!rates) continue;

        // Elevation cap.
        if (surfY > rates.flowerMaxY) continue;

        // Check if a tree is already on this column — skip flowers under trees.
        var treeHere = false;
        for (var t = 0; t < placedTrees.length; t++) {
          if (placedTrees[t].lx === lx && placedTrees[t].lz === lz) { treeHere = true; break; }
        }
        if (treeHere) continue;

        // Roll for red flower.
        if (rates.redFlowerChance > 0 && rng() < rates.redFlowerChance) {
          chunk[cidx(lx, surfY + 1, lz)] = BLOCK.RED_FLOWER;
          continue; // Only one flower per column.
        }

        // Roll for yellow flower.
        if (rates.yellowFlowerChance > 0 && rng() < rates.yellowFlowerChance) {
          chunk[cidx(lx, surfY + 1, lz)] = BLOCK.YELLOW_FLOWER;
        }
      }
    }
  }

  // ── Ore placement ───────────────────────────────────────────────────
  function placeOres(chunk, rng) {
    for (var oi = 0; oi < ORE_DEFS.length; oi++) {
      var ore = ORE_DEFS[oi];
      var attempts = Math.floor(16 * 16 * ore.chance * 10);
      for (var a = 0; a < attempts; a++) {
        if (rng() > ore.chance * 60) continue;
        var ox = Math.floor(rng() * 16);
        var oy = Math.floor(rng() * (ore.maxY - ore.minY)) + ore.minY;
        var oz = Math.floor(rng() * 16);
        for (var v = 0; v < ore.vein; v++) {
          var bx = Math.max(0, Math.min(15, ox + Math.floor(rng() * 3) - 1));
          var by = Math.max(0, Math.min(CHUNK_H - 1, oy + Math.floor(rng() * 3) - 1));
          var bz = Math.max(0, Math.min(CHUNK_D - 1, oz + Math.floor(rng() * 3) - 1));
          if (chunk[cidx(bx, by, bz)] === BLOCK.STONE) {
            chunk[cidx(bx, by, bz)] = ore.type;
          }
        }
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // MAIN GENERATION FUNCTION — called once per chunk
  // Returns a Promise that yields between columns to avoid blocking main thread.
  // ════════════════════════════════════════════════════════════════════
  function generateChunk(chunkX, chunkZ, seed, params) {
    var p = createSharedPerlin(seed);
    var sInt = hashString(String(seed));

    // Separate RNG streams for surface, caves, ores, features (deterministic per-chunk).
    var rngSurface = mulberry32(sInt ^ ((chunkX * 73856093) ^ (chunkZ * 19349663)) ^ 0x1000);
    var rngCave    = mulberry32(sInt ^ ((chunkX * 73856093) ^ (chunkZ * 19349663)) ^ 0x2000);
    var rngOre     = mulberry32(sInt ^ ((chunkX * 73856093) ^ (chunkZ * 19349663)) ^ 0x3000);
    var rngFeature = mulberry32(sInt ^ ((chunkX * 73856093) ^ (chunkZ * 19349663)) ^ 0x4000);

    var chunk      = new Uint8Array(CHUNK_W * CHUNK_H * CHUNK_D);
    var surfaceMap = new Int32Array(256); // Used internally for cave carving phase
    var biomeMap   = new Array(256);      // Biome name string per column, for feature placement

    // ── Phase 1: Terrain + block placement per column ────────────────
    for (var lx = 0; lx < 16; lx++) {
      for (var lz = 0; lz < 16; lz++) {
        var wx = chunkX * 16 + lx, wz = chunkZ * 16 + lz;

        // Sample blended biome parameters.
        var blended = sampleBiomeParams(p, wx, wz, params.continentScale, params.contScale,
                                        params.tempScale, params.humScale, params.erosScale);

        // Mountain factor — smooth 0→1 from continentalness + erosion blend.
        var MOUNTAIN_RADIUS = 1, STEP2 = 8;
        var sumCont = 0, sumEros = 0, sumW2 = 0;
        for (var dx = -MOUNTAIN_RADIUS; dx <= MOUNTAIN_RADIUS; dx++) {
          for (var dz = -MOUNTAIN_RADIUS; dz <= MOUNTAIN_RADIUS; dz++) {
            var sx = wx + dx * STEP2, sz = wz + dz * STEP2;
            var cCont = p.cont.noise2(sx / params.continentScale, sz / params.continentScale);
            var cDet  = p.cont.noise2(sx / params.contScale,      sz / params.contScale);
            var c = applySpline(cCont, CONT_SPLINE) * 0.7 + applySpline(cDet, CONT_SPLINE) * 0.3;
            var e = p.eros.noise2(sx / params.erosScale, sz / params.erosScale);
            var dist2 = dx * dx + dz * dz;
            var w = Math.exp(-dist2 * 0.6);
            sumCont += c * w;
            sumEros += e * w;
            sumW2 += w;
          }
        }
        var rawContLocal = sumCont / sumW2;
        var localErosion = sumEros / sumW2;

        var mountainFactor = 0;
        if (localErosion < 0.2) {
          var contT = Math.max(0, Math.min(1, (rawContLocal - 0.15) / 0.3));
          var erosT = Math.max(0, Math.min(1, (-localErosion + 0.2) / 0.3));
          mountainFactor = contT * erosT;
        }

        // Fine detail noise (shared by biome and mountain formulas).
        var detail = fbm2(p.det, wx / params.detailScale, wz / params.detailScale,
                           params.octaves, params.persistence, params.lacunarity);

        var preCarveY;
        if (mountainFactor > 0.01) {
          // Biome-based height (fallback for lowland terrain).
          var biomeHeight = blended.baseY + detail * blended.amplitude;

          // Mountain base rises with continent.
          var mountainBase = 65 + rawContLocal * 70;

          // Plateau noise: flat-topped variation in mountains.
          var plateauNoise = fbm2(p.det, wx / (params.detailScale * 3), wz / (params.detailScale * 3),
                                   params.octaves - 1, params.persistence, params.lacunarity);
          var plateau = Math.pow(plateauNoise * 0.5 + 0.5, 2) * 18;

          // Peak boost: cubic curve for dramatic high points.
          var peakBoost = Math.pow(Math.max(0, (rawContLocal - 0.45) / 0.35), 3) * 50;

          // Mountain ridges: absolute-value noise creates elongated ridge structures.
          var ridgeNoise = Math.abs(p.c1.noise2(wx / (params.caveScale * 3), wz / (params.caveScale * 3)));
          var ridgeHeight = Math.pow(ridgeNoise, 0.8) * 25;

          // Mountain height — additive components keep it bounded.
          var mountainHeight = mountainBase + plateau + peakBoost + ridgeHeight * mountainFactor + detail * 20;

          // Scale by biome elevation so low biomes get less mountain influence.
          var effectiveFactor = mountainFactor * (blended.baseY / 90);

          // Smooth lerp between biome height and mountain height.
          preCarveY = Math.floor(biomeHeight * (1 - effectiveFactor) + mountainHeight * effectiveFactor);
        } else {
          // Pure non-mountain terrain with peak boost for continental highlands.
          var peakBoost2 = 1;
          if (rawContLocal > 0.6) peakBoost2 = 1 + (rawContLocal - 0.6) * 3.5;
          preCarveY = Math.floor(blended.baseY + detail * blended.amplitude * peakBoost2);
        }

        // River carving pass — inline with terrain generation.
        var RIVER_WARP = 120;
        var riverWarpX = p.jitter.noise2(wx / 60 + 451.3, wz / 60 + 789.1) * RIVER_WARP;
        var riverWarpZ = p.jitter.noise2(wx / 60 + 234.7, wz / 60 + 567.2) * RIVER_WARP;
        var riverBaseVal = Math.abs(p.river.noise2((wx + riverWarpX) / params.riverScale, (wz + riverWarpZ) / params.riverScale));
        var riverJitter = fbm2(p.jitter, wx / 10 + 333, wz / 10 + 444, 3, 0.5, 2.0) * 0.06;

        var baseRiverThreshold = Math.min(0.10, 0.12 - rawContLocal * 0.10);
        var baseTerrainY = preCarveY;

        if ((riverBaseVal - riverJitter) < Math.max(params.riverDensity * 0.03, baseRiverThreshold * params.riverDensity) &&
            preCarveY > SEA_LEVEL - 2 && preCarveY < 145) {
          var effectiveVal = Math.max(0, (riverBaseVal - riverJitter));
          var carveT = Math.max(0, 1 - effectiveVal / Math.max(params.riverDensity * 0.03, baseRiverThreshold * params.riverDensity));

          var elevationFactor = Math.cos((preCarveY - 70) / 45 * Math.PI * 0.5);
          var depthScale = Math.max(0.15, Math.min(1, (elevationFactor + 1) / 2));

          var smooth = Math.exp(-4 * Math.pow(1 - carveT, 2));
          baseTerrainY -= Math.floor(params.riverDepth * depthScale * smooth);
        }

        // Clamp surface height.
        var surfY = Math.max(5, Math.min(CHUNK_H - 2, baseTerrainY));
        surfaceMap[lx * 16 + lz] = surfY;
        biomeMap[lx * 16 + lz] = blended.biome.name;

        var isSub = surfY <= SEA_LEVEL + 1;

        // ── Block placement for this column (top-down) ────────────────
        for (var y = 0; y < CHUNK_H; y++) {
          var block;
          if (y === 0) {
            block = BLOCK.BEDROCK;
          } else if (y <= 3 && rngSurface() < (4 - y) * 0.25) {
            block = BLOCK.BEDROCK; // Random bedrock scatter near bottom.
          } else if (y < surfY - 3) {
            block = BLOCK.STONE;
          } else if (y < surfY) {
            // Sub-block layer — mountains use stone sub-block (thin soil).
            if (mountainFactor > 0.5 && blended.isCold) {
              block = BLOCK.SNOW_STONE;
            } else if (mountainFactor > 0.5) {
              block = BLOCK.STONE;
            } else {
              block = blended.biome.subBlock !== BLOCK.DIRT ? blended.biome.subBlock : BLOCK.DIRT;
            }
          } else if (y === surfY) {
            // Surface block — altitude snow + biome logic.
            var snowNoiseVal = p.temp.noise3(wx / 60, y / 30, wz / 60);

            if (y > 130 && blended.biome.name !== 'Desert' && blended.biome.name !== 'Badlands') {
              // High altitude always gets snow in non-desert biomes.
              if (snowNoiseVal < -0.25) block = BLOCK.STONE;
              else if (snowNoiseVal < 0.1) block = BLOCK.GRASS;
              else block = BLOCK.SNOW;
            } else if (mountainFactor > 0.3 && blended.isCold) {
              // Cold mountain terrain: layered snow transition.
              if (y > 110) block = BLOCK.SNOW;
              else if (y > 85) block = (snowNoiseVal < -0.2) ? BLOCK.STONE : BLOCK.SNOW;
              else block = BLOCK.GRASS;
            } else if ((blended.biome.frozenWater || blended.isCold) && surfY >= SEA_LEVEL) {
              block = BLOCK.SNOW; // Cold terrain surface.
            } else if ((blended.biome.frozenWater || blended.isCold) && surfY < SEA_LEVEL) {
              block = (surfY < SEA_LEVEL - 35) ? BLOCK.GRAVEL : BLOCK.SAND; // Frozen ocean floor.
            } else if (mountainFactor > 0.5 && y > 120) {
              // Mountain terrain: stone exposed at high elevation.
              block = (snowNoiseVal < 0) ? BLOCK.STONE : blended.biome.surfaceBlock;
            } else {
              block = (isSub && blended.biome.surfaceBlock === BLOCK.GRASS) ? BLOCK.SAND : blended.biome.surfaceBlock;
            }
          } else if (y <= SEA_LEVEL) {
            // Water fill above surface up to sea level.
            var iceNoise = fbm2(p.jitter, wx / 15, wz / 15, 3, 0.5, 2.0);
            if ((blended.biome.frozenWater || blended.isCold) && y >= SEA_LEVEL - Math.floor(iceNoise * 2)) {
              block = BLOCK.ICE;
            } else {
              block = BLOCK.WATER;
            }
          } else {
            block = BLOCK.AIR;
          }

          chunk[cidx(lx, y, lz)] = block;
        }
      }
    }

    // ── Phase 2: Cave carving pass (separate loop) ───────────────────
    for (var lx = 0; lx < 16; lx++) {
      for (var lz = 0; lz < 16; lz++) {
        var wx = chunkX * 16 + lx, wz = chunkZ * 16 + lz;
        var surf = surfaceMap[lx * 16 + lz];

        for (var y = 5; y < 150; y++) {
          var b = chunk[cidx(lx, y, lz)];
          if (b !== BLOCK.STONE && b !== BLOCK.DIRT && b !== BLOCK.GRAVEL && b !== BLOCK.SAND) continue;

          var nx = wx / params.caveScale, ny = y / params.caveScale, nz = wz / params.caveScale;
          var n1 = p.c1.noise3(nx, ny, nz);
          var n2 = p.c2.noise3(nx + 100, ny + 100, nz + 100);

          var wallJitter = p.jitter.noise3(wx / 6 + 999, y / 6 + 888, wz / 6 + 777);

          if (Math.abs(n1) < params.caveThresh && Math.abs(n2) < params.caveThresh) {
            var depthFade = Math.min(1, (y - 4) / 8);
            var surfaceFade = Math.min(1, (surf - y) / 5);
            var fade = depthFade * Math.max(0, surfaceFade);

            var edgeNoise = (Math.abs(n1) + Math.abs(n2)) / (params.caveThresh * 2);
            var jitterBoost = wallJitter * 0.35 * edgeNoise;

            if (rngCave() < fade + jitterBoost) {
              chunk[cidx(lx, y, lz)] = (y < 12) ? BLOCK.LAVA : BLOCK.CAVE_AIR;
            }
          }
        }
      }
    }

    // ── Phase 3: Ore placement ───────────────────────────────────────
    placeOres(chunk, rngOre);

    // ── Phase 4: Feature placement (trees + flowers) ─────────────────
    placeFeatures(chunk, surfaceMap, biomeMap, rngFeature);

    // Return result (used by both worker and inline fallback).
    return {
      cx: chunkX - params.baseChunkX,
      cz: chunkZ - params.baseChunkZ,
      chunkBytes: chunk.buffer       // ArrayBuffer — transferred by worker
    };
  }

  // ── Worker message handler (only active in Web Worker context) ──────
  if (typeof globalScope !== 'undefined' && typeof globalScope.postMessage === 'function' && !globalScope.document) {
    globalScope.onmessage = function (e) {
      var msg = e.data;
      try {
        if (msg.type === 'work') {
          var result = generateChunk(msg.chunkX, msg.chunkZ, msg.seed, msg.params);
          globalScope.postMessage({
            type: 'result',
            cx: result.cx,
            cz: result.cz,
            chunkBytes: result.chunkBytes
          }, [result.chunkBytes]);
        }
      } catch (err) {
        globalScope.postMessage({ type: 'error', error: err.message, stack: err.stack });
      }
    };

    // Report uncaught errors back to main thread.
    globalScope.onerror = function (e) {
      globalScope.postMessage({
        type: 'error',
        error: e.filename + ':' + e.lineno + ' — ' + e.message,
        stack: ''
      });
      return true; // Prevent default error handling.
    };
  }

  // Expose for inline fallback (main thread).
  if (typeof globalScope !== 'undefined' && typeof globalScope.document !== 'undefined') {
    globalScope._voxelgenGenerateChunk = generateChunk;
  }

// Pass `self` in worker context, `window` on main thread.
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this));
