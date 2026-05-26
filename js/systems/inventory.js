/**
 * Cuubz — Inventory System
 * Grid-based inventory with hotbar, block/item tracking, stacking, serialization.
 * 
 * Layout: 9 columns × 4 rows = 36 slots total
 *   - Slots 0-26: Main inventory (rows 0-2)
 *   - Slots 27-35: Hotbar (row 3)
 * 
 * Items are either block types (number IDs from BLOCK_TYPES) or named items
 * (strings like 'coal', 'apple', 'corrupt_crystal').
 */

// ============================================================
// Item Definitions
// ============================================================

const ITEM_CATEGORIES = {
  BLOCK: 'block',       // Placeable blocks (BLOCK_TYPES IDs)
  RESOURCE: 'resource', // Mined resources, quest items (string names)
  FOOD: 'food',         // Consumable food items
  TOOL: 'tool',         // Tools and equipment
};

// Max stack sizes by category
const MAX_STACKS = {
  [ITEM_CATEGORIES.BLOCK]: 64,
  [ITEM_CATEGORIES.RESOURCE]: 64,
  [ITEM_CATEGORIES.FOOD]: 16,
  [ITEM_CATEGORIES.TOOL]: 1,
};

// Named item definitions (non-block items)
const NAMED_ITEMS = {
  coal:           { name: 'Coal', category: ITEM_CATEGORIES.RESOURCE, maxStack: 64 },
  iron_ore:       { name: 'Iron Ore', category: ITEM_CATEGORIES.RESOURCE, maxStack: 64 },
  gold_ore:       { name: 'Gold Ore', category: ITEM_CATEGORIES.RESOURCE, maxStack: 64 },
  diamond:        { name: 'Diamond', category: ITEM_CATEGORIES.RESOURCE, maxStack: 64 },
  corrupt_crystal:{ name: 'Corrupt Crystal', category: ITEM_CATEGORIES.RESOURCE, maxStack: 1 },
  apple:          { name: 'Apple', category: ITEM_CATEGORIES.FOOD, maxStack: 16 },
  cooked_meat:    { name: 'Cooked Meat', category: ITEM_CATEGORIES.FOOD, maxStack: 16 },
  berry:          { name: 'Berry', category: ITEM_CATEGORIES.FOOD, maxStack: 16 },
  bread:          { name: 'Bread', category: ITEM_CATEGORIES.FOOD, maxStack: 16 },
  golden_apple:   { name: 'Golden Apple', category: ITEM_CATEGORIES.FOOD, maxStack: 1 },
};

// ============================================================
// Inventory Class
// ============================================================

class Inventory {
  /**
   * @param {number} rows - Number of rows (default 4)
   * @param {number} cols - Number of columns (default 9)
   */
  constructor(rows = 4, cols = 9) {
    this.rows = rows;
    this.cols = cols;
    this.totalSlots = rows * cols;
    this.hotbarStart = (rows - 1) * cols; // First hotbar slot index
    this.hotbarSize = cols;

    // Each slot: { typeId, count } or null if empty
    this.slots = new Array(this.totalSlots).fill(null);

    // Currently selected hotbar slot index (0-8 within hotbar)
    this.selectedHotbarSlot = 0;

    // Callbacks for UI/game integration
    this.onSlotChange = null;
    this.onSelectionChange = null;
  }

  // ============================================================
  // Slot Indexing Helpers
  // ============================================================

  /**
   * Convert row/column to flat slot index
   */
  slotIndex(row, col) {
    return row * this.cols + col;
  }

  /**
   * Convert flat slot index to row/column
   */
  slotPosition(index) {
    return { row: Math.floor(index / this.cols), col: index % this.cols };
  }

  /**
   * Get the hotbar slot index (global) for a given hotbar position
   */
  hotbarSlotIndex(hotbarPos) {
    if (hotbarPos < 0 || hotbarPos >= this.hotbarSize) return -1;
    return this.hotbarStart + hotbarPos;
  }

  /**
   * Check if a slot is in the hotbar
   */
  isHotbarSlot(index) {
    return index >= this.hotbarStart && index < this.totalSlots;
  }

  // ============================================================
  // Item Type Helpers
  // ============================================================

