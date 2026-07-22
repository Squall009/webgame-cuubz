/**
 * Cuubz — Chunk Streaming System
 * 
 * Manages chunk loading/unloading based on ALL player positions in a multiplayer session.
 * The host tracks all connected players, determines which chunks need to be loaded,
 * and streams compressed chunk data to clients who need it.
 *
 * Architecture:
 *   Host (this module) → Relay Server → Remote Clients
 *   Each client receives chunks near its position only.
 *
 * Key invariants:
 * - Chunks load around ALL player positions, not just the host
 * - A chunk stays loaded as long as ANY player is within load radius
 * - Unloading only happens when NO players are within unload radius
 * - Dirty chunks (with block changes) are always re-streamed on demand
 *
 * Testable in Node.js (no browser dependencies).
 */

'use strict';

// Use globals from chunkData.js: CHUNK_WIDTH, CHUNK_DEPTH

// ─── Constants ──────────────────────────────────────────────

const DEFAULT_STREAM_CONFIG = {
  loadRadius: 6,        // Load chunks within this radius (in chunks)
  unloadRadius: 8,      // Unload chunks beyond this radius
  streamInterval: 500,  // How often to check streaming needs (ms)
  maxChunksPerTick: 32, // Max chunks to stream per update cycle
  compressData: true,   // Whether to compress chunk data for transmission
  loadingTimeout: 8000  // Max ms a chunk can stay in LOADING before forced to LOADED (even without data)
};

// Chunk states
const CHUNK_STATE = {
  UNLOADED: 'unloaded',
  LOADING: 'loading',
  LOADED: 'loaded',
  STREAMING: 'streaming',
  DIRTY: 'dirty',       // Has block changes since last stream
};

// ─── Chunk Data Compression ────────────────────────────────

/**
 * Simple run-length encoding for chunk data arrays.
 * Reduces transmission size for chunks with large areas of the same block type (air).
 */
class ChunkCompressor {
  /**
   * Compress a flat array of block types using RLE.
   * @param {Uint8Array|number[]} data - Raw block data
   * @returns {object} Compressed data with metadata
   */
  static compress(data) {
    if (!data || data.length === 0) {
      return { method: 'none', data: [], originalLength: 0 };
    }

    const input = Array.isArray(data) ? data : Array.from(data);
    const runs = [];
    let current = input[0];
    let count = 1;

    for (let i = 1; i < input.length; i++) {
      if (input[i] === current && count < 255) {
        count++;
      } else {
        runs.push(current);
        runs.push(count);
        current = input[i];
        count = 1;
      }
    }
    runs.push(current);
    runs.push(count);

    return {
      method: 'rle',
      data: new Uint8Array(runs),
      originalLength: input.length,
    };
  }

  /**
   * Decompress RLE-encoded chunk data.
   * @param {object} compressed - Output from compress()
   * @returns {number[]} Decompressed block data array
   */
  static decompress(compressed) {
    if (!compressed || compressed.method !== 'rle') {
      return compressed ? Array.from(compressed.data) : [];
    }

    const result = [];
    const data = compressed.data;

    for (let i = 0; i < data.length; i += 2) {
      const blockType = data[i];
      const count = data[i + 1] || 1;
      for (let j = 0; j < count; j++) {
        result.push(blockType);
      }
    }

    return result;
  }
}

// ─── Chunk Stream Entry ─────────────────────────────────────

/**
 * Tracks the streaming state of a single chunk.
 */
