/**
 * Cuubz — Global Collision Regression Tests
 *
 * All 64+ classic <script> tags in index.html share ONE global scope. When two files
 * declare the same top-level name, the file that loads LAST silently wins and the
 * earlier declaration disappears with no error at all.
 *
 * Eight such collisions existed as of 2026-07-29. Three were live production bugs.
 * They were fixed in refactor.md PR 3; this file is the regression net so they cannot
 * come back — both the three specific bugs, and the collision class as a whole.
 *
 * NOTE: Node.js gives every `require`d file its own module scope, so the collisions
 * are NOT directly reproducible here. These tests therefore assert the properties of
 * the FIX (distinct names, correct lookups, correct thresholds), and delegate the
 * "no duplicates exist" check to scripts/check-globals.js, which parses index.html
 * the way the browser actually loads it.
 *
 * ─── PR 34: BUG 1 IS GONE, AND SO IS HALF OF THE distanceBetween PAIR ───────
 *
 * Bug 1 was `getBossDefinition` — `boss.js`'s lookup into `BOSS_DEFINITIONS` versus
 * `damageSystem.js`'s identically-named lookup into `BOSS_ATTACKS`, where the later
 * script tag won and boss spawning therefore always threw "Unknown boss". PR 34 deleted
 * BOTH files (never constructed anywhere in `src/`), so there are no longer two functions
 * to keep distinct and no `new Boss(id)` to construct. The section is deleted rather than
 * weakened: an assertion about which of two deleted modules owns a name is not coverage.
 * The collision CLASS is still policed — by `no-undef`, by the single-module-script
 * assertion on index.html below, and by the ALLOWED_GLOBAL_WRITES block at the bottom.
 *
 * This is the same shape as the smoothstep note further down, where PR 20's deletion of
 * `AmbientAudio.js` took one of that pair's two re-export assertions.
 */

import { it } from 'vitest';
import { legacy } from '../../helpers/legacy.js';
import { TEST_DIR as __dirname } from '../../helpers/paths.js';
import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';
// Namespace imports: the re-export assertions below compare the *module's* exported
// binding against the canonical one, which is what `require(…).symbol` used to read.
import * as SkyRendererModule from '../../../src/engine/renderer/SkyRenderer.js';
import * as PlayerSyncModule from '../../../src/multiplayer/PlayerSync.js';
import { validateHostInventory } from '../../../src/multiplayer/Host.js';
import { validateInventorySlots } from '../../../src/multiplayer/InventorySync.js';
import { isMobileViewport, MOBILE_MAX_WIDTH_PERF, MOBILE_MAX_WIDTH_HUD } from '../../../src/util/Viewport.js';
import { smoothstep, distanceBetween } from '../../../src/util/MathUtils.js';
// D-90 (3) — the mixin guard, extracted from ChunkMeshBuilder's module-load block so
// that a colliding configuration can be handed to it without importing a module that
// refuses to import.
import { assertNoMixinCollisions, CHUNK_MESH_MIXINS } from '../../../src/engine/renderer/ChunkMeshBuilder.js';

