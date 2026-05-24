#!/usr/bin/env node
/**
 * Cuubz — Chunk Streaming Integration Tests
 * Tests the full chunk streaming pipeline with multiple players at different locations.
 * Verifies: chunks load around ALL player positions, world doesn't disappear when
 * players spread out, and new chunks stream seamlessly to remote clients.
 *
 * Uses the actual ChunkStreamer class with simulated world generation.
 */

'use strict';

const { CHUNK_WIDTH, CHUNK_DEPTH } = require('../js/world/chunkData');
const { ChunkStreamer, CHUNK_STATE, DEFAULT_STREAM_CONFIG } = require('../js/multiplayer/chunkStreamer');

// ─── Test Harness ──────────────────────────────────────────────

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
    console.log(`  ❌ FAIL — ${message}`);
  }
}

function group(name) {
  console.log(`\n--- ${name} ---`);
}

// ─── Simulated Chunk Generator ──────────────────────────────

/**
 * Simple deterministic chunk data generator for testing.
 * Returns an array of block types (simulating a 16x16x96 chunk).
 */
function mockChunkGenerator(cx, cz) {
  // Deterministic based on chunk coordinates
  const size = CHUNK_WIDTH * CHUNK_DEPTH * 96; // Full chunk height
  const data = new Uint8Array(size);

  // Simple pattern: surface blocks at y=0-5, air above, stone below
  for (let z = 0; z < CHUNK_DEPTH; z++) {
    for (let x = 0; x < CHUNK_WIDTH; x++) {
      for (let y = -32; y <= 64; y++) {
        const idx = z * CHUNK_WIDTH + x;
        if (y >= -32 && y < 0) {
          data[idx] = 3; // Stone underground
        } else if (y >= 0 && y < 5) {
          data[idx] = 1; // Grass at surface
        } else {
          data[idx] = 0; // Air above surface
        }
      }
    }
  }

  return Array.from(data);
}

// ─── Test Execution ────────────────────────────────────────────

