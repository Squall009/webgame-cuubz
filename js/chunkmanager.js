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

    try {
      const response = await fetch(this.workerScriptPath + (this.workerScriptPath.includes('?') ? '&' : '?') + 'v=' + Date.now());
      const source = await response.text();
      const blob = new Blob([source], { type: 'application/javascript' });
      this._blobUrl = URL.createObjectURL(blob);
      this.workerPool = new WorkerPool(navigator.hardwareConcurrency || 4, this._blobUrl);
      console.log('[ChunkManager] Voxel worker pool init OK:', this.workerPool.workers.length, 'workers');
    } catch (e) {
      console.warn('[ChunkManager] Worker pool init failed — will use inline fallback:', e.message);
    }

    // Initialize mesh builder workers
    await this._initMeshWorkers();

    // Open IndexedDB lazily on first access
  }

  /** Initialize mesh builder worker pool. */
  async _initMeshWorkers() {
    try {
      const response = await fetch('js/renderer/meshWorker.js');
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

  /** Open IndexedDB. Returns Promise<IDBDatabase>. */
  async _openDB() {
    if (this._dbReady) return this._dbReady;

    this._dbReady = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onblocked = (event) => {
        console.error('[ChunkManager] IndexedDB upgrade blocked — another tab may hold the DB open:', event);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        console.log(`[ChunkManager] IndexedDB upgrade: version ${event.oldVersion} -> ${event.newVersion}`);
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

    return this._dbReady;
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

  /** Save a chunk to IndexedDB. Returns Promise<void>. */
  async saveChunk(key, binaryData) {
    await this._openDB();
    const store = this._getStore('readwrite');
    store.put({ chunkKey: key, worldName: this.worldName, data: binaryData, savedAt: Date.now() });
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
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result ? request.result.data : null);
      request.onerror = () => reject(request.error);
    });
  }

  /** Check if chunk exists in storage. */
  async hasChunk(key) {
    await this._openDB();
    const store = this._getStore('readonly');
    return new Promise((resolve, reject) => {
      const request = store.count(key);
      request.onsuccess = () => resolve(request.result > 0);
      request.onerror = () => reject(request.error);
    });
  }

  /** Delete a chunk from storage. */
  async deleteChunk(key) {
    await this._openDB();
    const store = this._getStore('readwrite');
    return new Promise((resolve, reject) => {
      store.delete(key).onsuccess = () => resolve();
      store.delete(key).onerror = () => reject(store.transaction.error);
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

    if (!manifest.generatedChunks) manifest.generatedChunks = [];

    // Normalize legacy entries (plain strings → objects with checksum)
    const normalized = manifest.generatedChunks.map(entry => {
      if (typeof entry === 'string') return { key: entry, checksum: null };
      return entry;
    });

    const existingIdx = normalized.findIndex(e => e.key === key);
    if (existingIdx >= 0) {
      normalized[existingIdx] = { key, checksum };
    } else {
      normalized.push({ key, checksum });
    }

    manifest.generatedChunks = normalized;
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
      console.log(`[ChunkManager] _processGenQueue: batch ${batchSize} of remaining ${this._genQueue.length}`);
      
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

  /** Flush all dirty chunks to IndexedDB with writeback verification. */
  async flushDirty() {
    if (this._disposed || this._flushQueue.size === 0 || this._flushing) return;
    this._flushing = true;

    const keysToFlush = [...this._flushQueue];
    this._flushQueue.clear();

    for (const key of keysToFlush) {
      const chunk = this.memoryCache.get(key);
      if (!chunk || !chunk.dirty) continue;

      try {
        // Encode full in-memory blocks array to binary
        const binaryData = ChunkBinaryCodec.encode(chunk);
        const expectedChecksum = ChunkBinaryCodec.computeChecksum(binaryData);

        // Save to IndexedDB
        await this.saveChunk(key, binaryData);

        // Immediate readback + checksum verification
        const readBack = await this.loadChunk(key);
        if (!readBack) {
          // Readback failed — keep dirty for retry next cycle
          continue;
        }

        if (ChunkBinaryCodec.computeChecksum(readBack) !== expectedChecksum) {
          console.warn(`[ChunkManager] Flush verify failed for ${key} — will retry`);
          this._flushQueue.add(key); // Re-queue for retry
          continue;
        }

        // Success: writeback verified → add/update manifest with checksum
        await this.addVerifiedChunk(key, expectedChecksum);
        chunk.dirty = false;  // Clear dirty AFTER successful flush+verify
        this.stats.chunksFlushed++;

      } catch (err) {
        console.warn(`[ChunkManager] Flush error for ${key}:`, err.message);
        // Re-queue for retry on next cycle
        const stillDirty = this.memoryCache.get(key);
        if (stillDirty && stillDirty.dirty) this._flushQueue.add(key);
      }
    }

    this._flushing = false;
  }

  /** Graceful shutdown: flush dirty chunks before tab close. */
  _setupGracefulShutdown() {
    const self = this;

    window.addEventListener('beforeunload', () => {
      if (self._flushQueue.size === 0) return;
      // Synchronous IndexedDB writes during beforeunload
      try {
        const db = self._db;
        if (!db) return;
        const tx = db.transaction([STORE_CHUNKS], 'readwrite');
        const store = tx.objectStore(STORE_CHUNKS);
        for (const key of self._flushQueue) {
          const chunk = self.memoryCache.get(key);
          if (!chunk || !chunk.dirty) continue;
          try {
            const data = ChunkBinaryCodec.encode(chunk);
            store.put({ chunkKey: key, worldName: self.worldName, data, savedAt: Date.now() });
          } catch (_) {}
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

    const pcx = Math.floor(playerX / CHUNK_W);
    const pcz = Math.floor(playerZ / CHUNK_D);
    const radius = this.regionRadius;

    console.log('[ChunkManager] checkRegion:', pcx, pcz, 'radius:', radius);

    // Track which chunks should be in memory
    const shouldBeLoaded = new Set();
    const pendingPromises = [];

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const cx = pcx + dx;
        const cz = pcz + dz;
        const key = ChunkManager.key(cx, cz);

        shouldBeLoaded.add(key);

        // Already in memory? Skip.
        if (this.memoryCache.has(key)) continue;

        pendingPromises.push(this._ensureChunkInMemory(cx, cz).catch(e => {
          console.warn('[ChunkManager] Region load failed for', key, ':', e.message);
        }));
      }
    }

    // Wait for all async loads/generations to start (they may still be in-flight)
    await Promise.all(pendingPromises);
    console.log(`[ChunkManager] checkRegion done — memoryCache: ${this.memoryCache.size}, queue: ${this._genQueue.length}`);

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

  /** Ensure a single chunk is loaded into memory cache. */
  async _ensureChunkInMemory(cx, cz) {
    if (this._disposed) return;
    const key = ChunkManager.key(cx, cz);
    if (this.memoryCache.has(key)) return;

    try {
      // Check manifest: does this chunk exist in persistent storage?
      const existsInManifest = await this.isChunkGenerated(key);

      if (!existsInManifest) {
        // Queue for worker generation → returns raw blocks → creates Chunk → marks dirty
        this._queueGeneration(cx, cz);
        return;
      }

      // Load from IndexedDB into memory cache
      const binaryData = await this.loadChunk(key);
      if (!binaryData) {
        // Manifest says it exists but data is missing — clean up stale entry
        try { await this.removeChunk(key); } catch (_) {}
        // Re-generate instead
        this._queueGeneration(cx, cz);
        return;
      }

      const chunk = ChunkBinaryCodec.decode(binaryData);
      // Chunks loaded from disk are by definition clean (persisted) — never carry dirty flag over reloads
      chunk.dirty = false;
      this.memoryCache.set(key, chunk);
      this.stats.chunksLoadedFromDisk++;

    } catch (e) {
      console.warn('[ChunkManager] Load failed for', key, ':', e.message);
      // Decode failed (corruption?) → remove and regenerate
      try { await this.removeChunk(key); } catch (_) {}
      this._queueGeneration(cx, cz);
    }
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

    const radius = this._voxelRegionRadius;
    const unloadRadius = radius + 2;

    // Build set of keys that should be in memory for the voxel region
    const shouldBeLoaded = new Set();
    const pendingPromises = [];

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const cx = pcx + dx;
        const cz = pcz + dz;
        const key = ChunkManager.key(cx, cz);

        shouldBeLoaded.add(key);

        // Already in memory? Skip.
        if (this.memoryCache.has(key)) continue;

        pendingPromises.push(this._ensureChunkInMemory(cx, cz).catch(e => {
          console.warn('[ChunkManager] Voxel load failed for', key, ':', e.message);
        }));
      }
    }

    // Log when new chunks are being queued
    if (pendingPromises.length > 0) {
      console.log(`[Cuubz] _updateVoxelRegion: queuing ${pendingPromises.length} new voxels around (${pcx},${pcz}) — memoryCache: ${this.memoryCache.size}, radius: ${radius}`);
    }

    // Fire off async loads/generations without blocking the frame loop
    Promise.all(pendingPromises).then(() => {
      if (!this._disposed && pendingPromises.length > 0) {
        console.log(`[ChunkManager] Voxel region updated — memoryCache: ${this.memoryCache.size}`);
      }
    });

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
      console.log(`[Cuubz] _updateVoxelRegion: unloaded ${unloaded} distant chunks`);
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

    // Gather neighbor block arrays for face culling at boundaries
    const neighbors = {
      positiveX: this.memoryCache.get(ChunkManager.key(cx + 1, cz))?.blocks ?? null,
      negativeX: this.memoryCache.get(ChunkManager.key(cx - 1, cz))?.blocks ?? null,
      positiveZ: this.memoryCache.get(ChunkManager.key(cx, cz + 1))?.blocks ?? null,
      negativeZ: this.memoryCache.get(ChunkManager.key(cx, cz - 1))?.blocks ?? null,
    };

    if (this.meshWorkerPool) {
      // Dispatch to mesh worker pool
      const promise = this._dispatchMeshBuild(cx, cz, chunk.blocks, neighbors);
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
        const geoResult = this._buildMeshInline(cx, cz, chunk.blocks, neighbors);
        this._onMeshBuilt(key, cx, cz, geoResult);
      } catch (e) {
        console.warn('[ChunkManager] Inline mesh build error for', key, ':', e.message);
        this._rebuilding.delete(key);
      }
    }
  }

  /** Dispatch mesh build to worker. Returns Promise<geometry>. */
  _dispatchMeshBuild(cx, cz, blocks, neighbors) {
    return new Promise((resolve, reject) => {
      // Build UV lookup table from texture atlas for this chunk's block types
      let uvLookup = null;  // Use 'let' since we reassign below if atlas is loaded
      if (this.textureAtlas && this.textureAtlas.loaded) {
        // Flat array: index = blockType, value = [topU, topV, botU, botV, sideU, sideV, size]
        // This avoids nested object cloning issues with postMessage
        uvLookup = new Array(256);
        for (let bid = 0; bid < 256; bid++) {
          try {
            const topF = this.textureAtlas.getFaceUV(bid, 'top');
            const botF = this.textureAtlas.getFaceUV(bid, 'bottom');
            const sideF = this.textureAtlas.getFaceUV(bid, 'front');
            uvLookup[bid] = [
              topF.u || 0, topF.v || 0,
              botF.u || 0, botF.v || 0,
              sideF.u || 0, sideF.v || 0,
              (topF.size || botF.size || sideF.size) || (1.0 / 6)
            ];
          } catch(e) {
            uvLookup[bid] = [0, 0, 0, 0, 0, 0, 1.0/6];
          }
        }
      }

      // Find an idle worker from the pool
      const workers = this.meshWorkerPool.workers;
      const idleWorkers = this.meshWorkerPool.idleWorkers;

      let w = idleWorkers.pop();
      if (!w) {
        setTimeout(() => {
          this._dispatchMeshBuild(cx, cz, blocks, neighbors).then(resolve).catch(reject);
        }, 0);
        return;
      }

      const handler = (e) => {
        w.removeEventListener('message', handler);
        w.removeEventListener('error', errorHandler);
        clearTimeout(timeoutId);
        idleWorkers.push(w);
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
        idleWorkers.push(w);
        reject(new Error('Mesh worker error: ' + e.message));
      };

      const timeoutId = setTimeout(() => {
        w.removeEventListener('message', handler);
        w.removeEventListener('error', errorHandler);
        idleWorkers.push(w);
        reject(new Error(`Mesh build timeout for chunk [${cx},${cz}]`));
      }, 5000);

      w.addEventListener('message', handler);
      w.addEventListener('error', errorHandler);

      // Transfer blocks buffer, send neighbor references by copy (they're shared)
      const blocksBuffer = new Uint8Array(blocks); // Copy to avoid transfer issues
      w.postMessage({
        type: 'build',
        cx, cz,
        blocks: blocksBuffer.buffer,
        neighbors: {
          positiveX: neighbors.positiveX ? Array.from(neighbors.positiveX) : null,
          negativeX: neighbors.negativeX ? Array.from(neighbors.negativeX) : null,
          positiveZ: neighbors.positiveZ ? Array.from(neighbors.positiveZ) : null,
          negativeZ: neighbors.negativeZ ? Array.from(neighbors.negativeZ) : null,
        },
        uvLookup: uvLookup // Texture atlas UV lookup table
      }, [blocksBuffer.buffer]);
    });
  }

  /** Inline mesh build fallback (main thread). */
  _buildMeshInline(cx, cz, blocks, neighbors) {
    // Create a temporary chunk-like object for the mesh builder
    const tempChunk = new Chunk(cx, cz);
    tempChunk.blocks.set(blocks);

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

    let solidMesh = null;
    let cutoutMesh = null;
    let transMesh = null;

    // Handle both worker buffer results and inline geometry results
    if (geoResult.solid) {
      const geo = this._wrapBuffers(geoResult.solid);
      if (geo && geo.index && geo.index.count > 0) {
        const material = new THREE.MeshLambertMaterial({ map: texMap, color: 0xffffff, fog: true });
        solidMesh = new THREE.Mesh(geo, material);
        solidMesh.position.set(cx * CHUNK_W, 0, cz * CHUNK_D);
      }
    } else if (geoResult.solidGeometry) {
      // Inline fallback returns BufferGeometry directly
      const material = new THREE.MeshLambertMaterial({ map: texMap, color: 0xffffff, fog: true });
      solidMesh = new THREE.Mesh(geoResult.solidGeometry, material);
      solidMesh.position.set(cx * CHUNK_W, 0, cz * CHUNK_D);
    }

    if (geoResult.cutout) {
      const geo = this._wrapBuffers(geoResult.cutout);
      if (geo && geo.index && geo.index.count > 0) {
        const material = new THREE.MeshLambertMaterial({
          map: texMap, color: 0xffffff, transparent: true, alphaToCoverage: true,
          depthWrite: true, fog: true, side: THREE.DoubleSide
        });
        cutoutMesh = new THREE.Mesh(geo, material);
        cutoutMesh.position.set(cx * CHUNK_W, 0, cz * CHUNK_D);
      }
    } else if (geoResult.cutoutGeometry) {
      const material = new THREE.MeshLambertMaterial({
        map: texMap, color: 0xffffff, transparent: true, alphaToCoverage: true,
        depthWrite: true, fog: true, side: THREE.DoubleSide
      });
      cutoutMesh = new THREE.Mesh(geoResult.cutoutGeometry, material);
      cutoutMesh.position.set(cx * CHUNK_W, 0, cz * CHUNK_D);
    }

    if (geoResult.trans) {
      const geo = this._wrapBuffers(geoResult.trans);
      if (geo && geo.index && geo.index.count > 0) {
        const material = new THREE.MeshLambertMaterial({
          map: texMap, color: 0xffffff, transparent: true, opacity: 0.6,
          depthWrite: false, fog: true, side: THREE.DoubleSide
        });
        transMesh = new THREE.Mesh(geo, material);
        transMesh.position.set(cx * CHUNK_W, 0, cz * CHUNK_D);
      }
    } else if (geoResult.transparentGeometry) {
      const material = new THREE.MeshLambertMaterial({
        map: texMap, color: 0xffffff, transparent: true, opacity: 0.6,
        depthWrite: false, fog: true, side: THREE.DoubleSide
      });
      transMesh = new THREE.Mesh(geoResult.transparentGeometry, material);
      transMesh.position.set(cx * CHUNK_W, 0, cz * CHUNK_D);
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
    if (data.idx && data.idx.byteLength > 0) {
      const idx = new Uint16Array(data.idx);
      if (idx.length > 0) geo.setIndex(new THREE.BufferAttribute(idx, 1));
    }
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

    console.log(`[ChunkManager] Loaded existing world: ${this.worldName} (${manifest.generatedChunks.length} chunks saved)`);
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
