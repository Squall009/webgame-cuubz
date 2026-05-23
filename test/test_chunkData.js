#!/usr/bin/env node
/**
 * Cuubz — Chunk Data Structure Tests
 * Tests Chunk class, block access, serialization, edge data.
 */

'use strict';

const { Chunk, BLOCK_TYPES, BLOCK_PROPERTIES, CHUNK_WIDTH, CHUNK_DEPTH, CHUNK_HEIGHT, SEA_LEVEL, MIN_Y, MAX_Y } = require('../js/world/chunkData');

// ============================================================
// Test Framework (embedded)
// ============================================================

let passCount = 0;
let failCount = 0;
const failures = [];

function assert(condition, message) {
  if (condition) {
    passCount++;
    console.log(`  ✅ ${message}`);
  } else {
    failCount++;
    failures.push(message);
    console.log(`  ❌ ${message}`);
  }
}

function assertEquals(actual, expected, message) {
  assert(actual === expected, `${message}: expected ${expected}, got ${actual}`);
}

function assertNotNull(value, message) {
  assert(value !== null && value !== undefined, message);
}

function assertTrue(value, message) {
  assert(!!value, message);
}

// ============================================================
// Tests
// ============================================================

console.log('Chunk Data Structure Tests');
console.log('==========================\n');

// --- Test: Constants ---
console.log('[Constants]');

assertEquals(CHUNK_WIDTH, 16, 'Chunk width is 16');
assertEquals(CHUNK_DEPTH, 16, 'Chunk depth is 16');
assertEquals(CHUNK_HEIGHT, 96, 'Chunk height is 96');
assertEquals(SEA_LEVEL, 0, 'Sea level is 0');
assertEquals(MIN_Y, -32, 'Min Y is -32');
assertEquals(MAX_Y, 64, 'Max Y is 64');

// --- Test: Block Types ---
console.log('\n[Block Types]');

assertEquals(BLOCK_TYPES.AIR, 0, 'AIR = 0');
assertEquals(BLOCK_TYPES.GRASS, 1, 'GRASS = 1');
assertEquals(BLOCK_TYPES.DIRT, 2, 'DIRT = 2');
assertEquals(BLOCK_TYPES.STONE, 3, 'STONE = 3');
assertEquals(BLOCK_TYPES.BEDROCK, 11, 'BEDROCK = 11');
assertEquals(BLOCK_TYPES.WATER, 6, 'WATER = 6');

// Block properties exist
assertNotNull(BLOCK_PROPERTIES[BLOCK_TYPES.AIR], 'AIR has properties');
assertNotNull(BLOCK_PROPERTIES[BLOCK_TYPES.GRASS], 'GRASS has properties');
assertNotNull(BLOCK_PROPERTIES[BLOCK_TYPES.STONE], 'STONE has properties');

// --- Test: Chunk Construction ---
console.log('\n[Chunk Construction]');

const chunk = new Chunk(3, 7);
assertEquals(chunk.chunkX, 3, 'Chunk X coordinate stored');
assertEquals(chunk.chunkZ, 7, 'Chunk Z coordinate stored');
assertEquals(chunk.worldX, 48, 'World X = chunkX * 16');
assertEquals(chunk.worldZ, 112, 'World Z = chunkZ * 16');
assert(!chunk.dirty, 'New chunk is not dirty');
assertTrue(chunk.isEmpty(), 'New chunk is empty (all air)');

// --- Test: Block Get/Set ---
console.log('\n[Block Get/Set]');

const testChunk = new Chunk(0, 0);

assertEquals(testChunk.getBlock(8, 10, 8), BLOCK_TYPES.AIR, 'Default block is AIR');

testChunk.setBlock(5, 0, 5, BLOCK_TYPES.GRASS);
assertEquals(testChunk.getBlock(5, 0, 5), BLOCK_TYPES.GRASS, 'Set and get GRASS block');

testChunk.setBlock(5, 1, 5, BLOCK_TYPES.STONE);
assertEquals(testChunk.getBlock(5, 1, 5), BLOCK_TYPES.STONE, 'Set STONE above GRASS');
assertEquals(testChunk.getBlock(5, 0, 5), BLOCK_TYPES.GRASS, 'Adjacent block unchanged');

// Dirty flag
assert(testChunk.dirty, 'Setting a block marks chunk dirty');

// --- Test: Out of Bounds ---
console.log('\n[Out of Bounds]');

