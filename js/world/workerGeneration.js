/**
 * Cuubz — Worker-Side Chunk Generation (VoxelGen Overhaul)
 * Ported from voxelgen.html blob worker source.
 * 
 * Dual-mode: loaded as Web Worker via Blob URL, OR via <script> tag for inline fallback.
 * All code is scoped inside an IIFE to avoid global pollution on main thread.
 */

(function (globalScope) {
  'use strict';
  // console.log('[workerGeneration] *** v2 with feature placement loaded ***');

  // ── Chunk constants (must match main thread) ───────────────────────
  var CHUNK_W = 16;
  var CHUNK_D = 16;
  var CHUNK_H = 256;
  var STRIDE = CHUNK_H * CHUNK_D; // x-stride for cidx helper

  function cidx(x, y, z) { return x * STRIDE + y * CHUNK_D + z; }

  // ── Block types (subset used in generation — IDs match blockRegistry.js) ─
  var BLOCK = {
    AIR: 0, BEDROCK: 1, STONE: 2,
    // Stone variants (IDs 4-7)
    ANDESITE: 4, DIORITE: 5, GRANITE: 6, TUFF: 7,
    // Surface blocks (IDs 48-60)
    DIRT: 48, GRASS: 49, SAND: 50, GRAVEL: 51,
    // Fluids (IDs 46-47)
    WATER: 46,
    // Ores (IDs 21-28)
    COAL_ORE: 21, IRON_ORE: 22, GOLD_ORE: 23, DIAMOND_ORE: 24,
    // Deepslate ores (IDs 30-35)
    DEEPSLATE_COAL_ORE: 30, DEEPSLATE_IRON_ORE: 31,
    DEEPSLATE_GOLD_ORE: 32, DEEPSLATE_DIAMOND_ORE: 33,
    DEEPSLATE_COPPER_ORE: 34, DEEPSLATE_EMERALD_ORE: 35,
    // CAVE_AIR is now AIR in the new system
    CAVE_AIR: 0,
    // More surface blocks
    RED_SAND: 52, CLAY: 53, SNOW: 54,
    PODZOL: 55, COARSE_DIRT: 56, MYCELIUM: 57, TERRACOTTA: 58,
    SMOOTH_STONE: 59, CALCITE: 60,
    // Moss block (ID 20)
    MOSS_BLOCK: 20,
    // Ice variants
    ICE: 61,
    // LAVA
    LAVA: 47,
    // Decoration blocks (from registry)
    WOOD_LOG: 65, LEAVES: 104, RED_FLOWER: 179, YELLOW_FLOWER: 180,
    // Additional wood types for biome-specific trees
    SPRUCE_LOG: 66, SPRUCE_LEAVES: 105,
    BIRCH_LOG: 67, BIRCH_LEAVES: 106,
    DARK_OAK_LOG: 70, DARK_OAK_LEAVES: 109,
    ACACIA_LOG: 69, ACACIA_LEAVES: 108,
    PALE_OAK_LOG: 73, PALE_OAK_LEAVES: 112,
    CHERRY_LOG: 71, CHERRY_LEAVES: 110,
    MANGROVE_LOG: 72, MANGROVE_LEAVES: 111,
    BAMBOO_BLOCK: 75,
    POPLAR_LOG: 74, ORANGE_POPLAR_LEAVES: 113, RED_POPLAR_LEAVES: 114, YELLOW_POPLAR_LEAVES: 115,
    // Ground cover / plants
    SHORT_GRASS: 177, TALL_GRASS: 178,
    BROWN_MUSHROOM: 181, RED_MUSHROOM: 182,
    // Deepslate block (for deep terrain)
    DEEPSLATE: 8
  };

  // ── Biome definitions (must match biomeSystem.js) ───────────────────
  // surfaceVariants: array of [blockId, weight] — noise-driven mixing at the surface layer.
  // subVariants: array of [blockId, weight] — mixing in the sub-surface dirt layer.
  // stoneVariants: array of [blockId, weight] — mixing in the deep stone layer.
  var BIOME = {
    DEEP_OCEAN:   {
      baseY: 32,  amplitude: 9,
      surfaceBlock: BLOCK.GRAVEL, subBlock: BLOCK.GRAVEL,
      surfaceVariants: [[BLOCK.GRAVEL, 60], [BLOCK.SAND, 25], [BLOCK.CLAY, 15]],
      subVariants:     [[BLOCK.GRAVEL, 70], [BLOCK.SAND, 30]],
      stoneVariants:   [[BLOCK.STONE, 70], [BLOCK.ANDESITE, 10], [BLOCK.DIORITE, 10], [BLOCK.GRANITE, 10]],
      color: '#051d3b', name: 'Deep Ocean'
    },
    OCEAN:        {
      baseY: 46,  amplitude: 9,
      surfaceBlock: BLOCK.SAND, subBlock: BLOCK.GRAVEL,
      surfaceVariants: [[BLOCK.SAND, 65], [BLOCK.GRAVEL, 20], [BLOCK.CLAY, 15]],
      subVariants:     [[BLOCK.GRAVEL, 60], [BLOCK.SAND, 40]],
      stoneVariants:   [[BLOCK.STONE, 70], [BLOCK.ANDESITE, 10], [BLOCK.DIORITE, 10], [BLOCK.GRANITE, 10]],
      color: '#1565C0', name: 'Ocean'
    },
    BEACH:        {
      baseY: 64,  amplitude: 3,
      surfaceBlock: BLOCK.SAND, subBlock: BLOCK.SAND,
      surfaceVariants: [[BLOCK.SAND, 85], [BLOCK.GRAVEL, 15]],
      subVariants:     [[BLOCK.SAND, 90], [BLOCK.CLAY, 10]],
      stoneVariants:   [[BLOCK.STONE, 70], [BLOCK.ANDESITE, 10], [BLOCK.DIORITE, 10], [BLOCK.GRANITE, 10]],
      color: '#d4b483', name: 'Beach'
    },
    PLAINS:       {
      baseY: 68,  amplitude: 6,
      surfaceBlock: BLOCK.GRASS, subBlock: BLOCK.DIRT,
      surfaceVariants: [[BLOCK.GRASS, 70], [BLOCK.COARSE_DIRT, 15], [BLOCK.MOSS_BLOCK, 8], [BLOCK.MYCELIUM, 7]],
      subVariants:     [[BLOCK.DIRT, 80], [BLOCK.COARSE_DIRT, 20]],
      stoneVariants:   [[BLOCK.STONE, 60], [BLOCK.ANDESITE, 13], [BLOCK.DIORITE, 12], [BLOCK.GRANITE, 15]],
      color: '#5a8a3c', name: 'Plains'
    },
    FOREST:       {
      baseY: 70,  amplitude: 10,
      surfaceBlock: BLOCK.PODZOL, subBlock: BLOCK.DIRT,
      surfaceVariants: [[BLOCK.PODZOL, 50], [BLOCK.MYCELIUM, 20], [BLOCK.MOSS_BLOCK, 15], [BLOCK.GRASS, 15]],
      subVariants:     [[BLOCK.DIRT, 60], [BLOCK.COARSE_DIRT, 25], [BLOCK.PODZOL, 15]],
      stoneVariants:   [[BLOCK.STONE, 55], [BLOCK.ANDESITE, 15], [BLOCK.DIORITE, 15], [BLOCK.GRANITE, 15]],
      color: '#2d6e2d', name: 'Forest'
    },
    BADLANDS:     {
      baseY: 74,  amplitude: 14,
      surfaceBlock: BLOCK.RED_SAND, subBlock: BLOCK.TERRACOTTA,
      surfaceVariants: [[BLOCK.RED_SAND, 55], [BLOCK.TERRACOTTA, 25], [BLOCK.COARSE_DIRT, 10], [BLOCK.STONE, 10]],
      subVariants:     [[BLOCK.TERRACOTTA, 60], [BLOCK.RED_SAND, 25], [BLOCK.STONE, 15]],
      stoneVariants:   [[BLOCK.STONE, 50], [BLOCK.ANDESITE, 15], [BLOCK.DIORITE, 10], [BLOCK.GRANITE, 15], [BLOCK.TUFF, 10]],
      color: '#b5623e', name: 'Badlands'
    },
    TUNDRA:       {
      baseY: 64,  amplitude: 7,
      surfaceBlock: BLOCK.SNOW, subBlock: BLOCK.COARSE_DIRT,
      surfaceVariants: [[BLOCK.SNOW, 70], [BLOCK.GRASS, 10], [BLOCK.COARSE_DIRT, 12], [BLOCK.MOSS_BLOCK, 8]],
      subVariants:     [[BLOCK.COARSE_DIRT, 60], [BLOCK.DIRT, 40]],
      stoneVariants:   [[BLOCK.STONE, 60], [BLOCK.ANDESITE, 13], [BLOCK.DIORITE, 12], [BLOCK.GRANITE, 15]],
      color: '#c8dde8', name: 'Tundra'
    },
    DESERT:       {
      baseY: 68,  amplitude: 4,
      surfaceBlock: BLOCK.SAND, subBlock: BLOCK.CLAY,
      surfaceVariants: [[BLOCK.SAND, 80], [BLOCK.CLAY, 10], [BLOCK.GRAVEL, 10]],
      subVariants:     [[BLOCK.CLAY, 55], [BLOCK.SAND, 30], [BLOCK.GRAVEL, 15]],
      stoneVariants:   [[BLOCK.STONE, 65], [BLOCK.ANDESITE, 10], [BLOCK.DIORITE, 10], [BLOCK.GRANITE, 15]],
      color: '#d1b247', name: 'Desert'
    },
    MOUNTAINS:    {
      baseY: 90,  amplitude: 20,
      surfaceBlock: BLOCK.GRASS, subBlock: BLOCK.STONE,
      surfaceVariants: [[BLOCK.GRASS, 35], [BLOCK.STONE, 25], [BLOCK.ANDESITE, 12], [BLOCK.DIORITE, 10], [BLOCK.GRANITE, 10], [BLOCK.COARSE_DIRT, 8]],
      subVariants:     [[BLOCK.STONE, 55], [BLOCK.ANDESITE, 15], [BLOCK.DIORITE, 12], [BLOCK.GRANITE, 10], [BLOCK.DIRT, 8]],
      stoneVariants:   [[BLOCK.STONE, 40], [BLOCK.ANDESITE, 18], [BLOCK.DIORITE, 15], [BLOCK.GRANITE, 17], [BLOCK.TUFF, 10]],
      color: '#607d8b', name: 'Mountains'
    },
    FROZEN_PEAKS: {
      baseY: 100, amplitude: 20,
      surfaceBlock: BLOCK.SNOW, subBlock: BLOCK.COARSE_DIRT,
      surfaceVariants: [[BLOCK.SNOW, 65], [BLOCK.STONE, 15], [BLOCK.ANDESITE, 8], [BLOCK.DIORITE, 7], [BLOCK.GRANITE, 5]],
      subVariants:     [[BLOCK.COARSE_DIRT, 50], [BLOCK.STONE, 30], [BLOCK.DIRT, 20]],
      stoneVariants:   [[BLOCK.STONE, 40], [BLOCK.ANDESITE, 18], [BLOCK.DIORITE, 15], [BLOCK.GRANITE, 17], [BLOCK.TUFF, 10]],
      color: '#e0f7fa', name: 'Frozen Peaks'
    }
  };

  var CONT_SPLINE = [
    [-1.0, -1.1], [-0.4, -0.6], [-0.1, -0.1], [0.1, 0.2], [0.25, 0.6], [0.5, 0.85], [1.0, 1.1]
  ];

  // ── Weighted random selection from variant arrays ──────────────────
  // Uses a deterministic per-column noise value to pick from weighted variants.
  function selectVariant(variants, noiseVal) {
    // noiseVal: -1..1 → normalize to 0..1
    var t = (noiseVal + 1) * 0.5;
    var totalWeight = 0;
    for (var vi = 0; vi < variants.length; vi++) {
      totalWeight += variants[vi][1];
    }
    var target = t * totalWeight;
    var accumulated = 0;
    for (var vi = 0; vi < variants.length; vi++) {
      accumulated += variants[vi][1];
      if (target <= accumulated) return variants[vi][0];
    }
    return variants[variants.length - 1][0];
  }

  var SEA_LEVEL = 64;

  // ── Feature placement rates per biome ─────────────────────────────
  // treeChance: per-column probability of attempting tree placement
  // redFlowerChance / yellowFlowerChance: per-column probability of placing a flower
  // treeMaxY: trees won't place above this height
  // flowerMaxY: flowers won't place above this height
  var FEATURE_RATES = {
    'Forest':       { treeChance: 0.008, redFlowerChance: 0.005, yellowFlowerChance: 0.005, treeMaxY: 125, flowerMaxY: 120 },
    'Plains':       { treeChance: 0.004, redFlowerChance: 0.015, yellowFlowerChance: 0.015, treeMaxY: 125, flowerMaxY: 120 },
    'Mountains':    { treeChance: 0.003, redFlowerChance: 0.002, yellowFlowerChance: 0.002, treeMaxY: 110, flowerMaxY: 115 },
    'Beach':        { treeChance: 0.001, redFlowerChance: 0.001, yellowFlowerChance: 0.001, treeMaxY: 125, flowerMaxY: 120 },
    'Tundra':       { treeChance: 0.00, redFlowerChance: 0.00, yellowFlowerChance: 0.00, treeMaxY: 125, flowerMaxY: 120 },
    'Desert':       { treeChance: 0.00, redFlowerChance: 0.00, yellowFlowerChance: 0.00, treeMaxY: 125, flowerMaxY: 120 },
    'Badlands':     { treeChance: 0.00, redFlowerChance: 0.00, yellowFlowerChance: 0.00, treeMaxY: 125, flowerMaxY: 120 },
    'Frozen Peaks': { treeChance: 0.00, redFlowerChance: 0.00, yellowFlowerChance: 0.00, treeMaxY: 125, flowerMaxY: 120 },
    'Ocean':        { treeChance: 0.00, redFlowerChance: 0.00, yellowFlowerChance: 0.00, treeMaxY: 125, flowerMaxY: 120 },
    'Deep Ocean':   { treeChance: 0.00, redFlowerChance: 0.00, yellowFlowerChance: 0.00, treeMaxY: 125, flowerMaxY: 120 }
  };

  // ── Ore definitions ────────────────────────────────────────────────
  // Shallow ores: stone-hosted (above Y=40)
  var ORE_DEFS_SHALLOW = [
    { type: BLOCK.COAL_ORE,    minY: 5,   maxY: 120, chance: 0.018, vein: 8 },
    { type: BLOCK.IRON_ORE,    minY: 5,   maxY: 85,  chance: 0.014, vein: 6 },
    { type: BLOCK.GOLD_ORE,    minY: 5,   maxY: 42,  chance: 0.006, vein: 4 },
    { type: BLOCK.DIAMOND_ORE, minY: 5,   maxY: 24,  chance: 0.003, vein: 3 },
    { type: BLOCK.COPPER_ORE,  minY: 5,   maxY: 60,  chance: 0.010, vein: 5 },
    { type: BLOCK.EMERALD_ORE, minY: 5,   maxY: 16,  chance: 0.002, vein: 2 }
  ];

  // Deep ores: deepslate-hosted (below Y=40)
  var ORE_DEFS_DEEP = [
    { type: BLOCK.DEEPSLATE_COAL_ORE,    minY: 5,   maxY: 40, chance: 0.018, vein: 8 },
    { type: BLOCK.DEEPSLATE_IRON_ORE,    minY: 5,   maxY: 40, chance: 0.014, vein: 6 },
    { type: BLOCK.DEEPSLATE_GOLD_ORE,    minY: 5,   maxY: 40, chance: 0.006, vein: 4 },
    { type: BLOCK.DEEPSLATE_DIAMOND_ORE, minY: 5,   maxY: 24, chance: 0.003, vein: 3 },
    { type: BLOCK.DEEPSLATE_COPPER_ORE,  minY: 5,   maxY: 40, chance: 0.010, vein: 5 },
    { type: BLOCK.DEEPSLATE_EMERALD_ORE, minY: 5,   maxY: 16, chance: 0.002, vein: 2 }
  ];

  // ── Tree types per biome ───────────────────────────────────────────
  // Maps biome name → weighted array of { log, leaves } tree types.
  // selectVariant picks based on per-column noise for variety within a biome.
  var TREE_TYPES = {
    'Forest':       [
      { log: BLOCK.BIRCH_LOG,    leaves: BLOCK.BIRCH_LEAVES,    weight: 25 },
      { log: BLOCK.WOOD_LOG,     leaves: BLOCK.LEAVES,          weight: 20 },
      { log: BLOCK.SPRUCE_LOG,   leaves: BLOCK.SPRUCE_LEAVES,   weight: 15 },
      { log: BLOCK.DARK_OAK_LOG, leaves: BLOCK.DARK_OAK_LEAVES, weight: 10 },
      { log: BLOCK.CHERRY_LOG,   leaves: BLOCK.CHERRY_LEAVES,   weight: 10 },
      { log: BLOCK.MANGROVE_LOG, leaves: BLOCK.MANGROVE_LEAVES, weight: 10 },
      { log: BLOCK.BAMBOO_BLOCK, leaves: BLOCK.LEAVES,          weight: 10 }
    ],
    'Plains':       [
      { log: BLOCK.WOOD_LOG,     leaves: BLOCK.LEAVES,          weight: 30 },
      { log: BLOCK.BIRCH_LOG,    leaves: BLOCK.BIRCH_LEAVES,    weight: 20 },
      { log: BLOCK.ACACIA_LOG,   leaves: BLOCK.ACACIA_LEAVES,   weight: 15 },
      { log: BLOCK.POPLAR_LOG,   leaves: BLOCK.ORANGE_POPLAR_LEAVES, weight: 10 },
      { log: BLOCK.CHERRY_LOG,   leaves: BLOCK.CHERRY_LEAVES,   weight: 10 },
      { log: BLOCK.PALE_OAK_LOG, leaves: BLOCK.PALE_OAK_LEAVES, weight: 15 }
    ],
    'Mountains':    [
      { log: BLOCK.SPRUCE_LOG,   leaves: BLOCK.SPRUCE_LEAVES,   weight: 40 },
      { log: BLOCK.WOOD_LOG,     leaves: BLOCK.LEAVES,          weight: 20 },
      { log: BLOCK.DARK_OAK_LOG, leaves: BLOCK.DARK_OAK_LEAVES, weight: 15 },
      { log: BLOCK.PALE_OAK_LOG, leaves: BLOCK.PALE_OAK_LEAVES, weight: 15 },
      { log: BLOCK.BAMBOO_BLOCK, leaves: BLOCK.LEAVES,          weight: 10 }
    ],
    'Tundra':       [
      { log: BLOCK.SPRUCE_LOG,   leaves: BLOCK.SPRUCE_LEAVES,   weight: 40 },
      { log: BLOCK.PALE_OAK_LOG, leaves: BLOCK.PALE_OAK_LEAVES, weight: 35 },
      { log: BLOCK.WOOD_LOG,     leaves: BLOCK.LEAVES,          weight: 25 }
    ],
    'Frozen Peaks': [
      { log: BLOCK.SPRUCE_LOG,   leaves: BLOCK.SPRUCE_LEAVES,   weight: 60 },
      { log: BLOCK.PALE_OAK_LOG, leaves: BLOCK.PALE_OAK_LEAVES, weight: 25 },
      { log: BLOCK.WOOD_LOG,     leaves: BLOCK.LEAVES,          weight: 15 }
    ],
    'Beach':        [
      { log: BLOCK.MANGROVE_LOG, leaves: BLOCK.MANGROVE_LEAVES, weight: 40 },
      { log: BLOCK.ACACIA_LOG,   leaves: BLOCK.ACACIA_LEAVES,   weight: 30 },
      { log: BLOCK.BAMBOO_BLOCK, leaves: BLOCK.LEAVES,          weight: 30 }
    ],
    'Desert':       [
      { log: BLOCK.ACACIA_LOG,   leaves: BLOCK.ACACIA_LEAVES,   weight: 40 },
      { log: BLOCK.BAMBOO_BLOCK, leaves: BLOCK.LEAVES,          weight: 30 },
      { log: BLOCK.WOOD_LOG,     leaves: BLOCK.LEAVES,          weight: 30 }
    ],
    'Badlands':     [
      { log: BLOCK.ACACIA_LOG,   leaves: BLOCK.ACACIA_LEAVES,   weight: 50 },
      { log: BLOCK.WOOD_LOG,     leaves: BLOCK.LEAVES,          weight: 50 }
    ],
    'Ocean':        [
      { log: BLOCK.MANGROVE_LOG, leaves: BLOCK.MANGROVE_LEAVES, weight: 100 }
    ],
    'Deep Ocean':   [
      { log: BLOCK.MANGROVE_LOG, leaves: BLOCK.MANGROVE_LEAVES, weight: 100 }
    ]
  };

  // ── Ground cover types per biome ───────────────────────────────────
  // Placed alongside flowers for surface variety.
  // Each entry: { block, weight } — selected via noise per column.
  var GROUND_COVER = {
    'Forest':       [
      { block: BLOCK.TALL_GRASS,       weight: 30 },
      { block: BLOCK.SHORT_GRASS,      weight: 25 },
      { block: BLOCK.BROWN_MUSHROOM,   weight: 15 },
      { block: BLOCK.RED_MUSHROOM,     weight: 5 },
      { block: BLOCK.RED_FLOWER,       weight: 15 },
      { block: BLOCK.YELLOW_FLOWER,    weight: 10 }
    ],
    'Plains':       [
      { block: BLOCK.TALL_GRASS,       weight: 35 },
      { block: BLOCK.SHORT_GRASS,      weight: 30 },
      { block: BLOCK.RED_FLOWER,       weight: 20 },
      { block: BLOCK.YELLOW_FLOWER,    weight: 15 }
    ],
    'Mountains':    [
      { block: BLOCK.SHORT_GRASS,      weight: 40 },
      { block: BLOCK.TALL_GRASS,       weight: 20 },
      { block: BLOCK.RED_FLOWER,       weight: 15 },
      { block: BLOCK.YELLOW_FLOWER,    weight: 10 },
      { block: BLOCK.BROWN_MUSHROOM,   weight: 15 }
    ],
    'Tundra':       [
      { block: BLOCK.SHORT_GRASS,      weight: 40 },
      { block: BLOCK.TALL_GRASS,       weight: 20 },
      { block: BLOCK.BROWN_MUSHROOM,   weight: 25 },
      { block: BLOCK.RED_MUSHROOM,     weight: 15 }
    ],
    'Frozen Peaks': [
      { block: BLOCK.SHORT_GRASS,      weight: 30 },
      { block: BLOCK.BROWN_MUSHROOM,   weight: 35 },
      { block: BLOCK.RED_MUSHROOM,     weight: 35 }
    ],
    'Beach':        [
      { block: BLOCK.SHORT_GRASS,      weight: 50 },
      { block: BLOCK.TALL_GRASS,       weight: 50 }
    ],
    'Desert':       [
      { block: BLOCK.SHORT_GRASS,      weight: 30 },
      { block: BLOCK.TALL_GRASS,       weight: 20 }
    ],
    'Badlands':     [
      { block: BLOCK.SHORT_GRASS,      weight: 20 },
      { block: BLOCK.TALL_GRASS,       weight: 10 }
    ],
    'Ocean':        [],
    'Deep Ocean':   []
  };

  // Helper: pick a tree type from weighted biome array using noise.
  function selectTreeType(treeTypes, noiseVal) {
    var t = (noiseVal + 1) * 0.5; // -1..1 → 0..1
    var totalWeight = 0;
    for (var i = 0; i < treeTypes.length; i++) {
      totalWeight += treeTypes[i].weight;
    }
    var target = t * totalWeight;
    var accumulated = 0;
    for (var i = 0; i < treeTypes.length; i++) {
      accumulated += treeTypes[i].weight;
      if (target <= accumulated) return treeTypes[i];
    }
    return treeTypes[treeTypes.length - 1];
  }

  // Helper: pick a ground cover block from weighted biome array using noise.
  function selectGroundCover(coverTypes, noiseVal) {
    if (!coverTypes || coverTypes.length === 0) return null;
    var t = (noiseVal + 1) * 0.5;
    var totalWeight = 0;
    for (var i = 0; i < coverTypes.length; i++) {
      totalWeight += coverTypes[i].weight;
    }
    var target = t * totalWeight;
    var accumulated = 0;
    for (var i = 0; i < coverTypes.length; i++) {
      accumulated += coverTypes[i].weight;
      if (target <= accumulated) return coverTypes[i].block;
    }
    return coverTypes[coverTypes.length - 1].block;
  }

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
  // Widened thresholds: lower humidity cutoff for forest, added highlands biome,
  // reduced plains catch-all area.
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
    // Mountain peaks — high continentalness + low erosion
    if (cont > 0.45 && eros < 0) {
      return isCold ? BIOME.FROZEN_PEAKS : BIOME.MOUNTAINS;
    }
    // Hot biomes (checked before highlands so deserts/badlands aren't overridden)
    if (temp > 0.45) {
      return hum < -0.1 ? BIOME.DESERT : BIOME.BADLANDS;
    }
    // Highlands — elevated continental areas in temperate/cold zones
    // These get mountain-like terrain with stone exposure but lower height
    if (cont > 0.35 && eros < 0.05) {
      return isCold ? BIOME.FROZEN_PEAKS : BIOME.MOUNTAINS;
    }
    // Cold land
    if (isCold) {
      return BIOME.TUNDRA;
    }
    // Default: forest or plains — widened forest range (hum > 0.0 instead of 0.2)
    if (hum > 0.0) return BIOME.FOREST;
    // Semi-arid interior: badlands instead of plains
    if (hum < -0.2) return BIOME.BADLANDS;
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

    return { baseY: sumBase / sumW, amplitude: sumAmp / sumW, biome: dominantBiome, isCold: blendedTemp < -0.35, humidity: blendedHum };
  }

  // ── Feature placement (trees + flowers) ─────────────────────────────
  // Called as Phase 4 after terrain, caves, and ores are complete.
  // Receives biomeMap (256 entries, one per column) with biome names from Phase 1.
  function placeFeatures(chunk, surfaceMap, biomeMap, rng, perlin, chunkX, chunkZ) {
    var placedTrees = []; // [{lx, lz}] for exclusion zone checks
    var treeCount = 0, flowerCount = 0;

    // ── Debug: count biome distribution ────────────────────────────
    var biomeCounts = {};
    var grassCols = 0;
    for (var dbg = 0; dbg < 256; dbg++) {
      var dbgName = biomeMap[dbg];
      biomeCounts[dbgName] = (biomeCounts[dbgName] || 0) + 1;
      var dbgY = surfaceMap[dbg];
      var dbgLx = dbg % 16, dbgLz = Math.floor(dbg / 16);
      if (chunk[cidx(dbgLx, dbgY, dbgLz)] === BLOCK.GRASS) grassCols++;
    }
    // console.log('[placeFeatures] biomes=' + JSON.stringify(biomeCounts) + ' grassCols=' + grassCols);

    // ── Tree placement pass ────────────────────────────────────────
    for (var lx = 0; lx < 16; lx++) {
      for (var lz = 0; lz < 16; lz++) {
        var wx = chunkX * 16 + lx, wz = chunkZ * 16 + lz;
        var idx = lx * 16 + lz;
        var surfY = surfaceMap[idx];
        if (surfY < 2 || surfY >= CHUNK_H - 10) continue;

        // Trees on grass-like blocks (grass, podzol, mycelium, moss).
        var treeSurface = chunk[cidx(lx, surfY, lz)];
        if (treeSurface !== BLOCK.GRASS && treeSurface !== BLOCK.PODZOL &&
            treeSurface !== BLOCK.MYCELIUM && treeSurface !== BLOCK.MOSS_BLOCK) continue;

        // Look up biome rates.
        var biomeName = biomeMap[idx];
        var rates = FEATURE_RATES[biomeName];
        if (!rates || rates.treeChance <= 0) continue;

        // Look up biome-specific tree types (weighted array).
        var treeTypeList = TREE_TYPES[biomeName];
        if (!treeTypeList || treeTypeList.length === 0) treeTypeList = TREE_TYPES['Plains'];

        // Elevation cap.
        if (surfY > rates.treeMaxY) continue;

        // Don't place trees near chunk edges — canopy extends ±2 blocks.
        if (lx < 2 || lx > 13 || lz < 2 || lz > 13) continue;

        // Roll against per-column chance.
        var roll = rng();
        if (roll > rates.treeChance) continue;

        // Check exclusion zone (4-block radius from any placed tree).
        var tooClose = false;
        for (var t = 0; t < placedTrees.length; t++) {
          var dx = lx - placedTrees[t].lx;
          var dz = lz - placedTrees[t].lz;
          if (Math.abs(dx) < 4 && Math.abs(dz) < 4) { tooClose = true; break; }
        }
        if (tooClose) continue;

        // Pick tree type from weighted variants using per-column noise.
        var treeNoise = perlin.det.noise2(wx / 12 + lx * 0.7, wz / 12 + lz * 0.7);
        var treeType = selectTreeType(treeTypeList, treeNoise);

        // Place tree: 4-block trunk + 5×5×5 leaf canopy.
        var trunkH = 4;
        var baseY = surfY + 1; // First log sits on top of grass.

        // Trunk.
        for (var ty = 0; ty < trunkH; ty++) {
          var logY = baseY + ty;
          if (logY < CHUNK_H) {
            chunk[cidx(lx, logY, lz)] = treeType.log;
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
                if (existing === BLOCK.AIR || existing === BLOCK.CAVE_AIR || existing === treeType.leaves) {
                  chunk[cidx(bx, by, bz)] = treeType.leaves;
                }
              }
            }
          }
        }

        placedTrees.push({ lx: lx, lz: lz });
        treeCount++;
      }
    }

    // ── Ground cover placement pass (grass, flowers, mushrooms) ────
    for (var lx = 0; lx < 16; lx++) {
      for (var lz = 0; lz < 16; lz++) {
        var wx = chunkX * 16 + lx, wz = chunkZ * 16 + lz;
        var idx = lx * 16 + lz;
        var surfY = surfaceMap[idx];
        if (surfY < 1 || surfY >= CHUNK_H - 1) continue;

        // Ground cover on grass-like blocks (grass, podzol, mycelium, moss).
        var surfaceBlock = chunk[cidx(lx, surfY, lz)];
        if (surfaceBlock !== BLOCK.GRASS && surfaceBlock !== BLOCK.PODZOL &&
            surfaceBlock !== BLOCK.MYCELIUM && surfaceBlock !== BLOCK.MOSS_BLOCK) continue;

        // Look up biome rates.
        var biomeName = biomeMap[idx];
        var rates = FEATURE_RATES[biomeName];
        if (!rates) continue;

        // Elevation cap.
        if (surfY > rates.flowerMaxY) continue;

        // Check if a tree is already on this column — skip ground cover under trees.
        var treeHere = false;
        for (var t = 0; t < placedTrees.length; t++) {
          if (placedTrees[t].lx === lx && placedTrees[t].lz === lz) { treeHere = true; break; }
        }
        if (treeHere) continue;

        // Combined ground cover chance: sum of flower rates + grass rate.
        var coverChance = (rates.redFlowerChance + rates.yellowFlowerChance) * 1.5;
        var roll = rng();
        if (roll > coverChance) continue;

        // Pick ground cover type from biome's weighted array using per-column noise.
        var coverTypes = GROUND_COVER[biomeName];
        if (!coverTypes || coverTypes.length === 0) continue;

        var coverNoise = perlin.c1.noise2(wx / 10 + lx * 1.3, wz / 10 + lz * 1.3);
        var coverBlock = selectGroundCover(coverTypes, coverNoise);
        if (coverBlock) {
          chunk[cidx(lx, surfY + 1, lz)] = coverBlock;
          flowerCount++;
        }
      }
    }

    // Diagnostic (worker console — check Workers filter in DevTools).
    var biomeDist = {};
    for (var d = 0; d < 256; d++) { var bn = biomeMap[d]; biomeDist[bn] = (biomeDist[bn] || 0) + 1; }
    // console.log('[placeFeatures] trees=' + treeCount + ' flowers=' + flowerCount + ' biomes=' + JSON.stringify(biomeDist));
  }

  // ── Ore placement ───────────────────────────────────────────────────
  // Deepslate transition depth — below this Y, terrain is deepslate and ores use deepslate variants
  var DEEPSLATE_DEPTH = 40;
  function placeOres(chunk, rng) {
    // Use shallow ores above DEEPSLATE_DEPTH, deep ores below
    var oreDefs = ORE_DEFS_SHALLOW;
    for (var oi = 0; oi < oreDefs.length; oi++) {
      var ore = oreDefs[oi];
      var attempts = Math.floor(16 * 16 * ore.chance * 10);
      for (var a = 0; a < attempts; a++) {
        if (rng() > ore.chance * 60) continue;
        var ox = Math.floor(rng() * 16);
        var oy = Math.floor(rng() * (ore.maxY - ore.minY)) + ore.minY;
        var oz = Math.floor(rng() * 16);
        // Skip if ore would place below deepslate depth
        if (oy < DEEPSLATE_DEPTH) continue;
        for (var v = 0; v < ore.vein; v++) {
          var bx = Math.max(0, Math.min(15, ox + Math.floor(rng() * 3) - 1));
          var by = Math.max(0, Math.min(CHUNK_H - 1, oy + Math.floor(rng() * 3) - 1));
          var bz = Math.max(0, Math.min(CHUNK_D - 1, oz + Math.floor(rng() * 3) - 1));
          // Place ores in stone and stone variants (andesite, diorite, granite, tuff)
          var hostBlock = chunk[cidx(bx, by, bz)];
          if (hostBlock === BLOCK.STONE || hostBlock === BLOCK.ANDESITE ||
              hostBlock === BLOCK.DIORITE || hostBlock === BLOCK.GRANITE ||
              hostBlock === BLOCK.TUFF) {
            chunk[cidx(bx, by, bz)] = ore.type;
          }
        }
      }
    }

    // Deepslate ores (below DEEPSLATE_DEPTH)
    var deepDefs = ORE_DEFS_DEEP;
    for (var oi = 0; oi < deepDefs.length; oi++) {
      var ore = deepDefs[oi];
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
          // Place in deepslate, stone, or stone variants
          var existing = chunk[cidx(bx, by, bz)];
          if (existing === BLOCK.DEEPSLATE || existing === BLOCK.STONE ||
              existing === BLOCK.ANDESITE || existing === BLOCK.DIORITE ||
              existing === BLOCK.GRANITE || existing === BLOCK.TUFF) {
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
    var humidityMap = new Float32Array(256); // Normalized 0..1 humidity per column, for vertex color tinting

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
        // Store normalized humidity (0..1 from -1..1 range) for vertex color tinting
        humidityMap[lx * 16 + lz] = Math.max(0, Math.min(1, blended.humidity * 0.5 + 0.5));

        var isSub = surfY <= SEA_LEVEL + 1;

        // ── Block placement for this column (top-down) ────────────────
        // Per-column noise for deterministic variant selection (same value for all layers).
        var surfaceNoise = p.det.noise2(wx / 25, wz / 25);
        var subNoise     = p.c1.noise2(wx / 25 + 500, wz / 25 + 500);
        var stoneNoise   = p.c2.noise2(wx / 25 + 1000, wz / 25 + 1000);

        for (var y = 0; y < CHUNK_H; y++) {
          var block;
          if (y === 0) {
            block = BLOCK.BEDROCK;
          } else if (y <= 3 && rngSurface() < (4 - y) * 0.25) {
            block = BLOCK.BEDROCK; // Random bedrock scatter near bottom.
          } else if (y < surfY - 3) {
            // Deep stone layer — use biome's stoneVariants for mix.
            if (y < DEEPSLATE_DEPTH) {
              block = BLOCK.DEEPSLATE;
            } else {
              // Stone variants: andesite, diorite, granite, tuff mixed with stone.
              var stoneVar = blended.biome.stoneVariants || [[BLOCK.STONE, 100]];
              // Add vertical variation: deeper layers shift toward granite/tuff.
              var depthNoise = p.jitter.noise3(wx / 30, y / 20, wz / 30);
              block = selectVariant(stoneVar, stoneNoise + depthNoise * 0.3);
            }
          } else if (y < surfY) {
            // Sub-block layer — use biome's subVariants for mix.
            if (mountainFactor > 0.5 && blended.isCold) {
              block = BLOCK.COARSE_DIRT;
            } else if (mountainFactor > 0.5) {
              // Mountain sub-layer: stone variants.
              var mStoneVar = blended.biome.subVariants || [[BLOCK.STONE, 100]];
              block = selectVariant(mStoneVar, subNoise);
            } else {
              var subVar = blended.biome.subVariants || [[blended.biome.subBlock, 100]];
              block = selectVariant(subVar, subNoise);
            }
          } else if (y === surfY) {
            // Surface block — altitude snow + biome logic with variant mixing.
            var snowNoiseVal = p.temp.noise3(wx / 60, y / 30, wz / 60);

            if (y > 130 && blended.biome.name !== 'Desert' && blended.biome.name !== 'Badlands') {
              // High altitude always gets snow in non-desert biomes.
              if (snowNoiseVal < -0.25) block = BLOCK.STONE;
              else if (snowNoiseVal < 0.1) {
                // Use surface variants for grassy highlands.
                var sVar = blended.biome.surfaceVariants || [[BLOCK.GRASS, 100]];
                block = selectVariant(sVar, surfaceNoise);
              } else {
                block = BLOCK.SNOW;
              }
            } else if (mountainFactor > 0.3 && blended.isCold) {
              // Cold mountain terrain: layered snow transition.
              if (y > 110) block = BLOCK.SNOW;
              else if (y > 85) block = (snowNoiseVal < -0.2) ? BLOCK.STONE : BLOCK.SNOW;
              else {
                var sVar2 = blended.biome.surfaceVariants || [[BLOCK.GRASS, 100]];
                block = selectVariant(sVar2, surfaceNoise);
              }
            } else if ((blended.biome.frozenWater || blended.isCold) && surfY >= SEA_LEVEL) {
              // Cold terrain surface — use variants for snow biome.
              var sVar3 = blended.biome.surfaceVariants || [[BLOCK.SNOW, 100]];
              block = selectVariant(sVar3, surfaceNoise);
            } else if ((blended.biome.frozenWater || blended.isCold) && surfY < SEA_LEVEL) {
              block = (surfY < SEA_LEVEL - 35) ? BLOCK.GRAVEL : BLOCK.SAND; // Frozen ocean floor.
            } else if (mountainFactor > 0.5 && y > 120) {
              // Mountain terrain: stone exposed at high elevation — use stone variants.
              if (snowNoiseVal < 0) {
                var stVar = blended.biome.stoneVariants || [[BLOCK.STONE, 100]];
                block = selectVariant(stVar, stoneNoise);
              } else {
                var sVar4 = blended.biome.surfaceVariants || [[blended.biome.surfaceBlock, 100]];
                block = selectVariant(sVar4, surfaceNoise);
              }
            } else {
              // Normal surface — use biome's surfaceVariants.
              if (isSub && blended.biome.name === 'Plains' || isSub && blended.biome.name === 'Forest') {
                block = BLOCK.SAND; // Shallow water edge.
              } else {
                var sVar5 = blended.biome.surfaceVariants || [[blended.biome.surfaceBlock, 100]];
                block = selectVariant(sVar5, surfaceNoise);
              }
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
          // Cave carving works through stone variants too (andesite, diorite, granite, tuff)
          if (b !== BLOCK.STONE && b !== BLOCK.ANDESITE && b !== BLOCK.DIORITE &&
              b !== BLOCK.GRANITE && b !== BLOCK.TUFF &&
              b !== BLOCK.DIRT && b !== BLOCK.GRAVEL && b !== BLOCK.SAND) continue;

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
    placeFeatures(chunk, surfaceMap, biomeMap, rngFeature, p, chunkX, chunkZ);

    // Return result (used by both worker and inline fallback).
    // humidityMap: 256 floats (one per column), normalized 0..1 from biome humidity.
    // Used by mesh builder for vertex color tinting (grass/leaves).
    return {
      cx: chunkX - params.baseChunkX,
      cz: chunkZ - params.baseChunkZ,
      chunkBytes: chunk.buffer,       // ArrayBuffer — transferred by worker
      humidityMap: Array.from(humidityMap)  // Float32 values 0..1
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
            chunkBytes: result.chunkBytes,
            humidityMap: result.humidityMap  // Float32Array 256 values 0..1
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
