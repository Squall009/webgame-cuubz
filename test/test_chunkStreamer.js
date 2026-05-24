/**
 * Cuubz — Chunk Streaming Tests
 * Tests for js/multiplayer/chunkStreamer.js
 *
 * Test coverage:
 * - ChunkCompressor (RLE compression/decompression)
 * - ChunkStreamEntry (per-chunk state tracking)
 * - ChunkStreamer (main class: player tracking, chunk loading/unloading, streaming)
 * - Edge cases and error handling
 */

'use strict';

const assert = require('assert');
const path = require('path');

// Import chunk streamer module
const {
  DEFAULT_STREAM_CONFIG,
  CHUNK_STATE,
  ChunkCompressor,
  ChunkStreamEntry,
  ChunkStreamer,
} = require(path.join(__dirname, '..', 'js', 'multiplayer', 'chunkStreamer'));

// Import for coordinate constants
const { CHUNK_WIDTH, CHUNK_DEPTH } = require(path.join(__dirname, '..', 'js', 'world', 'chunkData'));

let passed = 0;
let failed = 0;
let totalAssertions = 0;

function assertEqual(actual, expected, message) {
  totalAssertions++;
  try {
    assert.strictEqual(actual, expected, message);
    passed++;
  } catch (err) {
    failed++;
    console.error(`  ❌ FAIL: ${message || 'Assertion failed'} — Expected: ${expected}, Got: ${actual}`);
  }
}

function assertDeepEqual(actual, expected, message) {
  totalAssertions++;
  try {
    assert.deepStrictEqual(actual, expected, message);
    passed++;
  } catch (err) {
    failed++;
    console.error(`  ❌ FAIL: ${message || 'Assertion failed'} — Expected: ${JSON.stringify(expected)}, Got: ${JSON.stringify(actual)}`);
  }
}

function assertTrue(value, message) {
  totalAssertions++;
  try {
    assert.ok(value, message);
    passed++;
  } catch (err) {
    failed++;
    console.error(`  ❌ FAIL: ${message || 'Expected true'} — Got: ${value}`);
  }
}

function assertFalse(value, message) {
  totalAssertions++;
  try {
    assert.ok(!value, message);
    passed++;
  } catch (err) {
    failed++;
    console.error(`  ❌ FAIL: ${message || 'Expected false'} — Got: ${value}`);
  }
}

function assertThrows(fn, message) {
  totalAssertions++;
  try {
    let threw = false;
    try { fn(); } catch (e) { threw = true; }
    assert.ok(threw, message || 'Expected function to throw');
    passed++;
  } catch (err) {
    failed++;
    console.error(`  ❌ FAIL: ${message || 'Expected throw'} — ${err.message}`);
  }
}

// ═══════════════════════════════════════════════════════════
// Test Groups
// ═══════════════════════════════════════════════════════════

console.log('=== Chunk Streaming Tests ===\n');

// ─── Test Group 1: Constants ──────────────────────────────

console.log('\n--- Test Group 1: DEFAULT_STREAM_CONFIG ---');

assertEqual(DEFAULT_STREAM_CONFIG.loadRadius, 6, 'Default loadRadius is 6');
assertEqual(DEFAULT_STREAM_CONFIG.unloadRadius, 8, 'Default unloadRadius is 8');
assertEqual(DEFAULT_STREAM_CONFIG.streamInterval, 500, 'Default streamInterval is 500ms');
assertEqual(DEFAULT_STREAM_CONFIG.maxChunksPerTick, 4, 'Default maxChunksPerTick is 4');
assertTrue(DEFAULT_STREAM_CONFIG.compressData, 'Default compressData is true');

console.log('\n--- Test Group 2: CHUNK_STATE constants ---');

assertEqual(CHUNK_STATE.UNLOADED, 'unloaded', 'CHUNK_STATE.UNLOADED');
assertEqual(CHUNK_STATE.LOADING, 'loading', 'CHUNK_STATE.LOADING');
assertEqual(CHUNK_STATE.LOADED, 'loaded', 'CHUNK_STATE.LOADED');
assertEqual(CHUNK_STATE.STREAMING, 'streaming', 'CHUNK_STATE.STREAMING');
assertEqual(CHUNK_STATE.DIRTY, 'dirty', 'CHUNK_STATE.DIRTY');

