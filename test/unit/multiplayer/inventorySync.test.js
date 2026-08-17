/**
 * Cuubz — Inventory Sync Tests
 * Tests for js/multiplayer/inventorySync.js
 *
 * Coverage: constants, pure functions, serialization, diff computation,
 * InventorySync class lifecycle, InventoryValidator host-side validation,
 * integration flows, and edge cases.
 */

import { it } from 'vitest';
import { legacy } from '../../helpers/legacy.js';
import { NAMED_ITEMS, MAX_STACKS } from '../../../src/game/data/ItemDefinitions.js';
import { BLOCK_REGISTRY, BLOCK_TYPES } from '../../../src/engine/world/BlockRegistry.js';
import { VALID_BLOCK_IDS, VALID_NAMED_ITEMS, MAX_STACK, SINGLE_STACK_BLOCKS, DEFAULT_INVENTORY_ROWS, DEFAULT_INVENTORY_COLS, DEFAULT_TOTAL_SLOTS, getItemCategory, getMaxStackSize, isValidTypeId, validateSlot, validateInventorySlots, serializeInventory, deserializeInventory, computeInventoryDiff, applyInventoryDiff, slotsEqual, countItemInSlots, hasItemInSlots, InventorySync, InventoryValidator } from '../../../src/multiplayer/InventorySync.js';

