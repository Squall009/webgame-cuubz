/**
 * Cuubz — mob solidity has one source (BUGS.md D-56)
 *
 * `src/game/mobs/movement/mobMovement.js` tested solidity as `block !== 0 && block !== 12`
 * at four sites, treating ids 0 and 12 as air.
 *
 *   - **id 12 is `polished_granite`**, `category: 'solid'`. `_resolveAxis` returned false
 *     for it, so `_moveAndCollide` never zeroed the velocity that should have been
 *     blocked — mobs walked through it.
 *   - The same test was wrong in the OTHER direction for water (46) and lava (47): being
 *     neither 0 nor 12 they counted as SOLID, so mobs walked on the surface of oceans
 *     and lava lakes.
 *
 * Two sibling files carried the same rot and are fixed with it:
 *   - `mobManager._findSpawnPosition` scanned for ground with
 *     `!== 0 && !== 12 && !== 7 && !== 15`. 7 is `tuff`, 15 is `deepslate_tiles`.
 *   - `mob.canSee` blocked line of sight with `!== 0 && !== 12`, one line under a comment
 *     that reads "Non-air blocks block line of sight".
 *
 * There were no mob tests in this repo at all before this file.
 */

import { it } from 'vitest';
import { legacy } from '../../helpers/legacy.js';
import { TEST_DIR as __dirname } from '../../helpers/paths.js';
import fs from 'fs';
import path from 'path';
import { BLOCK_BY_NAME, BLOCK_PROPERTIES, BLOCK_REGISTRY } from '../../../src/engine/world/BlockRegistry.js';
import { isAir, isPassable, isSolidBlock } from '../../../src/game/data/BlockCategories.js';
import { _checkStepUp, _moveAndCollide, _resolveAxis, applyFlyingMovement } from '../../../src/game/mobs/movement/mobMovement.js';

