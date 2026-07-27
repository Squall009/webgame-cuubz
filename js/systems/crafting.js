/**
 * Cuubz — Crafting System
 * Recipe-based crafting with inventory integration and recipe discovery.
 * 
 * Two tiers:
 *   - Hand crafting (requiresTable: false) — always available
 *   - Crafting table (requiresTable: true) — requires standing within 4 blocks of block ID 162
 */

// ============================================================
// Recipe Definitions
// ============================================================

const RECIPES = {
  // ── Hand-craftable recipes ────────────────────────────────
  planks_oak: {
    id: 'planks_oak', name: 'Oak Planks', description: 'Convert oak logs into wooden planks.',
    ingredients: [ { typeId: BLOCK_TYPES.OAK_LOG, count: 1 } ],
    output: { typeId: BLOCK_TYPES.OAK_PLANKS, count: 4 },
    requiresTable: false, discoveryStage: 1,
  },
  planks_spruce: {
    id: 'planks_spruce', name: 'Spruce Planks', description: 'Convert spruce logs into wooden planks.',
    ingredients: [ { typeId: BLOCK_TYPES.SPRUCE_LOG, count: 1 } ],
    output: { typeId: BLOCK_TYPES.SPRUCE_PLANKS, count: 4 },
    requiresTable: false, discoveryStage: 1,
  },
  planks_birch: {
    id: 'planks_birch', name: 'Birch Planks', description: 'Convert birch logs into wooden planks.',
    ingredients: [ { typeId: BLOCK_TYPES.BIRCH_LOG, count: 1 } ],
    output: { typeId: BLOCK_TYPES.BIRCH_PLANKS, count: 4 },
    requiresTable: false, discoveryStage: 1,
  },
  planks_jungle: {
    id: 'planks_jungle', name: 'Jungle Planks', description: 'Convert jungle logs into wooden planks.',
    ingredients: [ { typeId: BLOCK_TYPES.JUNGLE_LOG, count: 1 } ],
    output: { typeId: BLOCK_TYPES.JUNGLE_PLANKS, count: 4 },
    requiresTable: false, discoveryStage: 1,
  },
  // Any plank type → sticks
  sticks: {
    id: 'sticks', name: 'Sticks', description: 'Craft sticks from any wooden planks.',
    ingredients: [ {
      typeIds: [
        BLOCK_TYPES.OAK_PLANKS, BLOCK_TYPES.SPRUCE_PLANKS,
        BLOCK_TYPES.BIRCH_PLANKS, BLOCK_TYPES.JUNGLE_PLANKS,
        BLOCK_TYPES.ACACIA_PLANKS, BLOCK_TYPES.DARK_OAK_PLANKS,
        BLOCK_TYPES.CHERRY_PLANKS, BLOCK_TYPES.MANGROVE_PLANKS,
        BLOCK_TYPES.PALE_OAK_PLANKS, BLOCK_TYPES.POPLAR_PLANKS,
        BLOCK_TYPES.BAMBOO_PLANKS, BLOCK_TYPES.CRIMSON_PLANKS,
        BLOCK_TYPES.WARPED_PLANKS,
      ],
      count: 2,
    } ],
    output: { typeId: 'stick', count: 4 },
    requiresTable: false, discoveryStage: 1,
  },
  torch: {
    id: 'torch', name: 'Torches', description: 'A placeable light source.',
    ingredients: [
      { typeId: BLOCK_TYPES.OAK_PLANKS, count: 1 },
      { typeId: 'coal', count: 1 },
    ],
    output: { typeId: BLOCK_TYPES.TORCH, count: 4 },
    requiresTable: false, discoveryStage: 1,
  },
  crafting_table: {
    id: 'crafting_table', name: 'Crafting Table', description: 'Unlock advanced recipes.',
    ingredients: [ { typeId: BLOCK_TYPES.OAK_PLANKS, count: 4 } ],
    output: { typeId: BLOCK_TYPES.CRAFTING_TABLE, count: 1 },
    requiresTable: false, discoveryStage: 1,
  },

  // ── Crafting-table only recipes ───────────────────────────
  wooden_pickaxe: {
    id: 'wooden_pickaxe', name: 'Wooden Pickaxe', description: 'Mine stone and ore blocks.',
    ingredients: [ { typeId: BLOCK_TYPES.OAK_PLANKS, count: 3 }, { typeId: 'stick', count: 2 } ],
    output: { typeId: 'wooden_pickaxe', count: 1 },
    requiresTable: true, discoveryStage: 1,
  },
  wooden_axe: {
    id: 'wooden_axe', name: 'Wooden Axe', description: 'Chop wood faster.',
    ingredients: [ { typeId: BLOCK_TYPES.OAK_PLANKS, count: 3 }, { typeId: 'stick', count: 2 } ],
    output: { typeId: 'wooden_axe', count: 1 },
    requiresTable: true, discoveryStage: 1,
  },
  wooden_sword: {
    id: 'wooden_sword', name: 'Wooden Sword', description: 'A basic weapon.',
    ingredients: [ { typeId: BLOCK_TYPES.OAK_PLANKS, count: 2 }, { typeId: 'stick', count: 1 } ],
    output: { typeId: 'wooden_sword', count: 1 },
    requiresTable: true, discoveryStage: 1,
  },
  wooden_shovel: {
    id: 'wooden_shovel', name: 'Wooden Shovel', description: 'Dig dirt and sand faster.',
    ingredients: [ { typeId: BLOCK_TYPES.OAK_PLANKS, count: 1 }, { typeId: 'stick', count: 2 } ],
    output: { typeId: 'wooden_shovel', count: 1 },
    requiresTable: true, discoveryStage: 1,
  },
  wooden_hoe: {
    id: 'wooden_hoe', name: 'Wooden Hoe', description: 'Till soil for farming.',
    ingredients: [ { typeId: BLOCK_TYPES.OAK_PLANKS, count: 2 }, { typeId: 'stick', count: 2 } ],
    output: { typeId: 'wooden_hoe', count: 1 },
    requiresTable: true, discoveryStage: 1,
  },
  wooden_spear: {
    id: 'wooden_spear', name: 'Wooden Spear', description: 'A ranged melee weapon.',
    ingredients: [ { typeId: BLOCK_TYPES.OAK_PLANKS, count: 2 }, { typeId: 'stick', count: 1 } ],
    output: { typeId: 'wooden_spear', count: 1 },
    requiresTable: true, discoveryStage: 1,
  },
  stone_pickaxe: {
    id: 'stone_pickaxe', name: 'Stone Pickaxe', description: 'Mine stone and ore blocks faster.',
    ingredients: [ { typeId: BLOCK_TYPES.COBBLESTONE, count: 3 }, { typeId: 'stick', count: 2 } ],
    output: { typeId: 'stone_pickaxe', count: 1 },
    requiresTable: true, discoveryStage: 1,
  },
  stone_axe: {
    id: 'stone_axe', name: 'Stone Axe', description: 'Chop wood much faster.',
    ingredients: [ { typeId: BLOCK_TYPES.COBBLESTONE, count: 3 }, { typeId: 'stick', count: 2 } ],
    output: { typeId: 'stone_axe', count: 1 },
    requiresTable: true, discoveryStage: 1,
  },
  stone_sword: {
    id: 'stone_sword', name: 'Stone Sword', description: 'A sturdy weapon.',
    ingredients: [ { typeId: BLOCK_TYPES.COBBLESTONE, count: 2 }, { typeId: 'stick', count: 1 } ],
    output: { typeId: 'stone_sword', count: 1 },
    requiresTable: true, discoveryStage: 1,
  },
  stone_shovel: {
    id: 'stone_shovel', name: 'Stone Shovel', description: 'Dig dirt and sand much faster.',
    ingredients: [ { typeId: BLOCK_TYPES.COBBLESTONE, count: 1 }, { typeId: 'stick', count: 2 } ],
    output: { typeId: 'stone_shovel', count: 1 },
    requiresTable: true, discoveryStage: 1,
  },
  stone_hoe: {
    id: 'stone_hoe', name: 'Stone Hoe', description: 'Till soil for farming faster.',
    ingredients: [ { typeId: BLOCK_TYPES.COBBLESTONE, count: 2 }, { typeId: 'stick', count: 2 } ],
    output: { typeId: 'stone_hoe', count: 1 },
    requiresTable: true, discoveryStage: 1,
  },
  stone_spear: {
    id: 'stone_spear', name: 'Stone Spear', description: 'A ranged melee weapon.',
    ingredients: [ { typeId: BLOCK_TYPES.COBBLESTONE, count: 2 }, { typeId: 'stick', count: 1 } ],
    output: { typeId: 'stone_spear', count: 1 },
    requiresTable: true, discoveryStage: 1,
  },
  ladder: {
    id: 'ladder', name: 'Ladders', description: 'Climb vertical surfaces.',
    ingredients: [ { typeId: 'stick', count: 7 } ],
    output: { typeId: BLOCK_TYPES.LADDER, count: 4 },
    requiresTable: true, discoveryStage: 1,
  },
  chest: {
    id: 'chest', name: 'Chest', description: 'Store extra items.',
    ingredients: [ { typeId: BLOCK_TYPES.OAK_PLANKS, count: 8 } ],
    output: { typeId: BLOCK_TYPES.CHEST, count: 1 },
    requiresTable: true, discoveryStage: 1,
  },
  furnace: {
    id: 'furnace', name: 'Furnace', description: 'Smelt ores and cook food.',
    ingredients: [ { typeId: BLOCK_TYPES.COBBLESTONE, count: 8 } ],
    output: { typeId: BLOCK_TYPES.FURNACE, count: 1 },
    requiresTable: true, discoveryStage: 1,
  },
};