  /**
   * Get item category from typeId (block ID number or string name)
   */
  getItemCategory(typeId) {
    if (typeof typeId === 'string') {
      const named = NAMED_ITEMS[typeId];
      return named ? named.category : ITEM_CATEGORIES.RESOURCE;
    }
    return ITEM_CATEGORIES.BLOCK;
  }

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
    if (typeId === 22 || typeId === 25 || typeId === 26) return 1; // Corrupt Crystal, Quest Key, Boss Spawn
    return MAX_STACKS[ITEM_CATEGORIES.BLOCK];
  }

  /**
   * Get display name for an item type
   */
  getDisplayName(typeId) {
    if (typeof typeId === 'string') {
      const named = NAMED_ITEMS[typeId];
      return named ? named.name : typeId;
    }
    // Block names lookup
    const blockNames = {
      0: 'Air', 1: 'Grass', 2: 'Dirt', 3: 'Stone', 4: 'Sand',
      5: 'Gravel', 6: 'Water', 7: 'Wood Log', 8: 'Leaves', 9: 'Snow',
      10: 'Ice', 11: 'Bedrock', 12: 'Planks', 13: 'Obsidian', 14: 'Blackstone',
      15: 'Lava', 16: 'Corrupt Stone', 17: 'Toxic Slime', 18: 'Coal Ore',
      19: 'Iron Ore', 20: 'Gold Ore', 21: 'Diamond Ore', 22: 'Corrupt Crystal',
      23: 'Bed', 24: 'Apple', 25: 'Quest Key', 26: 'Boss Spawn',
    };
    return blockNames[typeId] || `Block ${typeId}`;
  }

  /**
   * Check if two item types are the same (can stack together)
   */
  itemsMatch(a, b) {
    return a === b;
  }

  // ============================================================
  // Slot Access
  // ============================================================

  /**
   * Get slot data at index. Returns null if empty.
   */
  getSlot(index) {
    if (index < 0 || index >= this.totalSlots) return null;
    return this.slots[index];
  }

  /**
   * Set slot data directly (internal use)
   */
  setSlot(index, item) {
    if (index < 0 || index >= this.totalSlots) return false;
    const old = this.slots[index];
    this.slots[index] = item;
    if (!this._slotsEqual(old, item)) {
      this._notifySlotChange(index);
    }
    return true;
  }

  /**
   * Clear a slot
   */
  clearSlot(index) {
    if (this.slots[index] !== null) {
      this.slots[index] = null;
      this._notifySlotChange(index);
      return true;
    }
    return false;
  }

  /**
   * Get the currently selected hotbar slot's item
   */
  getSelectedItem() {
    const globalIndex = this.hotbarSlotIndex(this.selectedHotbarSlot);
    return this.getSlot(globalIndex);
  }

  /**
   * Get the block type ID from the selected slot (or null)
   */
  getSelectedTypeId() {
    const item = this.getSelectedItem();
    return item ? item.typeId : null;
  }

  // ============================================================
  // Selection
  // ============================================================

  /**
   * Select a hotbar slot by position (0-8)
   */
  selectHotbarSlot(slotPos) {
    if (slotPos < 0 || slotPos >= this.hotbarSize) return false;
    const old = this.selectedHotbarSlot;
    this.selectedHotbarSlot = slotPos;
    if (old !== slotPos && this.onSelectionChange) {
      this.onSelectionChange(this.selectedHotbarSlot);
    }
    return true;
  }

  /**
   * Cycle hotbar selection by offset (+1/-1)
   */
  cycleSelection(offset) {
    const newSlot = (this.selectedHotbarSlot + offset + this.hotbarSize) % this.hotbarSize;
    this.selectHotbarSlot(newSlot);
  }

  /**
   * Select slot by number key (1-9)
   */
  selectByNumber(numKey) {
    return this.selectHotbarSlot(numKey - 1);
  }

  // ============================================================
  // Add Items
  // ============================================================

  /**
   * Add an item to inventory, stacking on existing stacks first.
   * @param {*} typeId - Block type ID (number) or named item (string)
   * @param {number} count - Number of items to add
   * @returns {object} { added: number, remaining: number }
   */
  addItem(typeId, count = 1) {
    if (count <= 0) return { added: 0, remaining: 0 };

    let remaining = count;
    const maxStack = this.getMaxStack(typeId);

    // First pass: try to stack onto existing slots
    for (let i = 0; i < this.totalSlots; i++) {
      if (remaining <= 0) break;
      const slot = this.slots[i];
      if (slot && this.itemsMatch(slot.typeId, typeId)) {
        const space = maxStack - slot.count;
        if (space > 0) {
          const add = Math.min(space, remaining);
          slot.count += add;
          remaining -= add;
          this._notifySlotChange(i);
        }
      }
    }

    // Second pass: fill empty slots
    for (let i = 0; i < this.totalSlots; i++) {
      if (remaining <= 0) break;
      if (this.slots[i] === null) {
        const add = Math.min(maxStack, remaining);
        this.slots[i] = { typeId, count: add };
        remaining -= add;
        this._notifySlotChange(i);
      }
    }

    return { added: count - remaining, remaining };
  }

  /**
   * Add an item to a specific slot (used for drag/drop)
   */
  addToSlot(index, typeId, count = 1) {
    if (index < 0 || index >= this.totalSlots) return false;
    const maxStack = this.getMaxStack(typeId);

    const slot = this.slots[index];
    if (slot === null) {
      this.slots[index] = { typeId, count: Math.min(maxStack, count) };
      this._notifySlotChange(index);
      return true;
    }
    if (this.itemsMatch(slot.typeId, typeId)) {
      const space = maxStack - slot.count;
      if (space > 0) {
        slot.count += Math.min(space, count);
        this._notifySlotChange(index);
        return true;
      }
    }
    return false;
  }

  // ============================================================
  // Remove Items
  // ============================================================

  /**
   * Remove items by type. Removes from most-full stacks first.
   * @param {*} typeId - Block type ID or named item
   * @param {number} count - Number to remove
   * @returns {object} { removed: number, remaining: number } (remaining = still in inventory)
   */
  removeItem(typeId, count = 1) {
    if (count <= 0) return { removed: 0 };

    let remainingToRemove = count;

    // Find all matching slots and sort by count descending (remove from fullest first)
    const matchingSlots = [];
    for (let i = 0; i < this.totalSlots; i++) {
      const slot = this.slots[i];
      if (slot && this.itemsMatch(slot.typeId, typeId)) {
        matchingSlots.push({ index: i, count: slot.count });
      }
    }
    matchingSlots.sort((a, b) => b.count - a.count);

    for (const ms of matchingSlots) {
      if (remainingToRemove <= 0) break;
      const slot = this.slots[ms.index];
      if (!slot) continue;

      const remove = Math.min(slot.count, remainingToRemove);
      slot.count -= remove;
      remainingToRemove -= remove;

      if (slot.count <= 0) {
        this.slots[ms.index] = null;
      }
      this._notifySlotChange(ms.index);
    }

    return { removed: count - remainingToRemove };
  }

  /**
   * Remove one item from a specific slot. Returns the item or null.
   */
  removeFromSlot(index) {
    if (index < 0 || index >= this.totalSlots) return null;
    const slot = this.slots[index];
    if (!slot) return null;

    // If stack > 1, decrement count
    if (slot.count > 1) {
      slot.count--;
      this._notifySlotChange(index);
    } else {
      // Remove the slot entirely
      const item = { ...slot };
      this.slots[index] = null;
      this._notifySlotChange(index);
      return item;
    }
    return { typeId: slot.typeId, count: 1 };
  }

  /**
   * Clear all items from inventory
   */
  clear() {
    for (let i = 0; i < this.totalSlots; i++) {
      if (this.slots[i] !== null) {
        this.slots[i] = null;
        this._notifySlotChange(i);
      }
    }
    return true;
  }

  // ============================================================
  // Block Break/Place Integration
  // ============================================================

  /**
   * Handle breaking a block — add the drop to inventory.
   * Uses BLOCK_PROPERTIES.drop to determine what item is added.
   * @param {number} blockType - The block type that was broken
   * @returns {boolean} Whether the item was successfully added
   */
  addBlockDrop(blockType) {
    // Import BLOCK_PROPERTIES dynamically (available in browser context)
    const props = this._getBlockProperties(blockType);
    if (!props) return false;

    // Unbreakable blocks don't drop anything
    if (props.hardness === -1) return false;

    let dropTypeId = null;

    if (props.drop !== null) {
      // Mineable blocks drop named items
      if (props.mineable) {
        dropTypeId = props.drop; // e.g., 'coal', 'iron_ore'
      } else if (props.foodItem) {
        dropTypeId = props.drop; // e.g., 'apple'
      } else {
        // Regular blocks drop themselves (or their drop type, e.g. grass → dirt)
        dropTypeId = props.drop === null ? blockType : props.drop;
      }
    } else {
      // No explicit drop — default to the block itself
      dropTypeId = blockType;
    }

    if (dropTypeId === null || dropTypeId === 0) return false;

    const result = this.addItem(dropTypeId, 1);
    return result.added > 0;
  }

  /**
   * Handle placing a block — remove from selected hotbar slot.
   * @returns {object|null} The placed item info, or null if nothing to place
   */
  consumeSelectedBlock() {
    const item = this.getSelectedItem();
    if (!item) return null;

    // Only allow placing blocks (numeric typeIds), not named items from hotbar
    // Named items in hotbar are for food/tools/etc.
    if (typeof item.typeId !== 'number') return null;

    const result = this.removeFromSlot(this.hotbarSlotIndex(this.selectedHotbarSlot));
    return result;
  }

  /**
   * Check if player has a specific block type to place
   */
  canPlaceBlock(typeId) {
    if (typeof typeId !== 'number') return false;
    const item = this.getSelectedItem();
    return item && item.typeId === typeId;
  }

  // ============================================================
  // Query Helpers
  // ============================================================

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
  }

  /**
   * Check if inventory contains any of a given type
   */
  hasItem(typeId) {
    return this.countItem(typeId) > 0;
  }

  /**
   * Count empty slots
   */
  countEmptySlots() {
    let count = 0;
    for (let i = 0; i < this.totalSlots; i++) {
      if (this.slots[i] === null) count++;
    }
    return count;
  }

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
  }

  /**
   * Check if inventory is full (no room for any more items)
   */
  isFull() {
    return this.countEmptySlots() === 0 && !this._hasStackSpace();
  }

  _hasStackSpace() {
    for (let i = 0; i < this.totalSlots; i++) {
      const slot = this.slots[i];
      if (slot) {
        const maxStack = this.getMaxStack(slot.typeId);
        if (slot.count < maxStack) return true;
      }
    }
    return false;
  }

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
  }

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
  }

  // ============================================================
  // Serialization
  // ============================================================

  /**
   * Serialize inventory to JSON-safe object for IndexedDB persistence
   */
  serialize() {
    const slots = [];
    for (let i = 0; i < this.totalSlots; i++) {
      const slot = this.slots[i];
      if (slot) {
        slots.push({ index: i, typeId: slot.typeId, count: slot.count });
      }
    }
    return {
      rows: this.rows,
      cols: this.cols,
      selectedHotbarSlot: this.selectedHotbarSlot,
      slots: slots,
    };
  }

  /**
   * Deserialize inventory from saved data
   */
  static deserialize(data) {
    const rows = data.rows || 4;
    const cols = data.cols || 9;
    const inv = new Inventory(rows, cols);

    if (data.selectedHotbarSlot !== undefined) {
      inv.selectedHotbarSlot = Math.min(data.selectedHotbarSlot, cols - 1);
    }

    for (const slotData of (data.slots || [])) {
      if (slotData.index >= 0 && slotData.index < inv.totalSlots) {
        inv.slots[slotData.index] = {
          typeId: slotData.typeId,
          count: Math.max(1, slotData.count),
        };
      }
    }

    return inv;
  }

  // ============================================================
  // Drag and Drop (UI Integration)
  // ============================================================

  /**
   * Swap two slots. Returns true if swap occurred.
   */
  swapSlots(from, to) {
    if (from === to) return false;
    if (from < 0 || from >= this.totalSlots || to < 0 || to >= this.totalSlots) return false;

    const temp = this.slots[from];
    this.slots[from] = this.slots[to];
    this.slots[to] = temp;

    this._notifySlotChange(from);
    this._notifySlotChange(to);
    return true;
  }

  /**
   * Split a stack — move half to another slot
   */
  splitStack(from, to) {
    const fromSlot = this.slots[from];
    if (!fromSlot || fromSlot.count <= 1) return false;

    const toSlot = this.slots[to];
    if (toSlot && !this.itemsMatch(toSlot.typeId, fromSlot.typeId)) return false;

    const moveCount = Math.ceil(fromSlot.count / 2);
    const maxStack = this.getMaxStack(fromSlot.typeId);

    let space = maxStack;
    if (toSlot) {
      space = maxStack - toSlot.count;
    }
    const actualMove = Math.min(moveCount, space);

    fromSlot.count -= actualMove;
    if (fromSlot.count <= 0) {
      this.slots[from] = null;
    }

    if (!toSlot) {
      this.slots[to] = { typeId: fromSlot.typeId, count: actualMove };
    } else {
      toSlot.count += actualMove;
    }

    this._notifySlotChange(from);
    this._notifySlotChange(to);
    return true;
  }

  // ============================================================
  // Internal Helpers
  // ============================================================

  _slotsEqual(a, b) {
    if (a === null && b === null) return true;
    if (a === null || b === null) return false;
    return a.typeId === b.typeId && a.count === b.count;
  }

  _notifySlotChange(index) {
    if (this.onSlotChange) {
      this.onSlotChange(index, this.slots[index]);
    }
  }

  /**
   * Get block properties — uses BLOCK_PROPERTIES from chunkData if available,
   * otherwise falls back to inline defaults for testing.
   */
  _getBlockProperties(blockType) {
    // Try to access from global (browser context with Three.js setup)
    if (typeof window !== 'undefined' && window.BLOCK_PROPERTIES) {
      return window.BLOCK_PROPERTIES[blockType];
    }
    // Fallback: inline block properties for Node.js testing
    return _INLINE_BLOCK_PROPERTIES[blockType];
  }
}

