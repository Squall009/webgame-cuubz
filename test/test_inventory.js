#!/usr/bin/env node
/**
 * Cuubz — Inventory System Tests
 * Tests Inventory class: grid layout, stacking, add/remove, serialization, hotbar, drag-drop.
 */

'use strict';

const { Inventory, ITEM_CATEGORIES, MAX_STACKS, NAMED_ITEMS } = require('../js/systems/inventory');

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

function assertNull(value, message) {
  if (value === null || value === undefined) {
    passCount++;
    console.log(`  ✅ ${message}`);
  } else {
    failCount++;
    failures.push(message);
    console.log(`  ❌ ${message}: expected null/undefined, got ${JSON.stringify(value)}`);
  }
}

function assertNotNull(value, message) {
  if (value !== null && value !== undefined) {
    passCount++;
    console.log(`  ✅ ${message}`);
  } else {
    failCount++;
    failures.push(message);
    console.log(`  ❌ ${message}: expected non-null`);
  }
}

function assertTrue(condition, message) {
  if (!!condition) {
    passCount++;
    console.log(`  ✅ ${message}`);
  } else {
    failCount++;
    failures.push(message);
    console.log(`  ❌ ${message}: expected true`);
  }
}

function assertFalse(condition, message) {
  if (!condition) {
    passCount++;
    console.log(`  ✅ ${message}`);
  } else {
    failCount++;
    failures.push(message);
    console.log(`  ❌ ${message}: expected false`);
  }
}

function assertGreaterOrEqual(actual, threshold, message) {
  assert(actual >= threshold, `${message}: expected >= ${threshold}, got ${actual}`);
}

// ============================================================
// Tests
// ============================================================

console.log('Inventory System Tests');
console.log('======================\n');

// --- Test: Constants and Definitions ---
console.log('[Constants & Definitions]');

assertEquals(ITEM_CATEGORIES.BLOCK, 'block', 'BLOCK category name');
assertEquals(ITEM_CATEGORIES.RESOURCE, 'resource', 'RESOURCE category name');
assertEquals(ITEM_CATEGORIES.FOOD, 'food', 'FOOD category name');
assertEquals(ITEM_CATEGORIES.TOOL, 'tool', 'TOOL category name');

assertEquals(MAX_STACKS['block'], 64, 'Block max stack is 64');
assertEquals(MAX_STACKS['resource'], 64, 'Resource max stack is 64');
assertEquals(MAX_STACKS['food'], 16, 'Food max stack is 16');
assertEquals(MAX_STACKS['tool'], 1, 'Tool max stack is 1');

assertNotNull(NAMED_ITEMS.apple, 'Apple is a named item');
assertNotNull(NAMED_ITEMS.coal, 'Coal is a named item');
assertNotNull(NAMED_ITEMS.corrupt_crystal, 'Corrupt crystal is a named item');
assertEquals(NAMED_ITEMS.apple.name, 'Apple', 'Apple display name');
assertEquals(NAMED_ITEMS.apple.category, 'food', 'Apple is food category');
assertEquals(NAMED_ITEMS.apple.maxStack, 16, 'Apple max stack is 16');

// --- Test: Construction ---
console.log('\n[Construction]');

const inv = new Inventory();
assertEquals(inv.rows, 4, 'Default rows is 4');
assertEquals(inv.cols, 9, 'Default cols is 9');
assertEquals(inv.totalSlots, 36, 'Total slots is 36');
assertEquals(inv.hotbarStart, 27, 'Hotbar starts at slot 27');
assertEquals(inv.hotbarSize, 9, 'Hotbar has 9 slots');
assertEquals(inv.selectedHotbarSlot, 0, 'Default selected hotbar slot is 0');
assertEquals(inv.countEmptySlots(), 36, 'New inventory has all empty slots');
assertEquals(inv.countTotalItems(), 0, 'New inventory has 0 items');

