/**
 * Cuubz — World Management System
 * Handles world CRUD operations with IndexedDB persistence.
 * Max 3 worlds per device. Each world has: id, name, seed, biomeMap, questProgress, chunkReferences.
 *
 * Storage backend is injected at construction time:
 *   - Browser: PersistenceManager (IndexedDB)
 *   - Tests: In-memory mock store
 */

import {
  createQuestState,
  migrateQuestState,
  serializeQuestState,
  QUEST_STATE_VERSION,
} from '../data/QuestState.js';

// ============================================================
// Constants
// ============================================================

export const MAX_WORLDS = 3;

/**
 * World-name length limits — **D-38**, ruled in PR 14.
 *
 * This file used to `import { MAX_NAME_LENGTH, MIN_NAME_LENGTH } from './CharacterManager.js'`
 * and validate world names against a *character*-name limit of 16. The class that has
 * actually been running in the browser since forever (`BrowserWorldManager` in `main.js`)
 * used 32, and `index.html` gives `#world-name` and `#host-world-name` `maxlength="32"`.
 * So 32 is the shipped limit and 16 was an accident of the import.
 *
 * `test/test_worldManager.js` proved it against itself: it asserted `MAX_NAME_LENGTH === 16`
 * and "17 char name invalid (over max)", but its edge-case suite rejected a **33**-character
 * name as "one over max". Two of its own assertions were written against two different
 * limits.
 *
 * Worlds now own their limits outright. Borrowing a character constant for worlds was the
 * defect; keeping the number and fixing the coupling would have left the same trap for the
 * next reader.
 */
export const MIN_WORLD_NAME_LENGTH = 1;
export const MAX_WORLD_NAME_LENGTH = 32;

/** The one over-limit message — the `WorldManager` half of `CHARACTER_LIMIT_MESSAGE`. */
export const WORLD_LIMIT_MESSAGE = `Maximum ${MAX_WORLDS} worlds reached`;

export const DEFAULT_SEED = 42;

/**
 * Worldgen version — the gate that keeps existing saves byte-identical (D-Q1, §3.1).
 *
 * `workerGeneration.js` derives terrain from `(cx, cz, seed)`, and saved chunks live in
 * IndexedDB keyed `${worldId}:${cx},${cz}`. Adding the Corrupt and Lava biomes changes
 * what *newly generated* chunks look like while already-saved chunks keep the old
 * terrain, so a world that has already explored outward would show a visible seam where
 * old chunks meet new.
 *
 * So it is versioned rather than switched: **new worlds get 2** and the new biomes;
 * every world created before this change has no `worldgenVersion` field, defaults to
 * **1** on load, and generates exactly as it always did. The value threads to the worker
 * through `genParams` (`ChunkGenerator.js:44-51`), and a v1 world can be opted in from
 * the world screen behind a "this will seam your terrain" confirmation.
 */
export const WORLDGEN_VERSION_LEGACY = 1;
export const WORLDGEN_VERSION_BIOMES = 2;
export const CURRENT_WORLDGEN_VERSION = WORLDGEN_VERSION_BIOMES;
export const BIOME_NAMES = [
  'Deep Ocean', 'Ocean', 'Beach', 'Plains', 'Forest', 'Badlands',
  'Tundra', 'Desert', 'Mountains', 'Frozen Peaks'
];

// ============================================================
// WorldManager Class
// ============================================================

export class WorldManager {
  /**
   * @param {Object} storage - Storage backend with methods:
   *   - saveWorld(data): Promise<void>
   *   - loadWorlds(): Promise<Array<World>>
   *   - deleteWorld(id): Promise<void>
   */
  constructor(storage) {
    this.storage = storage;
    this.worlds = []; // Cached world list
    this.selectedId = null; // Currently selected world ID
    this._initialized = false;
  }

  // ============================================================
  // Initialization
  // ============================================================

  /**
   * Load worlds from storage into cache.
   * Must be called before any other operations.
   */
  async init() {
    if (this._initialized) return;
    this.worlds = await this.storage.loadWorlds();
    this._initialized = true;
  }

  // ============================================================
  // Validation Helpers
  // ============================================================

