/**
 * Cuubz — Chunk Manager (Monolith)
 * Single authoritative file for:
 *   - Web Worker terrain generation pool
 *   - IndexedDB persistence (save/load/manifest/checksum)
 *   - Dirty flush manager (periodic save with writeback verification)
 *   - Memory cache management (32×32 region in RAM)
 *   - Region tracking (pre-generation beyond render distance)
 *   - Render range integration (8×8 mesh building coordination)
 *   - Mesh builder worker pool (geometry construction)
 *
 * Does NOT include: mesh geometry building logic (meshbuilder.js), block constants (chunkData.js).
 */

// ============================================================
// CONSTANTS
// ============================================================
const CHUNK_W = 16;
const CHUNK_D = 16;
const DB_NAME = 'cuubz-worlds';
const DB_VERSION = 2;
const STORE_CHUNKS = 'chunks';
const STORE_MANIFESTS = 'manifests';

// ============================================================
// WORKER POOL (voxel generation)
// ============================================================
class WorkerPool {
  constructor(count, workerUrl) {
    this.workers = [];
    this.idleWorkers = [];
    const numWorkers = Math.max(2, count || (navigator.hardwareConcurrency || 4));
    for (let i = 0; i < numWorkers; i++) {
      const w = new Worker(workerUrl);
      this.workers.push(w);
      this.idleWorkers.push(w);
    }
  }

  dispatch(chunkX, chunkZ, seed, params) {
    const self = this;
    return new Promise((resolve, reject) => {
      let w = self.idleWorkers.pop();
      if (!w) {
        setTimeout(() => {
          self.dispatch(chunkX, chunkZ, seed, params).then(resolve).catch(reject);
        }, 0);
        return;
      }

      const handler = (e) => {
        w.removeEventListener('message', handler);
        w.removeEventListener('error', errorHandler);
        clearTimeout(timeoutId);
        self.idleWorkers.push(w);
        if (e.data && e.data.type === 'error') {
          reject(new Error('[Worker] Chunk [' + chunkX + ',' + chunkZ + '] error: ' + (e.data.error || 'unknown')));
        } else {
          resolve(e.data);
        }
      };

      const errorHandler = (e) => {
        w.removeEventListener('message', handler);
        w.removeEventListener('error', errorHandler);
        clearTimeout(timeoutId);
        self.idleWorkers.push(w);
        reject(new Error('[Worker] Chunk [' + chunkX + ',' + chunkZ + '] fatal: ' + e.message));
      };

      const timeoutId = setTimeout(() => {
        w.removeEventListener('message', handler);
        w.removeEventListener('error', errorHandler);
        self.idleWorkers.push(w);
        reject(new Error('[Worker] Chunk [' + chunkX + ',' + chunkZ + '] timeout after 10s'));
      }, 10000);

      w.addEventListener('message', handler);
      w.addEventListener('error', errorHandler);
      w.postMessage({ type: 'work', chunkX, chunkZ, seed, params });
    });
  }

  terminate() {
    this.workers.forEach(w => w.terminate());
    this.workers = [];
    this.idleWorkers = [];
  }
}

