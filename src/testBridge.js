/**
 * Cuubz — e2e test bridge (PR 9, extended in PR 12)
 *
 * ─── PR 12 READ THIS FIRST: WHY THE FILE IS STILL HERE ──────────────────────
 *
 * `refactor.md` §7 PR 12 and `BUGS.md` decision 7 both say this file collapses into the
 * real `Game` object that Phase 2 puts on `window`. **PR 12 did not delete it, and the
 * reason is that the two halves of the bridge are not the same thing.** The ruling is
 * `BUGS.md` decision 21; the short version:
 *
 *   • The **live half** — `__cuubz.state`, added by PR 12 — genuinely does collapse into
 *     the game object. `publishGameState()` below is called once per session from
 *     `startGame()`, and it is what lets `test/e2e/saveLoad.js` place and break a real
 *     block instead of only reading generated terrain out of IndexedDB.
 *   • The **static half** — `ChunkManager` the *class*, `CHUNK_MAGIC`, `DB_VERSION`,
 *     `BLOCK_REGISTRY`, `HEADER_SIZE` — does not. None of those is instance state and no
 *     `Game` object will ever carry them. They are module-scoped bindings that the
 *     `DEPLOY.md` §2 invariant assertions read *directly*, which is the whole point:
 *     hard-coding them in the test would turn "the magic number did not change" into a
 *     tautology.
 *
 * So deleting the file would mean either moving 25 imports into `src/index.js` (the
 * bootstrap that §4.1 wants under 50 lines) or scattering `window.__cuubz.x =` across
 * `src/`, which is a second sanctioned `window` assignment — the thing every document
 * here tells you not to add. One file, one assignment, one namespace is the shape that
 * was wanted; PR 12 changed the *justification*, not the *need*. **Removal is owned by
 * PR 33**, the sweep-up PR, and the condition is stated there: it goes when something
 * other than a `window` property can hand `page.evaluate` a module binding.
 *
 * ─── WHY IT EXISTED IN THE FIRST PLACE (PR 9) ───────────────────────────────
 *
 * `test/e2e/saveLoad.js` drives a real browser and reads roughly a third of its 150
 * assertions out of the page with `page.evaluate` — the `DEPLOY.md` §2 storage
 * invariants, the chunk binary header decoded from bytes the browser actually wrote,
 * the H-1 two-world regression test, the H-1 key migration, and PR 6d's `DB_VERSION`
 * increment. Every one of those reads a **top-level lexical binding**: `ChunkManager`,
 * `CHUNK_MAGIC`, `BLOCK_REGISTRY`, and so on.
 *
 * That worked only because these files were classic `<script>`s, where a top-level
 * `const` is a global lexical binding (`refactor.md` §2.4). In an ES module the same
 * `const` is module-scoped and completely unreachable from `page.evaluate`. So the
 * moment `index.html` became `<script type="module">`, those assertions could not run
 * at all — the parity baseline would have died at the exact PR whose whole claim is
 * "identical game".
 *
 * Three ways out were considered (`PR8_HANDOFF.md` §4.1). Dynamic `import()` inside
 * `page.evaluate` works only against the dev server, which would make the harness
 * vite-only and contradict the ruling that a harness may not depend on the thing it is
 * validating. Hard-coding the constants in the test turns invariant assertions into
 * tautologies — they exist precisely to catch a constant *changing*. So: one namespace
 * object, one line per symbol, and the harness reads `__cuubz.ChunkManager` instead of
 * `ChunkManager`.
 *
 * Do not add to it casually: every symbol here is a symbol the test suite could not
 * otherwise see, and each one is a small piece of the module boundary handed back to the
 * global scope.
 *
 * It is the ONLY sanctioned `window.*` assignment in `src/`. `scripts/check-globals.js`
 * used to enforce that by path and **PR 11 deleted the script**; nothing enforces it
 * mechanically today, because ESLint has no opinion about which properties you hang off a
 * global it declared readonly. `test/test_globalCollisions.js` is where an assertion for
 * it belongs if one is ever wanted — see BUGS.md D-35.
 */

import * as THREE from 'three';

import { ChunkManager, DB_NAME, DB_VERSION, STORE_CHUNKS, STORE_MANIFESTS, CHUNK_W, CHUNK_D } from './engine/world/ChunkManager.js';
import { ChunkBinaryCodec, CHUNK_MAGIC, CHUNK_VERSION, LEGACY_LAYOUT_MAX, HEADER_SIZE } from './engine/world/ChunkBinaryCodec.js';
import { Chunk, CHUNK_HEIGHT, CHUNK_WIDTH, CHUNK_DEPTH, SEA_LEVEL, MIN_Y, MAX_Y } from './engine/world/ChunkData.js';
import { BLOCK_REGISTRY, BLOCK_TYPES, BLOCK_BY_ID, BLOCK_BY_NAME } from './engine/world/BlockRegistry.js';
import { PersistenceManager, MAX_WORLD_SLOTS } from './engine/world/Persistence.js';

/**
 * One namespace object, not eleven globals. A single property on `window` is trivial to
 * grep for, trivial to delete, and impossible to mistake for the module system working.
 */
window.__cuubz = {
  THREE,
  // Storage — DEPLOY.md §2
  ChunkManager,
  DB_NAME,
  DB_VERSION,
  STORE_CHUNKS,
  STORE_MANIFESTS,
  CHUNK_W,
  CHUNK_D,
  PersistenceManager,
  MAX_WORLD_SLOTS,
  // Chunk binary format — DEPLOY.md §2.3
  ChunkBinaryCodec,
  CHUNK_MAGIC,
  CHUNK_VERSION,
  LEGACY_LAYOUT_MAX,
  HEADER_SIZE,
  // Chunk geometry constants
  Chunk,
  CHUNK_WIDTH,
  CHUNK_DEPTH,
  CHUNK_HEIGHT,
  SEA_LEVEL,
  MIN_Y,
  MAX_Y,
  // Block registry — renumbering reinterprets every saved chunk
  BLOCK_REGISTRY,
  BLOCK_TYPES,
  BLOCK_BY_ID,
  BLOCK_BY_NAME,
  // Live session state — set by publishGameState() below, null until a game starts.
  state: null,
};

/**
 * PR 12 — hand the harness the live `GameState`.
 *
 * `startGame()` calls this once, on the frame the render loop starts. Before PR 12 every
 * live object in the game (`chunkManager`, `inventory`, `blockInteraction`, `player`) was
 * a closure local inside `startGame`'s `setTimeout` body, so `page.evaluate` could reach
 * none of them, and `test/e2e/saveLoad.js` had two steps marked `⚠️ UNVERIFIED` for that
 * exact reason: **placing a block needs pointer lock, which a headless driver cannot
 * grant, plus a reachable chunk manager, which nothing could reach.** With the state on
 * an object, the harness places blocks through `chunkManager.applyBlockChange()` — the
 * same call `BlockInteraction` makes after its raycast — and pointer lock stops mattering.
 *
 * This is a one-way publish, not a live binding: the harness reads through the object it
 * is given, and nothing in `src/` ever reads `window.__cuubz.state` back.
 */
export function publishGameState(state) {
  window.__cuubz.state = state;
}
