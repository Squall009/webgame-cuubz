/**
 * Cuubz — the mesh pipeline's block tables have exactly ONE source (BUGS.md D-63)
 *
 * `src/engine/renderer/meshWorker.js` is a classic script (decision 14) and cannot
 * import `BLOCK_REGISTRY`. For as long as it carried its own id tables, nothing
 * connected them to the registry and three of them rotted:
 *
 *   - TINTABLE_IDS listed **115** commented `YELLOW_POPLAR_LEAVES`. 115 is
 *     `white_concrete`, `category: 'solid'`. The worker tinted white concrete green.
 *   - CUTOUT_IDS omitted **192**, the real `yellow_poplar_leaves`, so the worker binned
 *     it as solid: faces behind it culled, wrong material bucket.
 *   - The block loop skipped id **12** as "CAVE_AIR". `BLOCK_TYPES.CAVE_AIR` is 0; 12 is
 *     `polished_granite`, and the worker emitted no geometry for it at all.
 *
 * All three were correct on the main-thread `ChunkMeshBuilder` fallback, so whether the
 * player saw them depended on whether the browser spawned a mesh worker.
 *
 * PR 23's fix is structural: the tables are derived once in
 * `src/game/data/BlockCategories.js` and shipped to the worker in its build message, so
 * the worker holds no block-id literal at all. This file is the net around that. It runs
 * the REAL worker source in a `vm` sandbox against the REAL derived payload and reads
 * the geometry it produces — not the source text — for the behavioural half, and adds a
 * source-level guard so a NEW hand-written id table is a red test, in the idiom
 * `test_globalCollisions.js` uses for the `window` allowlist.
 */

import { it } from 'vitest';
import { legacy } from '../../helpers/legacy.js';
import { TEST_DIR as __dirname } from '../../helpers/paths.js';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { BLOCK_REGISTRY, BLOCK_BY_ID, BLOCK_BY_NAME } from '../../../src/engine/world/BlockRegistry.js';
import { ChunkMeshBuilder } from '../../../src/engine/renderer/ChunkMeshBuilder.js';
import { FACE_TABLE, HORIZONTAL_FACES } from '../../../src/game/data/FaceTable.js';
import { AIR_IDS, CUTOUT_IDS, TRANSPARENT_IDS, TINTABLE_IDS, buildMeshTables, isPassable, isSolidBlock } from '../../../src/game/data/BlockCategories.js';
import { BLOCK_PROPERTIES } from '../../../src/engine/world/BlockRegistry.js';