it('inventorySync', () => legacy(async () => {
// PR 23 / BUGS.md D-64: the six constants below used to be hand-written inside
// InventorySync.js and every one of them was stale — the allowlist commented
// `1, // Grass` where the registry says `bedrock`, and a 10-entry NAMED_ITEM_META whose
// stack sizes disagreed with canonical NAMED_ITEMS for five of those ten. The
// assertions in Test Group 1 pinned that wrong data; they are rewritten below into what
// the derivation makes true, and now compare against the canonical tables directly so
// they cannot drift apart again. NAMED_ITEM_META is gone — it WAS the drift.





// ─── Mini Test Framework ──────────────────────────────────────

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

function assertTrue(condition, message) {
  assert(condition === true, message);
}

function assertFalse(condition, message) {
  assert(condition === false, message);
}

function assertNotNull(value, message) {
  assert(value !== null && value !== undefined, message);
}

function assertDeepEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  assert(a === b, `${message}: expected ${b}, got ${a}`);
}

// ─── Tests ──────────────────────────────────────────────────────

console.log('Inventory Sync Tests');
console.log('====================\n');

// ============================================================
// Test Group 1: Constants
// ============================================================

console.log('[Constants]');

// VALID_BLOCK_IDS — derived from BLOCK_REGISTRY, so it IS the registry.
// WAS: `size === 27` / `has(26)` / `!has(27)`, pinning a 27-entry table whose comments
// (`1, // Grass`, `3, // Stone`, `7, // Wood Log`) named blocks that are now bedrock,
// cobblestone and tuff — and which refused 166 of the registry's 193 ids.
assertEquals(VALID_BLOCK_IDS.size, BLOCK_REGISTRY.length, 'VALID_BLOCK_IDS has one entry per registry block');
assertEquals(VALID_BLOCK_IDS.size, 199, 'VALID_BLOCK_IDS has 199 entries — the registry\'s real size');
assertTrue(BLOCK_REGISTRY.every((b) => VALID_BLOCK_IDS.has(b.id)), 'every registry block id is accepted');
assertTrue(VALID_BLOCK_IDS.has(0), 'Block ID 0 (Air) is valid');
assertTrue(VALID_BLOCK_IDS.has(27), 'Block ID 27 (deepslate_iron_ore) IS valid — it used to be rejected');
assertTrue(VALID_BLOCK_IDS.has(192), 'Block ID 192 (yellow_poplar_leaves) is valid');
// 193-195 are S4's three Corrupt blocks and are real now; 199 is past the end.
assertTrue(VALID_BLOCK_IDS.has(193), 'Block ID 193 is corrupt_grass and IS valid (S4)');
assertFalse(VALID_BLOCK_IDS.has(199), 'Block ID 199 is past the end of the registry and is not valid');
assertFalse(VALID_BLOCK_IDS.has(-1), 'Block ID -1 is not valid');

// VALID_NAMED_ITEMS — the canonical NAMED_ITEMS keys, all 104.
// WAS: `size === 10` and `!has('diamond_sword')`. diamond_sword is a canonical item; the
// old allowlist rejected it and 93 others.
assertEquals(VALID_NAMED_ITEMS.size, Object.keys(NAMED_ITEMS).length, 'VALID_NAMED_ITEMS === the canonical NAMED_ITEMS keys');
// 109: 104, plus the five `seal_key_*` items. One shared `quest_key` could never work
// — it is `maxStack: 1`, so a second seal's key would not fit alongside the first.
assertEquals(VALID_NAMED_ITEMS.size, 109, 'VALID_NAMED_ITEMS has 109 entries');
assertTrue(VALID_NAMED_ITEMS.has('coal'), 'coal is a valid named item');
assertTrue(VALID_NAMED_ITEMS.has('golden_apple'), 'golden_apple is a valid named item');
assertTrue(VALID_NAMED_ITEMS.has('diamond_sword'), 'diamond_sword IS defined — it used to be rejected over the wire');
assertFalse(VALID_NAMED_ITEMS.has('not_a_real_item'), 'an unknown name is still rejected');

// MAX_STACK: is the canonical table, not a copy of its values
assertTrue(MAX_STACK === MAX_STACKS, 'MAX_STACK IS the canonical MAX_STACKS object');
assertEquals(MAX_STACK.block, 64, 'Block max stack is 64');
assertEquals(MAX_STACK.resource, 64, 'Resource max stack is 64');
assertEquals(MAX_STACK.food, 16, 'Food max stack is 16');
assertEquals(MAX_STACK.tool, 1, 'Tool max stack is 1');

// The wire agrees with the canonical item table for EVERY named item — this is the
// assertion NAMED_ITEM_META's two structure checks are replaced by, and it covers all
// 104 instead of 2.
assertTrue(
  Object.keys(NAMED_ITEMS).every((k) => getMaxStackSize(k) === NAMED_ITEMS[k].maxStack),
  'getMaxStackSize agrees with canonical NAMED_ITEMS for all 109 items'
);
assertTrue(
  Object.keys(NAMED_ITEMS).every((k) => getItemCategory(k) === NAMED_ITEMS[k].category),
  'getItemCategory agrees with canonical NAMED_ITEMS for all 104 items'
);
// The five that actually disagreed, named.
assertEquals(getMaxStackSize('apple'), 64, 'apple max stack is 64 (was 16 here, 64 canonically)');
assertEquals(getMaxStackSize('cooked_meat'), 64, 'cooked_meat max stack is 64 (was 16 here)');
assertEquals(getMaxStackSize('berry'), 64, 'berry max stack is 64 (was 16 here)');
assertEquals(getMaxStackSize('bread'), 64, 'bread max stack is 64 (was 16 here)');
assertEquals(getMaxStackSize('golden_apple'), 64, 'golden_apple max stack is 64 (was 1 here)');
// And the 70 tools that fell through to `resource = 64` because they were not in the
// local table at all.
assertEquals(getMaxStackSize('diamond_sword'), 1, 'a tool stacks to 1 over the wire (it used to be 64)');
assertEquals(getItemCategory('diamond_sword'), 'tool', 'a tool is categorised `tool` (it used to be `resource`)');

// SINGLE_STACK_BLOCKS: resolved by NAME through BLOCK_TYPES.
// WAS: `new Set([22, 25, 26])` commented "Corrupt Crystal, Quest Key, Boss Spawn". Those
// ids are iron_ore, copper_ore and emerald_ore — three ordinary ores capped at 1 over the
// wire, while the two real quest items were not capped at all.
assertTrue(SINGLE_STACK_BLOCKS.has(BLOCK_TYPES.CORRUPT_CRYSTAL), 'corrupt_crystal (189) is single stack');
assertTrue(SINGLE_STACK_BLOCKS.has(BLOCK_TYPES.QUEST_KEY), 'quest_key (191) is single stack');
assertEquals(SINGLE_STACK_BLOCKS.size, 2, 'exactly the two quest items are single stack');
assertFalse(SINGLE_STACK_BLOCKS.has(22), 'id 22 is iron_ore and is NOT single stack');
assertFalse(SINGLE_STACK_BLOCKS.has(1), 'bedrock (1) is not single stack');

// DEFAULT constants
assertEquals(DEFAULT_INVENTORY_ROWS, 4, 'Default inventory rows = 4');
assertEquals(DEFAULT_INVENTORY_COLS, 9, 'Default inventory cols = 9');
assertEquals(DEFAULT_TOTAL_SLOTS, 36, 'Default total slots = 36');

console.log('');

// ============================================================
// Test Group 2: getItemCategory
// ============================================================

console.log('[getItemCategory]');

assertEquals(getItemCategory(1), 'block', 'Block ID 1 → block category');
assertEquals(getItemCategory(26), 'block', 'Block ID 26 → block category');
assertEquals(getItemCategory('coal'), 'resource', 'coal → resource category');
assertEquals(getItemCategory('apple'), 'food', 'apple → food category');
assertEquals(getItemCategory('golden_apple'), 'food', 'golden_apple → food category');
assertEquals(getItemCategory('unknown_item'), 'resource', 'Unknown string defaults to resource');

console.log('');

// ============================================================
// Test Group 3: getMaxStackSize
// ============================================================

console.log('[getMaxStackSize]');

// WAS: `getMaxStackSize(22) === 1` / `(25) === 1`, from SINGLE_STACK_BLOCKS' stale ids.
assertEquals(getMaxStackSize(1), 64, 'An ordinary block max stack = 64');
assertEquals(getMaxStackSize(22), 64, 'id 22 (iron_ore) max stack = 64 — it was capped at 1');
assertEquals(getMaxStackSize(BLOCK_TYPES.CORRUPT_CRYSTAL), 1, 'corrupt_crystal block max stack = 1');
assertEquals(getMaxStackSize(BLOCK_TYPES.QUEST_KEY), 1, 'quest_key block max stack = 1');
assertEquals(getMaxStackSize('coal'), 64, 'Coal max stack = 64');
assertEquals(getMaxStackSize('corrupt_crystal'), 1, 'Corrupt Crystal named item max stack = 1');
assertEquals(getMaxStackSize('unknown_item'), 64, 'Unknown item defaults to resource max (64)');

console.log('');

// ============================================================
// Test Group 4: isValidTypeId
// ============================================================

console.log('[isValidTypeId]');

assertTrue(isValidTypeId(0), 'Block ID 0 is valid');
assertTrue(isValidTypeId(26), 'Block ID 26 is valid');
// WAS: `assertFalse(isValidTypeId(27))` — 27 is deepslate_iron_ore, a real block the
// allowlist rejected because the hand-written table stopped at 26.
assertTrue(isValidTypeId(27), 'Block ID 27 is valid — it is deepslate_iron_ore');
assertTrue(isValidTypeId(192), 'Block ID 192 is valid — it is yellow_poplar_leaves');
assertFalse(isValidTypeId(-1), 'Block ID -1 is invalid');
assertFalse(isValidTypeId(999), 'Block ID 999 is invalid');
assertTrue(isValidTypeId(193), 'Block ID 193 is corrupt_grass and IS valid (S4)');
assertFalse(isValidTypeId(199), 'Block ID 199 is invalid — one past the last real block');

assertTrue(isValidTypeId('coal'), 'coal is valid');
assertTrue(isValidTypeId('apple'), 'apple is valid');
assertTrue(isValidTypeId('diamond_sword'), 'diamond_sword is valid — the wire used to reject every tool');
assertFalse(isValidTypeId('sword'), 'sword is invalid');
assertFalse(isValidTypeId(''), 'Empty string is invalid');

assertFalse(isValidTypeId(null), 'null is invalid');
assertFalse(isValidTypeId(undefined), 'undefined is invalid');
assertFalse(isValidTypeId(true), 'boolean is invalid');
assertFalse(isValidTypeId({}), 'object is invalid');

console.log('');

// ============================================================
// Test Group 5: validateSlot
// ============================================================

console.log('[validateSlot]');

// Valid slots
assertTrue(validateSlot(null).valid, 'Null slot is valid');
assertTrue(validateSlot(undefined).valid, 'Undefined slot is valid');
assertTrue(validateSlot({ typeId: 1, count: 1 }).valid, 'Single grass block is valid');
assertTrue(validateSlot({ typeId: 1, count: 64 }).valid, 'Stack of 64 grass is valid');
assertTrue(validateSlot({ typeId: 'apple', count: 16 }).valid, 'Stack of 16 apples is valid');
assertTrue(validateSlot({ typeId: 'coal', count: 64 }).valid, 'Stack of 64 coal is valid');

// Invalid slots
assertFalse(validateSlot({}).valid, 'Empty object is invalid (missing typeId)');
assertFalse(validateSlot({ typeId: null }).valid, 'Null typeId is invalid');
assertFalse(validateSlot({ typeId: undefined }).valid, 'Undefined typeId is invalid');
assertFalse(validateSlot({ typeId: 999 }).valid, 'Unknown block ID 999 is invalid');
assertFalse(validateSlot({ typeId: 'sword' }).valid, 'Unknown named item is invalid');
assertFalse(validateSlot({ typeId: 0, count: 1 }).valid, 'Air (block 0) cannot be stored');
assertFalse(validateSlot({ typeId: 1, count: 0 }).valid, 'Count 0 is invalid');
assertFalse(validateSlot({ typeId: 1, count: -1 }).valid, 'Negative count is invalid');
assertFalse(validateSlot({ typeId: 1, count: 65 }).valid, 'Count 65 exceeds block max stack');
// WAS: `count: 17` → invalid, from the local NAMED_ITEM_META that said apple stacks to 16.
// Canonically apple carries an explicit `maxStack: 64` that overrides MAX_STACKS.food.
assertTrue(validateSlot({ typeId: 'apple', count: 64 }).valid, 'Stack of 64 apples is valid (canonical maxStack)');
assertFalse(validateSlot({ typeId: 'apple', count: 65 }).valid, 'Apple count 65 exceeds its max stack of 64');
// WAS: `typeId: 22` — id 22 is iron_ore, not corrupt_crystal (189).
assertFalse(validateSlot({ typeId: BLOCK_TYPES.CORRUPT_CRYSTAL, count: 2 }).valid, 'Corrupt Crystal count 2 exceeds single stack');
assertTrue(validateSlot({ typeId: 22, count: 2 }).valid, 'iron_ore (22) stacks past 1 — it was wrongly capped');
assertFalse(validateSlot('string').valid, 'String slot is invalid');
assertFalse(validateSlot([1, 2]).valid, 'Array slot is invalid');

console.log('');

// ============================================================
// Test Group 6: validateInventorySlots
// ============================================================

console.log('[validateInventorySlots]');

// Valid inventories
assertTrue(validateInventorySlots([]).valid, 'Empty inventory is valid');
assertTrue(validateInventorySlots([null, null]).valid, 'All-null inventory is valid');
assertTrue(validateInventorySlots([{ typeId: 1, count: 1 }, null]).valid, 'Mixed valid/null slots');
const fullValid = [];
for (let i = 0; i < 36; i++) fullValid.push({ typeId: 1, count: 1 });
assertTrue(validateInventorySlots(fullValid).valid, 'Full inventory of valid items');

// Invalid inventories
assertFalse(validateInventorySlots('not_array').valid, 'Non-array is invalid');
assertTrue(validateInventorySlots([null]).valid === true, 'Single null slot is valid');

const invalidSlots = [{ typeId: 999, count: 1 }]; // Unknown block type (27 is a real block: deepslate_iron_ore)
const invResult1 = validateInventorySlots(invalidSlots);
assertFalse(invResult1.valid, 'Unknown block type fails validation');
assertEquals(invResult1.errors.length, 1, 'One error reported for unknown block type');

const invalidCount = [{ typeId: 1, count: 999 }];
const invResult2 = validateInventorySlots(invalidCount);
assertFalse(invResult2.valid, 'Over-max-stack count fails validation');

// Too many slots
const tooManySlots = [];
for (let i = 0; i < 100; i++) tooManySlots.push(null);
const invResult3 = validateInventorySlots(tooManySlots);
assertFalse(invResult3.valid, 'Too many slots (>72) fails validation');

console.log('');

// ============================================================
// Test Group 7: serializeInventory / deserializeInventory
// ============================================================

console.log('[Serialization]');

// Serialize plain array
const plainSlots = [null, { typeId: 1, count: 5 }, null];
const serialized = serializeInventory(plainSlots, 2);
assertNotNull(serialized.slots, 'Serialized slots exist');
assertEquals(serialized.selectedHotbarSlot, 2, 'Selected hotbar slot preserved');
assertDeepEqual(serialized.slots[1], { typeId: 1, count: 5 }, 'Slot data preserved');

// Serialize Inventory-like object
const invLike = {
  slots: [null, { typeId: 3, count: 10 }],
  selectedHotbarSlot: 4,
};
const serializedObj = serializeInventory(invLike);
assertEquals(serializedObj.selectedHotbarSlot, 4, 'Object selectedHotbarSlot preserved');

// Deserialize valid data
const deserialized = deserializeInventory({ slots: plainSlots, selectedHotbarSlot: 2 });
assertDeepEqual(deserialized.slots[1], { typeId: 1, count: 5 }, 'Deserialized slot data correct');
assertEquals(deserialized.selectedHotbarSlot, 2, 'Deserialized hotbar slot correct');

// Deserialize null/invalid
const desNull = deserializeInventory(null);
assertEquals(desNull.slots.length, 0, 'Null input returns empty slots');
assertEquals(desNull.selectedHotbarSlot, 0, 'Null input defaults hotbar to 0');

const desStr = deserializeInventory('string');
assertEquals(desStr.slots.length, 0, 'String input returns empty slots');

// Round-trip test
const original = {
  slots: [null, { typeId: 1, count: 3 }, { typeId: 'apple', count: 5 }],
  selectedHotbarSlot: 1,
};
const roundTrip = deserializeInventory(serializeInventory(original.slots, original.selectedHotbarSlot));
assertDeepEqual(roundTrip.slots, original.slots, 'Round-trip preserves slot data');
assertEquals(roundTrip.selectedHotbarSlot, original.selectedHotbarSlot, 'Round-trip preserves hotbar selection');

console.log('');

// ============================================================
// Test Group 8: slotsEqual
// ============================================================

console.log('[slotsEqual]');

assertTrue(slotsEqual(null, null), 'null === null');
assertTrue(slotsEqual({ typeId: 1, count: 5 }, { typeId: 1, count: 5 }), 'Same type and count');
assertFalse(slotsEqual(null, { typeId: 1, count: 1 }), 'null !== object');
assertFalse(slotsEqual({ typeId: 1, count: 1 }, null), 'object !== null');
assertFalse(slotsEqual({ typeId: 1, count: 5 }, { typeId: 2, count: 5 }), 'Different typeIds');
assertFalse(slotsEqual({ typeId: 1, count: 5 }, { typeId: 1, count: 3 }), 'Different counts');

console.log('');

// ============================================================
// Test Group 9: computeInventoryDiff / applyInventoryDiff
// ============================================================

console.log('[computeInventoryDiff]');

// No changes
const oldSlots = [null, { typeId: 1, count: 5 }];
const newSlotsSame = [null, { typeId: 1, count: 5 }];
assertEquals(computeInventoryDiff(oldSlots, newSlotsSame).length, 0, 'No diff when slots identical');

// Add item to empty slot
const newSlotsAdd = [null, { typeId: 1, count: 5 }, { typeId: 3, count: 1 }];
const diff1 = computeInventoryDiff(oldSlots, newSlotsAdd);
assertEquals(diff1.length, 1, 'One change when adding item');
assertEquals(diff1[0].index, 2, 'Change at index 2');
assertDeepEqual(diff1[0].newSlot, { typeId: 3, count: 1 }, 'New slot data correct');

// Remove item
const newSlotsRemove = [null, null];
const diff2 = computeInventoryDiff(oldSlots, newSlotsRemove);
assertEquals(diff2.length, 1, 'One change when removing item');
assertDeepEqual(diff2[0].oldSlot, { typeId: 1, count: 5 }, 'Old slot data captured');
assertTrue(diff2[0].newSlot === null, 'New slot is null after removal');

// Count change
const newSlotsCount = [null, { typeId: 1, count: 3 }];
const diff3 = computeInventoryDiff(oldSlots, newSlotsCount);
assertEquals(diff3.length, 1, 'One change when count differs');

// Apply diff
const baseSlots = [null, null];
const changes = [{ index: 0, oldSlot: null, newSlot: { typeId: 2, count: 1 } }];
const applied = applyInventoryDiff(baseSlots, changes);
assertDeepEqual(applied[0], { typeId: 2, count: 1 }, 'Applied change sets slot correctly');

// Apply clear diff
const clearChanges = [{ index: 0, oldSlot: { typeId: 2, count: 1 }, newSlot: null }];
const cleared = applyInventoryDiff(applied, clearChanges);
assertTrue(cleared[0] === null, 'Applied clear removes slot');

console.log('');

// ============================================================
// Test Group 10: countItemInSlots / hasItemInSlots
// ============================================================

console.log('[countItemInSlots / hasItemInSlots]');

const testSlots = [
  { typeId: 1, count: 5 },
  null,
  { typeId: 1, count: 3 },
  { typeId: 'apple', count: 2 },
];

assertEquals(countItemInSlots(testSlots, 1), 8, 'Count grass blocks: 5 + 3 = 8');
assertEquals(countItemInSlots(testSlots, 'apple'), 2, 'Count apples: 2');
assertEquals(countItemInSlots(testSlots, 3), 0, 'Count stone (not present): 0');

assertTrue(hasItemInSlots(testSlots, 1), 'Has grass blocks');
assertTrue(hasItemInSlots(testSlots, 'apple'), 'Has apples');
assertFalse(hasItemInSlots(testSlots, 3), 'Does not have stone');
assertFalse(hasItemInSlots([], 1), 'Empty inventory has nothing');

console.log('');

// ============================================================
// Test Group 11: InventorySync — Constructor & Basics
// ============================================================

console.log('[InventorySync - Constructor & Basics]');

const sync = new InventorySync(null, { playerId: 'test_player' });
assertEquals(sync._playerId, 'test_player', 'Player ID set correctly');
assertNotNull(sync.getSlots(), 'getSlots returns array');
assertEquals(sync.pendingChangesCount, 0, 'No pending changes initially');
assertFalse(sync._remoteInventories.has('anyone'), 'No remote inventories initially');

// With mock inventory
const mockInventory = {
  slots: [null, { typeId: 1, count: 3 }, null],
  selectedHotbarSlot: 0,
  totalSlots: 36,
  selectHotbarSlot: function(slot) { this.selectedHotbarSlot = slot; },
};
const syncWithInv = new InventorySync(mockInventory, { playerId: 'test2' });
assertEquals(syncWithInv.getSlots().length, 3, 'getSlots returns inventory slots');
assertDeepEqual(syncWithInv.getSlots()[1], { typeId: 1, count: 3 }, 'Slot data accessible');

console.log('');

// ============================================================
// Test Group 12: InventorySync — Join Payload
// ============================================================

console.log('[InventorySync - Join Payload]');

const joinPayload = sync.createJoinPayload();
assertEquals(joinPayload.type, 'INVENTORY_UPDATE', 'Join payload type is INVENTORY_UPDATE');
assertEquals(joinPayload.playerId, 'test_player', 'Player ID in payload');
assertNotNull(joinPayload.inventory, 'Inventory data present');
assertArrayLike(joinPayload.inventory.slots, 'Slots array present');

// With real inventory
const joinPayload2 = syncWithInv.createJoinPayload();
assertEquals(joinPayload2.type, 'INVENTORY_UPDATE', 'Join payload type correct');
assertDeepEqual(joinPayload2.inventory.slots[1], { typeId: 1, count: 3 }, 'Slot data in payload');

console.log('');

// ============================================================
// Test Group 13: InventorySync — Join Response Handling
// ============================================================

console.log('[InventorySync - Join Response]');

// Valid response
const validResponse = {
  inventory: {
    slots: [null, { typeId: 1, count: 5 }],
    selectedHotbarSlot: 1,
  },
};
let joinCompleteCalled = false;
sync.onSyncComplete = () => { joinCompleteCalled = true; };

const joinResult = sync.handleJoinResponse(validResponse);
assertTrue(joinResult === true, 'Valid join response returns true');
assertTrue(joinCompleteCalled, 'onSyncComplete callback fired');

// Invalid response from host
const invalidResponse = {
  inventory: {
    slots: [{ typeId: 999, count: 1 }], // Unknown block type
    selectedHotbarSlot: 0,
  },
};
let syncErrorCalled = false;
sync.onSyncError = () => { syncErrorCalled = true; };

const joinResult2 = sync.handleJoinResponse(invalidResponse);
assertFalse(joinResult2 === true, 'Invalid join response returns false');
assertTrue(syncErrorCalled, 'onSyncError callback fired for invalid data');

console.log('');

// ============================================================
// Test Group 14: InventorySync — Diff Payload
// ============================================================

console.log('[InventorySync - Diff Payload]');

// No previous sync — should send full inventory
const freshSync = new InventorySync(mockInventory, { playerId: 'diff_test' });
const diffPayload1 = freshSync.createDiffPayload();
assertNotNull(diffPayload1, 'First diff returns full payload (no baseline)');
assertEquals(diffPayload1.type, 'INVENTORY_UPDATE', 'Full inventory type correct');

// Establish baseline
freshSync.handleJoinResponse({
  inventory: { slots: mockInventory.slots, selectedHotbarSlot: 0 },
});

// No changes — should return null
const diffPayload2 = freshSync.createDiffPayload();
assertTrue(diffPayload2 === null, 'No changes → null payload');

// Modify inventory and check diff
mockInventory.slots[0] = { typeId: 3, count: 1 };
const diffPayload3 = freshSync.createDiffPayload();
assertNotNull(diffPayload3, 'Change detected → non-null payload');
assertNotNull(diffPayload3.changes, 'Changes array present in diff payload');
assertTrue(diffPayload3.changes.length > 0, 'At least one change detected');

console.log('');

// ============================================================
// Test Group 15: InventorySync — Periodic Sync
// ============================================================

console.log('[InventorySync - Periodic Sync]');

let syncCallbackCount = 0;
const periodicTest = new InventorySync(null, { playerId: 'periodic', syncIntervalMs: 50 });
periodicTest.startPeriodicSync(() => { syncCallbackCount++; });

// Wait for at least one tick
setTimeout(() => {
  // Stop and check
  periodicTest.stopPeriodicSync();
  assertTrue(syncCallbackCount >= 1, `Periodic sync fired ${syncCallbackCount} times`);
}, 200);

// Verify stop works
const stoppedSync = new InventorySync(null, { playerId: 'stop_test', syncIntervalMs: 50 });
stoppedSync.startPeriodicSync(() => {});
assertNotNull(stoppedSync._syncTimer, 'Timer started');
stoppedSync.stopPeriodicSync();
assertTrue(stoppedSync._syncTimer === null, 'Timer cleared after stop');

console.log('');

// ============================================================
// Test Group 16: InventorySync — Remote Inventory Tracking
// ============================================================

console.log('[InventorySync - Remote Inventory]');

const remoteTest = new InventorySync(null, { playerId: 'remote_test' });

// Apply valid remote sync
const validRemoteData = {
  slots: [null, { typeId: 1, count: 3 }, { typeId: 'coal', count: 10 }],
  selectedHotbarSlot: 2,
};
const remoteResult = remoteTest.applyRemoteSync('player_A', validRemoteData);
assertTrue(remoteResult === true, 'Valid remote sync accepted');

// Retrieve remote inventory
const remoteInv = remoteTest.getRemoteInventory('player_A');
assertNotNull(remoteInv, 'Remote inventory exists');
assertEquals(remoteInv.slots.length, 3, 'Remote slot count correct');
assertDeepEqual(remoteInv.slots[1], { typeId: 1, count: 3 }, 'Remote slot data preserved');
assertEquals(remoteInv.selectedHotbarSlot, 2, 'Remote hotbar slot preserved');

// Invalid remote sync
let invalidRemoteCalled = false;
remoteTest.onInventoryInvalid = () => { invalidRemoteCalled = true; };
const invalidRemoteResult = remoteTest.applyRemoteSync('player_B', {
  slots: [{ typeId: 999, count: 1 }],
});
assertFalse(invalidRemoteResult === true, 'Invalid remote sync rejected');
assertTrue(invalidRemoteCalled, 'onInventoryInvalid callback fired');

// Remove remote inventory
remoteTest.removeRemoteInventory('player_A');
assertTrue(remoteTest.getRemoteInventory('player_A') === null, 'Remote inventory removed');

// Remote player IDs
const ids = remoteTest.remotePlayerIds;
assertEquals(Array.isArray(ids), true, 'remotePlayerIds returns array');

console.log('');

// ============================================================
// Test Group 17: InventorySync — Save/Restore
// ============================================================

console.log('[InventorySync - Save/Restore]');

const saveTest = new InventorySync(mockInventory, { playerId: 'save_test' });

// Create save payload
const savePayload = saveTest.createSavePayload();
assertNotNull(savePayload.slots, 'Save payload has slots');
assertEquals(typeof savePayload.selectedHotbarSlot, 'number', 'Save payload has hotbar slot');

// Restore from valid save
const restoreSync = new InventorySync(null, { playerId: 'restore_test' });
const restoreResult = restoreSync.restoreFromSave(savePayload);
assertTrue(restoreResult === true, 'Valid save restores successfully');

// Restore from invalid save
let restoreErrorCalled = false;
restoreSync.onSyncError = () => { restoreErrorCalled = true; };
const badRestore = restoreSync.restoreFromSave({ slots: [{ typeId: 999 }] });
assertFalse(badRestore === true, 'Invalid save rejected');
assertTrue(restoreErrorCalled, 'onSyncError fired for invalid save');

// Restore from null
const nullRestore = restoreSync.restoreFromSave(null);
assertFalse(nullRestore === true, 'Null save data rejected');

console.log('');

// ============================================================
// Test Group 18: InventorySync — Dispose
// ============================================================

console.log('[InventorySync - Dispose]');

const disposeSync = new InventorySync(null, { playerId: 'dispose_test' });
disposeSync.applyRemoteSync('p1', { slots: [null], selectedHotbarSlot: 0 });
assertNotNull(disposeSync.getRemoteInventory('p1'), 'Remote inventory exists before dispose');

disposeSync.dispose();
assertTrue(disposeSync._remoteInventories.size === 0, 'Remote inventories cleared');
assertTrue(disposeSync._syncTimer === null, 'Timer stopped');
assertTrue(disposeSync.onSyncComplete === null, 'Callbacks cleared');

console.log('');

// ============================================================
// Test Group 19: InventoryValidator — Registration
// ============================================================

console.log('[InventoryValidator - Registration]');

const validator = new InventoryValidator();

// Register with valid inventory
const regResult = validator.registerPlayer('p1', [null, { typeId: 1, count: 5 }]);
assertTrue(regResult.accepted === true, 'Valid registration accepted');
assertFalse(regResult.sanitized, 'No sanitization needed');
assertTrue(validator.hasPlayer('p1'), 'Player registered');

// Register with invalid inventory (should sanitize)
let validationFailed = false;
validator.onValidationFailed = () => { validationFailed = true; };
const badReg = validator.registerPlayer('p2', [{ typeId: 999, count: 1 }]);
assertFalse(badReg.accepted === true, 'Invalid registration not accepted');
assertTrue(badReg.sanitized, 'Sanitization applied');
assertTrue(validationFailed, 'onValidationFailed callback fired');

// Get player inventory
const p1Inv = validator.getPlayerInventory('p1');
assertNotNull(p1Inv, 'Player 1 inventory retrievable');
assertEquals(p1Inv.slots.length, 2, 'Slot count preserved');

console.log('');

// ============================================================
// Test Group 20: InventoryValidator — Block Break Validation
// ============================================================

console.log('[InventoryValidator - Block Break]');

// Creative mode: always valid
const creativeResult = validator.validateBlockBreak('p1', 1, true);
assertTrue(creativeResult.valid === true, 'Creative mode block break always valid');

// Survival: check space
validator.registerPlayer('space_test', new Array(36).fill(null)); // Empty inventory
const spaceResult = validator.validateBlockBreak('space_test', 1, false);
assertTrue(spaceResult.valid === true, 'Empty inventory has space for drop');

// Fill inventory with non-stackable items
const fullInv = [];
for (let i = 0; i < 36; i++) fullInv.push({ typeId: 22, count: 1 }); // Corrupt Crystal (single stack)
validator.registerPlayer('full_test', fullInv);
const noSpaceResult = validator.validateBlockBreak('full_test', 1, false);
assertFalse(noSpaceResult.valid === true, 'Full inventory rejects new drop');

// Unregistered player
const unregResult = validator.validateBlockBreak('unknown', 1, false);
assertFalse(unregResult.valid === true, 'Unregistered player rejected');

console.log('');

// ============================================================
// Test Group 21: InventoryValidator — Block Place Validation
// ============================================================

console.log('[InventoryValidator - Block Place]');

// Set up player with block in hotbar slot 0 (global index 27)
const placeInv = new Array(36).fill(null);
placeInv[27] = { typeId: 3, count: 5 }; // Stone in first hotbar slot
validator.registerPlayer('place_test', placeInv);

// Valid place
const placeResult1 = validator.validateBlockPlace('place_test', 3, 0);
assertTrue(placeResult1.valid === true, 'Valid block place from correct slot');

// Wrong block type
const placeResult2 = validator.validateBlockPlace('place_test', 1, 0);
assertFalse(placeResult2.valid === true, 'Wrong block type rejected');

// Empty hotbar slot
const emptyInv = new Array(36).fill(null);
validator.registerPlayer('empty_place', emptyInv);
const placeResult3 = validator.validateBlockPlace('empty_place', 1, 0);
assertFalse(placeResult3.valid === true, 'Empty hotbar rejected');

// Unregistered player
const placeResult4 = validator.validateBlockPlace('unknown', 1, 0);
assertFalse(placeResult4.valid === true, 'Unregistered player block place rejected');

console.log('');

// ============================================================
// Test Group 22: InventoryValidator — Process Inventory Update
// ============================================================

console.log('[InventoryValidator - Process Update]');

const updateVal = new InventoryValidator({ strictMode: true });

// Valid update
updateVal.registerPlayer('upd1', [null]);
const updResult1 = updateVal.processInventoryUpdate('upd1', {
  slots: [{ typeId: 1, count: 3 }],
});
assertTrue(updResult1.accepted === true, 'Valid update accepted');

// Invalid update in strict mode
let strictErrorCalled = false;
updateVal.onValidationFailed = () => { strictErrorCalled = true; };
const updResult2 = updateVal.processInventoryUpdate('upd1', {
  slots: [{ typeId: 999, count: 1 }],
});
assertFalse(updResult2.accepted === true, 'Invalid update rejected in strict mode');
assertTrue(updResult2.sanitized, 'Sanitization applied');
assertTrue(strictErrorCalled, 'onValidationFailed fired for invalid update');

// Non-strict mode: stores even invalid data (lenient)
const lenientVal = new InventoryValidator({ strictMode: false });
lenientVal.registerPlayer('len1', [null]);
const lenientResult = lenientVal.processInventoryUpdate('len1', {
  slots: [{ typeId: 999, count: 1 }],
});
assertTrue(lenientResult.accepted === true, 'Non-strict mode accepts invalid data (lenient)');

console.log('');

// ============================================================
// Test Group 23: InventoryValidator — Unregister & Save
// ============================================================

console.log('[InventoryValidator - Unregister]');

const unregVal = new InventoryValidator();
unregVal.registerPlayer('save_me', [{ typeId: 1, count: 5 }]);

const saveData = unregVal.unregisterPlayer('save_me');
assertNotNull(saveData, 'Save data returned on unregister');
assertEquals(saveData.slots[0].count, 5, 'Inventory data preserved for save');
assertFalse(unregVal.hasPlayer('save_me'), 'Player removed from tracking');

// Unregister non-existent player
const nullSave = unregVal.unregisterPlayer('nobody');
assertTrue(nullSave === null, 'Null returned for unknown player');

console.log('');

// ============================================================
// Test Group 24: InventoryValidator — Player IDs & Dispose
// ============================================================

console.log('[InventoryValidator - Player IDs & Dispose]');

const idsVal = new InventoryValidator();
idsVal.registerPlayer('a', [null]);
idsVal.registerPlayer('b', [null]);
idsVal.registerPlayer('c', [null]);

const playerIds = idsVal.getPlayerIds();
assertEquals(playerIds.length, 3, 'Three players registered');
assertTrue(playerIds.includes('a'), 'Player a in list');
assertTrue(playerIds.includes('b'), 'Player b in list');

idsVal.dispose();
assertEquals(idsVal.getPlayerIds().length, 0, 'All players cleared on dispose');

console.log('');

// ============================================================
// Test Group 25: Integration — Full Sync Cycle
// ============================================================

console.log('[Integration - Full Sync Cycle]');

// Simulate a complete multiplayer inventory sync cycle:
// 1. Client creates inventory and sends join payload
// 2. Host validates and registers
// 3. Host broadcasts INVENTORY_SYNC back to all clients
// 4. Clients apply remote sync

const clientInv = {
  slots: [null, { typeId: 1, count: 5 }, null],
  selectedHotbarSlot: 0,
  totalSlots: 36,
  selectHotbarSlot: function(slot) { this.selectedHotbarSlot = slot; },
};

// Step 1: Client creates join payload
const clientSync = new InventorySync(clientInv, { playerId: 'client_A' });
const cycleJoinPayload = clientSync.createJoinPayload();
assertEquals(cycleJoinPayload.type, 'INVENTORY_UPDATE', 'Client sends INVENTORY_UPDATE');

// Step 2: Host validates and registers
const hostValidator = new InventoryValidator();
const cycleRegResult = hostValidator.registerPlayer('client_A', cycleJoinPayload.inventory.slots);
assertTrue(cycleRegResult.accepted === true, 'Host accepts valid inventory');

// Step 3: Another client receives the sync
const observerSync = new InventorySync(null, { playerId: 'client_B' });
const observerApplied = observerSync.applyRemoteSync(
  'client_A',
  cycleJoinPayload.inventory
);
assertTrue(observerApplied === true, 'Observer accepts remote inventory');

// Step 4: Verify observer has client A's inventory
const observedInv = observerSync.getRemoteInventory('client_A');
assertNotNull(observedInv, 'Observer has client A inventory');
assertDeepEqual(observedInv.slots[1], { typeId: 1, count: 5 }, 'Slot data matches');

// Step 5: Block break validation
const breakValid = hostValidator.validateBlockBreak('client_A', 3, false);
assertTrue(breakValid.valid === true, 'Host validates block break (space available)');

// Step 6: Disconnect save
const disconnectSave = hostValidator.unregisterPlayer('client_A');
assertNotNull(disconnectSave, 'Save data generated on disconnect');

console.log('');

// ============================================================
// Test Group 26: Edge Cases
// ============================================================

console.log('[Edge Cases]');

// Empty inventory operations
const emptySync = new InventorySync(null, { playerId: 'empty' });
const emptyPayload = emptySync.createJoinPayload();
assertEquals(emptyPayload.inventory.slots.length, 0, 'Empty inventory serializes to empty array');

// isSyncDue timing — fresh sync has _lastSyncTime = 0, so it IS due
assertTrue(emptySync.isSyncDue(), 'Fresh sync is due (no baseline set yet)');

// Multiple remote players tracked
const multiRemote = new InventorySync(null, { playerId: 'multi' });
for (let i = 0; i < 5; i++) {
  multiRemote.applyRemoteSync(`player_${i}`, { slots: [null], selectedHotbarSlot: 0 });
}
assertEquals(multiRemote.remotePlayerIds.length, 5, 'Five remote players tracked');

// Overwrite remote inventory
multiRemote.applyRemoteSync('player_0', { slots: [{ typeId: 1, count: 1 }], selectedHotbarSlot: 0 });
const updatedRemote = multiRemote.getRemoteInventory('player_0');
assertDeepEqual(updatedRemote.slots[0], { typeId: 1, count: 1 }, 'Remote inventory overwritten');

// Sync with very large diff
const bigDiffOld = new Array(36).fill(null);
const bigDiffNew = [];
for (let i = 0; i < 36; i++) bigDiffNew.push({ typeId: 1, count: 1 });
const bigChanges = computeInventoryDiff(bigDiffOld, bigDiffNew);
assertEquals(bigChanges.length, 36, 'All 36 slots changed detected');

// Apply diff back should restore original
const restoredSlots = applyInventoryDiff(bigDiffNew, bigChanges.map(c => ({
  index: c.index, oldSlot: c.oldSlot, newSlot: c.oldSlot
})));
assertEquals(restoredSlots.filter(s => s === null).length, 36, 'All slots restored to null');

console.log('');

// ============================================================
// Summary
// ============================================================

console.log('====================');
console.log(`Results: ${passCount} passed, ${failCount} failed`);

if (failCount > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
} else {
  console.log('🎉 All inventory sync tests passing!');
  process.exit(0);
}

// Helper (used in assertions above)
function assertArrayLike(value, message) {
  assert(Array.isArray(value), message);
}
}));
