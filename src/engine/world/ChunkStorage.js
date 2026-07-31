/**
 * Cuubz — Chunk persistence: the `chunks` object store and the dirty-flush manager (PR 23)
 *
 * Split out of ChunkManager.js. A PROTOTYPE MIXIN: every method below is the byte-identical
 * body it had as a class member and `this` is still the ChunkManager instance, so no call
 * site — internal or external — changed. `test/e2e/saveLoad.js` reaches
 * `ChunkManager.prototype._storeKey` directly; that still resolves, because these methods
 * land on the prototype.
 *
 * FIELDS CROSSING THIS BOUNDARY: 11 — `_db`, `_dbReady`, `_manifest`, `_flushQueue`,
 * `_flushing`, `_flushIntervalId`, `memoryCache`, `worldName`, `worldSeed`, `stats`,
 * `_disposed`.
 * High, and unavoidably so: this is the group the twelve shared fields exist FOR. It is
 * exactly why the split is mixins and not composition (decision 44) — converting it
 * would have rewritten every call site, which is how D-19 got reintroduced last time.
 *
 * WHAT IS DELIBERATELY NOT CUT OUT OF HERE, and must not be later:
 *
 *   • The flush half. `flushDirty` is the only thing that reads `_flushQueue` +
 *     `memoryCache` + `_manifest` + `_db` + `_storeKey` together, and
 *     `_setupGracefulShutdown` writes BOTH object stores in ONE transaction
 *     specifically because D-19 required them not to disagree — a chunk saved on tab
 *     close used to keep the checksum the manifest recorded for its PREVIOUS bytes,
 *     which `_batchEnsureChunks` now verifies and would read as corruption. Separating
 *     them is how that comes back.
 *
 * WHAT DID COME OUT, and why it was safe:
 *
 *   • The manifest read/write methods → ChunkManifest.js (4 fields cross, vs 10 here).
 *     `flushDirty` still calls `this.loadManifest()` / `this.saveManifest()`; those are
 *     ordinary `this.` calls and a mixin boundary is invisible to them. The
 *     `beforeunload` handler does NOT use them — it writes `STORE_MANIFESTS` inline,
 *     in its own transaction, which is the D-19 guarantee above.
 *   • `_migrateToWorldScopedKeys` → ChunkKeys.js (0 fields cross — every input arrives
 *     through the `db` argument).
 *   • The schema ladder and the opener → ChunkSchema.js (0 fields cross).
 */

import { STORE_CHUNKS, STORE_MANIFESTS } from './ChunkConstants.js';
import { ChunkBinaryCodec } from './ChunkBinaryCodec.js';
import { mergeManifestEntries } from './ChunkManifest.js';
import { openDatabase } from './ChunkSchema.js';