// ============================================================
// Crafting System Class
// ============================================================

class CraftingSystem {
  constructor(inventory = null) {
    this.recipes = RECIPES;
    this.inventory = inventory;
    this.discoveredRecipes = new Set();

    // Auto-discover stage 1 recipes
    for (const [id, recipe] of Object.entries(RECIPES)) {
      if (recipe.discoveryStage <= 1) {
        this.discoveredRecipes.add(id);
      }
    }

    this.onCraftComplete = null;
    this.onRecipeDiscovered = null;
  }

  discoverRecipe(recipeId) {
    if (!this.recipes[recipeId]) return;
    const wasDiscovered = this.discoveredRecipes.has(recipeId);
    this.discoveredRecipes.add(recipeId);
    if (!wasDiscovered && this.onRecipeDiscovered) {
      this.onRecipeDiscovered(recipeId, this.recipes[recipeId]);
    }
  }

  isRecipeDiscovered(recipeId) {
    return this.discoveredRecipes.has(recipeId);
  }

  /**
   * Get all craftable recipes given current inventory and crafting station.
   */
  getCraftableRecipes(inventory, atCraftingTable = false) {
    const results = [];
    for (const [id, recipe] of Object.entries(this.recipes)) {
      if (!this.discoveredRecipes.has(id)) continue;
      if (recipe.requiresTable && !atCraftingTable) continue;
      if (!this._hasAllIngredients(inventory, recipe)) continue;
      results.push({ id, ...recipe });
    }
    return results;
  }