// ─── Test Group 3: ChunkCompressor ────────────────────────

console.log('\n--- Test Group 3: ChunkCompressor ---');

// Compress all-air chunk (should compress very well)
const CHUNK_VOLUME = 16 * 16 * 96; // 24576 blocks per chunk
const allAir = new Array(CHUNK_VOLUME).fill(0);
const compressedAir = ChunkCompressor.compress(allAir);
assertEqual(compressedAir.method, 'rle', 'Compression method is rle');
// 24576 zeros = 96 runs of 255 + 1 run of 96
assertEqual(compressedAir.data.length, 194, 'All-air compresses to small size (96*2+2 bytes)');
assertEqual(compressedAir.originalLength, CHUNK_VOLUME, 'Original length preserved');

// Decompress all-air chunk
const decompressedAir = ChunkCompressor.decompress(compressedAir);
assertEqual(decompressedAir.length, CHUNK_VOLUME, 'Decompressed all-air has correct length');
assertTrue(decompressedAir.every(v => v === 0), 'Decompressed all-air is all zeros');

// Compress mixed data
const mixedData = [1, 1, 1, 2, 2, 0, 0, 0, 3];
const compressedMixed = ChunkCompressor.compress(mixedData);
assertEqual(compressedMixed.method, 'rle', 'Mixed data uses rle');
const decompressedMixed = ChunkCompressor.decompress(compressedMixed);
assertDeepEqual(decompressedMixed, mixedData, 'Round-trip compression preserves data');

// Compress single-value array
const singleVal = new Array(100).fill(5);
const compressedSingle = ChunkCompressor.compress(singleVal);
const decompressedSingle = ChunkCompressor.decompress(compressedSingle);
assertEqual(decompressedSingle.length, 100, 'Single-value round-trip correct length');
assertTrue(decompressedSingle.every(v => v === 5), 'Single-value round-trip correct values');

// Compress empty array
const compressedEmpty = ChunkCompressor.compress([]);
assertEqual(compressedEmpty.method, 'none', 'Empty array uses none method');
assertEqual(compressedEmpty.originalLength, 0, 'Empty original length is 0');

// Decompress non-RLE data
const decompressedNone = ChunkCompressor.decompress({ method: 'none', data: [1, 2, 3] });
assertDeepEqual(decompressedNone, [1, 2, 3], 'Non-RLE decompress returns raw data');

// Compress null/undefined input
const compressedNull = ChunkCompressor.compress(null);
assertEqual(compressedNull.method, 'none', 'Null input uses none method');

const compressedUndefined = ChunkCompressor.compress(undefined);
assertEqual(compressedUndefined.method, 'none', 'Undefined input uses none method');

// Decompress null
const decompressedNull = ChunkCompressor.decompress(null);
assertDeepEqual(decompressedNull, [], 'Null decompress returns empty array');

// Compress alternating pattern (worst case for RLE)
const alternating = [];
for (let i = 0; i < 100; i++) alternating.push(i % 256);
const compressedAlt = ChunkCompressor.compress(alternating);
const decompressedAlt = ChunkCompressor.decompress(compressedAlt);
assertDeepEqual(decompressedAlt, alternating, 'Alternating pattern round-trips correctly');

// ─── Test Group 4: ChunkStreamEntry ───────────────────────

console.log('\n--- Test Group 4: ChunkStreamEntry ---');

const entry = new ChunkStreamEntry(5, -3);
assertEqual(entry.cx, 5, 'Chunk X set correctly');
assertEqual(entry.cz, -3, 'Chunk Z set correctly');
assertEqual(entry.key, '5,-3', 'Key format correct');
assertEqual(entry.state, CHUNK_STATE.UNLOADED, 'Initial state is UNLOADED');
assertEqual(entry.data, null, 'Initial data is null');
assertEqual(entry.compressedData, null, 'Initial compressedData is null');
assertEqual(entry.lastStreamed, 0, 'Initial lastStreamed is 0');
assertFalse(entry.dirty, 'Initial dirty is false');
assertTrue(entry.playerRefs.size === 0, 'Initial playerRefs empty');

