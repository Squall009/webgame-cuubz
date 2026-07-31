/**
 * Cuubz — everything about a block id that is DERIVED from `BLOCK_REGISTRY` (PR 23)
 *
 * `BUGS.md` **D-63** and **D-64**: five hand-maintained block-id tables predated the
 * block renumbering and nothing protected them. PR 4 fixed this exact defect twice
 * before the ledger existed. The answer is not "fix the tables" — it is that no
 * consumer keeps a table at all. Every set below is computed from the registry at
 * module load, so a renumbering, an insertion or a category change propagates by
 * construction and there is nothing left to forget to update.
 *
 * Two live bugs this file retires, both in `src/engine/renderer/meshWorker.js`:
 *
 *   - `TINTABLE_IDS` listed **115** commented `YELLOW_POPLAR_LEAVES`. Id 115 is
 *     `white_concrete`, `category: 'solid'` — the worker applied humidity-based green
 *     tint to white concrete. The real `yellow_poplar_leaves` is **192** and was absent.
 *   - `CUTOUT_IDS` omitted **192** too, so the worker binned yellow poplar leaves as
 *     solid: faces behind them were culled and they landed in the wrong material.
 *   - (Third, found while fixing those.) The worker skipped `blockType === 12` as
 *     "CAVE_AIR". `BLOCK_TYPES.CAVE_AIR` is **0** — an alias of AIR — and id 12 is
 *     `polished_granite`. The worker emitted no geometry for polished granite while
 *     still treating it as solid for its neighbours' culling: an invisible block with
 *     a hole punched around it.
 *
 * All three only appeared when the browser managed to spawn a mesh worker; the
 * main-thread `ChunkMeshBuilder` fallback rendered every one of them correctly. A
 * rendering defect whose presence depends on `navigator.hardwareConcurrency` is the
 * worst possible shape, which is why D-63 is severity high.
 *
 * ─── LEAF STATUS ────────────────────────────────────────────────────────────
 *
 * Imports `BlockRegistry.js` and nothing else. `BlockRegistry.js` imports nothing, so
 * this file is one hop above the graph's floor and cannot close a cycle (D-28).
 */

import { BLOCK_BY_NAME, BLOCK_PROPERTIES, BLOCK_REGISTRY } from '../../engine/world/BlockRegistry.js';

const idsWhere = (pred) => BLOCK_REGISTRY.filter(pred).map((b) => b.id);

/** Ids whose category is `air`. Exactly `[0]` today; derived so it stays true. */
export const AIR_IDS = Object.freeze(idsWhere((b) => b.category === 'air'));

/** Alpha-tested blocks: leaves, flowers, torches, vines. */
export const CUTOUT_IDS = Object.freeze(idsWhere((b) => b.category === 'cutout'));

/** Alpha-blended blocks: water, lava, the four ices, toxic slime. */
export const TRANSPARENT_IDS = Object.freeze(idsWhere((b) => b.category === 'transparent'));

/**
 * Blocks that receive the humidity-based green tint.
 *
 * The registry has no `tintable` field, so this is the one set with a rule rather than
 * a column behind it — but the rule is written over NAMES, never ids, for the same
 * reason `BLOCK_DROP_OVERRIDES` is: ids have been renumbered before and every id-keyed
 * table in this codebase rotted when they were. Every `*_leaves` block, plus the four
 * ground covers that are tinted by hand everywhere else.
 *
 * This reproduces `ChunkMeshBuilder`'s previous hand-written 16-entry list exactly —
 * asserted in `test/test_meshTables.js`, which is what keeps the rule honest.
 */
const TINT_GROUND_COVERS = ['grass_block', 'podzol', 'short_grass', 'tall_grass'];
export const TINTABLE_IDS = Object.freeze([
  ...idsWhere((b) => /_leaves$/.test(b.name)),
  ...TINT_GROUND_COVERS.map((n) => BLOCK_BY_NAME[n].id),
]);

/** Blocks with a non-cube mesh: `[id, { type, height }]` pairs. */
export const SPECIAL_MESH_TYPES = Object.freeze(
  BLOCK_REGISTRY.filter((b) => b.meshType).map((b) => [b.id, { type: b.meshType, height: b.meshHeight || 0.5 }])
);

/**
 * Explicit per-block vertex-colour multipliers: `[id, [r,g,b]]` pairs.
 * Two entries today (red_flower, yellow_flower — one shared texture, two colours).
 */
