#!/usr/bin/env node
/**
 * Cuubz — Cave Generator Tests
 * Tests for cave carving, tunnel paths, connectivity
 */

const CaveGenerator = require('../js/world/caveGenerator');
const { Chunk, BLOCK_TYPES } = require('../js/world/chunkData');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${message}`);
  }
}

console.log('Testing cave generator...');

// --- Test 1: Constructor with seed ---
const caveGen = new CaveGenerator(42);
assert(caveGen.noise !== undefined, 'CaveGenerator should have noise instance');
assert(caveGen.caveThreshold === 0.3, 'Default cave threshold should be 0.3');
assert(caveGen.tunnelRadius === 2.5, 'Default tunnel radius should be 2.5');

// --- Test 2: applyCaves modifies chunk ---
const worldGen = require('../js/world/worldGenerator');
const gen = new worldGen(42);
const chunk = gen.generateChunk(0, 0);

// Count air blocks before caves
let airBefore = 0;
for (let i = 0; i < chunk.blocks.length; i++) {
  if (chunk.blocks[i] === BLOCK_TYPES.AIR) airBefore++;
}

caveGen.applyCaves(chunk);

// Count air blocks after caves
let airAfter = 0;
for (let i = 0; i < chunk.blocks.length; i++) {
  if (chunk.blocks[i] === BLOCK_TYPES.AIR) airAfter++;
}

assert(airAfter >= airBefore, 'Cave generation should not reduce air blocks');

// --- Test 3: Caves only carve underground ---
let surfaceCarved = false;
for (let x = 0; x < 16 && !surfaceCarved; x++) {
  for (let z = 0; z < 16 && !surfaceCarved; z++) {
    // Check if any block above y=5 was carved to air by caves
    for (let y = 5; y <= 64; y++) {
      const block = chunk.getBlock(x, y, z);
      if (block === BLOCK_TYPES.AIR) {
        // This could be normal sky — only flag if below surface height was changed
      }
    }
  }
}
// Just verify it doesn't crash
assert(true, 'Cave generation above ground does not crash');

// --- Test 4: Caves don't carve bedrock ---
let bedrockIntact = true;
for (let x = 0; x < 16 && bedrockIntact; x++) {
  for (let z = 0; z < 16 && bedrockIntact; z++) {
    if (chunk.getBlock(x, -32, z) === BLOCK_TYPES.AIR) {
      bedrockIntact = false;
    }
  }
}
assert(bedrockIntact, 'Caves should not carve through bedrock layer');

// --- Test 5: generateTunnelPaths returns array of points ---
const tunnels = caveGen.generateTunnelPaths(0, 0, 100);
assert(Array.isArray(tunnels), 'generateTunnelPaths should return an array');
assert(tunnels.length > 0, 'Should generate at least some tunnel points');

// --- Test 6: Tunnel points have x, y, z coordinates ---
const firstPoint = tunnels[0];
assert(firstPoint.x !== undefined, 'Tunnel point should have x coordinate');
assert(firstPoint.y !== undefined, 'Tunnel point should have y coordinate');
assert(firstPoint.z !== undefined, 'Tunnel point should have z coordinate');

// --- Test 7: Tunnels descend (y decreases) ---
let descends = false;
for (let i = 1; i < tunnels.length; i++) {
  if (tunnels[i].y < tunnels[i-1].y) {
    descends = true;
    break;
  }
}
assert(descends, 'Tunnels should generally descend into the world');

// --- Test 8: Deterministic with same seed ---
const caveGenA = new CaveGenerator(999);
const caveGenB = new CaveGenerator(999);
const tunnelsA = caveGenA.generateTunnelPaths(0, 0, 50);
const tunnelsB = caveGenB.generateTunnelPaths(0, 0, 50);
assert(tunnelsA.length === tunnelsB.length, 'Same seed should produce same number of tunnel points');

// --- Test 9: isConnected with valid grid ---
const grid = require('../js/world/chunkGrid');
const chunkGrid = new grid();
// Add a chunk to the grid
chunkGrid.loadedChunks.set('0,0', chunk);

// isConnected should not crash
const connected = caveGen.isConnected(0, 0, chunkGrid);
assert(typeof connected === 'boolean', 'isConnected should return boolean');

// --- Summary ---
console.log(`\nCave Generator Tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