// Custom size
const smallInv = new Inventory(2, 5);
assertEquals(smallInv.totalSlots, 10, 'Custom inventory: 2x5 = 10 slots');
assertEquals(smallInv.hotbarStart, 5, 'Custom hotbar start at slot 5');

// --- Test: Slot Indexing ---
console.log('\n[Slot Indexing]');

assertEquals(inv.slotIndex(0, 0), 0, 'Row 0, Col 0 = index 0');
assertEquals(inv.slotIndex(0, 8), 8, 'Row 0, Col 8 = index 8');
assertEquals(inv.slotIndex(1, 0), 9, 'Row 1, Col 0 = index 9');
assertEquals(inv.slotIndex(3, 0), 27, 'Row 3, Col 0 = index 27 (hotbar start)');
assertEquals(inv.slotIndex(3, 8), 35, 'Row 3, Col 8 = index 35 (last slot)');

const pos = inv.slotPosition(0);
assertEquals(pos.row, 0, 'Index 0 → row 0');
assertEquals(pos.col, 0, 'Index 0 → col 0');

const pos2 = inv.slotPosition(35);
assertEquals(pos2.row, 3, 'Index 35 → row 3');
assertEquals(pos2.col, 8, 'Index 35 → col 8');

// Hotbar slot mapping
assertEquals(inv.hotbarSlotIndex(0), 27, 'Hotbar pos 0 = global index 27');
assertEquals(inv.hotbarSlotIndex(8), 35, 'Hotbar pos 8 = global index 35');
assertEquals(inv.hotbarSlotIndex(-1), -1, 'Negative hotbar pos returns -1');
assertEquals(inv.hotbarSlotIndex(9), -1, 'Out-of-range hotbar pos returns -1');

// Hotbar detection
assertFalse(inv.isHotbarSlot(0), 'Slot 0 is not hotbar');
assertFalse(inv.isHotbarSlot(26), 'Slot 26 is not hotbar');
assertTrue(inv.isHotbarSlot(27), 'Slot 27 is hotbar');
assertTrue(inv.isHotbarSlot(35), 'Slot 35 is hotbar');

// --- Test: Item Type Helpers ---
console.log('\n[Item Type Helpers]');

assertEquals(inv.getItemCategory(1), 'block', 'Block type 1 (GRASS) is block category');
assertEquals(inv.getItemCategory('apple'), 'food', 'Apple is food category');
assertEquals(inv.getItemCategory('coal'), 'resource', 'Coal is resource category');
assertEquals(inv.getItemCategory('unknown_item'), 'resource', 'Unknown string defaults to resource');

assertEquals(inv.getMaxStack(1), 64, 'Block max stack is 64');
assertEquals(inv.getMaxStack(22), 1, 'Corrupt crystal (22) max stack is 1');
assertEquals(inv.getMaxStack(25), 1, 'Quest key (25) max stack is 1');
assertEquals(inv.getMaxStack('apple'), 16, 'Apple max stack is 16');
assertEquals(inv.getMaxStack('corrupt_crystal'), 1, 'Corrupt crystal named item max stack is 1');

assertEquals(inv.getDisplayName(1), 'Grass', 'Block 1 display name is Grass');
assertEquals(inv.getDisplayName(3), 'Stone', 'Block 3 display name is Stone');
assertEquals(inv.getDisplayName('apple'), 'Apple', 'Apple display name');
assertEquals(inv.getDisplayName('coal'), 'Coal', 'Coal display name');

assertTrue(inv.itemsMatch(1, 1), 'Same block types match');
assertFalse(inv.itemsMatch(1, 2), 'Different block types dont match');
assertTrue(inv.itemsMatch('apple', 'apple'), 'Same named items match');
assertFalse(inv.itemsMatch('apple', 'coal'), 'Different named items dont match');

// --- Test: Slot Access ---
console.log('\n[Slot Access]');

const testInv = new Inventory();
assertNull(testInv.getSlot(0), 'Empty slot returns null');
assertEquals(testInv.getSlot(-1), null, 'Negative index returns null');
assertEquals(testInv.getSlot(36), null, 'Out-of-range index returns null');