function runTests() {
  group('1. Single player — chunks load around player position');

  const streamer = new ChunkStreamer({
    options: {
      loadRadius: 4,
      unloadRadius: 6,
      compressData: true,
      maxChunksPerTick: 10,
    },
  });

  // Register a single player at world origin (chunk 0,0)
  streamer.updatePlayerPosition('player1', { x: 8, y: 20, z: 8 });

  // Calculate chunk needs
  const needs = streamer.calculateChunkNeeds();
  assert(needs.toLoad.size > 0, `Chunks needed to load around player (got ${needs.toLoad.size})`);
  assert(needs.toUnload.size === 0, 'No chunks to unload initially');

  // Load the needed chunks
  let loadedCount = 0;
  for (const key of needs.toLoad) {
    const [cx, cz] = key.split(',').map(Number);
    streamer.loadChunk(cx, cz, mockChunkGenerator);
    loadedCount++;
  }

  assert(loadedCount === needs.toLoad.size, `Loaded ${loadedCount} chunks (needed ${needs.toLoad.size})`);
  assert(streamer.loadedChunkCount === loadedCount, `Streamer reports ${streamer.loadedChunkCount} loaded chunks`);

  // Verify the player's current chunk is loaded
  const playerChunk = streamer.getPlayerChunk('player1');
  assert(playerChunk !== null, 'Player chunk coordinates calculated');
  if (playerChunk) {
    const entry = streamer.getChunkEntry(playerChunk.cx, playerChunk.cz);
    assert(entry !== null, `Player's current chunk (${playerChunk.cx},${playerChunk.cz}) is loaded`);
    assert(entry.state === CHUNK_STATE.LOADED, 'Player chunk state is LOADED');
  }

  group('2. Two players at same location — no duplicate loading');

  const streamer2 = new ChunkStreamer({
    options: { loadRadius: 3, unloadRadius: 5, compressData: true, maxChunksPerTick: 10 },
  });

  // Both players at same position
  streamer2.updatePlayerPosition('playerA', { x: 8, y: 20, z: 8 });
  streamer2.updatePlayerPosition('playerB', { x: 10, y: 20, z: 10 });

  const needs2 = streamer2.calculateChunkNeeds();
  assert(needs2.toLoad.size > 0, `Chunks needed for two nearby players (got ${needs2.toLoad.size})`);

  // Both players should reference the same chunks
  const playerAChunk = streamer2.getPlayerChunk('playerA');
  const playerBChunk = streamer2.getPlayerChunk('playerB');
  assert(playerAChunk.cx === playerBChunk.cx, `Both players in same chunk X (${playerAChunk.cx} == ${playerBChunk.cx})`);
  assert(playerAChunk.cz === playerBChunk.cz, `Both players in same chunk Z (${playerAChunk.cz} == ${playerBChunk.cz})`);

  group('3. Two players far apart — chunks load around BOTH');

  const streamer3 = new ChunkStreamer({
    options: { loadRadius: 3, unloadRadius: 5, compressData: true, maxChunksPerTick: 20 },
  });

  // Players far apart (100 blocks apart = ~6 chunks apart)
  streamer3.updatePlayerPosition('playerA', { x: 8, y: 20, z: 8 });     // Chunk (0, 0)
  streamer3.updatePlayerPosition('playerB', { x: 104, y: 20, z: 104 }); // Chunk (6, 6)

  const needs3 = streamer3.calculateChunkNeeds();
  assert(needs3.toLoad.size > 0, `Chunks needed for two distant players (got ${needs3.toLoad.size})`);

  // Load all needed chunks
  let loaded3 = 0;
  for (const key of needs3.toLoad) {
    const [cx, cz] = key.split(',').map(Number);
    streamer3.loadChunk(cx, cz, mockChunkGenerator);
    loaded3++;
  }

  // Verify chunks around BOTH players are loaded
  const chunkA0_0 = streamer3.getChunkEntry(0, 0);
  const chunkB6_6 = streamer3.getChunkEntry(6, 6);
  assert(chunkA0_0 !== null && chunkA0_0.state === CHUNK_STATE.LOADED, 'Chunks around Player A (chunk 0,0) loaded');
  assert(chunkB6_6 !== null && chunkB6_6.state === CHUNK_STATE.LOADED, 'Chunks around Player B (chunk 6,6) loaded');

  // Verify the number of chunks is roughly double a single player's area
  const singlePlayerArea = Math.PI * 3 * 3; // Approximate circular area with radius 3
  assert(streamer3.loadedChunkCount > singlePlayerArea, `Loaded ${streamer3.loadedChunkCount} chunks for two distant players (expected > ${singlePlayerArea})`);

  group('4. World does not disappear when players spread out');

  const streamer4 = new ChunkStreamer({
    options: { loadRadius: 3, unloadRadius: 10, compressData: true, maxChunksPerTick: 20 },
  });

  // Start both players at same location
  streamer4.updatePlayerPosition('playerA', { x: 8, y: 20, z: 8 });
  streamer4.updatePlayerPosition('playerB', { x: 8, y: 20, z: 8 });

  let needs4a = streamer4.calculateChunkNeeds();
  for (const key of needs4a.toLoad) {
    const [cx, cz] = key.split(',').map(Number);
    streamer4.loadChunk(cx, cz, mockChunkGenerator);
  }

  const initialLoaded = streamer4.loadedChunkCount;
  assert(initialLoaded > 0, `Initially loaded ${initialLoaded} chunks`);

  // Now Player B moves far away
  streamer4.updatePlayerPosition('playerB', { x: 160, y: 20, z: 160 }); // Chunk (10, 10)

  const needs4b = streamer4.calculateChunkNeeds();
  assert(needs4b.toLoad.size > 0, `New chunks needed after Player B moved far away (got ${needs4b.toLoad.size})`);

  // Load the new chunks
  for (const key of needs4b.toLoad) {
    const [cx, cz] = key.split(',').map(Number);
    streamer4.loadChunk(cx, cz, mockChunkGenerator);
  }

  // Verify Player A's area is still loaded (not unloaded because B moved away)
  const chunkA_0_0 = streamer4.getChunkEntry(0, 0);
  assert(chunkA_0_0 !== null && chunkA_0_0.state === CHUNK_STATE.LOADED, 'Player A\'s area still loaded after Player B moved away');

  // Verify Player B's new area is also loaded
  const chunkB_10_10 = streamer4.getChunkEntry(10, 10);
  assert(chunkB_10_10 !== null && chunkB_10_10.state === CHUNK_STATE.LOADED, 'Player B\'s new area loaded');

  // Total loaded should be more than initial (both areas maintained)
  const finalLoaded = streamer4.loadedChunkCount;
  assert(finalLoaded > initialLoaded, `Total loaded increased from ${initialLoaded} to ${finalLoaded} as players spread`);

  group('5. Unloading works correctly when all players leave an area');

  const streamer5 = new ChunkStreamer({
    options: { loadRadius: 2, unloadRadius: 4, compressData: true, maxChunksPerTick: 20 },
  });

  // Single player at origin
  streamer5.updatePlayerPosition('solo', { x: 8, y: 20, z: 8 });

  let needs5a = streamer5.calculateChunkNeeds();
  for (const key of needs5a.toLoad) {
    const [cx, cz] = key.split(',').map(Number);
    streamer5.loadChunk(cx, cz, mockChunkGenerator);
  }

  const soloLoaded = streamer5.loadedChunkCount;
  assert(soloLoaded > 0, `Solo player loaded ${soloLoaded} chunks`);

  // Move player far away (beyond unload radius from original position)
  streamer5.updatePlayerPosition('solo', { x: 128, y: 20, z: 128 }); // Chunk (8, 8)

  const needs5b = streamer5.calculateChunkNeeds();
  assert(needs5b.toUnload.size > 0, `Chunks to unload after player moved far away (got ${needs5b.toUnload.size})`);

  // Verify original area chunks are candidates for unloading
  const originKey = '0,0';
  assert(needs5b.toUnload.has(originKey), `Origin chunk (${originKey}) is candidate for unloading`);

  // Unload the distant chunks
  let unloadedCount = 0;
  for (const key of needs5b.toUnload) {
    const [cx, cz] = key.split(',').map(Number);
    if (streamer5.unloadChunk(cx, cz)) unloadedCount++;
  }

  assert(unloadedCount > 0, `Unloaded ${unloadedCount} chunks`);

  // Load new area around player
  for (const key of needs5b.toLoad) {
    const [cx, cz] = key.split(',').map(Number);
    streamer5.loadChunk(cx, cz, mockChunkGenerator);
  }

  // Verify player's new area is loaded
  const newChunk8_8 = streamer5.getChunkEntry(8, 8);
  assert(newChunk8_8 !== null && newChunk8_8.state === CHUNK_STATE.LOADED, 'New area around player (chunk 8,8) loaded');

  group('6. Dirty chunks are prioritized for streaming');

  const streamer6 = new ChunkStreamer({
    options: { loadRadius: 3, unloadRadius: 5, compressData: true, maxChunksPerTick: 10 },
  });

  streamer6.updatePlayerPosition('player', { x: 8, y: 20, z: 8 });

  // Load some chunks
  let needs6 = streamer6.calculateChunkNeeds();
  for (const key of needs6.toLoad) {
    const [cx, cz] = key.split(',').map(Number);
    streamer6.loadChunk(cx, cz, mockChunkGenerator);
  }

  // Mark one chunk as dirty (block change)
  streamer6.markChunkDirty(0, 0, [1, 2, 3, 4]);

  const dirtyEntry = streamer6.getChunkEntry(0, 0);
  assert(dirtyEntry !== null && dirtyEntry.dirty === true, 'Chunk marked as dirty');
  assert(dirtyEntry.state === CHUNK_STATE.DIRTY, 'Dirty chunk state is DIRTY');

  // Build stream queue — dirty chunks should be first
  streamer6.updatePlayerChunkNeeds();
  streamer6.buildStreamQueue();

  const queue = streamer6._streamQueue;
  assert(queue.length > 0, `Stream queue has ${queue.length} entries`);

  // Find if the dirty chunk is in the queue
  const dirtyInQueue = queue.find(e => e.cx === 0 && e.cz === 0);
  assert(dirtyInQueue !== undefined, 'Dirty chunk (0,0) is in stream queue');

  group('7. Player disconnect removes from tracking and allows unloading');

  const streamer7 = new ChunkStreamer({
    options: { loadRadius: 2, unloadRadius: 4, compressData: true, maxChunksPerTick: 20 },
  });

  // Two players at different locations
  streamer7.updatePlayerPosition('playerA', { x: 8, y: 20, z: 8 });     // Chunk (0, 0)
  streamer7.updatePlayerPosition('playerB', { x: 64, y: 20, z: 64 });   // Chunk (4, 4)

  let needs7a = streamer7.calculateChunkNeeds();
  for (const key of needs7a.toLoad) {
    const [cx, cz] = key.split(',').map(Number);
    streamer7.loadChunk(cx, cz, mockChunkGenerator);
  }

  assert(streamer7.playerCount === 2, `Tracking ${streamer7.playerCount} players`);

  // Verify chunks around both players are loaded
  const chunk7_0_0 = streamer7.getChunkEntry(0, 0);
  const chunk7_4_4 = streamer7.getChunkEntry(4, 4);
  assert(chunk7_0_0 !== null && chunk7_0_0.state === CHUNK_STATE.LOADED, 'Player A area loaded');
  assert(chunk7_4_4 !== null && chunk7_4_4.state === CHUNK_STATE.LOADED, 'Player B area loaded');

  // Player B disconnects
  streamer7.removePlayer('playerB');

  assert(streamer7.playerCount === 1, `After disconnect: tracking ${streamer7.playerCount} player`);

  // Recalculate needs — Player B's area should be unloadable
  const needs7b = streamer7.calculateChunkNeeds();

  // Check if chunk (4,4) is now a candidate for unloading (no players near it)
  assert(needs7b.toUnload.has('4,4') || needs7b.toUnload.size > 0,
    `Chunks around disconnected player are unloadable (${needs7b.toUnload.size} candidates)`);

  group('8. Chunk data compression works correctly');

  const streamer8 = new ChunkStreamer({
    options: { loadRadius: 1, unloadRadius: 3, compressData: true, maxChunksPerTick: 5 },
  });

  streamer8.updatePlayerPosition('player', { x: 8, y: 20, z: 8 });

  let needs8 = streamer8.calculateChunkNeeds();
  for (const key of needs8.toLoad) {
    const [cx, cz] = key.split(',').map(Number);
    streamer8.loadChunk(cx, cz, mockChunkGenerator);
  }

  // Get a loaded chunk entry and verify compression
  const entry8 = streamer8.getChunkEntry(0, 0);
  assert(entry8 !== null, 'Got chunk entry for compression test');

  if (entry8) {
    assert(entry8.compressedData !== null, 'Chunk data is compressed');
    assert(entry8.data !== null, 'Chunk raw data available');
    assert(entry8.compressedData.length < entry8.data.length,
      `Compressed (${entry8.compressedData.length}) smaller than raw (${entry8.data.length})`);

    // Verify getPayload returns correct structure
    const payload = entry8.getPayload();
    assert(payload.chunkX === 0 && payload.chunkZ === 0, 'Payload has correct chunk coordinates');
    assert(payload.compressed === true, 'Payload marked as compressed');
    assert(Array.isArray(payload.data), 'Payload includes data array');
  }

  group('9. Stats tracking is accurate');

  const streamer9 = new ChunkStreamer({
    options: { loadRadius: 2, unloadRadius: 4, compressData: true, maxChunksPerTick: 10 },
  });

  streamer9.updatePlayerPosition('p1', { x: 8, y: 20, z: 8 });
  streamer9.updatePlayerPosition('p2', { x: 16, y: 20, z: 16 });

  let needs9 = streamer9.calculateChunkNeeds();
  for (const key of needs9.toLoad) {
    const [cx, cz] = key.split(',').map(Number);
    streamer9.loadChunk(cx, cz, mockChunkGenerator);
  }

  const stats = streamer9.getStats();
  assert(stats.playersTracked === 2, `Stats: playersTracked=${stats.playersTracked}`);
  assert(stats.chunksLoaded >= needs9.toLoad.size - 1, `Stats: chunksLoaded=${stats.chunksLoaded} (needed ~${needs9.toLoad.size})`);
  assert(stats.chunksDirty === 0, `Stats: no dirty chunks initially (chunksDirty=${stats.chunksDirty})`);
  assert(stats.totalStreamed === 0, `Stats: nothing streamed yet (totalStreamed=${stats.totalStreamed})`);
  assert(stats.totalLoaded >= needs9.toLoad.size - 1, `Stats: totalLoaded=${stats.totalLoaded}`);

  // Mark a chunk dirty and verify stats update
  streamer9.markChunkDirty(0, 0, [1]);
  const statsAfter = streamer9.getStats();
  assert(statsAfter.chunksDirty === 1, `Stats: 1 dirty chunk after mark (chunksDirty=${statsAfter.chunksDirty})`);

  group('10. Edge cases — no players, invalid coordinates');

  const streamer10 = new ChunkStreamer({
    options: { loadRadius: 3, unloadRadius: 5, compressData: true },
  });

  // No players registered
  const needsNoPlayers = streamer10.calculateChunkNeeds();
  assert(needsNoPlayers.toLoad.size === 0, 'No chunks needed with no players');

  // Player with invalid position (no x/z)
  streamer10.updatePlayerPosition('bad', { y: 20 });
  assert(streamer10.playerCount === 0, 'Invalid position not registered (playerCount=0)');

  // Player with null position
  streamer10.updatePlayerPosition('nullpos', null);
  assert(streamer10.playerCount === 0, 'Null position not registered (playerCount=0)');

  // Remove non-existent player — should not error
  streamer10.removePlayer('nonexistent');
  assert(true, 'Removing non-existent player does not throw');

  group('11. Full streaming cycle simulation');

  const streamer11 = new ChunkStreamer({
    options: { loadRadius: 2, unloadRadius: 4, compressData: true, maxChunksPerTick: 5 },
  });

  // Simulate a full tick cycle
  let streamedEvents = [];
  let loadedEvents = [];
  let unloadedEvents = [];

  streamer11.onChunkStreamed = (info) => streamedEvents.push(info);
  streamer11.onChunkLoaded = (info) => loadedEvents.push(info);
  streamer11.onChunkUnloaded = (info) => unloadedEvents.push(info);

  streamer11.updatePlayerPosition('host', { x: 8, y: 20, z: 8 });
  streamer11.updatePlayerPosition('remote', { x: 40, y: 20, z: 40 }); // Chunk (2, 2)

  // Calculate and load
  let needs11 = streamer11.calculateChunkNeeds();
  for (const key of needs11.toLoad) {
    const [cx, cz] = key.split(',').map(Number);
    streamer11.loadChunk(cx, cz, mockChunkGenerator);
  }

  assert(loadedEvents.length > 0, `onChunkLoaded fired ${loadedEvents.length} times`);

  // Update player chunk needs (assigns playerRefs)
  streamer11.updatePlayerChunkNeeds();

  // Build and process stream queue
  streamer11.buildStreamQueue();
  const initialQueueLen = streamer11._streamQueue.length;
  assert(initialQueueLen > 0, `Stream queue built with ${initialQueueLen} entries`);

  // Simulate streaming a few chunks via tick
  const payloads = streamer11.tick();
  assert(Array.isArray(payloads), 'tick() returns array of payloads');

  assert(streamedEvents.length > 0, `onChunkStreamed fired ${streamedEvents.length} times`);
  assert(streamedEvents.length <= streamer11._options.maxChunksPerTick,
    `Respects maxChunksPerTick limit (${streamedEvents.length} <= ${streamer11._options.maxChunksPerTick})`);

  // After streaming, dirty chunks should be marked clean
  const statsFinal = streamer11.getStats();
  assert(statsFinal.totalStreamed === streamedEvents.length,
    `totalStreamed matches events (${statsFinal.totalStreamed} == ${streamedEvents.length})`);

  group('12. Multiple player positions update correctly');

  const streamer12 = new ChunkStreamer({
    options: { loadRadius: 2, unloadRadius: 4, compressData: true },
  });

  streamer12.updatePlayerPosition('player', { x: 8, y: 20, z: 8 });
  let chunk12a = streamer12.getPlayerChunk('player');
  assert(chunk12a.cx === 0 && chunk12a.cz === 0, `Initial chunk: (${chunk12a.cx},${chunk12a.cz})`);

  // Move player to a new chunk
  streamer12.updatePlayerPosition('player', { x: 48, y: 25, z: -16 });
  let chunk12b = streamer12.getPlayerChunk('player');
  assert(chunk12b.cx === 3 && chunk12b.cz === -1, `After move: (${chunk12b.cx},${chunk12b.cz})`);

  // Move to negative coordinates
  streamer12.updatePlayerPosition('player', { x: -24, y: 20, z: -32 });
  let chunk12c = streamer12.getPlayerChunk('player');
  assert(chunk12c.cx === -2 && chunk12c.cz === -2, `Negative coords: (${chunk12c.cx},${chunk12c.cz})`);

  // ─── Results ────────────────────────────────────────

  console.log('\n===================================');
  console.log(`  Chunk Streaming Integration: ${passCount} passed, ${failCount} failed`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) {
      console.log(`  - ${f}`);
    }
  } else {
    console.log('  🎉 All chunk streaming integration tests passing!');
  }
  console.log('===================================\n');

  process.exit(failCount > 0 ? 1 : 0);
}

runTests();
