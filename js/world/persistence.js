/**
 * Cuubz — localStorage Persistence System (Characters + World Configs only)
 * Chunk storage has been moved to IndexedDB via ChunkStore/ChunkBinaryCodec.
 *
 *   cuubz:characters              → JSON array of character objects
 *   cuubz:worldSlot:{N}:conf      → World config for slot N (0, 1, 2)
 *   cuubz:slotMap                 → JSON map of worldId → slot number
 */

const MAX_WORLD_SLOTS = 3;

class PersistenceManager {
  constructor() {}

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
