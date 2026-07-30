/**
 * Cuubz — e2e test bridge (PR 9)
 *
 * ─── WHY THIS FILE EXISTS, AND WHEN IT GOES AWAY ────────────────────────────
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
 * **This file is temporary.** Phase 2 (PR 12–13) hoists the render-loop closure locals
 * onto an explicit `Game` object and puts that object on `window`, at which point the
 * harness reads the real thing and this bridge collapses into it. Its removal is
 * slotted in `refactor.md` §7 PR 12. Do not add to it casually: every symbol here is a
 * symbol the test suite could not otherwise see, and each one is a small piece of the
 * module boundary handed back to the global scope.
 *
 * It is the ONLY sanctioned `window.*` assignment in `src/` and
 * `scripts/check-globals.js` enforces that.
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
};
