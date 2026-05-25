#!/usr/bin/env node
/**
 * Cuubz — Crafting System Tests
 * Tests for crafting recipes, recipe matching, output validation, and integration with inventory.
 */

const Game = require('../js/game');
const { BLOCK_TYPES, BLOCK_PROPERTIES } = require('../js/world/chunkData');

let passed = 0;
let failed = 0;
let testGroup = '';

function setGroup(name) {
  testGroup = name;
  console.log(`\n[${testGroup}]`);
}

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  ❌ FAIL (${testGroup}): ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  assert(actual === expected, `${message} (expected ${expected}, got ${actual})`);
}

// ============================================================
// Test Suite
// ============================================================

console.log('=== Crafting System Tests ===');

// --- Group 1: Recipe constants and registry ---
setGroup('Recipe Registry');
const CraftingSystem = require('../js/systems/crafting');

assert(CraftingSystem.RECIPES !== undefined, 'RECIPES should be defined');
assert(CraftingSystem.CraftingSystem !== undefined, 'CraftingSystem class should be defined');

// Check recipe count
const recipeCount = Object.keys(CraftingSystem.RECIPES).length;
assert(recipeCount >= 3, `Should have at least 3 recipes (found ${recipeCount})`);

// --- Group 2: Recipe structure validation ---
setGroup('Recipe Structure');
for (const [id, recipe] of Object.entries(CraftingSystem.RECIPES)) {
  assert(recipe.name !== undefined, `Recipe ${id} should have a name`);
  assert(typeof recipe.name === 'string', `Recipe ${id} name should be string`);
  
  assert(recipe.ingredients !== undefined, `Recipe ${id} should have ingredients`);
  assert(Array.isArray(recipe.ingredients), `Recipe ${id} ingredients should be array`);
  assert(recipe.ingredients.length > 0, `Recipe ${id} should have at least 1 ingredient`);
  
  assert(recipe.output !== undefined, `Recipe ${id} should have output`);
  assert(typeof recipe.output === 'object', `Recipe ${id} output should be object`);
  assert('typeId' in recipe.output || 'blockId' in recipe.output, `Recipe ${id} output should specify block type`);
  
  // Output count should be positive number or default to 1
  const outputCount = recipe.output.count || 1;
  assert(outputCount > 0, `Recipe ${id} output count should be positive`);
  
  // Recipe size should be valid (1x1, 2x2, or 3x3)
  if (recipe.size) {
    const validSizes = [1, 2, 3];
    assert(validSizes.includes(recipe.size), `Recipe ${id} size should be 1, 2, or 3`);
  }
}

// --- Group 3: Planks from Wood recipe ---
setGroup('Planks Recipe');
const planksRecipe = CraftingSystem.RECIPES.planks;
assert(planksRecipe !== undefined, 'Planks recipe should exist');
assertEqual(planksRecipe.ingredients.length, 1, 'Planks recipe should have 1 ingredient type');
assertEqual(planksRecipe.ingredients[0].typeId, BLOCK_TYPES.WOOD_LOG, 'Planks ingredient should be wood log');
assertEqual(planksRecipe.ingredients[0].count, 1, 'Planks recipe should consume 1 wood log');
const planksOutput = planksRecipe.output;
assertEqual(planksOutput.count || 1, 4, 'Planks recipe should output 4 planks per wood log');

// --- Group 4: Bed recipe (if defined) ---
setGroup('Bed Recipe');
const bedRecipe = CraftingSystem.RECIPES.bed;
if (bedRecipe) {
  assert(bedRecipe.ingredients.length >= 1, 'Bed recipe should have at least 1 ingredient type');
  assertEqual(bedRecipe.output.count || 1, 1, 'Bed recipe should output 1 bed');
} else {
  console.log('  ℹ️ Bed recipe not yet defined (expected)');
}

// --- Group 5: CraftingSystem class constructor ---
setGroup('CraftingSystem Constructor');
const crafting = new CraftingSystem.CraftingSystem();
assert(crafting.recipes !== undefined, 'Should have recipes property');
assert(crafting.discoveredRecipes !== undefined, 'Should have discoveredRecipes set');
assert(crafting.craftingGrid !== undefined, 'Should have craftingGrid property');
assert(Array.isArray(crafting.craftingGrid), 'craftingGrid should be an array');

