/**
 * Cuubz — World Management System
 * Handles world CRUD operations with IndexedDB persistence.
 * Max 3 worlds per device. Each world has: id, name, seed, biomeMap, questProgress, chunkReferences.
 *
 * Storage backend is injected at construction time:
 *   - Browser: PersistenceManager (IndexedDB)
 *   - Tests: In-memory mock store
 */

'use strict';

// ============================================================
// Constants
// ============================================================

const MAX_WORLDS = 3;
// MIN_NAME_LENGTH and MAX_NAME_LENGTH defined in characterManager.js — use globals
const DEFAULT_SEED = 42;
const BIOME_NAMES = [
  'Plains', 'Forest', 'Desert', 'Tundra',
  'Mountains', 'Ocean', 'Lava', 'Corrupt'
];

// ============================================================
// WorldManager Class
// ============================================================

class WorldManager {
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
    if (trimmed.length < MIN_NAME_LENGTH) {
      return { valid: false, error: `Name must be at least ${MIN_NAME_LENGTH} character` };
    }
    if (trimmed.length > MAX_NAME_LENGTH) {
      return { valid: false, error: `Name must be at most ${MAX_NAME_LENGTH} characters` };
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
      return { success: false, error: `Maximum ${MAX_WORLDS} worlds reached` };
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
      questProgress: {}, // Shared quest state (world-scoped)
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
  selectWorld(id) {
    const world = this.getWorld(id);
    if (!world) {
      return { success: false, error: `World "${id}" not found` };
    }
    this.selectedId = id;
    // Update lastPlayed timestamp
    world.lastPlayed = Date.now();
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
  // Quest Progress Helpers (world-scoped, shared by all players)
  // ============================================================

  /**
   * Get quest progress for a world.
   */
  getQuestProgress(id) {
    const world = this.getWorld(id);
    if (!world) return null;
    return { ...world.questProgress }; // Return copy
  }

  /**
   * Set quest progress for a world.
   */
  setQuestProgress(id, questId, progress) {
    const world = this.getWorld(id);
    if (!world) return false;
    world.questProgress[questId] = progress;
    return true;
  }

  /**
   * Advance a quest to the next stage.
   */
  advanceQuest(id, questId) {
    const world = this.getWorld(id);
    if (!world) return false;
    const current = world.questProgress[questId] || { stage: 0, completed: false };
    if (current.completed) return true; // Already completed

    // Determine next stage (simplified — actual quest system will define stages)
    const nextStage = current.stage + 1;
    const completed = nextStage >= 5; // Default: 5 stages per quest

    world.questProgress[questId] = {
      stage: completed ? 5 : nextStage,
      completed,
      lastUpdated: Date.now(),
    };
    return true;
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
      questProgress: w.questProgress,
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
      questProgress: w.questProgress || {},
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WorldManager, MAX_WORLDS, MIN_NAME_LENGTH, MAX_NAME_LENGTH, DEFAULT_SEED, BIOME_NAMES };
}
