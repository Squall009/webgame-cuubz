/**
 * Cuubz — dropped-item colours are derived from the atlas (BUGS.md D-51)
 *
 * `src/game/data/BlockColors.js` used to hold a hand-written 34-entry `id → hex` table
 * written before the block renumbering. Measured against the live 193-entry registry:
 * **id 3 is `cobblestone` and it was painted dirt-brown (#8B4513); id 4 is `andesite` and
 * it was painted grass-green (#228B22)**; 148+ ids were absent and dropped a grey cube;
 * and 21 of the table's 34 ids do not exist in the registry at all.
 *
 * Decision 47: the colour is now the mean RGB of the block's diffuse atlas tile, read
 * once per id and cached. This file pins three things:
 *
 *   1. a derived colour for a known block is a real colour, not the fallback;
 *   2. every fallback path — no atlas, unbuilt atlas, no tile, transparent tile, and a
 *      `getImageData` that THROWS — returns `#888888` and does not throw;
 *   3. the hand-written table is gone, structurally.
 *
 * The atlas is faked here with the smallest object that has the four fields
 * `deriveFromAtlas` reads (`loaded`, `tileSize`, `_gap`, `tileMap`, `diffuseCanvas`), so
 * the test needs no DOM and no `canvas` package.
 */

import { it } from 'vitest';
import { legacy } from '../../helpers/legacy.js';
import { TEST_DIR as __dirname } from '../../helpers/paths.js';
import fs from 'fs';
import path from 'path';
import { BLOCK_BY_NAME } from '../../../src/engine/world/BlockRegistry.js';
import { FALLBACK_COLOR, getBlockColor, registerBlockColorAtlas } from '../../../src/game/data/BlockColors.js';

