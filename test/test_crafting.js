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
// Planks are now split per wood type; WOOD_LOG is the legacy alias for OAK_LOG.
const planksRecipe = CraftingSystem.RECIPES.planks_oak;
assert(planksRecipe !== undefined, 'Oak planks recipe should exist');
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
// Crafting is no longer grid-based: recipes are matched against inventory contents
// via getCraftableRecipes(inventory) and executed with craftRecipe(id, inventory).
setGroup('CraftingSystem Constructor');
const crafting = new CraftingSystem.CraftingSystem();
assert(crafting.recipes !== undefined, 'Should have recipes property');
assert(crafting.discoveredRecipes !== undefined, 'Should have discoveredRecipes set');
assert(crafting.discoveredRecipes instanceof Set, 'discoveredRecipes should be a Set');
assertEqual(crafting.inventory, null, 'Inventory defaults to null');
assert(typeof crafting.getCraftableRecipes === 'function', 'Should expose getCraftableRecipes');
assert(typeof crafting.craftRecipe === 'function', 'Should expose craftRecipe');

// Stage 1 recipes are auto-discovered
assert(crafting.isRecipeDiscovered('planks_oak'), 'Stage 1 recipe auto-discovered');

// ============================================================
// Mock inventory — implements the surface CraftingSystem uses:
// countItem / removeItem / addItem.
// ============================================================
function makeInventory(initial = []) {
  return {
    slots: initial.slice(),
    countItem(typeId) {
      return this.slots.reduce((n, s) => (s && s.typeId === typeId ? n + s.count : n), 0);
    },
    removeItem(typeId, count) {
      let remaining = count;
      for (let i = 0; i < this.slots.length && remaining > 0; i++) {
        const slot = this.slots[i];
        if (!slot || slot.typeId !== typeId) continue;
        const take = Math.min(slot.count, remaining);
        slot.count -= take;
        remaining -= take;
        if (slot.count <= 0) this.slots[i] = null;
      }
      return remaining === 0;
    },
    addItem(typeId, count) {
      const existing = this.slots.find(s => s && s.typeId === typeId);
      if (existing) { existing.count += count; return true; }
      this.slots.push({ typeId, count });
      return true;
    },
  };
}

// --- Group 6: Recipe availability from inventory ---
setGroup('Recipe Matching');
const crafting2 = new CraftingSystem.CraftingSystem();

const logInv = makeInventory([{ typeId: BLOCK_TYPES.WOOD_LOG, count: 1 }]);
const craftable = crafting2.getCraftableRecipes(logInv);
assert(Array.isArray(craftable), 'getCraftableRecipes returns an array');
assert(craftable.some(r => r.id === 'planks_oak'), 'Oak planks craftable with an oak log');

// Empty inventory matches nothing
const emptyInv = makeInventory([]);
assertEqual(crafting2.getCraftableRecipes(emptyInv).length, 0, 'Empty inventory yields no recipes');

// A block that is not an ingredient of any stage-1 recipe
const stoneInv = makeInventory([{ typeId: BLOCK_TYPES.STONE, count: 1 }]);
assert(!crafting2.getCraftableRecipes(stoneInv).some(r => r.id === 'planks_oak'),
  'Stone alone does not make planks craftable');

// Table-only recipes are hidden until at a crafting table
const tableRecipeIds = Object.keys(CraftingSystem.RECIPES).filter(
  id => CraftingSystem.RECIPES[id].requiresTable
);
if (tableRecipeIds.length > 0) {
  const handOnly = crafting2.getCraftableRecipes(logInv, false).map(r => r.id);
  assert(!handOnly.some(id => tableRecipeIds.includes(id)),
    'requiresTable recipes excluded when not at a crafting table');
}

// --- Group 7: Crafting execution ---
setGroup('Crafting Execution');
const crafting3 = new CraftingSystem.CraftingSystem();
const craftInv = makeInventory([{ typeId: BLOCK_TYPES.WOOD_LOG, count: 5 }]);

assertEqual(craftInv.countItem(BLOCK_TYPES.WOOD_LOG), 5, 'Should have 5 wood logs before crafting');

const craftResult = crafting3.craftRecipe('planks_oak', craftInv);
assert(craftResult !== null, 'Craft should succeed');
if (craftResult) {
  assertEqual(craftResult.recipeId, 'planks_oak', 'Craft result references the oak planks recipe');
  assertEqual(craftResult.count, 4, 'Craft yields 4 planks');
}
assertEqual(craftInv.countItem(BLOCK_TYPES.WOOD_LOG), 4, 'Should have 4 wood logs after crafting 1');
assertEqual(craftInv.countItem(BLOCK_TYPES.PLANKS), 4, 'Should have 4 planks after crafting');

// --- Group 8: Insufficient ingredients ---
setGroup('Insufficient Ingredients');
const crafting4 = new CraftingSystem.CraftingSystem();
const brokeInv = makeInventory([]);
assertEqual(crafting4.craftRecipe('planks_oak', brokeInv), null,
  'Should not be able to craft without ingredients');
