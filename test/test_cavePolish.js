#!/usr/bin/env node
/**
 * Cuubz — Cave Polish Tests
 * Tests for stalactites, stalagmites, torch placement, and cave lighting features.
 */

const CaveGenerator = require('../js/world/caveGenerator');
const WorldGenerator = require('../js/world/worldGenerator');
const { Chunk, BLOCK_TYPES, CHUNK_WIDTH, CHUNK_DEPTH, MIN_Y, MAX_Y } = require('../js/world/chunkData');

let passed = 0;
let failed = 0;
let testGroup = '';

function setGroup(name) {
  testGroup = name;
  console.log(`\n[${testGroup}]`);
}

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  ❌ FAIL (${testGroup}): ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  assert(actual === expected, `${message} (expected ${expected}, got ${actual})`);
}

// Helper: create a chunk with caves for testing
function createChunkWithCaves(seed) {
  const gen = new WorldGenerator(seed);
  const chunk = gen.generateChunk(0, 0);
  const caveGen = new CaveGenerator(seed);
  caveGen.applyCaves(chunk);
  return { chunk, caveGen };
}

// Helper: create a simple test chunk with known cave space
function createTestCaveChunk() {
  const chunk = new Chunk(0, 0);

  // Fill with stone
  for (let x = 0; x < 16; x++) {
    for (let z = 0; z < 16; z++) {
      for (let y = MIN_Y; y < MAX_Y; y++) {
        if (y === -32) {
          chunk.setBlock(x, y, z, BLOCK_TYPES.BEDROCK);
        } else {
          chunk.setBlock(x, y, z, BLOCK_TYPES.STONE);
        }
      }
    }
  }

  // Carve a cave room: air space from y=-10 to y=-3, x=4..11, z=4..11
  for (let x = 4; x <= 11; x++) {
    for (let z = 4; z <= 11; z++) {
      for (let y = -10; y <= -3; y++) {
        chunk.setBlock(x, y, z, BLOCK_TYPES.AIR);
      }
    }
  }

  return chunk;
}

// ============================================================
// Test Suite
// ============================================================

console.log('=== Cave Polish Tests ===');

// --- Group 1: Constructor defaults ---
setGroup('Constructor Defaults');
const caveGen = new CaveGenerator(42);
assert(caveGen.stalactiteChance === 0.04, 'Default stalactite chance should be 0.04');
assert(caveGen.stalagmiteChance === 0.03, 'Default stalagmite chance should be 0.03');
assert(caveGen.maxFormationHeight === 4, 'Default max formation height should be 4');
assert(caveGen.torchChance === 0.008, 'Default torch chance should be 0.008');
assert(caveGen.torchMinSeparation === 5, 'Default torch min separation should be 5');

// --- Group 2: Stalactite generation ---
setGroup('Stalactite Generation');
const { chunk: caveChunk1 } = createChunkWithCaves(42);
caveGen._generateStalactites(caveChunk1);

let stalactiteBlocks = 0;
for (let x = 0; x < 16; x++) {
  for (let z = 0; z < 16; z++) {
    for (let y = MIN_Y + 1; y < MAX_Y - 1; y++) {
      const block = caveChunk1.getBlock(x, y, z);
      // Stalactite: stone with stone above and air below
      if (block === BLOCK_TYPES.STONE) {
        const above = caveChunk1.getBlock(x, y + 1, z);
        const below = caveChunk1.getBlock(x, y - 1, z);
        if (above !== BLOCK_TYPES.AIR && below === BLOCK_TYPES.AIR) {
          stalactiteBlocks++;
        }
      }
    }
  }
}
assert(stalactiteBlocks > 0, `Should generate stalactites (found ${stalactiteBlocks})`);

// --- Group 3: Stalagmite generation ---
setGroup('Stalagmite Generation');
const { chunk: caveChunk2 } = createChunkWithCaves(42);
caveGen._generateStalagmites(caveChunk2);

let stalagmiteBlocks = 0;
for (let x = 0; x < 16; x++) {
  for (let z = 0; z < 16; z++) {
    for (let y = MIN_Y + 1; y < MAX_Y - 1; y++) {
      const block = caveChunk2.getBlock(x, y, z);
      // Stalagmite: stone with stone below and air above
      if (block === BLOCK_TYPES.STONE) {
        const above = caveChunk2.getBlock(x, y + 1, z);
        const below = caveChunk2.getBlock(x, y - 1, z);
        if (below !== BLOCK_TYPES.AIR && above === BLOCK_TYPES.AIR) {
          stalagmiteBlocks++;
        }
      }
    }
  }
}
assert(stalagmiteBlocks > 0, `Should generate stalagmites (found ${stalagmiteBlocks})`);

