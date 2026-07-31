/**
 * Cuubz — pause-menu listener-leak regression tests (PR 26, BUGS.md D-58)
 *
 * ─── THE BUG ────────────────────────────────────────────────────────────────
 *
 * `setupPauseMenu(state, deps)` added **ten** listeners; the cleanup it returned removed
 * **three** — the `document` keydown, resume and exit. The other seven were anonymous
 * arrows on `#setting-tick-interval`, `#setting-chunks-per-tick`, the four
 * `#pause-perf-*` controls and `#pause-pause-time`, so `removeEventListener` had nothing
 * to name. `Bootstrap.js:132-141` runs the previous cleanup and then `Game.js:237` calls
 * `setupPauseMenu` again, once per session — so seven accumulated per session, for ever.
 *
 * That is not just CPU. All seven close over `state`, a per-session `GameState`, and they
 * hang off elements that outlive the session, so **every previous session's renderer,
 * chunkManager, skybox and chunk buffers stayed reachable from the DOM**.
 *
 * ─── WHAT IS ASSERTED ───────────────────────────────────────────────────────
 *
 * The listener count returns to its starting value across a setup/cleanup cycle, and
 * still does across three cycles. Per-element counts are asserted individually, because
 * a total-only check would let one missing `removeEventListener` hide behind a spurious
 * extra one. `test_hotbarScroll.js` is the model for driving a `document`-level handler
 * against a stub.
 *
 * Group 4 covers the other half of the same fix: `ChunkStorage.startFlushTimer` now
 * refuses to schedule on a disposed manager, which is what a stale handler was doing.
 */

import { it } from 'vitest';
import { legacy } from '../../helpers/legacy.js';
import { TEST_DIR as __dirname } from '../../helpers/paths.js';
import fs from 'fs';
import path from 'path';
import { setupPauseMenu } from '../../../src/ui/overlays/PauseMenu.js';
import { ChunkStorageMethods } from '../../../src/engine/world/ChunkStorage.js';