assertEqual(brokeInv.countItem(BLOCK_TYPES.PLANKS), 0, 'Failed craft adds nothing');

// --- Group 9: Recipe discovery system ---
setGroup('Recipe Discovery');
const crafting5 = new CraftingSystem.CraftingSystem();
assert(crafting5.discoveredRecipes instanceof Set, 'discoveredRecipes should be a Set');

crafting5.discoverRecipe('planks_oak');
assertEqual(crafting5.isRecipeDiscovered('planks_oak'), true,
  'Planks recipe should be discovered after discoverRecipe()');
assertEqual(crafting5.isRecipeDiscovered('nonexistent_recipe'), false,
  'Non-existent recipe should not be discovered');

// discoverRecipe on an unknown id is a no-op, not a crash
crafting5.discoverRecipe('nonexistent_recipe');
assertEqual(crafting5.isRecipeDiscovered('nonexistent_recipe'), false,
  'discoverRecipe ignores unknown recipe ids');

// Undiscovered recipes stay out of getCraftableRecipes
const crafting5b = new CraftingSystem.CraftingSystem();
crafting5b.discoveredRecipes.delete('planks_oak');
assert(!crafting5b.getCraftableRecipes(makeInventory([{ typeId: BLOCK_TYPES.WOOD_LOG, count: 1 }]))
  .some(r => r.id === 'planks_oak'), 'Undiscovered recipes are not craftable');

// --- Group 10: Recipe lookup ---
setGroup('Available Recipes');
const crafting6 = new CraftingSystem.CraftingSystem();
const allRecipes = crafting6.getAllRecipes();
assert(typeof allRecipes === 'object' && allRecipes !== null, 'getAllRecipes returns an object');
assert(Object.keys(allRecipes).length >= 1, 'Should have at least 1 recipe');
assert(allRecipes.planks_oak !== undefined, 'getAllRecipes includes oak planks');
assertEqual(crafting6.getRecipeInfo('planks_oak').id, 'planks_oak', 'getRecipeInfo returns the recipe');
assertEqual(crafting6.getRecipeInfo('nonexistent_recipe'), null, 'getRecipeInfo returns null when unknown');

// --- Group 11: Ingredients are consumed exactly once ---
setGroup('Ingredient Consumption');
const crafting7 = new CraftingSystem.CraftingSystem();
const exactInv = makeInventory([{ typeId: BLOCK_TYPES.WOOD_LOG, count: 1 }]);
crafting7.craftRecipe('planks_oak', exactInv);
assertEqual(exactInv.countItem(BLOCK_TYPES.WOOD_LOG), 0, 'The single log was consumed');
assertEqual(crafting7.craftRecipe('planks_oak', exactInv), null,
  'Second craft fails once ingredients are gone');

// --- Group 12: Callback system ---
setGroup('Crafting Callbacks');
const crafting8 = new CraftingSystem.CraftingSystem();
let craftCallbackFired = false;
let callbackOutput = null;
crafting8.onCraftComplete = (output) => {
  craftCallbackFired = true;
  callbackOutput = output;
};
crafting8.craftRecipe('planks_oak', makeInventory([{ typeId: BLOCK_TYPES.WOOD_LOG, count: 1 }]));
assert(craftCallbackFired, 'onCraftComplete callback should fire');
if (callbackOutput) {
  assert(callbackOutput.typeId === BLOCK_TYPES.PLANKS, 'Callback output should be planks');
  assertEqual(callbackOutput.count, 4, 'Callback output count should be 4');
}

// onRecipeDiscovered fires once, only for newly discovered recipes
const crafting8b = new CraftingSystem.CraftingSystem();
crafting8b.discoveredRecipes.delete('planks_oak');
let discoveredFired = 0;
crafting8b.onRecipeDiscovered = () => { discoveredFired++; };
crafting8b.discoverRecipe('planks_oak');
crafting8b.discoverRecipe('planks_oak');
assertEqual(discoveredFired, 1, 'onRecipeDiscovered fires only on first discovery');

// --- Group 13: Edge cases ---
setGroup('Edge Cases');
const crafting9 = new CraftingSystem.CraftingSystem();

assertEqual(crafting9.getCraftableRecipes(null).length, 0,
  'getCraftableRecipes with null inventory returns empty');
assertEqual(crafting9.craftRecipe('planks_oak', null), null,
  'craftRecipe with null inventory returns null');
assertEqual(crafting9.craftRecipe('nonexistent_recipe', makeInventory([])), null,
  'craftRecipe with unknown recipe returns null');
assertEqual(crafting9.getCraftableRecipes(makeInventory([{ typeId: -1, count: 1 }])).length, 0,
  'Invalid item type matches no recipe');

// ============================================================
// Summary
// ============================================================
console.log(`\n===================================`);
console.log(`Crafting System Tests: ${passed} passed, ${failed} failed`);
console.log(`===================================`);
process.exit(failed > 0 ? 1 : 0);