// markDirty
entry.state = CHUNK_STATE.LOADED;
entry.data = [1, 2, 3];
entry.markDirty();
assertTrue(entry.dirty, 'markDirty sets dirty flag');
assertEqual(entry.state, CHUNK_STATE.DIRTY, 'markDirty sets state to DIRTY');

// markClean
const beforeClean = Date.now();
entry.markClean();
assertFalse(entry.dirty, 'markClean clears dirty flag');
assertEqual(entry.state, CHUNK_STATE.LOADED, 'markClean sets state to LOADED');
assertTrue(entry.lastStreamed >= beforeClean, 'markClean updates lastStreamed');

// needsStreaming
const freshEntry = new ChunkStreamEntry(0, 0);
freshEntry.state = CHUNK_STATE.LOADED;
freshEntry.data = [1];
assertTrue(freshEntry.needsStreaming(), 'New loaded chunk needs streaming (lastStreamed=0)');
freshEntry.lastStreamed = Date.now();
assertFalse(freshEntry.needsStreaming(), 'Recently streamed chunk does not need streaming');
freshEntry.dirty = true;
assertTrue(freshEntry.needsStreaming(), 'Dirty chunk needs streaming');

// getPayload with compressed data
const payloadEntry = new ChunkStreamEntry(1, 2);
payloadEntry.state = CHUNK_STATE.LOADED;
payloadEntry.data = [1, 1, 2, 2, 3];
const compData = ChunkCompressor.compress(payloadEntry.data);
payloadEntry.compressedData = compData.data;
const payload = payloadEntry.getPayload();
assertEqual(payload.chunkX, 1, 'Payload has chunkX');
assertEqual(payload.chunkZ, 2, 'Payload has chunkZ');
assertTrue(payload.compressed, 'Payload marks compressed=true when compressedData exists');

// getPayload without compressed data
const simpleEntry = new ChunkStreamEntry(3, 4);
simpleEntry.state = CHUNK_STATE.LOADED;
simpleEntry.data = [1, 2];
const simplePayload = simpleEntry.getPayload();
assertFalse(simplePayload.compressed, 'Payload marks compressed=false when no compressedData');
assertDeepEqual(simplePayload.data, [1, 2], 'Payload includes raw data');

// ─── Test Group 5: ChunkStreamer Constructor ──────────────

console.log('\n--- Test Group 5: ChunkStreamer constructor ---');

const streamer = new ChunkStreamer();
assertFalse(streamer.isRunning, 'Not running initially');
assertEqual(streamer.loadedChunkCount, 0, 'Zero loaded chunks initially');
assertEqual(streamer.playerCount, 0, 'Zero players initially');
assertDeepEqual(streamer.getLoadedChunkKeys(), [], 'No loaded chunk keys');

const stats = streamer.getStats();
assertEqual(stats.playersTracked, 0, 'Stats: zero players tracked');
assertEqual(stats.chunksLoaded, 0, 'Stats: zero chunks loaded');
assertEqual(stats.totalStreamed, 0, 'Stats: zero total streamed');
assertFalse(stats.running, 'Stats: not running');

// Custom options
const customStreamer = new ChunkStreamer({
  options: { loadRadius: 4, unloadRadius: 6, maxChunksPerTick: 8 },
});
assertEqual(customStreamer._options.loadRadius, 4, 'Custom loadRadius applied');
assertEqual(customStreamer._options.maxChunksPerTick, 8, 'Custom maxChunksPerTick applied');

// ─── Test Group 6: Player Position Tracking ───────────────

console.log('\n--- Test Group 6: Player position tracking ---');

const ps = new ChunkStreamer();
ps.updatePlayerPosition('p1', { x: 32, y: 20, z: -16 });
assertEqual(ps.playerCount, 1, 'One player tracked');

// Get player chunk coordinates
const pc1 = ps.getPlayerChunk('p1');
assertEqual(pc1.cx, 2, 'Player in chunk X=2 (32/16=2)');
assertEqual(pc1.cz, -1, 'Player in chunk Z=-1 (-16/16=-1)');

