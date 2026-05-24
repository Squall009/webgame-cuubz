#!/usr/bin/env node
/**
 * Cuubz — World Persistence Integration Tests
 * Full lifecycle: create world → add data → save → reload → verify persistence.
 * Tests chunk data loaded from disk, quest progress preserved,
 * and spawn points restored per player after page reload simulation.
 */

'use strict';

// ============================================================
// Test Setup
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

function assertTrue(condition, message) {
  assert(condition === true, message);
}

function assertFalse(condition, message) {
  assert(condition === false, message);
}

function assertArrayLength(arr, length, message) {
  assert(Array.isArray(arr) && arr.length === length, `${message}: expected length ${length}, got ${arr.length}`);
}

// ============================================================
// Mock Storage Backend (simulates IndexedDB with chunk store)
// ============================================================

class MockPersistenceStorage {
  constructor() {
    this._worlds = [];
    this._characters = [];
    this._chunks = new Map(); // "worldId_cx_cz" → block data
  }

  async saveWorld(data) {
    const index = this._worlds.findIndex(w => w.id === data.id);
    if (index >= 0) {
      this._worlds[index] = JSON.parse(JSON.stringify(data));
    } else {
      this._worlds.push(JSON.parse(JSON.stringify(data)));
    }
  }

  async loadWorlds() {
    return JSON.parse(JSON.stringify(this._worlds));
  }

  async deleteWorld(id) {
    const index = this._worlds.findIndex(w => w.id === id);
    if (index >= 0) {
      this._worlds.splice(index, 1);
    }
    // Also clean up associated chunks
    for (const [key] of this._chunks) {
      if (key.startsWith(`${id}_`)) {
        this._chunks.delete(key);
      }
    }
  }

  async saveChunk(worldId, cx, cz, blockData) {
    const key = `${worldId}_${cx}_${cz}`;
    this._chunks.set(key, JSON.parse(JSON.stringify(blockData)));
  }

  async loadChunk(worldId, cx, cz) {
    const key = `${worldId}_${cx}_${cz}`;
    const data = this._chunks.get(key);
    return data ? JSON.parse(JSON.stringify(data)) : null;
  }

  async deleteChunksForWorld(worldId) {
    for (const [key] of this._chunks) {
      if (key.startsWith(`${worldId}_`)) {
        this._chunks.delete(key);
      }
    }
  }

  async saveCharacter(data) {
    const index = this._characters.findIndex(c => c.id === data.id);
    if (index >= 0) {
      this._characters[index] = JSON.parse(JSON.stringify(data));
    } else {
      this._characters.push(JSON.parse(JSON.stringify(data)));
    }
  }

  async loadCharacters() {
    return JSON.parse(JSON.stringify(this._characters));
  }

  async deleteCharacter(id) {
    const index = this._characters.findIndex(c => c.id === id);
    if (index >= 0) {
      this._characters.splice(index, 1);
    }
  }

  get chunkCount() {
    return this._chunks.size;
  }

  reset() {
    this._worlds = [];
    this._characters = [];
    this._chunks.clear();
  }
}

// ============================================================
// Load Modules
// ============================================================

const { WorldManager, MAX_WORLDS, DEFAULT_SEED, BIOME_NAMES } = require('../js/entities/worldManager');
const { CharacterManager, MAX_CHARACTERS } = require('../js/entities/characterManager');

// ============================================================
// Integration Tests — Full world persistence lifecycle
// ============================================================

