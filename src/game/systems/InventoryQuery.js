/**
 * Cuubz — read-only inventory queries (PR 23)
 *
 * Split out of `src/game/systems/InventorySystem.js`. A PROTOTYPE MIXIN: every method
 * below is the byte-identical body it had as a member of `Inventory`, `this` is still the
 * `Inventory` instance, and no call site changed (decision 44) — `Game.canPlaceBlock`
 * calls `inventory.hasItem(...)`, `src/ui/overlays/InventoryScreen.js` calls
 * `inventory.getItems()`, and neither knows this file exists.
 *
 * FIELDS CROSSING THIS BOUNDARY: 2 — `slots` and `totalSlots`, and **both read-only**.
 * No method here assigns to either, or to anything else on the instance; not one of them
 * fires `_notifySlotChange`. That is what makes this a seam and not just a topic: the
 * mutation half of the same two fields lives in `InventoryStacks.js` and can be reasoned
 * about without this file.
 *
 * `isFull` and `_hasStackSpace` also call `this.getMaxStack` and `this.itemsMatch`
 * (`InventoryItemTypes.js`) — prototype methods, which the mixin plumbing in
 * `InventorySystem.js` guarantees are on the same object.
 *
 * IMPORT DIRECTION: imported BY `InventorySystem.js`, imports nothing at all. `src/` has
 * no import cycles and must not gain one (D-28).
 */

export const QueryMethods = {
  /**
   * Count total items of a given type in inventory
   */
  countItem(typeId) {
    let total = 0;
    for (let i = 0; i < this.totalSlots; i++) {
      const slot = this.slots[i];
      if (slot && this.itemsMatch(slot.typeId, typeId)) {
        total += slot.count;
      }
    }
    return total;
  },

  /**
   * Check if inventory contains any of a given type
   */
  hasItem(typeId) {
    return this.countItem(typeId) > 0;
  },

  /**
   * Count empty slots
   */
  countEmptySlots() {
    let count = 0;
    for (let i = 0; i < this.totalSlots; i++) {
      if (this.slots[i] === null) count++;
    }
    return count;
  },

  /**
   * Count total items across all slots
   */
  countTotalItems() {
    let total = 0;
    for (let i = 0; i < this.totalSlots; i++) {
      const slot = this.slots[i];
      if (slot) total += slot.count;
    }
    return total;
  },

  /**
   * Check if inventory is full (no room for any more items)
   */
  isFull() {
    return this.countEmptySlots() === 0 && !this._hasStackSpace();
  },

  _hasStackSpace() {
    for (let i = 0; i < this.totalSlots; i++) {
      const slot = this.slots[i];
      if (slot) {
        const maxStack = this.getMaxStack(slot.typeId);
        if (slot.count < maxStack) return true;
      }
    }
    return false;
  },

  /**
   * Find the first slot containing a specific item type
   */
  findSlot(typeId) {
    for (let i = 0; i < this.totalSlots; i++) {
      const slot = this.slots[i];
      if (slot && this.itemsMatch(slot.typeId, typeId)) {
        return i;
      }
    }
    return -1;
  },

  /**
   * Get all non-empty slots as an array of {index, typeId, count}
   */
  getItems() {
    const items = [];
    for (let i = 0; i < this.totalSlots; i++) {
      const slot = this.slots[i];
      if (slot) {
        items.push({ index: i, typeId: slot.typeId, count: slot.count });
      }
    }
    return items;
  },
};