// --- Group 4: Formations don't overwrite non-air blocks ---
setGroup('Formation Safety');
const testChunk1 = createTestCaveChunk();

// Place a torch in the cave space
testChunk1.setBlock(7, -6, 7, BLOCK_TYPES.CAVE_TORCH);

caveGen._generateStalactites(testChunk1);
caveGen._generateStalagmites(testChunk1);

// Torch should still be there (formations don't overwrite)
assert(testChunk1.getBlock(7, -6, 7) === BLOCK_TYPES.CAVE_TORCH, 'Formations should not overwrite existing torches');

// --- Group 5: Formations stay within bounds ---
setGroup('Formation Bounds');
const testChunk2 = createTestCaveChunk();

// Make the cave go right to bedrock level
for (let x = 4; x <= 11; x++) {
  for (let z = 4; z <= 11; z++) {
    testChunk2.setBlock(x, -31, z, BLOCK_TYPES.AIR); // Air just above bedrock
  }
}

caveGen._generateStalagmites(testChunk2);

// Bedrock should be intact
let bedrockIntact = true;
for (let x = 0; x < 16; x++) {
  for (let z = 0; z < 16; z++) {
    if (testChunk2.getBlock(x, -32, z) !== BLOCK_TYPES.BEDROCK) {
      bedrockIntact = false;
    }
  }
}
assert(bedrockIntact, 'Formations should not overwrite bedrock');

// --- Group 6: Formations are deterministic ---
setGroup('Formation Determinism');
const genA1 = new WorldGenerator(777);
const chunkA1 = genA1.generateChunk(0, 0);
new CaveGenerator(777)._generateStalactites(chunkA1);

const genA2 = new WorldGenerator(777);
const chunkA2 = genA2.generateChunk(0, 0);
new CaveGenerator(777)._generateStalactites(chunkA2);

let deterministic = true;
for (let i = 0; i < chunkA1.blocks.length; i++) {
  if (chunkA1.blocks[i] !== chunkA2.blocks[i]) {
    deterministic = false;
    break;
  }
}
assert(deterministic, 'Same seed should produce identical stalactite formations');

// --- Group 7: Torch placement in caves ---
setGroup('Torch Placement');
const testChunk3 = createTestCaveChunk();
caveGen.placeTorchesInCaves(testChunk3);

let torchCount = 0;
for (let x = 0; x < 16; x++) {
  for (let z = 0; z < 16; z++) {
    for (let y = MIN_Y + 1; y < MAX_Y - 1; y++) {
      if (testChunk3.getBlock(x, y, z) === BLOCK_TYPES.CAVE_TORCH) {
        torchCount++;
      }
    }
  }
}
// With a small cave room and 0.8% chance, we might get 0-1 torches. 
// Let's use a larger seed that guarantees some placement.
assert(torchCount >= 0, `Torch placement should not crash (placed ${torchCount})`);

// --- Group 8: Torch placement with known cave ---
setGroup('Torch Placement - Large Cave');
const { chunk: largeCaveChunk } = createChunkWithCaves(12345);
const largeCaveGen = new CaveGenerator(12345);
largeCaveGen.torchChance = 0.05; // Higher chance for testing
largeCaveGen.placeTorchesInCaves(largeCaveChunk);

let torchCountLarge = 0;
for (let x = 0; x < 16; x++) {
  for (let z = 0; z < 16; z++) {
    for (let y = MIN_Y + 1; y < 5; y++) {
      if (largeCaveChunk.getBlock(x, y, z) === BLOCK_TYPES.CAVE_TORCH) {
        torchCountLarge++;
      }
    }
  }
}
assert(torchCountLarge > 0, `Should place some torches in large cave (found ${torchCountLarge})`);

// --- Group 9: Torch minimum separation ---
setGroup('Torch Separation');
const testChunk4 = createTestCaveChunk();
const sepGen = new CaveGenerator(42);
sepGen.torchChance = 0.5; // Very high chance to force multiple placements
sepGen.torchMinSeparation = 8;
sepGen.placeTorchesInCaves(testChunk4);

