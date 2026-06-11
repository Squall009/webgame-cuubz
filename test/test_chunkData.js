#!/usr/bin/env node
/**
 * Cuubz — Chunk Data Tests (Post-Overhaul)
 * Tests simplified Chunk class: no water levels, no neighbors, dirty/changed flags.
 */
'use strict';

const path = require('path');
require(path.resolve(__dirname, '..', 'js', 'util', 'logger'));
const { Chunk, BLOCK_TYPES, CHUNK_WIDTH, CHUNK_DEPTH, CHUNK_HEIGHT } = require(path.resolve(__dirname, '..', 'js', 'world', 'chunkData'));

let passCount = 0;
let failCount = 0;
const failures = [];

function assert(condition, message) {
  if (condition) {
    passCount++;
  } else {
    failCount++;
    failures.push(message);
    console.log(`FAIL: ${message}`);
  }
}

// ─── Tests ──────────────────────────────────────────────────────

console.log('\n=== Chunk (simplified) ===\n');

// Test 1: Creates chunk with correct dimensions
{
  const chunk = new Chunk(10, -5);
  assert(chunk.cx === 10, 'Chunk cx should be 10');
  assert(chunk.cz === -5, 'Chunk cz should be -5');
  assert(chunk.blocks.length === CHUNK_WIDTH * CHUNK_DEPTH * CHUNK_HEIGHT, 'Blocks array length should be 65536');
  assert(chunk.dirty === false, 'New chunk dirty should be false');
  assert(chunk.changed === false, 'New chunk changed should be false');
  assert(typeof chunk.waterLevels === 'undefined', 'Chunk should not have waterLevels');
  assert(typeof chunk.neighbors === 'undefined', 'Chunk should not have neighbors');
}

// Test 2: getBlock returns AIR for out-of-bounds Y
{
  const chunk = new Chunk(0, 0);
  assert(chunk.getBlock(8, -1, 8) === BLOCK_TYPES.AIR, 'getBlock(-1 Y) should return AIR');
  assert(chunk.getBlock(8, CHUNK_HEIGHT, 8) === BLOCK_TYPES.AIR, 'getBlock(MAX_Y) should return AIR');
}

// Test 3: getBlock returns -1 for out-of-bounds X/Z (neighbor signal)
{
  const chunk = new Chunk(0, 0);
  assert(chunk.getBlock(-1, 64, 8) === -1, 'getBlock(-1 X) should return -1');
  assert(chunk.getBlock(CHUNK_WIDTH, 64, 8) === -1, 'getBlock(MAX_X) should return -1');
  assert(chunk.getBlock(8, 64, -1) === -1, 'getBlock(-1 Z) should return -1');
  assert(chunk.getBlock(8, 64, CHUNK_DEPTH) === -1, 'getBlock(MAX_Z) should return -1');
}

// Test 4: setBlock updates block and sets dirty+changed flags
{
  const chunk = new Chunk(0, 0);
  assert(chunk.dirty === false, 'Initial dirty should be false');
  assert(chunk.changed === false, 'Initial changed should be false');
  const result = chunk.setBlock(8, 64, 8, BLOCK_TYPES.GRASS);
  assert(result === true, 'setBlock should return true for actual change');
  assert(chunk.getBlock(8, 64, 8) === BLOCK_TYPES.GRASS, 'Block should be GRASS after setBlock');
  assert(chunk.dirty === true, 'dirty should be true after setBlock');
  assert(chunk.changed === true, 'changed should be true after setBlock');
}

// Test 5: setBlock returns false when setting same value
{
  const chunk = new Chunk(0, 0);
  chunk.setBlock(8, 64, 8, BLOCK_TYPES.GRASS);
  const result = chunk.setBlock(8, 64, 8, BLOCK_TYPES.GRASS); // same value
  assert(result === false, 'setBlock should return false for no-change');
}

// Test 6: setBlock is no-op for out-of-bounds
{
  const chunk = new Chunk(0, 0);
  chunk.setBlock(-1, 64, 8, BLOCK_TYPES.STONE); // out of bounds
  assert(chunk.dirty === false, 'setBlock OOB should not set dirty');
}

// Test 7: serialize/deserialize roundtrip
{
  const chunk = new Chunk(5, -3);
  chunk.setBlock(0, 0, 0, BLOCK_TYPES.BEDROCK);
  chunk.setBlock(15, 255, 15, BLOCK_TYPES.STONE);

  const data = chunk.serialize();
  assert(data.cx === 5, 'serialize cx should be 5');
  assert(data.cz === -3, 'serialize cz should be -3');
  assert(Array.isArray(data.indices), 'serialize indices should be array');
  assert(typeof data.waterLevelIndices === 'undefined', 'serialize should not have waterLevelIndices');

  const restored = Chunk.deserialize(data);
  assert(restored.cx === 5, 'deserialize cx should be 5');
  assert(restored.cz === -3, 'deserialize cz should be -3');
  assert(restored.getBlock(0, 0, 0) === BLOCK_TYPES.BEDROCK, 'deserialize block at (0,0,0) should be BEDROCK');
  assert(restored.getBlock(15, 255, 15) === BLOCK_TYPES.STONE, 'deserialize block at (15,255,15) should be STONE');
}

// Test 8: deserialize handles legacy chunkX/chunkZ keys
{
  const data = { chunkX: 7, chunkZ: -2, indices: [0], types: [BLOCK_TYPES.DIRT], dirty: false };
  const chunk = Chunk.deserialize(data);
  assert(chunk.cx === 7, 'deserialize legacy chunkX should map to cx');
  assert(chunk.cz === -2, 'deserialize legacy chunkZ should map to cz');
}

// ─── Results ────────────────────────────────────────────────────
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passCount} passed, ${failCount} failed`);
if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
} else {
  console.log('All tests passed!\n');
}