it('mobMovement', () => legacy(async () => {
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
function assertTrue(v, m) { assert(v === true, m); }
function assertFalse(v, m) { assert(v === false, m); }
function assertEquals(a, e, m) { assert(a === e, `${m} — expected ${e}, got ${a}`); }

console.log('=== Mob movement solidity tests (D-56) ===\n');

const GRANITE = BLOCK_BY_NAME['polished_granite'].id;   // 12
const WATER = BLOCK_BY_NAME['water'].id;                 // 46
const LAVA = BLOCK_BY_NAME['lava'].id;                   // 47
const STONE = BLOCK_BY_NAME['stone'].id;                 // 2
const TUFF = BLOCK_BY_NAME['tuff'].id;                   // 7
const DEEPSLATE_TILES = BLOCK_BY_NAME['deepslate_tiles'].id; // 15

/** A world where every block at y <= groundY is `fill`, and everything above is air. */
const worldOf = (fill, groundY) => ({
  getBlockAtWorld: (bx, by) => (by <= groundY ? fill : 0),
});

/** A duck-typed mob: exactly the fields mobMovement reads. */
const mobAt = (x, y, z, vx, vy, vz) => ({
  position: { x, y, z },
  velocity: { x: vx, y: vy, z: vz },
  spawnPosition: { x, y, z },
  definition: { hitbox: { width: 0.6, height: 0.9 } },
  speed: 1,
  yaw: 0,
  onGround: false,
  isFlying: false,
  animationTimer: 0,
  aiState: null,
});

// ═══════════════════════════════════════════════════════════════════
// 1 — the exact ids the old predicate got wrong
// ═══════════════════════════════════════════════════════════════════
console.log('--- 1: the ids ---');

assertEquals(GRANITE, 12, 'id 12 is polished_granite');
assertEquals(BLOCK_BY_NAME['polished_granite'].category, 'solid', 'polished_granite is category solid');
assertEquals(TUFF, 7, 'id 7 is tuff');
assertEquals(DEEPSLATE_TILES, 15, 'id 15 is deepslate_tiles');
assertEquals(BLOCK_BY_NAME['air'].id, 0, 'id 0 is air');

// The old predicate, written out, so the delta is stated rather than described.
const oldIsPassable = (b) => b === 0 || b === 12;
const disagreements = BLOCK_REGISTRY
  .map((b) => b.id)
  .filter((id) => oldIsPassable(id) !== isPassable(id))
  .sort((a, b) => a - b);
assertEquals(disagreements.join(','), '12,46,47,104,105,106,107,108,109,110,111,112,113,114,168,170,172,173,174,175,177,178,179,180,181,182,183,184,186,187,188,189,190,191,192',
  'the new predicate differs from `b === 0 || b === 12` at exactly: 12 (granite), 46/47 (water/lava), and every cutout');

// ═══════════════════════════════════════════════════════════════════
// 2 — the predicate itself
// ═══════════════════════════════════════════════════════════════════
console.log('--- 2: isPassable / isSolidBlock / isAir ---');

assertFalse(isPassable(GRANITE), 'polished_granite is NOT passable — the bug');
assertTrue(isSolidBlock(GRANITE), 'polished_granite is solid');
assertTrue(isPassable(WATER), 'water IS passable — mobs used to stand on it');
assertTrue(isPassable(LAVA), 'lava IS passable');
assertTrue(isPassable(0), 'air is passable');
assertTrue(isSolidBlock(STONE), 'stone is solid');
assertTrue(isSolidBlock(TUFF), 'tuff is solid — the spawn scan refused to call it ground');
assertTrue(isSolidBlock(DEEPSLATE_TILES), 'deepslate_tiles is solid — likewise');
assertTrue(isAir(0), 'isAir(0)');
assertFalse(isAir(GRANITE), 'isAir(12) is false — mobs no longer see through granite');
assertFalse(isAir(WATER), 'isAir(46) is false — water is passable but it is not air');

// isPassable never contradicts the registry's own `solid` column.
for (const b of BLOCK_REGISTRY) {
  assertEquals(isPassable(b.id), BLOCK_PROPERTIES[b.id].solid !== true,
    `isPassable(${b.id} ${b.name}) is the negation of the registry's \`solid\``);
}

// ═══════════════════════════════════════════════════════════════════
// 3 — _resolveAxis: the site where the velocity was never zeroed
// ═══════════════════════════════════════════════════════════════════
console.log('--- 3: _resolveAxis ---');

{
  // A wall of granite everywhere below y=64; the mob is standing in it.
  const mob = mobAt(8.5, 64.5, 8.5, 1, 0, 0);
  const hit = _resolveAxis(mob, 8.5, 64.5, 8.5, 0.3, 0.9, 'x', worldOf(GRANITE, 70));
  assertTrue(hit, '_resolveAxis reports a collision with polished_granite');
}
{
  const mob = mobAt(8.5, 64.5, 8.5, 1, 0, 0);
  const hit = _resolveAxis(mob, 8.5, 64.5, 8.5, 0.3, 0.9, 'x', worldOf(WATER, 70));
  assertFalse(hit, '_resolveAxis reports NO collision with water');
}
{
  const mob = mobAt(8.5, 64.5, 8.5, 1, 0, 0);
  const hit = _resolveAxis(mob, 8.5, 64.5, 8.5, 0.3, 0.9, 'x', worldOf(LAVA, 70));
  assertFalse(hit, '_resolveAxis reports NO collision with lava');
}
{
  const mob = mobAt(8.5, 64.5, 8.5, 1, 0, 0);
  const hit = _resolveAxis(mob, 8.5, 64.5, 8.5, 0.3, 0.9, 'x', worldOf(STONE, 70));
  assertTrue(hit, '_resolveAxis still reports a collision with ordinary stone');
}
{
  // Unloaded chunk (null) still passes through, unchanged.
  const mob = mobAt(8.5, 64.5, 8.5, 1, 0, 0);
  const hit = _resolveAxis(mob, 8.5, 64.5, 8.5, 0.3, 0.9, 'x', { getBlockAtWorld: () => null });
  assertFalse(hit, '_resolveAxis still treats an unloaded (null) block as pass-through');
}

// ═══════════════════════════════════════════════════════════════════
// 4 — _moveAndCollide: the observable consequence
// ═══════════════════════════════════════════════════════════════════
console.log('--- 4: _moveAndCollide zeroes the blocked velocity ---');

{
  const mob = mobAt(8.5, 64.5, 8.5, 3, 0, 0);
  _moveAndCollide(mob, 0.05, worldOf(GRANITE, 70));
  assertEquals(mob.velocity.x, 0, 'moving into polished_granite ZEROES velocity.x (D-56: it never did)');
}
{
  const mob = mobAt(8.5, 64.5, 8.5, 3, 0, 0);
  const before = mob.position.x;
  _moveAndCollide(mob, 0.05, worldOf(WATER, 70));
  assert(mob.position.x > before, 'a mob moves THROUGH water instead of standing on it');
  assertEquals(mob.velocity.x, 3, 'water does not zero velocity.x');
}
{
  const mob = mobAt(8.5, 64.5, 8.5, 3, 0, 0);
  _moveAndCollide(mob, 0.05, worldOf(STONE, 70));
  assertEquals(mob.velocity.x, 0, 'ordinary stone still blocks — the fix is not "nothing is solid"');
}

// ═══════════════════════════════════════════════════════════════════
// 5 — _checkStepUp and the flying path
// ═══════════════════════════════════════════════════════════════════
console.log('--- 5: _checkStepUp / applyFlyingMovement ---');

{
  // Granite at y=64 and below, air above: a step the mob should climb.
  const mob = mobAt(8.5, 64.0, 8.5, 1, 0, 0);
  assertEquals(_checkStepUp(mob, 0.05, 0.3, 0.9, worldOf(GRANITE, 64)), 0.5,
    '_checkStepUp climbs a polished_granite step (it used to see air and return 0)');
}
{
  const mob = mobAt(8.5, 64.0, 8.5, 1, 0, 0);
  assertEquals(_checkStepUp(mob, 0.05, 0.3, 0.9, worldOf(WATER, 64)), 0,
    '_checkStepUp does NOT treat water as a step to climb');
}
{
  const mob = mobAt(8.5, 64.0, 8.5, 0, 0, 0);
  mob.isFlying = true;
  applyFlyingMovement(mob, 20, 8.5, 0.05, worldOf(GRANITE, 70));
  assertEquals(mob.position.x, 8.5, 'a flying mob is blocked by polished_granite (position unchanged)');
}
{
  const mob = mobAt(8.5, 64.0, 8.5, 0, 0, 0);
  mob.isFlying = true;
  applyFlyingMovement(mob, 20, 8.5, 0.05, worldOf(WATER, 70));
  assert(mob.position.x > 8.5, 'a flying mob passes through water');
}

// ═══════════════════════════════════════════════════════════════════
// 6 — structural guard: no block-id literal left in the mob subsystem
// ═══════════════════════════════════════════════════════════════════
//
// Sections 3-5 prove the behaviour is right today. This is what stops it rotting again:
// D-56's shape is a bare numeric id compared inline, in a file that never looks at
// BLOCK_REGISTRY. Same idiom as test_globalCollisions.js's ALLOWED_WINDOW_WRITERS — if a
// new one has to exist, change this list deliberately and say why.
console.log('--- 6: structural guard ---');

const repoRoot = path.join(__dirname, '..');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

for (const rel of [
  'src/game/mobs/movement/mobMovement.js',
  'src/game/mobs/mobManager.js',
  'src/game/mobs/mob.js',
]) {
  const body = stripComments(fs.readFileSync(path.join(repoRoot, rel), 'utf8'));
  const hits = [...body.matchAll(/\b(block|headBlock|above|nb|blockType)\w*\s*[=!]==?\s*(\d+)/g)].map((m) => m[0]);
  assertEquals(hits.length, 0, `${rel} compares a block value against NO id literal (found: ${JSON.stringify(hits)})`);
}

// NON-VACUITY: the guard matches the exact text it was written against.
assertEquals([...'if (block !== 0 && block !== 12) {'.matchAll(/\b(block|headBlock|above|nb|blockType)\w*\s*[=!]==?\s*(\d+)/g)].length, 2,
  'NON-VACUITY: the guard matches both halves of the old `block !== 0 && block !== 12`');
assertEquals([...'if (headBlock !== 0 && headBlock !== 12) continue;'.matchAll(/\b(block|headBlock|above|nb|blockType)\w*\s*[=!]==?\s*(\d+)/g)].length, 2,
  'NON-VACUITY: the guard matches the old headBlock test');

// ═══════════════════════════════════════════════════════════════════
console.log(`\n===================================`);
console.log(`Results: ${passed}/${total} passed, ${failed} failed`);
console.log(`===================================`);

process.exit(failed === 0 ? 0 : 1);
}));