// Set a slot
assertTrue(testInv.setSlot(5, { typeId: 3, count: 10 }), 'Set slot succeeds');
assertNotNull(testInv.getSlot(5), 'Slot now has data');
assertEquals(testInv.getSlot(5).typeId, 3, 'Slot typeId is STONE');
assertEquals(testInv.getSlot(5).count, 10, 'Slot count is 10');

// Clear a slot
assertTrue(testInv.clearSlot(5), 'Clear slot succeeds');
assertNull(testInv.getSlot(5), 'Cleared slot returns null');
assertFalse(testInv.clearSlot(5), 'Clearing already-empty slot returns false');

// Selected item
assertEquals(testInv.getSelectedItem(), null, 'Empty inventory: no selected item');
testInv.setSlot(27, { typeId: 1, count: 5 }); // Hotbar slot 0
assertNotNull(testInv.getSelectedItem(), 'Hotbar has selected item');
assertEquals(testInv.getSelectedItem().typeId, 1, 'Selected item is GRASS');

// --- Test: Selection ---
console.log('\n[Selection]');

const selInv = new Inventory();

// Basic selection
assertTrue(selInv.selectHotbarSlot(0), 'Select slot 0 succeeds');
assertEquals(selInv.selectedHotbarSlot, 0, 'Selected slot is 0');
assertTrue(selInv.selectHotbarSlot(8), 'Select slot 8 succeeds');
assertEquals(selInv.selectedHotbarSlot, 8, 'Selected slot is 8');
assertFalse(selInv.selectHotbarSlot(-1), 'Select negative fails');
assertFalse(selInv.selectHotbarSlot(9), 'Select out-of-range fails');

// Cycling
selInv.selectedHotbarSlot = 0;
selInv.cycleSelection(1);
assertEquals(selInv.selectedHotbarSlot, 1, 'Cycle +1 from 0 → 1');
selInv.cycleSelection(-1);
assertEquals(selInv.selectedHotbarSlot, 0, 'Cycle -1 from 1 → 0');

// Wraparound
selInv.selectedHotbarSlot = 8;
selInv.cycleSelection(1);
assertEquals(selInv.selectedHotbarSlot, 0, 'Cycle +1 from 8 → 0 (wrap)');
selInv.selectedHotbarSlot = 0;
selInv.cycleSelection(-1);
assertEquals(selInv.selectedHotbarSlot, 8, 'Cycle -1 from 0 → 8 (wrap)');

// Number key selection
assertTrue(selInv.selectByNumber(1), 'Key 1 selects slot 0');
assertEquals(selInv.selectedHotbarSlot, 0, 'Key 1 → slot 0');
assertTrue(selInv.selectByNumber(5), 'Key 5 selects slot 4');
assertEquals(selInv.selectedHotbarSlot, 4, 'Key 5 → slot 4');
assertTrue(selInv.selectByNumber(9), 'Key 9 selects slot 8');
assertEquals(selInv.selectedHotbarSlot, 8, 'Key 9 → slot 8');

// Selection change callback
let selectionCallbackFired = false;
selInv.onSelectionChange = (slot) => {
  selectionCallbackFired = true;
  assertEquals(slot, 3, 'Callback receives correct slot index');
};
selInv.selectHotbarSlot(3);
assertTrue(selectionCallbackFired, 'Selection change callback fires');

// --- Test: Adding Items ---
console.log('\n[Adding Items]');

const addInv = new Inventory();

// Add single item
let result = addInv.addItem(3, 1); // Add 1 stone
assertEquals(result.added, 1, 'Added 1 stone');
assertEquals(result.remaining, 0, 'No remaining');
assertEquals(addInv.countTotalItems(), 1, 'Total items is 1');

// Add more of same type (should stack)
result = addInv.addItem(3, 5); // Add 5 more stone
assertEquals(result.added, 5, 'Added 5 more stone');
assertEquals(result.remaining, 0, 'No remaining');
assertEquals(addInv.countItem(3), 6, 'Total stone is 6');

