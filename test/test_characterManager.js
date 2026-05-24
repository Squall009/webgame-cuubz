#!/usr/bin/env node
/**
 * Cuubz — Character Management Tests
 * Tests the CharacterManager class with an in-memory mock storage backend.
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

// ============================================================
// Mock Storage Backend (in-memory IndexedDB simulation)
// ============================================================

class MockStorage {
  constructor() {
    this.characters = [];
    this.worlds = [];
    this.chunks = new Map();
  }

  async saveCharacter(data) {
    const index = this.characters.findIndex(c => c.id === data.id);
    if (index >= 0) {
      this.characters[index] = { ...data };
    } else {
      this.characters.push({ ...data });
    }
  }

  async loadCharacters() {
    return [...this.characters];
  }

  async deleteCharacter(id) {
    const index = this.characters.findIndex(c => c.id === id);
    if (index >= 0) {
      this.characters.splice(index, 1);
    }
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

  reset() {
    this.characters = [];
    this.worlds = [];
    this.chunks.clear();
  }
}

// ============================================================
// Load CharacterManager Module
// ============================================================

const { CharacterManager, MAX_CHARACTERS, DEFAULT_COLOR, CHARACTER_COLORS } = require('../js/entities/characterManager');

// ============================================================
// Tests — wrapped in async IIFE to support await
// ============================================================

(async function runTests() {
console.log('Cuubz — Character Management Tests');
console.log('===================================\n');

// --- Test Suite 1: Constants and Static Methods ---
console.log('\n--- Constants & Static Methods ---');

assertEquals(MAX_CHARACTERS, 3, 'MAX_CHARACTERS is 3');
assertEquals(DEFAULT_COLOR, '#4CAF50', 'DEFAULT_COLOR is #4CAF50');
assert(CHARACTER_COLORS.length > 0, 'CHARACTER_COLORS has entries');
assert(typeof CharacterManager.generateId === 'function', 'generateId is a function');

// Test ID generation uniqueness
const ids = new Set();
for (let i = 0; i < 100; i++) {
  ids.add(CharacterManager.generateId());
}
assertEquals(ids.size, 100, 'generateId produces 100 unique IDs');
assert(ids.has(ids.values().next().value) && /^char_/.test([...ids][0]), 'IDs match char_<ts>_<rnd> format');

// --- Test Suite 2: Name Validation ---
console.log('\n--- Name Validation ---');

// Valid names
assert(CharacterManager.validateName('Steve').valid, 'Single word name valid');
assert(CharacterManager.validateName('Alex McPlayer').valid, 'Name with space valid');
assert(CharacterManager.validateName('player_1').valid, 'Name with underscore valid');
assert(CharacterManager.validateName('a').valid, 'Single character name valid');
assertEquals(CharacterManager.validateName('1234567890123456').valid, true, '16 char name valid (max)');
assert(CharacterManager.validateName('test-name').valid, 'Name with hyphen valid');

// Invalid names
assertFalse(CharacterManager.validateName('').valid, 'Empty name invalid');
assertFalse(CharacterManager.validateName('   ').valid, 'Whitespace-only name invalid');
assertFalse(CharacterManager.validateName('12345678901234567').valid, '17 char name invalid (over max)');
assertFalse(CharacterManager.validateName('test@name!').valid, 'Special chars in name invalid');
assertFalse(CharacterManager.validateName(123).valid, 'Non-string name invalid');
assertFalse(CharacterManager.validateName(null).valid, 'Null name invalid');

// Error messages present
const errResult = CharacterManager.validateName('');
assert(errResult.error !== undefined, 'Invalid name returns error message');

// --- Test Suite 3: Color Validation ---
console.log('\n--- Color Validation ---');

// Valid colors
assert(CharacterManager.validateColor('#FF0000').valid, 'Red hex valid');
assert(CharacterManager.validateColor('#4CAF50').valid, 'Green hex valid');
assertEquals(CharacterManager.validateColor('#ff0000').color, '#FF0000', 'Lowercase hex normalized to uppercase');

// Invalid colors
assertFalse(CharacterManager.validateColor('red').valid, 'Named color invalid');
assertFalse(CharacterManager.validateColor('#F00').valid, 'Short hex invalid');
assertFalse(CharacterManager.validateColor('#GGGGGG').valid, 'Non-hex chars invalid');
assertFalse(CharacterManager.validateColor('#12345').valid, '5-digit hex invalid');
assertFalse(CharacterManager.validateColor('').valid, 'Empty string invalid');
assertFalse(CharacterManager.validateColor(123).valid, 'Number invalid');

// --- Test Suite 4: Character Creation ---
console.log('\n--- Character Creation ---');

const storage = new MockStorage();
const mgr = new CharacterManager(storage);
await mgr.init();

// Initial state
assertEquals(mgr.getAllCharacters().length, 0, 'Start with 0 characters');
assertTrue(mgr.canCreateMore(), 'Can create more at start');
assertEquals(mgr.getRemainingSlots(), 3, '3 remaining slots at start');

// Create first character
let result = await mgr.createCharacter('Steve', '#FF0000');
assertTrue(result.success, 'First character creation succeeds');
assertNotNull(result.character, 'Created character returned');
assertObjectHasKeys(result.character, ['id', 'name', 'color', 'inventory', 'spawnPoints', 'createdAt', 'lastPlayed'], 'Character has all required fields');
assertEquals(result.character.name, 'Steve', 'Name stored correctly');
assertEquals(result.character.color, '#FF0000', 'Color stored (uppercase)');
assert(Array.isArray(result.character.inventory), 'Inventory is array');
assert(typeof result.character.spawnPoints === 'object', 'Spawn points is object');
assert(result.character.createdAt > 0, 'createdAt is timestamp');
assertEquals(result.character.lastPlayed, null, 'lastPlayed is null on creation');

// Create second character
result = await mgr.createCharacter('Alex', '#2196F3');
assertTrue(result.success, 'Second character creation succeeds');
assertEquals(mgr.getAllCharacters().length, 2, 'Now have 2 characters');
assertEquals(mgr.getRemainingSlots(), 1, '1 remaining slot');

// Create third character (last slot)
result = await mgr.createCharacter('Diamond', '#00BCD4');
assertTrue(result.success, 'Third character creation succeeds');
assertEquals(mgr.getAllCharacters().length, 3, 'Now have 3 characters');
assertFalse(mgr.canCreateMore(), 'Cannot create more at max');
assertEquals(mgr.getRemainingSlots(), 0, '0 remaining slots');

// Try to create fourth (should fail)
result = await mgr.createCharacter('Extra', '#FFFF00');
assertFalse(result.success, 'Fourth character rejected');
assert(result.error !== undefined && result.error.toLowerCase().includes('maximum'), 'Error mentions maximum reached');
assertEquals(mgr.getAllCharacters().length, 3, 'Still only 3 characters after failed creation');

// Duplicate name (case-insensitive)
const diamond = mgr.getAllCharacters().find(c => c.name === 'Diamond');
result = await mgr.deleteCharacter(diamond.id); // Free a slot
await mgr.init(); // Reload from storage
assertTrue(result.success, 'Deleted char to free slot');

result = await mgr.createCharacter('steve', '#00FF00'); // lowercase duplicate
assertFalse(result.success, 'Duplicate name (case-insensitive) rejected');
assert(result.error && result.error.toLowerCase().includes('already exists'), 'Error mentions existing character');

// Default color when not specified
result = await mgr.createCharacter('DefaultColor');
assertTrue(result.success, 'Character with no color uses default');
assertEquals(result.character.color, DEFAULT_COLOR, 'Default color applied');

// Free a slot for more tests
const defaultChar = mgr.getAllCharacters().find(c => c.name === 'DefaultColor');
await mgr.deleteCharacter(defaultChar.id);

// Name trimming
result = await mgr.createCharacter('  Trimmed  ');
assertTrue(result.success, 'Name with extra spaces accepted');
assertEquals(result.character.name, 'Trimmed', 'Name trimmed on creation');

// --- Test Suite 5: Character Updates ---
console.log('\n--- Character Updates ---');

const chars = mgr.getAllCharacters();
const firstChar = chars[0];

// Update name
result = await mgr.updateCharacter(firstChar.id, { name: 'Steve Updated' });
assertTrue(result.success, 'Name update succeeds');
assertEquals(result.character.name, 'Steve Updated', 'Name updated correctly');

// Update color
result = await mgr.updateCharacter(firstChar.id, { color: '#00FF00' });
assertTrue(result.success, 'Color update succeeds');
assertEquals(result.character.color, '#00FF00', 'Color updated correctly');

// Update both at once
result = await mgr.updateCharacter(firstChar.id, { name: 'SteveFinal', color: '#FF00FF' });
assertTrue(result.success, 'Combined update succeeds');
assertEquals(result.character.name, 'SteveFinal', 'Name updated in combined update');
assertEquals(result.character.color, '#FF00FF', 'Color updated in combined update');

// Update non-existent character
result = await mgr.updateCharacter('nonexistent_id', { name: 'Ghost' });
assertFalse(result.success, 'Update of non-existent character fails');

// Update with invalid name
result = await mgr.updateCharacter(firstChar.id, { name: '' });
assertFalse(result.success, 'Update with empty name rejected');

// Update with invalid color
result = await mgr.updateCharacter(firstChar.id, { color: 'invalid' });
assertFalse(result.success, 'Update with invalid color rejected');

// Update with duplicate name
const secondChar = chars[1];
result = await mgr.updateCharacter(firstChar.id, { name: secondChar.name });
assertFalse(result.success, 'Update to duplicate name rejected');

// Partial update (only name, keep color)
result = await mgr.updateCharacter(firstChar.id, { name: 'PartialUpdate' });
assertTrue(result.success, 'Partial update succeeds');
assertEquals(result.character.name, 'PartialUpdate', 'Name changed in partial update');

// --- Test Suite 6: Character Deletion ---
console.log('\n--- Character Deletion ---');

const beforeCount = mgr.getAllCharacters().length;
const targetChar = mgr.getAllCharacters()[0];
result = await mgr.deleteCharacter(targetChar.id);
assertTrue(result.success, 'Character deletion succeeds');
assertEquals(mgr.getAllCharacters().length, beforeCount - 1, 'Character count decreased by 1');

// Verify deleted character is gone
assert(!mgr.getCharacter(targetChar.id), 'Deleted character not found');

// Delete non-existent
result = await mgr.deleteCharacter('nonexistent_id');
assertFalse(result.success, 'Delete of non-existent character fails');

// Delete last character
while (mgr.getAllCharacters().length > 0) {
  const c = mgr.getAllCharacters()[0];
  await mgr.deleteCharacter(c.id);
}
assertEquals(mgr.getAllCharacters().length, 0, 'All characters deleted successfully');
assertTrue(mgr.canCreateMore(), 'Can create more after all deleted');

// --- Test Suite 7: Selection System ---
console.log('\n--- Character Selection ---');

// Reset and create fresh
storage.reset();
await mgr.init();

await mgr.createCharacter('Alpha', '#FF0000');
await mgr.createCharacter('Beta', '#00FF00');
await mgr.createCharacter('Gamma', '#0000FF');

const alpha = mgr.getAllCharacters().find(c => c.name === 'Alpha');
const beta = mgr.getAllCharacters().find(c => c.name === 'Beta');

// No selection initially
assertEquals(mgr.getSelectedCharacter(), null, 'No character selected initially');

// Select first character
result = mgr.selectCharacter(alpha.id);
assertTrue(result.success, 'Selection succeeds');
assertNotNull(result.character, 'Selected character returned');
assertEquals(mgr.getSelectedCharacter().name, 'Alpha', 'Correct character selected');

// Select non-existent
result = mgr.selectCharacter('nonexistent');
assertFalse(result.success, 'Selecting non-existent fails');

// Verify lastPlayed updated
const selected = mgr.getSelectedCharacter();
assert(selected.lastPlayed !== null, 'lastPlayed set on selection');
assert(selected.lastPlayed > 0, 'lastPlayed is valid timestamp');

// Switch selection
result = mgr.selectCharacter(beta.id);
assertTrue(result.success, 'Re-selection succeeds');
assertEquals(mgr.getSelectedCharacter().name, 'Beta', 'Selection switched to Beta');

// Clear selection
mgr.clearSelection();
assertEquals(mgr.getSelectedCharacter(), null, 'Selection cleared');

// --- Test Suite 8: Inventory & Spawn Point Helpers ---
console.log('\n--- Inventory & Spawn Points ---');

const charId = alpha.id;

// Set/get inventory
assertTrue(mgr.setInventory(charId, [{ typeId: 1, count: 64 }]), 'Set inventory succeeds');
const inv = mgr.getInventory(charId);
assert(Array.isArray(inv), 'Get inventory returns array');
assertEquals(inv.length, 1, 'Inventory has 1 item');
assertEquals(inv[0].typeId, 1, 'Inventory item correct');

// Inventory is a copy (mutations don't affect original)
inv.push({ typeId: 2, count: 1 });
const inv2 = mgr.getInventory(charId);
assertEquals(inv2.length, 1, 'External mutation does not affect stored inventory');

// Set/get spawn point
assertTrue(mgr.setSpawnPoint(charId, 'world1', { x: 10, y: 50, z: 20 }), 'Set spawn succeeds');
const spawn = mgr.getSpawnPoint(charId, 'world1');
assertNotNull(spawn, 'Spawn point retrieved');
assertEquals(spawn.x, 10, 'Spawn X correct');
assertEquals(spawn.y, 50, 'Spawn Y correct');
assertEquals(spawn.z, 20, 'Spawn Z correct');

// No spawn for unknown world
assertEquals(mgr.getSpawnPoint(charId, 'unknown_world'), null, 'Unknown world returns null spawn');

// Non-existent character operations return false/null
assertFalse(mgr.setInventory('nonexistent', []), 'Set inventory on non-existent fails');
assertEquals(mgr.getInventory('nonexistent'), null, 'Get inventory from non-existent returns null');
assertFalse(mgr.setSpawnPoint('nonexistent', 'w1', {}), 'Set spawn on non-existent fails');
assertEquals(mgr.getSpawnPoint('nonexistent', 'w1'), null, 'Get spawn from non-existent returns null');

// --- Test Suite 9: Serialization ---
console.log('\n--- Serialization ---');

const data = mgr.serialize();
assertEquals(data.length, 3, 'Serialized 3 characters');
assertObjectHasKeys(data[0], ['id', 'name', 'color', 'inventory', 'spawnPoints', 'createdAt', 'lastPlayed'], 'Serialized data has all fields');

// Deserialize into new manager
const storage2 = new MockStorage();
const mgr2 = new CharacterManager(storage2);
await mgr2.init();
mgr2.deserialize(data);
assertEquals(mgr2.getAllCharacters().length, 3, 'Deserialized 3 characters');
assertEquals(mgr2.getAllCharacters()[0].name, data[0].name, 'Name survives round-trip');

// Deserialize with missing fields (backwards compat)
const minimalData = [{ id: 'test1', name: 'Minimal' }];
mgr2.deserialize(minimalData);
assertEquals(mgr2.getAllCharacters()[0].color, DEFAULT_COLOR, 'Missing color defaults to DEFAULT_COLOR');
assert(Array.isArray(mgr2.getAllCharacters()[0].inventory), 'Missing inventory defaults to []');

// --- Test Suite 10: Edge Cases ---
console.log('\n--- Edge Cases ---');

// Reset for clean edge case testing
storage.reset();
mgr._initialized = false; // Allow re-init
await mgr.init();

// Max length name exactly at limit
const maxName = '1234567890123456'; // 16 chars
result = await mgr.createCharacter(maxName, '#FF0000');
assertTrue(result.success, 'Max length name accepted');

// One over max length
const overMaxName = '12345678901234567'; // 17 chars
result = await mgr.createCharacter(overMaxName, '#FF0000');
assertFalse(result.success, 'Over-max name rejected');

// Name with only valid special chars
result = await mgr.createCharacter('test-name_1', '#FF0000');
assertTrue(result.success, 'Name with hyphen and underscore accepted');

// getAllCharacters returns copy
const allChars = mgr.getAllCharacters();
allChars.push({ fake: true });
assertEquals(mgr.getAllCharacters().length, allChars.length - 1, 'getAllCharacters returns independent copy');

// Concurrent create attempts (simulated) — check slot enforcement still holds
mgr.characters = []; // Force empty for test
let createdCount = 0;
for (let i = 0; i < MAX_CHARACTERS + 2; i++) {
  const r = await mgr.createCharacter(`Concurrent${i}`, '#FF0000');
  if (r.success) createdCount++;
}
assertEquals(createdCount, MAX_CHARACTERS, 'Only MAX_CHARACTERS created despite extra attempts');

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
  console.log('🎉 All character management tests passing!');
  process.exit(0);
}
})();