assertEquals(testChunk.getBlock(-1, 0, 0), BLOCK_TYPES.AIR, 'Negative X returns AIR');
assertEquals(testChunk.getBlock(16, 0, 0), BLOCK_TYPES.AIR, 'X >= width returns AIR');
assertEquals(testChunk.getBlock(0, -33, 0), BLOCK_TYPES.AIR, 'Below MIN_Y returns AIR');
assertEquals(testChunk.getBlock(0, 65, 0), BLOCK_TYPES.AIR, 'Above MAX_Y returns AIR');

// --- Test: World Coordinate Access ---
console.log('\n[World Coordinates]');

const wChunk = new Chunk(1, 1);
wChunk.setBlock(0, 0, 0, BLOCK_TYPES.DIRT); // Local (0,0,0) → world (16, 0, 16)

assertEquals(wChunk.getBlockAtWorld(16, 0, 16), BLOCK_TYPES.DIRT, 'World coordinates map correctly');
assertEquals(wChunk.getBlockAtWorld(32, 0, 0), null, 'Outside chunk returns null (cx=2)');
assertEquals(wChunk.getBlockAtWorld(0, 0, 0), null, 'Outside chunk returns null (cx=0)');

// --- Test: Serialization ---
console.log('\n[Serialization]');

const serChunk = new Chunk(5, 10);
serChunk.setBlock(3, 10, 4, BLOCK_TYPES.STONE);
serChunk.setBlock(7, -5, 8, BLOCK_TYPES.COAL_ORE);
serChunk.setBlock(12, 0, 12, BLOCK_TYPES.DIRT);

const serialized = serChunk.serialize();
assertEquals(serialized.chunkX, 5, 'Serialized chunkX preserved');
assertEquals(serialized.chunkZ, 10, 'Serialized chunkZ preserved');
assert(Array.isArray(serialized.indices), 'Indices is an array');
assert(Array.isArray(serialized.types), 'Types is an array');
assert(serialized.indices.length > 0, 'Indices contains entries');
assertEquals(serialized.indices.length, serialized.types.length, 'indices and types have same length');

// --- Test: Deserialization ---
console.log('\n[Deserialization]');

const deserialized = Chunk.deserialize(serialized);
assertEquals(deserialized.chunkX, 5, 'Deserialized chunkX matches');
assertEquals(deserialized.chunkZ, 10, 'Deserialized chunkZ matches');
assertEquals(deserialized.getBlock(3, 10, 4), BLOCK_TYPES.STONE, 'STONE block restored');
assertEquals(deserialized.getBlock(7, -5, 8), BLOCK_TYPES.COAL_ORE, 'Coal ore restored');
assertEquals(deserialized.getBlock(12, 0, 12), BLOCK_TYPES.DIRT, 'Dirt block restored');

// Check that air blocks are still air
assertEquals(deserialized.getBlock(0, 0, 0), BLOCK_TYPES.AIR, 'Unset blocks are AIR after deserialization');

// --- Test: Edge Data ---
console.log('\n[Edge Data]');

const edgeChunk = new Chunk(0, 0);
edgeChunk.setBlock(15, 0, 7, BLOCK_TYPES.GRASS); // Positive Z edge
edgeChunk.setBlock(0, 5, 0, BLOCK_TYPES.DIRT);   // Negative Z edge

const posZEdge = edgeChunk.getEdgeData('positiveZ');
assert(posZEdge.length === CHUNK_HEIGHT * CHUNK_WIDTH, 'Edge data has correct length');

// --- Test: Mark Clean ---
console.log('\n[Dirty Flag]');

serChunk.markClean();
assert(!serChunk.dirty, 'markClean() clears dirty flag');

serChunk.setBlock(1, 1, 1, BLOCK_TYPES.IRON_ORE);
assert(serChunk.dirty, 'Setting block after clean marks dirty again');

// --- Test: Multiple Chunks Independent ---
console.log('\n[Independence]');

const chunkA = new Chunk(0, 0);
const chunkB = new Chunk(1, 0);

chunkA.setBlock(0, 0, 0, BLOCK_TYPES.GRASS);
assertEquals(chunkB.getBlock(0, 0, 0), BLOCK_TYPES.AIR, 'Chunks are independent');

// ============================================================
// Report
// ============================================================

console.log('\n==========================');
console.log(`Results: ${passCount} passed, ${failCount} failed`);

if (failCount > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
} else {
  console.log('🎉 All chunk data tests passing!');
  process.exit(0);
}
