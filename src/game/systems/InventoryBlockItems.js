/**
 * Cuubz — the inventory methods that reach into the block registry (PR 23)
 *
 * Split out of `src/game/systems/InventorySystem.js`. A PROTOTYPE MIXIN: every method
 * below is the byte-identical body it had as a member of `Inventory`, `this` is still the
 * `Inventory` instance, and no call site changed (decision 44).
 *
 * WHY THESE AND NOT SOME OTHERS: they are the methods on `Inventory` whose dependency is
 * `BlockRegistry` rather than `this.slots`. Everything else in the class reaches into the
 * slot array; these reach out of the inventory entirely. That is the seam, and it is what
 * lets `InventorySystem.js` stop importing `getBlockDrop` at all.
 *
 * FIELDS CROSSING THIS BOUNDARY: 0. Not one method here reads or writes an instance field.
 * They call `this.getSelectedItem()` and `this.addItem()` — prototype methods, which the
 * mixin plumbing in `InventorySystem.js` guarantees are present on the same object.
 *
 * PR 23 moved FIVE methods here and recorded two of them — `canPlaceBlock` and
 * `_getBlockProperties` — as uncalled, moving rather than deleting them because dead-code
 * triage is not a mechanical split's job. PR 34 deleted both as D-75; see the note at the
 * bottom. Three remain, and with them went this file's `BLOCK_PROPERTIES` import.
 */

import { NAMED_ITEMS } from '../data/ItemDefinitions.js';
import { getBlockDrop } from '../../engine/world/BlockRegistry.js';

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

  // ─── D-75: `canPlaceBlock` AND `_getBlockProperties` WERE HERE ──────────────
  //
  // PR 23's header above recorded them as uncalled and moved them anyway, because
  // dead-code triage is not a mechanical split's job. PR 34 is where that gets settled, and
  // both are deleted. Re-verified before deleting: no call site in `src/`, `test/`,
  // `server/`, `shared/`, `scripts/` or `index.html`.
  //
  //   `canPlaceBlock(typeId)` — returned `item && item.typeId === typeId` against the
  //   SELECTED slot only. The survival-mode placement check that actually runs is
  //   `Game.canPlaceBlock` (`src/core/Game.js:373`), which asks `inventory.hasItem` and so
  //   sees the whole inventory. Two different answers under one name; keeping the unused
  //   one is how the wrong one eventually gets called.
  //
  //   `_getBlockProperties(blockType)` — a one-line passthrough to `BLOCK_PROPERTIES`.
  //   Nothing reads block properties through the inventory; the four files that need them
  //   import `BLOCK_PROPERTIES` from `BlockRegistry.js` directly.
  //
  // The header's "these five" is now three, and this file no longer imports
  // `BLOCK_PROPERTIES` at all.
};