// Add different type (new slot)
result = addInv.addItem(1, 3); // Add 3 grass
assertEquals(result.added, 3, 'Added 3 grass');
assertEquals(addInv.countItem(1), 3, 'Grass count is 3');
assertEquals(addInv.countTotalItems(), 9, 'Total items is 9 (6 stone + 3 grass)');

// Add named item
result = addInv.addItem('apple', 5);
assertEquals(result.added, 5, 'Added 5 apples');
assertEquals(addInv.countItem('apple'), 5, 'Apple count is 5');

// Stacking respects max stack for food (16)
const foodInv = new Inventory();
result = foodInv.addItem('apple', 20); // Try to add 20 apples, max stack is 16
assertEquals(result.added, 20, 'Added all 20 apples');
assertEquals(result.remaining, 0, 'No remaining (split across 2 slots)');
// Should be: slot 1 = 16, slot 2 = 4
const items = foodInv.getItems();
assertEquals(items.length, 2, 'Apples split into 2 slots');
assertEquals(items[0].count, 16, 'First apple stack is max (16)');
assertEquals(items[1].count, 4, 'Second apple stack is remainder (4)');

// Overflow test — full inventory
const tinyInv = new Inventory(1, 2); // Only 2 slots
tinyInv.addItem(3, 64); // Fill slot 0 with max stone
tinyInv.addItem(1, 64); // Fill slot 1 with max grass
result = tinyInv.addItem(2, 5); // Try to add dirt — no room
assertEquals(result.added, 0, 'Cannot add to full inventory');
assertEquals(result.remaining, 5, 'All 5 remain');

// Zero/negative count
result = inv.addItem(3, 0);
assertEquals(result.added, 0, 'Adding 0 items adds nothing');
result = inv.addItem(3, -1);
assertEquals(result.added, 0, 'Adding negative items adds nothing');

// --- Test: Removing Items ---
console.log('\n[Removing Items]');

const rmInv = new Inventory();
rmInv.setSlot(0, { typeId: 3, count: 10 }); // Stone in slot 0
rmInv.setSlot(1, { typeId: 3, count: 5 });  // More stone in slot 1
rmInv.setSlot(2, { typeId: 1, count: 8 });  // Grass in slot 2

// Remove from most-full first
let rmResult = rmInv.removeItem(3, 7);
assertEquals(rmResult.removed, 7, 'Removed 7 stone');
assertEquals(rmInv.countItem(3), 8, 'Remaining stone: 10-7=3 in slot 0 + 5 in slot 1 = 8... wait')

// Actually let's recalculate: slot 0 had 10 (most full), remove 7 → slot 0 has 3
assertEquals(rmInv.getSlot(0).count, 3, 'Slot 0 stone reduced from 10 to 3');
assertEquals(rmInv.getSlot(1).count, 5, 'Slot 1 stone unchanged at 5');

// Remove all of a type
rmResult = rmInv.removeItem(1, 20); // Only 8 grass available
assertEquals(rmResult.removed, 8, 'Removed all 8 grass (not 20)');
assertNull(rmInv.getSlot(2), 'Grass slot cleared after removing all');

// Remove from non-existent type
rmResult = rmInv.removeItem(99, 5);
assertEquals(rmResult.removed, 0, 'Removing non-existent type removes 0');

// Remove zero/negative
rmResult = rmInv.removeItem(3, 0);
assertEquals(rmResult.removed, 0, 'Removing 0 items removes nothing');

// --- Test: removeFromSlot ---
console.log('\n[Remove From Slot]');

const slotRmInv = new Inventory();
slotRmInv.setSlot(0, { typeId: 3, count: 5 });

let removed = slotRmInv.removeFromSlot(0);
assertNotNull(removed, 'removeFromSlot returns item');
assertEquals(removed.typeId, 3, 'Removed item typeId is STONE');
assertEquals(slotRmInv.getSlot(0).count, 4, 'Slot count decremented to 4');

