/**
 * Cuubz — Equipment (armor slots) (PR 23)
 *
 * Split out of `src/game/systems/InventorySystem.js`. Two halves:
 *
 *   1. The slot vocabulary — `EQUIPMENT_SLOTS`, `EQUIPMENT_SLOT_ORDER` and
 *      `getEquipmentSlotForItem` — real module exports, zero crossing, no `this`.
 *   2. `EquipmentMethods` — a PROTOTYPE MIXIN. Every method below is the byte-identical
 *      body it had as a member of `Inventory`, and `this` is still the `Inventory`
 *      instance, so no call site changed. `Object.assign` in `InventorySystem.js` puts
 *      them back on the prototype (decision 44).
 *
 * FIELDS CROSSING THIS BOUNDARY: 2 — `equipment` and `onEquipmentChange`. Nothing else on
 * the instance is touched by any method here, and NO method outside this file writes
 * `this.equipment`; `serialize`/`deserialize` in `InventorySystem.js` read and populate it,
 * which is why `EQUIPMENT_SLOT_ORDER` is exported rather than kept private. That is the
 * cleanest seam in the class and it is the one `refactor.md` §4.1 and §9 PR 24 already
 * named.
 *
 * IMPORT DIRECTION: this file is imported BY `InventorySystem.js` and imports nothing from
 * it — `NAMED_ITEMS` comes from the leaf data module. `src/` has no import cycles and must
 * not gain one: `test/helpers/esmRequire.js` resolves a cycle to `undefined` (D-28).
 *
 * `EQUIPMENT_SLOTS`, `EQUIPMENT_SLOT_ORDER` and `getEquipmentSlotForItem` are re-exported
 * from `src/game/systems/InventorySystem.js` under their original names, so
 * `src/core/init/initInventory.js` (which imports `EQUIPMENT_SLOT_ORDER` from there) is
 * unchanged.
 *
 * NOTE on `refactor.md` §9 PR 24's row: it also lists `getArmorValue` and
 * `getArmorToughness` as belonging here. Neither exists anywhere in `src/` — the armour
 * numbers are read straight out of `NAMED_ITEMS` by `getEquipmentStats`. Nothing was
 * dropped; the plan row names two methods that were never written.
 */

import { NAMED_ITEMS } from '../data/ItemDefinitions.js';

// ============================================================
// Equipment Slot Definitions
// ============================================================

export const EQUIPMENT_SLOTS = {
  HELMET: 'helmet',
  CHESTPLATE: 'chestplate',
  LEGGINGS: 'leggings',
  BOOTS: 'boots',
};

export const EQUIPMENT_SLOT_ORDER = ['helmet', 'chestplate', 'leggings', 'boots'];

/**
 * Map an item typeId to its equipment slot, or null if not equippable.
 * An item is equippable armor if it has armorValue in NAMED_ITEMS.
 */
export function getEquipmentSlotForItem(typeId) {
  if (typeof typeId !== 'string') return null;
  if (!NAMED_ITEMS[typeId] || NAMED_ITEMS[typeId].armorValue === undefined) return null;
  if (typeId.endsWith('_helmet')) return EQUIPMENT_SLOTS.HELMET;
  if (typeId.endsWith('_chestplate')) return EQUIPMENT_SLOTS.CHESTPLATE;
  if (typeId.endsWith('_leggings')) return EQUIPMENT_SLOTS.LEGGINGS;
  if (typeId.endsWith('_boots')) return EQUIPMENT_SLOTS.BOOTS;
  return null;
}

// ============================================================
// Equipment (Armor Slots) — prototype mixin for `Inventory`
// ============================================================

export const EquipmentMethods = {
  /**
   * Check if an item type is equippable armor.
   */
  isEquippable(typeId) {
    return getEquipmentSlotForItem(typeId) !== null;
  },

  /**
   * Get the equipment slot for an item type, or null.
   */
  getEquipmentSlot(typeId) {
    return getEquipmentSlotForItem(typeId);
  },

  /**
   * Equip an item into an equipment slot.
   * If the slot is already occupied, the old item is returned so the caller
   * can place it back into the inventory.
   * @param {string} slot - One of 'helmet', 'chestplate', 'leggings', 'boots'
   * @param {string} typeId - The armor item typeId
   * @returns {object|null} The previously equipped item { typeId, count } or null if slot was empty
   */
  equipItem(slot, typeId) {
    if (!EQUIPMENT_SLOT_ORDER.includes(slot)) return null;
    if (!this.isEquippable(typeId)) return null;
    if (getEquipmentSlotForItem(typeId) !== slot) return null;

    const oldItem = this.equipment[slot];
    this.equipment[slot] = { typeId, count: 1 };

    if (this.onEquipmentChange) {
      this.onEquipmentChange(slot, this.equipment[slot]);
    }

    return oldItem;
  },

  /**
   * Unequip an item from an equipment slot.
   * @param {string} slot - One of 'helmet', 'chestplate', 'leggings', 'boots'
   * @returns {object|null} The removed item { typeId, count } or null if slot was empty
   */
  unequipItem(slot) {
    if (!EQUIPMENT_SLOT_ORDER.includes(slot)) return null;
    const item = this.equipment[slot];
    if (!item) return null;

    this.equipment[slot] = null;

    if (this.onEquipmentChange) {
      this.onEquipmentChange(slot, null);
    }

    return item;
  },

  /**
   * Get the equipped item in a slot.
   */
  getEquippedItem(slot) {
    if (!EQUIPMENT_SLOT_ORDER.includes(slot)) return null;
    return this.equipment[slot];
  },

  /**
   * Calculate total defensive stats from all equipped armor.
   * @returns {{ totalArmor: number, totalToughness: number }}
   */
  getEquipmentStats() {
    let totalArmor = 0;
    let totalToughness = 0;

    for (const slot of EQUIPMENT_SLOT_ORDER) {
      const item = this.equipment[slot];
      if (item) {
        const def = NAMED_ITEMS[item.typeId];
        if (def) {
          totalArmor += def.armorValue || 0;
          totalToughness += def.armorToughness || 0;
        }
      }
    }

    return { totalArmor, totalToughness };
  },

  /**
   * Get all equipped items as a flat array.
   */
  getEquippedItems() {
    const items = [];
    for (const slot of EQUIPMENT_SLOT_ORDER) {
      const item = this.equipment[slot];
      if (item) {
        items.push({ slot, typeId: item.typeId, count: item.count });
      }
    }
    return items;
  },
};
