/**
 * Cuubz — browser storage backend for characters and world configs.
 *
 *   cuubz:characters              → JSON array of character objects
 *   cuubz:worldSlot:{N}:conf      → World config for slot N (0, 1, 2)
 *   cuubz:slotMap                 → JSON map of worldId → slot number
 *
 * Chunks live in IndexedDB (`cuubz-worlds`), not here — `ChunkManager` owns them. The one
 * place the two meet is `deleteWorld()`, which has to remove both halves or leak the
 * larger one; see the comment there (D-18 / H-3, and BUGS.md D-40 for the flaw PR 14 found
 * in the shipped version while moving it).
 *
 * This is the `storage` backend `CharacterManager` and `WorldManager` are constructed
 * with. Node tests inject an in-memory mock instead, which is why those two files stay
 * environment-free and this one does not have to.
 */

import { ChunkManager } from './ChunkManager.js';
import { migrateQuestState, serializeQuestState } from '../../game/data/QuestState.js';

export const MAX_WORLD_SLOTS = 3;

export class PersistenceManager {
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
      // §5.1 — was `questProgress`, a write-only field in one of three disagreeing
      // shapes. `migrateQuestState` accepts every one of them plus `undefined`, and
      // `serializeQuestState` is what holds the write inside the 8 KB localStorage
      // budget: completed quests are collapsed to a boolean and a timestamp, and only
      // the active quest carries its per-contributor high-water marks.
      questState: serializeQuestState(migrateQuestState(worldData.questState)),
      worldgenVersion: worldData.worldgenVersion || 1,
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
          const conf = JSON.parse(confStr);
          // Migrate on the way out, so nothing above this line ever sees a legacy
          // shape. A world config written before S0 has `questProgress` and no
          // `questState`; one written before the biomes has no `worldgenVersion`,
          // which means 1 and means "generate exactly as you always did" (§3.1).
          conf.questState = migrateQuestState(conf.questState);
          conf.worldgenVersion = conf.worldgenVersion || 1;
          delete conf.questProgress;
          worlds.push(conf);
        } catch { /* skip corrupt entries */ }
      }
    }
    return worlds;
  }

  /**
   * Delete a world: its IndexedDB chunks and manifest, then its localStorage config.
   *
   * **Both halves, or the big one leaks.** This came from `BrowserWorldManager.deleteWorld`
   * in `main.js` in PR 14, and it is the **D-18 fix and the H-3 fix**, shipped in PR 6c/6d.
   * It could not go into `src/game/entities/WorldManager.js` — Node tests import that file
   * and it has to stay environment-free — so it lives here, in the browser storage backend
   * that already owned the localStorage half of the same operation. `WorldManager` calls
   * `this.storage.deleteWorld(id)` and is unchanged by the move; a test's mock storage
   * simply has no chunks to clean.
   *
   * H-3: this used to be `indexedDB.open('cuubz-worlds')` with NO version argument. On a
   * device where the database did not exist yet — a player who deletes a world before ever
   * entering one — that CREATES `cuubz-worlds` at version 1 with no object stores, and the
   * `db.transaction([...])` below then throws NotFoundError. `ChunkManager.openDatabase()`
   * is the single opener: it names DB_VERSION and carries the schema ladder, so the
   * database it finds or creates is always one this codebase recognises. It returns a
   * fresh connection, which is why the `db.close()` below is correct.
   *
   * **D-40, fixed in PR 14 while moving this.** Two things were wrong with the shipped
   * version and neither was visible:
   *   1. The `catch` was empty, under the comment "Silently ignore cleanup errors". A
   *      failed cleanup therefore reported success and re-opened D-18 — a world's chunks
   *      left on disk with nothing left to identify them by — with no console trace.
   *      It now warns. It still does not throw: the caller (`WorldManager.deleteWorld`)
   *      turns a throw into `{success:false}` and keeps the world in its list, so
   *      escalating would leave the UI showing a world whose config is already gone.
   *   2. The localStorage config was removed FIRST. A tab that died between the two
   *      halves orphaned the chunks permanently, because the world id lives in the config
   *      that was just deleted. Chunks go first now: the same crash window costs a
   *      regenerated world instead of an unreachable ~14 MB.
   */
  async deleteWorld(id) {
    // ── 1. IndexedDB: this world's chunk records and its manifest.
    try {
      const db = await ChunkManager.openDatabase();
      const tx = db.transaction(['manifests', 'chunks'], 'readwrite');
      tx.objectStore('manifests').delete(id);
      // D-18: chunk records used to be left behind here, under a comment reading
      // "orphaned but harmless - they're keyed by chunk coordinates". Coordinate-only
      // keys were H-1, not a mitigation: the records were not orphaned, they were
      // SHARED with whatever world next generated the same coordinates. PR 6c scoped
      // the primary key to `${worldName}:${cx},${cz}`, which is what makes this
      // world's chunks both identifiable and safe to remove — a contiguous key range.
      // U+FFFF is the upper bound because it sorts after every character IndexedDB
      // will see in a chunk key, which is only digits, '-' and ','. Written as an
      // escape rather than a literal so the file stays pure ASCII.
      tx.objectStore('chunks').delete(
        IDBKeyRange.bound(`${id}:`, `${id}:` + String.fromCharCode(0xFFFF))
      );
      await new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    } catch (err) {
      // Non-fatal by design (see D-40 above) — but never silent again.
      console.warn(`[Cuubz] World ${id}: chunk/manifest cleanup failed, records may be orphaned:`, err);
    }

    // ── 2. localStorage: the world config and its slot-map entry.
    const slot = this._getSlotForWorld(id);
    if (slot >= 0) {
      this.clearSlot(slot);
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
