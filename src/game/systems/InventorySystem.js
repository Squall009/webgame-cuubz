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
 *
 * This file owns the state, the identity of a slot, the selection, and serialization.
 * The rest of the class lives in sibling files and is attached to `Inventory.prototype`
 * at the bottom:
 *
 *   ../data/ItemDefinitions.js   ITEM_CATEGORIES, MAX_STACKS, NAMED_ITEMS (a real module)
 *   EquipmentSystem.js           the armor slots, and the slot vocabulary
 *   InventoryItemTypes.js        category / max stack / display name / equality
 *   InventoryQuery.js            the read-only counts and searches
 *   InventoryStacks.js           add, remove, clear, swap, split  (D-65 lives here)
 *   InventoryBlockItems.js       the methods that reach into BlockRegistry
 *
 * ─── WHY PROTOTYPE MIXINS AND NOT COMPOSITION (decision 44) ─────────────────
 *
 * `Inventory` is one class whose methods share eleven instance fields, and `slots` and
 * `totalSlots` alone are touched by twenty-three of them. Splitting that into collaborating
 * objects means rewriting every one of those references AND every call site — `src/ui/`,
 * `src/core/init/`, three loop steps and `test/test_inventory.js` — in the same change that
 * moves 600 lines.
 *
 * So the methods MOVED, verbatim, into plain objects, and `Object.assign` puts them back on
 * the prototype below. `this` is unchanged in every body; `inventory.getEquipmentStats()`
 * still resolves; `Inventory.deserialize(data)` still resolves. Each sibling's header
 * records how many `this.` fields cross its boundary, because that count — not the topic —
 * is what says whether a seam is real. Only `ItemDefinitions.js` is a real module rather
 * than a mixin, because its seam is genuinely zero-crossing: it is data.
 *
 * ─── SEAMS BEYOND THE THREE THE INVENTORY MEASURED ──────────────────────────
 *
 * `PR20_HANDOFF.md` §4.3 named ItemDefinitions, EquipmentSystem and the block-properties
 * group. Those three leave this file at ~650 lines, over the 400 ceiling, so three more
 * cuts were made and they were chosen by fewest fields crossing, not by topic:
 * `InventoryItemTypes.js` (0 — those four bodies contain no `this` at all),
 * `InventoryQuery.js` (2, both read-only) and `InventoryStacks.js` (the same 2, written).
 *
 * ─── WHAT DID NOT BECOME A FILE ─────────────────────────────────────────────
 *
 * Hotbar selection stayed here. `refactor.md` §9 PR 24 says to move `hotbarSlotIndex`,
 * `selectByNumber` and `cycleSelection` to `src/ui/hud/Hotbar.js`; that row is wrong twice.
 * Those three read five constructor-owned fields — `hotbarStart`, `hotbarSize`,
 * `selectedHotbarSlot`, `cols`, `onSelectionChange` — which six other methods in this file
 * also use, so it is not a seam; and `src/ui/hud/Hotbar.js` already exists (PR 17) as pure
 * canvas/atlas icon rendering with no slot-selection logic in it, so the filename is
 * occupied by an unrelated concern.
 *
 * ─── EXPORT SURFACE: UNCHANGED ──────────────────────────────────────────────
 *
 * `Inventory`, `ITEM_CATEGORIES`, `MAX_STACKS`, `NAMED_ITEMS`, `EQUIPMENT_SLOTS`,
 * `EQUIPMENT_SLOT_ORDER` and `getEquipmentSlotForItem` are all still exported from THIS
 * path, so `src/core/init/initInventory.js`, `src/engine/loop/steps/CombatStep.js`,
 * `src/ui/overlays/InventoryScreen.js`, `test/test_inventory.js` and
 * `test/test_hotbarScroll.js` are byte-identical.
 *
 * The dead `import { getItemCategory } from '../../multiplayer/InventorySync.js'` is gone.
 * It was shadowed by the class method of the same name and never read, and it made a
 * `src/game/systems/` module depend on `src/multiplayer/`. (`src/multiplayer/InventorySync.js`
 * used to carry its own duplicate `NAMED_ITEM_META` / `getItemCategory` / `getMaxStackSize`,
 * five of whose ten entries disagreed with the canonical table. PR 23's later step deleted
 * them: it imports `NAMED_ITEMS` / `MAX_STACKS` from `src/game/data/ItemDefinitions.js` like
 * everyone else now — BUGS.md D-64.)
 */