class ChunkStreamEntry {
  /**
   * @param {number} cx - Chunk X coordinate
   * @param {number} cz - Chunk Z coordinate
   */
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.key = `${cx},${cz}`;
    this.state = CHUNK_STATE.UNLOADED;
    this.data = null;           // Raw chunk block data array
    this.compressedData = null; // Compressed version for transmission
    this.lastStreamed = 0;      // Timestamp of last stream to clients
    this.dirty = false;         // Has unstreamed block changes
    this.playerRefs = new Set(); // Player IDs that need this chunk
    this.streamedTo = new Set(); // Player IDs that have already received this chunk
    this.loadTime = 0;          // When the chunk was loaded
  }

  /**
   * Mark chunk as dirty (has block changes since last stream)
   */
  markDirty() {
    this.dirty = true;
    this.state = CHUNK_STATE.DIRTY;
  }

  /**
   * Mark chunk as cleanly streamed
   */
  markClean(playerIds) {
    this.dirty = false;
    this.state = CHUNK_STATE.LOADED;
    this.lastStreamed = Date.now();
    // Track which players received this chunk so we can re-stream for new players
    if (playerIds && Array.isArray(playerIds)) {
      for (const pid of playerIds) this.streamedTo.add(pid);
    }
  }

  /**
   * Check if this chunk needs to be streamed (dirty or never streamed)
   */
  needsStreaming() {
    return this.dirty || this.lastStreamed === 0;
  }

  /**
   * Get the data payload for streaming (compressed if available)
   */
  getPayload() {
    const payload = {
      chunkX: this.cx,
      chunkZ: this.cz,
      dirty: this.dirty,
    };

    if (this.compressedData) {
      payload.data = Array.from(this.compressedData);
      payload.compressed = true;
    } else if (this.data) {
      payload.data = this.data;
      payload.compressed = false;
    }

    return payload;
  }
}

// ─── Chunk Streamer (Main Class) ────────────────────────────

/**
 * ChunkStreamer — Manages chunk loading/unloading/streaming for multiplayer sessions.
 * 
 * Usage:
 *   const streamer = new ChunkStreamer({ hostManager, chunkGrid });
 *   streamer.start();
 *   // Update player positions from host manager
 *   streamer.updatePlayerPosition(playerId, { x, y, z });
 *   // Stream chunks on tick
 *   streamer.tick();
 */
class ChunkStreamer {
  /**
   * @param {object} config
   * @param {object} [config.hostManager] — HostManager instance (optional for testing)
   * @param {object} [config.chunkGrid] — ChunkGrid instance (optional for testing)
   * @param {object} [config.options] — Options overriding DEFAULT_STREAM_CONFIG
   */
  constructor(config = {}) {
    this._hostManager = config.hostManager || null;
    this._chunkGrid = config.chunkGrid || null;
    this._options = Object.assign({}, DEFAULT_STREAM_CONFIG, config.options || {});

    // Chunk tracking: "cx,cz" → ChunkStreamEntry
    this._chunks = new Map();

    // Player positions: playerId → { x, y, z }
    this._playerPositions = new Map();

    // Streaming state
    this._running = false;
    this._intervalId = null;
    this._streamQueue = [];       // Chunks pending stream this tick
    this._totalStreamed = 0;      // Total chunks streamed since start
    this._totalLoaded = 0;        // Total unique chunks loaded

    // Callbacks
    this.onChunkLoaded = null;
    this.onChunkUnloaded = null;
    this.onChunkStreamed = null;
    this.onError = null;
  }

  // ── Accessors ────────────────────────────────────────

  get isRunning() {
    return this._running;
  }

  get loadedChunkCount() {
    let count = 0;
    for (const [, entry] of this._chunks) {
      if (entry.state === CHUNK_STATE.LOADED || entry.state === CHUNK_STATE.DIRTY) {
        count++;
      }
    }
    return count;
  }

  get playerCount() {
    return this._playerPositions.size;
  }

  /** Get loaded chunk keys */
  getLoadedChunkKeys() {
    const keys = [];
    for (const [, entry] of this._chunks) {
      if (entry.state !== CHUNK_STATE.UNLOADED) {
        keys.push(entry.key);
      }
    }
    return keys;
  }

  /** Get chunk stream entry by coordinates */
  getChunkEntry(cx, cz) {
    const key = `${cx},${cz}`;
    return this._chunks.get(key) || null;
  }

