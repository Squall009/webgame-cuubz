#!/usr/bin/env node
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
 */

'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

const { Boss, BOSS_DEFINITIONS, getBossDefinition } = require('../src/game/entities/Boss.js');
const { BOSS_ATTACKS, getBossAttackProfile } = require('../src/game/systems/DamageSystem.js');
const { validateHostInventory } = require('../src/multiplayer/Host.js');
const { validateInventorySlots } = require('../src/multiplayer/InventorySync.js');
const {
  isMobileViewport,
  MOBILE_MAX_WIDTH_PERF,
  MOBILE_MAX_WIDTH_HUD,
} = require('../src/util/Viewport.js');
const { smoothstep, distanceBetween } = require('../src/util/MathUtils.js');

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
// Bug 1 — getBossDefinition: boss spawning threw "Unknown boss: ..."
//
// js/entities/boss.js:317        getBossDefinition(bossId)  → BOSS_DEFINITIONS
// js/systems/damageSystem.js:134 getBossDefinition(bossKey) → BOSS_ATTACKS
//
// damageSystem.js loads later (index.html:563 vs :556), so it won. boss.js:362 then
// looked up a BOSS_DEFINITIONS id like 'forest_warden' inside BOSS_ATTACKS, whose keys
// are 'CORRUPT_GUARDIAN'-style. The namespaces are disjoint → always null → always threw.
// ═══════════════════════════════════════════════════════════════════
console.log('--- Bug 1: getBossDefinition / getBossAttackProfile ---');

assert(typeof getBossDefinition === 'function', 'boss.js exports getBossDefinition');
assert(typeof getBossAttackProfile === 'function', 'damageSystem.js exports getBossAttackProfile');
assert(getBossDefinition !== getBossAttackProfile, 'The two lookups are distinct functions');

// The key namespaces must not overlap — that disjointness is what made the bug total.
const defKeys = Object.keys(BOSS_DEFINITIONS);
const atkKeys = Object.keys(BOSS_ATTACKS);
assert(defKeys.length > 0, 'BOSS_DEFINITIONS is non-empty');
assert(atkKeys.length > 0, 'BOSS_ATTACKS is non-empty');
assert(
  defKeys.every((k) => !atkKeys.includes(k)),
  'BOSS_DEFINITIONS and BOSS_ATTACKS key namespaces are disjoint'
);

// Each lookup resolves its OWN table, and returns null for the other's keys.
for (const id of defKeys) {
  assert(getBossDefinition(id) !== null, `getBossDefinition('${id}') resolves`);
  assert(getBossAttackProfile(id) === null, `getBossAttackProfile('${id}') correctly does NOT resolve`);
}
for (const key of atkKeys) {
  assert(getBossAttackProfile(key) !== null, `getBossAttackProfile('${key}') resolves`);
  assert(getBossDefinition(key) === null, `getBossDefinition('${key}') correctly does NOT resolve`);
}

// THE regression test named in refactor.md PR 3: every boss must construct.
for (const id of defKeys) {
  let threw = null;
  try {
    // eslint-disable-next-line no-new
    new Boss(id, { x: 0, y: 64, z: 0 });
  } catch (e) {
    threw = e.message;
  }
  assert(threw === null, `new Boss('${id}') constructs without throwing (got: ${threw})`);
}

// And an genuinely unknown id must still throw — the guard is not simply disabled.
let unknownThrew = false;
try {
  // eslint-disable-next-line no-new
  new Boss('definitely_not_a_boss', { x: 0, y: 64, z: 0 });
} catch (e) {
  unknownThrew = /Unknown boss/.test(e.message);
}
assertTrue(unknownThrew, 'new Boss() still throws "Unknown boss" for a genuinely unknown id');

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

