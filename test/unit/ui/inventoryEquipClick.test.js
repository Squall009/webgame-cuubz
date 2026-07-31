/**
 * Cuubz — equipment-slot click tests (PR 26, BUGS.md D-52)
 *
 * ─── THE BUG ────────────────────────────────────────────────────────────────
 *
 * `InventoryDrag.js`'s `mousedown` recorded either `{ slot }` (an inventory slot) or
 * `{ equipSlot }` (an armour slot). `mouseup` then read `const fromIdx =
 * _invClickStart.slot;` and **nulled `_invClickStart` on the very next line** — so the
 * equipment-click branch 112 lines further down, guarded by
 * `if (_invClickStart && _invClickStart.equipSlot)`, was permanently false.
 *
 * It failed *silently* rather than throwing: `fromIdx` was `undefined`, and
 * `Inventory.getSlot(undefined)` tests `index < 0 || index >= totalSlots` — both false
 * for `undefined` — so it returned `this.slots[undefined]`, i.e. `undefined`, and the
 * `if (fromSlot)` below it short-circuited. Clicking a helmet did nothing at all.
 *
 * ─── WHY THESE TESTS EXIST ──────────────────────────────────────────────────
 *
 * The inventory overlay is the one UI surface with **zero** automated coverage — the e2e
 * harness opens the crafting screen but never touches an `.equipment-slot`. So the fix
 * ships with the handler driven directly, against a real `Inventory` and a stub document
 * that captures the three `document`-level listeners. `test_hotbarScroll.js` is the model.
 */

import { it } from 'vitest';
import { legacy } from '../../helpers/legacy.js';
import { installInventoryDrag } from '../../../src/ui/overlays/InventoryDrag.js';
import { Inventory } from '../../../src/game/systems/InventorySystem.js';

