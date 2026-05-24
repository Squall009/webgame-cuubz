/**
 * Cuubz — Character Management System
 * Handles character CRUD operations with IndexedDB persistence.
 * Max 3 characters per device. Each character has: id, name, color, inventory, spawnPoints.
 *
 * Storage backend is injected at construction time:
 *   - Browser: PersistenceManager (IndexedDB)
 *   - Tests: In-memory mock store
 */

'use strict';

// ============================================================
// Constants
// ============================================================

const MAX_CHARACTERS = 3;
const MIN_NAME_LENGTH = 1;
const MAX_NAME_LENGTH = 16;
const DEFAULT_COLOR = '#4CAF50';
const CHARACTER_COLORS = [
  '#4CAF50', '#2196F3', '#FF9800', '#E91E63',
  '#9C27B0', '#00BCD4', '#FFEB3B', '#795548',
  '#607D8B', '#F44336', '#8BC34A', '#3F51B5'
];

// ============================================================
// CharacterManager Class
// ============================================================

class CharacterManager {
  /**
   * @param {Object} storage - Storage backend with methods:
   *   - saveCharacter(data): Promise<void>
   *   - loadCharacters(): Promise<Array<Character>>
   *   - deleteCharacter(id): Promise<void>
   */
  constructor(storage) {
    this.storage = storage;
    this.characters = []; // Cached character list
    this.selectedId = null; // Currently selected character ID
    this._initialized = false;
  }

  // ============================================================
  // Initialization
  // ============================================================

  /**
   * Load characters from storage into cache.
   * Must be called before any other operations.
   */
  async init() {
    if (this._initialized) return;
    this.characters = await this.storage.loadCharacters();
    this._initialized = true;
  }

  // ============================================================
  // Validation Helpers
  // ============================================================

  /**
   * Validate character name: non-empty, within length limit, no existing duplicate.
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
   * Validate color hex string.
   * @returns {{ valid: boolean, color?: string }}
   */
  static validateColor(color) {
    if (typeof color !== 'string') {
      return { valid: false };
    }
    if (/^#[0-9A-Fa-f]{6}$/.test(color)) {
      return { valid: true, color: color.toUpperCase() };
    }
    return { valid: false };
  }

  /**
   * Check if we can create more characters.
   */
  canCreateMore() {
    return this.characters.length < MAX_CHARACTERS;
  }

  /**
   * Get remaining character slots.
   */
  getRemainingSlots() {
    return MAX_CHARACTERS - this.characters.length;
  }

  // ============================================================
  // CRUD Operations
  // ============================================================

