#!/usr/bin/env node
/**
 * Cuubz — Character Management Integration Tests
 * Full lifecycle: create → save → reload → verify persistence.
 * Tests 3 character slots, name+color round-trip through storage,
 * inventory persistence per character, and spawn point tracking.
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
// Mock Storage Backend (simulates IndexedDB persistence layer)
// ============================================================

class MockIndexedDBStorage {
  constructor() {
    this._characters = [];
    this._worlds = [];
    this._chunks = new Map();
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

  reset() {
    this._characters = [];
    this._worlds = [];
    this._chunks.clear();
  }
}

// ============================================================
// Load Modules
// ============================================================

const { CharacterManager, MAX_CHARACTERS, DEFAULT_COLOR, CHARACTER_COLORS } = require('../js/entities/characterManager');

// ============================================================
// Integration Tests — Full character lifecycle
// ============================================================

(async function runTests() {
console.log('Cuubz — Character Management Integration Tests');
console.log('===============================================\n');

// --- Test 1: 3 Character Slots Available ---
console.log('\n--- Test 1: 3 Character Slots Available ---');

const storage = new MockIndexedDBStorage();
const mgr = new CharacterManager(storage);
await mgr.init();

assertEquals(mgr.getRemainingSlots(), 3, 'Initially 3 slots available');
assertTrue(mgr.canCreateMore(), 'Can create characters when empty');

// Create 3 characters to fill all slots
const char1 = (await mgr.createCharacter('Steve', '#FF0000')).character;
const char2 = (await mgr.createCharacter('Alex', '#00FF00')).character;
const char3 = (await mgr.createCharacter('Diamond', '#0000FF')).character;

assertNotNull(char1, 'Char 1 created');
assertNotNull(char2, 'Char 2 created');
assertNotNull(char3, 'Char 3 created');
assertEquals(mgr.getRemainingSlots(), 0, 'No slots remaining after 3 creates');
assertFalse(mgr.canCreateMore(), 'Cannot create more at max capacity');

// Verify all 3 exist in storage (simulating IndexedDB save)
const stored = await storage.loadCharacters();
assertEquals(stored.length, 3, 'All 3 characters saved to storage');

// Try creating a 4th — must fail with max reached error
const fourthResult = await mgr.createCharacter('Extra', '#FFFF00');
assertFalse(fourthResult.success, '4th character creation rejected');
assert(fourthResult.error && fourthResult.error.toLowerCase().includes('maximum'), 'Error message mentions maximum');

// --- Test 2: Name + Color Saved and Restored (Persistence Round-Trip) ---
console.log('\n--- Test 2: Name + Color Saved and Restored ---');

// Create a fresh manager to simulate page reload / reconnection
const storageReload = new MockIndexedDBStorage();
// Pre-populate storage with known characters (simulating IndexedDB data from previous session)
await storageReload.saveCharacter({
  id: 'char_persist_1',
  name: 'PersistTest',
  color: '#AB56CD',
  inventory: [],
  spawnPoints: {},
  createdAt: 1700000000000,
  lastPlayed: null,
});

const reloadMgr = new CharacterManager(storageReload);
await reloadMgr.init();

assertEquals(reloadMgr.getAllCharacters().length, 1, 'Loaded 1 character from storage');
const loadedChar = reloadMgr.getCharacter('char_persist_1');
assertNotNull(loadedChar, 'Character found after reload');
assertEquals(loadedChar.name, 'PersistTest', 'Name restored correctly from storage');
assertEquals(loadedChar.color, '#AB56CD', 'Color restored correctly from storage');

// Update and verify persistence
const updateResult = await reloadMgr.updateCharacter('char_persist_1', { name: 'UpdatedName', color: '#123456' });
assertTrue(updateResult.success, 'Update succeeds');

// Verify in storage directly (simulating IndexedDB read)
const afterUpdate = await storageReload.loadCharacters();
assertEquals(afterUpdate[0].name, 'UpdatedName', 'Name persisted to storage after update');
assertEquals(afterUpdate[0].color, '#123456', 'Color persisted to storage after update');

// Simulate full page reload: create new manager from same storage
const postReloadMgr = new CharacterManager(storageReload);
await postReloadMgr.init();
const postReloadChar = postReloadMgr.getCharacter('char_persist_1');
assertEquals(postReloadChar.name, 'UpdatedName', 'Name survives full reload cycle');
assertEquals(postReloadChar.color, '#123456', 'Color survives full reload cycle');

// --- Test 3: Inventory Persists Per Character ---
console.log('\n--- Test 3: Inventory Persists Per Character ---');

const invStorage = new MockIndexedDBStorage();
const invMgr = new CharacterManager(invStorage);
await invMgr.init();

// Create two characters with distinct inventories
const charA = (await invMgr.createCharacter('Miner', '#FF6600')).character;
const charB = (await invMgr.createCharacter('Builder', '#0099FF')).character;

// Set different inventories for each character
const minerInv = [
  { typeId: 3, count: 64 },  // Stone
  { typeId: 18, count: 12 }, // Coal Ore
  { typeId: 24, count: 5 },  // Apples
];
const builderInv = [
  { typeId: 7, count: 32 },  // Wood Log
  { typeId: 12, count: 64 }, // Planks
  { typeId: 23, count: 2 },  // Beds
];

assertTrue(invMgr.setInventory(charA.id, minerInv), 'Set Miner inventory');
assertTrue(invMgr.setInventory(charB.id, builderInv), 'Set Builder inventory');

// Verify each character has their own inventory
assertEquals(invMgr.getInventory(charA.id).length, 3, 'Miner has 3 inventory items');
assertEquals(invMgr.getInventory(charB.id).length, 3, 'Builder has 3 inventory items');
assertEquals(invMgr.getInventory(charA.id)[0].typeId, 3, 'Miner first item is stone (not builder\'s wood)');
assertEquals(invMgr.getInventory(charB.id)[0].typeId, 7, 'Builder first item is wood log (not miner\'s stone)');

// Verify inventories don't cross-contaminate
const minerStone = invMgr.getInventory(charA.id).find(i => i.typeId === 3);
const builderStone = invMgr.getInventory(charB.id).find(i => i.typeId === 3);
assertNotNull(minerStone, 'Miner has stone');
assertEquals(builderStone, undefined, 'Builder does NOT have miner\'s stone');

// Simulate save → reload cycle for inventory persistence
// Save current state to storage via serialization
const serialized = invMgr.serialize();
await Promise.all(serialized.map(c => invStorage.saveCharacter(c)));

// Create fresh manager from storage (simulates page reload)
const invReloadMgr = new CharacterManager(invStorage);
await invReloadMgr.init();

const reloadedMiner = invReloadMgr.getCharacter(charA.id);
assertNotNull(reloadedMiner, 'Miner found after reload');
assertEquals(reloadedMiner.inventory.length, 3, 'Miner inventory survives reload (3 items)');
assertEquals(reloadedMiner.inventory[0].typeId, 3, 'Miner stone preserved across reload');
assertEquals(reloadedMiner.inventory[1].typeId, 18, 'Miner coal ore preserved across reload');
assertEquals(reloadedMiner.inventory[2].typeId, 24, 'Miner apples preserved across reload');

const reloadedBuilder = invReloadMgr.getCharacter(charB.id);
assertNotNull(reloadedBuilder, 'Builder found after reload');
assertEquals(reloadedBuilder.inventory.length, 3, 'Builder inventory survives reload (3 items)');
assertEquals(reloadedBuilder.inventory[0].typeId, 7, 'Builder wood preserved across reload');
assertEquals(reloadedBuilder.inventory[1].typeId, 12, 'Builder planks preserved across reload');

// --- Test 4: Spawn Points Persist Per Character Per World ---
console.log('\n--- Test 4: Spawn Points Persist Per Character Per World ---');

const spawnMgr = new CharacterManager(new MockIndexedDBStorage());
await spawnMgr.init();

const player1 = (await spawnMgr.createCharacter('Explorer', '#FF0000')).character;
const player2 = (await spawnMgr.createCharacter('Scout', '#00FF00')).character;

// Set different spawn points for each character in different worlds
assertTrue(spawnMgr.setSpawnPoint(player1.id, 'world_alphas', { x: 64, y: 50, z: -32 }), 'Set Explorer spawn');
assertTrue(spawnMgr.setSpawnPoint(player1.id, 'world_betab', { x: 100, y: 75, z: 200 }), 'Set Explorer spawn in world2');
assertTrue(spawnMgr.setSpawnPoint(player2.id, 'world_alphas', { x: -48, y: 60, z: 96 }), 'Set Scout spawn');

// Verify per-character, per-world isolation
const eSpawn1 = spawnMgr.getSpawnPoint(player1.id, 'world_alphas');
assertNotNull(eSpawn1, 'Explorer has spawn in world_alphas');
assertEquals(eSpawn1.x, 64, 'Explorer spawn X correct');
assertEquals(eSpawn1.y, 50, 'Explorer spawn Y correct');

const sSpawn1 = spawnMgr.getSpawnPoint(player2.id, 'world_alphas');
assertNotNull(sSpawn1, 'Scout has spawn in world_alphas');
assertEquals(sSpawn1.x, -48, 'Scout spawn X different from Explorer');

// Scout has no spawn in world_betab
assertEquals(spawnMgr.getSpawnPoint(player2.id, 'world_betab'), null, 'Scout has no spawn in unknown world');

// Save and reload to verify spawn persistence
const spawnData = spawnMgr.serialize();
await Promise.all(spawnData.map(c => spawnMgr.storage.saveCharacter(c)));

const spawnReload = new CharacterManager(spawnMgr.storage);
await spawnReload.init();

const reloadedExplorer = spawnReload.getCharacter(player1.id);
assertEquals(reloadedExplorer.spawnPoints['world_alphas'].x, 64, 'Explorer spawn X persists after reload');
assertEquals(reloadedExplorer.spawnPoints['world_betab'].y, 75, 'Explorer second world spawn Y persists');

const reloadedScout = spawnReload.getCharacter(player2.id);
assertEquals(reloadedScout.spawnPoints['world_alphas'].z, 96, 'Scout spawn Z persists after reload');

// --- Test 5: Full Character CRUD Lifecycle ---
console.log('\n--- Test 5: Full CRUD Lifecycle ---');

const crudStorage = new MockIndexedDBStorage();
const crudMgr = new CharacterManager(crudStorage);
await crudMgr.init();

// CREATE
const c1 = (await crudMgr.createCharacter('CRUDTest', '#FF0000')).character;
assertNotNull(c1, 'CREATE: character created');
assertEquals(crudMgr.getAllCharacters().length, 1, 'CREATE: 1 character exists');

// READ
const readChar = crudMgr.getCharacter(c1.id);
assertEquals(readChar.name, 'CRUDTest', 'READ: name correct');
assertEquals(readChar.color, '#FF0000', 'READ: color correct');

// UPDATE — change name and color
const updateRes = await crudMgr.updateCharacter(c1.id, { name: 'UpdatedCRUD', color: '#00FF00' });
assertTrue(updateRes.success, 'UPDATE: succeeds');
assertEquals(crudMgr.getCharacter(c1.id).name, 'UpdatedCRUD', 'UPDATE: name changed');
assertEquals(crudMgr.getCharacter(c1.id).color, '#00FF00', 'UPDATE: color changed');

// Verify update persisted to storage
const storedAfterUpdate = await crudStorage.loadCharacters();
assertEquals(storedAfterUpdate[0].name, 'UpdatedCRUD', 'UPDATE: name in storage matches');

// DELETE
const deleteRes = await crudMgr.deleteCharacter(c1.id);
assertTrue(deleteRes.success, 'DELETE: succeeds');
assertEquals(crudMgr.getAllCharacters().length, 0, 'DELETE: character count is 0');
assertEquals(crudMgr.getCharacter(c1.id), null, 'DELETE: character no longer found');

// Verify storage cleanup
const storedAfterDelete = await crudStorage.loadCharacters();
assertEquals(storedAfterDelete.length, 0, 'DELETE: storage also cleared');

// --- Test 6: Selection and lastPlayed Tracking ---
console.log('\n--- Test 6: Selection and lastPlayed Tracking ---');

const selStorage = new MockIndexedDBStorage();
const selMgr = new CharacterManager(selStorage);
await selMgr.init();

const s1 = (await selMgr.createCharacter('SelA', '#FF0000')).character;
const s2 = (await selMgr.createCharacter('SelB', '#00FF00')).character;
const s3 = (await selMgr.createCharacter('SelC', '#0000FF')).character;

// No initial selection
assertEquals(selMgr.getSelectedCharacter(), null, 'No character selected initially');

// Select first
const sel1 = selMgr.selectCharacter(s1.id);
assertTrue(sel1.success, 'Select A succeeds');
assertEquals(selMgr.getSelectedCharacter().name, 'SelA', 'SelA is selected');

// Verify lastPlayed updated
assert(s1.lastPlayed !== null, 'lastPlayed set on selection');
assert(typeof s1.lastPlayed === 'number' && s1.lastPlayed > 0, 'lastPlayed is valid timestamp');

// Switch to second
const sel2 = selMgr.selectCharacter(s2.id);
assertTrue(sel2.success, 'Switch to B succeeds');
assertEquals(selMgr.getSelectedCharacter().name, 'SelB', 'SelB now selected');

// Select third
selMgr.selectCharacter(s3.id);
assertEquals(selMgr.getSelectedCharacter().name, 'SelC', 'SelC now selected');

// Clear selection
selMgr.clearSelection();
assertEquals(selMgr.getSelectedCharacter(), null, 'Selection cleared returns null');

// Delete selected character clears selection — use existing char (no need to create 4th)
const selToDelete = s3; // Use existing SelC
selMgr.selectCharacter(selToDelete.id);
assertEquals(selMgr.getSelectedCharacter().name, 'SelC', 'Selected SelC for deletion test');

await selMgr.deleteCharacter(selToDelete.id);
assertEquals(selMgr.selectedId, null, 'Deleting selected character clears selection');

// --- Test 7: Duplicate Name Prevention (case-insensitive) ---
console.log('\n--- Test 7: Duplicate Name Prevention ---');

const dupStorage = new MockIndexedDBStorage();
const dupMgr = new CharacterManager(dupStorage);
await dupMgr.init();

await dupMgr.createCharacter('UniqueName', '#FF0000');

// Same name, different case — should fail
const dup1 = await dupMgr.createCharacter('uniquename', '#00FF00');
assertFalse(dup1.success, 'Lowercase duplicate rejected');
assert(dup1.error && dup1.error.toLowerCase().includes('already exists'), 'Error mentions existing character');

// Same name with extra spaces — should fail (trimming)
const dup2 = await dupMgr.createCharacter('  UniqueName  ', '#0000FF');
assertFalse(dup2.success, 'Whitespace-padded duplicate rejected');

// Update to another character's name — should fail
const charX = (await dupMgr.createCharacter('OtherChar', '#FFFF00')).character;
const updateDup = await dupMgr.updateCharacter(charX.id, { name: 'UniqueName' });
assertFalse(updateDup.success, 'Update to duplicate name rejected');

// --- Test 8: Name Trimming and Validation ---
console.log('\n--- Test 8: Name Trimming and Validation ---');

const trimStorage = new MockIndexedDBStorage();
const trimMgr = new CharacterManager(trimStorage);
await trimMgr.init();

// Leading/trailing whitespace trimmed
const trimRes = await trimMgr.createCharacter('  TrimmedName  ', '#FF0000');
assertTrue(trimRes.success, 'Whitespace-padded name accepted');
assertEquals(trimRes.character.name, 'TrimmedName', 'Name trimmed on creation');

// Hyphens and underscores allowed
const special1 = await trimMgr.createCharacter('test-name_42', '#00FF00');
assertTrue(special1.success, 'Hyphen and underscore in name accepted');

// Spaces within name allowed
const spaceRes = await trimMgr.createCharacter('Player One', '#0000FF');
assertTrue(spaceRes.success, 'Space within name accepted');

// Special characters rejected
const badRes = await trimMgr.createCharacter('test@name!', '#FFFF00');
assertFalse(badRes.success, '@ and ! in name rejected');

// --- Test 9: Color Normalization ---
console.log('\n--- Test 9: Color Normalization ---');

const colorStorage = new MockIndexedDBStorage();
const colorMgr = new CharacterManager(colorStorage);
await colorMgr.init();

// Lowercase hex → uppercase stored
const lcRes = await colorMgr.createCharacter('ColorTest', '#aabbcc');
assertTrue(lcRes.success, 'Lowercase hex accepted');
assertEquals(lcRes.character.color, '#AABBCC', 'Color normalized to uppercase');

// Default color when not provided
const defaultRes = await colorMgr.createCharacter('DefaultColorChar');
assertTrue(defaultRes.success, 'No color → default used');
assertEquals(defaultRes.character.color, DEFAULT_COLOR, 'Default color applied');

// Invalid color rejected
const badColor = await colorMgr.createCharacter('BadColor', 'not-a-color');
assertFalse(badColor.success, 'Invalid color format rejected');

// --- Test 10: Serialization Round-Trip with Full Data ---
console.log('\n--- Test 10: Serialization Round-Trip ---');

const serStorage = new MockIndexedDBStorage();
const serMgr = new CharacterManager(serStorage);
await serMgr.init();

// Create character with inventory and spawn points
const fullChar = (await serMgr.createCharacter('FullData', '#AABBCC')).character;
serMgr.setInventory(fullChar.id, [{ typeId: 1, count: 64 }, { typeId: 24, count: 5 }]);
serMgr.setSpawnPoint(fullChar.id, 'world_test', { x: 0, y: 64, z: 0 });

// Serialize
const serData = serMgr.serialize();
assertEquals(serData.length, 1, 'Serialized 1 character');
assertEquals(serData[0].name, 'FullData', 'Name in serialization');
assertEquals(serData[0].color, '#AABBCC', 'Color in serialization');
assertArrayLength(serData[0].inventory, 2, 'Inventory serialized (2 items)');
assert(serData[0].spawnPoints['world_test'] !== undefined, 'Spawn point in serialization');

// Deserialize into fresh manager
const deserMgr = new CharacterManager(new MockIndexedDBStorage());
await deserMgr.init();
deserMgr.deserialize(serData);

const deserChar = deserMgr.getAllCharacters()[0];
assertEquals(deserChar.name, 'FullData', 'Name after deserialization');
assertEquals(deserChar.color, '#AABBCC', 'Color after deserialization');
assertArrayLength(deserChar.inventory, 2, 'Inventory after deserialization');
assertEquals(deserChar.spawnPoints['world_test'].x, 0, 'Spawn point after deserialization');

// --- Test 11: getAllCharacters Returns Copy (Immutability) ---
console.log('\n--- Test 11: Immutability Guarantees ---');

const immutStorage = new MockIndexedDBStorage();
const immutMgr = new CharacterManager(immutStorage);
await immutMgr.init();
await immutMgr.createCharacter('Immutable', '#FF0000');

// Mutating returned array shouldn't affect internal state
const arr = immutMgr.getAllCharacters();
arr.push({ fake: true });
assertEquals(immutMgr.getAllCharacters().length, 1, 'Push on returned array does not affect manager');
arr.pop(); // cleanup

// Mutating returned inventory copy shouldn't affect stored data
const charImmutable = immutMgr.getAllCharacters()[0];
immutMgr.setInventory(charImmutable.id, [{ typeId: 1, count: 10 }]);
const invCopy = immutMgr.getInventory(charImmutable.id);
invCopy.push({ typeId: 2, count: 1 }); // Mutate the copy
assertEquals(immutMgr.getInventory(charImmutable.id).length, 1, 'Push on inventory copy does not affect stored data');

// --- Test 12: Edge Cases ---
console.log('\n--- Test 12: Edge Cases ---');

const edgeStorage = new MockIndexedDBStorage();
const edgeMgr = new CharacterManager(edgeStorage);
await edgeMgr.init();

// Min length name (1 character)
const minName = await edgeMgr.createCharacter('A', '#FF0000');
assertTrue(minName.success, '1-character name accepted');

// Max length name (16 characters)
const maxName = await edgeMgr.createCharacter('1234567890ABCDEF', '#00FF00');
assertTrue(maxName.success, '16-character name accepted');

// 17 characters rejected
const overMax = await edgeMgr.createCharacter('1234567890ABCDEFG', '#0000FF');
assertFalse(overMax.success, '17-character name rejected');

// Non-existent character operations
assertEquals(edgeMgr.getCharacter('nonexistent'), null, 'getCharacter returns null for unknown ID');
assertFalse(edgeMgr.setInventory('nonexistent', []), 'setInventory returns false for unknown ID');
assertEquals(edgeMgr.getInventory('nonexistent'), null, 'getInventory returns null for unknown ID');
assertFalse(edgeMgr.setSpawnPoint('nonexistent', 'w1', {}), 'setSpawnPoint returns false for unknown ID');

// Update non-existent
const badUpdate = await edgeMgr.updateCharacter('nonexistent', { name: 'X' });
assertFalse(badUpdate.success, 'Update non-existent character fails');

// Delete non-existent
const badDelete = await edgeMgr.deleteCharacter('nonexistent');
assertFalse(badDelete.success, 'Delete non-existent character fails');

// Select non-existent
const badSelect = edgeMgr.selectCharacter('nonexistent');
assertFalse(badSelect.success, 'Select non-existent character fails');

// ============================================================
// Results
// ============================================================

console.log('\n===============================================');
console.log(`Results: ${passCount} passed, ${failCount} failed`);

if (failCount > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
} else {
  console.log('🎉 All character management integration tests passing!');
  process.exit(0);
}
})();