  /**
   * Craft a recipe — consume ingredients, add output to inventory.
   */
  craftRecipe(recipeId, inventory) {
    const recipe = this.recipes[recipeId];
    if (!recipe) return null;
    if (!this._hasAllIngredients(inventory, recipe)) return null;

    for (const ing of recipe.ingredients) {
      const resolution = this._resolveIngredient(inventory, ing);
      if (!resolution) return null;
      for (const { typeId, count } of resolution) {
        inventory.removeItem(typeId, count);
      }
    }

    const outputCount = recipe.output.count || 1;
    inventory.addItem(recipe.output.typeId, outputCount);

    if (this.onCraftComplete) {
      this.onCraftComplete({ recipeId, typeId: recipe.output.typeId, count: outputCount });
    }

    return { recipeId, typeId: recipe.output.typeId, count: outputCount };
  }

  _hasAllIngredients(inventory, recipe) {
    if (!inventory) return false;
    for (const ing of recipe.ingredients) {
      const typeIds = ing.typeIds || [ing.typeId]; // support array or single
      let total = 0;
      for (const tid of typeIds) {
        total += inventory.countItem(tid);
      }
      if (total < ing.count) return false;
    }
    return true;
  }

  /**
   * Find which typeId(s) to consume for an ingredient (supports typeIds array).
   * Returns [{ typeId, count }] — which types to remove and how many of each.
   */
  _resolveIngredient(inventory, ingredient) {
    const typeIds = ingredient.typeIds || [ingredient.typeId];
    const needed = ingredient.count;
    let remaining = needed;
    const result = [];

    for (const tid of typeIds) {
      const available = inventory.countItem(tid);
      if (available <= 0) continue;
      const take = Math.min(available, remaining);
      result.push({ typeId: tid, count: take });
      remaining -= take;
      if (remaining <= 0) break;
    }

    return remaining <= 0 ? result : null;
  }

  /**
   * Get the actual typeId used for an ingredient (for UI display).
   * Returns the first matching typeId the player has enough of.
   */
  _getIngredientType(inventory, ingredient) {
    const typeIds = ingredient.typeIds || [ingredient.typeId];
    for (const tid of typeIds) {
      if (inventory.countItem(tid) >= ingredient.count) return tid;
    }
    // If no single type has enough, return the first type they have any of
    for (const tid of typeIds) {
      if (inventory.countItem(tid) > 0) return tid;
    }
    return typeIds[0];
  }

  getRecipeInfo(recipeId) {
    return this.recipes[recipeId] || null;
  }

  getAllRecipes() {
    return { ...this.recipes };
  }
}

// ============================================================
// Exports
// ============================================================

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { RECIPES, CraftingSystem };
}
