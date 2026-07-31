/**
 * Cuubz — IndexedDB schema ladder and the single database opener (H-2, H-3)
 *
 * Split out of ChunkManager.js unchanged. A REAL MODULE, not a prototype mixin: every
 * function here is pure over `(db, tx, oldVersion, newVersion)` and touches no instance
 * field whatsoever. That is what makes it the one genuinely zero-crossing cut in the
 * split — it was already static, it just stopped pretending it needed a class.
 *
 * ChunkManager.js re-attaches all six symbols under their original static names:
 *
 *     ChunkManager._ensureStore        ← ensureStore
 *     ChunkManager._ensureIndex        ← ensureIndex
 *     ChunkManager._ensureBaseSchema   ← ensureBaseSchema
 *     ChunkManager._applySchemaUpgrade ← applySchemaUpgrade
 *     ChunkManager.openDatabase        ← openDatabase
 *     ChunkManager.SCHEMA_STEPS        ← SCHEMA_STEPS   (the SAME object, not a copy)
 *
 * `SCHEMA_STEPS` being the same object reference is load-bearing, not incidental:
 * `test/unit/engine/chunkStorage.test.js` and `test/e2e/saveLoad.js` both register a step
 * with `ChunkManager.SCHEMA_STEPS[3] = ...` and then drive a real 2 → 3 upgrade through
 * `applySchemaUpgrade`, which reads the module-local binding. Mutating the object works;
 * REPLACING it (`ChunkManager.SCHEMA_STEPS = {...}`) would not, and nothing does.
 */

import { DB_NAME, DB_VERSION, STORE_CHUNKS, STORE_MANIFESTS } from './ChunkConstants.js';

// ============================================================
// SCHEMA VERSION LADDER (H-2)
// ============================================================
//
// `onupgradeneeded` used to enumerate every existing object store,
// `deleteObjectStore` all of them, and recreate them empty, under a comment
// reading "handles schema changes cleanly". It did not. It made incrementing
// DB_VERSION — a one-character change — destroy every saved world on every
// player's device, with no migration and no warning. That is H-2, and it is why
// PR 6c had to run the H-1 key migration from `_openDB` at an unchanged version 2
// instead of doing the obvious thing, and why DEPLOY.md §2.1 carried a ⛔ warning
// saying the version must never be touched.
//
// It is a ladder now. `SCHEMA_STEPS[v]` is the step that brings a database from
// version v-1 to version v, and an upgrade runs every step in
// `(oldVersion, newVersion]` in ascending order. Two rules are what make it safe:
//
//   1. **A step creates. A step never deletes.** `_ensureStore` / `_ensureIndex`
//      are create-if-absent, so a step re-run against a database that already has
//      the store is a no-op instead of a data loss. Nothing in this file calls
//      `deleteObjectStore` any more, and the unit tests assert that by counting
//      schema operations rather than by reading the diff.
//   2. **A version with no registered step throws.** That aborts the
//      versionchange transaction, so the database stays at its old version with
//      its data intact and the open fails loudly. Bumping DB_VERSION without
//      writing the step is therefore a development-time failure, not a silent
//      "this database claims to be v3 but has a v2 schema".
//
// HOW TO CHANGE THE SCHEMA — this is the procedure DEPLOY.md §2.1 points at:
//
//   a. Add `SCHEMA_STEPS[DB_VERSION + 1]` at the bottom of this file, using only
//      `ensureStore` and `ensureIndex`. If you need to reshape an existing store,
//      create the new one alongside it and leave the old one in place.
//   b. Increment `DB_VERSION` in ChunkConstants.js and the version in DEPLOY.md §2.1.
//   c. **Data** that must be rewritten — as opposed to schema that must exist —
//      does NOT belong here. A versionchange transaction cannot await anything and
//      a half-applied one aborts the entire upgrade. Write it as an `_openDB`
//      migration next to `_migrateToWorldScopedKeys`, which every one of the seven
//      chunk-store boundary sites awaits, and make it idempotent.
//   d. Run `npm test` AND `npm run test:e2e`. Both drive a real 2 → 3 upgrade
//      through this ladder against a database seeded with real chunk and manifest
//      records: `test/integration/storageUpgrade.test.js` in the Node suite, and
//      `npm run test:e2e`'s schema-upgrade block in a real browser against real
//      IndexedDB. That PAIR is what makes an increment survivable rather than
//      merely intended.
//
//      D-82: this step used to say `npm run test:e2e` was "the only thing" that
//      made an increment survivable. That stopped being true when
//      `test/integration/storageUpgrade.test.js` landed in `npm test` — and it
//      mattered, because it told a reader that the fast gate could not see a
//      schema mistake and that the slow browser run was optional-until-release.
//      The browser run is still the only one that exercises REAL IndexedDB, which
//      is why it is still named here rather than dropped.

/** Create an object store only if it is absent. Never deletes. Returns it, or null. */
export function ensureStore(db, name, options) {
  if (db.objectStoreNames.contains(name)) return null;
  return db.createObjectStore(name, options);
}

/**
 * Create an index only if it is absent. `tx` is the versionchange transaction —
 * the only way to reach an object store that this upgrade did not just create.
 */
