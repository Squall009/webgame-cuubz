/**
 * Cuubz — Crafting System
 * Recipe-based crafting with grid matching, inventory integration, and recipe discovery.
 * 
 * Features:
 * - Recipe registry with ingredient/output definitions
 * - Grid-based pattern matching (1x1, 2x2, 3x3 grids)
 * - Inventory integration: consume ingredients, add output items
 * - Recipe discovery system (learn recipes as you progress)
 * - Callback system for UI integration
 */

const { BLOCK_TYPES } = require('../world/chunkData');

// ============================================================
// Recipe Definitions
// ============================================================

const RECIPES = {
  // Basic: Wood Log → 4 Planks
  planks: {
    id: 'planks',
    name: 'Planks',
    description: 'Convert wood logs into wooden planks for building.',
    size: 1, // 1x1 grid
    ingredients: [
      { typeId: BLOCK_TYPES.WOOD_LOG, count: 1 },
    ],
    output: { typeId: BLOCK_TYPES.PLANKS, count: 4 },
    discoveryStage: 1, // Available from the start
  },

  // Bed: 3 Planks → 1 Bed (simple recipe, no wool needed)
  bed: {
    id: 'bed',
    name: 'Bed',
    description: 'A placeable bed that restores sleep and sets spawn point.',
    size: 2, // 2x2 grid
    ingredients: [
      { typeId: BLOCK_TYPES.PLANKS, count: 3 },
    ],
    output: { typeId: BLOCK_TYPES.BED, count: 1 },
    discoveryStage: 4, // Discovered after quest 4 (A Safe Place)
  },

  // Craftable Torch: Planks + Coal → Cave Torches
  cave_torch: {
    id: 'cave_torch',
    name: 'Cave Torch',
    description: 'A placeable light source for dark caves.',
    size: 1,
    ingredients: [
      { typeId: BLOCK_TYPES.PLANKS, count: 1 },
    ],
    output: { typeId: BLOCK_TYPES.CAVE_TORCH, count: 4 },
    discoveryStage: 5, // Discovered after exploring caves
  },

  // Obsidian from Lava + Water (special recipe)
  obsidian: {
    id: 'obsidian',
    name: 'Obsidian',
    description: 'Ultra-hard block formed by lava cooling.',
    size: 1,
    ingredients: [
      { typeId: BLOCK_TYPES.STONE, count: 4 },
    ],
    output: { typeId: BLOCK_TYPES.OBSIDIAN, count: 1 },
    discoveryStage: 7, // Discovered when entering lava biome
  },

  // Blackstone (deep cave material)
  blackstone: {
    id: 'blackstone',
    name: 'Blackstone',
    description: 'Dark stone found in deep caves.',
    size: 1,
    ingredients: [
      { typeId: BLOCK_TYPES.STONE, count: 2 },
      { typeId: BLOCK_TYPES.COAL_ORE, count: 1 },
    ],
    output: { typeId: BLOCK_TYPES.BLACKSTONE, count: 2 },
    discoveryStage: 13, // Discovered in corrupt biome
  },
};

// ============================================================
// Crafting System Class
// ============================================================

class CraftingSystem {
  /**
   * @param {object} inventory — Reference to the player's inventory
   */
  constructor(inventory = null) {
    this.recipes = RECIPES;
    
    // Set of discovered recipe IDs
    this.discoveredRecipes = new Set();
    
    // Auto-discover stage 1 recipes (available from start)
    for (const [id, recipe] of Object.entries(RECIPES)) {
      if (recipe.discoveryStage <= 1) {
        this.discoveredRecipes.add(id);
      }
    }
    
    // Crafting grid: 9 slots (3x3), each slot is { typeId, count } or null
    this.craftingGrid = new Array(9).fill(null);
    
    // Inventory reference
    this.inventory = inventory;
    
    // Callback system
    this.onCraftComplete = null;   // Called with output item after successful craft
    this.onRecipeDiscovered = null; // Called when a new recipe is discovered
  }

  /**
   * Discover a recipe by ID.
   * @param {string} recipeId — Recipe identifier (e.g., 'planks')
   */
  discoverRecipe(recipeId) {
    if (!this.recipes[recipeId]) return;
    
    const wasDiscovered = this.discoveredRecipes.has(recipeId);
    this.discoveredRecipes.add(recipeId);
    
    if (!wasDiscovered && this.onRecipeDiscovered) {
      this.onRecipeDiscovered(recipeId, this.recipes[recipeId]);
    }
  }

  /**
   * Check if a recipe has been discovered.
   * @param {string} recipeId
   * @returns {boolean}
   */
  isRecipeDiscovered(recipeId) {
    return this.discoveredRecipes.has(recipeId);
  }

  /**
   * Get all available (discovered) recipes.
   * @returns {object[]} Array of discovered recipe objects
   */
  getAvailableRecipes() {
    return Array.from(this.discoveredRecipes)
      .map(id => this.recipes[id])
      .filter(r => r !== undefined);
  }

  /**
   * Find a matching recipe for the current crafting grid.
   * @returns {object|null} Matched recipe or null if no match
   */
  findMatchingRecipe() {
    // Get non-null items in the grid
    const gridItems = this.craftingGrid.filter(slot => slot !== null);
    
    if (gridItems.length === 0) return null;
    
    // Check each discovered recipe
    for (const recipeId of this.discoveredRecipes) {
      const recipe = this.recipes[recipeId];
      if (!recipe) continue;
      
      if (this._matchesRecipe(recipe, gridItems)) {
        return { ...recipe, id: recipeId };
      }
    }
    
    // Also check undiscovered recipes for matching (but don't allow crafting)
    for (const [recipeId, recipe] of Object.entries(this.recipes)) {
      if (this.discoveredRecipes.has(recipeId)) continue; // Already checked
      
      if (this._matchesRecipe(recipe, gridItems)) {
        return null; // Match found but not discovered — don't reveal
      }
    }
    
    return null;
  }

