/**
 * Cuubz — Chunk key helpers and the H-1 re-keying migration (PR 23)
 *
 * Split out of ChunkManager.js. Two things live here because they are the same
 * subject from two directions: the functions that MAKE a storage key, and the
 * migration that rewrote every storage key that predates them.
 *
 * A LEAF apart from ChunkConstants.js — it must not import ChunkManager.js, or the
 * mixins ChunkManager.js assembles would form a cycle (see ChunkConstants.js).
 *
 * ChunkManager.js re-attaches the four pure functions below as the statics they used
 * to be — `ChunkManager.key`, `.parseKey`, `.worldKeyPrefix`, `.isWorldScopedStoreKey`
 * — so every existing call site, `src/testBridge.js` and `test/e2e/saveLoad.js`
 * included, resolves unchanged. Inside `src/engine/world/` the bare function names are
 * used directly; `no-undef` is what catches a missed one, because `ChunkManager` is not
 * in scope in any of these files.
 */

import { STORE_CHUNKS } from './ChunkConstants.js';

// ============================================================
// CHUNK KEY HELPERS
// ============================================================

/** Re-attached as `ChunkManager.key`. */
export function chunkKey(cx, cz) { return `${cx},${cz}`; }

/** Re-attached as `ChunkManager.parseKey`. */
export function parseChunkKey(key) {
  const [cx, cz] = key.split(',').map(Number);
  return { cx, cz };
}

// ============================================================
// STORAGE KEY HELPERS (H-1)
// ============================================================
//
// `chunkKey(cx, cz)` above is the LOGICAL chunk key: `"-3,7"`. It is the
// key of `memoryCache`, of `manifest.generatedChunks[].key`, and of the worker
// protocol — none of which are world-scoped concepts, and all of which would
// cascade into the manifest format (a DEPLOY.md §2.1 invariant) if it changed.
// So it does not change.
//
// What changed for H-1 is the STORAGE key: the primary key of the `chunks`
// object store. It used to be the logical key, which made chunk (0,0) a single
// shared record across every world slot — one visit to a second world destroyed
// 1,073 of the first world's 1,184 saved chunks (DEPLOY.md §7.1). It is now
// `${worldName}:${logicalKey}`, applied at exactly the seven sites that touch
// that store and nowhere else.
//
// The separator is `:` — the same one the localStorage key space already uses
// (`cuubz:worldSlot:0:conf`). A logical key is only digits, `-` and `,`, so the
// presence of a `:` is an exact discriminator between a world-scoped key and a
// pre-migration bare one, whatever a world id contains.
//
// `_storeKey` — the instance method that applies the prefix — is NOT here. It reads
// `this.worldName`, so it belongs with the store it keys: ChunkStorage.js.

/** Prefix owning every stored chunk of a world. Re-attached as `ChunkManager.worldKeyPrefix`. */
export function worldKeyPrefix(worldName) { return `${worldName}:`; }

/** True if `k` is already world-scoped, i.e. does not need migrating. */
export function isWorldScopedStoreKey(k) {
  return typeof k === 'string' && k.indexOf(':') !== -1;
}

// ============================================================
// H-1 MIGRATION (prototype mixin — `this` is the ChunkManager instance)
// ============================================================
//
// Kept a method rather than a free function because `_openDB` calls it as
// `this._migrateToWorldScopedKeys(db)`. It reads no instance field at all — every
// input arrives through `db` — so it is the cheapest boundary in the whole split:
// ZERO fields cross it.
export const ChunkKeyMigrationMethods = {
  /**
   * H-1 MIGRATION — re-key every pre-6c chunk record under `${worldName}:${chunkKey}`.
   *
   * Runs at DB_VERSION 2 rather than in `onupgradeneeded`, deliberately. H-2: that
   * handler enumerates every object store, `deleteObjectStore`s all of them and
   * recreates them empty (see the warning in DEPLOY.md §2.1), so bumping the version
   * to trigger an upgrade would destroy every player's worlds on the way to fixing
   * their keys. Nothing here touches the schema, so nothing needs a version bump.
   *
   * The data needed is already present: every write site sets a `worldName` field on
   * the record, so each row knows which world it belongs to. (There is also a
   * non-unique index on that field, `:274`, which no read path has ever used.)
   *
   * Idempotent — a record whose key already contains `:` is skipped, so a second run
   * on a migrated database does no writes at all.
   *
   * WHAT THIS CANNOT DO: recover data H-1 already destroyed. A contaminated record
   * only remembers its LAST writer, so it migrates into that world and the other
   * world regenerates those chunks from its seed. Terrain is deterministic, so the
   * regenerated ground is identical; what is gone is any player edit inside those
   * chunks, and it was already gone before this ran.
   *
   * @returns {Promise<{migrated: number, unclaimed: number}>}
   */
  async _migrateToWorldScopedKeys(db) {
    // Keys only — no payloads. Cheap even at several thousand records, which matters
    // because this runs on every world entry, not just once.
    const legacyKeys = await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_CHUNKS], 'readonly');
      const request = tx.objectStore(STORE_CHUNKS).getAllKeys();
      request.onsuccess = () => resolve((request.result || []).filter(k => !isWorldScopedStoreKey(k)));
      request.onerror = () => reject(request.error || new Error('Chunk key scan failed'));
    });

    if (legacyKeys.length === 0) return { migrated: 0, unclaimed: 0 };

    let migrated = 0;
    let unclaimed = 0;

    // Batched the same way flushDirty batches, and for the same reason: a single
    // transaction over thousands of read+write+delete triples is the case mobile
    // IndexedDB implementations handle worst.
    const BATCH_SIZE = 500;
    for (let start = 0; start < legacyKeys.length; start += BATCH_SIZE) {
      const batch = legacyKeys.slice(start, start + BATCH_SIZE);
      const tx = db.transaction([STORE_CHUNKS], 'readwrite');
      const store = tx.objectStore(STORE_CHUNKS);

      for (const oldKey of batch) {
        const request = store.get(oldKey);
        request.onsuccess = () => {
          const record = request.result;
          // A record with no `worldName` cannot be attributed to a world, and
          // guessing would put one world's terrain into another — the exact failure
          // this migration exists to end. Left in place, counted, and reported: it
          // is unreachable rather than destroyed, and no read path can serve it.
          if (!record || !record.worldName) { unclaimed++; return; }
          store.put(Object.assign({}, record, { chunkKey: `${record.worldName}:${record.chunkKey}` }));
          store.delete(oldKey);
          migrated++;
        };
      }

      await new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('Chunk key migration transaction failed'));
        tx.onabort = () => reject(new Error('Chunk key migration transaction aborted'));
      });
    }

    console.info(
      `[ChunkManager] H-1 migration: re-keyed ${migrated} chunk record(s) to \`worldName:cx,cz\`` +
      (unclaimed > 0 ? `; left ${unclaimed} record(s) with no worldName field in place (unattributable)` : '')
    );
    return { migrated, unclaimed };
  }
};