it('pauseMenuListeners', () => legacy(async () => {
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) { passed++; console.log(`  ✅ ${message}`); }
  else { failed++; console.log(`  ❌ ${message}`); }
}
function assertEquals(actual, expected, message) {
  assert(actual === expected, `${message} (expected ${expected}, got ${actual})`);
}

// ── A DOM stub that counts live listeners per element and type ───────────────

/** Every element the pause menu looks up, plus `document` itself. */
const IDS = [
  'pause-menu', 'btn-resume-game', 'debug-stats', 'btn-exit-menu',
  'setting-tick-interval', 'tick-val', 'setting-chunks-per-tick', 'chunks-val',
  'pause-perf-render-distance', 'pause-perf-shadows', 'pause-perf-texture-res',
  'pause-perf-advanced-shading', 'pause-pause-time',
];

/** The seven that D-58 leaked, as `element#type` keys. */
const LEAKED = [
  'setting-tick-interval#input',
  'setting-chunks-per-tick#input',
  'pause-perf-render-distance#change',
  'pause-perf-shadows#change',
  'pause-perf-texture-res#change',
  'pause-perf-advanced-shading#change',
  'pause-pause-time#change',
];

function makeElement(id) {
  return {
    id,
    value: '',
    checked: false,
    textContent: '',
    style: {},
    _listeners: new Map(), // type → Set<fn>
    classList: { add() {}, remove() {}, contains: () => false },
    addEventListener(type, fn) {
      if (!this._listeners.has(type)) this._listeners.set(type, new Set());
      this._listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      const set = this._listeners.get(type);
      if (set) set.delete(fn);
    },
    querySelector() { return null; },
  };
}

let elements = new Map();

global.document = {
  _listeners: new Map(),
  addEventListener: makeElement('document').addEventListener,
  removeEventListener: makeElement('document').removeEventListener,
  getElementById: (id) => elements.get(id) || null,
  exitPointerLock() {},
  get pointerLockElement() { return null; },
};

function resetDom() {
  elements = new Map(IDS.map((id) => [id, makeElement(id)]));
  global.document._listeners = new Map();
}

/** Live listeners on one element, or on every element plus `document`. */
function countOn(target) {
  let n = 0;
  for (const set of target._listeners.values()) n += set.size;
  return n;
}
function totalListeners() {
  let n = countOn(global.document);
  for (const el of elements.values()) n += countOn(el);
  return n;
}
function countKey(key) {
  const [id, type] = key.split('#');
  const el = elements.get(id);
  const set = el && el._listeners.get(type);
  return set ? set.size : 0;
}



/** A fresh per-session state, the way `Game.init()` supplies one. */
function makeSession() {
  return {
    state: {
      game: { paused: false, running: true, stop() {} },
      inventoryOpen: false,
      chunkManager: null,
      renderer: null,
      skybox: { timePaused: false, timeOfDay: 0.5 }, // truthy — gates the 7th listener
      session: null,
    },
    deps: {
      perfSettings: { set() {} }, // truthy — gates the four #pause-perf-* listeners
      syncPerfSettingsUI() {},
      async rebuildAtlasAndMaterials() {},
      showScreen() {},
      stopRenderLoop() {},
      log() {},
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('Group 1: setup registers all ten, cleanup removes all ten');

resetDom();
assertEquals(totalListeners(), 0, 'The stub DOM starts with no listeners');

const first = makeSession();
const cleanup = setupPauseMenu(first.state, first.deps);
const afterSetup = totalListeners();
assertEquals(afterSetup, 10, 'setupPauseMenu registered 10 listeners (3 lifecycle + the 7 D-58 leaked)');

for (const key of LEAKED) {
  assertEquals(countKey(key), 1, `${key} is registered`);
}

assertEquals(typeof cleanup, 'function', 'setupPauseMenu returned a cleanup function');
cleanup();
assertEquals(totalListeners(), 0, 'Cleanup returned the listener count to its starting value');

for (const key of LEAKED) {
  assertEquals(countKey(key), 0, `${key} was removed — this is the D-58 assertion`);
}

console.log('\nGroup 2: three setup/cleanup cycles leave nothing behind');

resetDom();
for (let i = 1; i <= 3; i++) {
  const s = makeSession();
  const c = setupPauseMenu(s.state, s.deps);
  assertEquals(totalListeners(), 10, `Session ${i}: exactly 10 live listeners while the session runs`);
  c();
  assertEquals(totalListeners(), 0, `Session ${i}: back to 0 after exit-to-menu`);
}

console.log('\nGroup 3: an exited session stops answering events — the retention, observed');

// This group used to run three sessions WITHOUT calling cleanup and assert the count was
// `10 * i`. That is true whether cleanup removes ten listeners or three — it never called
// cleanup — so it passed unchanged under the D-58 bug and proved nothing. What the bug
// actually cost is asserted instead: the seven anonymous handlers each closed over their
// own session's `GameState`, so an exited session kept answering events fired at a live
// one, and kept its renderer, chunkManager and skybox reachable from the DOM.
resetDom();
const dead = makeSession();
setupPauseMenu(dead.state, dead.deps)(); // set up, then exit to menu

const live = makeSession();
setupPauseMenu(live.state, live.deps);

// `#pause-pause-time` is one of the seven. Its handler writes `state.skybox.timePaused` on
// whichever session it closed over, so firing it names every session still listening.
const pauseTime = elements.get('pause-pause-time');
pauseTime.checked = false; // unchecked = time paused
for (const fn of pauseTime._listeners.get('change')) fn();

assertEquals(countKey('pause-pause-time#change'), 1,
  'One handler is attached after a session exit — not one per session ever started');
assertEquals(live.state.skybox.timePaused, true, 'The live session answered the event');
assertEquals(dead.state.skybox.timePaused, false,
  'The EXITED session did NOT — its GameState is unreachable from the DOM, which is the whole of D-58');

console.log('\nGroup 4: ChunkStorage.startFlushTimer refuses a disposed manager');



{
  const live = Object.assign(Object.create(ChunkStorageMethods), {
    _disposed: false, _flushIntervalId: null, _flushQueue: new Set(), _flushing: false,
  });
  live.startFlushTimer(60000);
  assert(live._flushIntervalId !== null, 'A live manager still starts its flush timer');
  live.stopFlushTimer();
  assertEquals(live._flushIntervalId, null, 'stopFlushTimer clears it');

  const dead = Object.assign(Object.create(ChunkStorageMethods), {
    _disposed: true, _flushIntervalId: null, _flushQueue: new Set(), _flushing: false,
  });
  dead.startFlushTimer(60000);
  assertEquals(dead._flushIntervalId, null,
    'A DISPOSED manager schedules nothing — a stale pause-menu handler used to pin one for ever');
  if (dead._flushIntervalId) clearInterval(dead._flushIntervalId); // never leave one behind
}

console.log('\nGroup 5: the two dead reads are gone (Task 5)');

{
  // Both files: the handlers moved to PauseMenuSettings.js when naming them pushed
  // PauseMenu.js past the 400-line accept criterion, so the reads could reappear in either.
  const code = ['src/ui/overlays/PauseMenu.js', 'src/ui/overlays/PauseMenuSettings.js']
    .map((rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'))
    .join('\n')
    .split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
  assert(!/getElementById\('setting-render-distance'\)/.test(code),
    "#setting-render-distance is no longer read — the id has never existed in index.html");
  assert(!/getElementById\('distance-val'\)/.test(code),
    '#distance-val is no longer read — same, and both locals were never used again');
}

console.log('\n===================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('===================================');
process.exit(failed > 0 ? 1 : 0);
}));
