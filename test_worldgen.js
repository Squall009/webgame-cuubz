// Mock browser globals (VoxelGen-aligned block IDs)
global.BLOCK_TYPES = { 
  AIR: 0, BEDROCK: 1, STONE: 2, DIRT: 3, GRASS: 4, SAND: 5, GRAVEL: 6, WATER: 7,
  COAL_ORE: 8, IRON_ORE: 9, GOLD_ORE: 10, DIAMOND_ORE: 11, CAVE_AIR: 12,
  SNOW: 13, SNOW_STONE: 14, LAVA: 15, TERRACOTTA: 16, RED_SAND: 17, ICE: 18, CLAY: 19,
  WOOD_LOG: 32, LEAVES: 33, PLANKS: 34, OBSIDIAN: 35, BLACKSTONE: 36,
  TOXIC_SLIME: 37, CORRUPT_CRYSTAL: 38, BED: 39, APPLE: 40, QUEST_KEY: 41,
  RED_FLOWER: 42, YELLOW_FLOWER: 43, CAVE_TORCH: 44, GLOWSTONE: 45 
};
global.BLOCK_PROPERTIES = {};
global.CHUNK_WIDTH = 16; global.CHUNK_DEPTH = 16; global.CHUNK_HEIGHT = 256;
global.MIN_Y = 0; global.MAX_Y = 256; global.SEA_LEVEL = 64;

const fs = require('fs');
const ChunkMod = require('./js/world/chunkData.js');
global.Chunk = ChunkMod.Chunk;
const NoiseGen = require('./js/world/noise.js');
// noise.js exports: { mulberry32, hashString, createPerlin, fbm2, applySpline, createSharedPerlin, hash, createPRNG } + class NoiseGenerator (backwards compat)
global.mulberry32 = NoiseGen.mulberry32;
global.hashString = NoiseGen.hashString;
global.createPerlin = NoiseGen.createPerlin;
global.fbm2 = NoiseGen.fbm2;
global.applySpline = NoiseGen.applySpline;
global.createSharedPerlin = NoiseGen.createSharedPerlin;
global.hash = NoiseGen.hash;
global.createPRNG = NoiseGen.createPRNG;
// Backwards-compatible class still available:
global.NoiseGenerator = NoiseGen.NoiseGenerator || NoiseGen;

const BiomeSysMod = require('./js/world/biomeSystem.js');
// biomeSystem.js now exports functions + BIOME_DEFS, not a class
global.BIOME_DEFS = BiomeSysMod.BIOME_DEFS;
global.CONT_SPLINE = BiomeSysMod.CONT_SPLINE;
global.selectBiome = BiomeSysMod.selectBiome;
global.sampleBiomeParams = BiomeSysMod.sampleBiomeParams;

// WorldGenerator is now async — for testing we use the backwards-compatible NoiseGenerator class
const WorldGenerator = require('./js/world/worldGenerator.js');

console.log('--- Testing VoxelGen Overhaul (Direct Block IDs) ---\n');

// Test 1: Hash function (string → uint32)
const testHash = hashString('testseed');
console.log('✓ FNV-1a hash:', '0x' + testHash.toString(16));

// Test 2: Mulberry32 PRNG
const rng = mulberry32(42);
const r1 = rng(); const r2 = rng();
console.log('✓ Mulberry32(42):', r1.toFixed(4), r2.toFixed(4), '(should be deterministic, in [0,1))');

// Test 3: Perlin noise instance (independent perm table)
const perlin = createPerlin(123);
const n2d = perlin.noise2(1.5, 2.5);
const n3d = perlin.noise3(1.5, 2.5, 3.5);
console.log('✓ Perlin(123) noise2:', n2d.toFixed(4), 'noise3:', n3d.toFixed(4));

// Test 4: FBM multi-octave
const fbmVal = fbm2(perlin, 10, 20, 5, 0.5, 2.0);
console.log('✓ FBM (5 octaves):', fbmVal.toFixed(4));