export function ensureIndex(db, tx, storeName, indexName, keyPath, options) {
  if (!db.objectStoreNames.contains(storeName)) return;
  const store = tx.objectStore(storeName);
  if (store.indexNames.contains(indexName)) return;
  store.createIndex(indexName, keyPath, options);
}

/**
 * The stores and indexes every version of this schema requires.
 *
 * Idempotent, which is what lets it double as the repair pass at the end of every
 * upgrade. H-3 is why that pass exists: `js/main.js` used to open the database
 * with no version argument, which on a device where it did not exist created
 * `cuubz-worlds` at **version 1 with no object stores at all**. Such a database
 * arrives here as a 1 → 2 upgrade whose step must create the stores even though
 * "version 1" is supposed to have made them.
 */
export function ensureBaseSchema(db, tx) {
  ensureStore(db, STORE_CHUNKS, { keyPath: 'chunkKey' });
  ensureIndex(db, tx, STORE_CHUNKS, 'worldName', 'worldName', { unique: false });
  ensureStore(db, STORE_MANIFESTS, { keyPath: 'worldName' });
}

/**
 * Run every schema step in `(oldVersion, newVersion]`, in order.
 *
 * Called from `onupgradeneeded`, so it is synchronous by necessity: the
 * versionchange transaction closes at the end of this turn of the event loop.
 *
 * @returns {number[]} the versions whose steps ran, for logging.
 */
export function applySchemaUpgrade(db, tx, oldVersion, newVersion) {
  const from = oldVersion || 0;
  const applied = [];

  for (let v = from + 1; v <= newVersion; v++) {
    const step = SCHEMA_STEPS[v];
    if (typeof step !== 'function') {
      // Throwing aborts the versionchange transaction: the database keeps its old
      // version and every record in it. See rule 2 above.
      throw new Error(
        `[ChunkManager] No schema step registered for DB version ${v} ` +
        `(upgrading ${from} -> ${newVersion}). Add ChunkManager.SCHEMA_STEPS[${v}] ` +
        'before incrementing DB_VERSION — see the ladder comment in ChunkSchema.js.'
      );
    }
    step(db, tx);
    applied.push(v);
  }

  // Repair pass. Creating a store that is already there is a no-op, and a store
  // that is missing holds no data by definition, so this cannot cost anything —
  // and it is what heals an H-3 database that reached a version without its
  // stores. Unconditional because the base schema is permanent: rule 1 means no
  // future step can legitimately remove either store.
  ensureBaseSchema(db, tx);
  return applied;
}

/**
 * Open `cuubz-worlds` at DB_VERSION with the schema ladder attached.
 * Returns Promise<IDBDatabase>.
 *
 * **One opener, deliberately.** H-3 was a second one: `js/main.js:545` opened the
 * database with no version argument, so on a device where it did not yet exist it
 * created `cuubz-worlds` at version 1 with no object stores, and the
 * `db.transaction(['manifests','chunks'])` on the next line threw `NotFoundError`
 * into a silent `catch {}`. A caller that does not name the version is a caller
 * that can create a database this codebase does not recognise, so there is now
 * nowhere in the codebase to write one: both openers go through here.
 *
 * Not memoized — the caller owns the connection and may close it. Instance-level
 * memoization is `_openDB` below.
 */
export function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onblocked = (event) => {
      console.error('[ChunkManager] IndexedDB upgrade blocked — another tab may hold the DB open:', event);
    };

    request.onupgradeneeded = (event) => {
      const applied = applySchemaUpgrade(
        event.target.result, event.target.transaction, event.oldVersion, event.newVersion
      );
      if (applied.length > 0) {
        console.info(
          `[ChunkManager] IndexedDB schema ${event.oldVersion} -> ${event.newVersion}; ` +
          `applied step(s) ${applied.join(', ')}. No object store was deleted (H-2).`
        );
      }
    };

    request.onsuccess = (event) => resolve(event.target.result);

    request.onerror = (event) => {
      const err = event.target.error;
      console.error('[ChunkManager] IndexedDB open failed:', err);
      reject(new Error(`IndexedDB open failed: ${err ? err.name + ' - ' + err.message : 'unknown error'}`));
    };
  });
}

// ============================================================
// SCHEMA STEPS (H-2) — read the ladder comment above `_ensureStore` first.
// ============================================================
//
// `SCHEMA_STEPS[v]` brings a database from version v-1 to version v. Steps only
// ever create; nothing here may delete a store. Assigned outside the class body so
// it stays a plain, extendable object — the tests register a synthetic step to
// drive a real 2 → 3 upgrade against a seeded database, which is the whole accept
// criterion of PR 6d.
export const SCHEMA_STEPS = {
  // Version 1 — the original schema: the two stores and the `worldName` index.
  1: (db, tx) => ensureBaseSchema(db, tx),

  // Version 2 — no schema change of its own. PR 6c world-scoped the `chunks` store's
  // primary key, but that is a change to the *values* of existing keys, not to the
  // schema, and it runs as a data migration from `_openDB`
  // (`_migrateToWorldScopedKeys`) precisely because H-2 made this handler unusable.
  // The base schema is re-ensured rather than skipped because a database can
  // legitimately arrive here without its stores: H-3 creates a version-1 database
  // with none.
  2: (db, tx) => ensureBaseSchema(db, tx),
};
