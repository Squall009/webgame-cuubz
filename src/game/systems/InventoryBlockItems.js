/**
 * Cuubz — the inventory methods that reach into the block registry (PR 23)
 *
 * Split out of `src/game/systems/InventorySystem.js`. A PROTOTYPE MIXIN: every method
 * below is the byte-identical body it had as a member of `Inventory`, `this` is still the
 * `Inventory` instance, and no call site changed (decision 44).
 *
 * WHY THESE FIVE AND NOT SOME OTHER FIVE: they are the only methods on `Inventory` whose
 * dependency is `BlockRegistry` rather than `this.slots`. Everything else in the class
 * reaches into the slot array; these reach out of the inventory entirely, at
 * `getBlockDrop` and `BLOCK_PROPERTIES`. That is the seam, and it is what lets
 * `InventorySystem.js` stop importing `BLOCK_PROPERTIES` and `getBlockDrop` at all.
 *
 * FIELDS CROSSING THIS BOUNDARY: 0. Not one method here reads or writes an instance field.
 * They call `this.getSelectedItem()` and `this.addItem()` — prototype methods, which the
 * mixin plumbing in `InventorySystem.js` guarantees are present on the same object.
 *
 * TWO OF THESE FIVE ARE UNCALLED in `src/` and `test/`: `canPlaceBlock` (the survival-mode
 * check that actually runs is `Game.canPlaceBlock`, which asks `inventory.hasItem`) and
 * `_getBlockProperties` (nothing reads block properties through the inventory). They are
 * moved rather than deleted — dead-code triage is D-25's sweep, not a mechanical split's.
 *
 * `_getBlockProperties`'s `typeof BLOCK_PROPERTIES === 'undefined'` guard is now provably
 * dead: the name is a module import, so it is either bound or the module fails to load.
 * Decision 29 says a mechanical extraction moves such a guard unchanged rather than
 * recreating it; PR 33 owns the sweep.
 */

import { NAMED_ITEMS } from '../data/ItemDefinitions.js';
import { BLOCK_PROPERTIES, getBlockDrop } from '../../engine/world/BlockRegistry.js';

export const BlockItemMethods = {
  /**
   * Get tool info for the currently selected item.
   * Returns { toolType, miningSpeed } or null if no tool is held.
   * toolType is one of: 'pickaxe', 'axe', 'shovel', 'hoe'
   */
  getToolInfo() {
    const item = this.getSelectedItem();
    if (!item) return null;

    const def = NAMED_ITEMS[item.typeId];
    if (!def) return null;

    // Determine tool type from item key
    const key = item.typeId;
    if (typeof key !== 'string') return null; // Block items aren't tools

    if (key.includes('_pickaxe')) return { toolType: 'pickaxe', miningSpeed: def.miningSpeed || 1.0 };
    if (key.includes('_axe') && !key.includes('pickaxe')) return { toolType: 'axe', miningSpeed: def.miningSpeed || 1.0 };
    if (key.includes('_shovel')) return { toolType: 'shovel', miningSpeed: def.miningSpeed || 1.0 };
    if (key.includes('_hoe')) return { toolType: 'hoe', miningSpeed: def.miningSpeed || 1.0 };

    return null; // It's a tool but not a mining tool (sword, spear, armor, etc.)
  },

  /**
   * Get attack damage from the currently selected item.
   * Defaults to 2 (fist damage) if no weapon held.
   * @returns {number}
   */
  getAttackDamage() {
    const item = this.getSelectedItem();
    if (!item) return 2; // Fist damage

    if (typeof item.typeId === 'string') {
      const def = NAMED_ITEMS[item.typeId];
      if (def && def.damage !== undefined) {
        return def.damage;
      }
    }
    return 2; // Default fist damage
  },

  /**
   * Handle breaking a block — add the drop to inventory.
   * Drop resolution lives in blockRegistry.getBlockDrop (the block source of truth).
   * @param {number} blockType - The block type that was broken
   * @returns {boolean} Whether the item was successfully added
   */
  addBlockDrop(blockType) {
    const dropTypeId = getBlockDrop(blockType);
    if (dropTypeId === null || dropTypeId === 0) return false;

    const result = this.addItem(dropTypeId, 1);
    return result.added > 0;
  },

  /**
   * Check if player has a specific block type to place
   */
  canPlaceBlock(typeId) {
    if (typeof typeId !== 'number') return false;
    const item = this.getSelectedItem();
    return item && item.typeId === typeId;
  },

  /**
   * Get block properties from the live block registry.
   *
   * Note: blockRegistry.js declares `BLOCK_PROPERTIES` as a top-level `const`. In a
   * classic <script> that is a lexical global binding, which is NOT exposed as
   * `window.BLOCK_PROPERTIES` — the old `window.` lookup here was always undefined
   * in the browser and silently fell back to a stale table. Reference it directly.
   */
  _getBlockProperties(blockType) {
    if (typeof BLOCK_PROPERTIES === 'undefined') return undefined;
    return BLOCK_PROPERTIES[blockType];
  },
};