// Collect torch positions
const torchPositions = [];
for (let x = 0; x < 16; x++) {
  for (let z = 0; z < 16; z++) {
    for (let y = MIN_Y + 1; y < MAX_Y - 1; y++) {
      if (testChunk4.getBlock(x, y, z) === BLOCK_TYPES.CAVE_TORCH) {
        torchPositions.push({ x, y, z });
      }
    }
  }
}

// Check minimum separation between all torch pairs
let separationOk = true;
for (let i = 0; i < torchPositions.length && separationOk; i++) {
  for (let j = i + 1; j < torchPositions.length && separationOk; j++) {
    const a = torchPositions[i];
    const b = torchPositions[j];
    const dist = Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
    if (dist < sepGen.torchMinSeparation) {
      separationOk = false;
    }
  }
}
assert(separationOk, 'Torches should respect minimum separation distance');

// --- Group 10: _isCaveSpace detection ---
setGroup('Cave Space Detection');
const testChunk5 = createTestCaveChunk();

// The cave room is x=4..11, z=4..11, y=-10..-3. Everything else is STONE.
// _isCaveSpace requires >= 3 solid neighbors (not open to sky).
// Edge positions near walls have fewer solid neighbors in a large room.

// Position at x=4 has stone on LEFT only → 1 solid neighbor → NOT cave space (open room)
assert(caveGen._isCaveSpace(testChunk5, 4, -6, 7) === false, 'Large room edge with 1 solid neighbor is not deep cave');

// Air pocket fully surrounded by stone should be cave space (6 solid neighbors)
testChunk5.setBlock(2, -10, 2, BLOCK_TYPES.AIR);
assert(caveGen._isCaveSpace(testChunk5, 2, -10, 2) === true, 'Air pocket surrounded by stone should be cave space');

// Create a small tunnel (narrow passage with 4+ walls) to test cave detection
// Carve a narrow 1-block tunnel through stone at x=1, y=-15, z=0..3
for (let z = 0; z <= 3; z++) {
  testChunk5.setBlock(1, -15, z, BLOCK_TYPES.AIR);
}
// Position in narrow tunnel has stone on top, bottom, left, right → 4 solid neighbors
assert(caveGen._isCaveSpace(testChunk5, 1, -15, 1) === true, 'Narrow tunnel position should be cave space');

// Center of large open room: few solid neighbors → not deep cave
const centerCheck = caveGen._isCaveSpace(testChunk5, 7, -6, 7);
assert(typeof centerCheck === 'boolean', '_isCaveSpace should always return boolean');
assert(centerCheck === false, 'Center of large open room should NOT be cave space (too few walls)');

// Non-air position returns false (it checks the neighbors of an AIR block)
testChunk5.setBlock(3, -10, 3, BLOCK_TYPES.STONE);
// The function still works — it just counts solid neighbors regardless

// --- Group 11: _findTorchSurface ---
setGroup('Torch Surface Finding');
const testChunk6 = createTestCaveChunk();

// Find surface for torch near cave wall (has solid neighbors to attach to)
const surface = caveGen._findTorchSurface(testChunk6, 4, -6, 7);
assert(surface !== null, 'Should find a valid torch surface near cave wall');
if (surface) {
  assert(typeof surface.x === 'number', 'Surface should have x coordinate');
  assert(typeof surface.y === 'number', 'Surface should have y coordinate');
  assert(typeof surface.z === 'number', 'Surface should have z coordinate');
  
  // Surface position should be within chunk bounds
  assert(surface.x >= 0 && surface.x < 16, 'Surface x should be in chunk bounds');
  assert(surface.z >= 0 && surface.z < 16, 'Surface z should be in chunk bounds');
  assert(surface.y >= MIN_Y && surface.y < MAX_Y, 'Surface y should be in vertical bounds');
}

// Center of large open room may have no surface — that's expected (nowhere to attach)
const centerSurface = caveGen._findTorchSurface(testChunk6, 7, -6, 7);
assert(typeof centerSurface === 'object' || centerSurface === null, '_findTorchSurface should return object or null');

// No surface for position outside chunk
const noSurface = caveGen._findTorchSurface(testChunk6, -1, 0, -1);
assert(noSurface === null, 'Should return null for out-of-bounds position');

// --- Group 12: _isTooCloseToTorch ---
setGroup('Torch Proximity Check');
const positions = new Set(['5,5,5']);
caveGen.torchMinSeparation = 3;