(async function runTests() {
console.log('Cuubz — World Persistence Integration Tests');
console.log('=============================================\n');

// --- Test 1: Chunk Data Loaded from Disk (Save → Reload) ---
console.log('\n--- Test 1: Chunk Data Loaded from Disk ---');

const chunkStorage = new MockPersistenceStorage();
const worldMgr = new WorldManager(chunkStorage);
await worldMgr.init();

// Create a world with known seed
const worldResult = await worldMgr.createWorld('TestWorld', 12345);
assertTrue(worldResult.success, 'World creation succeeds');
const testWorld = worldResult.world;
assertNotNull(testWorld, 'World object returned');
assertEquals(testWorld.seed, 12345, 'Seed stored correctly');

// Add chunk references to the world
assertTrue(worldMgr.addChunkReference(testWorld.id, 0, 0), 'Add chunk ref (0,0)');
assertTrue(worldMgr.addChunkReference(testWorld.id, 1, 0), 'Add chunk ref (1,0)');
assertTrue(worldMgr.addChunkReference(testWorld.id, -1, 2), 'Add chunk ref (-1,2)');

// Save chunk data to storage (simulates saving generated chunks to IndexedDB)
const chunkData_00 = { cx: 0, cz: 0, blocks: new Array(4096).fill(0) }; // Simplified block array
chunkData_00.blocks[128] = 3; // Place a stone block at position (0, 8, 0) in chunk
const chunkData_10 = { cx: 1, cz: 0, blocks: new Array(4096).fill(2) }; // Dirt chunk
chunkData_10.blocks[256] = 7; // Wood log at position (0, 16, 0)

await chunkStorage.saveChunk(testWorld.id, 0, 0, chunkData_00);
await chunkStorage.saveChunk(testWorld.id, 1, 0, chunkData_10);

assertEquals(chunkStorage.chunkCount, 2, '2 chunks saved to storage');

// Save updated world (with chunk references) back to storage
await chunkStorage.saveWorld(testWorld);

// Simulate page reload: create new manager from same storage
const reloadedWorldMgr = new WorldManager(chunkStorage);
await reloadedWorldMgr.init();

assertEquals(reloadedWorldMgr.getAllWorlds().length, 1, 'World loaded after reload');
const reloadedWorld = reloadedWorldMgr.getWorld(testWorld.id);
assertNotNull(reloadedWorld, 'World found by ID after reload');
assertEquals(reloadedWorld.name, 'TestWorld', 'World name preserved');
assertEquals(reloadedWorld.seed, 12345, 'World seed preserved');
assertEquals(reloadedWorld.chunkReferences.length, 3, 'Chunk references preserved (3)');
assert(reloadedWorld.chunkReferences.includes('0_0'), 'Chunk ref (0,0) in list');
assert(reloadedWorld.chunkReferences.includes('1_0'), 'Chunk ref (1,0) in list');
assert(reloadedWorld.chunkReferences.includes('-1_2'), 'Chunk ref (-1,2) in list');

// Load chunk data from "disk" (storage) after reload
const loadedChunk_00 = await chunkStorage.loadChunk(testWorld.id, 0, 0);
assertNotNull(loadedChunk_00, 'Chunk (0,0) loads from storage');
assertEquals(loadedChunk_00.blocks[128], 3, 'Stone block at position preserved in chunk data');

const loadedChunk_10 = await chunkStorage.loadChunk(testWorld.id, 1, 0);
assertNotNull(loadedChunk_10, 'Chunk (1,0) loads from storage');
assertEquals(loadedChunk_10.blocks[256], 7, 'Wood log at position preserved in chunk data');

// --- Test 2: Quest Progress Preserved After Reload ---
console.log('\n--- Test 2: Quest Progress Preserved ---');

const questStorage = new MockPersistenceStorage();
const questMgr = new WorldManager(questStorage);
await questMgr.init();

const questWorld = (await questMgr.createWorld('QuestWorld', 99999)).world;

// Simulate quest progression — player completes several quests
assertTrue(questMgr.setQuestProgress(questWorld.id, 'Q01', { stage: 5, completed: true, lastUpdated: Date.now() }), 'Set Q01 complete');
assertTrue(questMgr.setQuestProgress(questWorld.id, 'Q02', { stage: 3, completed: false, lastUpdated: Date.now() }), 'Set Q02 in progress');
assertTrue(questMgr.setQuestProgress(questWorld.id, 'Q03', { stage: 5, completed: true, lastUpdated: Date.now() }), 'Set Q03 complete');

// Advance quest Q04 through stages
for (let i = 0; i < 4; i++) {
  assertTrue(questMgr.advanceQuest(questWorld.id, 'Q04'), `Advance Q04 stage ${i+1}`);
}
assertEquals(questMgr.getQuestProgress(questWorld.id).Q04.stage, 4, 'Q04 at stage 4 after 4 advances');

// Save world with quest progress to storage
await questStorage.saveWorld(questWorld);

// Simulate page reload
const reloadedQuestMgr = new WorldManager(questStorage);
await reloadedQuestMgr.init();

const reloadedQuestWorld = reloadedQuestMgr.getWorld(questWorld.id);
assertNotNull(reloadedQuestWorld, 'Quest world found after reload');

// Verify quest progress survived the reload cycle
const qProgress = reloadedQuestWorld.questProgress;
assertTrue(qProgress.Q01.completed, 'Q01 still completed after reload');
assertEquals(qProgress.Q01.stage, 5, 'Q01 stage preserved as 5');
assertFalse(qProgress.Q02.completed, 'Q02 still in progress after reload');
assertEquals(qProgress.Q02.stage, 3, 'Q02 stage preserved as 3');
assertTrue(qProgress.Q03.completed, 'Q03 still completed after reload');
assertEquals(qProgress.Q04.stage, 4, 'Q04 stage preserved as 4 after reload');
assertFalse(qProgress.Q04.completed, 'Q04 not yet completed (stage 4 < 5)');

// Advance Q04 one more time to complete it
assertTrue(reloadedQuestMgr.advanceQuest(questWorld.id, 'Q04'), 'Complete Q04 on reloaded world');
assertEquals(reloadedQuestMgr.getQuestProgress(questWorld.id).Q04.completed, true, 'Q04 now completed');

// --- Test 3: Spawn Points Restored Per Player (via CharacterManager) ---
console.log('\n--- Test 3: Spawn Points Restored Per Player ---');

const spawnStorage = new MockPersistenceStorage();
const spawnWorldMgr = new WorldManager(spawnStorage);
const spawnCharMgr = new CharacterManager(spawnStorage);
await spawnWorldMgr.init();
await spawnCharMgr.init();

// Create a world and two characters
const spawnWorld = (await spawnWorldMgr.createWorld('SpawnWorld', 54321)).world;
const player1 = (await spawnCharMgr.createCharacter('Hero', '#FF0000')).character;
const player2 = (await spawnCharMgr.createCharacter('Sidekick', '#00FF00')).character;

// Set different spawn points per player for this world
assertTrue(spawnCharMgr.setSpawnPoint(player1.id, spawnWorld.id, { x: 0, y: 64, z: 0 }), 'Hero spawn at world center');
assertTrue(spawnCharMgr.setSpawnPoint(player2.id, spawnWorld.id, { x: 32, y: 58, z: -16 }), 'Sidekick spawn offset from center');

// Verify spawn points set correctly before reload
assertEquals(spawnCharMgr.getSpawnPoint(player1.id, spawnWorld.id).x, 0, 'Hero X = 0');
assertEquals(spawnCharMgr.getSpawnPoint(player1.id, spawnWorld.id).y, 64, 'Hero Y = 64');
assertEquals(spawnCharMgr.getSpawnPoint(player2.id, spawnWorld.id).z, -16, 'Sidekick Z = -16');

// Save characters to storage (simulates IndexedDB save)
const charData = spawnCharMgr.serialize();
await Promise.all(charData.map(c => spawnStorage.saveCharacter(c)));

// Simulate page reload
const reloadedSpawnCharMgr = new CharacterManager(spawnStorage);
await reloadedSpawnCharMgr.init();

// Verify spawn points restored per player after reload
const reloadedHero = reloadedSpawnCharMgr.getCharacter(player1.id);
assertNotNull(reloadedHero, 'Hero found after reload');
assertNotNull(reloadedHero.spawnPoints[spawnWorld.id], 'Hero has spawn point for SpawnWorld');
assertEquals(reloadedHero.spawnPoints[spawnWorld.id].x, 0, 'Hero spawn X restored (0)');
assertEquals(reloadedHero.spawnPoints[spawnWorld.id].y, 64, 'Hero spawn Y restored (64)');
assertEquals(reloadedHero.spawnPoints[spawnWorld.id].z, 0, 'Hero spawn Z restored (0)');

const reloadedSidekick = reloadedSpawnCharMgr.getCharacter(player2.id);
assertNotNull(reloadedSidekick, 'Sidekick found after reload');
assertNotNull(reloadedSidekick.spawnPoints[spawnWorld.id], 'Sidekick has spawn point for SpawnWorld');
assertEquals(reloadedSidekick.spawnPoints[spawnWorld.id].x, 32, 'Sidekick spawn X restored (32)');
assertEquals(reloadedSidekick.spawnPoints[spawnWorld.id].y, 58, 'Sidekick spawn Y restored (58)');
assertEquals(reloadedSidekick.spawnPoints[spawnWorld.id].z, -16, 'Sidekick spawn Z restored (-16)');

// Each player has their own spawn — they don't share
assert(reloadedHero.spawnPoints[spawnWorld.id].x !== reloadedSidekick.spawnPoints[spawnWorld.id].x ||
       reloadedHero.spawnPoints[spawnWorld.id].y !== reloadedSidekick.spawnPoints[spawnWorld.id].y,
       'Players have different spawn points');

// --- Test 4: Full World CRUD + Persistence Round-Trip ---
console.log('\n--- Test 4: Full World CRUD + Persistence ---');

const crudStorage = new MockPersistenceStorage();
const crudMgr = new WorldManager(crudStorage);
await crudMgr.init();

// CREATE world with specific seed
const w1 = (await crudMgr.createWorld('PersistenceTest', 77777)).world;
assertNotNull(w1, 'CREATE: world created');
assertEquals(crudMgr.getAllWorlds().length, 1, 'CREATE: 1 world exists');

// Add data to world
crudMgr.addChunkReference(w1.id, 0, 0);
crudMgr.setQuestProgress(w1.id, 'Q01', { stage: 2, completed: false });

// Save to storage
await crudStorage.saveWorld(w1);

// READ from fresh manager (simulates reload)
const readMgr = new WorldManager(crudStorage);
await readMgr.init();
const readW = readMgr.getWorld(w1.id);
assertNotNull(readW, 'READ: world found after reload');
assertEquals(readW.name, 'PersistenceTest', 'READ: name correct');
assertEquals(readW.seed, 77777, 'READ: seed correct');
assertEquals(readW.chunkReferences.length, 1, 'READ: chunk references preserved');

// UPDATE world name
const updateRes = await readMgr.updateWorld(w1.id, { name: 'UpdatedPersistenceTest' });
assertTrue(updateRes.success, 'UPDATE: succeeds');
assertEquals(readMgr.getWorld(w1.id).name, 'UpdatedPersistenceTest', 'UPDATE: name changed');

// Save updated state
await crudStorage.saveWorld(readMgr.getWorld(w1.id));

// Verify in storage
const storedW = await crudStorage.loadWorlds();
assertEquals(storedW[0].name, 'UpdatedPersistenceTest', 'UPDATE: persisted to storage');

// DELETE world
const deleteRes = await readMgr.deleteWorld(w1.id);
assertTrue(deleteRes.success, 'DELETE: succeeds');
assertEquals(readMgr.getAllWorlds().length, 0, 'DELETE: world count is 0');
assertEquals(readMgr.getWorld(w1.id), null, 'DELETE: world no longer found');

// Verify storage cleanup
const afterDelete = await crudStorage.loadWorlds();
assertEquals(afterDelete.length, 0, 'DELETE: storage also cleared');

// --- Test 5: World Slot Enforcement (Max 3) ---
console.log('\n--- Test 5: World Slot Enforcement ---');

const slotStorage = new MockPersistenceStorage();
const slotMgr = new WorldManager(slotStorage);
await slotMgr.init();

assertEquals(slotMgr.getRemainingSlots(), MAX_WORLDS, 'Initially 3 slots available');

await slotMgr.createWorld('W1', 11111);
await slotMgr.createWorld('W2', 22222);
await slotMgr.createWorld('W3', 33333);

assertEquals(slotMgr.getRemainingSlots(), 0, 'No slots remaining after 3 creates');
assertFalse(slotMgr.canCreateMore(), 'Cannot create more at max');

const failResult = await slotMgr.createWorld('W4', 44444);
assertFalse(failResult.success, '4th world creation rejected');
assert(failResult.error && failResult.error.toLowerCase().includes('maximum'), 'Error mentions maximum');

// --- Test 6: World Seed and Biome Map Persistence ---
console.log('\n--- Test 6: Seed and Biome Map Persistence ---');

const biomeStorage = new MockPersistenceStorage();
const biomeMgr = new WorldManager(biomeStorage);
await biomeMgr.init();

// Create world with known seed → deterministic biome map
const biomeWorld = (await biomeMgr.createWorld('BiomeTest', 42)).world;
assertNotNull(biomeWorld.biomeMap, 'Biome map generated on creation');
assertNotNull(biomeWorld.biomeMap.dominantBiomes, 'Dominant biomes array exists');
assertEquals(biomeWorld.biomeMap.seed, 42, 'Seed in biome map matches world seed');
assertTrue(biomeWorld.biomeMap.dominantBiomes.length > 0, 'Has dominant biomes list (non-empty)');
assertTrue(biomeWorld.biomeMap.dominantBiomes.length >= 2 && biomeWorld.biomeMap.dominantBiomes.length <= 4,
           'Dominant biomes count between 2-4');

// Same seed → same biome map (deterministic)
const { generateBiomeMap } = biomeMgr.constructor;
const map1 = WorldManager.generateBiomeMap(42);
const map2 = WorldManager.generateBiomeMap(42);
assertEquals(map1.dominantBiomes.length, map2.dominantBiomes.length, 'Same seed → same biome count');
assertEquals(map1.dominantBiomes.join(','), map2.dominantBiomes.join(','), 'Same seed → same biomes (deterministic)');

// Save and reload to verify biome map persists
await biomeStorage.saveWorld(biomeWorld);

const reloadedBiomeMgr = new WorldManager(biomeStorage);
await reloadedBiomeMgr.init();
const reloadedBiomeWorld = reloadedBiomeMgr.getWorld(biomeWorld.id);
assertEquals(reloadedBiomeWorld.biomeMap.seed, 42, 'Biome map seed preserved after reload');
assertEquals(reloadedBiomeWorld.biomeMap.dominantBiomes.join(','),
             biomeWorld.biomeMap.dominantBiomes.join(','), 'Dominant biomes preserved after reload');

// --- Test 7: Serialization Round-Trip for Worlds ---
console.log('\n--- Test 7: Serialization Round-Trip ---');

const serStorage = new MockPersistenceStorage();
const serMgr = new WorldManager(serStorage);
await serMgr.init();

const sw1 = (await serMgr.createWorld('SerWorld', 88888)).world;
serMgr.addChunkReference(sw1.id, 0, 0);
serMgr.addChunkReference(sw1.id, 5, -3);
serMgr.setQuestProgress(sw1.id, 'Q10', { stage: 4, completed: false });

// Serialize
const serData = serMgr.serialize();
assertEquals(serData.length, 1, 'Serialized 1 world');
assertEquals(serData[0].name, 'SerWorld', 'Name in serialization');
assertEquals(serData[0].seed, 88888, 'Seed in serialization');
assertArrayLength(serData[0].chunkReferences, 2, 'Chunk refs serialized (2)');
assertTrue(serData[0].questProgress.Q10 !== undefined, 'Quest progress in serialization');

// Deserialize into fresh manager
const deserMgr = new WorldManager(new MockPersistenceStorage());
await deserMgr.init();
deserMgr.deserialize(serData);

const deserW = deserMgr.getAllWorlds()[0];
assertEquals(deserW.name, 'SerWorld', 'Name after deserialization');
assertEquals(deserW.seed, 88888, 'Seed after deserialization');
assertArrayLength(deserW.chunkReferences, 2, 'Chunk refs after deserialization');
assertTrue(deserW.questProgress.Q10 !== undefined, 'Quest progress after deserialization');

// --- Test 8: World Preview Generation ---
console.log('\n--- Test 8: World Preview Generation ---');

const preview = WorldManager.getWorldPreview(sw1);
assert(preview.biomes.includes(BIOME_NAMES.find(b => sw1.biomeMap.dominantBiomes[0] === b)), 'Preview includes biome names');
assertEquals(preview.seed, WorldManager.formatSeed(88888), 'Preview seed formatted correctly');
assertEquals(preview.chunkCount, 2, 'Preview chunk count correct');

// --- Test 9: Edge Cases ---
console.log('\n--- Test 9: Edge Cases ---');

const edgeStorage = new MockPersistenceStorage();
const edgeMgr = new WorldManager(edgeStorage);
await edgeMgr.init();

// Min/max name length
const minName = await edgeMgr.createWorld('A', 11111);
assertTrue(minName.success, '1-char world name accepted');

const maxNameStr = 'A'.repeat(32);
const maxName = await edgeMgr.createWorld(maxNameStr, 22222);
assertTrue(maxName.success, '32-char world name accepted (max)');

const overMax = await edgeMgr.createWorld('X'.repeat(33), 33333);
assertFalse(overMax.success, '33-char world name rejected');

// Non-existent operations
assertEquals(edgeMgr.getWorld('nonexistent'), null, 'getWorld returns null for unknown ID');
assertEquals(edgeMgr.getQuestProgress('nonexistent'), null, 'getQuestProgress returns null');
assertEquals(edgeMgr.getChunkReferences('nonexistent').length, 0, 'getChunkReferences returns empty array');

// Duplicate name prevention
const dupResult = await edgeMgr.createWorld('a', 44444); // lowercase duplicate of 'A'
assertFalse(dupResult.success, 'Duplicate world name (case-insensitive) rejected');

// ============================================================
// Results
// ============================================================

console.log('\n=============================================');
console.log(`Results: ${passCount} passed, ${failCount} failed`);

if (failCount > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
} else {
  console.log('🎉 All world persistence integration tests passing!');
  process.exit(0);
}
})();