// Remove last item from slot
removed = null;
for (let i = 0; i < 4; i++) {
  slotRmInv.removeFromSlot(0);
}
assertNull(slotRmInv.getSlot(0), 'Slot cleared after removing all items');

// Remove from empty slot
removed = slotRmInv.removeFromSlot(0);
assertNull(removed, 'Removing from empty slot returns null');
removed = slotRmInv.removeFromSlot(-1);
assertNull(removed, 'Removing from negative index returns null');

// --- Test: Block Break/Place Integration ---
console.log('\n[Block Break/Place]');

const bpInv = new Inventory();

// Breaking GRASS drops DIRT (block type 2)
let dropResult = bpInv.addBlockDrop(1); // GRASS
assertTrue(dropResult, 'Breaking grass adds drop to inventory');
assertEquals(bpInv.countItem(2), 1, 'Dirt added from breaking grass');
assertEquals(bpInv.getSlot(0).typeId, 2, 'First slot has dirt (drop type)');

// Breaking STONE drops nothing (no drop property)
bpInv.clear();
dropResult = bpInv.addBlockDrop(3); // STONE
assertTrue(dropResult, 'Breaking stone adds block itself');
assertEquals(bpInv.countItem(3), 1, 'Stone block added to inventory');

// Breaking BEDROCK drops nothing (unbreakable)
bpInv.clear();
dropResult = bpInv.addBlockDrop(11); // BEDROCK
assertFalse(dropResult, 'Breaking bedrock adds nothing');
assertEquals(bpInv.countTotalItems(), 0, 'No items added for unbreakable block');

// Breaking COAL_ORE drops 'coal' named item
bpInv.clear();
dropResult = bpInv.addBlockDrop(18); // COAL_ORE
assertTrue(dropResult, 'Breaking coal ore adds drop');
assertEquals(bpInv.countItem('coal'), 1, 'Coal resource added');

// Breaking APPLE block drops 'apple' food item
bpInv.clear();
dropResult = bpInv.addBlockDrop(24); // APPLE
assertTrue(dropResult, 'Breaking apple block adds drop');
assertEquals(bpInv.countItem('apple'), 1, 'Apple food item added');

// Breaking AIR does nothing
bpInv.clear();
dropResult = bpInv.addBlockDrop(0); // AIR
assertFalse(dropResult, 'Breaking air adds nothing');

// Consuming selected block
const placeInv = new Inventory();
placeInv.setSlot(27, { typeId: 3, count: 10 }); // Stone in hotbar slot 0
let consumed = placeInv.consumeSelectedBlock();
assertNotNull(consumed, 'Consuming returns item');
assertEquals(consumed.typeId, 3, 'Consumed item is stone');
assertEquals(placeInv.getSlot(27).count, 9, 'Stone count decremented to 9');

// Cannot consume named item as block
placeInv.setSlot(27, { typeId: 'apple', count: 5 });
consumed = placeInv.consumeSelectedBlock();
assertNull(consumed, 'Cannot consume named item as placeable block');

// --- Test: Query Helpers ---
console.log('\n[Query Helpers]');

const queryInv = new Inventory();
queryInv.setSlot(0, { typeId: 3, count: 10 });
queryInv.setSlot(1, { typeId: 3, count: 5 });
queryInv.setSlot(2, { typeId: 1, count: 3 });

assertEquals(queryInv.countItem(3), 15, 'Count stone across slots = 15');
assertEquals(queryInv.countItem(1), 3, 'Count grass = 3');
assertEquals(queryInv.countItem(99), 0, 'Count non-existent = 0');

assertTrue(queryInv.hasItem(3), 'Has stone');
assertFalse(queryInv.hasItem(99), 'Does not have block 99');

assertEquals(queryInv.countEmptySlots(), 33, '3 empty slots (36 - 3 used)');
assertEquals(queryInv.countTotalItems(), 18, 'Total items = 10+5+3 = 18');

assertFalse(queryInv.isFull(), 'Not full with empty slots');