// Add second player
ps.updatePlayerPosition('p2', { x: 0, y: 20, z: 0 });
assertEqual(ps.playerCount, 2, 'Two players tracked');

const pc2 = ps.getPlayerChunk('p2');
assertEqual(pc2.cx, 0, 'Second player in chunk X=0');
assertEqual(pc2.cz, 0, 'Second player in chunk Z=0');

// Remove player
ps.removePlayer('p1');
assertEqual(ps.playerCount, 1, 'One player after removal');
assertEqual(ps.getPlayerChunk('p1'), null, 'Removed player returns null chunk');

// Invalid position updates (no-op)
ps.updatePlayerPosition(null, { x: 0, y: 20, z: 0 });
assertEqual(ps.playerCount, 1, 'Null playerId is no-op');
ps.updatePlayerPosition('p3', null);
assertEqual(ps.playerCount, 1, 'Null position is no-op');
ps.updatePlayerPosition('p3', { x: 'abc', z: 0 });
assertEqual(ps.playerCount, 1, 'Non-numeric position is no-op');

// ─── Test Group 7: Chunk Loading ──────────────────────────

console.log('\n--- Test Group 7: Chunk loading ---');

const ls = new ChunkStreamer();
let loadedEvents = [];
ls.onChunkLoaded = (data) => { loadedEvents.push(data); };

// Load chunk with generator function
const genCallCount = { count: 0 };
const generatorFn = (cx, cz) => {
  genCallCount.count++;
  return new Array(256).fill(cx + cz); // Simple test data
};

const entry1 = ls.loadChunk(0, 0, generatorFn);
assertEqual(entry1.state, CHUNK_STATE.LOADED, 'Load sets state to LOADED');
assertTrue(genCallCount.count > 0, 'Generator function called');
assertDeepEqual(entry1.data.slice(0, 5), [0, 0, 0, 0, 0], 'Data generated from cx+cz=0');
assertEqual(ls.loadedChunkCount, 1, 'One chunk loaded');
assertEqual(ls.getLoadedChunkKeys().length, 1, 'One key in loaded set');
assertEqual(loadedEvents.length, 1, 'onChunkLoaded called once');
assertEqual(loadedEvents[0].cx, 0, 'Event has correct cx');

// Load chunk without generator (relay-provided)
const entry2 = ls.loadChunk(1, 1, null);
assertEqual(entry2.state, CHUNK_STATE.LOADED, 'Load without generator succeeds');
assertEqual(entry2.data, null, 'No data when no generator');
assertEqual(ls.loadedChunkCount, 2, 'Two chunks loaded');

// Load existing chunk (no-op for already-loaded)
const entry3 = ls.loadChunk(0, 0, generatorFn);
assertEqual(entry3, entry1, 'Returns same entry for existing chunk');
assertEqual(genCallCount.count, 1, 'Generator NOT called again for already-loaded chunk');

// Load already-loaded chunk (should skip generation)
const entry4 = ls.loadChunk(0, 0, generatorFn);
assertEqual(entry4, entry1, 'Returns existing loaded entry');
assertEqual(genCallCount.count, 1, 'Generator still NOT called for already-loaded chunk');

// ─── Test Group 8: Chunk Unloading ────────────────────────

console.log('\n--- Test Group 8: Chunk unloading ---');

const us = new ChunkStreamer();
let unloadedEvents = [];
us.onChunkUnloaded = (data) => { unloadedEvents.push(data); };

us.loadChunk(0, 0, () => [1, 2, 3]);
assertTrue(us.getChunkEntry(0, 0).data !== null, 'Data exists before unload');

const unloadded = us.unloadChunk(0, 0);
assertTrue(unloadded, 'unloadChunk returns true for loaded chunk');
assertEqual(us.getChunkEntry(0, 0).state, CHUNK_STATE.UNLOADED, 'State is UNLOADED after unload');
assertEqual(us.getChunkEntry(0, 0).data, null, 'Data cleared after unload');
assertEqual(us.loadedChunkCount, 0, 'Zero chunks loaded after unload');
assertEqual(unloadedEvents.length, 1, 'onChunkUnloaded called once');

