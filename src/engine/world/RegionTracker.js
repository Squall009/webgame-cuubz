/**
 * Cuubz — Region residency: which chunks are in RAM (PR 23)
 *
 * Split out of ChunkManager.js. A PROTOTYPE MIXIN: every method below is the byte-identical
 * body it had as a class member and `this` is still the ChunkManager instance, so no call
 * site — internal or external — changed. `ChunkStreamer` calls `_ensureChunkInMemory`
 * from outside; that still resolves.
 *
 * FIELDS CROSSING THIS BOUNDARY: 13 — `_disposed`, `clientMode`, `regionRadius`,
 * `memoryCache`, `_manifest`, `_flushQueue`, `worldName`, `worldSeed`, `genParams`,
 * `stats`, `lastPlayerX`, `lastPlayerZ`, `_regionCheckTimerId` (the last three are
 * written ONLY here and by the render loop, so they are the cheap ones).
 *
 * `_batchEnsureChunks` is the integrity gate, not just a loader: it is the only reader
 * that verifies a record's `worldName` against this world (the check that would CATCH
 * H-1 coming back — the world-scoped keys are what fix it) and the only one that
 * reconciles a stale manifest checksum against intact bytes rather than deleting the
 * chunk (D-19). Both behaviours are unchanged here; read the comments inside before
 * touching either.
 */

import { CHUNK_W, CHUNK_D } from './ChunkConstants.js';
import { computeHumidityMap } from './BiomeSystem.js';
import { ChunkBinaryCodec } from './ChunkBinaryCodec.js';
import { chunkKey, parseChunkKey } from './ChunkKeys.js';
import { mergeManifestEntries } from './ChunkManifest.js';

