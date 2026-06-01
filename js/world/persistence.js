/**
 * Cuubz — localStorage Persistence System
 * Characters + worlds stored in localStorage with slot-based structure:
 *
 *   cuubz:characters              → JSON array of character objects
 *   cuubz:worldSlot:{N}:conf      → World config for slot N (0, 1, 2)
 *   cuubz:worldSlot:{N}:chunk-{x}-{z} → Chunk data for slot N
 *   cuubz:scratchSpace:chunk-{x}-{z}  → Temporary chunks for multiplayer clients
 *   cuubz:slotMap                 → JSON map of worldId → slot number
 */

const MAX_WORLD_SLOTS = 3;
const SAVE_INTERVAL = 30000; // 30 seconds

class PersistenceManager {
  constructor() {
    this.dirtyChunks = new Map(); // "cx,cz" → chunkData (per-world, managed by caller)
    this.lastSaveTime = Date.now();
  }

  // ============================================================
  // Key helpers
  // ============================================================

  _charKey() {
    return 'cuubz:characters';
  }

  _slotMapKey() {
    return 'cuubz:slotMap';
  }

  _worldConfKey(slot) {
    return `cuubz:worldSlot:${slot}:conf`;
  }

  _chunkKey(slot, cx, cz) {
    return `cuubz:worldSlot:${slot}:chunk-${cx}-${cz}`;
  }

  _scratchChunkKey(cx, cz) {
    return `cuubz:scratchSpace:chunk-${cx}-${cz}`;
  }

  // ============================================================
  // Init — just verify localStorage works
  // ============================================================

  async init() {
    try {
      const test = '__cuubz_test__';
      localStorage.setItem(test, '1');
      localStorage.removeItem(test);
    } catch (e) {
      throw new Error('localStorage not available: ' + e.message);
    }

    // Initialize slot map if missing
    if (!localStorage.getItem(this._slotMapKey())) {
      localStorage.setItem(this._slotMapKey(), JSON.stringify({}));
    }

    // Initialize characters array if missing
    if (!localStorage.getItem(this._charKey())) {
      localStorage.setItem(this._charKey(), JSON.stringify([]));
    }

    return this;
  }

  // ============================================================
  // Slot management
  // ============================================================

  /**
   * Get the slot number for a world ID, or -1 if not assigned.
   */
  _getSlotForWorld(worldId) {
    try {
      const map = JSON.parse(localStorage.getItem(this._slotMapKey()) || '{}');
      return map[worldId] !== undefined ? map[worldId] : -1;
    } catch {
      return -1;
    }
  }

  /**
   * Assign a world ID to the next free slot (0, 1, or 2). Returns slot number.
   */
  _assignSlot(worldId) {
    const map = JSON.parse(localStorage.getItem(this._slotMapKey()) || '{}');

    // If already assigned, return existing slot
    if (map[worldId] !== undefined) return map[worldId];

    // Find first free slot
    for (let i = 0; i < MAX_WORLD_SLOTS; i++) {
      const conf = localStorage.getItem(this._worldConfKey(i));
      if (!conf) {
        map[worldId] = i;
        localStorage.setItem(this._slotMapKey(), JSON.stringify(map));
        return i;
      }
    }

    // All slots full — find oldest world and evict it
    let oldestSlot = -1;
    let oldestTime = Infinity;
    for (let i = 0; i < MAX_WORLD_SLOTS; i++) {
      const confStr = localStorage.getItem(this._worldConfKey(i));
      if (!confStr) continue;
      try {
        const conf = JSON.parse(confStr);
        if (conf.createdAt < oldestTime) {
          oldestTime = conf.createdAt;
          oldestSlot = i;
        }
      } catch { /* skip corrupt entries */ }
    }

    if (oldestSlot >= 0) {
      // Evict: clear slot and remove from map
      this.clearSlot(oldestSlot);
      delete map[Object.keys(map).find(k => map[k] === oldestSlot)];
    }

    map[worldId] = 0; // Use slot 0 (was evicted or empty)
    localStorage.setItem(this._slotMapKey(), JSON.stringify(map));
    return 0;
  }