import { ITEM_CATEGORIES, MAX_STACKS, NAMED_ITEMS } from '../data/ItemDefinitions.js';
import { EQUIPMENT_SLOTS, EQUIPMENT_SLOT_ORDER, EquipmentMethods, getEquipmentSlotForItem } from './EquipmentSystem.js';
import { BlockItemMethods } from './InventoryBlockItems.js';
import { ItemTypeMethods } from './InventoryItemTypes.js';
import { QueryMethods } from './InventoryQuery.js';
import { StackMethods } from './InventoryStacks.js';

// Re-exported under their original names so no importer has to change. The definitions
// moved to files that sit BELOW this one in the import graph — `src/` has no import cycles
// and must not gain one, because `test/helpers/esmRequire.js` resolves a cycle to
// `undefined` rather than to the value (D-28).
export { ITEM_CATEGORIES, MAX_STACKS, NAMED_ITEMS };
export { EQUIPMENT_SLOTS, EQUIPMENT_SLOT_ORDER, getEquipmentSlotForItem };

// ============================================================
// Inventory Class
// ============================================================

export class Inventory {
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

    // Equipment slots: helmet, chestplate, leggings, boots
    // Each slot: { typeId, count } or null if empty
    this.equipment = {
      helmet: null,
      chestplate: null,
      leggings: null,
      boots: null,
    };

    // Callbacks for UI/game integration
    this.onSlotChange = null;
    this.onSelectionChange = null;
    this.onEquipmentChange = null;
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
  // Block Break/Place Integration
  // ============================================================

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

    // Serialize equipment
    const eq = {};
    for (const slot of EQUIPMENT_SLOT_ORDER) {
      if (this.equipment[slot]) {
        eq[slot] = { typeId: this.equipment[slot].typeId, count: this.equipment[slot].count };
      }
    }

    return {
      rows: this.rows,
      cols: this.cols,
      selectedHotbarSlot: this.selectedHotbarSlot,
      slots: slots,
      equipment: eq,
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

    // Deserialize equipment
    if (data.equipment) {
      for (const slot of EQUIPMENT_SLOT_ORDER) {
        if (data.equipment[slot]) {
          inv.equipment[slot] = {
            typeId: data.equipment[slot].typeId,
            count: Math.max(1, data.equipment[slot].count),
          };
        }
      }
    }

    return inv;
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
}

// ============================================================
// PROTOTYPE MIXINS — the method groups, put back on the class
// ============================================================
//
// Order is irrelevant: no two of these objects define the same method name, and the guard
// below throws at module load if that ever stops being true. A silent overwrite is the one
// failure mode a mixin split has that a single class does not — two files defining
// `addToSlot` would leave whichever assigned last, with no error, which is the
// shared-global-scope collision class `refactor.md` §2 and `test_globalCollisions.js` exist
// for. `Object.assign` copies own enumerable properties: an object literal's methods are
// exactly that.
const MIXINS = [
  ['InventoryItemTypes', ItemTypeMethods],
  ['InventoryQuery', QueryMethods],
  ['InventoryStacks', StackMethods],
  ['InventoryBlockItems', BlockItemMethods],
  ['EquipmentSystem', EquipmentMethods],
];

{
  const seen = new Map();
  for (const [file, methods] of MIXINS) {
    for (const name of Object.keys(methods)) {
      const prior = seen.get(name) ||
        (Object.prototype.hasOwnProperty.call(Inventory.prototype, name) ? 'the class body' : null);
      if (prior) {
        throw new Error(`[InventorySystem] Mixin collision: '${name}' is defined by both ` +
          `${prior} and ${file}.js. Two files cannot own the same method.`);
      }
      seen.set(name, file + '.js');
    }
  }
}

Object.assign(Inventory.prototype, ...MIXINS.map(([, methods]) => methods));