export const RegionTrackerMethods = {
  /** Start periodic region check. */
  startRegionCheck(intervalMs = 500) {
    if (this._regionCheckTimerId) return;
    const self = this;
    const tick = () => {
      if (!self._disposed) {
        self.checkRegion(self.lastPlayerX, self.lastPlayerZ);
        self._regionCheckTimerId = setTimeout(tick, intervalMs);
      }
    };
    this._regionCheckTimerId = setTimeout(tick, intervalMs);
  },

  /** Stop periodic region check. */
  stopRegionCheck() {
    if (this._regionCheckTimerId) {
      clearTimeout(this._regionCheckTimerId);
      this._regionCheckTimerId = null;
    }
  },

  /** Check region around player — ensure chunks exist in memory. Called on tick and boundary crossing. */
  async checkRegion(playerX, playerZ) {
    if (this._disposed) return;

    // Client mode: chunks are received from host via CHUNK_DATA — never generate locally
    if (this.clientMode) return;

    const pcx = Math.floor(playerX / CHUNK_W);
    const pcz = Math.floor(playerZ / CHUNK_D);
    const radius = this.regionRadius;

    // Collect keys that should be in memory but aren't yet
    const missing = [];
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const cx = pcx + dx;
        const cz = pcz + dz;
        const key = chunkKey(cx, cz);
        if (!this.memoryCache.has(key)) {
          missing.push({ key, cx, cz });
        }
      }
    }

    // Batch-load all missing chunks — single manifest check + single IDB transaction
    await this._batchEnsureChunks(missing);

    // Unload chunks far outside region to bound memory
    const unloadRadius = radius + 2;
    for (const [key] of this.memoryCache) {
      const { cx, cz } = parseChunkKey(key);
      if (Math.abs(cx - pcx) > unloadRadius || Math.abs(cz - pcz) > unloadRadius) {
        // Flush dirty before unloading
        const chunk = this.memoryCache.get(key);
        if (chunk && chunk.dirty) this._flushQueue.add(key);
        this.memoryCache.delete(key);
      }
    }

    // Update last known position
    this.lastPlayerX = playerX;
    this.lastPlayerZ = playerZ;
  },

  /**
   * Batch-ensure multiple chunks are in memory cache.
   *
   * PERFORMANCE: Old approach called _ensureChunkInMemory per chunk, which
   * did a manifest check + data load in separate IndexedDB transactions.
   * This batch version:
   *   1. Caches the manifest once (in-memory Set for O(1) lookups)
   *   2. Separates keys into "exists in storage" vs "needs generation"
   *   3. Loads all existing chunks in a SINGLE IndexedDB transaction
   *   4. Queues all remaining chunks for background generation
   */
  async _batchEnsureChunks(entries) {
    if (this._disposed || entries.length === 0) return;

    // Filter to only keys not already in memory
    const missing = entries.filter(({ key }) => !this.memoryCache.has(key));
    if (missing.length === 0) return;

    // Cache manifest for O(1) lookup
    const manifest = this._manifest || await this.loadManifest();
    this._manifest = manifest;

    // Map of known chunk key → recorded checksum (null for legacy string entries,
    // which predate checksums and therefore cannot be verified).
    const manifestChecksums = new Map();
    if (manifest && manifest.generatedChunks) {
      for (const entry of manifest.generatedChunks) {
        if (typeof entry === 'string') manifestChecksums.set(entry, null);
        else manifestChecksums.set(entry.key, entry.checksum ?? null);
      }
    }

    // Separate: those in storage (load from DB) vs those needing generation
    const toLoad = [];
    const toGenerate = [];

    for (const { key, cx, cz } of missing) {
      if (manifestChecksums.has(key)) {
        toLoad.push({ key, cx, cz });
      } else {
        toGenerate.push({ cx, cz });
      }
    }

    // Batch-load existing chunks from IndexedDB (single transaction)
    if (toLoad.length > 0) {
      const loadedData = await this._batchLoadChunks(toLoad.map(e => e.key));
      const healed = [];

      for (const { key, cx, cz } of toLoad) {
        const record = loadedData.get(key);
        if (record && record.data) {
          // ── Integrity check: defence in depth behind the world-scoped keys ──
          //
          // The keys are what FIX H-1; this is what would CATCH it coming back. A
          // record that names a different world has to be foreign terrain, and
          // serving it is precisely the corruption of DEPLOY.md §7.1 — one visit to
          // a second world used to leave the player standing in it. Regenerating is
          // always safe: terrain is deterministic from the seed.
          if (record.worldName && record.worldName !== this.worldName) {
            console.warn(
              `[ChunkManager] Chunk ${key} is stored under this world but claims world ` +
              `"${record.worldName}" — discarding it and regenerating rather than serving foreign terrain`
            );
            try { await this.removeChunk(key); } catch (_) {}
            toGenerate.push({ cx, cz });
            continue;
          }

          // A checksum disagreement is NOT treated as corruption, and must not be:
          // decode() below verifies the bytes against the checksum they carry, so
          // real damage is caught there. A manifest that disagrees with intact,
          // correctly-owned bytes means the manifest entry is stale, and the honest
          // repair is to record what is actually stored. Deleting the chunk here
          // would discard whatever the player built immediately before the write
          // that outran the manifest.
          const recorded = manifestChecksums.get(key);
          if (recorded !== null && recorded !== undefined && recorded !== record.checksum) {
            healed.push({ key, checksum: record.checksum });
          }

          try {
            const chunk = ChunkBinaryCodec.decode(record.data);
            chunk.dirty = false;
            chunk.humidityMap = computeHumidityMap(this.worldSeed, cx, cz, this.genParams);
            this.memoryCache.set(key, chunk);
            this.stats.chunksLoadedFromDisk++;
          } catch (e) {
            console.warn('[ChunkManager] Batch decode failed for', key, ':', e.message);
            try { await this.removeChunk(key); } catch (_) {}
            toGenerate.push({ cx, cz });
          }
        } else {
          // Manifest says it exists but data is missing — clean up.
          // This is also the path a world takes for chunks H-1 already lost to
          // another world: the record migrated to whichever world wrote it last,
          // so this one finds nothing and regenerates from its seed.
          try { await this.removeChunk(key); } catch (_) {}
          toGenerate.push({ cx, cz });
        }
      }

      if (healed.length > 0) {
        console.warn(
          `[ChunkManager] Repaired ${healed.length} stale manifest checksum(s) — the stored bytes are ` +
          `intact and belong to this world, so the manifest was the thing out of date (D-19)`
        );
        try {
          this._manifest.generatedChunks = mergeManifestEntries(this._manifest.generatedChunks, healed);
          await this.saveManifest(this._manifest);
        } catch (_) {}
      }
    }

    // Queue generation for the rest
    for (const { cx, cz } of toGenerate) {
      this._queueGeneration(cx, cz);
    }
  },

  /**
   * Ensure a single chunk is loaded into memory cache.
   * Kept for backward compatibility (chunkStreamer calls this).
   * Prefer _batchEnsureChunks when loading multiple chunks.
   */
  async _ensureChunkInMemory(cx, cz) {
    if (this._disposed) return;
    const key = chunkKey(cx, cz);
    if (this.memoryCache.has(key)) return;

    // Delegate to the batch implementation for consistency
    await this._batchEnsureChunks([{ key, cx, cz }]);
  },
};