  /** Get stats summary */
  getStats() {
    let loadedCount = 0, dirtyCount = 0;
    for (const [, entry] of this._chunks) {
      if (entry.state === CHUNK_STATE.LOADED) loadedCount++;
      if (entry.state === CHUNK_STATE.DIRTY) dirtyCount++;
    }
    return {
      playersTracked: this._playerPositions.size,
      chunksLoaded: loadedCount,
      chunksDirty: dirtyCount,
      totalStreamed: this._totalStreamed,
      totalLoaded: this._totalLoaded,
      running: this._running,
    };
  }

  // ── Player Management ────────────────────────────────

  /**
   * Register a player position for chunk tracking.
   * @param {string} playerId - Unique player identifier
   * @param {object} position - { x, y, z } world coordinates
   */
  updatePlayerPosition(playerId, position) {
    if (!playerId || !position) return;
    if (typeof position.x !== 'number' || typeof position.z !== 'number') return;

    this._playerPositions.set(playerId, {
      x: position.x,
      y: typeof position.y === 'number' ? position.y : 0,
      z: position.z,
    });
  }

  /**
   * Remove a player from tracking (disconnected).
   */
  removePlayer(playerId) {
    this._playerPositions.delete(playerId);

    // Also remove player refs from all chunks
    for (const [, entry] of this._chunks) {
      entry.playerRefs.delete(playerId);
    }
  }

  /**
   * Get the chunk coordinates a player is currently in.
   */
  getPlayerChunk(playerId) {
    const pos = this._playerPositions.get(playerId);
    if (!pos) return null;

    const cx = Math.floor(pos.x / CHUNK_WIDTH);
    const cz = Math.floor(pos.z / CHUNK_DEPTH);
    return { cx, cz };
  }

  // ── Chunk Loading/Unloading ──────────────────────────

  /**
   * Calculate which chunks should be loaded based on all player positions.
   * Returns { toLoad: Set<string>, toUnload: Set<string> }
   */
  calculateChunkNeeds() {
    const neededChunks = new Set();
    const unloadCandidates = new Map(); // key → max distance from nearest player

    if (this._playerPositions.size === 0) {
      // No players — everything can be unloaded
      for (const [, entry] of this._chunks) {
        if (entry.state !== CHUNK_STATE.UNLOADED) {
          unloadCandidates.set(entry.key, Infinity);
        }
      }
      return { toLoad: neededChunks, toUnload: new Set(unloadCandidates.keys()) };
    }

    // For each player, find chunks within load radius
    for (const [, pos] of this._playerPositions) {
      const pcx = Math.floor(pos.x / CHUNK_WIDTH);
      const pcz = Math.floor(pos.z / CHUNK_DEPTH);

      for (let dx = -this._options.loadRadius; dx <= this._options.loadRadius; dx++) {
        for (let dz = -this._options.loadRadius; dz <= this._options.loadRadius; dz++) {
          // Use Manhattan distance for efficiency
          if (Math.abs(dx) + Math.abs(dz) > this._options.loadRadius * 1.5) continue;

          const cx = pcx + dx;
          const cz = pcz + dz;
          neededChunks.add(`${cx},${cz}`);
        }
      }
    }

    // Find chunks that should be unloaded (beyond unload radius from ALL players)
    for (const [, entry] of this._chunks) {
      if (neededChunks.has(entry.key)) continue;

      // Check distance from nearest player
      let minDist = Infinity;
      for (const [, pos] of this._playerPositions) {
        const pcx = Math.floor(pos.x / CHUNK_WIDTH);
        const pcz = Math.floor(pos.z / CHUNK_DEPTH);
        const dx = entry.cx - pcx;
        const dz = entry.cz - pcz;
        const dist = Math.sqrt(dx * dx + dz * dz);
        minDist = Math.min(minDist, dist);
      }

      if (minDist >= this._options.unloadRadius) {
        unloadCandidates.set(entry.key, minDist);
      }
    }

    // toLoad = needed but not yet loaded
    const toLoad = new Set();
    for (const key of neededChunks) {
      if (!this._chunks.has(key) || this._chunks.get(key).state === CHUNK_STATE.UNLOADED) {
        toLoad.add(key);
      }
    }

    return { toLoad, toUnload: new Set(unloadCandidates.keys()) };
  }

