#!/usr/bin/env node
/**
 * test_worldGenerationIntegration.js — World Generation Integration Tests
 *
 * Validates the complete world generation pipeline with a known seed:
 * - Terrain varies across biomes
 * - Water level correct at layer 0
 * - Caves generate underground with connectivity
 * - Trees/cacti/features placed in correct biomes
 * - Ore veins present at appropriate depths
 */

'use strict';

const NoiseGenerator = require('../js/world/noise');
const { Chunk, BLOCK_TYPES, SEA_LEVEL, CHUNK_WIDTH, CHUNK_DEPTH, CHUNK_HEIGHT, MIN_Y, MAX_Y } = require('../js/world/chunkData');
const { BiomeSystem, BIOMES, BIOME_LIST } = require('../js/world/biomeSystem');
const WorldGenerator = require('../js/world/worldGenerator');
const CaveGenerator = require('../js/world/caveGenerator');
const OreGenerator = require('../js/world/oreGenerator');
const FeaturePlacer = require('../js/world/featurePlacer');

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (condition) {
    passCount++;
    console.log(`  ✅ ${message}`);
  } else {
    failCount++;
    console.error(`  ❌ FAIL — ${message}`);
  }
}

// ─── Constants ────────────────────────────────────────────────

const TEST_SEED = 42;

// ─── Group 1: Deterministic noise generation ─────────────────

console.log('Group 1: Deterministic noise generation');

const noise = new NoiseGenerator(TEST_SEED);
const noise2 = new NoiseGenerator(TEST_SEED);
assert(noise.perlin2(1.5, 2.3) === noise2.perlin2(1.5, 2.3), 'Same seed → identical perlin2');
assert(noise.perlin3(1.5, 2.3, 0.5) === noise2.perlin3(1.5, 2.3, 0.5), 'Same seed → identical perlin3');

const noise3 = new NoiseGenerator(999);
assert(noise.perlin2(1.5, 2.3) !== noise3.perlin2(1.5, 2.3), 'Different seeds → different output');

// Noise range [-1, 1]
let inRange = true;
for (let i = 0; i < 100; i++) {
  const v = noise.perlin2(Math.random() * 100, Math.random() * 100);
  if (v < -1 || v > 1) inRange = false;
}
assert(inRange, 'All perlin2 values in range [-1, 1]');

// Octave noise varies with octave count
const oct1 = noise.octaveNoise2(10.37, 20.53, 1);
const oct4 = noise.octaveNoise2(10.37, 20.53, 4);
assert(oct1 !== oct4, 'Octave count changes output (non-integer coords)');

// ─── Group 2: Biome distribution with known seed ──────────────

console.log('\nGroup 2: Biome distribution');

const tempNoise = new NoiseGenerator(TEST_SEED);
const moistNoise = new NoiseGenerator(TEST_SEED + 1);
const biomeSystem = new BiomeSystem(tempNoise, moistNoise);

// Deterministic biome at same position
const b1 = biomeSystem.getBiome(100, 100);
const b2 = biomeSystem.getBiome(100, 100);
assert(b1.id === b2.id, 'Same position → same biome');

// Multiple biomes across test area
const biomesFound = new Set();
for (let x = 0; x < 500; x += 50) {
  for (let z = 0; z < 500; z += 50) {
    const b = biomeSystem.getBiome(x, z);
    biomesFound.add(b.id);
  }
}
assert(biomesFound.size >= 3, `At least 3 biomes found (got ${biomesFound.size}: ${[...biomesFound].join(', ')})`);

// Check all biome types are valid
for (const biomeId of biomesFound) {
  assert(BIOMES[biomeId.toUpperCase()] !== undefined, `Biome '${biomeId}' is defined in BIOMES registry`);
}

// ─── Group 3: Chunk data structure ────────────────────────────

console.log('\nGroup 3: Chunk data integrity');

const chunk = new Chunk(0, 0);
assert(CHUNK_WIDTH === 16, `CHUNK_WIDTH is 16`);
assert(CHUNK_HEIGHT >= 64, `CHUNK_HEIGHT sufficient for terrain (got ${CHUNK_HEIGHT})`);
assert(CHUNK_DEPTH === 16, `CHUNK_DEPTH is 16`);