  /**
   * Check if grid items match a recipe's ingredients.
   * Uses ingredient counting (order-independent).
   * @param {object} recipe — Recipe definition
   * @param {object[]} gridItems — Non-null items in the crafting grid
   * @returns {boolean}
   */
  _matchesRecipe(recipe, gridItems) {
    // Build ingredient count map from grid
    const gridCounts = {};
    for (const item of gridItems) {
      if (!item || typeof item.typeId !== 'number') continue;
      gridCounts[item.typeId] = (gridCounts[item.typeId] || 0) + (item.count || 1);
    }
    
    // Build ingredient count map from recipe
    const recipeCounts = {};
    for (const ing of recipe.ingredients) {
      recipeCounts[ing.typeId] = (recipeCounts[ing.typeId] || 0) + ing.count;
    }
    
    // Check that grid has exactly the right ingredients
    const gridKeys = Object.keys(gridCounts).sort();
    const recipeKeys = Object.keys(recipeCounts).sort();
    
    if (gridKeys.length !== recipeKeys.length) return false;
    
    for (let i = 0; i < gridKeys.length; i++) {
      if (gridKeys[i] !== recipeKeys[i]) return false;
      if (gridCounts[gridKeys[i]] !== recipeCounts[recipeKeys[i]]) return false;
    }
    
    return true;
  }

  /**
   * Check if the current grid can be crafted (has matching recipe + sufficient inventory).
   * @returns {boolean}
   */
  canCraft() {
    if (!this.inventory) return false;
    
    const recipe = this.findMatchingRecipe();
    if (!recipe) return false;
    
    // Check if player has enough ingredients in inventory
    for (const ing of recipe.ingredients) {
      if (!this._hasInInventory(ing.typeId, ing.count)) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Execute the craft operation.
   * Consumes ingredients from inventory and adds output items.
   * @returns {object|null} Craft result with recipeId and output, or null on failure
   */
  craft() {
    if (!this.inventory) return null;
    
    const recipe = this.findMatchingRecipe();
    if (!recipe) return null;
    
    // Check inventory has enough ingredients
    for (const ing of recipe.ingredients) {
      if (!this._hasInInventory(ing.typeId, ing.count)) {
        return null;
      }
    }
    
    // Consume ingredients from inventory
    for (const ing of recipe.ingredients) {
      this._removeFromInventory(ing.typeId, ing.count);
    }
    
    // Add output to inventory
    const output = {
      typeId: recipe.output.typeId,
      count: recipe.output.count || 1,
    };
    this._addToInventory(output.typeId, output.count);
    
    // Clear crafting grid
    this.craftingGrid = new Array(9).fill(null);
    
    // Fire callback
    if (this.onCraftComplete) {
      this.onCraftComplete({ recipeId: recipe.id, ...output });
    }
    
    return { recipeId: recipe.id, ...output };
  }

  /**
   * Check if inventory has enough of a specific item type.
   * @param {number} typeId — Item/block type ID
   * @param {number} count — Required count
   * @returns {boolean}
   */
  _hasInInventory(typeId, count) {
    if (!this.inventory) return false;
    
    let total = 0;
    for (const slot of this.inventory.slots || []) {
      if (slot && slot.typeId === typeId) {
        total += slot.count;
      }
    }
    return total >= count;
  }

  /**
   * Remove items from inventory.
   * @param {number} typeId — Item/block type ID
   * @param {number} count — Count to remove
   */
  _removeFromInventory(typeId, count) {
    if (!this.inventory) return;
    
    let remaining = count;
    for (let i = 0; i < this.inventory.slots.length && remaining > 0; i++) {
      const slot = this.inventory.slots[i];
      if (!slot || slot.typeId !== typeId) continue;
      
      const removeAmount = Math.min(slot.count, remaining);
      slot.count -= removeAmount;
      remaining -= removeAmount;
      
      if (slot.count <= 0) {
        this.inventory.slots[i] = null;
      }
    }
  }

  /**
   * Add items to inventory.
   * @param {number} typeId — Item/block type ID
   * @param {number} count — Count to add
   */
  _addToInventory(typeId, count) {
    if (!this.inventory) return;
    
    // Try to stack in existing slots first
    let remaining = count;
    for (const slot of this.inventory.slots) {
      if (!slot || slot.typeId !== typeId) continue;
      if (slot.count >= 64) continue; // Already at max stack
      
      const addAmount = Math.min(remaining, 64 - slot.count);
      slot.count += addAmount;
      remaining -= addAmount;
      
      if (remaining <= 0) break;
    }
    
    // Place remaining in empty slots
    if (remaining > 0) {
      for (let i = 0; i < this.inventory.slots.length && remaining > 0; i++) {
        if (this.inventory.slots[i] !== null) continue;
        
        const addAmount = Math.min(remaining, 64);
        this.inventory.slots[i] = { typeId, count: addAmount };
        remaining -= addAmount;
      }
    }
  }

  /**
   * Get recipe info for a given ID (even if undiscovered).
   * @param {string} recipeId
   * @returns {object|null}
   */
  getRecipeInfo(recipeId) {
    return this.recipes[recipeId] || null;
  }

  /**
   * Get all recipes (discovered and undiscovered).
   * @returns {object} Full recipe registry
   */
  getAllRecipes() {
    return { ...this.recipes };
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  RECIPES,
  CraftingSystem,
};