it('meshTables', () => legacy(async () => {
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

console.log('=== Mesh table derivation tests (D-63) ===\n');

const repoRoot = path.join(__dirname, '..');
const readSrc = (p) => fs.readFileSync(path.join(repoRoot, p), 'utf8');
const WORKER_PATH = 'src/engine/renderer/meshWorker.js';
const workerSource = readSrc(WORKER_PATH);

// ═══════════════════════════════════════════════════════════════════
// 0 — the registry facts this whole file rests on
// ═══════════════════════════════════════════════════════════════════
console.log('--- 0: registry facts ---');

assertEquals(BLOCK_REGISTRY.length, 193, 'BLOCK_REGISTRY has 193 entries (not the 162 several docs claim)');
assertEquals(BLOCK_BY_NAME['white_concrete'].id, 115, 'id 115 is white_concrete');
assertEquals(BLOCK_BY_NAME['white_concrete'].category, 'solid', 'white_concrete is category solid');
assertEquals(BLOCK_BY_NAME['yellow_poplar_leaves'].id, 192, 'id 192 is yellow_poplar_leaves');
assertEquals(BLOCK_BY_NAME['yellow_poplar_leaves'].category, 'cutout', 'yellow_poplar_leaves is category cutout');
assertEquals(BLOCK_BY_NAME['polished_granite'].id, 12, 'id 12 is polished_granite');
assertEquals(BLOCK_BY_NAME['polished_granite'].category, 'solid', 'polished_granite is category solid');

// ═══════════════════════════════════════════════════════════════════
// 1 — the derived sets ARE the registry
// ═══════════════════════════════════════════════════════════════════
console.log('--- 1: derived sets match the registry ---');

const sorted = (a) => [...a].sort((x, y) => x - y).join(',');
const registryIdsWhere = (pred) => BLOCK_REGISTRY.filter(pred).map((b) => b.id);

assertEquals(sorted(CUTOUT_IDS), sorted(registryIdsWhere((b) => b.category === 'cutout')),
  'CUTOUT_IDS === every registry entry with category cutout');
assertEquals(sorted(TRANSPARENT_IDS), sorted(registryIdsWhere((b) => b.category === 'transparent')),
  'TRANSPARENT_IDS === every registry entry with category transparent');
assertEquals(sorted(AIR_IDS), sorted(registryIdsWhere((b) => b.category === 'air')),
  'AIR_IDS === every registry entry with category air');

// The two specific rots, stated as the assertions they are.
assertTrue(CUTOUT_IDS.includes(192), 'CUTOUT_IDS CONTAINS 192 (yellow_poplar_leaves) — the omission that made the worker draw leaves as an opaque cube');
assertFalse(TINTABLE_IDS.includes(115), 'TINTABLE_IDS does NOT contain 115 (white_concrete) — the entry that tinted concrete green');
assertTrue(TINTABLE_IDS.includes(192), 'TINTABLE_IDS contains 192, the real yellow_poplar_leaves');
assertFalse(AIR_IDS.includes(12), 'AIR_IDS does NOT contain 12 — id 12 is polished_granite, not CAVE_AIR');
assertEquals(sorted(AIR_IDS), '0', 'AIR_IDS is exactly [0]');

// Every leaf block is tintable, and every tintable is either a leaf or a named ground cover.
const groundCovers = ['grass_block', 'podzol', 'short_grass', 'tall_grass'].map((n) => BLOCK_BY_NAME[n].id);
for (const b of BLOCK_REGISTRY.filter((x) => /_leaves$/.test(x.name))) {
  assertTrue(TINTABLE_IDS.includes(b.id), `TINTABLE_IDS contains ${b.id} (${b.name})`);
}
assertTrue(
  TINTABLE_IDS.every((id) => /_leaves$/.test(BLOCK_BY_ID[id].name) || groundCovers.includes(id)),
  'every TINTABLE_ID is a *_leaves block or one of the four named ground covers'
);

// ═══════════════════════════════════════════════════════════════════
// 2 — main thread reads the same derivation, not a copy
// ═══════════════════════════════════════════════════════════════════
console.log('--- 2: ChunkMeshBuilder reads the shared derivation ---');

const builder = new ChunkMeshBuilder();
assertEquals(sorted(builder.cutoutIds), sorted(CUTOUT_IDS), 'ChunkMeshBuilder.cutoutIds === CUTOUT_IDS');
assertEquals(sorted(builder.transparentIds), sorted(TRANSPARENT_IDS), 'ChunkMeshBuilder.transparentIds === TRANSPARENT_IDS');
assertEquals(sorted(builder.tintableIds), sorted(TINTABLE_IDS), 'ChunkMeshBuilder.tintableIds === TINTABLE_IDS');
assert(builder.faceNormals === FACE_TABLE, 'ChunkMeshBuilder.faceNormals IS the shared FACE_TABLE object (not a copy)');

// The face table itself: shape, and the deliberately inverted `bottom` winding that a
// careless "tidy-up" would normalise away.
assertEquals(FACE_TABLE.length, 6, 'FACE_TABLE has six faces');
assertEquals(FACE_TABLE.map((f) => f.name).join(','), 'top,bottom,front,back,right,left', 'FACE_TABLE face order is unchanged');
assertEquals(JSON.stringify(FACE_TABLE[1].uvCoords), JSON.stringify([[0,1],[1,1],[1,0],[0,0]]),
  'the `bottom` face keeps its INVERTED UV winding (every other face is [[0,0],[1,0],[1,1],[0,1]])');
for (const f of FACE_TABLE) {
  if (f.name === 'bottom') continue;
  assertEquals(JSON.stringify(f.uvCoords), JSON.stringify([[0,0],[1,0],[1,1],[0,1]]), `face ${f.name} uses the standard UV winding`);
}
assertEquals(HORIZONTAL_FACES.map((f) => f.faceName).join(','), 'front,back,right,left',
  'HORIZONTAL_FACES is FACE_TABLE minus top/bottom, in the original order');
assertTrue(Object.isFrozen(FACE_TABLE), 'FACE_TABLE is frozen — a shared table no consumer can mutate');

// ═══════════════════════════════════════════════════════════════════
// 3 — the WORKER, run for real, against the real payload
// ═══════════════════════════════════════════════════════════════════
console.log('--- 3: the worker, executed ---');

const CHUNK_W = 16, CHUNK_D = 16;
const idx = (x, y, z) => x + z * CHUNK_W + y * CHUNK_W * CHUNK_D;

/**
 * Evaluate the real meshWorker.js source in a sandbox and build one chunk containing a
 * single block of `blockId`, floating in air. Returns the three geometry streams.
 */
function runWorker(blockId, tables) {
  let result = null;
  const sandbox = { console, self: {} };
  sandbox.self.postMessage = (msg) => { result = msg; };
  vm.createContext(sandbox);
  vm.runInContext(workerSource, sandbox, { filename: WORKER_PATH });

  const blocks = new Uint8Array(CHUNK_W * CHUNK_D * 256);
  blocks[idx(8, 40, 8)] = blockId;
  const humidity = new Float32Array(256).fill(1.0); // fully moist → maximum visible tint

  sandbox.self.onmessage({
    data: {
      type: 'build', cx: 0, cz: 0,
      blocks: blocks.buffer,
      neighbors: { positiveX: null, negativeX: null, positiveZ: null, negativeZ: null },
      humidityMap: humidity.buffer,
      uvLookup: null,
      tables,
    },
  });

  if (!result) throw new Error('worker produced no message');
  if (result.type === 'error') throw new Error('worker error: ' + result.error);
  const read = (s) => ({
    verts: new Float32Array(s.pos).length / 3,
    colors: Array.from(new Float32Array(s.color).slice(0, 3)),
  });
  return { solid: read(result.solid), cutout: read(result.cutout), trans: read(result.trans) };
}

const TABLES = buildMeshTables(FACE_TABLE);

// The payload the worker actually receives is the derived one, byte for byte.
assertEquals(sorted(TABLES.cutoutIds), sorted(CUTOUT_IDS), 'the build payload ships the derived cutout set');
assertEquals(sorted(TABLES.tintableIds), sorted(TINTABLE_IDS), 'the build payload ships the derived tintable set');
assertFalse(TABLES.tintableIds.includes(115), "the worker's EFFECTIVE TINTABLE_IDS does not contain 115");
assertTrue(TABLES.cutoutIds.includes(192), "the worker's EFFECTIVE CUTOUT_IDS does contain 192");

// 192 — yellow_poplar_leaves. Must land in the CUTOUT stream, and must be tinted.
const leaves = runWorker(192, TABLES);
assertEquals(leaves.solid.verts, 0, 'worker: yellow_poplar_leaves (192) emits NO solid geometry');
assertEquals(leaves.cutout.verts, 24, 'worker: yellow_poplar_leaves (192) emits its six faces into the CUTOUT stream');
assertTrue(leaves.cutout.colors[0] < 0.99, 'worker: yellow_poplar_leaves is humidity-tinted (r pulled below 1.0)');

// 115 — white_concrete. Solid, and must be pure white: no humidity tint.
const concrete = runWorker(115, TABLES);
assertEquals(concrete.solid.verts, 24, 'worker: white_concrete (115) emits its six faces into the SOLID stream');
assertEquals(concrete.cutout.verts, 0, 'worker: white_concrete (115) emits no cutout geometry');
assertEquals(JSON.stringify(concrete.solid.colors), JSON.stringify([1, 1, 1]),
  'worker: white_concrete is NOT tinted — vertex colour is pure white');

// 12 — polished_granite. Used to be skipped outright as "CAVE_AIR".
const granite = runWorker(12, TABLES);
assertEquals(granite.solid.verts, 24, 'worker: polished_granite (12) is DRAWN — it is not CAVE_AIR');

// Water is transparent, and it is not air: the passable set and the render set are
// different questions and the worker answers the render one.
const water = runWorker(BLOCK_BY_NAME['water'].id, TABLES);
assertEquals(water.trans.verts, 24, 'worker: water lands in the TRANSPARENT stream');

// The worker refuses to guess. A build with no tables is a loud error, never a silently
// wrong mesh — this is what makes "the worker holds no default" enforceable.
{
  let threw = false;
  const sandbox = { console, self: {} };
  let msg = null;
  sandbox.self.postMessage = (m) => { msg = m; };
  vm.createContext(sandbox);
  vm.runInContext(workerSource, sandbox, { filename: WORKER_PATH });
  sandbox.self.onmessage({
    data: {
      type: 'build', cx: 0, cz: 0,
      blocks: new Uint8Array(16).buffer,
      neighbors: {},
      humidityMap: null,
    },
  });
  threw = !!(msg && msg.type === 'error' && /tables/i.test(msg.error));
  assertTrue(threw, 'a build message with no `tables` is reported as an error, not silently defaulted');
}

// ═══════════════════════════════════════════════════════════════════
// 4 — NON-VACUITY: reintroduce the two defects and watch the worker break
// ═══════════════════════════════════════════════════════════════════
//
// Every assertion in section 3 is proved live here by feeding the worker the OLD,
// stale tables and confirming it produces exactly the two bugs D-63 describes. If the
// derivation above ever silently became a no-op, these four would go red with it.
console.log('--- 4: non-vacuity — the stale tables reproduce the bug ---');

const staleTables = buildMeshTables(FACE_TABLE);
staleTables.tintableIds = staleTables.tintableIds.filter((id) => id !== 192).concat([115]); // the old table
staleTables.cutoutIds = staleTables.cutoutIds.filter((id) => id !== 192);                   // the old omission

const staleLeaves = runWorker(192, staleTables);
assertEquals(staleLeaves.cutout.verts, 0, 'NON-VACUITY: with the old CUTOUT_IDS, leaves produce no cutout geometry');
assertEquals(staleLeaves.solid.verts, 24, 'NON-VACUITY: with the old CUTOUT_IDS, leaves are drawn as an opaque cube');

const staleConcrete = runWorker(115, staleTables);
assertTrue(staleConcrete.solid.colors[0] < 0.99,
  'NON-VACUITY: with the old TINTABLE_IDS, white concrete IS tinted green — the bug, reproduced');
assert(JSON.stringify(staleConcrete.solid.colors) !== JSON.stringify([1, 1, 1]),
  'NON-VACUITY: the tinted-concrete assertion in section 3 can fail');

// ═══════════════════════════════════════════════════════════════════
// 5 — the structural guard: no new hand-written table may appear
// ═══════════════════════════════════════════════════════════════════
//
// Sections 3 and 4 prove today's tables are right. This one is what stops tomorrow's
// from being wrong: the failure mode D-63 is an instance of is somebody adding a fresh
// id literal to a file that cannot see BLOCK_REGISTRY. Same idiom as
// test_globalCollisions.js's ALLOWED_WINDOW_WRITERS — an explicit allowlist, and a
// deliberate edit with a reason if it ever has to change.
console.log('--- 5: structural guard on the worker source ---');

// Strip comments before looking for literals, so the prose above about ids 12/115/192
// is not itself a match.
const stripped = workerSource
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\/\/.*$/gm, '');

// An object literal with a numeric key — `104: true,` / `179: [1, 0.25, 0.25],` — is the
// exact shape of all five tables this PR deleted.
const numericKeyLines = stripped.split('\n').filter((l) => /(^|[{,\s])\d+\s*:/.test(l));
assertEquals(numericKeyLines.length, 0,
  `meshWorker.js declares NO numeric-keyed table (found: ${JSON.stringify(numericKeyLines.slice(0, 3))})`);

// And no bare block-id comparison either — `blockType === 12` was the third bug and it
// is not an object literal.
const idComparisons = [...stripped.matchAll(/blockType\s*[=!]==?\s*(\d+)/g)].map((m) => m[1]);
assertEquals(idComparisons.length, 0,
  `meshWorker.js compares blockType against NO id literal (found: ${JSON.stringify(idComparisons)})`);

// It is still a classic script: an import here is a lint parse error and a runtime
// failure in the Blob worker (decision 14).
assertFalse(/^\s*(import|export)\s/m.test(stripped), 'meshWorker.js contains no import/export — it is still a classic script');

// The face table is not duplicated. The worker's copy used the short keys `n:'top'`.
assertFalse(/\bn\s*:\s*'top'/.test(stripped), 'meshWorker.js no longer carries its own FACES table');
assertFalse(/uvCoords\s*:/.test(readSrc('src/engine/renderer/ChunkMeshBuilder.js')),
  'ChunkMeshBuilder.js no longer declares a face table literal — it imports FACE_TABLE');

// NON-VACUITY for section 5: the guards fire on the text they are supposed to catch.
assertEquals(('  104: true, 105: true,').split('\n').filter((l) => /(^|[{,\s])\d+\s*:/.test(l)).length, 1,
  'NON-VACUITY: the numeric-key guard matches the old CUTOUT_IDS line');
assertEquals([...'if (blockType === 12) continue;'.matchAll(/blockType\s*[=!]==?\s*(\d+)/g)].length, 1,
  'NON-VACUITY: the id-comparison guard matches the old `blockType === 12` line');
assertTrue(/\bn\s*:\s*'top'/.test("{d:[0,1,0], n:'top'}"), 'NON-VACUITY: the FACES guard matches the old short-key face row');

// ═══════════════════════════════════════════════════════════════════
// 6 — solidity has one definition (D-56)
// ═══════════════════════════════════════════════════════════════════
console.log('--- 6: isPassable / isSolidBlock ---');


for (const b of BLOCK_REGISTRY) {
  assertEquals(isSolidBlock(b.id), BLOCK_PROPERTIES[b.id].solid === true,
    `isSolidBlock(${b.id} ${b.name}) agrees with the registry's own \`solid\` field`);
}
assertTrue(isSolidBlock(12), 'polished_granite (12) is SOLID — the id the old mob code read as air');
assertFalse(isPassable(12), 'polished_granite (12) is NOT passable');
assertTrue(isPassable(0), 'air (0) is passable');
assertTrue(isPassable(46), 'water (46) is passable — the old mob code walked ON it');
assertTrue(isPassable(47), 'lava (47) is passable');
assertTrue(isSolidBlock(61), 'ice (61) is solid despite category:transparent — it carries an explicit `solid: true`');
assertTrue(isSolidBlock(999), 'an id the registry does not know is treated as solid (the safe answer)');

// ═══════════════════════════════════════════════════════════════════
console.log(`\n===================================`);
console.log(`Results: ${passed}/${total} passed, ${failed} failed`);
console.log(`===================================`);

process.exit(failed === 0 ? 0 : 1);
}));
