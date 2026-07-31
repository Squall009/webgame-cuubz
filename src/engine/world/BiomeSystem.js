/**
 * Cuubz — Biome System (VoxelGen Overhaul)
 * Ported from voxelgen.html — domain-warped climate sampling, Gaussian blending, spline continentalness.
 */

import { BLOCK_TYPES } from './BlockRegistry.js';
// D-60: the ONE Perlin implementation. This file used to carry two more copies of it —
// see the note above the `_`-prefixed aliases below for the bit-exactness proof.
import { applySpline, createPerlin, createSharedPerlin, fbm2, hashString, mulberry32 } from './Noise.js';

// Continentalness spline control points — maps raw noise to landmass distribution.
export const CONT_SPLINE = [
  [-1.0, -1.1], [-0.4, -0.6], [-0.1, -0.1], [0.1, 0.2], [0.25, 0.6], [0.5, 0.85], [1.0, 1.1]
];

// Biome definitions — surfaceBlock/subBlock match VoxelGen block IDs directly.
// surfaceVariants/subVariants/stoneVariants: [blockId, weight] arrays for noise-driven mixing.
export const BIOME_DEFS = {
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
 * Biome display name → the stable id every consumer matches on.
 *
 * DERIVED from BIOME_DEFS rather than hand-written, and exported rather than hidden
 * inside the `BiomeSystem` IIFE, because of `BUGS.md` **D-68**: two mob definitions
 * declared `biomes: ['corrupt']` and one declared `deepslate_caves`, neither of which
 * this system can produce, so those mobs could never spawn and nothing said so. A
 * consumer that wants to name a biome now has a list to check against, and
 * `test/test_mobBiomes.js` fails if any mob names an id that is not in it.
 *
 * The rule is exactly the fallback `getBiomeAtWorldPos` already applied to an unmapped
 * name (`toLowerCase`, spaces → underscores), and it reproduces the previous
 * hand-written `NAME_TO_ID` table entry-for-entry.
 */
export const BIOME_NAME_TO_ID = Object.freeze(Object.fromEntries(
  Object.values(BIOME_DEFS).map((d) => [d.name, d.name.toLowerCase().replace(/\s+/g, '_')])
));

/** The ten ids `BiomeSystem.getBiomeAtWorldPos` can actually return. */
export const BIOME_IDS = Object.freeze(Object.values(BIOME_NAME_TO_ID));

/**
 * Select biome from climate parameters.
 * Continent-first waterfall logic with temp/hum/erosion refinement.
 * Widened thresholds: lower humidity cutoff for forest, added highlands biome,
 * reduced plains catch-all area.
 */
export function selectBiome(cont, eros, temp, hum) {
  const isCold = temp < -0.20;

  if (cont < -0.4) return Object.assign({}, BIOME_DEFS.DEEP_OCEAN, { frozenWater: isCold });
  if (cont < -0.15) return Object.assign({}, BIOME_DEFS.OCEAN, { frozenWater: isCold });
  if (cont < 0.02) return Object.assign({}, BIOME_DEFS.BEACH, { frozenWater: isCold });

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
export function sampleBiomeParams(p, wx, wz, continentScale, contScale, tempScale, humScale, erosScale) {
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
      temp += _fbm2(p.jitter, sx / 15 + 999, sz / 15 + 999, 3, 0.5, 2.0) * 0.04;
      hum  += _fbm2(p.jitter, sx / 15 + 777, sz / 15 + 777, 3, 0.5, 2.0) * 0.04;

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
  // PR 11 / D-32: these two were assigned without a declaration. In a classic script
  // that silently created two GLOBALS; an ES module is strict mode by definition, so the
  // same line is a ReferenceError the moment this function runs. Found by `no-undef`,
  // which is exactly what §6 PR 11 says the rule is for.
  let sumBase = 0, sumAmp = 0;
  sumW = 0;
  let dominantBiome = null, dominantW = -1;

  for (let dx = -RADIUS; dx <= RADIUS; dx++) {
    for (let dz = -RADIUS; dz <= RADIUS; dz++) {
      const sx = wx + dx * STEP, sz = wz + dz * STEP;
      // Two-tier continentalness: apply spline independently then blend.
      const continentRaw = p.cont.noise2((sx + warpCX) / continentScale, (sz + warpCZ) / continentScale);
      const detailRaw    = p.cont.noise2((sx + warpCX) / contScale,      (sz + warpCZ) / contScale);
      let cont = _applySpline(continentRaw, CONT_SPLINE) * 0.7 + _applySpline(detailRaw, CONT_SPLINE) * 0.3;
      cont = Math.max(-1.1, Math.min(1.1, cont));
      cont += _fbm2(p.jitter, sx / 15, sz / 15, 3, 0.5, 2.0) * 0.08;

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
    isCold: blendedTemp < -0.20
  };
}

/**
 * Noise infrastructure — D-60: THIS FILE USED TO CONTAIN IT TWICE.
 *
 * `_mulberry32`, `_hashString`, `_createPerlin`, `_fbm2`, `_applySpline` and
 * `_createSharedPerlin` were defined here as module-level exports AND defined again,
 * verbatim, inside the `BiomeSystem` IIFE below — ~66 duplicated lines in a 441-line
 * file, both copies carrying the same nine XOR salts. `src/engine/world/Noise.js` held a
 * THIRD copy and, until this change, had no consumer at all; PR 20 kept it rather than
 * deleting it (decision 42) precisely so this collapse could land here.
 *
 * Both in-file copies are gone. The names below are aliases of `Noise.js`'s exports and
 * exist only so that importers — `src/game/systems/QuestSystem.js` imports `_hashString`
 * — do not change in the same PR that moves the code.
 *
 * ─── THE PROOF THAT THIS DID NOT CHANGE TERRAIN ─────────────────────────────
 *
 * The e2e harness pins world seed 424242 and asserts terrain, so a single differing salt,
 * operator, permutation entry, lerp or fade curve would silently invalidate every
 * downstream assertion. Before a line was deleted, all FOUR implementations — Noise.js,
 * the two in this file, and `workerGeneration.js`'s (which MUST stay separate: classic
 * script, decision 14) — were compared with `Object.is`, no tolerance, over
 * **202,163 comparisons**: `hashString` on 8 seed strings, 2,000 `mulberry32` draws on
 * each of 10 seeds, `noise2` and `noise3` on 1,208 coordinates × 10 seeds (including the
 * -0, 255.999999 and 256 boundaries), `fbm2` across 45 octave/persistence/lacunarity
 * combinations, `applySpline` at 601 points through the real CONT_SPLINE, and
 * `createSharedPerlin` across all NINE salts × 8 seed strings. **Zero differences.**
 * `workerGeneration.js`'s copy agrees too, so the worker and the main thread do generate
 * identical terrain for a given seed — which had never been checked.
 *
 * The one asymmetry, and it is additive: this file's `_createPerlin` returned
 * `{ noise2 }` only. `Noise.js`'s returns `{ noise2, noise3 }`. Nothing here called
 * `noise3`, so every existing call site is unaffected.
 *
 * NOTE: this file used to alias its private helpers to the BARE names `fbm2` and
 * `applySpline`, which silently collided with the identical functions in `Noise.js`
 * (refactor.md §2.1). Those aliases are gone and `test/test_globalCollisions.js` asserts
 * they stay gone — do not reintroduce them. The `_`-prefixed names below are not the
 * same thing: they are namespaced and no other file declares them.
 */
export const _mulberry32 = mulberry32;
export const _hashString = hashString;
export const _createPerlin = createPerlin;
export const _fbm2 = fbm2;
export const _applySpline = applySpline;
export const _createSharedPerlin = createSharedPerlin;

/**
 * Recompute humidityMap for a chunk (used when loading cached chunks from IndexedDB).
 * Returns Float32Array(256) with normalized 0..1 humidity per column.
 */
export function computeHumidityMap(seed, chunkX, chunkZ, params) {
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
/**
 * BiomeSystem — main-thread helper for querying biome at any world position.
 * Used by main.js to drive fog/sky/particle effects.
 * Creates its own noise infrastructure so it can be called independently.
 */
export var BiomeSystem = (function () {
  // D-60: this IIFE used to redeclare _mulberry32, _hashString, _createPerlin, _fbm2,
  // _applySpline and _createSharedPerlin — a verbatim second copy of the module-level
  // helpers, 66 lines, with the same nine XOR salts. It now closes over the module-level
  // aliases, which are Noise.js's functions. Proved bit-exact over 202,163 Object.is
  // comparisons before a line was removed; see the note above those aliases.
  //
  // Its `_fbm2` and `_applySpline` were dead even inside the IIFE — the only caller of
  // either is the module-level `sampleBiomeParams`, which this block calls directly.

  // Default generation params (match chunkmanager.js defaults)
  var DEFAULT_PARAMS = {
    continentScale: 4000, contScale: 400, tempScale: 2000, humScale: 2000, erosScale: 280
  };

  // Map biome display name (e.g. "Tundra") → lowercase id (e.g. "tundra")
  // Was a second hand-written copy of the name→id table. It is now the module-level
  // BIOME_NAME_TO_ID, derived from BIOME_DEFS, so mob/quest definitions can be checked
  // against it (D-68).
  var NAME_TO_ID = BIOME_NAME_TO_ID;

  function getBiomeAtWorldPos(wx, wz, seed) {
    var p = _createSharedPerlin(seed);
    var params = DEFAULT_PARAMS;
    var result = sampleBiomeParams(p, wx, wz,
      params.continentScale, params.contScale,
      params.tempScale, params.humScale, params.erosScale);
    var biomeName = result.biome.name;
    return {
      id: NAME_TO_ID[biomeName] || biomeName.toLowerCase().replace(/\s+/g, '_'),
      name: biomeName,
      isCold: result.isCold
    };
  }

  return { getBiomeAtWorldPos: getBiomeAtWorldPos };
})();