// Find slot
assertEquals(queryInv.findSlot(3), 0, 'Find stone returns first slot index');
assertEquals(queryInv.findSlot(1), 2, 'Find grass returns its slot index');
assertEquals(queryInv.findSlot(99), -1, 'Find non-existent returns -1');

// Get all items
const allItems = queryInv.getItems();
assertEquals(allItems.length, 3, 'getItems returns 3 entries');

// --- Test: Serialization/Deserialization ---
console.log('\n[Serialization]');

const serInv = new Inventory();
serInv.setSlot(0, { typeId: 3, count: 10 });
serInv.setSlot(5, { typeId: 'apple', count: 7 });
serInv.setSlot(27, { typeId: 1, count: 3 }); // Hotbar slot 0
serInv.selectedHotbarSlot = 3;

const data = serInv.serialize();
assertEquals(data.rows, 4, 'Serialized rows');
assertEquals(data.cols, 9, 'Serialized cols');
assertEquals(data.selectedHotbarSlot, 3, 'Serialized selected slot');
assertEquals(data.slots.length, 3, '3 slots serialized (non-empty only)');

// Deserialize
const deserInv = Inventory.deserialize(data);
assertEquals(deserInv.rows, 4, 'Deserialized rows');
assertEquals(deserInv.cols, 9, 'Deserialized cols');
assertEquals(deserInv.selectedHotbarSlot, 3, 'Deserialized selected slot');
assertEquals(deserInv.getSlot(0).typeId, 3, 'Stone restored in slot 0');
assertEquals(deserInv.getSlot(0).count, 10, 'Stone count preserved');
assertEquals(deserInv.getSlot(5).typeId, 'apple', 'Apple restored in slot 5');
assertEquals(deserInv.getSlot(5).count, 7, 'Apple count preserved');
assertEquals(deserInv.getSlot(27).typeId, 1, 'Grass restored in hotbar slot 0');

// Empty serialization
const emptyInv = new Inventory();
const emptyData = emptyInv.serialize();
assertEquals(emptyData.slots.length, 0, 'Empty inventory serializes with no slots');

const emptyRestored = Inventory.deserialize(emptyData);
assertEquals(emptyRestored.countTotalItems(), 0, 'Deserialized empty inventory has no items');

// Deserialize with bad data
const badData = { rows: 4, cols: 9, selectedHotbarSlot: 999, slots: [] };
const badInv = Inventory.deserialize(badData);
assertEquals(badInv.selectedHotbarSlot, 8, 'Clamped selectedHotbarSlot to max valid');

// Deserialize with out-of-range slot index
const badSlotsData = { rows: 1, cols: 2, slots: [{ index: 99, typeId: 3, count: 5 }] };
const badSlotsInv = Inventory.deserialize(badSlotsData);
assertEquals(badSlotsInv.countTotalItems(), 0, 'Out-of-range slot indices ignored');

// --- Test: Drag and Drop ---
console.log('\n[Drag and Drop]');

const dragInv = new Inventory();
dragInv.setSlot(0, { typeId: 3, count: 10 }); // Stone
dragInv.setSlot(1, { typeId: 1, count: 5 });  // Grass

// Swap slots
assertTrue(dragInv.swapSlots(0, 1), 'Swap succeeds');
assertEquals(dragInv.getSlot(0).typeId, 1, 'Slot 0 now has grass (swapped)');
assertEquals(dragInv.getSlot(1).typeId, 3, 'Slot 1 now has stone (swapped)');

// Swap with empty slot
dragInv.setSlot(2, { typeId: 7, count: 2 }); // Wood log in slot 2
assertTrue(dragInv.swapSlots(2, 5), 'Swap with empty succeeds');
assertNull(dragInv.getSlot(2), 'Slot 2 now empty');
assertEquals(dragInv.getSlot(5).typeId, 7, 'Wood log moved to slot 5');

// Swap same slot
assertFalse(dragInv.swapSlots(0, 0), 'Swap same slot returns false');