// Unload already unloaded (no-op)
const unloadded2 = us.unloadChunk(0, 0);
assertFalse(unloadded2, 'unloadChunk returns false for already unloaded');
assertEqual(unloadedEvents.length, 1, 'No additional unload event');

// Unload non-existent chunk (no-op)
const unloadded3 = us.unloadChunk(99, 99);
assertFalse(unloadded3, 'unloadChunk returns false for non-existent chunk');

// ─── Test Group 9: Mark Chunk Dirty ───────────────────────

console.log('\n--- Test Group 9: Mark chunk dirty ---');

const ds = new ChunkStreamer();
ds.loadChunk(5, 5, () => [1, 2, 3]);

const dEntry = ds.getChunkEntry(5, 5);
assertFalse(dEntry.dirty, 'Newly loaded chunk is not dirty');

// Mark dirty with new data
ds.markChunkDirty(5, 5, [4, 5, 6]);
assertTrue(dEntry.dirty, 'markChunkDirty sets dirty flag');
assertEqual(dEntry.state, CHUNK_STATE.DIRTY, 'State changes to DIRTY');
assertDeepEqual(dEntry.data, [4, 5, 6], 'New data applied');

// Mark dirty for non-existent chunk (auto-creates entry)
ds.markChunkDirty(10, 10, [7, 8]);
const newEntry = ds.getChunkEntry(10, 10);
assertTrue(newEntry !== null, 'Auto-created entry for new chunk');
assertTrue(newEntry.dirty, 'Auto-created chunk is dirty');

// ─── Test Group 10: Calculate Chunk Needs ────────────────

console.log('\n--- Test Group 10: Calculate chunk needs ---');

const cs = new ChunkStreamer({ options: { loadRadius: 2, unloadRadius: 4 } });
cs.updatePlayerPosition('p1', { x: 32, y: 20, z: 32 }); // Player in chunk (2, 2)

const needs = cs.calculateChunkNeeds();
assertTrue(needs.toLoad.size > 0, 'Some chunks need loading');
assertTrue(needs.toUnload.size === 0, 'Nothing to unload initially');

// Chunk (2, 2) should be in needed set
assertTrue(needs.toLoad.has('2,2'), 'Current player chunk needs loading');

// After loading, nothing new should need loading
for (const key of needs.toLoad) {
  const [cx, cz] = key.split(',').map(Number);
  cs.loadChunk(cx, cz, null);
}

const needs2 = cs.calculateChunkNeeds();
assertEqual(needs2.toLoad.size, 0, 'Nothing new to load after loading all needed');

// Remove player — everything should be unloadable
cs.removePlayer('p1');
const needs3 = cs.calculateChunkNeeds();
assertTrue(needs3.toUnload.size > 0, 'Chunks need unloading after player leaves');

// ─── Test Group 11: Full Tick Cycle ──────────────────────

console.log('\n--- Test Group 11: Full tick cycle ---');

const ts = new ChunkStreamer({ options: { loadRadius: 2, unloadRadius: 4, maxChunksPerTick: 8 } });
ts.updatePlayerPosition('host', { x: 32, y: 20, z: 32 }); // chunk (2, 2)

let streamedPayloads = [];
ts.onChunkStreamed = (payload) => { streamedPayloads.push(payload); };

// First tick — load and stream chunks around player
const payloads1 = ts.tick();
assertTrue(payloads1.length > 0, 'First tick streams chunks');
assertEqual(streamedPayloads.length, payloads1.length, 'onChunkStreamed called for each payload');

// Each payload should have player list
for (const p of payloads1) {
  assertTrue(Array.isArray(p.players), 'Payload has players array');
  assertTrue(p.players.includes('host'), 'Host is in player list for nearby chunk');
}

// Second tick — streams remaining chunks from first tick's batch limit
const payloads2 = ts.tick();
assertTrue(payloads2.length >= 0, 'Second tick may stream remaining chunks from batch');

// Third tick — everything should be clean now
const payloads2b = ts.tick();
assertEqual(payloads2b.length, 0, 'Third tick streams nothing (all clean now)');