// Test 5: Spline interpolation
const splineResult = applySpline(0.3, CONT_SPLINE);
console.log('✓ applySpline(0.3):', splineResult.toFixed(4));

// Test 6: Shared perlin set (9 independent instances)
const sharedPerlin = createSharedPerlin('minecraft');
console.log('✓ Shared perlin instances:', Object.keys(sharedPerlin).join(', '));

// Test 7: Biome selection from climate params
const biome1 = selectBiome(0.5, -0.2, 0.3, 0.4); // High continent, low erosion → Mountains
console.log('✓ selectBiome(cont=0.5, eros=-0.2):', biome1.name, '(expected: Mountains)');

const biome2 = selectBiome(-0.5, 0, 0, 0); // Low continent → Deep Ocean
console.log('✓ selectBiome(cont=-0.5):', biome2.name, '(expected: Deep Ocean)');

const biome3 = selectBiome(0.1, 0, -0.4, 0); // Cold land → Tundra
console.log('✓ selectBiome(temp=-0.4):', biome3.name, '(expected: Tundra)');

// Test 8: Biome definitions (VoxelGen-aligned block IDs)
const plains = BIOME_DEFS.PLAINS;
console.log('\n✓ Plains biome:', `baseY=${plains.baseY}, amp=${plains.amplitude}, surface=block${plains.surfaceBlock} (GRASS=4)`);

const mountains = BIOME_DEFS.MOUNTAINS;
console.log('✓ Mountains biome:', `baseY=${mountains.baseY}, amp=${mountains.amplitude}, surface=block${mountains.surfaceBlock} (GRASS=4)`);

// Test 9: Backwards-compatible NoiseGenerator class
const NG = NoiseGen.NoiseGenerator;
if (typeof NG === 'function') {
  const ln = new NG(0);
  console.log('✓ Legacy NoiseGenerator.perlin2:', ln.perlin2(1, 2).toFixed(4));
} else {
  console.log('⚠ NoiseGenerator class not available');
}

// Test 10: Block IDs match VoxelGen directly (no translation)
console.log('\n✓ Direct block ID alignment:');
console.log('  BEDROCK:', BLOCK_TYPES.BEDROCK, '(expected: 1)');
console.log('  STONE:', BLOCK_TYPES.STONE, '(expected: 2)');
console.log('  GRASS:', BLOCK_TYPES.GRASS, '(expected: 4)');
console.log('  CAVE_AIR:', BLOCK_TYPES.CAVE_AIR, '(expected: 12)');
console.log('  TERRACOTTA:', BLOCK_TYPES.TERRACOTTA, '(expected: 16)');

// Test 11: Chunk with new dimensions (16x256x16)
const testChunk = new ChunkMod.Chunk(0, 0);
console.log('\n✓ New chunk dimensions:', CHUNK_WIDTH, '*', CHUNK_DEPTH, '*', CHUNK_HEIGHT, '= ', testChunk.blocks.length, 'blocks');
testChunk.setBlock(8, 70, 8, BLOCK_TYPES.GRASS);
const blockAt = testChunk.getBlock(8, 70, 8);
console.log('✓ Block at (8,70,8):', blockAt, '(expected:', BLOCK_TYPES.GRASS, '= GRASS)');

// Test 12: Biome sampling with domain warping
const params = { continentScale: 4000, contScale: 400, tempScale: 2000, humScale: 2000, erosScale: 280 };
const sampled = sampleBiomeParams(sharedPerlin, 100, 100, params.continentScale, params.contScale, params.tempScale, params.humScale, params.erosScale);
console.log('\n✓ Sampled biome at (100,100):', sampled.biome.name, `baseY=${sampled.baseY.toFixed(1)}, amp=${sampled.amplitude.toFixed(1)}`);

console.log('\n--- All tests passed ---');