// ============================================================
// Inline Block Properties (for Node.js test environment)
// Mirrors BLOCK_PROPERTIES from chunkData.js
// ============================================================

const _INLINE_BLOCK_PROPERTIES = {
  0:  { solid: false, transparent: true, hardness: 0, damage: 0, drop: null },
  1:  { solid: true, transparent: false, hardness: 0.6, damage: 0, drop: 2 }, // GRASS → DIRT
  2:  { solid: true, transparent: false, hardness: 0.5, damage: 0, drop: null },
  3:  { solid: true, transparent: false, hardness: 3.0, damage: 0, drop: null },
  4:  { solid: true, transparent: false, hardness: 0.5, damage: 0, drop: null },
  5:  { solid: true, transparent: false, hardness: 0.6, damage: 0, drop: null },
  6:  { solid: false, transparent: true, hardness: 0, damage: 0, drop: null, drinkable: true },
  7:  { solid: true, transparent: false, hardness: 2.0, damage: 0, drop: null, craftable: true },
  8:  { solid: false, transparent: true, hardness: 0.2, damage: 0, drop: null },
  9:  { solid: true, transparent: false, hardness: 0.3, damage: 0, drop: null },
  10: { solid: true, transparent: false, hardness: 0.5, damage: 0, drop: null, slippery: true },
  11: { solid: true, transparent: false, hardness: -1, damage: 0, drop: null }, // BEDROCK unbreakable
  12: { solid: true, transparent: false, hardness: 2.0, damage: 0, drop: null, craftable: true },
  13: { solid: true, transparent: false, hardness: 50.0, damage: 0, drop: null },
  14: { solid: true, transparent: false, hardness: 4.0, damage: 0, drop: null },
  15: { solid: false, transparent: true, hardness: 0, damage: 4, drop: null, animated: true },
  16: { solid: true, transparent: false, hardness: 3.5, damage: 0, drop: null },
  17: { solid: false, transparent: true, hardness: 0, damage: 2, drop: null, animated: true },
  18: { solid: true, transparent: false, hardness: 3.0, damage: 0, drop: 'coal', mineable: true },
  19: { solid: true, transparent: false, hardness: 3.0, damage: 0, drop: 'iron_ore', mineable: true },
  20: { solid: true, transparent: false, hardness: 3.0, damage: 0, drop: 'gold_ore', mineable: true },
  21: { solid: true, transparent: false, hardness: 3.0, damage: 0, drop: 'diamond', mineable: true },
  22: { solid: true, transparent: false, hardness: 2.0, damage: 0, drop: 'corrupt_crystal', questItem: true },
  23: { solid: true, transparent: false, hardness: 0.5, damage: 0, drop: null, placeable: true },
  24: { solid: false, transparent: true, hardness: 0, damage: 0, drop: 'apple', foodItem: true },
  25: { solid: true, transparent: false, hardness: 0.5, damage: 0, drop: null, questItem: true },
  26: { solid: false, transparent: true, hardness: -1, damage: 0, drop: null }, // BOSS_SPAWN invisible
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Inventory, ITEM_CATEGORIES, MAX_STACKS, NAMED_ITEMS };

}