export const BLOCK_COLOR_MULTIPLIERS = Object.freeze(
  BLOCK_REGISTRY.filter((b) => Array.isArray(b.color)).map((b) => [b.id, b.color])
);

/** Emissive blocks: `[id, intensity]` pairs. */
export const EMISSIVE_BLOCKS = Object.freeze(
  BLOCK_REGISTRY.filter((b) => b.emissive && b.emissive > 0).map((b) => [b.id, b.emissive])
);

// ────────────────────────────────────────────────────────────────────────────
// Solidity — the physics predicate (D-56)
// ────────────────────────────────────────────────────────────────────────────
//
// `src/game/mobs/movement/mobMovement.js` tested solidity as `block !== 0 && block !== 12`
// at four sites, reading ids 0 and 12 as "air". Against the live registry id **12 is
// `polished_granite`**, `category: 'solid'` — mobs walked through it — while water (46)
// and lava (47) were counted as solid, so mobs walked ON water.
//
// The predicate below is NOT a new opinion about solidity. `BLOCK_PROPERTIES[id].solid`
// is the registry's own field, computed in BlockRegistry.js as
// `block.solid !== undefined ? block.solid : block.category === 'solid'` — which is why
// the four ice blocks are solid despite being `category: 'transparent'`, and why cutout
// grass and flowers are not. `src/game/entities/Player.js:_isSolidAt` already tests
// exactly this. Using anything else here would be inventing a SECOND definition of
// solidity, which is the defect class this PR exists to close.

/**
 * @param {number} blockId
 * @returns {boolean} true when a body should be stopped by this block.
 *   An id the registry does not know is treated as solid — the same answer the old
 *   `block !== 0 && block !== 12` gave, and the safe one (a mob stuck on garbage data
 *   is a smaller failure than a mob falling out of the world).
 */
export function isSolidBlock(blockId) {
  const props = BLOCK_PROPERTIES[blockId];
  if (!props) return true;
  return props.solid === true;
}

/**
 * @param {number} blockId
 * @returns {boolean} true when a body may move through this block — air, water, lava,
 *   toxic slime and every cutout (grass, flowers, torches, leaves).
 */
export function isPassable(blockId) {
  return !isSolidBlock(blockId);
}

/**
 * @param {number} blockId
 * @returns {boolean} true only for `category: 'air'`.
 *
 * Separate from `isPassable` on purpose: "can a body move through it" and "is there
 * nothing here" are different questions, and the mob line-of-sight check in `mob.js`
 * asks the second one (its own comment says "Non-air blocks block line of sight" — the
 * code under it said `block !== 0 && block !== 12`, which let mobs see through
 * polished granite).
 */
export function isAir(blockId) {
  return AIR_IDS.includes(blockId);
}

// ────────────────────────────────────────────────────────────────────────────
// The mesh worker's tables
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build the derived tables `meshWorker.js` needs, as plain structured-cloneable data.
 *
 * The worker is a classic script (decision 14; `eslint.config.mjs` lints it with
 * `sourceType: 'script'`, so an `import` there is a parse error at lint time) and is
 * spawned from a Blob of its own fetched source. It therefore cannot import this file.
 * Of `refactor.md` PR 23's three options — pass the tables in the message, concatenate
 * a generated prelude onto the worker source, or keep the literals and police them with
 * a test — this is option 1, and it is the only one that makes a stale table
 * *impossible* rather than merely detectable: after this change the worker contains no
 * block-id literal at all, so there is nothing left to drift.
 *
 * Cost: ~250 numbers per build message, alongside a 65 KB block buffer and a 256×7
 * UV table that were already being sent. The result is cached by the caller
 * (`ChunkMeshCoordinator._ensureMeshTablesCache`) so this function runs once a session.
 *
 * @param {ReadonlyArray} faceTable — `FACE_TABLE` from `./FaceTable.js`, passed in
 *   rather than imported so this module stays purely registry-derived.
 */
export function buildMeshTables(faceTable) {
  return {
    faces: faceTable,
    airIds: [...AIR_IDS],
    cutoutIds: [...CUTOUT_IDS],
    transparentIds: [...TRANSPARENT_IDS],
    tintableIds: [...TINTABLE_IDS],
    specialMeshTypes: SPECIAL_MESH_TYPES.map(([id, info]) => [id, { type: info.type, height: info.height }]),
    blockColors: BLOCK_COLOR_MULTIPLIERS.map(([id, rgb]) => [id, [...rgb]]),
  };
}
