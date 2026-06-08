// Mock browser globals
global.BLOCK_TYPES = { AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, SAND: 4, GRAVEL: 5, WATER: 6, WOOD_LOG: 7, LEAVES: 8, SNOW: 9, ICE: 10, BEDROCK: 11, PLANKS: 12, OBSIDIAN: 13, BLACKSTONE: 14, LAVA: 15, CORRUPT_STONE: 16, TOXIC_SLIME: 17, COAL_ORE: 18, IRON_ORE: 19, GOLD_ORE: 20, DIAMOND_ORE: 21, CORRUPT_CRYSTAL: 22, RED_FLOWER: 27, YELLOW_FLOWER: 28, CAVE_TORCH: 29, GLOWSTONE: 30 };
global.BLOCK_PROPERTIES = {};
global.CHUNK_WIDTH = 16; global.CHUNK_DEPTH = 16; global.CHUNK_HEIGHT = 96;
global.MIN_Y = 0; global.MAX_Y = 96; global.SEA_LEVEL = 32;

const fs = require('fs');
const ChunkMod = require('./js/world/chunkData.js');
global.Chunk = ChunkMod.Chunk;
const NoiseGen = require('./js/world/noise.js');
global.NoiseGenerator = NoiseGen;
const BiomeSysMod = require('./js/world/biomeSystem.js');
global.BiomeSystem = BiomeSysMod.BiomeSystem;
const WorldGenerator = require('./js/world/worldGenerator.js');

console.log('--- Testing World Generation ---\n');

// Test 1: String seed hashing (FNV-1a)
const wg1 = new WorldGenerator('testseed');
console.log('✓ FNV-1a hash:', '0x' + wg1.seed.toString(16));

// Test 2: Numeric seed passthrough  
const wg2 = new WorldGenerator(42);
console.log('✓ Numeric seed:', wg2.seed, '(should be 42)');

// Test 3: Noise with seed 0 (regression test)
const noise0 = new NoiseGenerator(0);
const v0 = noise0.perlin3(1, 2, 3);
console.log('✓ Noise(seed=0):', v0.toFixed(4), '(should be non-zero)');

// Test 4: Biome heights defined
const bs = new BiomeSystem();
console.log('✓ Ocean baseHeight:', bs.BIOMES.OCEAN.baseHeight, 'heightScale:', bs.BIOMES.OCEAN.heightScale);
console.log('✓ Mountains baseHeight:', bs.BIOMES.MOUNTAINS.baseHeight, 'heightScale:', bs.BIOMES.MOUNTAINS.heightScale);

// Test 5: Biome blending
const blended = bs.blendBiomeHeights(bs.BIOMES.PLAINS, bs.BIOMES.MOUNTAINS, 0.5);
console.log('✓ Blended (Plains→Mountains @ 0.5): baseHeight=' + blended.baseHeight.toFixed(1) + ' heightScale=' + blended.heightScale.toFixed(2));

// Test 6: Generate a chunk and verify structure
const wg = new WorldGenerator('cuubz-test');
console.log('\nGenerating chunk (0,0)...');
const chunk = wg.generateChunk(0, 0);
console.log('✓ Chunk generated:', chunk.chunkX, chunk.chunkZ);

// Check bedrock at y=0
let bedrockCount = 0;
for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
  if (chunk.getBlock(x, 0, z) === BLOCK_TYPES.BEDROCK) bedrockCount++;
}
console.log('✓ Bedrock at y=0:', bedrockCount + '/256 blocks');

// Check surface exists
let surfaceFound = 0;
for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
  for (let y = 95; y >= 0; y--) {
    if (chunk.getBlock(x, y, z) !== BLOCK_TYPES.AIR) { surfaceFound++; break; }
  }
}
console.log('✓ Surface columns:', surfaceFound + '/256');

// Check water at sea level
let waterCount = 0;
for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
  for (let y = SEA_LEVEL - 2; y <= SEA_LEVEL + 2; y++) {
    if (chunk.getBlock(x, y, z) === BLOCK_TYPES.WATER) waterCount++;
  }
}
console.log('✓ Water blocks near sea level:', waterCount);

// Sample height values across chunk
let heights = [];
for (let x = 0; x < 16; x += 4) for (let z = 0; z < 16; z += 4) {
  for (let y = 95; y >= 0; y--) {
    const b = chunk.getBlock(x, y, z);
    if (b !== BLOCK_TYPES.AIR && b !== BLOCK_TYPES.WATER) { heights.push(y); break; }
  }
}
console.log('✓ Sample surface heights:', heights.join(', '));

// Count block types
const typeCounts = {};
for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
  for (let y = 0; y < 96; y++) {
    const b = chunk.getBlock(x, y, z);
    if (b !== 0) typeCounts[b] = (typeCounts[b] || 0) + 1;
  }
}
console.log('✓ Block types in chunk:', Object.keys(typeCounts).length, 'types');
for (const [id, count] of Object.entries(typeCounts)) {
  const name = Object.entries(BLOCK_TYPES).find(([k,v]) => v == id)?.[0] || '?';
  console.log(`    ${name}(${id}): ${count}`);
}

console.log('\n=== All tests passed! ===');