it('blockColors', () => legacy(async () => {
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
function assertEquals(a, e, m) { assert(a === e, `${m} — expected ${e}, got ${a}`); }

console.log('=== Dropped-item colour tests (D-51) ===\n');

const COBBLESTONE = BLOCK_BY_NAME['cobblestone'].id;   // 3
const ANDESITE = BLOCK_BY_NAME['andesite'].id;         // 4
const RED_FLOWER = BLOCK_BY_NAME['red_flower'].id;     // 179
const YELLOW_FLOWER = BLOCK_BY_NAME['yellow_flower'].id; // 180

/**
 * A minimal stand-in for PBRTextureAtlas.
 * @param {(x:number,y:number,w:number,h:number)=>{data:Uint8ClampedArray}} readback
 */
function fakeAtlas(readback, tileMap) {
  return {
    loaded: true,
    tileSize: 2,
    _gap: 0,
    tileMap: tileMap || { [COBBLESTONE]: { tiles: { top: { col: 0, row: 0 } } } },
    diffuseCanvas: { getContext: () => ({ getImageData: readback }) },
  };
}

/** A solid-colour tile of `size*size` pixels. */
const solidTile = (r, g, b, a = 255, size = 2) => () => ({
  data: Uint8ClampedArray.from(Array.from({ length: size * size }, () => [r, g, b, a]).flat()),
});

// ═══════════════════════════════════════════════════════════════════
// 1 — no atlas at all: the Node path, and the only one `test/` ever runs
// ═══════════════════════════════════════════════════════════════════
console.log('--- 1: no atlas (the Node path) ---');

registerBlockColorAtlas(null);
assertEquals(getBlockColor(COBBLESTONE), FALLBACK_COLOR, 'no atlas → fallback for cobblestone');
assertEquals(getBlockColor(ANDESITE), FALLBACK_COLOR, 'no atlas → fallback for andesite');
assertEquals(getBlockColor(9999), FALLBACK_COLOR, 'no atlas → fallback for an unknown id');
assertEquals(FALLBACK_COLOR, '#888888', 'the fallback is still #888888');

// Named items keep their name-keyed table — those keys cannot rot under renumbering.
assertEquals(getBlockColor('coal'), '#2c2c2c', 'named item coal keeps its colour');
assertEquals(getBlockColor('not_an_item'), FALLBACK_COLOR, 'an unknown named item falls back');

// ═══════════════════════════════════════════════════════════════════
// 2 — a real derivation
// ═══════════════════════════════════════════════════════════════════
console.log('--- 2: derived from tile pixels ---');

registerBlockColorAtlas(fakeAtlas(solidTile(0x40, 0x80, 0xc0)));
assertEquals(getBlockColor(COBBLESTONE), '#4080c0', 'a solid #4080c0 tile derives #4080c0');
assert(getBlockColor(COBBLESTONE) !== FALLBACK_COLOR, 'the derived colour for a known block is NOT #888888');

// The old table's two named errors: neither hex can be produced any more.
assert(getBlockColor(COBBLESTONE) !== '#8B4513'.toLowerCase(), 'cobblestone (3) is no longer painted dirt-brown');
registerBlockColorAtlas(fakeAtlas(solidTile(0x40, 0x80, 0xc0), { [ANDESITE]: { tiles: { top: { col: 0, row: 0 } } } }));
assert(getBlockColor(ANDESITE) !== '#228B22'.toLowerCase(), 'andesite (4) is no longer painted grass-green');

// Mean, not first pixel: half black + half white → mid grey.
registerBlockColorAtlas(fakeAtlas(() => ({
  data: Uint8ClampedArray.from([0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255]),
})));
assertEquals(getBlockColor(COBBLESTONE), '#808080', 'the colour is the MEAN of the tile, not one pixel');

// Transparent pixels are excluded, not averaged toward black — this is what keeps cutout
// blocks (leaves, flowers, torches) from all coming out near-black.
registerBlockColorAtlas(fakeAtlas(() => ({
  data: Uint8ClampedArray.from([255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
})));
assertEquals(getBlockColor(COBBLESTONE), '#ff0000', 'fully transparent pixels are excluded from the mean');

// The caching contract: one readback per id per session.
{
  let calls = 0;
  registerBlockColorAtlas(fakeAtlas((...a) => { calls++; return solidTile(1, 2, 3)(...a); }));
  getBlockColor(COBBLESTONE);
  getBlockColor(COBBLESTONE);
  getBlockColor(COBBLESTONE);
  assertEquals(calls, 1, 'the pixel readback happens at most ONCE per block type per session');
}
// …and registering a new atlas invalidates it (a rebuild is a new pixel layout).
{
  let calls = 0;
  registerBlockColorAtlas(fakeAtlas((...a) => { calls++; return solidTile(9, 9, 9)(...a); }));
  getBlockColor(COBBLESTONE);
  assertEquals(calls, 1, 'registering a new atlas clears the cache');
}

// ═══════════════════════════════════════════════════════════════════
// 3 — the explicit `color:` triple wins, as a multiplier
// ═══════════════════════════════════════════════════════════════════
//
// red_flower and yellow_flower SHARE one texture. Deriving from pixels alone would give
// both the identical colour and erase the only thing that field exists to say.
console.log('--- 3: the two registry `color:` entries ---');

const flowerMap = {
  [RED_FLOWER]: { tiles: { top: { col: 0, row: 0 } } },
  [YELLOW_FLOWER]: { tiles: { top: { col: 0, row: 0 } } },
};
registerBlockColorAtlas(fakeAtlas(solidTile(200, 200, 200), flowerMap));
const red = getBlockColor(RED_FLOWER);
const yellow = getBlockColor(YELLOW_FLOWER);
assert(red !== yellow, 'red_flower and yellow_flower get DIFFERENT colours from the same tile');
assertEquals(red, '#c83232', 'red_flower = tile mean × its [1, 0.25, 0.25] multiplier');
assertEquals(yellow, '#c8c832', 'yellow_flower = tile mean × its [1, 1, 0.25] multiplier');

// ═══════════════════════════════════════════════════════════════════
// 4 — every failure mode degrades to grey and never throws
// ═══════════════════════════════════════════════════════════════════
console.log('--- 4: fallbacks ---');

const survives = (label, atlas, id) => {
  registerBlockColorAtlas(atlas);
  let result = null;
  let threw = null;
  try { result = getBlockColor(id === undefined ? COBBLESTONE : id); } catch (e) { threw = e.message; }
  assertEquals(threw, null, `${label} does not throw`);
  assertEquals(result, FALLBACK_COLOR, `${label} falls back to #888888`);
};

survives('an atlas that has not finished building', { ...fakeAtlas(solidTile(1, 1, 1)), loaded: false });
survives('an atlas with no diffuseCanvas', { ...fakeAtlas(solidTile(1, 1, 1)), diffuseCanvas: null });
survives('a block with no tile in the atlas', fakeAtlas(solidTile(1, 1, 1)), ANDESITE);
survives('a tile whose pixels are all transparent', fakeAtlas(solidTile(255, 0, 0, 0)));
survives('a getImageData that THROWS (tainted canvas)', fakeAtlas(() => {
  throw new Error('SecurityError: tainted canvas');
}));
survives('a getContext that returns null', {
  ...fakeAtlas(solidTile(1, 1, 1)),
  diffuseCanvas: { getContext: () => null },
});

// The fallback must NOT be cached, or a block asked for before the atlas loads would stay
// grey for the rest of the session.
registerBlockColorAtlas(null);
assertEquals(getBlockColor(COBBLESTONE), FALLBACK_COLOR, 'grey before the atlas exists');
registerBlockColorAtlas(fakeAtlas(solidTile(0x11, 0x22, 0x33)));
assertEquals(getBlockColor(COBBLESTONE), '#112233', 'and the real colour once it does — the fallback is not cached');

// Leave the module in the state a Node test expects.
registerBlockColorAtlas(null);

// ═══════════════════════════════════════════════════════════════════
// 5 — structural: the hand-written table is GONE
// ═══════════════════════════════════════════════════════════════════
console.log('--- 5: structural ---');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'game', 'data', 'BlockColors.js'), 'utf8');
const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const idHexPairs = [...stripped.matchAll(/(^|[{,\s])(\d+)\s*:\s*['"]#[0-9a-fA-F]{3,8}['"]/g)].map((m) => m[2]);
assertEquals(idHexPairs.length, 0,
  `BlockColors.js exports no literal id→hex map (found: ${JSON.stringify(idHexPairs.slice(0, 5))})`);
assert(!/BLOCK_DROP_COLORS/.test(stripped), 'the BLOCK_DROP_COLORS table no longer exists (the header still names it, as history)');

// NON-VACUITY: the guard matches the exact text of the deleted table.
assertEquals(
  [...("  0: '#888888', 1: '#333333', 2: '#808080', 3: '#8B4513', 4: '#228B22',")
    .matchAll(/(^|[{,\s])(\d+)\s*:\s*['"]#[0-9a-fA-F]{3,8}['"]/g)].length,
  5,
  'NON-VACUITY: the id→hex guard matches all five entries of the old table\'s first line'
);

// ═══════════════════════════════════════════════════════════════════
console.log(`\n===================================`);
console.log(`Results: ${passed}/${total} passed, ${failed} failed`);
console.log(`===================================`);

process.exit(failed === 0 ? 0 : 1);
}));
