#!/usr/bin/env node
/**
 * Cuubz — Binary Codec Tests (Post-Overhaul)
 * Tests ChunkBinaryCodec encode/decode roundtrip, checksum verification.
 */
'use strict';

const path = require('path');
require(path.resolve(__dirname, '..', 'js', 'util', 'logger'));
const { Chunk, BLOCK_TYPES } = require(path.resolve(__dirname, '..', 'js', 'world', 'chunkData'));
const ChunkBinaryCodec = require(path.resolve(__dirname, '..', 'js', 'world', 'chunkBinaryCodec'));

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

console.log('\n=== ChunkBinaryCodec (simplified) ===\n');

// Test 1: Encodes and decodes empty chunk correctly
{
  const chunk = new Chunk(0, 0);
  const encoded = ChunkBinaryCodec.encode(chunk);
  assert(encoded instanceof ArrayBuffer, 'encode should return ArrayBuffer');
  assert(encoded.byteLength > 20, `encode size ${encoded.byteLength} should be > header (20 bytes)`);

  const decoded = ChunkBinaryCodec.decode(encoded);
  assert(decoded.cx === 0, 'decode cx should be 0');
  assert(decoded.cz === 0, 'decode cz should be 0');
  let allAir = true;
  for (let i = 0; i < decoded.blocks.length && allAir; i++) {
    if (decoded.blocks[i] !== BLOCK_TYPES.AIR) allAir = false;
  }
  assert(allAir, 'Empty chunk should decode as all AIR');
}

// Test 2: Encodes and decodes chunk with blocks correctly
{
  const chunk = new Chunk(5, -3);
  for (let x = 0; x < 16; x++) {
    for (let z = 0; z < 16; z++) {
      chunk.setBlock(x, 0, z, BLOCK_TYPES.BEDROCK);
      chunk.setBlock(x, 1, z, BLOCK_TYPES.STONE);
      chunk.setBlock(x, 2, z, BLOCK_TYPES.DIRT);
    }
  }

  const encoded = ChunkBinaryCodec.encode(chunk);
  const decoded = ChunkBinaryCodec.decode(encoded);

  assert(decoded.cx === 5, 'decode cx should be 5');
  assert(decoded.cz === -3, 'decode cz should be -3');

  let bedrockOk = true, stoneOk = true, dirtOk = true;
  for (let x = 0; x < 16 && (bedrockOk || stoneOk || dirtOk); x++) {
    for (let z = 0; z < 16; z++) {
      if (decoded.getBlock(x, 0, z) !== BLOCK_TYPES.BEDROCK) bedrockOk = false;
      if (decoded.getBlock(x, 1, z) !== BLOCK_TYPES.STONE) stoneOk = false;
      if (decoded.getBlock(x, 2, z) !== BLOCK_TYPES.DIRT) dirtOk = false;
    }
  }
  assert(bedrockOk, 'All bedrock blocks should decode correctly');
  assert(stoneOk, 'All stone blocks should decode correctly');
  assert(dirtOk, 'All dirt blocks should decode correctly');

  assert(typeof decoded.waterLevels === 'undefined', 'Decoded chunk should not have waterLevels');
}

// Test 3: Preserves dirty flag through encode/decode
{
  const chunk = new Chunk(0, 0);
  chunk.setBlock(8, 64, 8, BLOCK_TYPES.GRASS); // sets dirty=true
  assert(chunk.dirty === true, 'dirty should be true after setBlock');

  const encoded = ChunkBinaryCodec.encode(chunk);
  const decoded = ChunkBinaryCodec.decode(encoded);
  assert(decoded.dirty === true, 'dirty flag should survive encode/decode roundtrip');
}

// Test 4: Throws on corrupted data (checksum mismatch)
{
  const chunk = new Chunk(0, 0);
  chunk.setBlock(8, 64, 8, BLOCK_TYPES.STONE);
  const encoded = ChunkBinaryCodec.encode(chunk);

  // Corrupt a byte in the data portion (after header)
  const view = new DataView(encoded);
  view.setUint16(20, view.getUint16(20) ^ 0xFFFF, true);

  let threw = false;
  try { ChunkBinaryCodec.decode(encoded); } catch(e) { threw = true; }
  assert(threw, 'decode should throw on corrupted data');
}

// Test 5: Throws on bad magic number
{
  const chunk = new Chunk(0, 0);
  const encoded = ChunkBinaryCodec.encode(chunk);
  const view = new DataView(encoded);
  view.setUint32(0, 0xDEADBEEF, true); // corrupt magic

  let threw = false;
  try { ChunkBinaryCodec.decode(encoded); } catch(e) { threw = true; }
  assert(threw, 'decode should throw on bad magic number');
}

// Test 6: computeChecksum produces consistent results
{
  const data1 = new Uint8Array([1, 2, 3, 4, 5]);
  const data2 = new Uint8Array([1, 2, 3, 4, 5]);
  const data3 = new Uint8Array([1, 2, 3, 4, 6]);

  assert(ChunkBinaryCodec.computeChecksum(data1) === ChunkBinaryCodec.computeChecksum(data2), 'Same data should produce same checksum');
  assert(ChunkBinaryCodec.computeChecksum(data1) !== ChunkBinaryCodec.computeChecksum(data3), 'Different data should produce different checksum');
}

// Test 7: estimateSize gives reasonable estimate
{
  const chunk = new Chunk(0, 0);
  for (let x = 0; x < 16; x++) {
    for (let z = 0; z < 16; z++) {
      chunk.setBlock(x, 64, z, BLOCK_TYPES.GRASS);
    }
  }

  const estimated = ChunkBinaryCodec.estimateSize(chunk);
  const encoded = ChunkBinaryCodec.encode(chunk);
  assert(estimated > 0 && estimated < encoded.byteLength * 1.5, `Estimate ${estimated} should be within 1.5x of actual ${encoded.byteLength}`);
}

// Test 8: Worker output format validation
{
  const fs = require('fs');
  const workerSource = fs.readFileSync(path.resolve(__dirname, '..', 'js', 'world', 'workerGeneration.js'), 'utf8');
  
  assert(!workerSource.includes('biomeNames: result.biomeNames'), 'Worker should not return biomeNames in postMessage');
  assert(workerSource.includes('chunkBytes: result.chunkBytes'), 'Worker must return chunkBytes');
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
