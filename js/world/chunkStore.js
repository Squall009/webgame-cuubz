/**
 * Cuubz — IndexedDB Chunk Store
 * Async binary-safe persistence layer for chunk data using IndexedDB.
 *
 * Database: "cuubz-worlds" v1
 *   ObjectStore "chunks": keyPath = "chunkKey" (e.g. "0,3")
 *     - chunkKey: string  "${cx},${cz}"
 *     - data: ArrayBuffer (binary encoded via ChunkBinaryCodec)
 *   ObjectStore "manifests": keyPath = "worldName"
 *     - worldName: string
 *     - seed: string
 *     - createdAt: number (timestamp)
 *     - lastPlayed: number (timestamp)
 *     - playerCount: number
 *     - spawnPoint: {x, y, z}
 *     - generatedChunks: string[]  // keys that exist in storage
 */

const DB_NAME = 'cuubz-worlds';
const DB_VERSION = 1;
const CHUNKS_STORE = 'chunks';
const MANIFESTS_STORE = 'manifests';

class ChunkStore {
  /**
   * Create a new ChunkStore instance.
   * @param {string} worldName - World name used as namespace for chunk keys
   */
  constructor(worldName) {
    this.worldName = worldName;
    this._db = null;
    this._ready = null; // Promise that resolves when DB is ready
  }

  /**
   * Open (or create) the IndexedDB database. Returns a promise resolving to the DB instance.
   */
  _open() {
    if (this._ready) return this._ready;

    this._ready = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Chunks store: keyed by "chunkKey" string
        if (!db.objectStoreNames.contains(CHUNKS_STORE)) {
          const chunkStore = db.createObjectStore(CHUNKS_STORE, { keyPath: 'chunkKey' });
          chunkStore.createIndex('worldName', 'worldName', { unique: false });
        }

        // Manifests store: keyed by world name
        if (!db.objectStoreNames.contains(MANIFESTS_STORE)) {
          db.createObjectStore(MANIFESTS_STORE, { keyPath: 'worldName' });
        }
      };

      request.onsuccess = (event) => {
        this._db = event.target.result;
        resolve(this._db);
      };

