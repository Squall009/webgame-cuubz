#!/usr/bin/env node
/**
 * Cuubz — World Generator Tests
 */

'use strict';

const { Chunk, BLOCK_TYPES, SEA_LEVEL } = require('../js/world/chunkData');
const WorldGenerator = require('../js/world/worldGenerator');

let passCount = 0, failCount = 0;
const failures = [];

function assert(condition, message) {
  if (condition) { passCount++; console.log(`  ✅ ${message}`); }
  else { failCount++; failures.push(message); console.log(`  ❌ ${message}`); }
}

console.log('World Generator Tests');
console.log('=====================\n');

// Basic generation
console.log('[Basic Generation]');
const gen = new WorldGenerator(12345);
assert(gen.seed === 12345, 'Seed stored correctly');

const chunk = gen.generateChunk(0, 0);
assert(chunk instanceof Chunk, 'Returns a Chunk instance');
assert(chunk.chunkX === 0, 'Chunk X coordinate correct');
assert(chunk.chunkZ === 0, 'Chunk Z coordinate correct');

// Chunk is not empty (has terrain)
const isEmpty = chunk.isEmpty();
assert(!isEmpty, 'Generated chunk has terrain (not all air)');

// Check for surface blocks
let foundSurface = false;
for (let x = 0; x < 16 && !foundSurface; x++) {
  for (let z = 0; z < 16 && !foundSurface; z++) {
    for (let y = -5; y <= 20; y++) {
      const block = chunk.getBlock(x, y, z);
      if (block === BLOCK_TYPES.GRASS || block === BLOCK_TYPES.SAND || 
          block === BLOCK_TYPES.SNOW || block === BLOCK_TYPES.STONE) {
        foundSurface = true;
        break;
      }
    }
  }
}
assert(foundSurface, 'Chunk has surface blocks');

// Bedrock at bottom
console.log('\n[Bedrock Layer]');
let bedrockFound = false;
for (let x = 0; x < 16 && !bedrockFound; x++) {
  for (let z = 0; z < 16 && !bedrockFound; z++) {
    if (chunk.getBlock(x, -32, z) === BLOCK_TYPES.BEDROCK || 
        chunk.getBlock(x, -31, z) === BLOCK_TYPES.BEDROCK) {
      bedrockFound = true;
    }
  }
}
assert(bedrockFound, 'Bedrock present at bottom');

// Water level check
console.log('\n[Water Level]');
let waterFound = false;
for (let x = 0; x < 16 && !waterFound; x++) {
  for (let z = 0; z < 16 && !waterFound; z++) {
    if (chunk.getBlock(x, 0, z) === BLOCK_TYPES.WATER || 
        chunk.getBlock(x, -1, z) === BLOCK_TYPES.WATER) {
      waterFound = true;
    }
  }
}
// Water may or may not be present depending on biome at this position
console.log(`  ℹ️ Water found: ${waterFound} (depends on biome)`);

// Deterministic generation
console.log('\n[Deterministic]');
const gen2 = new WorldGenerator(12345);
const chunk2 = gen2.generateChunk(0, 0);

let identical = true;
for (let i = 0; i < chunk.blocks.length && identical; i++) {
  if (chunk.blocks[i] !== chunk2.blocks[i]) identical = false;
}
assert(identical, 'Same seed produces identical chunks');

// Different seed → different chunk
console.log('\n[Seed Variation]');
const gen3 = new WorldGenerator(99999);
const chunk3 = gen3.generateChunk(0, 0);

let different = false;
for (let i = 0; i < chunk.blocks.length && !different; i++) {
  if (chunk.blocks[i] !== chunk3.blocks[i]) different = true;
}
assert(different, 'Different seed produces different chunks');

// World generation
console.log('\n[World Generation]');
const worldChunks = gen.generateWorld(42, 16); // 4x4 grid
assert(worldChunks.length === 16, `Generated ${worldChunks.length} chunks`);
assert(worldChunks.every(c => c instanceof Chunk), 'All are Chunk instances');

// Check chunk coordinates
assert(worldChunks[0].chunkX !== undefined, 'Chunks have coordinates');

console.log('\n=====================');
console.log(`Results: ${passCount} passed, ${failCount} failed`);
if (failCount > 0) { failures.forEach(f => console.log(`  - ${f}`)); process.exit(1); }
else { console.log('🎉 All world generator tests passing!'); process.exit(0); }
