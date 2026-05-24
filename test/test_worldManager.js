#!/usr/bin/env node
/**
 * Cuubz — World Management Tests
 * Tests the WorldManager class with an in-memory mock storage backend.
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

function assertObjectHasKeys(obj, keys, message) {
  const hasAll = keys.every(k => obj.hasOwnProperty(k));
  assert(hasAll, `${message}: object missing keys. Has: ${Object.keys(obj).join(', ')}, need: ${keys.join(', ')}`);
}

function assertArrayContains(arr, item, message) {
  assert(arr.includes(item), `${message}: array does not contain "${item}"`);
}

// ============================================================
// Mock Storage Backend (in-memory IndexedDB simulation)
// ============================================================

class MockStorage {
  constructor() {
    this.worlds = [];
    this.chunks = new Map();
  }

  async saveWorld(data) {
    const index = this.worlds.findIndex(w => w.id === data.id);
    if (index >= 0) {
      this.worlds[index] = { ...data };
    } else {
      this.worlds.push({ ...data });
    }
  }

  async loadWorlds() {
    return [...this.worlds];
  }

  async deleteWorld(id) {
    const index = this.worlds.findIndex(w => w.id === id);
    if (index >= 0) {
      this.worlds.splice(index, 1);
    }
    // Also clean up associated chunks
    for (const [key] of this.chunks) {
      if (key.startsWith(`${id}_`)) {
        this.chunks.delete(key);
      }
    }
  }

  reset() {
    this.worlds = [];
    this.chunks.clear();
  }
}

// ============================================================
// Load WorldManager Module
// ============================================================

const { WorldManager, MAX_WORLDS, MIN_NAME_LENGTH, MAX_NAME_LENGTH, DEFAULT_SEED, BIOME_NAMES } = require('../js/entities/worldManager');

// ============================================================
// Tests — wrapped in async IIFE to support await
// ============================================================

(async function runTests() {
console.log('Cuubz — World Management Tests');
console.log('===================================\n');

// --- Test Suite 1: Constants and Static Methods ---
console.log('\n--- Constants & Static Methods ---');

assertEquals(MAX_WORLDS, 3, 'MAX_WORLDS is 3');
assertEquals(MIN_NAME_LENGTH, 1, 'MIN_NAME_LENGTH is 1');
assertEquals(MAX_NAME_LENGTH, 32, 'MAX_NAME_LENGTH is 32');
assertEquals(DEFAULT_SEED, 42, 'DEFAULT_SEED is 42');
assert(BIOME_NAMES.length === 8, 'BIOME_NAMES has 8 biomes');
assertArrayContains(BIOME_NAMES, 'Plains', 'Plains biome exists');
assertArrayContains(BIOME_NAMES, 'Corrupt', 'Corrupt biome exists');
assertArrayContains(BIOME_NAMES, 'Lava', 'Lava biome exists');
assert(typeof WorldManager.generateId === 'function', 'generateId is a function');
assert(typeof WorldManager.generateSeed === 'function', 'generateSeed is a function');
assert(typeof WorldManager.formatSeed === 'function', 'formatSeed is a function');

// Test ID generation uniqueness
const ids = new Set();
for (let i = 0; i < 100; i++) {
  ids.add(WorldManager.generateId());
}
assertEquals(ids.size, 100, 'generateId produces 100 unique IDs');
assert(/^world_/.test([...ids][0]), 'IDs match world_<ts>_<rnd> format');

// Test seed generation
const seeds = new Set();
for (let i = 0; i < 100; i++) {
  const seed = WorldManager.generateSeed();
  assert(seed >= 0 && seed <= 0xFFFFFFFF, `Seed ${seed} is valid 32-bit unsigned`);
  seeds.add(seed);
}
assert(seeds.size > 50, 'generateSeed produces varied results (100 calls)');

// Test seed formatting
assertEquals(WorldManager.formatSeed(42), '00000042', 'formatSeed pads to 8 digits');
assertTrue(WorldManager.formatSeed(123456789).length >= 8, 'formatSeed handles large numbers (≥8 digits)');
assertEquals(WorldManager.formatSeed(0), '00000000', 'formatSeed handles zero');

// Test biome map generation
const biomeMap = WorldManager.generateBiomeMap(12345);
assertNotNull(biomeMap, 'generateBiomeMap returns object');
assertNotNull(biomeMap.dominantBiomes, 'biomeMap has dominantBiomes array');
assert(biomeMap.dominantBiomes.length >= 2 && biomeMap.dominantBiomes.length <= 4, 
  `dominantBiomes has ${biomeMap.dominantBiomes.length} biomes (expect 2-4)`);
assertEquals(biomeMap.seed, 12345, 'biomeMap preserves seed');

// Test deterministic biome generation
const map1 = WorldManager.generateBiomeMap(999);
const map2 = WorldManager.generateBiomeMap(999);
assertEquals(map1.dominantBiomes.join(','), map2.dominantBiomes.join(','), 
  'Same seed produces same biome distribution');

// Test different seeds produce different biomes (usually)
const map3 = WorldManager.generateBiomeMap(111);
const map4 = WorldManager.generateBiomeMap(222);
assert(map3.dominantBiomes.join(',') !== map4.dominantBiomes.join(','),
  'Different seeds produce different biome distributions');

// --- Test Suite 2: Name Validation ---
console.log('\n--- Name Validation ---');

// Valid names
assert(WorldManager.validateName('My World').valid, 'Normal name valid');
assert(WorldManager.validateName('Test-World').valid, 'Hyphenated name valid');
assert(WorldManager.validateName('world_1').valid, 'Underscored name valid');
assert(WorldManager.validateName('a').valid, 'Single character name valid');
assertEquals(WorldManager.validateName('12345678901234567890123456789012').valid, true, 
  '32 char name valid (max)');
assert(WorldManager.validateName('The_Great-World_2026').valid, 'Mixed special chars valid');

// Invalid names
assertFalse(WorldManager.validateName('').valid, 'Empty name invalid');
assertFalse(WorldManager.validateName('   ').valid, 'Whitespace-only name invalid');
assertFalse(WorldManager.validateName('123456789012345678901234567890123').valid, 
  '33 char name invalid (over max)');
assertFalse(WorldManager.validateName('test@world!').valid, 'Special chars in name invalid');
assertFalse(WorldManager.validateName(123).valid, 'Non-string name invalid');
assertFalse(WorldManager.validateName(null).valid, 'Null name invalid');

// Error messages present
const errResult = WorldManager.validateName('');
assert(errResult.error !== undefined, 'Invalid name returns error message');

// --- Test Suite 3: World Creation ---
console.log('\n--- World Creation ---');

const storage = new MockStorage();
const mgr = new WorldManager(storage);
await mgr.init();

// Initial state
assertEquals(mgr.getAllWorlds().length, 0, 'Start with 0 worlds');
assertTrue(mgr.canCreateMore(), 'Can create more at start');
assertEquals(mgr.getRemainingSlots(), 3, '3 remaining slots at start');

// Create first world
let result = await mgr.createWorld('Plains World');
assertTrue(result.success, 'First world creation succeeds');
assertNotNull(result.world, 'Created world returned');
assertObjectHasKeys(result.world, ['id', 'name', 'seed', 'biomeMap', 'questProgress', 
  'chunkReferences', 'createdAt', 'lastPlayed'], 'World has all required fields');
assertEquals(result.world.name, 'Plains World', 'Name stored correctly');
assert(result.world.seed >= 0 && result.world.seed <= 0xFFFFFFFF, 'Seed is valid 32-bit number');
assert(result.world.biomeMap !== undefined, 'biomeMap generated');
assert(Array.isArray(result.world.biomeMap.dominantBiomes), 'dominantBiomes is array');
assertEquals(Object.keys(result.world.questProgress).length, 0, 'questProgress starts empty');
assertEquals(result.world.chunkReferences.length, 0, 'chunkReferences starts empty');
assert(result.world.createdAt > 0, 'createdAt is timestamp');
assertEquals(result.world.lastPlayed, null, 'lastPlayed is null on creation');

// Create second world with explicit seed
result = await mgr.createWorld('Desert World', 12345);
assertTrue(result.success, 'Second world creation succeeds');
assertEquals(result.world.seed, 12345, 'Explicit seed preserved');
assertEquals(mgr.getAllWorlds().length, 2, 'Now have 2 worlds');
assertEquals(mgr.getRemainingSlots(), 1, '1 remaining slot');

// Create third world (last slot)
result = await mgr.createWorld('Mountain World');
assertTrue(result.success, 'Third world creation succeeds');
assertEquals(mgr.getAllWorlds().length, 3, 'Now have 3 worlds');
assertFalse(mgr.canCreateMore(), 'Cannot create more at max');
assertEquals(mgr.getRemainingSlots(), 0, '0 remaining slots');

// Try to create fourth (should fail)
result = await mgr.createWorld('Extra World');
assertFalse(result.success, 'Fourth world rejected');
assert(result.error !== undefined && result.error.toLowerCase().includes('maximum'), 
  'Error mentions maximum reached');
assertEquals(mgr.getAllWorlds().length, 3, 'Still only 3 worlds after failed creation');

// Duplicate name (case-insensitive)
const mountain = mgr.getAllWorlds().find(w => w.name === 'Mountain World');
result = await mgr.deleteWorld(mountain.id); // Free a slot
await mgr.init(); // Reload from storage
assertTrue(result.success, 'Deleted world to free slot');

result = await mgr.createWorld('plains world', 999); // lowercase duplicate
assertFalse(result.success, 'Duplicate name (case-insensitive) rejected');
assert(result.error && result.error.toLowerCase().includes('already exists'), 
  'Error mentions existing world');

// Name trimming
result = await mgr.createWorld('  Trimmed World  ');
assertTrue(result.success, 'Name with extra spaces accepted');
assertEquals(result.world.name, 'Trimmed World', 'Name trimmed on creation');

// --- Test Suite 4: World Updates ---
console.log('\n--- World Updates ---');

const worlds = mgr.getAllWorlds();
const firstWorld = worlds[0];

// Update name
result = await mgr.updateWorld(firstWorld.id, { name: 'Renamed Plains' });
assertTrue(result.success, 'Name update succeeds');
assertEquals(result.world.name, 'Renamed Plains', 'Name updated correctly');

// Update non-existent world
result = await mgr.updateWorld('nonexistent_id', { name: 'Ghost' });
assertFalse(result.success, 'Update of non-existent world fails');

// Update with invalid name
result = await mgr.updateWorld(firstWorld.id, { name: '' });
assertFalse(result.success, 'Update with empty name rejected');

// Update with duplicate name
const secondWorld = worlds[1];
result = await mgr.updateWorld(firstWorld.id, { name: secondWorld.name });
assertFalse(result.success, 'Update to duplicate name rejected');

// Partial update (only name)
result = await mgr.updateWorld(firstWorld.id, { name: 'Final Plains Name' });
assertTrue(result.success, 'Partial update succeeds');
assertEquals(result.world.name, 'Final Plains Name', 'Name changed in partial update');
assert(result.world.seed !== undefined, 'Seed preserved during update');

// --- Test Suite 5: World Deletion ---
console.log('\n--- World Deletion ---');

const beforeCount = mgr.getAllWorlds().length;
const targetWorld = mgr.getAllWorlds()[0];
result = await mgr.deleteWorld(targetWorld.id);
assertTrue(result.success, 'World deletion succeeds');
assertEquals(mgr.getAllWorlds().length, beforeCount - 1, 'World count decreased by 1');

// Verify deleted world is gone
assert(!mgr.getWorld(targetWorld.id), 'Deleted world not found');

// Delete non-existent
result = await mgr.deleteWorld('nonexistent_id');
assertFalse(result.success, 'Delete of non-existent world fails');

// Delete all worlds
while (mgr.getAllWorlds().length > 0) {
  const w = mgr.getAllWorlds()[0];
  await mgr.deleteWorld(w.id);
}
assertEquals(mgr.getAllWorlds().length, 0, 'All worlds deleted successfully');
assertTrue(mgr.canCreateMore(), 'Can create more after all deleted');

// --- Test Suite 6: Selection System ---
console.log('\n--- World Selection ---');

// Reset and create fresh
storage.reset();
await mgr.init();

await mgr.createWorld('Alpha World', 100);
await mgr.createWorld('Beta World', 200);
await mgr.createWorld('Gamma World', 300);

const alpha = mgr.getAllWorlds().find(w => w.name === 'Alpha World');
const beta = mgr.getAllWorlds().find(w => w.name === 'Beta World');

// No selection initially
assertEquals(mgr.getSelectedWorld(), null, 'No world selected initially');

// Select first world
result = mgr.selectWorld(alpha.id);
assertTrue(result.success, 'Selection succeeds');
assertNotNull(result.world, 'Selected world returned');
assertEquals(mgr.getSelectedWorld().name, 'Alpha World', 'Correct world selected');

// Select non-existent
result = mgr.selectWorld('nonexistent');
assertFalse(result.success, 'Selecting non-existent fails');

// Verify lastPlayed updated
const selected = mgr.getSelectedWorld();
assert(selected.lastPlayed !== null, 'lastPlayed set on selection');
assert(selected.lastPlayed > 0, 'lastPlayed is valid timestamp');

// Switch selection
result = mgr.selectWorld(beta.id);
assertTrue(result.success, 'Re-selection succeeds');
assertEquals(mgr.getSelectedWorld().name, 'Beta World', 'Selection switched to Beta');

// Clear selection
mgr.clearSelection();
assertEquals(mgr.getSelectedWorld(), null, 'Selection cleared');

// --- Test Suite 7: Quest Progress Helpers ---
console.log('\n--- Quest Progress ---');

const questWorld = alpha;

// Initial quest progress is empty
const initialProgress = mgr.getQuestProgress(questWorld.id);
assert(initialProgress !== null, 'getQuestProgress returns object');
assertEquals(Object.keys(initialProgress).length, 0, 'Initial quest progress is empty');

// Non-existent world returns null
assertEquals(mgr.getQuestProgress('nonexistent'), null, 'Non-existent world returns null');

// Set quest progress
assertTrue(mgr.setQuestProgress(questWorld.id, 'quest_1', { stage: 2, completed: false }), 
  'setQuestProgress succeeds');
const progress = mgr.getQuestProgress(questWorld.id);
assertNotNull(progress.quest_1, 'quest_1 progress set');
assertEquals(progress.quest_1.stage, 2, 'Quest stage correct');

// Non-existent world set returns false
assertFalse(mgr.setQuestProgress('nonexistent', 'q1', {}), 
  'setQuestProgress on non-existent fails');

// Advance quest
const freshWorld = mgr.getAllWorlds()[1]; // Beta World
mgr.setQuestProgress(freshWorld.id, 'quest_1', { stage: 0, completed: false });
assertTrue(mgr.advanceQuest(freshWorld.id, 'quest_1'), 'advanceQuest succeeds');
const advanced = mgr.getQuestProgress(freshWorld.id);
assertEquals(advanced.quest_1.stage, 1, 'Quest advanced from 0 to 1');

// Advance multiple times
for (let i = 0; i < 4; i++) {
  mgr.advanceQuest(freshWorld.id, 'quest_1');
}
const fullyAdvanced = mgr.getQuestProgress(freshWorld.id);
assertEquals(fullyAdvanced.quest_1.completed, true, 'Quest completed after 5 advances');

// Already completed quest stays completed
mgr.advanceQuest(freshWorld.id, 'quest_1');
assert(mgr.getQuestProgress(freshWorld.id).quest_1.completed, 
  'Already completed quest stays completed');

// Non-existent world advance returns false
assertFalse(mgr.advanceQuest('nonexistent', 'q1'), 'advanceQuest on non-existent fails');

// --- Test Suite 8: Chunk Reference Helpers ---
console.log('\n--- Chunk References ---');

const chunkWorld = mgr.getAllWorlds()[0]; // Alpha World

// Initially empty
assertEquals(mgr.getChunkReferences(chunkWorld.id).length, 0, 'No chunk references initially');

// Add chunk references
assertTrue(mgr.addChunkReference(chunkWorld.id, 0, 0), 'Add chunk (0,0) succeeds');
assertTrue(mgr.addChunkReference(chunkWorld.id, 1, 0), 'Add chunk (1,0) succeeds');
assertTrue(mgr.addChunkReference(chunkWorld.id, 0, 1), 'Add chunk (0,1) succeeds');
assertEquals(mgr.getChunkReferences(chunkWorld.id).length, 3, '3 chunk references added');

// Duplicate add is no-op
mgr.addChunkReference(chunkWorld.id, 0, 0);
assertEquals(mgr.getChunkReferences(chunkWorld.id).length, 3, 'Duplicate add does not increase count');

assertArrayContains(mgr.getChunkReferences(chunkWorld.id), '0_0', 'Chunk 0_0 in references');
assertArrayContains(mgr.getChunkReferences(chunkWorld.id), '1_0', 'Chunk 1_0 in references');

// Non-existent world returns empty/false
assertEquals(mgr.getChunkReferences('nonexistent').length, 0, 'Non-existent world returns empty refs');
assertFalse(mgr.addChunkReference('nonexistent', 0, 0), 
  'addChunkReference on non-existent fails');

// --- Test Suite 9: Serialization ---
console.log('\n--- Serialization ---');

const data = mgr.serialize();
assertEquals(data.length, 3, 'Serialized 3 worlds');
assertObjectHasKeys(data[0], ['id', 'name', 'seed', 'biomeMap', 'questProgress', 
  'chunkReferences', 'createdAt', 'lastPlayed'], 'Serialized data has all fields');

// Deserialize into new manager
const storage2 = new MockStorage();
const mgr2 = new WorldManager(storage2);
await mgr2.init();
mgr2.deserialize(data);
assertEquals(mgr2.getAllWorlds().length, 3, 'Deserialized 3 worlds');
assertEquals(mgr2.getAllWorlds()[0].name, data[0].name, 'Name survives round-trip');
assertEquals(mgr2.getAllWorlds()[0].seed, data[0].seed, 'Seed survives round-trip');

// Deserialize with minimal data (backwards compat)
const minimalData = [{ id: 'test1', name: 'Minimal' }];
mgr2.deserialize(minimalData);
assertEquals(mgr2.getAllWorlds()[0].seed, DEFAULT_SEED, 'Missing seed defaults to DEFAULT_SEED');
assertEquals(Object.keys(mgr2.getAllWorlds()[0].questProgress).length, 0, 'Missing questProgress defaults to {}');
assert(Array.isArray(mgr2.getAllWorlds()[0].chunkReferences), 
  'Missing chunkReferences defaults to []');

// --- Test Suite 10: World Preview ---
console.log('\n--- World Preview ---');

const preview = WorldManager.getWorldPreview(alpha);
assertNotNull(preview, 'getWorldPreview returns object');
assert(typeof preview.biomes === 'string', 'biomes is string');
assert(typeof preview.seed === 'string', 'seed is formatted string');
assert(typeof preview.chunkCount === 'number', 'chunkCount is number');
assertEquals(preview.seed.length, 8, 'Seed formatted to 8 digits');
assert(preview.biomes.includes('Plains') || preview.biomes !== '', 
  'Biome names present in preview');

// Preview with missing biomeMap
const emptyWorld = { seed: 12345 };
const emptyPreview = WorldManager.getWorldPreview(emptyWorld);
assertEquals(emptyPreview.biomes, 'Unknown', 'Missing biomeMap shows Unknown');
assertEquals(emptyPreview.chunkCount, 0, 'Missing chunkReferences shows 0');

// --- Test Suite 11: Edge Cases ---
console.log('\n--- Edge Cases ---');

// Reset for clean edge case testing
storage.reset();
mgr.worlds = []; // Clear in-memory cache
await mgr.init();

// Max length name exactly at limit
const maxName = '12345678901234567890123456789012'; // 32 chars
result = await mgr.createWorld(maxName);
assertTrue(result.success, 'Max length name accepted');

// One over max length
const overMaxName = '123456789012345678901234567890123'; // 33 chars
result = await mgr.createWorld(overMaxName);
assertFalse(result.success, 'Over-max name rejected');

// getAllWorlds returns copy
const allWorlds = mgr.getAllWorlds();
allWorlds.push({ fake: true });
assertEquals(mgr.getAllWorlds().length, allWorlds.length - 1, 
  'getAllWorlds returns independent copy');

// Concurrent create attempts (simulated) — check slot enforcement still holds
mgr.worlds = []; // Force empty for test
let createdCount = 0;
for (let i = 0; i < MAX_WORLDS + 2; i++) {
  const r = await mgr.createWorld(`Concurrent${i}`);
  if (r.success) createdCount++;
}
assertEquals(createdCount, MAX_WORLDS, 'Only MAX_WORLDS created despite extra attempts');

// Seed edge cases
const seedZero = WorldManager.formatSeed(0);
assertEquals(seedZero, '00000000', 'Seed zero formatted correctly');
const seedMax = WorldManager.generateSeed();
assert(seedMax >= 0, 'Generated seed is non-negative');

// ============================================================
// Results
// ============================================================

console.log('\n===================================');
console.log(`Results: ${passCount} passed, ${failCount} failed`);

if (failCount > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
} else {
  console.log('🎉 All world management tests passing!');
  process.exit(0);
}
})();
