/**
 * Cuubz — hotbar scroll-wheel regression tests (D-55, PR 20)
 *
 * D-55: the hotbar advanced TWO slots per scroll notch. Two independent `wheel` paths both
 * called `inventory.cycleSelection()` — a `document`-level listener registered by
 * `src/core/init/initHud.js`, and `src/engine/input/Mouse.js`'s canvas handler, whose
 * accumulated `scrollDelta` `src/engine/loop/steps/WorldStep.js` consumed. A wheel event
 * over the canvas bubbles to `document`, so both fired, and only the loop path cleared
 * `scrollDelta`, so neither was a no-op.
 *
 * PR 20 kept the loop path and deleted the `initHud.js` listener, carrying across the one
 * guard the deleted path had and the survivor lacked (`inventoryOpen`).
 *
 * These tests run the real `worldStep` against a minimal state, plus one structural
 * assertion that the second path has not come back — the shape `test_globalCollisions.js`
 * uses for the same class of defect.
 */

import { it } from 'vitest';
import { legacy } from '../../helpers/legacy.js';
import { TEST_DIR as __dirname } from '../../helpers/paths.js';
import fs from 'fs';
import path from 'path';
import { worldStep } from '../../../src/engine/loop/steps/WorldStep.js';
import { Inventory } from '../../../src/game/systems/InventorySystem.js';

it('hotbarScroll', () => legacy(async () => {
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.log(`  ❌ ${message}`);
  }
}

function assertEquals(actual, expected, message) {
  assert(actual === expected, `${message} (expected ${expected}, got ${actual})`);
}

// `worldStep` reads `document.getElementById('block-tooltip')` after the draw.
if (typeof global.document === 'undefined') {
  global.document = { getElementById: () => null };
}




/**
 * The smallest state `worldStep` will run against. Every optional subsystem is null so the
 * step's own `if (state.x && ...)` guards short-circuit; only the scroll block, the hotbar
 * repaint and the out-of-world rescue actually execute.
 */
function makeState(over) {
  return Object.assign({
    game: { delta: 0.016 },
    frameCount: 1,
    player: { position: { x: 0, y: 70, z: 0 } },
    inventory: new Inventory(),
    mouse: { scrollDelta: 0 },
    inventoryOpen: false,
    updateHotbarUI() {},
    droppedItems: null,
    chunkManager: null,
    biomeEffects: null,
    skybox: null,
    camPos: null,
    mobIntegration: null,
    renderer: {
      getPBRFactory: () => null,
      render: () => {},
      updateSkyColors: () => {},
      scene: { children: [] },
      camera: null,
    },
  }, over);
}

console.log('Hotbar Scroll Tests (D-55)');
console.log('==========================\n');

// ─── Group 1: one notch advances exactly one slot ───────────────────────────
console.log('Group 1: one notch, one slot');
{
  const s = makeState({ mouse: { scrollDelta: 1 } });
  const before = s.inventory.selectedHotbarSlot;
  worldStep(s);
  assertEquals(s.inventory.selectedHotbarSlot, before + 1,
    'One positive notch advances the selection by exactly ONE slot, not two');
  assertEquals(s.mouse.scrollDelta, 0, 'scrollDelta is cleared after the loop consumes it');
}

{
  const s = makeState({ mouse: { scrollDelta: -1 } });
  s.inventory.selectedHotbarSlot = 2;
  const before = s.inventory.selectedHotbarSlot;
  worldStep(s);
  assertEquals(s.inventory.selectedHotbarSlot, before - 1,
    'One negative notch moves the selection back by exactly ONE slot');
}

// A second frame with no new scroll must not move anything — this is what fails if some
// other path starts accumulating into `scrollDelta` without clearing it.
{
  const s = makeState({ mouse: { scrollDelta: 1 } });
  worldStep(s);
  const afterFirst = s.inventory.selectedHotbarSlot;
  worldStep(s);
  assertEquals(s.inventory.selectedHotbarSlot, afterFirst,
    'A frame with scrollDelta === 0 does not move the selection');
}

// ─── Group 2: the inventoryOpen guard ───────────────────────────────────────
console.log('\nGroup 2: scrolling with the inventory open');
{
  const s = makeState({ mouse: { scrollDelta: 1 }, inventoryOpen: true });
  const before = s.inventory.selectedHotbarSlot;
  worldStep(s);
  assertEquals(s.inventory.selectedHotbarSlot, before,
    'Scrolling with the inventory open does NOT cycle the hotbar behind it');
  assertEquals(s.mouse.scrollDelta, 0,
    'scrollDelta is still cleared while the inventory is open — a scroll made with the '
    + 'inventory open must not be replayed on the frame it closes');
}

{
  // Closing the inventory must not replay the swallowed scroll.
  const s = makeState({ mouse: { scrollDelta: 1 }, inventoryOpen: true });
  const before = s.inventory.selectedHotbarSlot;
  worldStep(s);
  s.inventoryOpen = false;
  worldStep(s);
  assertEquals(s.inventory.selectedHotbarSlot, before,
    'A scroll swallowed by the guard is not replayed once the inventory closes');
}

// ─── Group 3: the second path stays gone ────────────────────────────────────
console.log('\nGroup 3: only one wheel path exists');
{
  const srcDir = path.join(__dirname, '..', 'src');

  const initHudSource = fs.readFileSync(path.join(srcDir, 'core', 'init', 'initHud.js'), 'utf8');
  assert(!/addEventListener\(\s*['"]wheel['"]/.test(initHudSource),
    'initHud.js registers no `wheel` listener — the D-55 duplicate path stays deleted');
  assert(!/removeEventListener\(\s*['"]wheel['"]/.test(initHudSource),
    'initHud.js has no orphaned `wheel` teardown registration either');

  // Exactly one `wheel` listener in all of src/, and it is Mouse.js's canvas handler.
  const wheelOwners = [];
  const cycleCallers = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.js')) continue;
      const source = fs.readFileSync(full, 'utf8');
      const rel = path.relative(srcDir, full).replace(/\\/g, '/');
      if (/addEventListener\(\s*['"]wheel['"]/.test(source)) wheelOwners.push(rel);
      // Call sites only — skip the declaration in InventorySystem.js and comment prose.
      for (const line of source.split('\n')) {
        if (/\.cycleSelection\s*\(/.test(line) && !/^\s*(\/\/|\*)/.test(line)) {
          cycleCallers.push(rel);
        }
      }
    }
  })(srcDir);

  assertEquals(wheelOwners.length, 1,
    `Exactly one 'wheel' listener in src/ (found: ${wheelOwners.join(', ') || 'none'})`);
  assertEquals(wheelOwners[0], 'engine/input/Mouse.js',
    'The one `wheel` listener is Mouse.js\'s canvas handler — the input abstraction');
  assertEquals(cycleCallers.length, 1,
    `Exactly one cycleSelection() call site in src/ (found: ${cycleCallers.join(', ') || 'none'})`);
  assertEquals(cycleCallers[0], 'engine/loop/steps/WorldStep.js',
    'The one cycleSelection() call site is the render-loop step, per PR 20\'s ruling');
}

console.log('\n===================================');
console.log(`  Results: ${passed}/${passed + failed} assertions passed, ${failed} failed`);
console.log('===================================');
if (failed === 0) console.log('  🎉 All hotbar scroll tests passing!');
process.exit(failed > 0 ? 1 : 0);
}));
