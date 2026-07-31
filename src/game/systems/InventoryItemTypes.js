/**
 * Cuubz — item type lookups (PR 23)
 *
 * Split out of `src/game/systems/InventorySystem.js`. A PROTOTYPE MIXIN: every method
 * below is the byte-identical body it had as a member of `Inventory`, `this` is still the
 * `Inventory` instance, and no call site changed (decision 44) — `test/test_inventory.js`
 * calls all four through an instance and does not know this file exists.
 *
 * FIELDS CROSSING THIS BOUNDARY: 0 — and not "0 because they only call other methods",
 * which is `InventoryBlockItems.js`'s shape. These four bodies contain no `this` at all.
 * They are pure functions of `typeId` that happen to be spelled as methods, which makes
 * this the strongest seam in the class by the measure that decides seams here: fewest
 * fields crossing, not most coherent topic.
 *
 * They stay methods rather than becoming exported functions because `this.getMaxStack(...)`
 * is called from four other method groups and `inv.getItemCategory(...)` /
 * `inv.getDisplayName(...)` are called from `src/ui/` and from the tests. Converting them
 * to free functions means rewriting every one of those call sites in the same change that
 * moves the code — exactly the cost decision 44 exists to avoid.
 *
 * WHY IT IS A SEPARATE FILE FROM `InventoryBlockItems.js`, which also crosses 0 fields:
 * that one is `Inventory` reaching into `BlockRegistry` for *behaviour* (drops, block
 * properties, the held tool). This one is item *identity* — category, stack size, display
 * name, equality. `getMaxStack` and `getDisplayName` do touch `BLOCK_TYPES`/`BLOCK_BY_ID`,
 * but as name tables, not as the block registry's logic.
 *
 * IMPORT DIRECTION: imported BY `InventorySystem.js`, imports nothing from it. `src/` has
 * no import cycles and must not gain one (D-28).
 */

import { ITEM_CATEGORIES, MAX_STACKS, NAMED_ITEMS } from '../data/ItemDefinitions.js';
import { BLOCK_BY_ID, BLOCK_TYPES } from '../../engine/world/BlockRegistry.js';

export const ItemTypeMethods = {
  /**
   * Get item category from typeId (block ID number or string name)
   */
  getItemCategory(typeId) {
    if (typeof typeId === 'string') {
      const named = NAMED_ITEMS[typeId];
      return named ? named.category : ITEM_CATEGORIES.RESOURCE;
    }
    return ITEM_CATEGORIES.BLOCK;
  },

  /**
   * Get max stack size for an item type
   */
  getMaxStack(typeId) {
    if (typeof typeId === 'string') {
      const named = NAMED_ITEMS[typeId];
      if (named) return named.maxStack;
      return MAX_STACKS[ITEM_CATEGORIES.RESOURCE];
    }
    // Block items — check if it's a special single-stack block
    // Quest keys, corrupt crystals are single stack
    if (typeId === BLOCK_TYPES.CORRUPT_CRYSTAL || typeId === BLOCK_TYPES.QUEST_KEY) return 1;
    return MAX_STACKS[ITEM_CATEGORIES.BLOCK];
  },

  /**
   * Get display name for an item type
   */
  getDisplayName(typeId) {
    if (typeof typeId === 'string') {
      const named = NAMED_ITEMS[typeId];
      return named ? named.name : typeId;
    }
    // Look up from block registry (single source of truth)
    const block = BLOCK_BY_ID[typeId];
    if (block) {
      // Convert 'oak_planks' → 'Oak Planks', 'coal_ore' → 'Coal Ore'
      return block.name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }
    return `Block ${typeId}`;
  },

  /**
   * Check if two item types are the same (can stack together)
   */
  itemsMatch(a, b) {
    return a === b;
  },
};