      request.onerror = (event) => {
        reject(new Error(`IndexedDB open failed: ${event.target.error}`));
      };
    });

    return this._ready;
  }

  /**
   * Get a reference to the chunks object store in read-write mode.
   */
  _getChunkStore(mode = 'readonly') {
    const db = this._db;
    if (!db) throw new Error('ChunkStore not initialized — call save/load will fail before DB is open');
    return db.transaction([CHUNKS_STORE], mode).objectStore(CHUNKS_STORE);
  }

  /**
   * Get a reference to the manifests object store.
   */
  _getManifestStore(mode = 'readonly') {
    const db = this._db;
    if (!db) throw new Error('ChunkStore not initialized');
    return db.transaction([MANIFESTS_STORE], mode).objectStore(MANIFESTS_STORE);
  }

  // ============================================================
  // Chunk Operations
  // ============================================================

  /**
   * Save a binary-encoded chunk to IndexedDB.
   * @param {string} chunkKey - "cx,cz" string key
   * @param {ArrayBuffer} data - Binary chunk data from ChunkBinaryCodec.encode()
   * @returns {Promise<void>}
   */
  async saveChunk(chunkKey, data) {
    await this._open();
    const store = this._getChunkStore('readwrite');

    // Use put to upsert (insert or update)
    store.put({ chunkKey, worldName: this.worldName, data, savedAt: Date.now() });

    return new Promise((resolve, reject) => {
      const tx = store.transaction;
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Load a chunk from IndexedDB.
   * @param {string} chunkKey - "cx,cz" string key
   * @returns {Promise<ArrayBuffer|null>} Binary data or null if not found
   */
  async loadChunk(chunkKey) {
    await this._open();
    const store = this._getChunkStore('readonly');

    return new Promise((resolve, reject) => {
      const request = store.get(chunkKey);
      request.onsuccess = () => {
        if (request.result) {
          resolve(request.result.data);
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Check if a chunk exists in storage.
   * @param {string} chunkKey - "cx,cz" string key
   * @returns {Promise<boolean>}
   */
  async hasChunk(chunkKey) {
    await this._open();
    const store = this._getChunkStore('readonly');

    return new Promise((resolve, reject) => {
      const request = store.count(chunkKey);
      request.onsuccess = () => resolve(request.result > 0);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Delete a chunk from storage.
   * @param {string} chunkKey - "cx,cz" string key
   * @returns {Promise<void>}
   */
  async deleteChunk(chunkKey) {
    await this._open();
    const store = this._getChunkStore('readwrite');

    return new Promise((resolve, reject) => {
      const request = store.delete(chunkKey);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Load multiple chunks in a single batch (more efficient than individual loads).
   * @param {string[]} chunkKeys - Array of "cx,cz" keys to load
   * @returns {Promise<Map<string, ArrayBuffer>>} Map of key → data for found chunks
   */
  async loadChunks(chunkKeys) {
    await this._open();
    const store = this._getChunkStore('readonly');

    const results = new Map();

    // Batch all requests in a single transaction
    return new Promise((resolve, reject) => {
      let pending = chunkKeys.length;
      if (pending === 0) return resolve(results);

      const tx = store.transaction;
      tx.onerror = () => reject(tx.error);

      for (const key of chunkKeys) {
        const request = store.get(key);
        request.onsuccess = () => {
          if (request.result) {
            results.set(key, request.result.data);
          }
          if (--pending === 0) resolve(results);
        };
      }
    });
  }

  /**
   * Save multiple chunks in a single batch transaction.
   * @param {{key: string, data: ArrayBuffer}[]} entries - Array of {key, data} pairs
   * @returns {Promise<void>}
   */
  async saveChunks(entries) {
    await this._open();
    const store = this._getChunkStore('readwrite');

    for (const entry of entries) {
      store.put({ chunkKey: entry.key, worldName: this.worldName, data: entry.data, savedAt: Date.now() });
    }

    return new Promise((resolve, reject) => {
      const tx = store.transaction;
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ============================================================
  // Manifest Operations
  // ============================================================

  /**
   * Save or update the world manifest.
   * @param {Object} manifest - World manifest object
   * @returns {Promise<void>}
   */
  async saveManifest(manifest) {
    await this._open();
    const store = this._getManifestStore('readwrite');

    // Ensure required fields
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
   * Load the world manifest.
   * @returns {Promise<Object|null>} Manifest object or null if not found
   */
  async loadManifest() {
    await this._open();
    const store = this._getManifestStore('readonly');

    return new Promise((resolve, reject) => {
      const request = store.get(this.worldName);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Add a chunk key to the manifest's generatedChunks list and save.
   * @param {string} chunkKey - "cx,cz" string key
   * @returns {Promise<void>}
   */
  async addGeneratedChunk(chunkKey) {
    await this._open();

    let manifest = await this.loadManifest();
    if (!manifest) {
      manifest = {
        worldName: this.worldName,
        seed: '',
        createdAt: Date.now(),
        lastPlayed: Date.now(),
        playerCount: 1,
        spawnPoint: { x: 0, y: 64, z: 0 },
        generatedChunks: []
      };
    }

    if (!manifest.generatedChunks) manifest.generatedChunks = [];
    if (!manifest.generatedChunks.includes(chunkKey)) {
      manifest.generatedChunks.push(chunkKey);
    }
    manifest.lastPlayed = Date.now();

    await this.saveManifest(manifest);
  }

  /**
   * Check if a chunk is in the manifest's generatedChunks list.
   * @param {string} chunkKey - "cx,cz" string key
   * @returns {Promise<boolean>}
   */
  async isChunkGenerated(chunkKey) {
    const manifest = await this.loadManifest();
    return !!(manifest && manifest.generatedChunks && manifest.generatedChunks.includes(chunkKey));
  }

  /**
   * Get the list of all generated chunk keys from the manifest.
   * @returns {Promise<string[]>} Array of "cx,cz" keys
   */
  async getGeneratedChunks() {
    const manifest = await this.loadManifest();
    return manifest ? (manifest.generatedChunks || []) : [];
  }

  /**
   * Remove a chunk key from the manifest's generatedChunks list and delete from storage.
   * Use this when undoing generation or pruning stale chunks.
   * @param {string} chunkKey - "cx,cz" string key
   * @returns {Promise<void>}
   */
  async removeGeneratedChunk(chunkKey) {
    await this._open();

    // Delete from IndexedDB storage
    try {
      await this.deleteChunk(chunkKey);
    } catch (err) {
      // Silently ignore — manifest cleanup will still proceed.
    }

    // Remove from manifest.generatedChunks list
    let manifest = await this.loadManifest();
    if (!manifest || !manifest.generatedChunks) return;

    const idx = manifest.generatedChunks.indexOf(chunkKey);
    if (idx !== -1) {
      manifest.generatedChunks.splice(idx, 1);
      manifest.lastPlayed = Date.now();
      await this.saveManifest(manifest);
    }
  }

  /**
   * Delete the entire world (all chunks + manifest).
   * @returns {Promise<void>}
   */
  async deleteWorld() {
    await this._open();
    const store = this._getChunkStore('readwrite');

    return new Promise((resolve, reject) => {
      // Delete all chunks for this world using the index
      const index = store.index('worldName');
      const request = index.openCursor(IDBKeyRange.only(this.worldName));

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          // All chunks deleted, now delete manifest
          this._getManifestStore('readwrite').delete(this.worldName);
          resolve();
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Close the database connection.
   */
  close() {
    if (this._db) {
      this._db.close();
      this._db = null;
      this._ready = null;
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ChunkStore;
}