  /**
   * Load a chunk (calls generator function if provided).
   * Non-blocking: reads from memoryCache, triggers generation for missing chunks.
   */
  loadChunk(cx, cz, generatorFn) {
    const key = `${cx},${cz}`;

    if (this._chunks.has(key)) {
      const entry = this._chunks.get(key);
      if (entry.state !== CHUNK_STATE.UNLOADED) return entry;
    }

    // Create or update entry
    let entry = this._chunks.get(key);
    if (!entry) {
      entry = new ChunkStreamEntry(cx, cz);
      this._chunks.set(key, entry);
    }

    entry.state = CHUNK_STATE.LOADING;
    entry.loadTime = Date.now();

    // Generate chunk data if generator provided
    if (generatorFn) {
      try {
        const data = generatorFn(cx, cz);
        entry.data = Array.isArray(data) || ArrayBuffer.isView(data) ? data : null;

        // If generator returned null (chunk not ready yet), keep as LOADING
        // so it will be retried on the next tick
        if (!entry.data) {
          entry.state = CHUNK_STATE.LOADING;
          return entry;
        }

        // Compress if configured
        if (entry.data && this._options.compressData) {
          entry.compressedData = ChunkCompressor.compress(entry.data).data;
        }

        entry.state = CHUNK_STATE.LOADED;
        entry.lastStreamed = 0; // Needs initial streaming
        this._totalLoaded++;

        if (this.onChunkLoaded) {
          try { this.onChunkLoaded({ cx, cz, key }); }
          catch (e) { this._emitError('onChunkLoaded callback error: ' + e.message); }
        }
      } catch (err) {
        entry.state = CHUNK_STATE.UNLOADED;
        this._emitError(`Failed to generate chunk ${key}: ${err.message}`);
      }
    } else {
      // No generator — mark as loaded without data (relay will provide)
      entry.state = CHUNK_STATE.LOADED;
      entry.lastStreamed = 0;
      this._totalLoaded++;
    }

    return entry;
  }

  /**
   * Unload a chunk, freeing memory.
   */
  unloadChunk(cx, cz) {
    const key = `${cx},${cz}`;
    const entry = this._chunks.get(key);

    if (!entry || entry.state === CHUNK_STATE.UNLOADED) return false;

    const prevState = entry.state;
    entry.state = CHUNK_STATE.UNLOADED;
    entry.data = null;
    entry.compressedData = null;
    entry.playerRefs.clear();

    if (this.onChunkUnloaded && prevState !== CHUNK_STATE.UNLOADED) {
      try { this.onChunkUnloaded({ cx, cz, key }); }
      catch (e) { this._emitError('onChunkUnloaded callback error: ' + e.message); }
    }

    return true;
  }

  /**
   * Mark a chunk as dirty (block change occurred).
   */
  markChunkDirty(cx, cz, newData) {
    const key = `${cx},${cz}`;
    let entry = this._chunks.get(key);

    if (!entry) {
      entry = new ChunkStreamEntry(cx, cz);
      this._chunks.set(key, entry);
      entry.state = CHUNK_STATE.LOADED;
    }

    if (newData && Array.isArray(newData)) {
      entry.data = newData;
      if (this._options.compressData) {
        entry.compressedData = ChunkCompressor.compress(newData).data;
      }
    }

    entry.markDirty();
  }

  // ── Streaming ────────────────────────────────────────