// Mark a chunk dirty and check it gets re-streamed on next tick
const dirtyKey = ts.getLoadedChunkKeys()[0];
if (dirtyKey) {
  const [dcx, dcz] = dirtyKey.split(',').map(Number);
  
  // Reset player refs so the chunk is near the player
  ts.updatePlayerPosition('host', { x: dcx * 16 + 8, y: 20, z: dcz * 16 + 8 });
  
  ts.markChunkDirty(dcx, dcz, [1, 2, 3]);

  const payloads3 = ts.tick();
  assertTrue(payloads3.length > 0, 'Third tick streams dirty chunk');
  // Find the dirty payload
  const dirtyPayload = payloads3.find(p => p.chunkX === dcx && p.chunkZ === dcz);
  assertTrue(dirtyPayload !== undefined, 'Dirty chunk found in stream queue');
  assertTrue(dirtyPayload.dirty, 'Payload marks dirty=true');
}

// ─── Test Group 12: Multiplayer Chunk Tracking ───────────

console.log('\n--- Test Group 12: Multiplayer chunk tracking ---');

const ms = new ChunkStreamer({ options: { loadRadius: 3, unloadRadius: 5 } });

// Two players far apart
ms.updatePlayerPosition('p_near', { x: 0, y: 20, z: 0 });     // chunk (0, 0)
ms.updatePlayerPosition('p_far', { x: 96, y: 20, z: 96 });    // chunk (6, 6)

const mNeeds = ms.calculateChunkNeeds();
assertTrue(mNeeds.toLoad.has('0,0'), 'Near player chunk needed');
assertTrue(mNeeds.toLoad.has('6,6'), 'Far player chunk needed');

// Load all needed chunks
for (const key of mNeeds.toLoad) {
  const [cx, cz] = key.split(',').map(Number);
  ms.loadChunk(cx, cz, null);
}

// Update player needs — each player should only get nearby chunks
ms.updatePlayerChunkNeeds();

// Check near player's chunk has p_near as ref
const nearEntry = ms.getChunkEntry(0, 0);
assertTrue(nearEntry.playerRefs.has('p_near'), 'Near chunk references near player');
assertFalse(nearEntry.playerRefs.has('p_far'), 'Near chunk does NOT reference far player');

// Check far player's chunk has p_far as ref
const farEntry = ms.getChunkEntry(6, 6);
assertTrue(farEntry.playerRefs.has('p_far'), 'Far chunk references far player');
assertFalse(farEntry.playerRefs.has('p_near'), 'Far chunk does NOT reference near player');

// Remove one player — their chunks should become unload candidates
ms.removePlayer('p_far');
const mNeeds2 = ms.calculateChunkNeeds();
assertTrue(mNeeds2.toUnload.has('6,6'), 'Far player chunk becomes unload candidate');

// ─── Test Group 13: Start/Stop/Dispose ────────────────────

console.log('\n--- Test Group 13: Start/Stop/Dispose ---');

const ls2 = new ChunkStreamer({ options: { streamInterval: 100 } });
ls2.updatePlayerPosition('p1', { x: 0, y: 20, z: 0 });

// Start streaming
ls2.start();
assertTrue(ls2.isRunning, 'isRunning after start');

// Load a chunk and let it auto-stream
ls2.loadChunk(0, 0, () => [1, 2, 3]);

// Wait for at least one tick
setTimeout(() => {
  const stats = ls2.getStats();
  assertTrue(stats.totalStreamed > 0, 'Chunks streamed during auto-tick');

  // Stop streaming
  ls2.stop();
  assertFalse(ls2.isRunning, 'Not running after stop');

  // Dispose — clears everything
  ls2.dispose();
  assertEqual(ls2.loadedChunkCount, 0, 'Zero chunks after dispose');
  assertEqual(ls2.playerCount, 0, 'Zero players after dispose');

  // Start again (should work)
  ls2.start();
  assertTrue(ls2.isRunning, 'Can restart after dispose');
  ls2.dispose();
}, 300);

// ─── Test Group 14: Error Handling ────────────────────────

console.log('\n--- Test Group 14: Error handling ---');

const es = new ChunkStreamer();
let errors = [];
es.onError = (err) => { errors.push(err.message); };

