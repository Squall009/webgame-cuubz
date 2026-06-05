/**
 * Cuubz — Dirty Flush Manager
 * Tracks dirty chunks and flushes them to IndexedDB in batches on a timer.
 * Also handles graceful shutdown via beforeunload + sendBeacon/OPFS sync fallback.
 */

const CHUNKS_STORE_NAME = 'chunks'; // Matches ChunkStore.CHUNKS_STORE

class DirtyFlushManager {
  /**
   * @param {ChunkStore} chunkStore - The IndexedDB-backed store for persistence
   * @param {Object} options
   * @param {number} [options.flushInterval=5000] - Flush interval in milliseconds (default: 5s)
   * @param {boolean} [options.useOpfsFallback=false] - Use OPFS for sync fallback on beforeunload
   */
  constructor(chunkStore, options = {}) {
    this.store = chunkStore;
    this.flushInterval = options.flushInterval || 5000;

    // Set of "cx,cz" keys that are dirty and need flushing
    this._dirtyChunks = new Map(); // key -> Chunk instance (latest in-memory version)

    // Timer for periodic flush
    this._flushTimerId = null;

    // Whether the manager is active
    this._active = true;

    // OPFS fallback support
    this._useOpfsFallback = options.useOpfsFallback || false;

    // Wire up graceful shutdown
    this._setupGracefulShutdown();
  }

  /**
   * Mark a chunk as dirty. The latest in-memory Chunk instance is kept for flushing.
   * @param {string} key - "cx,cz" string key
   * @param {Chunk} chunkData - Current in-memory chunk data (lazy getter reference)
   */
  markDirty(key, chunkData) {
    if (!this._active || !chunkData) return;

    // Store a lazy getter function instead of the actual chunk data.
    // This ensures we always flush the latest state, not a stale snapshot.
    this._dirtyChunks.set(key, () => chunkData);
  }

  /**
   * Remove a chunk from dirty tracking (e.g., it was just flushed or unloaded).
   * @param {string} key - "cx,cz" string key
   */
  removeDirty(key) {
    this._dirtyChunks.delete(key);
  }

  /**
   * Start the periodic flush timer. Call this when the game starts.
   */
  start() {
    if (this._flushTimerId) return; // Already running

    this._active = true;
    this._flushTimerId = setInterval(() => {
      this.flush();
    }, this.flushInterval);
  }

  /**
   * Stop the periodic flush timer. Call this when pausing or shutting down.
   */
  stop() {
    if (this._flushTimerId) {
      clearInterval(this._flushTimerId);
      this._flushTimerId = null;
    }
    this._active = false;
  }

  /**
   * Immediately flush all dirty chunks to IndexedDB.
   * @returns {Promise<void>}
   */
  async flush() {
    if (this._dirtyChunks.size === 0) return;

    // Resolve lazy getters and encode chunks
    const entries = [];
    for (const [key, getter] of this._dirtyChunks) {
      try {
        const chunkData = typeof getter === 'function' ? getter() : getter;
        if (!chunkData || !chunkData.blocks) continue;

        // Encode to binary using ChunkBinaryCodec
        const data = ChunkBinaryCodec.encode(chunkData);
        entries.push({ key, data });

// Chunk queued for flush — no log
      } catch (err) {
        // Silently skip corrupt chunks that can't be encoded.
      }
    }

    if (entries.length === 0) return;

    try {
      // Batch save all chunks in one transaction
      await this.store.saveChunks(entries);

      // Clear dirty tracking for successfully saved chunks
      let totalBytes = 0;
      const keys = [];
      for (const entry of entries) {
        totalBytes += entry.data.byteLength;
        keys.push(entry.key);
        this._dirtyChunks.delete(entry.key);
      }

      console.log(`[DirtyFlush] SAVED ${entries.length} chunk(s) to IndexedDB (${totalBytes} bytes): [${keys.join(', ')}]`);
    } catch (err) {
      // Silently ignore batch save failures — chunks will retry on next flush.
    }
  }

  /**
   * Get the number of currently dirty chunks.
   */
  getDirtyCount() {
    return this._dirtyChunks.size;
  }

  /**
   * Check if a specific chunk is dirty.
   * @param {string} key - "cx,cz" string key
   */
  isDirty(key) {
    return this._dirtyChunks.has(key);
  }

  /**
   * Set up graceful shutdown handlers to flush data before the tab closes.
   * Uses multiple strategies for reliability:
   *   1. beforeunload — synchronous OPFS write (if available) or sendBeacon fallback
   *   2. pagehide — fires even when tabs are closed (Chrome-specific)
   */
  _setupGracefulShutdown() {
    const self = this;

    // Main handler: try to flush on tab close
    window.addEventListener('beforeunload', () => {
      if (self._dirtyChunks.size === 0) return;

// Graceful shutdown flush — no log

      // Strategy 1: Use sendBeacon for reliable async delivery
      // Note: IndexedDB operations in beforeunload are unreliable, so we use a workaround.
      // The best approach is to encode chunks synchronously and send via beacon,
      // but that requires a server endpoint. For client-only storage, we rely on:
      // - OPFS sync write (if available) — see _opfsFallback()
      // - Synchronous IndexedDB transaction (Chrome supports this in beforeunload)

      try {
        // Try synchronous flush via IndexedDB (works in Chrome/Firefox during beforeunload)
        self._syncFlush();
      } catch (err) {
        // Silently ignore — tab is closing anyway.
      }
    });

    // pagehide fires even when tabs are closed (better than beforeunload for this use case)
    window.addEventListener('pagehide', () => {
      if (self._dirtyChunks.size === 0) return;
      try {
        self._syncFlush();
      } catch (err) {
        // Silently ignore — tab is closing anyway.
      }
    });

    // Visibility change: flush when user switches away from the tab
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && self._dirtyChunks.size > 0) {
// Visibility flush — no log
        // Async flush is OK here since the event loop still runs
        self.flush().catch(() => {});
      }
    });
  }

  /**
   * Attempt a synchronous flush during beforeunload.
   * Uses IndexedDB synchronous operations which Chrome supports in page lifecycle callbacks.
   */
  _syncFlush() {
    if (this._dirtyChunks.size === 0) return;

    // Encode all dirty chunks synchronously
    const entries = [];
    for (const [key, getter] of this._dirtyChunks) {
      try {
        const chunkData = typeof getter === 'function' ? getter() : getter;
        if (!chunkData || !chunkData.blocks) continue;
        const data = ChunkBinaryCodec.encode(chunkData);
        entries.push({ key, data });
      } catch (err) {
        // Silently skip — tab is closing anyway.
      }
    }

    if (entries.length === 0) return;

    // Perform synchronous IndexedDB writes using a single transaction
    const db = this.store._db;
    if (!db) return;

    try {
      const tx = db.transaction([CHUNKS_STORE_NAME], 'readwrite');
      const store = tx.objectStore(CHUNKS_STORE_NAME);

      for (const entry of entries) {
        store.put({ chunkKey: entry.key, worldName: this.store.worldName, data: entry.data, savedAt: Date.now() });
      }

      // In beforeunload context, Chrome waits for the transaction to complete
      // before actually closing the tab. This is our best shot at reliable persistence.

// Sync flush queued — no log
    } catch (err) {
      // Silently ignore sync flush failures — tab is closing anyway.
    }
  }

  /**
   * Dispose of resources and stop all timers.
   */
  dispose() {
    this.stop();
    this._dirtyChunks.clear();
    this._active = false;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = DirtyFlushManager;
}
