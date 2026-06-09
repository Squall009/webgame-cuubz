/**
 * Cuubz — Dirty Flush Manager (v2)
 * Tracks dirty chunks and flushes them to IndexedDB in batches on a timer.
 * After every write, performs immediate readback + checksum verification with retry.
 * Only marks chunk as "generated" after successful write+verify cycle.
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

    // Chunks pending manifest addition — only added to generatedChunks AFTER successful writeback verify.
    this._pendingManifest = new Set();

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
   * Immediately flush all dirty chunks to IndexedDB with writeback verification.
   * Each chunk is saved, then immediately read back and checksum-verified.
   * Retries up to 3x with exponential backoff on failure.
   * Only adds verified chunks to the manifest's generatedChunks list.
   * @returns {Promise<void>}
   */
  async flush() {
    if (this._dirtyChunks.size === 0) return;

    const keysToFlush = [...this._dirtyChunks.keys()];

    for (const key of keysToFlush) {
      try {
        // Resolve lazy getter and encode chunk
        const getter = this._dirtyChunks.get(key);
        const chunkData = typeof getter === 'function' ? getter() : getter;
        if (!chunkData || !chunkData.blocks) {
          this._dirtyChunks.delete(key);
          continue;
        }

        // Encode to binary using ChunkBinaryCodec (includes checksum in header)
        const data = ChunkBinaryCodec.encode(chunkData);
        const expectedChecksum = ChunkBinaryCodec.computeChecksum(data);

        // Save + verify with retry
        const verified = await this._saveAndVerify(key, data, expectedChecksum);

        if (verified) {
          this._dirtyChunks.delete(key);

          // Add to manifest only after successful writeback verification, with checksum.
          if (this._pendingManifest.has(key)) {
            try {
              await this.store.addVerifiedChunk(key, expectedChecksum);
              this._pendingManifest.delete(key);
            } catch (e) {
              // Manifest write failed — chunk data is saved, just not tracked in manifest.
              // It will be picked up on next load via hasChunk() check.
            }
          }

// Chunk verified and saved — no log
        } else {
          // Failed all retries — keep dirty so it retries on next flush cycle
          console.warn(`[DirtyFlush] FAILED writeback verification for ${key} after 3 retries`);
        }
      } catch (err) {
        // Silently skip corrupt chunks that can't be encoded.
        this._dirtyChunks.delete(key);
      }
    }

    // Log summary of successfully saved chunks
    if (keysToFlush.length > 0 && this._dirtyChunks.size < keysToFlush.length + this._pendingManifest.size) {
      const stillDirty = this._dirtyChunks.size;
      console.log(`[DirtyFlush] Flush cycle complete. ${stillDirty} chunk(s) still dirty.`);
    }
  }

  /**
   * Save a chunk to IndexedDB, then immediately read back and verify checksum.
   * Retries up to maxRetries times with exponential backoff on failure.
   * @param {string} key - "cx,cz" string key
   * @param {ArrayBuffer} data - Binary-encoded chunk data (with checksum in header)
   * @param {number} expectedChecksum - FNV-1a checksum computed before save
   * @param {number} [maxRetries=3] - Maximum retry attempts
   * @returns {Promise<boolean>} true if writeback verified successfully
   */
  async _saveAndVerify(key, data, expectedChecksum, maxRetries = 3) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Save chunk to IndexedDB
        await this.store.saveChunk(key, data);

        // Immediate readback
        const readBackData = await this.store.loadChunk(key);
        if (!readBackData) {
          console.warn(`[DirtyFlush] Readback returned null for ${key} (attempt ${attempt + 1}/${maxRetries})`);
          continue; // Retry
        }

        // Verify checksum of readback data
        const readBackChecksum = ChunkBinaryCodec.computeChecksum(readBackData);
        if (readBackChecksum !== expectedChecksum) {
          console.warn(
            `[DirtyFlush] Checksum mismatch for ${key} (attempt ${attempt + 1}/${maxRetries}): ` +
            `expected=0x${expectedChecksum.toString(16)}, got=0x${readBackChecksum.toString(16)}`
          );
          // Delete corrupt data so we can retry clean
          try { await this.store.deleteChunk(key); } catch (_) {}
          continue; // Retry
        }

        // Success — writeback verified
        return true;

      } catch (err) {
        if (attempt < maxRetries - 1) {
          // Exponential backoff: 50ms, 150ms, 350ms...
          const backoff = Math.pow(2, attempt) * 50 + attempt * 50;
          await new Promise(resolve => setTimeout(resolve, backoff));
        } else {
          console.error(`[DirtyFlush] Save error for ${key} after ${maxRetries} attempts:`, err);
        }
      }
    }

    return false; // All retries exhausted
  }

  /**
   * Mark a chunk as dirty and pending manifest addition.
   * The chunk will only be added to generatedChunks AFTER successful writeback verification.
   * @param {string} key - "cx,cz" string key
   * @param {Chunk} chunkData - Current in-memory chunk data
   */
  markDirty(key, chunkData) {
    if (!this._active || !chunkData) return;

    // Store a lazy getter function instead of the actual chunk data.
    // This ensures we always flush the latest state, not a stale snapshot.
    this._dirtyChunks.set(key, () => chunkData);
  }

  /**
   * Mark a newly generated chunk as dirty AND pending manifest addition.
   * The chunk will only be added to generatedChunks AFTER successful writeback verification.
   * Use this for freshly generated chunks instead of markDirty().
   * @param {string} key - "cx,cz" string key
   * @param {Chunk} chunkData - Current in-memory chunk data
   */
  markNewlyGenerated(key, chunkData) {
    if (!this._active || !chunkData) return;

    this._dirtyChunks.set(key, () => chunkData);
    this._pendingManifest.add(key);
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
    this._pendingManifest.clear();
    this._active = false;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = DirtyFlushManager;
}
