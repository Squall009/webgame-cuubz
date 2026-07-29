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

// ============================================================
// Equipment Slot Definitions
// ============================================================

const EQUIPMENT_SLOTS = {
  HELMET: 'helmet',
  CHESTPLATE: 'chestplate',
  LEGGINGS: 'leggings',
  BOOTS: 'boots',
};

const EQUIPMENT_SLOT_ORDER = ['helmet', 'chestplate', 'leggings', 'boots'];

/**
 * Map an item typeId to its equipment slot, or null if not equippable.
 * An item is equippable armor if it has armorValue in NAMED_ITEMS.
 */
function getEquipmentSlotForItem(typeId) {
  if (typeof typeId !== 'string') return null;
  if (!NAMED_ITEMS[typeId] || NAMED_ITEMS[typeId].armorValue === undefined) return null;
  if (typeId.endsWith('_helmet')) return EQUIPMENT_SLOTS.HELMET;
  if (typeId.endsWith('_chestplate')) return EQUIPMENT_SLOTS.CHESTPLATE;
  if (typeId.endsWith('_leggings')) return EQUIPMENT_SLOTS.LEGGINGS;
  if (typeId.endsWith('_boots')) return EQUIPMENT_SLOTS.BOOTS;
  return null;
}

// Named item definitions (non-block items)
// Each entry: { name, category, maxStack [, durability, damage, attackSpeed, armorValue, armorToughness, foodRestore, foodSaturation ] }
const NAMED_ITEMS = {
  // ── Resources ──────────────────────────────────────────────
  coal:            { name: 'Coal', category: ITEM_CATEGORIES.RESOURCE, maxStack: 64 },
  stick:           { name: 'Stick', category: ITEM_CATEGORIES.RESOURCE, maxStack: 64 },
  iron_ore:        { name: 'Iron Ore', category: ITEM_CATEGORIES.RESOURCE, maxStack: 64 },
  gold_ore:        { name: 'Gold Ore', category: ITEM_CATEGORIES.RESOURCE, maxStack: 64 },
  diamond:         { name: 'Diamond', category: ITEM_CATEGORIES.RESOURCE, maxStack: 64 },
  copper_ingot:    { name: 'Copper Ingot', category: ITEM_CATEGORIES.RESOURCE, maxStack: 64 },
  iron_ingot:      { name: 'Iron Ingot', category: ITEM_CATEGORIES.RESOURCE, maxStack: 64 },
  gold_ingot:      { name: 'Gold Ingot', category: ITEM_CATEGORIES.RESOURCE, maxStack: 64 },
  netherite_ingot: { name: 'Netherite Ingot', category: ITEM_CATEGORIES.RESOURCE, maxStack: 64 },
  redstone:        { name: 'Redstone', category: ITEM_CATEGORIES.RESOURCE, maxStack: 64 },
  gunpowder:       { name: 'Gunpowder', category: ITEM_CATEGORIES.RESOURCE, maxStack: 64 },
  leather:         { name: 'Leather', category: ITEM_CATEGORIES.RESOURCE, maxStack: 64 },
  glowstone_dust:  { name: 'Glowstone Dust', category: ITEM_CATEGORIES.RESOURCE, maxStack: 64 },
  sugar:           { name: 'Sugar', category: ITEM_CATEGORIES.RESOURCE, maxStack: 64 },
  corrupt_crystal: { name: 'Corrupt Crystal', category: ITEM_CATEGORIES.RESOURCE, maxStack: 1 },
  ender_pearl:     { name: 'Ender Pearl', category: ITEM_CATEGORIES.RESOURCE, maxStack: 16 },
  ender_eye:       { name: 'Eye of Ender', category: ITEM_CATEGORIES.RESOURCE, maxStack: 6 },
  quest_key:       { name: 'Quest Key', category: ITEM_CATEGORIES.RESOURCE, maxStack: 1 },
  compass:         { name: 'Compass', category: ITEM_CATEGORIES.RESOURCE, maxStack: 1 },
  firework_rocket: { name: 'Firework Rocket', category: ITEM_CATEGORIES.RESOURCE, maxStack: 64 },
  // ── Food ───────────────────────────────────────────────────
  apple:          { name: 'Apple', category: ITEM_CATEGORIES.FOOD, maxStack: 64, foodRestore: 4, foodSaturation: 2.4 },
  cooked_meat:    { name: 'Cooked Meat', category: ITEM_CATEGORIES.FOOD, maxStack: 64, foodRestore: 8, foodSaturation: 12.8 },
  berry:          { name: 'Berry', category: ITEM_CATEGORIES.FOOD, maxStack: 64, foodRestore: 2, foodSaturation: 1.2 },
  bread:          { name: 'Bread', category: ITEM_CATEGORIES.FOOD, maxStack: 64, foodRestore: 5, foodSaturation: 6.0 },
  golden_apple:   { name: 'Golden Apple', category: ITEM_CATEGORIES.FOOD, maxStack: 64, foodRestore: 4, foodSaturation: 9.6 },
  cookie:         { name: 'Cookie', category: ITEM_CATEGORIES.FOOD, maxStack: 64, foodRestore: 2, foodSaturation: 0.4 },
  egg:            { name: 'Egg', category: ITEM_CATEGORIES.FOOD, maxStack: 16, foodRestore: 3, foodSaturation: 0.8 },
  snowball:       { name: 'Snowball', category: ITEM_CATEGORIES.RESOURCE, maxStack: 16 },
  // ── Tools: Wooden ──────────────────────────────────────────
  wooden_sword:   { name: 'Wooden Sword', category: ITEM_CATEGORIES.TOOL, maxStack: 1, damage: 5, attackSpeed: -1.8 },
  wooden_pickaxe: { name: 'Wooden Pickaxe', category: ITEM_CATEGORIES.TOOL, maxStack: 1, damage: 2, attackSpeed: -2.0, miningSpeed: 2.0 },
  wooden_axe:     { name: 'Wooden Axe', category: ITEM_CATEGORIES.TOOL, maxStack: 1, damage: 4, attackSpeed: -3.0, miningSpeed: 2.0 },
  wooden_shovel:  { name: 'Wooden Shovel', category: ITEM_CATEGORIES.TOOL, maxStack: 1, damage: 1, attackSpeed: -1.0, miningSpeed: 2.0 },
  wooden_hoe:     { name: 'Wooden Hoe', category: ITEM_CATEGORIES.TOOL, maxStack: 1, damage: 0, attackSpeed: 0 },
  wooden_spear:   { name: 'Wooden Spear', category: ITEM_CATEGORIES.TOOL, maxStack: 1, damage: 6, attackSpeed: -2.4 },
  // ── Armor: Wooden ──────────────────────────────────────────
  wooden_helmet:    { name: 'Wooden Helmet', category: ITEM_CATEGORIES.TOOL, maxStack: 1, armorValue: 1, armorToughness: 0 },
  wooden_chestplate:{ name: 'Wooden Chestplate', category: ITEM_CATEGORIES.TOOL, maxStack: 1, armorValue: 2, armorToughness: 0 },
  wooden_leggings:  { name: 'Wooden Leggings', category: ITEM_CATEGORIES.TOOL, maxStack: 1, armorValue: 1, armorToughness: 0 },
  wooden_boots:     { name: 'Wooden Boots', category: ITEM_CATEGORIES.TOOL, maxStack: 1, armorValue: 1, armorToughness: 0 },
  // ── Tools: Stone ───────────────────────────────────────────
  stone_sword:    { name: 'Stone Sword', category: ITEM_CATEGORIES.TOOL, maxStack: 1, damage: 7, attackSpeed: -1.8 },
  stone_pickaxe:  { name: 'Stone Pickaxe', category: ITEM_CATEGORIES.TOOL, maxStack: 1, damage: 3, attackSpeed: -2.0, miningSpeed: 4.0 },
  stone_axe:      { name: 'Stone Axe', category: ITEM_CATEGORIES.TOOL, maxStack: 1, damage: 7, attackSpeed: -3.0, miningSpeed: 4.0 },
  stone_shovel:   { name: 'Stone Shovel', category: ITEM_CATEGORIES.TOOL, maxStack: 1, damage: 1, attackSpeed: -1.0, miningSpeed: 4.0 },
  stone_hoe:      { name: 'Stone Hoe', category: ITEM_CATEGORIES.TOOL, maxStack: 1, damage: 0, attackSpeed: 0 },
  stone_spear:    { name: 'Stone Spear', category: ITEM_CATEGORIES.TOOL, maxStack: 1, damage: 8, attackSpeed: -2.4 },
  // ── Tools: Copper ──────────────────────────────────────────
  copper_sword:   { name: 'Copper Sword', category: ITEM_CATEGORIES.TOOL, maxStack: 1, damage: 6, attackSpeed: -1.8 },
  copper_pickaxe: { name: 'Copper Pickaxe', category: ITEM_CATEGORIES.TOOL, maxStack: 1, damage: 2, attackSpeed: -2.0, miningSpeed: 3.0 },
  copper_axe:     { name: 'Copper Axe', category: ITEM_CATEGORIES.TOOL, maxStack: 1, damage: 6, attackSpeed: -3.0, miningSpeed: 3.0 },
  copper_shovel:  { name: 'Copper Shovel', category: ITEM_CATEGORIES.TOOL, maxStack: 1, damage: 1, attackSpeed: -1.0, miningSpeed: 3.0 },
  copper_hoe:     { name: 'Copper Hoe', category: ITEM_CATEGORIES.TOOL, maxStack: 1, damage: 0, attackSpeed: 0 },
  copper_spear:   { name: 'Copper Spear', category: ITEM_CATEGORIES.TOOL, maxStack: 1, damage: 7, attackSpeed: -2.4 },
  // ── Tools: Iron ────────────────────────────────────────────
  iron_sword:     { name: 'Iron Sword', category: ITEM_CATEGORIES.TOOL, maxStack: 1, damage: 9, attackSpeed: -1.8 },
  iron_pickaxe:   { name: 'Iron Pickaxe', category: ITEM_CATEGORIES.TOOL, maxStack: 1, damage: 3, attackSpeed: -2.0, miningSpeed: 6.0 },
  iron_axe:       { name: 'Iron Axe', category: ITEM_CATEGORIES.TOOL, maxStack: 1, damage: 9, attackSpeed: -3.0, miningSpeed: 6.0 },
  iron_shovel:    { name: 'Iron Shovel', category: ITEM_CATEGORIES.TOOL, maxStack: 1, damage: 2, attackSpeed: -1.0, miningSpeed: 6.0 },
  iron_hoe:       { name: 'Iron Hoe', category: ITEM_CATEGORIES.TOOL, maxStack: 1, damage: 0, attackSpeed: 0 },
  iron_spear:     { name: 'Iron Spear', category: ITEM_CATEGORIES.TOOL, maxStack: 1, damage: 10, attackSpeed: -2.4 },
  // ── Tools: Gold ────────────────────────────────────────────
  golden_sword:   { name: 'Golden Sword', category: ITEM_CATEGORIES.TOOL, maxStack: 1, damage: 5, attackSpeed: -1.4 },
  golden_pickaxe: { name: 'Golden Pickaxe', category: ITEM_CATEGORIES.TOOL, maxStack: 1, damage: 2, attackSpeed: -1.0, miningSpeed: 12.0 },
  golden_axe:     { name: 'Golden Axe', category: ITEM_CATEGORIES.TOOL, maxStack: 1, damage: 7, attackSpeed: -2.0, miningSpeed: 12.0 },
  golden_shovel:  { name: 'Golden Shovel', category: ITEM_CATEGORIES.TOOL, maxStack: 1, damage: 1, attackSpeed: -1.0, miningSpeed: 12.0 },
  golden_hoe:     { name: 'Golden Hoe', category: ITEM_CATEGORIES.TOOL, maxStack: 1, damage: 0, attackSpeed: 0 },
  golden_spear:   { name: 'Golden Spear', category: ITEM_CATEGORIES.TOOL, maxStack: 1, damage: 6, attackSpeed: -1.6 },
  // ── Tools: Diamond ─────────────────────────────────────────
  diamond_sword:  { name: 'Diamond Sword', category: ITEM_CATEGORIES.TOOL, maxStack: 1, damage: 12, attackSpeed: -1.8 },
  diamond_pickaxe:{ name: 'Diamond Pickaxe', category: ITEM_CATEGORIES.TOOL, maxStack: 1, damage: 4, attackSpeed: -2.0, miningSpeed: 8.0 },
  diamond_axe:    { name: 'Diamond Axe', category: ITEM_CATEGORIES.TOOL, maxStack: 1, damage: 9, attackSpeed: -3.0, miningSpeed: 8.0 },
  diamond_shovel: { name: 'Diamond Shovel', category: ITEM_CATEGORIES.TOOL, maxStack: 1, damage: 3, attackSpeed: -1.0, miningSpeed: 8.0 },
  diamond_hoe:    { name: 'Diamond Hoe', category: ITEM_CATEGORIES.TOOL, maxStack: 1, damage: 0, attackSpeed: 0 },
  diamond_spear:  { name: 'Diamond Spear', category: ITEM_CATEGORIES.TOOL, maxStack: 1, damage: 13, attackSpeed: -2.4 },
  // ── Tools: Netherite ───────────────────────────────────────
  netherite_sword:  { name: 'Netherite Sword', category: ITEM_CATEGORIES.TOOL, maxStack: 1, damage: 15, attackSpeed: -1.8 },
  netherite_pickaxe:{ name: 'Netherite Pickaxe', category: ITEM_CATEGORIES.TOOL, maxStack: 1, damage: 5, attackSpeed: -2.0, miningSpeed: 10.0 },
  netherite_axe:    { name: 'Netherite Axe', category: ITEM_CATEGORIES.TOOL, maxStack: 1, damage: 10, attackSpeed: -3.0, miningSpeed: 10.0 },
  netherite_shovel: { name: 'Netherite Shovel', category: ITEM_CATEGORIES.TOOL, maxStack: 1, damage: 4, attackSpeed: -1.0, miningSpeed: 10.0 },
  netherite_hoe:    { name: 'Netherite Hoe', category: ITEM_CATEGORIES.TOOL, maxStack: 1, damage: 0, attackSpeed: 0 },
  netherite_spear:  { name: 'Netherite Spear', category: ITEM_CATEGORIES.TOOL, maxStack: 1, damage: 16, attackSpeed: -2.4 },
  // ── Armor: Leather ─────────────────────────────────────────
  leather_helmet:    { name: 'Leather Cap', category: ITEM_CATEGORIES.TOOL, maxStack: 1, armorValue: 1, armorToughness: 0 },
  leather_chestplate:{ name: 'Leather Tunic', category: ITEM_CATEGORIES.TOOL, maxStack: 1, armorValue: 3, armorToughness: 0 },
  leather_leggings:  { name: 'Leather Pants', category: ITEM_CATEGORIES.TOOL, maxStack: 1, armorValue: 2, armorToughness: 0 },
  leather_boots:     { name: 'Leather Boots', category: ITEM_CATEGORIES.TOOL, maxStack: 1, armorValue: 1, armorToughness: 0 },
  // ── Armor: Chainmail ───────────────────────────────────────
  chainmail_helmet:    { name: 'Chainmail Helmet', category: ITEM_CATEGORIES.TOOL, maxStack: 1, armorValue: 2, armorToughness: 0 },
  chainmail_chestplate:{ name: 'Chainmail Chestplate', category: ITEM_CATEGORIES.TOOL, maxStack: 1, armorValue: 5, armorToughness: 0 },
  chainmail_leggings:  { name: 'Chainmail Leggings', category: ITEM_CATEGORIES.TOOL, maxStack: 1, armorValue: 4, armorToughness: 0 },
  chainmail_boots:     { name: 'Chainmail Boots', category: ITEM_CATEGORIES.TOOL, maxStack: 1, armorValue: 1, armorToughness: 0 },
  // ── Armor: Iron ────────────────────────────────────────────
  iron_helmet:    { name: 'Iron Helmet', category: ITEM_CATEGORIES.TOOL, maxStack: 1, armorValue: 2, armorToughness: 0 },
  iron_chestplate:{ name: 'Iron Chestplate', category: ITEM_CATEGORIES.TOOL, maxStack: 1, armorValue: 6, armorToughness: 0 },
  iron_leggings:  { name: 'Iron Leggings', category: ITEM_CATEGORIES.TOOL, maxStack: 1, armorValue: 5, armorToughness: 0 },
  iron_boots:     { name: 'Iron Boots', category: ITEM_CATEGORIES.TOOL, maxStack: 1, armorValue: 2, armorToughness: 0 },
  // ── Armor: Gold ────────────────────────────────────────────
  golden_helmet:    { name: 'Golden Helmet', category: ITEM_CATEGORIES.TOOL, maxStack: 1, armorValue: 2, armorToughness: 0 },
  golden_chestplate:{ name: 'Golden Chestplate', category: ITEM_CATEGORIES.TOOL, maxStack: 1, armorValue: 5, armorToughness: 0 },
  golden_leggings:  { name: 'Golden Leggings', category: ITEM_CATEGORIES.TOOL, maxStack: 1, armorValue: 3, armorToughness: 0 },
  golden_boots:     { name: 'Golden Boots', category: ITEM_CATEGORIES.TOOL, maxStack: 1, armorValue: 1, armorToughness: 0 },
  // ── Armor: Diamond ─────────────────────────────────────────
  diamond_helmet:    { name: 'Diamond Helmet', category: ITEM_CATEGORIES.TOOL, maxStack: 1, armorValue: 3, armorToughness: 0 },
  diamond_chestplate:{ name: 'Diamond Chestplate', category: ITEM_CATEGORIES.TOOL, maxStack: 1, armorValue: 8, armorToughness: 0 },
  diamond_leggings:  { name: 'Diamond Leggings', category: ITEM_CATEGORIES.TOOL, maxStack: 1, armorValue: 6, armorToughness: 0 },
  diamond_boots:     { name: 'Diamond Boots', category: ITEM_CATEGORIES.TOOL, maxStack: 1, armorValue: 2, armorToughness: 0 },
  // ── Armor: Netherite ───────────────────────────────────────
  netherite_helmet:    { name: 'Netherite Helmet', category: ITEM_CATEGORIES.TOOL, maxStack: 1, armorValue: 3, armorToughness: 3 },
  netherite_chestplate:{ name: 'Netherite Chestplate', category: ITEM_CATEGORIES.TOOL, maxStack: 1, armorValue: 8, armorToughness: 3 },
  netherite_leggings:  { name: 'Netherite Leggings', category: ITEM_CATEGORIES.TOOL, maxStack: 1, armorValue: 6, armorToughness: 3 },
  netherite_boots:     { name: 'Netherite Boots', category: ITEM_CATEGORIES.TOOL, maxStack: 1, armorValue: 3, armorToughness: 3 },

  // ── Mob Drops ────────────────────────────────────────────────
  rotten_flesh:   { name: 'Rotten Flesh', category: ITEM_CATEGORIES.RESOURCE, maxStack: 64 },
  bone:           { name: 'Bone', category: ITEM_CATEGORIES.RESOURCE, maxStack: 64 },
  rabbit_hide:    { name: 'Rabbit Hide', category: ITEM_CATEGORIES.RESOURCE, maxStack: 64 },
  rabbit_meat:    { name: 'Raw Rabbit', category: ITEM_CATEGORIES.FOOD, maxStack: 64, foodRestore: 2, foodSaturation: 1.2 },
  raw_venison:    { name: 'Raw Venison', category: ITEM_CATEGORIES.FOOD, maxStack: 64, foodRestore: 4, foodSaturation: 2.4 },
  corrupt_fang:   { name: 'Corrupt Fang', category: ITEM_CATEGORIES.RESOURCE, maxStack: 64 },
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
    if (typeId === BLOCK_TYPES.CORRUPT_CRYSTAL || typeId === BLOCK_TYPES.QUEST_KEY) return 1; // Corrupt Crystal(38), Quest Key(41)
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
    // Look up from block registry (single source of truth)
    const block = BLOCK_BY_ID[typeId];
    if (block) {
      // Convert 'oak_planks' → 'Oak Planks', 'coal_ore' → 'Coal Ore'
      return block.name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }
    return `Block ${typeId}`;
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
  }

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
  // Equipment (Armor Slots)
  // ============================================================

  /**
   * Check if an item type is equippable armor.
   */
  isEquippable(typeId) {
    return getEquipmentSlotForItem(typeId) !== null;
  }

  /**
   * Get the equipment slot for an item type, or null.
   */
  getEquipmentSlot(typeId) {
    return getEquipmentSlotForItem(typeId);
  }

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
  }

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
  }

  /**
   * Get the equipped item in a slot.
   */
  getEquippedItem(slot) {
    if (!EQUIPMENT_SLOT_ORDER.includes(slot)) return null;
    return this.equipment[slot];
  }

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
  }

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
  // ── VoxelGen terrain blocks (IDs 0-19) ──────────────────────
  0:  { solid: false, transparent: true, hardness: 0, damage: 0, drop: null },                                          // AIR
  1:  { solid: true, transparent: false, hardness: -1, damage: 0, drop: null },                                          // BEDROCK unbreakable
  2:  { solid: true, transparent: false, hardness: 3.0, damage: 0, drop: null },                                         // STONE
  3:  { solid: true, transparent: false, hardness: 0.5, damage: 0, drop: null },                                         // DIRT
  4:  { solid: true, transparent: false, hardness: 0.6, damage: 0, drop: 3 },                                            // GRASS → drops DIRT(3)
  5:  { solid: true, transparent: false, hardness: 0.5, damage: 0, drop: null },                                         // SAND
  6:  { solid: true, transparent: false, hardness: 0.6, damage: 0, drop: null },                                         // GRAVEL
  7:  { solid: false, transparent: true, hardness: 0, damage: 0, drop: null, drinkable: true },                          // WATER
  8:  { solid: true, transparent: false, hardness: 3.0, damage: 0, drop: 'coal', mineable: true },                       // COAL_ORE
  9:  { solid: true, transparent: false, hardness: 3.0, damage: 0, drop: 'iron_ore', mineable: true },                   // IRON_ORE
  10: { solid: true, transparent: false, hardness: 3.0, damage: 0, drop: 'gold_ore', mineable: true },                   // GOLD_ORE
  11: { solid: true, transparent: false, hardness: 3.0, damage: 0, drop: 'diamond', mineable: true },                    // DIAMOND_ORE
  12: { solid: false, transparent: true, hardness: 0, damage: 0, drop: null },                                            // CAVE_AIR (invisible)
  13: { solid: true, transparent: false, hardness: 0.3, damage: 0, drop: null },                                          // SNOW
  14: { solid: true, transparent: false, hardness: 3.0, damage: 0, drop: null },                                          // SNOW_STONE
  15: { solid: false, transparent: true, hardness: 0, damage: 4, drop: null, animated: true },                           // LAVA
  16: { solid: true, transparent: false, hardness: 3.5, damage: 0, drop: null },                                          // TERRACOTTA
  17: { solid: true, transparent: false, hardness: 0.5, damage: 0, drop: null },                                          // RED_SAND
  18: { solid: true, transparent: false, hardness: 0.5, damage: 0, drop: null, slippery: true },                          // ICE
  19: { solid: true, transparent: false, hardness: 0.5, damage: 0, drop: null },                                          // CLAY

  // ── Cuubz-specific decorations & features (IDs 32+) ─────────
  32: { solid: true, transparent: false, hardness: 2.0, damage: 0, drop: null, craftable: true },                        // WOOD_LOG
  33: { solid: false, transparent: true, hardness: 0.2, damage: 0, drop: null },                                          // LEAVES
  34: { solid: true, transparent: false, hardness: 1.5, damage: 0, drop: null, craftable: true },                         // PLANKS
  35: { solid: true, transparent: false, hardness: 50.0, damage: 0, drop: null },                                         // OBSIDIAN (effectively unbreakable)
  36: { solid: true, transparent: false, hardness: 4.0, damage: 0, drop: null },                                          // BLACKSTONE
  37: { solid: false, transparent: true, hardness: 0, damage: 2, drop: null, animated: true },                            // TOXIC_SLIME
  38: { solid: true, transparent: false, hardness: 2.0, damage: 0, drop: 'corrupt_crystal', questItem: true },            // CORRUPT_CRYSTAL
  39: { solid: true, transparent: false, hardness: 0.5, damage: 0, drop: null, placeable: true },                         // BED
  40: { solid: false, transparent: true, hardness: 0, damage: 0, drop: 'apple', foodItem: true },                         // APPLE (food)
  41: { solid: true, transparent: false, hardness: 0.5, damage: 0, drop: null, questItem: true },                         // QUEST_KEY
  42: { solid: false, transparent: true, hardness: 0.1, damage: 0, drop: null },                                          // RED_FLOWER
  43: { solid: false, transparent: true, hardness: 0.1, damage: 0, drop: null },                                          // YELLOW_FLOWER
  44: { solid: false, transparent: true, hardness: 0.2, damage: 0, drop: null },                                          // CAVE_TORCH
  45: { solid: true, transparent: false, hardness: 1.0, damage: 0, drop: null }                                           // GLOWSTONE
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Inventory, ITEM_CATEGORIES, MAX_STACKS, NAMED_ITEMS, EQUIPMENT_SLOTS, EQUIPMENT_SLOT_ORDER, getEquipmentSlotForItem };

}