it('inventoryEquipClick', () => legacy(async () => {
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) { passed++; console.log(`  ✅ ${message}`); }
  else { failed++; console.log(`  ❌ ${message}`); }
}
function assertEquals(actual, expected, message) {
  assert(actual === expected, `${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
}

// ── A document stub that just banks the three listeners ──────────────────────
const handlers = {};
global.document = {
  addEventListener(type, fn) { handlers[type] = fn; },
  removeEventListener(type) { delete handlers[type]; },
  createElement() { return { style: {}, appendChild() {}, remove() {} }; },
  body: { appendChild() {} },
  elementFromPoint() { return null; },
};




/** `e.target.closest(sel)` is the only DOM method the handler calls on an event. */
function slotTarget(kind, value) {
  const el = { dataset: { slot: value } };
  return { closest: (sel) => (sel === `.${kind}` ? el : null) };
}

function makeState(inventory) {
  const calls = { render: 0, hotbar: 0 };
  return {
    inventoryOpen: true,
    inventory,
    addTeardown() {},
    renderInventoryCraftingUI() { calls.render++; },
    updateHotbarUI() { calls.hotbar++; },
    renderItemIcon() {},
    _calls: calls,
  };
}

/** One press-and-release in the same place — a click, not a drag (`dist <= 5`). */
function click(target, x = 100, y = 100) {
  handlers.mousedown({ button: 0, target, clientX: x, clientY: y, preventDefault() {} });
  handlers.mouseup({ button: 0, target, clientX: x, clientY: y, preventDefault() {} });
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('Group 1: clicking an occupied equipment slot unequips into the inventory');

{
  const inv = new Inventory();
  const state = makeState(inv);
  installInventoryDrag(state);
  assert(typeof handlers.mousedown === 'function' && typeof handlers.mouseup === 'function',
    'installInventoryDrag registered mousedown and mouseup on document');

  inv.equipItem('helmet', 'leather_helmet');
  assert(inv.getEquippedItem('helmet') !== null, 'Fixture: a helmet is equipped');

  click(slotTarget('equipment-slot', 'helmet'));

  assertEquals(inv.getEquippedItem('helmet'), null, 'The helmet slot is empty after the click');
  const landed = inv.slots.filter((s) => s && s.typeId === 'leather_helmet');
  assertEquals(landed.length, 1, 'The helmet landed in exactly one inventory slot');
  assert(state._calls.render > 0 && state._calls.hotbar > 0, 'Both UI repaints were requested');
}

console.log('\nGroup 2: a full inventory re-equips rather than destroying the item');

{
  // The end state alone CANNOT prove this. "Unequip, fail to add, re-equip" and "the
  // branch never ran at all" leave byte-identical inventories — which is exactly the
  // broken behaviour D-52 was, so an end-state-only group here passed under the bug. The
  // trace below is the observable difference: the unequip must actually have happened.
  const inv = new Inventory();

  // Fill every slot with a non-stacking item so `addItem` has nowhere to put the helmet.
  for (let i = 0; i < inv.totalSlots; i++) inv.setSlot(i, { typeId: 'leather_helmet', count: 1 });
  inv.equipItem('chestplate', 'leather_chestplate');

  const trace = [];
  const watched = Object.create(inv);
  watched.unequipItem = function (s) {
    trace.push(`unequip:${s}`);
    return Inventory.prototype.unequipItem.call(inv, s);
  };
  watched.equipItem = function (s, t) {
    trace.push(`equip:${s}`);
    return Inventory.prototype.equipItem.call(inv, s, t);
  };
  const state = makeState(watched);
  installInventoryDrag(state);

  click(slotTarget('equipment-slot', 'chestplate'));

  assertEquals(trace.join(' → '), 'unequip:chestplate → equip:chestplate',
    'The item was really unequipped and then put back — not left untouched by a dead branch');
  assert(state._calls.render > 0 && state._calls.hotbar > 0,
    'and the branch repainted, which the dead-branch fallthrough never did');

  const still = inv.getEquippedItem('chestplate');
  assert(still !== null && still.typeId === 'leather_chestplate',
    'A full inventory leaves the chestplate equipped — the item is not destroyed');
  assertEquals(inv.slots.filter((s) => s && s.typeId === 'leather_chestplate').length, 0,
    'And it did not also appear in the inventory — no duplication');
}

console.log('\nGroup 3: an empty equipment slot is a harmless no-op');

{
  const inv = new Inventory();
  const state = makeState(inv);
  installInventoryDrag(state);

  click(slotTarget('equipment-slot', 'boots'));

  assertEquals(inv.getEquippedItem('boots'), null, 'Nothing appeared in the empty boots slot');
  assertEquals(inv.slots.filter(Boolean).length, 0, 'Nothing appeared in the inventory either');
}

console.log('\nGroup 4: the inventory-slot click path is unchanged');

{
  const inv = new Inventory();
  const state = makeState(inv);
  installInventoryDrag(state);

  // A non-hotbar slot holding a plain item: clicking it moves it to the selected hotbar slot.
  inv.setSlot(0, { typeId: 'stone', count: 4 });
  const hotbarIdx = inv.hotbarSlotIndex(inv.selectedHotbarSlot);

  click(slotTarget('inventory-slot', '0'));

  assertEquals(inv.getSlot(0), null, 'The source slot emptied');
  const moved = inv.getSlot(hotbarIdx);
  assert(moved !== null && moved.typeId === 'stone' && moved.count === 4,
    'The stack moved to the selected hotbar slot — the equipment branch did not swallow it');
}

console.log('\nGroup 5: the equipment branch returns before getSlot(undefined)');

{
  // Before the fix, an equipment click fell through to `inventory.getSlot(fromIdx)` with
  // `fromIdx === undefined`. `getSlot` does not reject `undefined` — it returns
  // `this.slots[undefined]` — so the old code called it on every equipment click.
  const inv = new Inventory();
  assertEquals(inv.getSlot(undefined), undefined,
    'getSlot(undefined) still returns undefined rather than throwing (this is why D-52 was silent)');

  const seen = [];
  const proxied = Object.create(inv);
  proxied.getSlot = function (i) { seen.push(i); return Inventory.prototype.getSlot.call(inv, i); };
  const state = makeState(proxied);
  installInventoryDrag(state);
  inv.equipItem('helmet', 'leather_helmet');

  click(slotTarget('equipment-slot', 'helmet'));

  assertEquals(seen.filter((i) => i === undefined).length, 0,
    'getSlot(undefined) is never called on an equipment click');
}

console.log('\n===================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('===================================');
process.exit(failed > 0 ? 1 : 0);
}));