// --- Group 6: Recipe matching ---
setGroup('Recipe Matching');
const crafting2 = new CraftingSystem.CraftingSystem();

// Match planks recipe: single wood log in grid
crafting2.craftingGrid = [
  { typeId: BLOCK_TYPES.WOOD_LOG, count: 1 },
  null, null, null, null, null, null, null, null
];
const matchResult = crafting2.findMatchingRecipe();
assert(matchResult !== null, 'Should find planks recipe with wood log in grid');
if (matchResult) {
  assertEqual(matchResult.id, 'planks', 'Matched recipe should be planks');
}

// No match: empty grid
crafting2.craftingGrid = new Array(9).fill(null);
const noMatch = crafting2.findMatchingRecipe();
assertEqual(noMatch, null, 'Empty grid should not match any recipe');

// No match: wrong ingredient
crafting2.craftingGrid = [
  { typeId: BLOCK_TYPES.STONE, count: 1 },
  null, null, null, null, null, null, null, null
];
const stoneMatch = crafting2.findMatchingRecipe();
assertEqual(stoneMatch, null, 'Stone alone should not match any recipe');

// --- Group 7: Crafting execution ---
setGroup('Crafting Execution');

// Mock inventory for testing
const mockInventory = {
  slots: [
    { typeId: BLOCK_TYPES.WOOD_LOG, count: 5 },
    null, null, null, null,
    null, null, null, null,
    null, null, null, null,
    null, null, null, null,
    null, null, null, null,
  ],
  hasItem(typeId) {
    return this.slots.some(s => s && s.typeId === typeId && s.count > 0);
  },
  removeItem(typeId, count) {
    for (const slot of this.slots) {
      if (slot && slot.typeId === typeId) {
        slot.count -= count;
        if (slot.count <= 0) {
          // Find the slot index and set to null
          const idx = this.slots.indexOf(slot);
          this.slots[idx] = null;
        }
        return true;
      }
    }
    return false;
  },
  addItem(typeId, count) {
    // Try to stack first
    for (const slot of this.slots) {
      if (slot && slot.typeId === typeId && slot.count < 64) {
        slot.count += count;
        return true;
      }
    }
    // Find empty slot
    for (let i = 0; i < this.slots.length; i++) {
      if (!this.slots[i]) {
        this.slots[i] = { typeId, count };
        return true;
      }
    }
    return false; // Inventory full
  },
};

const crafting3 = new CraftingSystem.CraftingSystem();
crafting3.inventory = mockInventory;
crafting3.craftingGrid = [
  { typeId: BLOCK_TYPES.WOOD_LOG, count: 1 },
  null, null, null, null, null, null, null, null
];

const woodBefore = mockInventory.slots.find(s => s && s.typeId === BLOCK_TYPES.WOOD_LOG);
assertEqual(woodBefore.count, 5, 'Should have 5 wood logs before crafting');

const craftResult = crafting3.craft();
assert(craftResult !== null, 'Craft should succeed');
if (craftResult) {
  assertEqual(craftResult.recipeId, 'planks', 'Craft result should reference planks recipe');
}

const woodAfter = mockInventory.slots.find(s => s && s.typeId === BLOCK_TYPES.WOOD_LOG);
assert(woodAfter !== undefined, 'Should still have wood log slot (4 remaining)');
assertEqual(woodAfter.count, 4, 'Should have 4 wood logs after crafting 1');

// Check planks were added
const planksSlot = mockInventory.slots.find(s => s && s.typeId === BLOCK_TYPES.PLANKS);
assert(planksSlot !== undefined, 'Should have planks in inventory after crafting');
assertEqual(planksSlot.count, 4, 'Should have 4 planks after crafting');

// --- Group 8: Insufficient ingredients ---
setGroup('Insufficient Ingredients');
const crafting4 = new CraftingSystem.CraftingSystem();
crafting4.inventory = mockInventory;

// Not enough wood logs (need 1, but simulate having 0)
mockInventory.slots[0].count = 0; // Set wood to 0
crafting4.craftingGrid = [
  { typeId: BLOCK_TYPES.WOOD_LOG, count: 1 },
  null, null, null, null, null, null, null, null
];