  /**
   * Build the stream queue for this tick.
   * Prioritizes dirty chunks, then never-streamed chunks, then recently-loaded chunks.
   */
  buildStreamQueue() {
    this._streamQueue = [];

    // First: dirty chunks (highest priority — block changes must propagate)
    for (const [, entry] of this._chunks) {
      if (entry.state === CHUNK_STATE.DIRTY && entry.playerRefs.size > 0) {
        this._streamQueue.push(entry);
      }
    }

    // Second: loaded chunks where at least one player hasn't received them yet
    // This fixes the bug where chunks streamed to player A were never sent to player B
    for (const [, entry] of this._chunks) {
      if (entry.state === CHUNK_STATE.LOADED && entry.playerRefs.size > 0) {
        let needsStream = false;
        for (const pid of entry.playerRefs) {
          if (!entry.streamedTo.has(pid)) { needsStream = true; break; }
        }
        if (needsStream) {
          this._streamQueue.push(entry);
        }
      }
    }
  }

  /**
   * Update which players need which chunks based on current positions.
   */
  updatePlayerChunkNeeds() {
    // Clear all player refs
    for (const [, entry] of this._chunks) {
      entry.playerRefs.clear();
    }

    // For each player, find chunks they need
    for (const [playerId, pos] of this._playerPositions) {
      const pcx = Math.floor(pos.x / CHUNK_WIDTH);
      const pcz = Math.floor(pos.z / CHUNK_DEPTH);

      for (const [, entry] of this._chunks) {
        if (entry.state === CHUNK_STATE.UNLOADED) continue;

        const dx = entry.cx - pcx;
        const dz = entry.cz - pcz;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist <= this._options.loadRadius) {
          entry.playerRefs.add(playerId);
        }
      }
    }
  }

  /**
   * Process one tick of chunk streaming.
   * Returns array of stream payloads ready to send.
   * Non-blocking: streams available chunks immediately, triggers generation for missing chunks.
   */
  tick() {
    const payloads = [];

    // Calculate load/unload needs based on player positions
    const { toLoad, toUnload } = this.calculateChunkNeeds();

    // Unload distant chunks (only if no players reference them)
    for (const key of toUnload) {
      const entry = this._chunks.get(key);
      if (entry && entry.playerRefs.size === 0) {
        this.unloadChunk(entry.cx, entry.cz);
      }
    }

    // Load needed chunks (use chunk grid generator if available)
    // Support both getChunkData(cx, cz) and getChunk(cx, cz, null) APIs
    // Non-blocking: read from memoryCache immediately, trigger generation for missing chunks
    const generatorFn = this._chunkGrid ?
      (cx, cz) => {
        const chunk = this._chunkGrid.getChunkData
          ? this._chunkGrid.getChunkData(cx, cz)
          : this._chunkGrid.getChunk
            ? this._chunkGrid.getChunk(cx, cz, null)
            : null;
        if (chunk && chunk.blocks) {
          return Array.from(chunk.blocks);
        }
        // Chunk not in memoryCache — trigger async generation in background
        if (this._chunkGrid._ensureChunkInMemory) {
          this._chunkGrid._ensureChunkInMemory(cx, cz).catch(() => {});
        }
        return null; // Will be retried on next tick
      } : null;

    for (const key of toLoad) {
      const [cx, cz] = key.split(',').map(Number);
      this.loadChunk(cx, cz, generatorFn);
    }

    // Re-check LOADING chunks — they may now be in memoryCache from async generation
    // Also enforce timeout: chunks stuck in LOADING too long get forced to LOADED
    // so they don't block the stream queue forever
    const now = Date.now();
    const loadingTimeout = this._options.loadingTimeout || 15000;
    for (const [, entry] of this._chunks) {
      if (entry.state === CHUNK_STATE.LOADING) {
        if (generatorFn) {
          try {
            const data = generatorFn(entry.cx, entry.cz);
            if (data && (Array.isArray(data) || ArrayBuffer.isView(data))) {
              entry.data = data;
              if (this._options.compressData) {
                entry.compressedData = ChunkCompressor.compress(data).data;
              }
              entry.state = CHUNK_STATE.LOADED;
              entry.lastStreamed = 0;
              this._totalLoaded++;
              if (this.onChunkLoaded) {
                try { this.onChunkLoaded({ cx: entry.cx, cz: entry.cz, key: entry.key }); }
                catch (e) { this._emitError('onChunkLoaded callback error: ' + e.message); }
              }
              continue;
            }
          } catch (err) {
            // Silently skip — chunk still not ready
          }
        }
        // Timeout: force transition to LOADED even without data
        // This prevents chunks from being stuck in LOADING forever and blocking the stream queue
        if (now - entry.loadTime > loadingTimeout) {
          console.log(`[CHUNK_STREAM] Timeout: chunk ${entry.key} stuck in LOADING for ${Math.round((now - entry.loadTime)/1000)}s, forcing to LOADED`);
          entry.state = CHUNK_STATE.LOADED;
          entry.lastStreamed = 0;
          this._totalLoaded++;
        }
      }
    }

    // Update which players need which chunks (after loading, so new chunks get refs)
    this.updatePlayerChunkNeeds();

    // Build stream queue and process
    this.buildStreamQueue();

    let streamedThisTick = 0;
    for (const entry of this._streamQueue) {
      if (streamedThisTick >= this._options.maxChunksPerTick) break;
      if (entry.playerRefs.size === 0) continue;

      const payload = entry.getPayload();
      payload.players = Array.from(entry.playerRefs);
      payloads.push(payload);

      entry.markClean(Array.from(entry.playerRefs));
      this._totalStreamed++;
      streamedThisTick++;

      if (this.onChunkStreamed) {
        try { this.onChunkStreamed(payload); }
        catch (e) { this._emitError('onChunkStreamed callback error: ' + e.message); }
      }
    }

    // Debug: log streaming stats every 5 ticks
    if (!this._tickCount) this._tickCount = 0;
    this._tickCount++;
    if (this._tickCount % 5 === 0) {
      let loading = 0, loaded = 0, dirty = 0, total = this._chunks.size;
      for (const [, e] of this._chunks) {
        if (e.state === CHUNK_STATE.LOADING) loading++;
        if (e.state === CHUNK_STATE.LOADED) loaded++;
        if (e.state === CHUNK_STATE.DIRTY) dirty++;
      }
      console.log(`[CHUNK_STREAM] tick ${this._tickCount}: streamed=${streamedThisTick}, queue=${this._streamQueue.length}, loaded=${loaded}, loading=${loading}, dirty=${dirty}, total=${total}, memCache=${this._chunkGrid ? this._chunkGrid.memoryCache.size : '?'}, players=${this._playerPositions.size}`);
    }

    return payloads;
  }

  // ── Lifecycle ────────────────────────────────────────

  /**
   * Start automatic streaming tick loop.
   */
  start() {
    if (this._running) return;
    this._running = true;

    const tick = () => {
      try {
        this.tick();
      } catch (err) {
        this._emitError('Tick error: ' + err.message);
      }
    };

    this._intervalId = setInterval(tick, this._options.streamInterval);
  }

  /**
   * Stop automatic streaming tick loop.
   */
  stop() {
    this._running = false;
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
  }

  /**
   * Dispose: stop, unload all chunks, clear state.
   */
  dispose() {
    this.stop();

    // Unload all chunks
    for (const [, entry] of this._chunks) {
      entry.state = CHUNK_STATE.UNLOADED;
      entry.data = null;
      entry.compressedData = null;
      entry.playerRefs.clear();
    }
    this._chunks.clear();

    this._playerPositions.clear();
    this._streamQueue = [];
  }

  // ── Error Handling ───────────────────────────────────

  _emitError(message) {
    console.error(`[ChunkStreamer] ${message}`);
    if (this.onError) {
      try { this.onError({ message }); }
      catch (e) { /* silent */ }
    }
  }
}

// ─── Exports ──────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DEFAULT_STREAM_CONFIG,
    CHUNK_STATE,
    ChunkCompressor,
    ChunkStreamEntry,
    ChunkStreamer,
  };

}