  /**
   * Validate world name: non-empty, within length limit.
   * @returns {{ valid: boolean, error?: string }}
   */
  static validateName(name) {
    if (typeof name !== 'string') {
      return { valid: false, error: 'Name must be a string' };
    }
    const trimmed = name.trim();
    if (trimmed.length < MIN_WORLD_NAME_LENGTH) {
      return { valid: false, error: `Name must be at least ${MIN_WORLD_NAME_LENGTH} character` };
    }
    if (trimmed.length > MAX_WORLD_NAME_LENGTH) {
      return { valid: false, error: `Name must be at most ${MAX_WORLD_NAME_LENGTH} characters` };
    }
    // Allow alphanumeric, spaces, hyphens, underscores
    if (!/^[a-zA-Z0-9 _\-]+$/.test(trimmed)) {
      return { valid: false, error: 'Name can only contain letters, numbers, spaces, hyphens, and underscores' };
    }
    return { valid: true };
  }

  /**
   * Check if we can create more worlds.
   */
  canCreateMore() {
    return this.worlds.length < MAX_WORLDS;
  }

  /**
   * Get remaining world slots.
   */
  getRemainingSlots() {
    return MAX_WORLDS - this.worlds.length;
  }

  // ============================================================
  // Seed Generation
  // ============================================================

  /**
   * Generate a random world seed (32-bit unsigned integer).
   */
  static generateSeed() {
    // Use Math.random() to generate a 32-bit seed
    return Math.floor(Math.random() * 0xFFFFFFFF);
  }

  /**
   * Format seed for display.
   */
  static formatSeed(seed) {
    return String(seed).padStart(8, '0');
  }

  // ============================================================
  // Biome Map Generation (metadata only — actual terrain generated at load time)
  // ============================================================

  /**
   * Generate a deterministic biome distribution map for the world.
   * Returns a summary of dominant biomes based on the seed.
   */
  static generateBiomeMap(seed) {
    // Simple LCG-based pseudo-random to determine dominant biomes
    const lcg = (s) => (s * 16807 + 12345) % 2147483647;
    let s = seed || DEFAULT_SEED;

    // Pick 2-4 dominant biomes for this world
    const count = 2 + (lcg(s) % 3); // 2, 3, or 4 biomes
    const biomes = [];
    const used = new Set();

    for (let i = 0; i < count; i++) {
      s = lcg(s);
      let idx = s % BIOME_NAMES.length;
      // Avoid duplicates
      while (used.has(idx)) {
        idx = (idx + 1) % BIOME_NAMES.length;
      }
      used.add(idx);
      biomes.push(BIOME_NAMES[idx]);
    }

    return {
      dominantBiomes: biomes,
      seed,
    };
  }

  // ============================================================
  // CRUD Operations
  // ============================================================