async function createWorkerPool(workerScriptPath) {
  const response = await fetch(workerScriptPath);
  const source = await response.text();
  const blob = new Blob([source], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  const pool = new WorkerPool(navigator.hardwareConcurrency || 4, url);
  pool._blobUrl = url;
  return pool;
}

// ============================================================
// CHUNK CLASS — uses global from chunkData.js (loaded earlier)
// ============================================================
// The Chunk class is defined in js/world/chunkData.js and exposed globally.
// This file relies on that definition rather than re-declaring it.
// ============================================================
// CHUNK MANAGER (monolith)
// ============================================================
class ChunkManager {
  /**
   * @param {Object} options
   * @param {THREE.Scene|THREE.Group} options.renderer - Renderer instance with chunkGroup property
   * @param {string} options.worldName - World ID for IndexedDB namespace
   * @param {string} options.worldSeed - World seed string
   * @param {Object} options.genParams - Generation parameters (scales, thresholds, etc.)
   * @param {string} [options.workerScriptPath='js/world/workerGeneration.js'] - Path to worker generation script
   * @param {number} [options.renderDistance=4] - Render radius in chunks (8×8 area)
   * @param {number} [options.regionRadius=16] - Pre-generation radius in chunks (32×32 area)
   * @param {*} [options.textureAtlas=null] - Texture atlas instance for UV mapping
   * @param {Function} [options.onChunkGenerated=null] - Callback when a chunk finishes generation
   */
  constructor(options = {}) {
    this.renderer = options.renderer || null;
    this.worldName = options.worldName || 'default';
    this.worldSeed = String(options.worldSeed || '');
    // Defaults match voxelgen.html slider values exactly — do not change without verifying terrain look.
    this.genParams = Object.assign({
      continentScale: 4000, contScale: 400, tempScale: 2000, humScale: 2000, erosScale: 280,
      detailScale: 40, octaves: 5, persistence: 0.5, lacunarity: 2.0,
      caveScale: 50, caveThresh: 0.10, riverScale: 1000, riverDensity: 0.30, riverDepth: 20
    }, options.genParams || {});

    this.workerScriptPath = options.workerScriptPath || 'js/world/workerGeneration.js';
    this.renderDistance   = Math.max(2, Math.min(16, options.renderDistance ?? 4));
    this.regionRadius     = Math.max(this.renderDistance + 2, Math.min(32, options.regionRadius ?? 16));

    // Client mode: no local chunk generation, no IndexedDB persistence, only receive from host
    this.clientMode = !!options.clientMode;

    // Client mode: no generation, no IndexedDB persistence, only receive chunks from host
    this.clientMode = !!options.clientMode;

    // Texture atlas for UV mapping during mesh build
    this.textureAtlas = options.textureAtlas || null;

    // Callbacks
    this.onChunkGenerated = options.onChunkGenerated || null;

    // ─── Worker Pool (voxel generation) ──────────────────────────
    this.workerPool = null;
    this._blobUrl = null;

    // ─── Mesh Builder Worker Pool ────────────────────────────────
    this.meshWorkerPool = null;
    this._meshBlobUrl = null;
    this._pendingMeshBuilds = new Map(); // key → Promise for in-flight mesh builds

    // ─── IndexedDB ───────────────────────────────────────────────
    this._db = null;
    this._dbReady = null;

    // ─── Manifest (world metadata) ──────────────────────────────
    this._manifest = null;

    // ─── Memory Cache (32×32 region in RAM) ─────────────────────
    this.memoryCache = new Map(); // key "cx,cz" → Chunk instance

    // ─── Loaded Meshes (8×8 render range) ────────────────────────
    this.loadedMeshes = new Map(); // key → { solid, cutout, transparent } THREE.Mesh objects
    this._rebuilding = new Set();  // keys currently in mesh build pipeline

    // ─── Dirty Flush Manager ────────────────────────────────────
    this._flushQueue = new Set();      // keys of chunks marked dirty, awaiting flush
    this._flushIntervalId = null;
    this._flushing = false;            // prevent concurrent flush cycles

    // ─── Region Check Timer ─────────────────────────────────────
    this._regionCheckTimerId = null;
    this.lastPlayerX = -32;
    this.lastPlayerZ = -32;

    // ─── Generation Queue (async) ────────────────────────────────
    this._genQueue = [];               // [{cx, cz}] pending generation dispatches
    this._generating = new Set();      // keys currently being generated by workers
    this._genProcessing = false;       // prevent concurrent queue processing

    // ─── Render chunk state ──────────────────────────────────────
    this._renderFrameCount = 0;        // Throttle voxel unload to every N frames
    this._voxelRegionRadius = Math.max(this.renderDistance + 2, Math.min(32, options.regionRadius ?? 16));

    // ─── Mesh worker queue (dispatch coalescing) ────────────────
    this._meshBuildQueue = [];         // pending mesh builds waiting for a free worker
    this._uvLookupCache = null;        // precomputed UV lookup, rebuilt once

    // ─── Stats ──────────────────────────────────────────────────
    this.stats = {
      chunksGenerated: 0,
      chunksLoadedFromDisk: 0,
      chunksFlushed: 0,
      meshesBuilt: 0,
    };

    // ─── Disposed flag ──────────────────────────────────────────
    this._disposed = false;
  }

  // ============================================================
  // INITIALIZATION
  // ============================================================

  /** Initialize worker pools. Must be called before generateChunk or update(). */
  async init() {
    if (this._disposed) return;

    // Client mode: skip voxel generation workers, but keep mesh workers for rendering received chunks
    if (this.clientMode) {
      console.log('[ChunkManager] Client mode: skipping voxel workers, keeping mesh workers');
    } else {
      try {
        const response = await fetch(this.workerScriptPath + (this.workerScriptPath.includes('?') ? '&' : '?') + 'v=' + Date.now());
        const source = await response.text();
        const blob = new Blob([source], { type: 'application/javascript' });
        this._blobUrl = URL.createObjectURL(blob);
        this.workerPool = new WorkerPool(navigator.hardwareConcurrency || 4, this._blobUrl);
      } catch (e) {
        console.warn('[ChunkManager] Worker pool init failed:', e.message);
      }
    }

    // Initialize mesh builder workers (needed for both host and client)
    await this._initMeshWorkers();

    // Open IndexedDB lazily on first access
  }

  /** Initialize mesh builder worker pool. */
  async _initMeshWorkers() {
    try {
      const response = await fetch('js/renderer/meshWorker.js?v=20260726-1');
      const source = await response.text();
      const blob = new Blob([source], { type: 'application/javascript' });
      this._meshBlobUrl = URL.createObjectURL(blob);
      // Use half the cores for mesh building (generation is more compute-heavy)
      const meshCount = Math.max(2, Math.floor((navigator.hardwareConcurrency || 4) / 2));
      this.meshWorkerPool = new WorkerPool(meshCount, this._meshBlobUrl);
    } catch (e) {
      console.warn('[ChunkManager] Mesh worker pool init failed — will build on main thread:', e.message);
      // Fallback: mesh building happens on main thread via _buildMeshInline()
    }
  }

  /**
   * Open IndexedDB. Returns Promise<IDBDatabase>.
   *
   * Every one of the seven chunk-store call sites awaits this first, which is what
   * makes it the correct place to run the H-1 key migration: no read or write can
   * observe a half-migrated store.
   */
  async _openDB() {
    if (this._dbReady) return this._dbReady;

    const opened = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onblocked = (event) => {
        console.error('[ChunkManager] IndexedDB upgrade blocked — another tab may hold the DB open:', event);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        // console.log(`[ChunkManager] IndexedDB upgrade: version ${event.oldVersion} -> ${event.newVersion}`);
        // Drop old stores and recreate — handles schema changes cleanly
        const storesToDelete = [];
        for (let i = 0; i < db.objectStoreNames.length; i++) {
          storesToDelete.push(db.objectStoreNames[i]);
        }
        storesToDelete.forEach(name => db.deleteObjectStore(name));

        const chunkStore = db.createObjectStore(STORE_CHUNKS, { keyPath: 'chunkKey' });
        chunkStore.createIndex('worldName', 'worldName', { unique: false });
        db.createObjectStore(STORE_MANIFESTS, { keyPath: 'worldName' });
      };

      request.onsuccess = (event) => {
        this._db = event.target.result;
        resolve(this._db);
      };

      request.onerror = (event) => {
        const err = event.target.error;
        console.error('[ChunkManager] IndexedDB open failed:', err);
        reject(new Error(`IndexedDB open failed: ${err ? err.name + ' - ' + err.message : 'unknown error'}`));
      };
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
  }

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
      request.onsuccess = () => resolve((request.result || []).filter(k => !ChunkManager.isWorldScopedStoreKey(k)));
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

  /** Get chunk store in given mode. */
  _getStore(mode = 'readonly') {
    if (!this._db) throw new Error('ChunkManager: IndexedDB not initialized');
    return this._db.transaction([STORE_CHUNKS], mode).objectStore(STORE_CHUNKS);
  }

  /** Get manifest store in given mode. */
  _getManifestStore(mode = 'readonly') {
    if (!this._db) throw new Error('ChunkManager: IndexedDB not initialized');
    return this._db.transaction([STORE_MANIFESTS], mode).objectStore(STORE_MANIFESTS);
  }

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
  }

  /** Load a chunk from IndexedDB. Returns Promise<ArrayBuffer|null>. */
  async loadChunk(key) {
    await this._openDB();
    const store = this._getStore('readonly');
    return new Promise((resolve, reject) => {
      const request = store.get(this._storeKey(key));
      request.onsuccess = () => resolve(request.result ? request.result.data : null);
      request.onerror = () => reject(request.error);
    });
  }

  /** Check if chunk exists in storage. */
  async hasChunk(key) {
    await this._openDB();
    const store = this._getStore('readonly');
    return new Promise((resolve, reject) => {
      const request = store.count(this._storeKey(key));
      request.onsuccess = () => resolve(request.result > 0);
      request.onerror = () => reject(request.error);
    });
  }

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
  }

  // ============================================================
  // MANIFEST OPERATIONS
  // ============================================================

  /** Load or create world manifest. */
  async loadManifest() {
    await this._openDB();
    const store = this._getManifestStore('readonly');
    return new Promise((resolve, reject) => {
      const request = store.get(this.worldName);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

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
  }

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
  static _mergeManifestEntries(generatedChunks, entries) {
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

    manifest.generatedChunks = ChunkManager._mergeManifestEntries(manifest.generatedChunks, [{ key, checksum }]);
    manifest.lastPlayed = Date.now();

    await this.saveManifest(manifest);
    this._manifest = manifest; // Cache locally
  }

  /** Check if chunk is in manifest. */
  async isChunkGenerated(key) {
    let manifest = this._manifest || await this.loadManifest();
    if (!manifest || !manifest.generatedChunks) return false;

    for (const entry of manifest.generatedChunks) {
      const k = typeof entry === 'string' ? entry : entry.key;
      if (k === key) return true;
    }
    return false;
  }

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
  }

  // ============================================================
  // CHUNK KEY HELPERS
  // ============================================================

  static key(cx, cz) { return `${cx},${cz}`; }

  static parseKey(key) {
    const [cx, cz] = key.split(',').map(Number);
    return { cx, cz };
  }

  // ============================================================
  // STORAGE KEY HELPERS (H-1)
  // ============================================================
  //
  // `ChunkManager.key(cx, cz)` above is the LOGICAL chunk key: `"-3,7"`. It is the
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

  /** Prefix owning every stored chunk of a world. */
  static worldKeyPrefix(worldName) { return `${worldName}:`; }

  /** True if `k` is already world-scoped, i.e. does not need migrating. */
  static isWorldScopedStoreKey(k) {
    return typeof k === 'string' && k.indexOf(':') !== -1;
  }

  /** Logical chunk key → the `chunks` store's primary key for THIS world. */
  _storeKey(key) { return `${this.worldName}:${key}`; }

  // ============================================================
  // VOXEL GENERATION
  // ============================================================

  /** Generate a single chunk via worker pool. Returns Promise<Chunk>. */
  async generateChunk(cx, cz) {
    if (this._disposed) return null;

    // baseChunkX/baseChunkZ are only used by the worker to compute relative grid coords in its response.
    // They don't affect generation — just set them so the subtraction doesn't produce NaN on first call.
    const genParams = Object.assign({}, this.genParams, { baseChunkX: 0, baseChunkZ: 0 });

    try {
      let result;
      if (this.workerPool) {
        result = await this.workerPool.dispatch(cx, cz, this.worldSeed, genParams);
      } else {
        // Inline fallback
        const genFn = typeof window !== 'undefined' ? window._voxelgenGenerateChunk : null;
        if (!genFn) throw new Error('No worker pool and no inline generation available');
        result = genFn(cx, cz, this.worldSeed, genParams);
      }

      // Reconstruct Chunk from worker result.
      const chunk = new Chunk(cx, cz);

      // Convert worker output (X-major: x*4096 + y*16 + z) to Chunk layout (Y-major: x + z*16 + y*256).
      const workerData = new Uint8Array(result.chunkBytes);
      for (let lx = 0; lx < CHUNK_W; lx++) {
        for (let lz = 0; lz < CHUNK_D; lz++) {
          for (let y = 0; y < CHUNK_HEIGHT; y++) {
            chunk.blocks[lx + (lz * CHUNK_W) + (y * CHUNK_W * CHUNK_D)] = workerData[(lx << 12) + (y << 4) + lz];
          }
        }
      }

      // Store humidity map for vertex color tinting (256 floats, one per column)
      if (result.humidityMap) {
        chunk.humidityMap = new Float32Array(result.humidityMap);
      } else {
        console.warn('[ChunkManager] No humidityMap from worker for chunk', cx, cz);
      }

      this.stats.chunksGenerated++;
      if (this.onChunkGenerated) this.onChunkGenerated(cx, cz);

      return chunk;
    } catch (e) {
      console.error('[ChunkManager] Generation error for', cx, cz, ':', e.message);
      throw e;
    }
  }

  /** Generate full world (128×128 chunks). */
  async generateFullWorld(size = 64) {
    const total = (size * 2) ** 2;
    let completed = 0;

    for (let cx = -size; cx < size; cx++) {
      for (let cz = -size; cz < size; cz++) {
        this._genQueue.push({ cx, cz });
      }
    }

    // Process queue in batches
    await this._processGenQueue();

    // Immediately flush all generated chunks to disk — don't wait for the
    // 5s flush timer. This ensures the initial world data is persisted
    // quickly, reducing perceived save time on mobile / low-power devices.
    if (this._flushQueue.size > 0) {
      await this.flushDirty();
    }
  }

  /** Add chunk to generation queue. Returns Promise when done. */
  _queueGeneration(cx, cz) {
    const key = ChunkManager.key(cx, cz);
    if (this.memoryCache.has(key) || this._generating.has(key)) return null;
    // Check if already queued
    if (this._genQueue.some(item => item.cx === cx && item.cz === cz)) return null;

    this._genQueue.push({ cx, cz });

    // Guard: only one drain loop runs at a time. Multiple callers just push items.
    if (!this._genProcessing) {
      this._genProcessing = true;
      const promise = this._processGenQueue();
      promise.then(() => { this._genProcessing = false; }).catch(() => { this._genProcessing = false; });
      return promise;
    }

    return null; // Already draining — caller's item will be picked up by existing drain.
  }

  /** Process generation queue asynchronously — drains all pending items. */
  async _processGenQueue() {
    if (this._disposed) return;

    // Loop until queue is empty or disposed
    while (this._genQueue.length > 0 && !this._disposed) {
      const batchSize = Math.min(this.workerPool ? this.workerPool.workers.length : 4, this._genQueue.length);
      // console.log(`[ChunkManager] _processGenQueue: batch ${batchSize} of remaining ${this._genQueue.length}`);
      
      // Mark items as generating and remove from queue BEFORE dispatching
        const promises = [];

        for (let i = 0; i < batchSize; i++) {
          const item = this._genQueue.shift();
          const key = ChunkManager.key(item.cx, item.cz);
          if (this.memoryCache.has(key)) continue; // Already loaded while processing
          this._generating.add(key);

          promises.push(
            this.generateChunk(item.cx, item.cz)
              .then(chunk => {
                chunk.dirty = true; // Mark for flush
                this.memoryCache.set(key, chunk);
                this._flushQueue.add(key);
              })
              .catch(e => console.error('[ChunkManager] Queue gen error:', key, e.message))
              .finally(() => this._generating.delete(key))
          );
        }

        // Await THIS batch before starting the next — workers are busy processing
        await Promise.all(promises);
      }
  }

  // ============================================================
  // DIRTY FLUSH MANAGER (simplified — single path)
  // ============================================================

  /** Start periodic flush timer. */
  startFlushTimer(intervalMs = 5000) {
    if (this._flushIntervalId) return;
    this._flushIntervalId = setInterval(() => this.flushDirty(), intervalMs);
  }

  /** Stop periodic flush timer. */
  stopFlushTimer() {
    if (this._flushIntervalId) {
      clearInterval(this._flushIntervalId);
      this._flushIntervalId = null;
    }
  }

  /** Queue a chunk for dirty flush. */
  queueForFlush(key) {
    this._flushQueue.add(key);
  }

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
      manifest.generatedChunks = ChunkManager._mergeManifestEntries(manifest.generatedChunks, entries);
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
  }

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
          self._manifest.generatedChunks = ChunkManager._mergeManifestEntries(self._manifest.generatedChunks, written);
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
  }

  // ============================================================
  // REGION TRACKING (32×32 pre-generation range)
  // ============================================================

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
  }

  /** Stop periodic region check. */
  stopRegionCheck() {
    if (this._regionCheckTimerId) {
      clearTimeout(this._regionCheckTimerId);
      this._regionCheckTimerId = null;
    }
  }

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
        const key = ChunkManager.key(cx, cz);
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
      const { cx, cz } = ChunkManager.parseKey(key);
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
  }

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
  }

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
          this._manifest.generatedChunks = ChunkManager._mergeManifestEntries(this._manifest.generatedChunks, healed);
          await this.saveManifest(this._manifest);
        } catch (_) {}
      }
    }

    // Queue generation for the rest
    for (const { cx, cz } of toGenerate) {
      this._queueGeneration(cx, cz);
    }
  }

  /**
   * Ensure a single chunk is loaded into memory cache.
   * Kept for backward compatibility (chunkStreamer calls this).
   * Prefer _batchEnsureChunks when loading multiple chunks.
   */
  async _ensureChunkInMemory(cx, cz) {
    if (this._disposed) return;
    const key = ChunkManager.key(cx, cz);
    if (this.memoryCache.has(key)) return;

    // Delegate to the batch implementation for consistency
    await this._batchEnsureChunks([{ key, cx, cz }]);
  }

  // ============================================================
  // VOXEL QUERY (neighbor-aware block lookup)
  // ============================================================

  /** Query any voxel by world coordinates. Handles cross-chunk neighbor lookups. */
  getVoxel(wx, wy, wz) {
    const cx = Math.floor(wx / CHUNK_W);
    const cz = Math.floor(wz / CHUNK_D);
    const key = ChunkManager.key(cx, cz);
    const chunk = this.memoryCache.get(key);
    if (!chunk) return BLOCK_TYPES.AIR; // Not loaded → treat as air (safe default for face culling)

    const lx = ((wx % CHUNK_W) + CHUNK_W) % CHUNK_W;
    const lz = ((wz % CHUNK_D) + CHUNK_D) % CHUNK_D;
    return chunk.getBlock(lx, wy, lz);
  }

  /** Get chunk data for a loaded chunk. */
  getChunkData(cx, cz) {
    return this.memoryCache.get(ChunkManager.key(cx, cz)) || null;
  }

  // ============================================================
  // RENDER RANGE (8×8 mesh building coordination)
  // ============================================================

  /** Update render chunks based on player position. Called every frame. */
  updateRenderChunks(playerX, playerZ) {
    if (this._disposed) return;

    const pcx = Math.floor(playerX / CHUNK_W);
    const pcz = Math.floor(playerZ / CHUNK_D);
    const rd = this.renderDistance;

    // --- Voxel region: maintain a 32×32 area of voxel data around player ---
    // Throttled to every 5 frames — called every frame but only acts periodically.
    this._renderFrameCount++;
    if (this._renderFrameCount >= 5) {
      this._renderFrameCount = 0;
      this._updateVoxelRegion(pcx, pcz);
    }

    // --- Render range: build/unload meshes for 8×8 area around player ---
    const needed = new Set();
    for (let dx = -rd; dx <= rd; dx++) {
      for (let dz = -rd; dz <= rd; dz++) {
        needed.add(ChunkManager.key(pcx + dx, pcz + dz));
      }
    }

    // Unload out-of-range meshes
    for (const [key] of this.loadedMeshes) {
      if (!needed.has(key)) {
        this._unloadMesh(key);
      }
    }

    // Build/rebuild in-range meshes
    for (const key of needed) {
      const chunk = this.memoryCache.get(key);
      if (!chunk) continue; // Not loaded yet — region check will load it soon

      if (chunk.changed && !this._rebuilding.has(key)) {
        // Queue for mesh rebuild, immediately clear the flag
        this._queueMeshBuild(ChunkManager.parseKey(key).cx, ChunkManager.parseKey(key).cz, chunk);
        chunk.changed = false;
      } else if (!this.loadedMeshes.has(key) && !this._rebuilding.has(key)) {
        // Not loaded and not rebuilding — queue initial build
        this._queueMeshBuild(ChunkManager.parseKey(key).cx, ChunkManager.parseKey(key).cz, chunk);
      }
    }
  }

  /**
   * Maintain a voxel region around player — mirrors render chunk logic.
   * Loads/generates chunks within _voxelRegionRadius, unloads far-away chunks.
   * Called every few frames from updateRenderChunks with current player position.
   */
  _updateVoxelRegion(pcx, pcz) {
    if (this._disposed) return;

    // Client mode: never generate chunks — only receive from host via CHUNK_DATA
    if (this.clientMode) {
      // Still unload chunks far outside render range to bound memory
      const rd = this.renderDistance;
      const unloadRadius = rd + 2;
      for (const [key] of this.memoryCache) {
        const { cx: ucx, cz: ucz } = ChunkManager.parseKey(key);
        if (Math.abs(ucx - pcx) > unloadRadius || Math.abs(ucz - pcz) > unloadRadius) {
          this.memoryCache.delete(key);
        }
      }
      return;
    }

    const radius = this._voxelRegionRadius;
    const unloadRadius = radius + 2;

    // Collect keys that should be in memory but aren't yet
    const missing = [];
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const cx = pcx + dx;
        const cz = pcz + dz;
        const key = ChunkManager.key(cx, cz);
        if (!this.memoryCache.has(key)) {
          missing.push({ key, cx, cz });
        }
      }
    }

    // Batch-load all missing chunks — single manifest check + single IDB transaction
    // Fire off asynchronously without blocking the frame loop
    if (missing.length > 0) {
      this._batchEnsureChunks(missing).catch(e => {
        console.warn('[ChunkManager] Voxel batch load error:', e.message);
      });
    }

    // Unload chunks far outside voxel region to bound memory
    let unloaded = 0;
    for (const [key] of this.memoryCache) {
      const { cx: ucx, cz: ucz } = ChunkManager.parseKey(key);
      if (Math.abs(ucx - pcx) > unloadRadius || Math.abs(ucz - pcz) > unloadRadius) {
        // Flush dirty before unloading
        const chunk = this.memoryCache.get(key);
        if (chunk && chunk.dirty) this._flushQueue.add(key);
        this.memoryCache.delete(key);
        unloaded++;
      }
    }
    if (unloaded > 0) {
      // console.log(`[Cuubz] _updateVoxelRegion: unloaded ${unloaded} distant chunks`);
    }

    // Update last known position for other systems that need it
    this.lastPlayerX = pcx * CHUNK_W;
    this.lastPlayerZ = pcz * CHUNK_D;
  }

  /** Queue a mesh build for a chunk. */
  _queueMeshBuild(cx, cz, chunk) {
    const key = ChunkManager.key(cx, cz);
    if (this._rebuilding.has(key)) return; // Already in pipeline
    this._rebuilding.add(key);

    // Gather neighbor block arrays for face culling at boundaries.
    // If a real neighbor isn't loaded, fall back to virtual neighbor edge strips
    // (sent by the host in multiplayer for correct water face culling).
    const neighbors = {
      positiveX: this.memoryCache.get(ChunkManager.key(cx + 1, cz))?.blocks
        ?? this._virtualNeighborFromEdge(chunk, 'positiveX'),
      negativeX: this.memoryCache.get(ChunkManager.key(cx - 1, cz))?.blocks
        ?? this._virtualNeighborFromEdge(chunk, 'negativeX'),
      positiveZ: this.memoryCache.get(ChunkManager.key(cx, cz + 1))?.blocks
        ?? this._virtualNeighborFromEdge(chunk, 'positiveZ'),
      negativeZ: this.memoryCache.get(ChunkManager.key(cx, cz - 1))?.blocks
        ?? this._virtualNeighborFromEdge(chunk, 'negativeZ'),
    };

    if (this.meshWorkerPool) {
      // Dispatch to mesh worker pool — UV lookup and neighbor transfers are
      // optimized inside _dispatchMeshBuild (cached UVs, sliced + transferred buffers)
      const promise = this._dispatchMeshBuild(cx, cz, chunk.blocks, neighbors, chunk.humidityMap);
      this._pendingMeshBuilds.set(key, promise);
      promise.then(geoResult => {
        this._onMeshBuilt(key, cx, cz, geoResult);
      }).catch(e => {
        console.warn('[ChunkManager] Mesh build error for', key, ':', e.message);
        this._rebuilding.delete(key);
      });
    } else {
      // Fallback: inline mesh build on main thread
      try {
        const geoResult = this._buildMeshInline(cx, cz, chunk.blocks, neighbors, chunk.humidityMap);
        this._onMeshBuilt(key, cx, cz, geoResult);
      } catch (e) {
        console.warn('[ChunkManager] Inline mesh build error for', key, ':', e.message);
        this._rebuilding.delete(key);
      }
    }
  }

  /** Ensure UV lookup cache is built — computed once from texture atlas, not per-chunk. */
  _ensureUVLookupCache() {
    if (this._uvLookupCache) return;
    if (!this.textureAtlas || !this.textureAtlas.loaded) {
      this._uvLookupCache = null;
      return;
    }
    // Flat array: index = blockType, value = [topU, topV, botU, botV, sideU, sideV, size]
    const cache = new Array(256);
    for (let bid = 0; bid < 256; bid++) {
      try {
        const topF = this.textureAtlas.getFaceUV(bid, 'top');
        const botF = this.textureAtlas.getFaceUV(bid, 'bottom');
        const sideF = this.textureAtlas.getFaceUV(bid, 'front');
        cache[bid] = [
          topF.u || 0, topF.v || 0,
          botF.u || 0, botF.v || 0,
          sideF.u || 0, sideF.v || 0,
          (topF.size || botF.size || sideF.size) || (1.0 / 6)
        ];
      } catch(e) {
        cache[bid] = [0, 0, 0, 0, 0, 0, 1.0/6];
      }
    }
    this._uvLookupCache = cache;
  }

  /**
   * Return a worker to the idle pool, or dispatch queued work if any.
   * This avoids setTimeout(0) polling when all workers are busy — the
   * next queued task is dispatched immediately on the same microtask.
   */
  _returnWorkerOrProcessQueue(w) {
    if (this._meshBuildQueue.length > 0) {
      const next = this._meshBuildQueue.shift();
      this._doMeshBuild(w, next.cx, next.cz, next.blocks, next.neighbors, next.humidityMap,
                        this._uvLookupCache, next.resolve, next.reject);
    } else {
      this.meshWorkerPool.idleWorkers.push(w);
    }
  }

  /**
   * Dispatch mesh build to worker.
   * Returns Promise<geometry>.
   *
   * PERFORMANCE:
   *   - UV lookup table is cached once, not rebuilt per chunk (256×3 = 768
   *     atlas lookups saved per mesh build).
   *   - Neighbor arrays use TypedArray.slice() instead of Array.from().
   *     slice() is a native operation ~100x faster than JS-level iteration
   *     over 4 × 65,536 elements.
   *   - Humidity map uses Float32Array.slice() instead of Array.from().
   *   - All buffers are transferred (zero-copy) to avoid structured clone
   *     duplication on postMessage.
   *   - When all workers are busy, tasks are queued and dispatched on the
   *     same microtask when a worker frees up — no setTimeout(0) polling.
   */
  _dispatchMeshBuild(cx, cz, blocks, neighbors, humidityMap) {
    return new Promise((resolve, reject) => {
      // Use cached UV lookup table — built once
      this._ensureUVLookupCache();
      const uvLookup = this._uvLookupCache;

      // Find an idle worker or queue for later
      const idleWorkers = this.meshWorkerPool.idleWorkers;
      let w = idleWorkers.pop();
      if (!w) {
        this._meshBuildQueue.push({ cx, cz, blocks, neighbors, humidityMap, resolve, reject });
        return;
      }

      this._doMeshBuild(w, cx, cz, blocks, neighbors, humidityMap, uvLookup, resolve, reject);
    });
  }

  /** Internal: send work to a specific worker with optimized data transfer. */
  _doMeshBuild(w, cx, cz, blocks, neighbors, humidityMap, uvLookup, resolve, reject) {
    const handler = (e) => {
      w.removeEventListener('message', handler);
      w.removeEventListener('error', errorHandler);
      clearTimeout(timeoutId);
      this._returnWorkerOrProcessQueue(w);
      if (e.data && e.data.type === 'error') {
        reject(new Error(e.data.error || 'Mesh build failed'));
      } else {
        resolve(e.data);
      }
    };

    const errorHandler = (e) => {
      w.removeEventListener('message', handler);
      w.removeEventListener('error', errorHandler);
      clearTimeout(timeoutId);
      this._returnWorkerOrProcessQueue(w);
      reject(new Error('Mesh worker error: ' + e.message));
    };

    const timeoutId = setTimeout(() => {
      w.removeEventListener('message', handler);
      w.removeEventListener('error', errorHandler);
      this._returnWorkerOrProcessQueue(w);
      reject(new Error(`Mesh build timeout for chunk [${cx},${cz}]`));
    }, 5000);

    w.addEventListener('message', handler);
    w.addEventListener('error', errorHandler);

    // Efficient data transfer
    //   - TypedArray.slice() is a native copy (~100x faster than Array.from())
    //   - All buffers are transferred (zero-copy to worker)
    const blocksCopy = new Uint8Array(blocks);
    const transferList = [blocksCopy.buffer];

    // Slice neighbor Uint8Arrays — native, avoids JS iteration over 4×65K elements
    const neighborBuffers = {};
    for (const dir of ['positiveX', 'negativeX', 'positiveZ', 'negativeZ']) {
      if (neighbors[dir]) {
        const slice = neighbors[dir].slice();
        neighborBuffers[dir] = slice.buffer;
        transferList.push(slice.buffer);
      } else {
        neighborBuffers[dir] = null;
      }
    }

    // Slice humidity map Float32Array
    let humidityBuffer = null;
    if (humidityMap) {
      const slice = humidityMap.slice();
      humidityBuffer = slice.buffer;
      transferList.push(slice.buffer);
    }

    w.postMessage({
      type: 'build',
      cx, cz,
      blocks: blocksCopy.buffer,
      neighbors: neighborBuffers,
      uvLookup: uvLookup,
      humidityMap: humidityBuffer
    }, transferList);
  }

  /**
   * Create a full-sized virtual neighbor chunk array from a 1-deep edge strip.
   * Used in multiplayer when the real neighbor hasn't been received yet.
   * The edge strip is 16 × 256 = 4096 bytes; the virtual array is 16 × 16 × 256 = 65536 bytes
   * with the boundary column populated and the rest filled with AIR (0).
   * Returns null if no edge data is available.
   */
  _virtualNeighborFromEdge(chunk, dir) {
    const edge = chunk.neighborEdges?.[dir];
    if (!edge) return null;

    const full = new Uint8Array(16 * 16 * 256); // all zeros = AIR

    if (dir === 'positiveX' || dir === 'negativeX') {
      // Edge strip is 16(z) × 256(y), stored as strip[z * 256 + y]
      // Virtual chunk index: x + z*16 + y*256
      const edgeX = dir === 'positiveX' ? 0 : 15;
      for (let z = 0; z < 16; z++) {
        for (let y = 0; y < 256; y++) {
          full[edgeX + z * 16 + y * 256] = edge[z * 256 + y];
        }
      }
    } else {
      // Edge strip is 16(x) × 256(y), stored as strip[x * 256 + y]
      // Virtual chunk index: x + z*16 + y*256
      const edgeZ = dir === 'positiveZ' ? 0 : 15;
      for (let x = 0; x < 16; x++) {
        for (let y = 0; y < 256; y++) {
          full[x + edgeZ * 16 + y * 256] = edge[x * 256 + y];
        }
      }
    }

    return full;
  }

  /** Inline mesh build fallback (main thread). */
  _buildMeshInline(cx, cz, blocks, neighbors, humidityMap) {
    // Create a temporary chunk-like object for the mesh builder
    const tempChunk = new Chunk(cx, cz);
    tempChunk.blocks.set(blocks);
    tempChunk.humidityMap = humidityMap;

    // Build neighbor lookup function from neighbor arrays
    const neighborLookup = (wx, wy, wz) => {
      const ncx = Math.floor(wx / CHUNK_W);
      const ncz = Math.floor(wz / CHUNK_D);
      let neighborArray = null;

      if (ncx === cx + 1 && ncz === cz) neighborArray = neighbors.positiveX;
      else if (ncx === cx - 1 && ncz === cz) neighborArray = neighbors.negativeX;
      else if (ncx === cx && ncz === cz + 1) neighborArray = neighbors.positiveZ;
      else if (ncx === cx && ncz === cz - 1) neighborArray = neighbors.negativeZ;

      if (!neighborArray) return BLOCK_TYPES.AIR;

      const nlx = ((wx % CHUNK_W) + CHUNK_W) % CHUNK_W;
      const nlz = ((wz % CHUNK_D) + CHUNK_D) % CHUNK_D;
      if (wy < 0 || wy >= CHUNK_HEIGHT) return BLOCK_TYPES.AIR;
      return neighborArray[nlx + (nlz * CHUNK_W) + (wy * CHUNK_W * CHUNK_D)];
    };

    const meshBuilder = new ChunkMeshBuilder();
    const meshData = meshBuilder.buildMeshData(tempChunk, this.textureAtlas, neighborLookup);
    return meshBuilder.buildThreeGeometry(meshData, tempChunk);
  }

  /** Handle completed mesh build result. */
  _onMeshBuilt(key, cx, cz, geoResult) {
    if (this._disposed) return;
    this._rebuilding.delete(key);

    // Dispose old meshes for this chunk
    this._disposeOldMeshes(key);

    if (!geoResult) {
      this.loadedMeshes.set(key, null);
      return;
    }

    const texMap = this.textureAtlas ? this.textureAtlas.getTexture() : null;
    const pbrFactory = this.renderer ? this.renderer.getPBRFactory() : null;

    let solidMesh = null;
    let cutoutMesh = null;
    let transMesh = null;

    // ── Solid mesh ──────────────────────────────────────────────────
    let solidGeo = null;
    if (geoResult.solid) {
      solidGeo = this._wrapBuffers(geoResult.solid);
    } else if (geoResult.solidGeometry) {
      solidGeo = geoResult.solidGeometry;
    }
    if (solidGeo) {
      const material = pbrFactory
        ? pbrFactory.createSolid(0.0)
        : new THREE.MeshLambertMaterial({ map: texMap, color: 0xffffff, fog: true });
      solidMesh = new THREE.Mesh(solidGeo, material);
      solidMesh.position.set(cx * CHUNK_W, 0, cz * CHUNK_D);
      solidMesh.receiveShadow = true;
      solidMesh.castShadow = true;
    }

    // ── Cutout mesh ─────────────────────────────────────────────────
    let cutoutGeo = null;
    if (geoResult.cutout) {
      cutoutGeo = this._wrapBuffers(geoResult.cutout);
    } else if (geoResult.cutoutGeometry) {
      cutoutGeo = geoResult.cutoutGeometry;
    }
    if (cutoutGeo) {
      const material = pbrFactory
        ? pbrFactory.createCutout(0.0, 0.5)
        : new THREE.MeshLambertMaterial({
            map: texMap, color: 0xffffff, transparent: true, alphaToCoverage: true,
            depthWrite: true, fog: true, side: THREE.DoubleSide
          });
      cutoutMesh = new THREE.Mesh(cutoutGeo, material);
      cutoutMesh.position.set(cx * CHUNK_W, 0, cz * CHUNK_D);
      cutoutMesh.receiveShadow = true;
      cutoutMesh.castShadow = true;
    }

    // ── Transparent mesh ────────────────────────────────────────────
    let transGeo = null;
    if (geoResult.trans) {
      transGeo = this._wrapBuffers(geoResult.trans);
    } else if (geoResult.transparentGeometry) {
      transGeo = geoResult.transparentGeometry;
    }
    if (transGeo) {
      const material = pbrFactory
        ? pbrFactory.createTransparent(0.0, 0.6)
        : new THREE.MeshLambertMaterial({
            map: texMap, color: 0xffffff, transparent: true, opacity: 0.6,
            depthWrite: false, fog: true, side: THREE.DoubleSide
          });
      transMesh = new THREE.Mesh(transGeo, material);
      transMesh.position.set(cx * CHUNK_W, 0, cz * CHUNK_D);
      transMesh.receiveShadow = true;
    }

    // Add to scene graph
    if (this.renderer && this.renderer.chunkGroup) {
      if (solidMesh) this.renderer.chunkGroup.add(solidMesh);
      if (cutoutMesh) this.renderer.chunkGroup.add(cutoutMesh);
      if (transMesh) this.renderer.chunkGroup.add(transMesh);
    }

    this.loadedMeshes.set(key, { solid: solidMesh, cutout: cutoutMesh, trans: transMesh });
    this.stats.meshesBuilt++;
  }

  /** Wrap raw buffer data into THREE.BufferGeometry. */
  _wrapBuffers(data) {
    if (!data || !data.pos) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(data.pos), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(data.norm), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(data.uv), 2));
    // Vertex color attribute for humidity-based tinting — always present (defaults to white)
    if (data.color && data.color.byteLength > 0) {
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(data.color), 3));
    } else {
      // Fallback: all-white vertex colors so the shader always has the attribute
      const posCount = new Float32Array(data.pos).length / 3;
      const whiteColors = new Float32Array(posCount * 3);
      whiteColors.fill(1.0);
      geo.setAttribute('color', new THREE.BufferAttribute(whiteColors, 3));
    }
    if (data.idx && data.idx.byteLength > 0) {
      const idx = new Uint16Array(data.idx);
      if (idx.length > 0) geo.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    // Required for Three.js raycaster to compute hit point/faceNormal
    geo.computeBoundingSphere();
    return geo;
  }

  // ============================================================
  // MESH UNLOADING / DISPOSAL
  // ============================================================

  /** Unload a chunk's mesh from the scene. */
  _unloadMesh(key) {
    const entry = this.loadedMeshes.get(key);
    if (!entry) return;

    for (const mesh of [entry.solid, entry.cutout, entry.trans]) {
      if (!mesh) continue;
      if (this.renderer && this.renderer.chunkGroup) this.renderer.chunkGroup.remove(mesh);
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) mesh.material.dispose();
    }

    this.loadedMeshes.delete(key);
  }

  /** Dispose old meshes for a chunk before replacing with new build. */
  _disposeOldMeshes(key) {
    const existing = this.loadedMeshes.get(key);
    if (!existing) return;

    for (const mesh of [existing.solid, existing.cutout, existing.trans]) {
      if (!mesh) continue;
      if (this.renderer && this.renderer.chunkGroup) this.renderer.chunkGroup.remove(mesh);
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) mesh.material.dispose();
    }

    this.loadedMeshes.delete(key);
  }

  // ============================================================
  // BLOCK MODIFICATION (called by gameplay / interaction)
  // ============================================================

  /** Apply a block change at world coordinates. */
  applyBlockChange(wx, wy, wz, newType) {
    if (this._disposed) return false;

    const cx = Math.floor(wx / CHUNK_W);
    const cz = Math.floor(wz / CHUNK_D);
    const key = ChunkManager.key(cx, cz);

    const chunk = this.memoryCache.get(key);
    if (!chunk) {
      // Chunk not in memory — queue it for loading
      this._ensureChunkInMemory(cx, cz).catch(() => {});
      return false;
    }

    const lx = ((wx % CHUNK_W) + CHUNK_W) % CHUNK_W;
    const lz = ((wz % CHUNK_D) + CHUNK_D) % CHUNK_D;

    if (chunk.setBlock(lx, wy, lz, newType)) {
      // Block actually changed — queue for flush
      this._flushQueue.add(key);
      return true;
    }
    return false;
  }

  /** Mark a chunk as dirty and changed (for remote player changes). */
  markChunkDirty(cx, cz) {
    const key = ChunkManager.key(cx, cz);
    const chunk = this.memoryCache.get(key);
    if (chunk) {
      chunk.dirty = true;
      chunk.changed = true;
      this._flushQueue.add(key);
    }
  }

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
  }

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
  }

  // ============================================================
  // RENDER DISTANCE (performance optimizer integration)
  // ============================================================

  setRenderDistance(distance) {
    const old = this.renderDistance;
    this.renderDistance = Math.max(2, Math.min(16, distance));
    if (this.onRenderDistanceChange && this.renderDistance !== old) {
      this.onRenderDistanceChange(this.renderDistance);
    }
  }

  /**
   * Rebuild all loaded chunk meshes with new materials.
   * Called when texture resolution or advanced shading changes.
   * Marks all chunks as changed so they get rebuilt in the next render tick.
   */
  rebuildAllMeshes() {
    console.log(`[ChunkManager] Rebuilding all meshes (${this.loadedMeshes.size} loaded)`);
    for (const [key] of this.loadedMeshes) {
      const chunk = this.memoryCache.get(key);
      if (chunk) {
        chunk.changed = true;
      }
    }
  }

  // ============================================================
  // DISPOSAL / CLEANUP
  // ============================================================

  dispose() {
    if (this._disposed) return;
    this._disposed = true;

    // Stop timers
    this.stopFlushTimer();
    this.stopRegionCheck();

    // Terminate workers
    if (this.workerPool) {
      this.workerPool.terminate();
      this.workerPool = null;
    }
    if (this.meshWorkerPool) {
      this.meshWorkerPool.terminate();
      this.meshWorkerPool = null;
    }
    if (this._blobUrl) URL.revokeObjectURL(this._blobUrl);
    if (this._meshBlobUrl) URL.revokeObjectURL(this._meshBlobUrl);

    // Dispose all meshes
    for (const [key] of this.loadedMeshes) {
      this._unloadMesh(key);
    }
    this.loadedMeshes.clear();
    this.memoryCache.clear();
    this._flushQueue.clear();
    this._rebuilding.clear();
    this._pendingMeshBuilds.clear();

    // Close IndexedDB
    if (this._db) {
      this._db.close();
      this._db = null;
      this._dbReady = null;
    }
  }
}

// Export for module environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ChunkManager, WorkerPool, createWorkerPool };
}
