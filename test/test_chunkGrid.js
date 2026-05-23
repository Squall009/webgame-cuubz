#!/usr/bin/env node
/**
 * Cuubz — Chunk Grid System Tests
 * Tests for coordinate conversion, chunk loading/unloading, neighbor management
 */

const ChunkGrid = require('../js/world/chunkGrid');
const { Chunk, CHUNK_WIDTH, CHUNK_DEPTH } = require('../js/world/chunkData');

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

console.log('Testing chunk grid system...');

// --- Test 1: worldToChunk conversion ---
const { cx, cz } = ChunkGrid.worldToChunk(80, -48);
assert(cx === 5, `World X=80 → chunk X should be 5, got ${cx}`);
assert(cz === -3, `World Z=-48 → chunk Z should be -3, got ${cz}`);

// --- Test 2: worldToChunk with negative coords ---
const neg = ChunkGrid.worldToChunk(-16, -16);
assert(neg.cx === -1, `World X=-16 → chunk X should be -1, got ${neg.cx}`);
assert(neg.cz === -1, `World Z=-16 → chunk Z should be -1, got ${neg.cz}`);

// --- Test 3: worldToChunk with coords inside chunk 0 ---
const zero = ChunkGrid.worldToChunk(7, 7);
assert(zero.cx === 0, `World X=7 → chunk X should be 0, got ${zero.cx}`);
assert(zero.cz === 0, `World Z=7 → chunk Z should be 0, got ${zero.cz}`);

// --- Test 4: chunkKey format ---
const key = ChunkGrid.chunkKey(3, -2);
assert(key === '3,-2', `chunkKey(3,-2) should be "3,-2", got "${key}"`);

// --- Test 5: Empty grid has no chunks ---
const grid = new ChunkGrid();
assert(grid.getChunkCount() === 0, 'New grid should have 0 chunks');

// --- Test 6: getChunk creates and stores chunk ---
let createdChunk = null;
grid.getChunk(0, 0, (cx, cz) => {
  createdChunk = new Chunk(cx, cz);
  return createdChunk;
});
assert(grid.getChunkCount() === 1, 'Grid should have 1 chunk after getChunk');

// --- Test 7: getChunk returns existing chunk (no duplicate) ---
const sameChunk = grid.getChunk(0, 0, () => new Chunk(99, 99)); // generator should NOT be called
assert(sameChunk === createdChunk, 'getChunk should return cached chunk');

// --- Test 8: Adding player positions ---
grid.addPlayerPosition(100, 200);
assert(grid.playerPositions.length === 1, 'Should have 1 player position');
assert(grid.playerPositions[0].x === 100, 'Player X should be 100');
assert(grid.playerPositions[0].z === 200, 'Player Z should be 200');

// --- Test 9: Remove player position ---
grid.removePlayerPosition(0);
assert(grid.playerPositions.length === 0, 'Should have 0 player positions after removal');

// --- Test 10: updateChunks with no players returns empty ---
const newChunks = grid.updateChunks(() => new Chunk(0, 0));
assert(newChunks.length === 0, 'updateChunks with no players should return empty array');

// --- Test 11: updateChunks loads chunks around player ---
const grid2 = new ChunkGrid();
grid2.loadRadius = 1; // Small radius for testing
grid2.addPlayerPosition(0, 0);

let chunkCount = 0;
const loaded = grid2.updateChunks((cx, cz) => {
  chunkCount++;
  return new Chunk(cx, cz);
});
assert(chunkCount > 0, 'Should load chunks around player');
assert(loaded.length === chunkCount, 'Returned array should match loaded count');

// --- Test 12: Neighbor references are set ---
const grid3 = new ChunkGrid();
grid3.loadRadius = 2;
grid3.addPlayerPosition(0, 0);

grid3.updateChunks((cx, cz) => new Chunk(cx, cz));

// Center chunk should have neighbors
const centerChunk = grid3.getChunk(0, 0);
assert(centerChunk !== null, 'Center chunk (0,0) should exist');
if (centerChunk) {
  const hasNeighbor = Object.values(centerChunk.neighbors).some(n => n !== null);
  assert(hasNeighbor, 'Center chunk should have at least one neighbor set');
}

// --- Test 13: getDirtyChunks returns dirty chunks ---
const grid4 = new ChunkGrid();
const cleanChunk = new Chunk(0, 0);
const dirtyChunk = new Chunk(1, 0);
dirtyChunk.setBlock(8, 0, 8, 1); // Set a block to make it dirty

grid4.loadedChunks.set('0,0', cleanChunk);
grid4.loadedChunks.set('1,0', dirtyChunk);

const dirtyList = grid4.getDirtyChunks();
assert(dirtyList.length === 1, 'Should find exactly 1 dirty chunk');
assert(dirtyList[0].chunkX === 1, 'Dirty chunk should be chunk (1,0)');

// --- Test 14: Multiple players tracked ---
const grid5 = new ChunkGrid();
grid5.addPlayerPosition(100, 100);
grid5.addPlayerPosition(200, 200);
assert(grid5.playerPositions.length === 2, 'Should track 2 player positions');

// --- Test 15: Load radius is configurable ---
const grid6 = new ChunkGrid();
assert(grid6.loadRadius === 6, 'Default load radius should be 6');
grid6.loadRadius = 3;
assert(grid6.loadRadius === 3, 'Load radius should be configurable');

// --- Summary ---
console.log(`\nChunk Grid Tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