  /**
   * Clear all data in a world slot (used for deletion/eviction).
   */
  clearSlot(slot) {
    // Remove config
    localStorage.removeItem(this._worldConfKey(slot));

    // Remove all chunks in this slot
    const prefix = `cuubz:worldSlot:${slot}:chunk-`;
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(prefix)) {
        localStorage.removeItem(key);
      }
    }
  }

  // ============================================================
  // Characters
  // ============================================================

  async saveCharacter(characterData) {
    const chars = JSON.parse(localStorage.getItem(this._charKey()) || '[]');
    const idx = chars.findIndex(c => c.id === characterData.id);
    if (idx >= 0) {
      chars[idx] = characterData;
    } else {
      chars.push(characterData);
    }
    localStorage.setItem(this._charKey(), JSON.stringify(chars));
  }

  async loadCharacters() {
    try {
      return JSON.parse(localStorage.getItem(this._charKey()) || '[]');
    } catch {
      return [];
    }
  }

  async deleteCharacter(id) {
    const chars = JSON.parse(localStorage.getItem(this._charKey()) || '[]');
    const filtered = chars.filter(c => c.id !== id);
    localStorage.setItem(this._charKey(), JSON.stringify(filtered));
  }

  // ============================================================
  // Worlds (config only — chunks handled separately)
  // ============================================================

  async saveWorld(worldData) {
    const slot = this._assignSlot(worldData.id);
    const conf = {
      id: worldData.id,
      name: worldData.name,
      seed: worldData.seed,
      biomeMap: worldData.biomeMap,
      questProgress: worldData.questProgress || {},
      spawnPoint: worldData.spawnPoint || { x: 0, y: 30, z: 0 },
      createdAt: worldData.createdAt || Date.now(),
      lastPlayed: worldData.lastPlayed || null,
    };
    localStorage.setItem(this._worldConfKey(slot), JSON.stringify(conf));
    return { slot };
  }

  async loadWorlds() {
    const worlds = [];
    for (let i = 0; i < MAX_WORLD_SLOTS; i++) {
      const confStr = localStorage.getItem(this._worldConfKey(i));
      if (confStr) {
        try {
          worlds.push(JSON.parse(confStr));
        } catch { /* skip corrupt entries */ }
      }
    }
    return worlds;
  }

  async deleteWorld(id) {
    const slot = this._getSlotForWorld(id);
    if (slot >= 0) {
      this.clearSlot(slot);
      // Remove from slot map
      const map = JSON.parse(localStorage.getItem(this._slotMapKey()) || '{}');
      delete map[id];
      localStorage.setItem(this._slotMapKey(), JSON.stringify(map));
    }
  }

  /**
   * Get world config for a specific world ID.
   */
  async getWorld(id) {
    const slot = this._getSlotForWorld(id);
    if (slot < 0) return null;
    try {
      return JSON.parse(localStorage.getItem(this._worldConfKey(slot)));
    } catch {
      return null;
    }
  }

  // ============================================================
  // Chunks (world slot storage)
  // ============================================================

  /**
   * Save a chunk for a world to localStorage.
   * @param {string} worldId - World ID
   * @param {number} cx - Chunk X
   * @param {number} cz - Chunk Z
   * @param {object} chunkData - Chunk block data (serializable object)
   */
  async saveChunk(worldId, cx, cz, chunkData) {
    const slot = this._getSlotForWorld(worldId);
    if (slot < 0) return;

    // Serialize: use JSON for simplicity. For large worlds, consider compression.
    const serialized = JSON.stringify(chunkData);
    localStorage.setItem(this._chunkKey(slot, cx, cz), serialized);
  }

  /**
   * Load a chunk from localStorage. Returns null if not found.
   */
  async loadChunk(worldId, cx, cz) {
    const slot = this._getSlotForWorld(worldId);
    if (slot < 0) return null;

    const raw = localStorage.getItem(this._chunkKey(slot, cx, cz));
    if (!raw) return null;

    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /**
   * Synchronous chunk loading (for use in synchronous code paths).
   */
  loadChunkSync(worldId, cx, cz) {
    const slot = this._getSlotForWorld(worldId);
    if (slot < 0) return null;

    const raw = localStorage.getItem(this._chunkKey(slot, cx, cz));
    if (!raw) return null;

    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /**
   * List all saved chunks for a world.
   */
  async listChunks(worldId) {
    const slot = this._getSlotForWorld(worldId);
    if (slot < 0) return [];

    const prefix = `cuubz:worldSlot:${slot}:chunk-`;
    const chunks = [];
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(prefix)) {
        // Extract cx,cz from key format "cuubz:worldSlot:N:chunk-{x}-{z}"
        const match = key.match(/chunk-(.+?)-(.+)$/);
        if (match) {
          chunks.push({ cx: Number(match[1]), cz: Number(match[2]) });
        }
      }
    }
    return chunks;
  }

  // ============================================================
  // Scratch Space (multiplayer temp storage)
  // ============================================================

  /**
   * Save a chunk to scratch space (multiplayer client temporary storage).
   */
  async saveScratchChunk(cx, cz, chunkData) {
    const serialized = JSON.stringify(chunkData);
    localStorage.setItem(this._scratchChunkKey(cx, cz), serialized);
  }

  /**
   * Load a chunk from scratch space.
   */
  async loadScratchChunk(cx, cz) {
    const raw = localStorage.getItem(this._scratchChunkKey(cx, cz));
    if (!raw) return null;

    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /**
   * Clear all scratch space chunks (called when leaving multiplayer session).
   */
  async clearScratchSpace() {
    const prefix = 'cuubz:scratchSpace:';
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(prefix)) {
        localStorage.removeItem(key);
      }
    }
  }

  // ============================================================
  // Dirty chunk tracking (for auto-save)
  // ============================================================

  /**
   * Queue a dirty chunk for saving.
   */
  queueChunk(worldId, cx, cz, chunkData) {
    const key = `${worldId}:${cx},${cz}`;
    this.dirtyChunks.set(key, { worldId, cx, cz, data: chunkData });
  }

  /**
   * Flush all dirty chunks to localStorage.
   */
  async flushDirtyChunks() {
    if (this.dirtyChunks.size === 0) return;

    for (const [key, chunk] of this.dirtyChunks) {
      await this.saveChunk(chunk.worldId, chunk.cx, chunk.cz, chunk.data);
    }

    this.dirtyChunks.clear();
    _log(`[Persistence] Flushed ${this.dirtyChunks.size} dirty chunks`);
  }

  /**
   * Periodic save check (call from game loop).
   */
  periodicSave() {
    const now = Date.now();
    if (now - this.lastSaveTime >= SAVE_INTERVAL) {
      this.flushDirtyChunks().then(() => {
        this.lastSaveTime = now;
      });
    }
  }

  // ============================================================
  // Utility
  // ============================================================

  /**
   * Get localStorage usage estimate.
   */
  getStorageUsage() {
    let total = 0;
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('cuubz:')) {
        total += (localStorage.getItem(key) || '').length * 2; // UTF-16
      }
    }
    return { bytes: total, kb: (total / 1024).toFixed(1), mb: (total / (1024 * 1024)).toFixed(2) };
  }

  /**
   * Clear all Cuubz data from localStorage.
   */
  async clearAll() {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('cuubz:')) {
        localStorage.removeItem(key);
      }
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PersistenceManager;
}