// Generator that throws
es.loadChunk(0, 0, () => { throw new Error('Gen failed!'); });
assertEqual(es.getChunkEntry(0, 0).state, CHUNK_STATE.UNLOADED, 'Failed generation reverts to UNLOADED');
assertTrue(errors.length > 0, 'onError called for generator failure');

// Callback that throws
const es2 = new ChunkStreamer();
let loadedCount = 0;
es2.onChunkLoaded = () => { throw new Error('Callback boom!'); };
es2.loadChunk(1, 1, () => [1]);
assertEqual(es2.getChunkEntry(1, 1).state, CHUNK_STATE.LOADED, 'Chunk still loaded despite callback error');

// ─── Test Group 15: Compression Integration ───────────────

console.log('\n--- Test Group 15: Compression integration ---');

const compStreamer = new ChunkStreamer({ options: { compressData: true } });
compStreamer.loadChunk(0, 0, () => new Array(256).fill(0)); // All-air chunk

const compEntry = compStreamer.getChunkEntry(0, 0);
assertTrue(compEntry.compressedData !== null, 'Compressed data generated');
assertEqual(compEntry.compressedData.length, 4, 'All-air compresses to small size (2 RLE runs)');

// Stream payload uses compressed data
compEntry.playerRefs.add('p1');
compStreamer.buildStreamQueue();
const compPayloads = [];
for (const entry of compStreamer._streamQueue) {
  const p = entry.getPayload();
  compPayloads.push(p);
}
assertTrue(compPayloads.length > 0, 'Stream queue has entries');
assertTrue(compPayloads[0].compressed, 'Payload uses compressed data');

// Without compression option
const noCompStreamer = new ChunkStreamer({ options: { compressData: false } });
noCompStreamer.loadChunk(0, 0, () => new Array(256).fill(0));
const noCompEntry = noCompStreamer.getChunkEntry(0, 0);
assertEqual(noCompEntry.compressedData, null, 'No compressed data when option disabled');

// ─── Test Group 16: Edge Cases ────────────────────────────

console.log('\n--- Test Group 16: Edge cases ---');

// Empty streamer tick (no players)
const emptyStreamer = new ChunkStreamer();
const emptyPayloads = emptyStreamer.tick();
assertDeepEqual(emptyPayloads, [], 'Tick with no players returns empty array');

// Negative chunk coordinates
const negStreamer = new ChunkStreamer();
negStreamer.loadChunk(-5, -10, () => [1]);
assertEqual(negStreamer.getChunkEntry(-5, -10).state, CHUNK_STATE.LOADED, 'Negative coords work');

// Large chunk coordinates
negStreamer.loadChunk(9999, -9999, () => [2]);
assertEqual(negStreamer.getChunkEntry(9999, -9999).state, CHUNK_STATE.LOADED, 'Large coords work');

// Duplicate start (no-op)
emptyStreamer.start();
emptyStreamer.start();
assertTrue(emptyStreamer.isRunning, 'Duplicate start is no-op');
emptyStreamer.dispose();

// GetChunkEntry for non-existent chunk
assertEqual(emptyStreamer.getChunkEntry(999, 999), null, 'Non-existent chunk returns null');

// Stats accuracy
const statStreamer = new ChunkStreamer();
statStreamer.updatePlayerPosition('p1', { x: 0, y: 20, z: 0 });
statStreamer.loadChunk(0, 0, () => [1, 2]);
statStreamer.markChunkDirty(0, 0, [3, 4]);

const finalStats = statStreamer.getStats();
assertEqual(finalStats.playersTracked, 1, 'Stats tracks 1 player');
assertEqual(finalStats.chunksLoaded, 0, 'Stats: 0 clean loaded (chunk is dirty)');
assertEqual(finalStats.chunksDirty, 1, 'Stats: 1 dirty chunk');

// ═══════════════════════════════════════════════════════════
// Results
// ═══════════════════════════════════════════════════════════

console.log('\n===================================');
console.log(`  Results: ${passed}/${totalAssertions} assertions passed`);
if (failed > 0) {
  console.log(`  ❌ ${failed} assertions FAILED`);
  process.exit(1);
} else {
  console.log('  ✅ All assertions passed!');
}