  /**
   * Generate a unique character ID (timestamp + random suffix).
   */
  static generateId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `char_${timestamp}_${random}`;
  }

  /**
   * Create a new character.
   * @param {string} name - Character display name (1-16 chars)
   * @param {string} color - Hex color code (#RRGGBB)
   * @returns {{ success: boolean, character?: Object, error?: string }}
   */
  async createCharacter(name, color) {
    // Validate name
    const nameResult = CharacterManager.validateName(name);
    if (!nameResult.valid) {
      return { success: false, error: nameResult.error };
    }

    // Validate color
    const colorVal = color || DEFAULT_COLOR;
    const colorResult = CharacterManager.validateColor(colorVal);
    if (!colorResult.valid) {
      return { success: false, error: `Invalid color format. Use hex (#RRGGBB). Got: ${colorVal}` };
    }

    // Check slot availability
    if (!this.canCreateMore()) {
      return { success: false, error: `Maximum ${MAX_CHARACTERS} characters reached` };
    }

    // Check for duplicate names (case-insensitive)
    const trimmedName = name.trim();
    const duplicate = this.characters.find(
      c => c.name.toLowerCase() === trimmedName.toLowerCase()
    );
    if (duplicate) {
      return { success: false, error: `Character "${duplicate.name}" already exists` };
    }

    // Create character object
    const id = CharacterManager.generateId();
    const character = {
      id,
      name: trimmedName,
      color: colorResult.color,
      inventory: [], // Will be populated by InventorySystem
      spawnPoints: {}, // worldId → { x, y, z }
      createdAt: Date.now(),
      lastPlayed: null,
    };

    try {
      await this.storage.saveCharacter(character);
      this.characters.push(character);
      return { success: true, character };
    } catch (err) {
      return { success: false, error: `Failed to save character: ${err.message}` };
    }
  }

  /**
   * Update an existing character's name and/or color.
   * @param {string} id - Character ID
   * @param {Object} updates - Partial update: { name?, color? }
   * @returns {{ success: boolean, character?: Object, error?: string }}
   */
  async updateCharacter(id, updates) {
    const index = this.characters.findIndex(c => c.id === id);
    if (index === -1) {
      return { success: false, error: `Character "${id}" not found` };
    }

    const character = this.characters[index];

    // Validate name change
    if (updates.name !== undefined) {
      const nameResult = CharacterManager.validateName(updates.name);
      if (!nameResult.valid) {
        return { success: false, error: nameResult.error };
      }
      const trimmedName = updates.name.trim();

      // Check for duplicate names (excluding self)
      const duplicate = this.characters.find(
        c => c.id !== id && c.name.toLowerCase() === trimmedName.toLowerCase()
      );
      if (duplicate) {
        return { success: false, error: `Character "${duplicate.name}" already exists` };
      }
      character.name = trimmedName;
    }

    // Validate color change
    if (updates.color !== undefined) {
      const colorResult = CharacterManager.validateColor(updates.color);
      if (!colorResult.valid) {
        return { success: false, error: `Invalid color format. Use hex (#RRGGBB). Got: ${updates.color}` };
      }
      character.color = colorResult.color;
    }

    try {
      await this.storage.saveCharacter(character);
      this.characters[index] = character;
      return { success: true, character };
    } catch (err) {
      return { success: false, error: `Failed to update character: ${err.message}` };
    }
  }

  /**
   * Delete a character.
   * @param {string} id - Character ID
   * @returns {{ success: boolean, error?: string }}
   */
  async deleteCharacter(id) {
    const index = this.characters.findIndex(c => c.id === id);
    if (index === -1) {
      return { success: false, error: `Character "${id}" not found` };
    }

    try {
      await this.storage.deleteCharacter(id);
      this.characters.splice(index, 1);

      // Clear selection if deleted character was selected
      if (this.selectedId === id) {
        this.selectedId = null;
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: `Failed to delete character: ${err.message}` };
    }
  }

  /**
   * Get a character by ID.
   */
  getCharacter(id) {
    return this.characters.find(c => c.id === id) || null;
  }

  /**
   * Get all characters.
   */
  getAllCharacters() {
    return [...this.characters]; // Return copy
  }

  // ============================================================
  // Selection
  // ============================================================

  /**
   * Select a character for play.
   */
  selectCharacter(id) {
    const character = this.getCharacter(id);
    if (!character) {
      return { success: false, error: `Character "${id}" not found` };
    }
    this.selectedId = id;
    // Update lastPlayed timestamp
    character.lastPlayed = Date.now();
    return { success: true, character };
  }

  /**
   * Get the currently selected character.
   */
  getSelectedCharacter() {
    if (!this.selectedId) return null;
    return this.getCharacter(this.selectedId);
  }

  /**
   * Clear character selection.
   */
  clearSelection() {
    this.selectedId = null;
  }

  // ============================================================
  // Inventory Helpers (integration with InventorySystem)
  // ============================================================

  /**
   * Set inventory data for a character.
   */
  setInventory(id, inventoryData) {
    const character = this.getCharacter(id);
    if (!character) return false;
    character.inventory = inventoryData;
    return true;
  }

  /**
   * Get inventory data for a character.
   */
  getInventory(id) {
    const character = this.getCharacter(id);
    if (!character) return null;
    return [...character.inventory]; // Return copy
  }

  // ============================================================
  // Spawn Point Helpers (integration with SpawnManager)
  // ============================================================

  /**
   * Set spawn point for a character in a world.
   */
  setSpawnPoint(id, worldId, position) {
    const character = this.getCharacter(id);
    if (!character) return false;
    character.spawnPoints[worldId] = { ...position };
    return true;
  }

  /**
   * Get spawn point for a character in a world.
   */
  getSpawnPoint(id, worldId) {
    const character = this.getCharacter(id);
    if (!character) return null;
    return character.spawnPoints[worldId] || null;
  }

  // ============================================================
  // Serialization (for multiplayer sync / save data)
  // ============================================================

  /**
   * Serialize all characters to plain data.
   */
  serialize() {
    return this.characters.map(c => ({
      id: c.id,
      name: c.name,
      color: c.color,
      inventory: c.inventory,
      spawnPoints: c.spawnPoints,
      createdAt: c.createdAt,
      lastPlayed: c.lastPlayed,
    }));
  }

  /**
   * Deserialize characters from plain data.
   */
  deserialize(data) {
    this.characters = data.map(c => ({
      id: c.id,
      name: c.name,
      color: c.color || DEFAULT_COLOR,
      inventory: c.inventory || [],
      spawnPoints: c.spawnPoints || {},
      createdAt: c.createdAt || Date.now(),
      lastPlayed: c.lastPlayed || null,
    }));
  }
}

// ============================================================
// Module Exports (for Node.js testing)
// ============================================================

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CharacterManager, MAX_CHARACTERS, DEFAULT_COLOR, CHARACTER_COLORS };
}
