/**
 * Cuubz — World manifest operations (PR 23)
 *
 * Split out of ChunkManager.js. A PROTOTYPE MIXIN: every method below is the byte-identical
 * body it had as a class member and `this` is still the ChunkManager instance, so no call
 * site — internal or external — changed. See ChunkManager.js for why composition was
 * rejected (decision 44).
 *
 * FIELDS CROSSING THIS BOUNDARY: 4 — `_manifest`, `worldName`, `worldSeed`, `_disposed`.
 * The lowest of any group that touches persistence, which is why the manifest came out
 * of ChunkStorage.js rather than the flush half. The flush half stayed put: `flushDirty`
 * is the only thing that reads `_flushQueue` + `memoryCache` + `_manifest` + `_db` +
 * `_storeKey` together, and `_setupGracefulShutdown` writes BOTH stores in one
 * transaction precisely because D-19 required them not to disagree. Splitting those
 * apart is how D-19 comes back.
 *
 * The manifest FORMAT is a DEPLOY.md §2.1 invariant. `generatedChunks` is a list of
 * `{key, checksum}` with legacy plain-string entries still accepted on read —
 * `mergeManifestEntries` is the single writer that normalises them, and it is exported
 * as a plain function because `flushDirty` (ChunkStorage.js) and `_batchEnsureChunks`
 * (RegionTracker.js) both need it. ChunkManager.js re-attaches it as the static
 * `ChunkManager._mergeManifestEntries` that test/unit/engine/chunkStorage.test.js calls.
 */

/**
 * Merge `{key, checksum}` entries into a manifest's `generatedChunks` list.
 *
 * Normalizes legacy plain-string entries to objects on the way through. Shared by
 * the three sites that record chunk checksums (`addVerifiedChunk`, `flushDirty`
 * phase 3, the `beforeunload` flush) so they cannot drift apart — the recorded
 * checksum is verified against the stored bytes on load (`_batchEnsureChunks`),
 * which only works if every writer records it the same way.
 *
 * @param {Array} generatedChunks existing list, possibly undefined or legacy-shaped
 * @param {Array<{key: string, checksum: number|null}>} entries
 */
export function mergeManifestEntries(generatedChunks, entries) {
  const normalized = (generatedChunks || []).map(entry =>
    typeof entry === 'string' ? { key: entry, checksum: null } : entry
  );

  for (const { key, checksum } of entries) {
    const existingIdx = normalized.findIndex(e => e.key === key);
    if (existingIdx >= 0) {
      normalized[existingIdx] = { key, checksum };
    } else {
      normalized.push({ key, checksum });
    }
  }

  return normalized;
}

// ============================================================
// MANIFEST METHODS (prototype mixin — `this` is the ChunkManager instance)
// ============================================================
export const ChunkManifestMethods = {
  /** Load or create world manifest. */
  async loadManifest() {
    await this._openDB();
    const store = this._getManifestStore('readonly');
    return new Promise((resolve, reject) => {
      const request = store.get(this.worldName);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  },

  /** Save world manifest. */
  async saveManifest(manifest) {
    await this._openDB();
    const store = this._getManifestStore('readwrite');
    if (!manifest.worldName) manifest.worldName = this.worldName;
    if (!manifest.createdAt) manifest.createdAt = Date.now();
    manifest.lastPlayed = Date.now();
    store.put(manifest);
    return new Promise((resolve, reject) => {
      const tx = store.transaction;
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  /** Add verified chunk to manifest with checksum. */
  async addVerifiedChunk(key, checksum) {
    let manifest = await this.loadManifest();
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

    manifest.generatedChunks = mergeManifestEntries(manifest.generatedChunks, [{ key, checksum }]);
    manifest.lastPlayed = Date.now();

    await this.saveManifest(manifest);
    this._manifest = manifest; // Cache locally
  },

  /** Check if chunk is in manifest. */
  async isChunkGenerated(key) {
    let manifest = this._manifest || await this.loadManifest();
    if (!manifest || !manifest.generatedChunks) return false;

    for (const entry of manifest.generatedChunks) {
      const k = typeof entry === 'string' ? entry : entry.key;
      if (k === key) return true;
    }
    return false;
  },

  /** Remove chunk from manifest and storage. */
  async removeChunk(key) {
    try { await this.deleteChunk(key); } catch (_) {}

    let manifest = await this.loadManifest();
    if (!manifest || !manifest.generatedChunks) return;

    const newChunks = manifest.generatedChunks.filter(entry => {
      const k = typeof entry === 'string' ? entry : entry.key;
      return k !== key;
    });

    if (newChunks.length < manifest.generatedChunks.length) {
      manifest.generatedChunks = newChunks;
      await this.saveManifest(manifest);
      this._manifest = manifest;
    }
  },

  // ============================================================
  // EXISTING WORLD LOADING
  // ============================================================

  /** Load an existing world from IndexedDB. */
  async loadExistingWorld() {
    if (this._disposed) return;

    const manifest = await this.loadManifest();
    this._manifest = manifest;

    if (!manifest) {
      console.warn('[ChunkManager] No manifest found — treating as new world');
      return;
    }

    // console.log(`[ChunkManager] Loaded existing world: ${this.worldName} (${manifest.generatedChunks.length} chunks saved)`);
  },

  /** Create a new world manifest. */
  async createNewWorld() {
    if (this._disposed) return;

    const manifest = {
      worldName: this.worldName,
      seed: this.worldSeed,
      createdAt: Date.now(),
      lastPlayed: Date.now(),
      playerCount: 1,
      spawnPoint: { x: 0, y: 68, z: 0 },
      generatedChunks: []
    };

    await this.saveManifest(manifest);
    this._manifest = manifest;
  },
};