export const ChunkStorageMethods = {
  /**
   * Open IndexedDB for this manager. Returns Promise<IDBDatabase>.
   *
   * Every one of the seven chunk-store call sites awaits this first, which is what
   * makes it the correct place to run the H-1 key migration: no read or write can
   * observe a half-migrated store.
   */
  async _openDB() {
    if (this._dbReady) return this._dbReady;

    const opened = openDatabase().then((db) => {
      this._db = db;
      return db;
    });

    // Migrate before anyone can read or write. A migration failure must not make the
    // world unopenable — it leaves the store as it was, which is the pre-6c behaviour.
    this._dbReady = opened.then(async (db) => {
      try {
        await this._migrateToWorldScopedKeys(db);
      } catch (err) {
        console.error('[ChunkManager] Chunk key migration failed — continuing with the store as found:', err);
      }
      return db;
    });

    return this._dbReady;
  },

  /** Get chunk store in given mode. */
  _getStore(mode = 'readonly') {
    if (!this._db) throw new Error('ChunkManager: IndexedDB not initialized');
    return this._db.transaction([STORE_CHUNKS], mode).objectStore(STORE_CHUNKS);
  },

  /** Get manifest store in given mode. */
  _getManifestStore(mode = 'readonly') {
    if (!this._db) throw new Error('ChunkManager: IndexedDB not initialized');
    return this._db.transaction([STORE_MANIFESTS], mode).objectStore(STORE_MANIFESTS);
  },

  // ============================================================
  // STORAGE KEY (H-1) — see ChunkKeys.js for the full rationale
  // ============================================================

  /** Logical chunk key → the `chunks` store's primary key for THIS world. */
  _storeKey(key) { return `${this.worldName}:${key}`; },

  // ============================================================
  // INDEXEDDB OPERATIONS
  // ============================================================

  /**
   * Save a chunk to IndexedDB. Returns Promise<void>.
   *
   * Takes a LOGICAL key and world-scopes it on the way in (H-1). Same for the
   * three methods below and the four batch sites further down — those seven are
   * the entire chunk-store boundary.
   */
  async saveChunk(key, binaryData) {
    await this._openDB();
    const store = this._getStore('readwrite');
    store.put({ chunkKey: this._storeKey(key), worldName: this.worldName, data: binaryData, savedAt: Date.now() });
    return new Promise((resolve, reject) => {
      const tx = store.transaction;
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  /** Load a chunk from IndexedDB. Returns Promise<ArrayBuffer|null>. */
  async loadChunk(key) {
    await this._openDB();
    const store = this._getStore('readonly');
    return new Promise((resolve, reject) => {
      const request = store.get(this._storeKey(key));
      request.onsuccess = () => resolve(request.result ? request.result.data : null);
      request.onerror = () => reject(request.error);
    });
  },

  /** Check if chunk exists in storage. */
  async hasChunk(key) {
    await this._openDB();
    const store = this._getStore('readonly');
    return new Promise((resolve, reject) => {
      const request = store.count(this._storeKey(key));
      request.onsuccess = () => resolve(request.result > 0);
      request.onerror = () => reject(request.error);
    });
  },

  /**
   * Delete a chunk from storage.
   *
   * D-17: this used to call `store.delete(key)` TWICE — two separate IDBRequests,
   * one per handler — so every call issued two delete operations. Idempotent, hence
   * harmless, hence unnoticed. One request, both handlers.
   */
  async deleteChunk(key) {
    await this._openDB();
    const store = this._getStore('readwrite');
    return new Promise((resolve, reject) => {
      const request = store.delete(this._storeKey(key));
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  },

  // ============================================================
  // DIRTY FLUSH MANAGER (simplified — single path)
  // ============================================================

  /** Start periodic flush timer. */
  startFlushTimer(intervalMs = 5000) {
    if (this._flushIntervalId) return;
    this._flushIntervalId = setInterval(() => this.flushDirty(), intervalMs);
  },

  /** Stop periodic flush timer. */
  stopFlushTimer() {
    if (this._flushIntervalId) {
      clearInterval(this._flushIntervalId);
      this._flushIntervalId = null;
    }
  },

  /** Queue a chunk for dirty flush. */
  queueForFlush(key) {
    this._flushQueue.add(key);
  },

  /**
   * Flush all dirty chunks to IndexedDB with batched operations.
   *
   * PERFORMANCE: The old approach saved each dirty chunk sequentially with its
   * own IndexedDB transaction, readback verification, and manifest update —
   * totalling ~3N transactions for N dirty chunks. On mobile / low-power
   * devices with IndexedDB, this could take minutes to flush a full world.
   *
   * This batched version:
   *   1. Encodes all chunks upfront (CPU work, no I/O waits between)
   *   2. Writes ALL chunks in a SINGLE IndexedDB transaction
   *   3. Updates the manifest in a SINGLE write (not N writes)
   *   4. Skips per-chunk readback verification — checksum is embedded in
   *      the binary header and will be verified when the chunk is loaded.
   */
  async flushDirty() {
    if (this._disposed || this._flushQueue.size === 0 || this._flushing) return;
    this._flushing = true;

    const keysToFlush = [...this._flushQueue];
    this._flushQueue.clear();

    // ═══════════════════════════════════════════════════════════════
    // Phase 1: Encode all dirty chunks (CPU work, parallel-friendly)
    // ═══════════════════════════════════════════════════════════════
    const entries = [];
    for (const key of keysToFlush) {
      const chunk = this.memoryCache.get(key);
      if (!chunk || !chunk.dirty) continue;

      try {
        const binaryData = ChunkBinaryCodec.encode(chunk);
        // Read checksum from encoded buffer instead of recomputing —
        // ChunkBinaryCodec.encode() embeds the FNV-1a hash at offset 16
        const checksum = new DataView(binaryData).getUint32(16, true);
        entries.push({ key, binaryData, checksum, chunk });
      } catch (err) {
        console.warn(`[ChunkManager] Encode error for ${key}:`, err.message);
        const stillDirty = this.memoryCache.get(key);
        if (stillDirty && stillDirty.dirty) this._flushQueue.add(key);
      }
    }

    if (entries.length === 0) {
      this._flushing = false;
      return;
    }

    // ═══════════════════════════════════════════════════════════════
    // Phase 2: Write chunks in batched IndexedDB transactions
    // ═══════════════════════════════════════════════════════════════
    // Split into batches of 500 to avoid IndexedDB transaction size limits.
    // Most browsers handle thousands of puts per transaction, but keeping
    // batches modest avoids edge cases on mobile / low-memory devices.
    const BATCH_SIZE = 500;
    await this._openDB();

    for (let batchStart = 0; batchStart < entries.length; batchStart += BATCH_SIZE) {
      const batch = entries.slice(batchStart, batchStart + BATCH_SIZE);

      try {
        const tx = this._db.transaction([STORE_CHUNKS], 'readwrite');
        const store = tx.objectStore(STORE_CHUNKS);

        for (const { key, binaryData } of batch) {
          store.put({ chunkKey: this._storeKey(key), worldName: this.worldName, data: binaryData, savedAt: Date.now() });
        }

        await new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error('Batch write transaction failed'));
          tx.onabort = () => reject(new Error('Batch write transaction aborted'));
        });
      } catch (err) {
        console.warn(`[ChunkManager] Batch flush write failed (batch ${batchStart / BATCH_SIZE}):`, err.message);
        // Re-queue all entries in this batch whose chunks are still dirty
        for (const { key, chunk } of batch) {
          if (chunk.dirty) this._flushQueue.add(key);
        }
        continue; // Try remaining batches
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // Phase 3: Update manifest in a SINGLE write
    // ═══════════════════════════════════════════════════════════════
    try {
      let manifest = this._manifest || await this.loadManifest();
      if (!manifest) {
        manifest = {
          worldName: this.worldName,
          seed: this.worldSeed,
          createdAt: Date.now(),
          lastPlayed: Date.now(),
          playerCount: 1,
          spawnPoint: { x: 0, y: 68, z: 0 },
          generatedChunks: []
        };
      }
      manifest.generatedChunks = mergeManifestEntries(manifest.generatedChunks, entries);
      manifest.lastPlayed = Date.now();
      await this.saveManifest(manifest);
      this._manifest = manifest;
    } catch (err) {
      console.warn(`[ChunkManager] Manifest batch update failed:`, err.message);
      // Chunks are saved even if manifest update fails — not critical
    }

    // ═══════════════════════════════════════════════════════════════
    // Phase 4: Mark all chunks clean
    // ═══════════════════════════════════════════════════════════════
    for (const { key, chunk } of entries) {
      chunk.dirty = false;
      this.stats.chunksFlushed++;
    }

    this._flushing = false;
  },

  /** Graceful shutdown: flush dirty chunks before tab close. */
  _setupGracefulShutdown() {
    const self = this;

    // Use sendBeacon-style synchronous IndexedDB flush for beforeunload.
    // This is best-effort — we batch as much as possible into one transaction.
    window.addEventListener('beforeunload', () => {
      if (self._flushQueue.size === 0) return;
      try {
        const db = self._db;
        if (!db) return;
        const keys = [...self._flushQueue];
        self._flushQueue.clear();

        // D-19: this used to write chunks WITHOUT updating the manifest, so a chunk
        // saved on tab close kept the checksum the manifest recorded for its previous
        // bytes. Nothing read those checksums, so nothing noticed — until
        // _batchEnsureChunks started verifying them, at which point a stale entry
        // would look exactly like corruption. Both stores are written in ONE
        // transaction so they cannot disagree, and the manifest comes from the
        // in-memory copy: `beforeunload` has no budget for an async read-modify-write.
        const stores = self._manifest ? [STORE_CHUNKS, STORE_MANIFESTS] : [STORE_CHUNKS];
        const tx = db.transaction(stores, 'readwrite');
        const store = tx.objectStore(STORE_CHUNKS);

        const written = [];
        for (const key of keys) {
          const chunk = self.memoryCache.get(key);
          if (!chunk || !chunk.dirty) continue;
          try {
            const data = ChunkBinaryCodec.encode(chunk);
            store.put({ chunkKey: self._storeKey(key), worldName: self.worldName, data, savedAt: Date.now() });
            written.push({ key, checksum: new DataView(data).getUint32(16, true) });
            chunk.dirty = false;
          } catch (_) {}
        }

        if (self._manifest && written.length > 0) {
          self._manifest.generatedChunks = mergeManifestEntries(self._manifest.generatedChunks, written);
          self._manifest.lastPlayed = Date.now();
          tx.objectStore(STORE_MANIFESTS).put(self._manifest);
        }
      } catch (_) {}
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && self._flushQueue.size > 0) {
        self.flushDirty().catch(() => {});
      }
    });
  },

  /**
   * Load multiple chunks from IndexedDB in a single transaction.
   *
   * Takes LOGICAL keys, reads world-scoped store keys (H-1), and returns
   * `Map<logicalKey, {data, worldName, checksum}|null>` keyed by the logical key the
   * caller passed in. The whole record rather than just `data`, because
   * `_batchEnsureChunks` verifies `worldName` and the header checksum before trusting
   * the bytes — see the integrity check there.
   */
  async _batchLoadChunks(keys) {
    if (keys.length === 0) return new Map();
    await this._openDB();

    const results = new Map();
    const tx = this._db.transaction([STORE_CHUNKS], 'readonly');
    const store = tx.objectStore(STORE_CHUNKS);

    // Queue all gets, then wait for the transaction to complete.
    // Each callback sets its slot in the results map.
    await new Promise((resolve, reject) => {
      for (const key of keys) {
        const request = store.get(this._storeKey(key));
        request.onsuccess = () => {
          const record = request.result;
          // A record shorter than the 20-byte header has no checksum field to read;
          // decode() rejects it a moment later, which is the right place to fail.
          const readable = record && record.data && record.data.byteLength >= 20;
          results.set(key, record ? {
            data: record.data,
            worldName: record.worldName,
            checksum: readable ? new DataView(record.data).getUint32(16, true) : null,
          } : null);
        };
        request.onerror = () => {
          results.set(key, null);
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Batch load transaction failed'));
      tx.onabort = () => reject(new Error('Batch load transaction aborted'));
    });

    return results;
  },
};