const failResult = crafting4.canCraft();
assertEqual(failResult, false, 'Should not be able to craft without ingredients');

// Restore wood for next tests
mockInventory.slots[0].count = 5;

// --- Group 9: Recipe discovery system ---
setGroup('Recipe Discovery');
const crafting5 = new CraftingSystem.CraftingSystem();

// Initially, recipes may or may not be discovered (depends on implementation)
assert(crafting5.discoveredRecipes instanceof Set || typeof crafting5.discoveredRecipes === 'object',
  'discoveredRecipes should be a Set or object');

// Discover a recipe
crafting5.discoverRecipe('planks');
const isDiscovered = crafting5.isRecipeDiscovered('planks');
assertEqual(isDiscovered, true, 'Planks recipe should be discovered after discoverRecipe()');

// Check undiscovered recipe
const undiscovered = crafting5.isRecipeDiscovered('nonexistent_recipe');
assertEqual(undiscovered, false, 'Non-existent recipe should not be discovered');

// --- Group 10: getAvailableRecipes ---
setGroup('Available Recipes');
const crafting6 = new CraftingSystem.CraftingSystem();
crafting6.discoverRecipe('planks');

const available = crafting6.getAvailableRecipes();
assert(Array.isArray(available), 'getAvailableRecipes should return array');
assert(available.length >= 1, 'Should have at least 1 available recipe after discovering planks');

// --- Group 11: Grid clear after crafting ---
setGroup('Grid Clear After Craft');
const crafting7 = new CraftingSystem.CraftingSystem();
crafting7.inventory = mockInventory;
mockInventory.slots[0].count = 5; // Ensure we have wood

crafting7.craftingGrid = [
  { typeId: BLOCK_TYPES.WOOD_LOG, count: 1 },
  null, null, null, null, null, null, null, null
];

crafting7.craft();

// Grid should be cleared after crafting
let gridEmpty = true;
for (const slot of crafting7.craftingGrid) {
  if (slot !== null) {
    gridEmpty = false;
    break;
  }
}
assert(gridEmpty, 'Crafting grid should be cleared after successful craft');

// --- Group 12: Callback system ---
setGroup('Crafting Callbacks');
const crafting8 = new CraftingSystem.CraftingSystem();
crafting8.inventory = mockInventory;
mockInventory.slots[0].count = 5;

let craftCallbackFired = false;
let callbackOutput = null;
crafting8.onCraftComplete = (output) => {
  craftCallbackFired = true;
  callbackOutput = output;
};

crafting8.craftingGrid = [
  { typeId: BLOCK_TYPES.WOOD_LOG, count: 1 },
  null, null, null, null, null, null, null, null
];

crafting8.craft();
assert(craftCallbackFired, 'onCraftComplete callback should fire');
if (callbackOutput) {
  assert(callbackOutput.typeId === BLOCK_TYPES.PLANKS, 'Callback output should be planks');
  assertEqual(callbackOutput.count, 4, 'Callback output count should be 4');
}

// --- Group 13: Edge cases ---
setGroup('Edge Cases');

// Null inventory — canCraft should handle gracefully
const crafting9 = new CraftingSystem.CraftingSystem();
crafting9.inventory = null;
assertEqual(crafting9.canCraft(), false, 'canCraft with null inventory should return false');

// Empty grid — findMatchingRecipe should return null
crafting9.craftingGrid = new Array(9).fill(null);
assertEqual(crafting9.findMatchingRecipe(), null, 'Empty grid should not match any recipe');

// Grid with invalid item type
crafting9.craftingGrid = [
  { typeId: -1, count: 1 },
  null, null, null, null, null, null, null, null
];
assertEqual(crafting9.findMatchingRecipe(), null, 'Invalid item type should not match any recipe');

// Craft with no inventory
const noInvResult = crafting9.craft();
assertEqual(noInvResult, null, 'craft() without inventory should return null');

// ============================================================
// Summary
// ============================================================
console.log(`\n===================================`);
console.log(`Crafting System Tests: ${passed} passed, ${failed} failed`);
console.log(`===================================`);
process.exit(failed > 0 ? 1 : 0);