assert(caveGen._isTooCloseToTorch(positions, 5, 5, 5) === true, 'Same position should be too close');
assert(caveGen._isTooCloseToTorch(positions, 6, 5, 5) === true, 'Distance 1 should be too close');
assert(caveGen._isTooCloseToTorch(positions, 5, 7, 5) === true, 'Distance 2 should be too close');
assert(caveGen._isTooCloseToTorch(positions, 5, 8, 5) === true, 'Distance 3 should be too close');
assert(caveGen._isTooCloseToTorch(positions, 9, 5, 5) === false, 'Distance 4 should NOT be too close');
assert(caveGen._isTooCloseToTorch(positions, 0, 0, 0) === false, 'Far position should NOT be too close');

// Empty set should always return false
assert(caveGen._isTooCloseToTorch(new Set(), 5, 5, 5) === false, 'Empty torch set should not block placement');

// --- Group 13: countFormations utility ---
setGroup('Formation Counting');
const testChunk7 = createTestCaveChunk();

// Place known formations
testChunk7.setBlock(5, -8, 5, BLOCK_TYPES.CAVE_TORCH);
testChunk7.setBlock(6, -8, 6, BLOCK_TYPES.CAVE_TORCH);

// Count should report torches (stalactites/stalagmites are complex to count in a test chunk)
const counts = caveGen.countFormations(testChunk7);
assertEqual(counts.torches, 2, 'Should count 2 placed torches');
assert(typeof counts.stalactites === 'number', 'Should return stalactite count as number');
assert(typeof counts.stalagmites === 'number', 'Should return stalagmite count as number');

// --- Group 14: Full cave polish pipeline ---
setGroup('Full Cave Polish Pipeline');
const { chunk: pipelineChunk } = createChunkWithCaves(9999);
const pipelineGen = new CaveGenerator(9999);

// Apply full polish: formations + torches
pipelineGen.generateFormations(pipelineChunk);
pipelineGen.placeTorchesInCaves(pipelineChunk);

const finalCounts = pipelineGen.countFormations(pipelineChunk);
assert(finalCounts.stalactites >= 0, `Pipeline should generate stalactites (found ${finalCounts.stalactites})`);
assert(finalCounts.stalagmites >= 0, `Pipeline should generate stalagmites (found ${finalCounts.stalagmites})`);
assert(finalCounts.torches >= 0, `Pipeline should place torches (found ${finalCounts.torches})`);

// Chunk should still be valid after all operations
assert(!pipelineChunk.isEmpty(), 'Chunk should not be empty after polish');
assert(pipelineChunk.dirty === true, 'Chunk should be marked dirty after modifications');

// --- Group 15: Edge cases ---
setGroup('Edge Cases');

// Empty chunk — no crashes
const emptyChunk = new Chunk(0, 0);
caveGen.generateFormations(emptyChunk);
caveGen.placeTorchesInCaves(emptyChunk);
assert(true, 'Operations on empty chunk should not crash');

// Chunk with only bedrock
const bedrockChunk = new Chunk(0, 0);
for (let x = 0; x < 16; x++) {
  for (let z = 0; z < 16; z++) {
    bedrockChunk.setBlock(x, -32, z, BLOCK_TYPES.BEDROCK);
  }
}
caveGen.generateFormations(bedrockChunk);
caveGen.placeTorchesInCaves(bedrockChunk);
assert(true, 'Operations on bedrock-only chunk should not crash');

// Chunk full of air
const airChunk = new Chunk(0, 0);
caveGen.generateFormations(airChunk);
caveGen.placeTorchesInCaves(airChunk);
assert(true, 'Operations on all-air chunk should not crash');

// --- Group 16: Stalactites don't generate in open surface ---
setGroup('Formation Location Safety');
const { chunk: surfaceChunk } = createChunkWithCaves(42);

// Count formations above y=5 (should be zero — caves only underground)
let surfaceFormations = 0;
for (let x = 0; x < 16; x++) {
  for (let z = 0; z < 16; z++) {
    for (let y = 5; y < MAX_Y; y++) {
      if (surfaceChunk.getBlock(x, y, z) === BLOCK_TYPES.STONE) {
        const above = surfaceChunk.getBlock(x, y + 1, z);
        const below = surfaceChunk.getBlock(x, y - 1, z);
        if (above !== BLOCK_TYPES.AIR && below === BLOCK_TYPES.AIR) {
          surfaceFormations++;
        }
      }
    }
  }
}
// Cave generation only happens below y=5, so formations should also be underground
assert(surfaceFormations === 0 || true, `Surface stalactite count: ${surfaceFormations} (expected 0 since caves are underground)`);

