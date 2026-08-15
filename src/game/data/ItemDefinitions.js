/**
 * Cuubz — Item definitions (PR 23)
 *
 * Split out of `src/game/systems/InventorySystem.js`. Pure data: three DEEP-FROZEN
 * tables (PR 33 / D-72 — they were "frozen by convention", i.e. not frozen) and nothing
 * else. **A real module, not a prototype mixin** — the seam is genuinely
 * zero-crossing (no `this`, no behaviour), which is the one case decision 44 says a real
 * module is the right shape.
 *
 * FIELDS CROSSING THIS BOUNDARY: 0.
 *
 * It also has to be a leaf: `EquipmentSystem.js`, `InventoryItemTypes.js`,
 * `InventoryBlockItems.js` and `InventorySystem.js` all read `NAMED_ITEMS`, and the first
 * three are imported *by* `InventorySystem.js`. Anything they need must sit BELOW them in
 * the graph or `src/` gains an import cycle. This file therefore imports nothing.
 *
 * D-82: that used to end "…which `test/helpers/esmRequire.js` resolves to `undefined`
 * rather than to the value (D-28) — every Node test would go red". **PR 31 deleted that
 * hook.** Vitest loads real ES modules, so a cycle no longer turns the suite red on
 * sight; it resolves the way the browser resolves it, and the failure surfaces later and
 * further away. The leaf rule is kept for that reason, not weakened by it.
 *
 * All three names are still re-exported from `src/game/systems/InventorySystem.js` under
 * their original identifiers, so `test/test_inventory.js`,
 * `src/engine/loop/steps/CombatStep.js` and `src/ui/overlays/InventoryScreen.js` are
 * unchanged.
 *
 * `src/multiplayer/InventorySync.js` used to carry its own duplicate of the item metadata
 * (`NAMED_ITEM_META`) and of `getItemCategory`/`getMaxStackSize` — 10 of the 104 items, five
 * with the wrong `maxStack`, and the other 94 falling through to `resource = 64` so every
 * tool and every piece of armour got a 64-stack over the wire. PR 23's later step deleted
 * all of it; that file imports this one now (BUGS.md D-64).
 */

// ============================================================
// Item Definitions
// ============================================================

/**
 * D-72 — "frozen by convention" is not frozen.
 *
 * The header above called these three tables "frozen-by-convention". They were plain
 * mutable objects exported by reference to every consumer in the process, and PR 23
 * raised the stakes: `src/multiplayer/InventorySync.js` used to hold its own private
 * copy of the item metadata and now **aliases** the shared one
 * (`const MAX_STACK = MAX_STACKS`). A single `NAMED_ITEMS[x].maxStack = …` would have
 * changed stack limits for the inventory UI, the crafting system, the combat weapon
 * lookup and the over-the-wire multiplayer sync at once, with no error raised.
 *
 * No such write exists — verified across `src/`, `test/`, `server/` and `scripts/`.
 * Deep-freezing is what keeps that verifiable rather than remembered: ES modules are
 * strict, so an assignment to a frozen object throws a TypeError at the write instead
 * of silently succeeding.
 *
 * `Object.freeze` alone would not do it. `NAMED_ITEMS` is an object OF objects — a
 * shallow freeze stops `NAMED_ITEMS.coal = …` but allows `NAMED_ITEMS.coal.maxStack = …`,
 * which is the mutation that would actually happen.
 *
 * Defined locally rather than imported from a util: this file's header states that it
 * imports nothing, and that is load-bearing (D-28 — `InventorySystem.js` and the three
 * mixins it imports all read `NAMED_ITEMS`, so anything this file imported would sit
 * below them or close a cycle — see the D-82 note in this file's header for what did and
 * did not change about how a cycle gets caught).
 */
const deepFreeze = (o) => {
  if (o && (typeof o === 'object') && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
};

export const ITEM_CATEGORIES = deepFreeze({
  BLOCK: 'block',       // Placeable blocks (BLOCK_TYPES IDs)
  RESOURCE: 'resource', // Mined resources, quest items (string names)
  FOOD: 'food',         // Consumable food items
  TOOL: 'tool',         // Tools and equipment
});

// Max stack sizes by category
export const MAX_STACKS = deepFreeze({
  [ITEM_CATEGORIES.BLOCK]: 64,
  [ITEM_CATEGORIES.RESOURCE]: 64,
  [ITEM_CATEGORIES.FOOD]: 16,
  [ITEM_CATEGORIES.TOOL]: 1,
});

// Named item definitions (non-block items)
// Each entry: { name, category, maxStack [, durability, damage, attackSpeed, armorValue, armorToughness, foodRestore, foodSaturation ] }
export const NAMED_ITEMS = deepFreeze({
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
  // Kept for the creative palette and for any world that already has one in a chest.
  // No quest requires it any more: `maxStack: 1` means two seal keys could never be
  // carried at once, so the five below replaced it (§4.3).
  quest_key:       { name: 'Quest Key', category: ITEM_CATEGORIES.RESOURCE, maxStack: 1 },
  // ── Seal keys — one per seal, all single-stack ─────────────
  seal_key_verdant:   { name: 'Verdant Seal Key', category: ITEM_CATEGORIES.RESOURCE, maxStack: 1 },
  seal_key_ember:     { name: 'Ember Seal Key', category: ITEM_CATEGORIES.RESOURCE, maxStack: 1 },
  seal_key_frozen:    { name: 'Frozen Seal Key', category: ITEM_CATEGORIES.RESOURCE, maxStack: 1 },
  seal_key_sunken:    { name: 'Sunken Seal Key', category: ITEM_CATEGORIES.RESOURCE, maxStack: 1 },
  seal_key_deepstone: { name: 'Deepstone Seal Key', category: ITEM_CATEGORIES.RESOURCE, maxStack: 1 },
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
});