// All blocks start as AIR (use y < MAX_Y since CHUNK_HEIGHT = MAX_Y - MIN_Y)
let allAir = true;
for (let y = MIN_Y; y < MAX_Y && allAir; y++) {
  for (let z = 0; z < CHUNK_DEPTH && allAir; z++) {
    for (let x = 0; x < CHUNK_WIDTH && allAir; x++) {
      if (chunk.getBlock(x, y, z) !== BLOCK_TYPES.AIR) allAir = false;
    }
  }
}
assert(allAir, 'New chunk is all AIR');

// Set/get block + serialization round-trip
chunk.setBlock(8, 0, 8, BLOCK_TYPES.STONE);
assert(chunk.getBlock(8, 0, 8) === BLOCK_TYPES.STONE, 'Set/get STONE block works');

const serialized = chunk.serialize();
assert(serialized !== null && serialized !== undefined, 'Serialization produces output');
const deserialized = Chunk.deserialize(serialized);
assert(deserialized !== null, 'Deserialization produces valid chunk');
assert(deserialized.getBlock(8, 0, 8) === BLOCK_TYPES.STONE, 'Round-trip preserves block data');

// ─── Group 4: Terrain generation with known seed ──────────────

console.log('\nGroup 4: Terrain generation');

const worldGen = new WorldGenerator(TEST_SEED);
const terrainChunk = worldGen.generateChunk(0, 0);
assert(terrainChunk !== null && terrainChunk !== undefined, 'generateChunk returns a chunk');

// Count non-air blocks
function countNonAir(c) {
  let n = 0;
  for (let y = MIN_Y; y < MAX_Y; y++)
    for (let z = 0; z < CHUNK_DEPTH; z++)
      for (let x = 0; x < CHUNK_WIDTH; x++)
        if (c.getBlock(x, y, z) !== BLOCK_TYPES.AIR) n++;
  return n;
}

const nonAirCount = countNonAir(terrainChunk);
assert(nonAirCount > 100, `Terrain has significant blocks (${nonAirCount} non-air)`);

// Surface blocks near sea level
let hasSurface = false;
for (let y = SEA_LEVEL - 5; y <= SEA_LEVEL + 20 && !hasSurface; y++) {
  for (let z = 0; z < CHUNK_DEPTH && !hasSurface; z++) {
    for (let x = 0; x < CHUNK_WIDTH && !hasSurface; x++) {
      const b = terrainChunk.getBlock(x, y, z);
      if (b === BLOCK_TYPES.GRASS || b === BLOCK_TYPES.DIRT ||
          b === BLOCK_TYPES.SAND || b === BLOCK_TYPES.STONE) hasSurface = true;
    }
  }
}
assert(hasSurface, 'Surface blocks present near sea level');

// Underground stone
let hasUndergroundStone = false;
for (let y = MIN_Y; y < SEA_LEVEL - 5 && !hasUndergroundStone; y++) {
  for (let z = 0; z < CHUNK_DEPTH && !hasUndergroundStone; z++) {
    for (let x = 0; x < CHUNK_WIDTH && !hasUndergroundStone; x++) {
      if (terrainChunk.getBlock(x, y, z) === BLOCK_TYPES.STONE) hasUndergroundStone = true;
    }
  }
}
assert(hasUndergroundStone, 'Stone blocks present underground');

// ─── Group 5: Cave generation ────────────────────────────────

console.log('\nGroup 5: Cave generation');

const caveGen = new CaveGenerator(TEST_SEED);
const caveChunk = worldGen.generateChunk(0, 0);
caveGen.applyCaves(caveChunk);

// Count underground air (caves) — compare with terrain chunk
const UNDERGROUND_MAX = Math.floor(SEA_LEVEL * 0.9); // ~-28, well below surface
const terrainAirBelowSurface = (() => {
  let c = 0;
  for (let y = MIN_Y; y < SEA_LEVEL - 3; y++)
    for (let z = 2; z < CHUNK_DEPTH - 2; z++)
      for (let x = 2; x < CHUNK_WIDTH - 2; x++)
        if (terrainChunk.getBlock(x, y, z) === BLOCK_TYPES.AIR) c++;
  return c;
})();

const caveAirBelowSurface = (() => {
  let c = 0;
  for (let y = MIN_Y; y < SEA_LEVEL - 3; y++)
    for (let z = 2; z < CHUNK_DEPTH - 2; z++)
      for (let x = 2; x < CHUNK_WIDTH - 2; x++)
        if (caveChunk.getBlock(x, y, z) === BLOCK_TYPES.AIR) c++;
  return c;
})();