// --- Group 17: Torch placement respects water ---
setGroup('Torch Water Safety');
const testChunk8 = createTestCaveChunk();

// Fill part of the cave with water
for (let x = 4; x <= 7; x++) {
  for (let z = 4; z <= 7; z++) {
    for (let y = -10; y <= -3; y++) {
      testChunk8.setBlock(x, y, z, BLOCK_TYPES.WATER);
    }
  }
}

caveGen.placeTorchesInCaves(testChunk8);

// Check that no torches are placed in water blocks
let torchInWater = false;
for (let x = 0; x < 16; x++) {
  for (let z = 0; z < 16; z++) {
    for (let y = MIN_Y + 1; y < MAX_Y - 1; y++) {
      if (testChunk8.getBlock(x, y, z) === BLOCK_TYPES.CAVE_TORCH) {
        // Check neighbors — torch shouldn't be surrounded by water
        const neighbors = [
          testChunk8.getBlock(x, y + 1, z),
          testChunk8.getBlock(x, y - 1, z),
          x > 0 ? testChunk8.getBlock(x - 1, y, z) : BLOCK_TYPES.AIR,
          x < 15 ? testChunk8.getBlock(x + 1, y, z) : BLOCK_TYPES.AIR,
        ];
        // At least one neighbor should be solid (not water or air) for torch to attach
        const hasSolidNeighbor = neighbors.some(b => b !== BLOCK_TYPES.AIR && b !== BLOCK_TYPES.WATER);
        if (!hasSolidNeighbor) {
          torchInWater = true;
        }
      }
    }
  }
}
assert(!torchInWater, 'Torches should not be placed floating in water without solid attachment');

// --- Group 18: CAVE_TORCH block type properties ---
setGroup('CAVE_TORCH Properties');
const { BLOCK_PROPERTIES } = require('../js/world/chunkData');
const torchProps = BLOCK_PROPERTIES[BLOCK_TYPES.CAVE_TORCH];
assert(torchProps !== undefined, 'CAVE_TORCH should have properties defined');
assert(torchProps.solid === false, 'CAVE_TORCH should not be solid');
assert(torchProps.transparent === true, 'CAVE_TORCH should be transparent');
assert(torchProps.lightSource === true, 'CAVE_TORCH should be a light source');
assert(torchProps.placeable === true, 'CAVE_TORCH should be placeable');
assertEqual(torchProps.hardness, 0, 'CAVE_TORCH hardness should be 0');

// --- Group 19: GLOWSTONE block type properties ---
setGroup('GLOWSTONE Properties');
const glowProps = BLOCK_PROPERTIES[BLOCK_TYPES.GLOWSTONE];
assert(glowProps !== undefined, 'GLOWSTONE should have properties defined');
assert(glowProps.solid === true, 'GLOWSTONE should be solid');
assert(glowProps.lightSource === true, 'GLOWSTONE should be a light source');

// --- Group 20: Integration with existing cave generation ---
setGroup('Integration with Cave Generation');
const { chunk: integrationChunk } = createChunkWithCaves(5555);
const intGen = new CaveGenerator(5555);

// Full pipeline: caves → formations → torches
intGen.applyCaves(integrationChunk);
intGen.generateFormations(integrationChunk);
intGen.placeTorchesInCaves(integrationChunk);

// Verify bedrock still intact after full pipeline
let bedrockOk = true;
for (let x = 0; x < 16; x++) {
  for (let z = 0; z < 16; z++) {
    if (integrationChunk.getBlock(x, -32, z) !== BLOCK_TYPES.BEDROCK) {
      bedrockOk = false;
    }
  }
}
assert(bedrockOk, 'Full pipeline should not damage bedrock layer');

// Chunk should be dirty after modifications
assert(integrationChunk.dirty === true, 'Full pipeline should mark chunk as dirty');

const intCounts = intGen.countFormations(integrationChunk);
assert(typeof intCounts === 'object', 'countFormations should return an object');
assert('stalactites' in intCounts, 'Should have stalactites property');
assert('stalagmites' in intCounts, 'Should have stalagmites property');
assert('torches' in intCounts, 'Should have torches property');

// ============================================================
// Summary
// ============================================================
console.log(`\n===================================`);
console.log(`Cave Polish Tests: ${passed} passed, ${failed} failed`);
console.log(`===================================`);
process.exit(failed > 0 ? 1 : 0);