// smoothstep — was duplicated in skybox.js and ambient.js; both now re-export mathUtils.
assertEquals(smoothstep(0), 0, 'smoothstep(0) === 0');
assertEquals(smoothstep(1), 1, 'smoothstep(1) === 1');
assertApprox(smoothstep(0.5), 0.5, 1e-9, 'smoothstep(0.5) ≈ 0.5');
assertEquals(smoothstep(-1), 0, 'smoothstep clamps below 0');
assertEquals(smoothstep(2), 1, 'smoothstep clamps above 1');

// Both former owners must still expose the identical function.
assertEquals(require('../src/engine/renderer/SkyRenderer.js').smoothstep, smoothstep, 'skybox.js re-exports the canonical smoothstep');
assertEquals(require('../src/engine/audio/AmbientAudio.js').smoothstep, smoothstep, 'ambient.js re-exports the canonical smoothstep');

// distanceBetween — was duplicated in boss.js and playerSync.js.
assertEquals(distanceBetween({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 }), 5, 'distanceBetween 3-4-5 triangle');
assertEquals(distanceBetween({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }), 0, 'distanceBetween to self is 0');
assertApprox(distanceBetween({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }), Math.sqrt(3), 1e-9, 'distanceBetween diagonal');
assertEquals(require('../src/game/entities/Boss.js').distanceBetween, distanceBetween, 'boss.js re-exports the canonical distanceBetween');
assertEquals(require('../src/multiplayer/PlayerSync.js').distanceBetween, distanceBetween, 'playerSync.js re-exports the canonical distanceBetween');

// fbm2 / applySpline — biomeSystem.js no longer aliases over noise.js's versions.
const biomeSource = require('fs').readFileSync(
  path.join(__dirname, '..', 'src', 'engine', 'world', 'BiomeSystem.js'), 'utf8');
assertFalse(/^var fbm2\s*=/m.test(biomeSource), 'biomeSystem.js no longer declares a top-level `fbm2` alias');
assertFalse(/^var applySpline\s*=/m.test(biomeSource), 'biomeSystem.js no longer declares a top-level `applySpline` alias');

// _log — was declared three times (client.js, host.js, game.js) AND consumed by a
// fourth file (input/interaction.js) that never declared it at all.
const readSrc = (p) => require('fs').readFileSync(path.join(__dirname, '..', p), 'utf8');
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
// The class-level guard: index.html must have ZERO duplicate top-level symbols.
// This is the check that would have caught all eight in the first place.
// ═══════════════════════════════════════════════════════════════════
console.log('--- Class-level guard: scripts/check-globals.js ---');

let checkOutput = '';
let checkFailed = false;
try {
  checkOutput = execFileSync(
    process.execPath,
    [path.join(__dirname, '..', 'scripts', 'check-globals.js')],
    { encoding: 'utf8' }
  );
} catch (e) {
  checkFailed = true;
  checkOutput = `${e.stdout || ''}${e.stderr || ''}`;
}

// PR 9 repointed this gate. There is no shared global scope left to find duplicates in
// — index.html loads one module — so it now asserts the thing that would bring the
// shared scope back: a classic <script src> tag, a window.* assignment outside the one
// allowlisted bridge, leftover CommonJS in src/, or a module nobody imports. Read the
// header of scripts/check-globals.js. PR 11 deletes the script and this block together,
// in the same commit that turns on `no-undef`.
assertFalse(checkFailed, 'check-globals.js exits 0 (module boundary intact)');
assert(
  /Module boundary intact/.test(checkOutput),
  'check-globals.js reports the module boundary intact'
);
assert(
  /index\.html: 1 module entry, 0 classic <script src> tags/.test(checkOutput),
  'index.html loads exactly one module entry and no classic scripts'
);
if (checkFailed) {
  console.error('\n  check-globals.js output:\n' + checkOutput.split('\n').map((l) => '    ' + l).join('\n'));
}

// ═══════════════════════════════════════════════════════════════════
console.log(`\n===================================`);
console.log(`Results: ${passed}/${total} passed, ${failed} failed`);
console.log(`===================================`);

process.exit(failed === 0 ? 0 : 1);