// Split stack
const splitInv = new Inventory();
splitInv.setSlot(0, { typeId: 3, count: 10 }); // Stone stack of 10
splitInv.setSlot(1, null); // Empty slot

assertTrue(splitInv.splitStack(0, 1), 'Split succeeds');
assertEquals(splitInv.getSlot(0).count, 5, 'Source reduced to ceil(10/2)=5');
assertEquals(splitInv.getSlot(1).typeId, 3, 'Target has stone');
assertEquals(splitInv.getSlot(1).count, 5, 'Target gets 5');

// Split into existing stack of same type
const splitMergeInv = new Inventory();
splitMergeInv.setSlot(0, { typeId: 3, count: 8 }); // Stone 8
splitMergeInv.setSlot(1, { typeId: 3, count: 60 }); // Stone 60 (near max)

assertTrue(splitMergeInv.splitStack(0, 1), 'Split into existing stack');
assertEquals(splitMergeInv.getSlot(1).count, 64, 'Target capped at max stack 64');
// Moved ceil(8/2)=4 but only space for 4 → moved 4. Source: 8-4=4
assertEquals(splitMergeInv.getSlot(0).count, 4, 'Source reduced by amount moved');

// Split fails with different types
const splitDiffInv = new Inventory();
splitDiffInv.setSlot(0, { typeId: 3, count: 10 }); // Stone
splitDiffInv.setSlot(1, { typeId: 1, count: 5 });  // Grass
assertFalse(splitDiffInv.splitStack(0, 1), 'Split fails with different types');

// Split single-item stack
const splitSingle = new Inventory();
splitSingle.setSlot(0, { typeId: 3, count: 1 });
assertFalse(splitSingle.splitStack(0, 1), 'Cannot split single-item stack');

// --- Test: isFull edge case ---
console.log('\n[isFull Edge Cases]');

const fullInv = new Inventory(1, 2); // 2 slots
fullInv.setSlot(0, { typeId: 3, count: 64 }); // Full stone stack
fullInv.setSlot(1, { typeId: 1, count: 64 }); // Full grass stack
assertTrue(fullInv.isFull(), 'Inventory full when all stacks at max');

// Partially full but no matching stacks
const partialInv = new Inventory(1, 2);
partialInv.setSlot(0, { typeId: 3, count: 64 }); // Full stone stack
partialInv.setSlot(1, { typeId: 1, count: 63 }); // One space left in slot 1
assertFalse(partialInv.isFull(), 'Not full — has stack space in slot 1');
partialInv.setSlot(1, { typeId: 1, count: 64 }); // Now both slots at max
assertTrue(partialInv.isFull(), 'Full after filling remaining space');

// --- Test: Inventory clear ---
console.log('\n[Clear]');

const clrInv = new Inventory();
clrInv.setSlot(0, { typeId: 3, count: 10 });
clrInv.setSlot(5, { typeId: 1, count: 5 });
clrInv.clear();
assertEquals(clrInv.countTotalItems(), 0, 'Clear removes all items');
assertEquals(clrInv.countEmptySlots(), 36, 'All slots empty after clear');

// --- Test: Slot change callback ---
console.log('\n[Slot Change Callback]');

let callbackCount = 0;
const cbInv = new Inventory();
cbInv.onSlotChange = (index, slot) => {
  callbackCount++;
};

cbInv.setSlot(0, { typeId: 3, count: 5 });
assertEquals(callbackCount, 1, 'Callback fires on setSlot');

cbInv.clearSlot(0);
assertEquals(callbackCount, 2, 'Callback fires on clearSlot');

// Setting same value should not fire callback (null→null)
cbInv.setSlot(0, null);
cbInv.setSlot(0, null);
assertEquals(callbackCount, 2, 'Callback not fired again for null→null (no change)');

// ============================================================
// Report
// ============================================================

console.log('\n======================');
console.log(`Results: ${passCount} passed, ${failCount} failed`);

if (failCount > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
} else {
  console.log('🎉 All inventory tests passing!');
  process.exit(0);
}