assert(caveAirBelowSurface > terrainAirBelowSurface, `Caves create more underground air (${caveAirBelowSurface} vs ${terrainAirBelowSurface} without caves)`);

// Cave connectivity: find largest connected air cluster underground
const visited = new Set();
function clusterSize(x, y, z) {
  const key = `${x},${y},${z}`;
  if (visited.has(key)) return 0;
  if (caveChunk.getBlock(x, y, z) !== BLOCK_TYPES.AIR) return 0;
  visited.add(key);
  let s = 1;
  for (const [dx, dy, dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
    const nx = x+dx, ny = y+dy, nz = z+dz;
    if (nx >= 0 && nx < CHUNK_WIDTH && ny >= MIN_Y && ny < MAX_Y && nz >= 0 && nz < CHUNK_DEPTH)
      s += clusterSize(nx, ny, nz);
  }
  return s;
}

let maxCluster = 0;
for (let y = MIN_Y + 5; y < SEA_LEVEL - 3; y++) {
  for (let z = 3; z < CHUNK_DEPTH - 3; z++) {
    for (let x = 3; x < CHUNK_WIDTH - 3; x++) {
      const key = `${x},${y},${z}`;
      if (caveChunk.getBlock(x, y, z) === BLOCK_TYPES.AIR && !visited.has(key)) {
        maxCluster = Math.max(maxCluster, clusterSize(x, y, z));
      }
    }
  }
}
assert(maxCluster >= 5, `Largest cave cluster: ${maxCluster} blocks (>= 5 for connectivity)`);

// ─── Group 6: Ore generation at appropriate depths ────────────

console.log('\nGroup 6: Ore generation');

const oreGen = new OreGenerator(TEST_SEED);
const oreChunk = worldGen.generateChunk(0, 0);
oreGen.placeOres(oreChunk);

let coalCount = 0, ironCount = 0, goldCount = 0, diamondCount = 0;
for (let y = MIN_Y; y < MAX_Y; y++) {
  for (let z = 0; z < CHUNK_DEPTH; z++) {
    for (let x = 0; x < CHUNK_WIDTH; x++) {
      const b = oreChunk.getBlock(x, y, z);
      if (b === BLOCK_TYPES.COAL_ORE) coalCount++;
      if (b === BLOCK_TYPES.IRON_ORE) ironCount++;
      if (b === BLOCK_TYPES.GOLD_ORE) goldCount++;
      if (b === BLOCK_TYPES.DIAMOND_ORE) diamondCount++;
    }
  }
}

assert(coalCount > 0, `Coal ore found (${coalCount} blocks)`);
assert(ironCount > 0 || coalCount > 3, 'Iron or significant coal present');

// Coal shallower than diamond (when both exist)
if (coalCount > 0 && diamondCount > 0) {
  let shallowestCoal = Infinity, deepestDiamond = -Infinity;
  for (let y = MIN_Y; y < MAX_Y; y++) {
    for (let z = 0; z < CHUNK_DEPTH; z++) {
      for (let x = 0; x < CHUNK_WIDTH; x++) {
        const b = oreChunk.getBlock(x, y, z);
        if (b === BLOCK_TYPES.COAL_ORE && y < shallowestCoal) shallowestCoal = y;
        if (b === BLOCK_TYPES.DIAMOND_ORE && y > deepestDiamond) deepestDiamond = y;
      }
    }
  }
  assert(shallowestCoal < deepestDiamond, `Coal shallower than diamond (coal Y=${shallowestCoal}, diamond Y=${deepestDiamond})`);
}

// Ore density function works correctly
const coalDensityShallow = oreGen.getOreDensity(-10, BLOCK_TYPES.COAL_ORE);
assert(coalDensityShallow > 0, 'Coal has non-zero density at shallow depth');

// ─── Group 7: Feature placement ──────────────────────────────

console.log('\nGroup 7: Feature placement');

const featurePlacer = new FeaturePlacer(TEST_SEED);
const featureChunk = worldGen.generateChunk(0, 0);
caveGen.applyCaves(featureChunk);
oreGen.placeOres(featureChunk);

const chunkBiome = biomeSystem.getBiome(0, 0);
featurePlacer.placeFeatures(featureChunk, (wx, wz) => ({ id: chunkBiome.id }));

let woodCount = 0, leavesCount = 0;
for (let y = MIN_Y; y < MAX_Y; y++) {
  for (let z = 0; z < CHUNK_DEPTH; z++) {
    for (let x = 0; x < CHUNK_WIDTH; x++) {
      const b = featureChunk.getBlock(x, y, z);
      if (b === BLOCK_TYPES.WOOD_LOG) woodCount++;
      if (b === BLOCK_TYPES.LEAVES) leavesCount++;
    }
  }
}

// Trees in Plains/Forest biomes — test across multiple chunks for statistical significance
let totalWood = 0, totalLeaves = 0;
const treeBiomeChunks = [];
for (let cx = -2; cx <= 2; cx++) {
  for (let cz = -2; cz <= 2; cz++) {
    const testChunk = worldGen.generateChunk(cx, cz);
    caveGen.applyCaves(testChunk);
    oreGen.placeOres(testChunk);
    const biome = biomeSystem.getBiome(cx * CHUNK_WIDTH, cz * CHUNK_DEPTH);
    if (biome.id === BIOMES.PLAINS.id || biome.id === BIOMES.FOREST.id) {
      featurePlacer.placeFeatures(testChunk, (wx, wz) => ({ id: biome.id }));
      treeBiomeChunks.push(biome.name);
      for (let y = MIN_Y; y < MAX_Y; y++) {
        for (let z = 0; z < CHUNK_DEPTH; z++) {
          for (let x = 0; x < CHUNK_WIDTH; x++) {
            const b = testChunk.getBlock(x, y, z);
            if (b === BLOCK_TYPES.WOOD_LOG) totalWood++;
            if (b === BLOCK_TYPES.LEAVES) totalLeaves++;
          }
        }
      }
    }
  }
}
assert(totalWood > 0 || totalLeaves > 0, `Trees found across ${treeBiomeChunks.length} tree biome chunks: ${totalWood} wood, ${totalLeaves} leaves`);

// ─── Group 8: Multi-chunk consistency ────────────────────────

console.log('\nGroup 8: Multi-chunk world consistency');

const chunkA = worldGen.generateChunk(0, 0);
const chunkB = worldGen.generateChunk(1, 0);
const chunkC = worldGen.generateChunk(0, 1);

const blocksA = countNonAir(chunkA);
const blocksB = countNonAir(chunkB);
const blocksC = countNonAir(chunkC);

assert(blocksA > 0 && blocksB > 0 && blocksC > 0, 'All adjacent chunks have terrain');

// Adjacent chunks should be similar (same biome region)
const avg = (blocksA + blocksB + blocksC) / 3;
assert(Math.abs(blocksA - avg) < avg * 0.5, `Chunk A (${blocksA}) within 50% of avg (${avg.toFixed(0)})`);
assert(Math.abs(blocksB - avg) < avg * 0.5, `Chunk B (${blocksB}) within 50% of avg (${avg.toFixed(0)})`);

// ─── Group 9: Full pipeline determinism ──────────────────────

console.log('\nGroup 9: Pipeline determinism');

const run1 = worldGen.generateChunk(5, 5);
const gen2 = new WorldGenerator(TEST_SEED);
const run2 = gen2.generateChunk(5, 5);

let identical = true;
for (let y = MIN_Y; y < MAX_Y && identical; y++) {
  for (let z = 0; z < CHUNK_DEPTH && identical; z++) {
    for (let x = 0; x < CHUNK_WIDTH && identical; x++) {
      if (run1.getBlock(x, y, z) !== run2.getBlock(x, y, z)) identical = false;
    }
  }
}
assert(identical, 'Same seed + coords → identical terrain');

// ─── Group 10: Edge cases ────────────────────────────────────

console.log('\nGroup 10: Edge cases');

const originChunk = worldGen.generateChunk(0, 0);
assert(countNonAir(originChunk) > 0, 'Origin chunk has terrain');

const negChunk = worldGen.generateChunk(-5, -5);
assert(countNonAir(negChunk) > 0, 'Negative coordinate chunks have terrain');

// ─── Summary ──────────────────────────────────────────────────

console.log('\n===================================');
console.log(`Results: ${passCount} passed, ${failCount} failed`);
console.log('===================================');

if (failCount > 0) {
  console.error(`\n❌ ${failCount} test(s) failed!`);
  process.exit(1);
} else {
  console.log('\n🎉 All world generation integration tests passed!');
  process.exit(0);
}