  /**
   * Generate a unique world ID (timestamp + random suffix).
   */
  static generateId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `world_${timestamp}_${random}`;
  }

  /**
   * Create a new world with a random seed.
   * @param {string} name - World display name (1-32 chars)
   * @param {number} [seed] - Optional seed for deterministic generation
   * @returns {{ success: boolean, world?: Object, error?: string }}
   */
  async createWorld(name, seed) {
    // Validate name
    const nameResult = WorldManager.validateName(name);
    if (!nameResult.valid) {
      return { success: false, error: nameResult.error };
    }

    // Check slot availability
    if (!this.canCreateMore()) {
      return { success: false, error: WORLD_LIMIT_MESSAGE };
    }

    // Check for duplicate names (case-insensitive)
    const trimmedName = name.trim();
    const duplicate = this.worlds.find(
      w => w.name.toLowerCase() === trimmedName.toLowerCase()
    );
    if (duplicate) {
      return { success: false, error: `World "${duplicate.name}" already exists` };
    }

    // Generate or use provided seed
    const worldSeed = seed !== undefined ? seed : WorldManager.generateSeed();

    // Generate biome map metadata
    const biomeMap = WorldManager.generateBiomeMap(worldSeed);

    // Create world object
    const id = WorldManager.generateId();
    const world = {
      id,
      name: trimmedName,
      seed: worldSeed,
      biomeMap,
      questState: createQuestState(), // §4.1 — world-scoped, shared by everyone in it
      worldgenVersion: CURRENT_WORLDGEN_VERSION, // §3.1 — new worlds get the new biomes
      chunkReferences: [], // List of saved chunk keys
      createdAt: Date.now(),
      lastPlayed: null,
    };

    try {
      await this.storage.saveWorld(world);
      this.worlds.push(world);
      return { success: true, world };
    } catch (err) {
      return { success: false, error: `Failed to save world: ${err.message}` };
    }
  }

  /**
   * Update an existing world's name.
   * @param {string} id - World ID
   * @param {Object} updates - Partial update: { name? }
   * @returns {{ success: boolean, world?: Object, error?: string }}
   */
  async updateWorld(id, updates) {
    const index = this.worlds.findIndex(w => w.id === id);
    if (index === -1) {
      return { success: false, error: `World "${id}" not found` };
    }

    const world = this.worlds[index];

    // Validate name change
    if (updates.name !== undefined) {
      const nameResult = WorldManager.validateName(updates.name);
      if (!nameResult.valid) {
        return { success: false, error: nameResult.error };
      }
      const trimmedName = updates.name.trim();

      // Check for duplicate names (excluding self)
      const duplicate = this.worlds.find(
        w => w.id !== id && w.name.toLowerCase() === trimmedName.toLowerCase()
      );
      if (duplicate) {
        return { success: false, error: `World "${duplicate.name}" already exists` };
      }
      world.name = trimmedName;
    }

    try {
      await this.storage.saveWorld(world);
      this.worlds[index] = world;
      return { success: true, world };
    } catch (err) {
      return { success: false, error: `Failed to update world: ${err.message}` };
    }
  }

  /**
   * Delete a world and all its associated chunks.
   * @param {string} id - World ID
   * @returns {{ success: boolean, error?: string }}
   */
  async deleteWorld(id) {
    const index = this.worlds.findIndex(w => w.id === id);
    if (index === -1) {
      return { success: false, error: `World "${id}" not found` };
    }

    try {
      await this.storage.deleteWorld(id);
      this.worlds.splice(index, 1);

      // Clear selection if deleted world was selected
      if (this.selectedId === id) {
        this.selectedId = null;
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: `Failed to delete world: ${err.message}` };
    }
  }

  /**
   * Get a world by ID.
   */
  getWorld(id) {
    return this.worlds.find(w => w.id === id) || null;
  }

  /**
   * Get all worlds.
   */
  getAllWorlds() {
    return [...this.worlds]; // Return copy
  }

  // ============================================================
  // Selection
  // ============================================================

  /**
   * Select a world for play.
   */
  async selectWorld(id) {
    const world = this.getWorld(id);
    if (!world) {
      return { success: false, error: `World "${id}" not found` };
    }
    this.selectedId = id;
    // Update lastPlayed timestamp and persist
    world.lastPlayed = Date.now();
    await this.storage.saveWorld(world);
    return { success: true, world };
  }

  /**
   * Get the currently selected world.
   */
  getSelectedWorld() {
    if (!this.selectedId) return null;
    return this.getWorld(this.selectedId);
  }

  /**
   * Clear world selection.
   */
  clearSelection() {
    this.selectedId = null;
  }

  // ============================================================
  // Quest State (world-scoped, shared by all players)
  // ============================================================
  //
  // These three replaced `getQuestProgress` / `setQuestProgress` / `advanceQuest`.
  //
  // The old trio were placeholders and said so: `advanceQuest` hard-coded
  // `completed = nextStage >= 5` under the comment *"simplified — actual quest system
  // will define stages"*, so every quest in the game was five stages long and no
  // definition could ever say otherwise. `setQuestProgress` took an opaque `progress`
  // whose shape nothing agreed on (§2.1). Nothing in `src/` called any of them; the
  // only readers were `test/integration/worldPersistence.test.js`, which asserted the
  // hard-coded 5 back at itself.
  //
  // `QuestSystem` owns advancement now, and this class owns only storage: hand it a
  // state, get a state back.

  /**
   * The world's quest state, migrated to the current schema.
   *
   * Migrating on read rather than on load means a world config written by any earlier
   * version is legal input and the caller never sees a legacy shape.
   *
   * @returns {object|null} a v1 quest state, or null if the world does not exist
   */
  getQuestState(id) {
    const world = this.getWorld(id);
    if (!world) return null;
    if (!world.questState || world.questState.v !== QUEST_STATE_VERSION) {
      world.questState = migrateQuestState(world.questState);
    }
    return world.questState;
  }

  /**
   * Replace the world's quest state. Takes the object by reference — `saveWorldState`
   * serializes it on the way to storage, and the live system needs to keep mutating the
   * same object between saves.
   */
  setQuestState(id, questState) {
    const world = this.getWorld(id);
    if (!world) return false;
    world.questState = migrateQuestState(questState);
    return true;
  }

  /**
   * Which terrain generator this world was created with (§3.1). Absent means 1: every
   * world made before the field existed predates the Corrupt and Lava biomes.
   */
  getWorldgenVersion(id) {
    const world = this.getWorld(id);
    if (!world) return null;
    return world.worldgenVersion || WORLDGEN_VERSION_LEGACY;
  }

  /**
   * Opt an existing world into the new biomes.
   *
   * One-way, and it will seam: chunks already on disk keep the terrain they were
   * generated with, and only newly-generated ones can contain a Corrupt or Lava patch.
   * The confirmation for that is `WorldScreen.openUpgradeModal` (S9); this method is the
   * mechanism it drives.
   *
   * **D-122 — the cache is rolled back if the save throws.** The first version set the
   * field and then tried to persist it, so a storage failure returned `{success:false}`
   * over a cache that already said 2. Disk would have said 1, the running session would
   * have generated v2 chunks into it, and the next load would have been a v1 world full
   * of v2 terrain — the mixed generation this whole version gate exists to prevent,
   * reached without the confirmation. `deleteWorld` has always ordered it the other way
   * round; this now matches. The absent key is restored as *absent*, because that is what
   * a pre-S4 save actually contains and `serialize()` writes the object it is given.
   */
  async upgradeWorldgen(id) {
    const world = this.getWorld(id);
    if (!world) return { success: false, error: `World "${id}" not found` };
    if ((world.worldgenVersion || WORLDGEN_VERSION_LEGACY) >= CURRENT_WORLDGEN_VERSION) {
      return { success: false, error: 'World is already on the current worldgen version' };
    }
    const had = Object.prototype.hasOwnProperty.call(world, 'worldgenVersion');
    const previous = world.worldgenVersion;
    world.worldgenVersion = CURRENT_WORLDGEN_VERSION;
    try {
      await this.storage.saveWorld(world);
      return { success: true, world };
    } catch (err) {
      if (had) world.worldgenVersion = previous; else delete world.worldgenVersion;
      return { success: false, error: `Failed to save world: ${err.message}` };
    }
  }

  // ============================================================
  // Chunk Reference Helpers
  // ============================================================

  /**
   * Add a chunk reference to a world.
   */
  addChunkReference(id, cx, cz) {
    const world = this.getWorld(id);
    if (!world) return false;
    const key = `${cx}_${cz}`;
    if (!world.chunkReferences.includes(key)) {
      world.chunkReferences.push(key);
    }
    return true;
  }

  /**
   * Get all chunk references for a world.
   */
  getChunkReferences(id) {
    const world = this.getWorld(id);
    if (!world) return [];
    return [...world.chunkReferences];
  }

  // ============================================================
  // Serialization (for multiplayer sync / save data)
  // ============================================================

  /**
   * Serialize all worlds to plain data.
   */
  serialize() {
    return this.worlds.map(w => ({
      id: w.id,
      name: w.name,
      seed: w.seed,
      biomeMap: w.biomeMap,
      questState: serializeQuestState(migrateQuestState(w.questState)),
      worldgenVersion: w.worldgenVersion || WORLDGEN_VERSION_LEGACY,
      chunkReferences: w.chunkReferences,
      createdAt: w.createdAt,
      lastPlayed: w.lastPlayed,
    }));
  }

  /**
   * Deserialize worlds from plain data.
   */
  deserialize(data) {
    this.worlds = data.map(w => ({
      id: w.id,
      name: w.name,
      seed: w.seed || DEFAULT_SEED,
      biomeMap: w.biomeMap || WorldManager.generateBiomeMap(w.seed || DEFAULT_SEED),
      // Migrated, not defaulted: a world written before S0 carries a `questProgress` in
      // one of the three legacy shapes and no `questState` at all, and `migrateQuestState`
      // turns every one of those — including `undefined` — into a valid v1 state.
      questState: migrateQuestState(w.questState),
      worldgenVersion: w.worldgenVersion || WORLDGEN_VERSION_LEGACY,
      chunkReferences: w.chunkReferences || [],
      createdAt: w.createdAt || Date.now(),
      lastPlayed: w.lastPlayed || null,
    }));
  }

  // ============================================================
  // World Preview (for UI display)
  // ============================================================

  /**
   * Generate a preview description for a world.
   */
  static getWorldPreview(world) {
    const biomes = world.biomeMap && world.biomeMap.dominantBiomes
      ? world.biomeMap.dominantBiomes.join(', ')
      : 'Unknown';
    const seed = WorldManager.formatSeed(world.seed);
    const chunks = world.chunkReferences ? world.chunkReferences.length : 0;
    return { biomes, seed, chunkCount: chunks };
  }
}

// ============================================================
// Module Exports (for Node.js testing)
// ============================================================
//
// This file used to re-export `MAX_NAME_LENGTH` / `MIN_NAME_LENGTH` from
// `CharacterManager.js` "for compatibility with the CommonJS surface these files had
// before PR 9". The re-export is gone with the import — see MAX_WORLD_NAME_LENGTH above
// and BUGS.md D-38. `test/test_worldManager.js` is the only reader and PR 14 moved it.