it('globalCollisions', () => legacy(async () => {
let passed = 0;
let failed = 0;
let total = 0;

function assert(condition, message) {
  total++;
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${message}`);
  }
}
function assertTrue(val, msg) { assert(val === true, msg); }
function assertFalse(val, msg) { assert(val === false, msg); }
function assertEquals(actual, expected, msg) {
  assert(actual === expected, `${msg} — expected ${expected}, got ${actual}`);
}
function assertApprox(actual, expected, tol, msg) {
  assert(Math.abs(actual - expected) < tol, `${msg} — expected ~${expected}, got ${actual}`);
}

console.log('=== Global Collision Regression Tests ===\n');

// ═══════════════════════════════════════════════════════════════════
// Bug 1 — getBossDefinition — DELETED BY PR 34, see the header note.
//
// Both owners of the collided name are gone: `src/game/entities/Boss.js` and
// `src/game/systems/DamageSystem.js`. The 30-odd assertions that lived here proved the
// two lookups were distinct functions over disjoint key namespaces and that every entry
// in BOSS_DEFINITIONS constructed. There is nothing left for them to be about.
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// Bug 2 — validateInventory: every client→host inventory sync was rejected
//
// js/multiplayer/host.js:205          validateInventory(playerId, inventory) → {valid, reason}
// js/multiplayer/inventorySync.js:189 validateInventory(slots, maxSlots)     → {valid, errors}
//
// inventorySync.js loads later (index.html:575 vs :572), so it won. host.js:934 called
// it as (playerId, data.inventory), so the playerId STRING was validated as `slots`:
// Array.isArray('p1') === false → always invalid. host.js then logged `valid.reason`,
// which inventorySync's shape does not have → the warning always read "undefined".
// ═══════════════════════════════════════════════════════════════════
console.log('--- Bug 2: validateHostInventory / validateInventorySlots ---');

assert(typeof validateHostInventory === 'function', 'host.js exports validateHostInventory');
assert(typeof validateInventorySlots === 'function', 'inventorySync.js exports validateInventorySlots');
assert(validateHostInventory !== validateInventorySlots, 'The two validators are distinct functions');

// Host accepts a well-formed client inventory sync.
const goodInventory = [
  { type: 'stone', count: 64 },
  null,
  { blockType: 3, count: 1 },
];
const goodResult = validateHostInventory('player-1', goodInventory);
assertTrue(goodResult.valid, 'Host ACCEPTS a well-formed client inventory');

// A playerId is a string; passing it where slots belong must NOT be how this is called.
// Guard the real regression: the host validator reads argument 2, not argument 1.
assertTrue(
  validateHostInventory('player-1', []).valid,
  'Host accepts an empty inventory (playerId string is not mistaken for slots)'
);

// Host rejects malformed input — and `.reason` must be a DEFINED string, since that is
// exactly what host.js:934 logs.
const badCases = [
  ['not-an-array', 'non-array inventory'],
  [null, 'null inventory'],
  [{}, 'object inventory'],
  [Array(101).fill({ type: 'stone', count: 1 }), 'oversized inventory'],
  [['string-slot'], 'non-object slot'],
  [[{ count: 5 }], 'slot missing type/blockType'],
  [[{ type: 'stone', count: -1 }], 'negative count'],
  [[{ type: 'stone', count: 10000 }], 'count over cap'],
];
for (const [inventory, label] of badCases) {
  const r = validateHostInventory('player-1', inventory);
  assertFalse(r.valid, `Host REJECTS ${label}`);
  assert(typeof r.reason === 'string' && r.reason.length > 0, `Rejection of ${label} has a defined .reason`);
}

// The inventorySync validator keeps its own distinct shape ({ valid, errors }).
const slotsResult = validateInventorySlots('not_array');
assertFalse(slotsResult.valid, 'validateInventorySlots rejects a non-array');
assert(Array.isArray(slotsResult.errors), 'validateInventorySlots reports `errors` (not `reason`)');
assertTrue(validateInventorySlots([]).valid, 'validateInventorySlots accepts an empty slot array');

// ═══════════════════════════════════════════════════════════════════
// Bug 3 — isMobileViewport: mobile perf tuning used the wrong breakpoint
//
// js/renderer/performanceOptimizer.js:54 isMobileViewport(screenWidth) → width < 768
// js/multiplayer/playerListHUD.js:63     isMobileViewport()            → width <= 600
//
// playerListHUD.js loads later (index.html:576 vs :544), so its zero-arg version won.
// performanceOptimizer.js:400 passed a width that was silently ignored, and the mobile
// perf threshold became 600 instead of 768.
//
// Fix: one implementation in js/util/viewport.js, two named breakpoints (see the
// deviation note in that file for why they are not collapsed into one number).
// ═══════════════════════════════════════════════════════════════════
console.log('--- Bug 3: isMobileViewport breakpoints ---');

assertEquals(MOBILE_MAX_WIDTH_PERF, 767, 'Perf breakpoint is 767 inclusive (=== the old `< 768`)');
assertEquals(MOBILE_MAX_WIDTH_HUD, 600, 'HUD breakpoint is 600 inclusive (=== the old `<= 600`)');

// The exact boundary assertions refactor.md PR 3 asks for: 599/600/601/767/768/769.
assertTrue(isMobileViewport(599, MOBILE_MAX_WIDTH_HUD), 'HUD: 599 is mobile');
assertTrue(isMobileViewport(600, MOBILE_MAX_WIDTH_HUD), 'HUD: 600 is mobile (inclusive)');
assertFalse(isMobileViewport(601, MOBILE_MAX_WIDTH_HUD), 'HUD: 601 is NOT mobile');

assertTrue(isMobileViewport(599), 'Perf: 599 is mobile');
assertTrue(isMobileViewport(600), 'Perf: 600 is mobile');
assertTrue(isMobileViewport(601), 'Perf: 601 is mobile');
assertTrue(isMobileViewport(767), 'Perf: 767 is mobile (inclusive)');
assertFalse(isMobileViewport(768), 'Perf: 768 is NOT mobile');
assertFalse(isMobileViewport(769), 'Perf: 769 is NOT mobile');

// The argument must actually be honoured — this is precisely what the collision broke.
assertTrue(isMobileViewport(700) !== isMobileViewport(700, MOBILE_MAX_WIDTH_HUD),
  'The breakpoint argument changes the answer at 700px (700 is perf-mobile but not HUD-mobile)');

// No viewport to measure (Node) → not mobile.
assertFalse(isMobileViewport(), 'No width and no window → false');
assertFalse(isMobileViewport(undefined), 'Explicit undefined → false');
assertFalse(isMobileViewport(NaN), 'NaN width → false');

// ═══════════════════════════════════════════════════════════════════
// Bugs 4-8 — the harmless-but-real collisions
// ═══════════════════════════════════════════════════════════════════
console.log('--- Bugs 4-8: consolidated utilities ---');

// smoothstep — was duplicated in skybox.js and ambient.js. skybox.js re-exports mathUtils;
// ambient.js (src/engine/audio/AmbientAudio.js) was DELETED in PR 20 as D-25 triage, so its
// re-export assertion went with it. One collision owner left, one assertion instead of two.
assertEquals(smoothstep(0), 0, 'smoothstep(0) === 0');
assertEquals(smoothstep(1), 1, 'smoothstep(1) === 1');
assertApprox(smoothstep(0.5), 0.5, 1e-9, 'smoothstep(0.5) ≈ 0.5');
assertEquals(smoothstep(-1), 0, 'smoothstep clamps below 0');
assertEquals(smoothstep(2), 1, 'smoothstep clamps above 1');

// The surviving former owner must still expose the identical function.
assertEquals(SkyRendererModule.smoothstep, smoothstep, 'skybox.js re-exports the canonical smoothstep');

// distanceBetween — was duplicated in boss.js and playerSync.js. `boss.js`
// (src/game/entities/Boss.js) was DELETED in PR 34, so its re-export assertion went with
// it, exactly as AmbientAudio's did above. One collision owner left, one assertion.
assertEquals(distanceBetween({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 }), 5, 'distanceBetween 3-4-5 triangle');
assertEquals(distanceBetween({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }), 0, 'distanceBetween to self is 0');
assertApprox(distanceBetween({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }), Math.sqrt(3), 1e-9, 'distanceBetween diagonal');
assertEquals(PlayerSyncModule.distanceBetween, distanceBetween, 'playerSync.js re-exports the canonical distanceBetween');

// fbm2 / applySpline — biomeSystem.js no longer aliases over noise.js's versions.
const biomeSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'engine', 'world', 'BiomeSystem.js'), 'utf8');
assertFalse(/^var fbm2\s*=/m.test(biomeSource), 'biomeSystem.js no longer declares a top-level `fbm2` alias');
assertFalse(/^var applySpline\s*=/m.test(biomeSource), 'biomeSystem.js no longer declares a top-level `applySpline` alias');

// _log — was declared three times (client.js, host.js, game.js) AND consumed by a
// fourth file (input/interaction.js) that never declared it at all.
const readSrc = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
for (const [file, name] of [
  ['src/multiplayer/Client.js', '_clientLog'],
  ['src/multiplayer/Host.js', '_hostLog'],
  ['src/core/Game.js', '_gameLog'],
  ['src/game/systems/BlockInteractionSystem.js', '_interactionLog'],
]) {
  const src = readSrc(file);
  // PR 9 put `export ` in front of every column-0 declaration.
  assert(new RegExp(`^(export )?var ${name}\\b`, 'm').test(src), `${file} declares its own ${name}`);
  assertFalse(/(^|[^\w])_log\s*\(/.test(src.replace(/^\s*[/*].*$/gm, '')), `${file} no longer calls a bare _log()`);
}

// ═══════════════════════════════════════════════════════════════════
// The class-level guard used to be here.
// ═══════════════════════════════════════════════════════════════════
//
// This block shelled out to `scripts/check-globals.js` and asserted its output. PR 3
// wrote that script to prove no name was declared twice across index.html's 65 classic
// <script> tags; PR 9 repointed it at the module boundary, once there was no shared
// global scope left for duplicates to exist in. **PR 11 deleted it**, in the same commit
// that turned on ESLint's `no-undef` — the strictly stronger replacement, and what
// refactor.md §6 PR 11 calls "the payoff". A gate that checks less than the linter does
// still reads as coverage, which is worse than not having it.
//
// The class-level guard is `npm run lint`, and it is a CI step. Two things it caught on
// its first run that check-globals could not have seen:
//
//   D-32  `sumBase` / `sumAmp` assigned without a declaration in BiomeSystem.js — an
//         implicit global under a classic script, a ReferenceError under module strict
//         mode.
//   D-31  `inventoryOpen` referenced from a scope it was never in, so Escape never
//         closed the inventory.
//
// One thing lint does NOT replace, which is why index.html is still asserted below: the
// linter has no opinion about HTML. A classic `<script src>` tag added back to
// index.html would hand whatever it loads a shared global scope again, silently, and
// `no-undef` would never see it.
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scriptTags = [...indexHtml.matchAll(/<script\b([^>]*)\bsrc\s*=\s*["']([^"']+)["']([^>]*)>/gi)];
const classicTags = scriptTags.filter((m) => !/\btype\s*=\s*["']module["']/i.test(m[1] + m[3]));

assertEquals(scriptTags.length, 1, 'index.html loads exactly one <script src>');
assertEquals(classicTags.length, 0,
  'index.html loads NO classic <script src> — a classic tag reinstates the shared global scope this file exists to police');
assert(
  /src="\/src\/index\.js"/.test(indexHtml),
  'index.html\'s single module entry is /src/index.js'
);

// ═══════════════════════════════════════════════════════════════════
// Every write to a property of the global object in src/, by (file, property)
// (PR 12 / BUGS.md D-35, rewritten by PR 33 / BUGS.md D-71)
// ═══════════════════════════════════════════════════════════════════
//
// `check-globals.js` also asserted this, and it is the other half `no-undef` cannot
// replace: `window` is declared readonly in eslint.config.mjs, but assigning to a
// *property* of a readonly global is not a lint error in any rule. So between PR 11
// deleting the script and this block, nothing checked it — which PR 12 noticed while
// deciding whether `src/testBridge.js` could be deleted, and logged as D-35.
//
// ─── D-71: WHAT THIS BLOCK USED TO MISS, AND WHY WIDENING THE REGEX IS WRONG ──
//
// It matched the literal token `window.<name> =` and nothing else, so it saw exactly
// one of the three files that write to the global object:
//
//   • `src/engine/world/workerGeneration.js:1060` assigns
//     `globalScope._voxelgenGenerateChunk`. `globalScope` is the IIFE parameter, and
//     the tail `})(typeof self !== 'undefined' ? self : … window …)` means it IS
//     `window` on the main thread. That is a real second property on `window` — and it
//     is WANTED, because it is D-57's fix (the inline main-thread generation fallback).
//     The old check could not see it, so it could not have been deliberate.
//   • `src/engine/renderer/meshWorker.js` assigns `self.onmessage` / `self.onerror`.
//     Also invisible for the same reason.
//
// The fix is NOT "add `self|globalThis` to the alternation" — that still misses
// `globalScope`, which is the whole point. Nor is it "match any identifier before the
// dot", which makes every `foo.bar = 1` in the tree a hit. So:
//
//   (a) Resolve, PER FILE, which names actually denote the global object: the three
//       literals, plus a name bound by the IIFE-tail idiom, plus `const X = window`.
//       Then match only those.
//   (b) Allowlist (file, PROPERTY) PAIRS, not files. `workerGeneration.js` is exempt
//       for `onmessage`, `onerror` and `_voxelgenGenerateChunk` and for NOTHING else —
//       a fourth property added to that file is a failure, which is what a file-level
//       allowlist could never express.
//
// The rule is not "never touch the global object". It is that the module boundary has a
// small, enumerated set of sanctioned holes, each at a path whose own file explains why.
// A new one added somewhere else is how a codebase drifts back to the shared global
// scope that refactor.md §2 is about — silently, because each assignment looks harmless.
// If a future PR genuinely needs another, change ALLOWED_GLOBAL_WRITES deliberately and
// say why in the PR outcome. Do not delete the assertion to make a build pass.
const ALLOWED_GLOBAL_WRITES = {
  // The one sanctioned bridge — see the header of that file.
  'src/testBridge.js': ['__cuubz'],
  // Web Worker handler installs. Both workers are classic scripts by contract
  // (vite.config.js note 2), so `self` is how they register; this is not module drift.
  'src/engine/renderer/meshWorker.js': ['onerror', 'onmessage'],
  // Same two handlers, plus D-57's main-thread inline-generation fallback, which
  // `src/engine/world/ChunkGenerator.js:51` reads back as `window._voxelgenGenerateChunk`.
  'src/engine/world/workerGeneration.js': ['_voxelgenGenerateChunk', 'onerror', 'onmessage'],
};

/**
 * The names that denote the global object inside one file's source text.
 * `window`/`self`/`globalThis` always, MINUS any of those three the file shadows with a
 * local declaration; plus the IIFE parameter when the call tail is the
 * `typeof self !== 'undefined' ? self : window` idiom; plus `const X = window`.
 *
 * The shadow subtraction is not hypothetical. `src/engine/world/RegionTracker.js:32`
 * writes `const self = this;` — the closure-capture idiom — and then
 * `self._regionCheckTimerId = setTimeout(...)` at :36. Without the subtraction that is
 * reported as a write to `Worker.self`, which is a false positive and precisely the
 * failure mode that makes "just widen the regex" the wrong fix.
 */
function globalAliases(src) {
  const LITERALS = ['window', 'self', 'globalThis'];
  const names = new Set(LITERALS);

  // A literal re-bound as a local is that local, not the global — UNLESS it is rebound
  // to another spelling of the global (`const self = globalThis`), which is still it.
  for (const lit of LITERALS) {
    const decl = src.match(new RegExp(`\\b(?:const|let|var)\\s+${lit}\\s*=\\s*([^;\\n]*)`));
    if (decl && !/^\s*(?:window|self|globalThis)\s*$/.test(decl[1])) names.delete(lit);
  }

  // `})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this));`
  // paired with a `(function (globalScope) {` head.
  if (/\}\s*\)\s*\(\s*typeof\s+(?:self|globalThis|window)\s*!==\s*['"]undefined['"]/.test(src)) {
    const head = src.match(/\(\s*function\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/);
    if (head) names.add(head[1]);
  }
  // `const g = window;` / `let g = globalThis;` / `var g = self;`
  for (const m of src.matchAll(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:window|self|globalThis)\s*(?=[;\n])/g)) {
    names.add(m[1]);
  }
  return [...names];
}

const srcRoot = path.join(__dirname, '..', 'src');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const full = path.join(dir, e.name);
  return e.isDirectory() ? walk(full) : (e.name.endsWith('.js') ? [full] : []);
});

const globalWrites = [];
for (const full of walk(srcRoot)) {
  const raw = fs.readFileSync(full, 'utf8');
  // Strip line comments so the prose in testBridge.js and elsewhere is not a match.
  const body = raw.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
  const rel = path.relative(path.join(__dirname, '..'), full).replace(/\\/g, '/');
  for (const alias of globalAliases(raw)) {
    const re = new RegExp(
      `(^|[^\\w.$])${alias.replace(/\$/g, '\\$')}\\s*\\.\\s*([A-Za-z_$][\\w$]*)\\s*=(?!=)`, 'g');
    for (const m of body.matchAll(re)) globalWrites.push(`${rel} → ${m[2]}`);
  }
}

const expectedGlobalWrites = Object.entries(ALLOWED_GLOBAL_WRITES)
  .flatMap(([file, props]) => props.map((p) => `${file} → ${p}`)).sort();
const actualGlobalWrites = [...new Set(globalWrites)].sort();

assertEquals(actualGlobalWrites.join('\n'), expectedGlobalWrites.join('\n'),
  'Every (file, property) pair in src/ that writes to the global object is one of the ' +
  'six sanctioned ones — no-undef cannot see any of them, because assigning to a ' +
  'property of a readonly global is not a lint error');

// Non-vacuity, checked in-process rather than trusted: the resolver must actually find
// the alias `workerGeneration.js` writes through. If `globalAliases` regressed to the
// three literals, this goes red and the assertion above would silently pass empty.
const wgSrc = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'engine', 'world', 'workerGeneration.js'), 'utf8');
assertTrue(globalAliases(wgSrc).includes('globalScope'),
  'globalAliases() resolves the IIFE parameter `globalScope` in workerGeneration.js — ' +
  'this is the alias the pre-D-71 literal-`window` check was blind to');
assertTrue(actualGlobalWrites.includes('src/engine/world/workerGeneration.js → _voxelgenGenerateChunk'),
  'and the D-57 main-thread fallback write is therefore actually seen by this check');
assertTrue(globalAliases('const g = window;\ng.x = 1;').includes('g'),
  'globalAliases() also resolves the `const X = window` form');
assertFalse(globalAliases('const self = this;\nself.x = 1;').includes('self'),
  'globalAliases() drops a literal the file shadows — `const self = this` is a closure ' +
  'alias, not the worker global (src/engine/world/RegionTracker.js:32 does exactly this)');
assertTrue(globalAliases('const self = globalThis;\nself.x = 1;').includes('self'),
  'but a literal rebound to another spelling of the global is still the global');

// ═══════════════════════════════════════════════════════════════════
console.log(`\n===================================`);
console.log(`Results: ${passed}/${total} passed, ${failed} failed`);
console.log(`===================================`);

// ═══════════════════════════════════════════════════════════════════
// MIXIN COLLISIONS — BUGS.md D-90 (3)
// ═══════════════════════════════════════════════════════════════════
//
// `ChunkMeshBuilder.js` splits its prototype across two mixin files and guards, at module
// load, against a mixin and the class body defining the same method name. A silent
// overwrite is the one failure mode a mixin split has that a single class does not —
// which is the same shared-scope collision class the rest of this file exists for, and
// **this file had never mentioned mixins**. The guard was proved by hand in three
// colliding configurations and had no regression test; D-90 (3) is that gap, and its
// own source comment pointed here.
//
// The guard was extracted from the module-load block to make this possible. It could not
// be exercised in place: injecting a collision means importing a module that refuses to
// import.
{
  console.log('\n--- Mixin collisions (D-90 (3)) ---');

  class Base { alpha() {} }
  const throws = (mixins, proto, why) => {
    let message = null;
    try { assertNoMixinCollisions(mixins, proto); } catch (e) { message = e.message; }
    assert(message !== null, why);
    return message || '';
  };

  // 1 — two mixins claiming the same name.
  {
    const msg = throws(
      [['MixA', { beta() {} }], ['MixB', { beta() {} }]], Base.prototype,
      'two mixins defining the same method collide'
    );
    assert(msg.includes("'beta'"), '...and the message names the method');
    assert(msg.includes('MixA.js') && msg.includes('MixB.js'), '...and names BOTH owners');
  }

  // 2 — a mixin shadowing the class body. This is the dangerous one: `Object.assign`
  // runs after the class is defined, so the mixin wins and the class body's version is
  // simply gone.
  {
    const msg = throws(
      [['MixA', { alpha() {} }]], Base.prototype,
      'a mixin shadowing a class-body method collides'
    );
    assert(msg.includes('the class body'), '...and the message says the class body owns it');
  }

  // 3 — a collision in the SECOND pair, not the first. A guard that only compared
  // neighbours, or that stopped after one mixin, would pass this.
  throws(
    [['MixA', { one() {} }], ['MixB', { two() {} }], ['MixC', { one() {} }]], Base.prototype,
    'a collision between non-adjacent mixins is still caught'
  );

  // And the negative: the shape the real module has must not throw.
  {
    let threw = false;
    try {
      assertNoMixinCollisions([['MixA', { beta() {} }], ['MixB', { gamma() {} }]], Base.prototype);
    } catch { threw = true; }
    assertFalse(threw, 'disjoint mixins over a disjoint class body do not collide');
  }

  // The real configuration, swept rather than assumed: the module already ran this at
  // import time, so reaching this line proves it passed — but assert the sweep was not
  // vacuous, because a guard over an empty list also never throws.
  assert(CHUNK_MESH_MIXINS.length >= 2,
    `ChunkMeshBuilder still has at least two mixins (${CHUNK_MESH_MIXINS.length})`);
  const methodCount = CHUNK_MESH_MIXINS.reduce((n, [, m]) => n + Object.keys(m).length, 0);
  assert(methodCount >= 4, `and the guard swept a real number of methods (${methodCount})`);
}

process.exit(failed === 0 ? 0 : 1);
}));
