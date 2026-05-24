/**
 * Cuubz — Inventory Synchronization System
 *
 * Handles multiplayer inventory sync between host and remote players:
 * - Serialize/deserialize Inventory instances for network transmission
 * - Validate received inventories (no impossible items, valid counts)
 * - Sync lifecycle: initial transfer on join, periodic updates, disconnect save
 * - Server-authoritative validation of inventory state changes
 *
 * Protocol messages:
 *   Client → Host:  { type: 'INVENTORY_UPDATE', playerId, inventory }
 *   Host → Clients: { type: 'INVENTORY_SYNC', playerId, inventory }
 *
 * Testable in Node.js (no browser dependencies).
 */

'use strict';

// ============================================================
// Constants
// ============================================================

/** Valid block type IDs (from Block Type Registry) */
const VALID_BLOCK_IDS = new Set([
  0,   // Air
  1,   // Grass
  2,   // Dirt
  3,   // Stone
  4,   // Sand
  5,   // Gravel
  6,   // Water
  7,   // Wood Log
  8,   // Leaves
  9,   // Snow
  10,  // Ice
  11,  // Bedrock
  12,  // Planks
  13,  // Obsidian
  14,  // Blackstone
  15,  // Lava
  16,  // Corrupt Stone
  17,  // Toxic Slime
  18,  // Coal Ore
  19,  // Iron Ore
  20,  // Gold Ore
  21,  // Diamond Ore
  22,  // Corrupt Crystal
  23,  // Bed
  24,  // Apple
  25,  // Quest Key
  26,  // Boss Spawn
]);

/** Valid named item keys (from inventory.js NAMED_ITEMS) */
const VALID_NAMED_ITEMS = new Set([
  'coal',
  'iron_ore',
  'gold_ore',
  'diamond',
  'corrupt_crystal',
  'apple',
  'cooked_meat',
  'berry',
  'bread',
  'golden_apple',
]);

/** Max stack sizes by category */
const MAX_STACK = {
  block: 64,
  resource: 64,
  food: 16,
  tool: 1,
};

/** Named item categories and max stacks (mirrors inventory.js NAMED_ITEMS) */
const NAMED_ITEM_META = {
  coal:            { category: 'resource', maxStack: 64 },
  iron_ore:        { category: 'resource', maxStack: 64 },
  gold_ore:        { category: 'resource', maxStack: 64 },
  diamond:         { category: 'resource', maxStack: 64 },
  corrupt_crystal: { category: 'resource', maxStack: 1 },
  apple:           { category: 'food',     maxStack: 16 },
  cooked_meat:     { category: 'food',     maxStack: 16 },
  berry:           { category: 'food',     maxStack: 16 },
  bread:           { category: 'food',     maxStack: 16 },
  golden_apple:    { category: 'food',     maxStack: 1 },
};

/** Single-stack block IDs (quest items, special blocks) */
const SINGLE_STACK_BLOCKS = new Set([22, 25, 26]); // Corrupt Crystal, Quest Key, Boss Spawn

/** Default inventory dimensions */
const DEFAULT_INVENTORY_ROWS = 4;
const DEFAULT_INVENTORY_COLS = 9;
const DEFAULT_TOTAL_SLOTS = 36;

// ============================================================
// Pure Utility Functions (Testable without classes)
// ============================================================

/**
 * Determine the category of a typeId.
 * @param {*} typeId — number (block ID) or string (named item)
 * @returns {string} 'block', 'resource', 'food', or 'tool'
 */
function getItemCategory(typeId) {
  if (typeof typeId === 'string') {
    const meta = NAMED_ITEM_META[typeId];
    return meta ? meta.category : 'resource';
  }
  return 'block';
}

/**
 * Get the max stack size for a given typeId.
 * @param {*} typeId — number or string
 * @returns {number}
 */
function getMaxStackSize(typeId) {
  if (typeof typeId === 'string') {
    const meta = NAMED_ITEM_META[typeId];
    return meta ? meta.maxStack : MAX_STACK.resource;
  }
  // Block items: special single-stack blocks
  if (SINGLE_STACK_BLOCKS.has(typeId)) return 1;
  return MAX_STACK.block;
}

/**
 * Check if a typeId is valid (known block or named item).
 * @param {*} typeId
 * @returns {boolean}
 */
function isValidTypeId(typeId) {
  if (typeof typeId === 'number') {
    return VALID_BLOCK_IDS.has(typeId);
  }
  if (typeof typeId === 'string') {
    return VALID_NAMED_ITEMS.has(typeId);
  }
  return false;
}

/**
 * Validate a single inventory slot.
 * Returns { valid, reason } object.
 */
function validateSlot(slot) {
  if (slot === null || slot === undefined) {
    return { valid: true }; // Empty slots are valid
  }

  if (typeof slot !== 'object' || Array.isArray(slot)) {
    return { valid: false, reason: 'Slot is not an object' };
  }

  const typeId = slot.typeId;
  if (typeId === undefined || typeId === null) {
    return { valid: false, reason: 'Missing typeId' };
  }

  if (!isValidTypeId(typeId)) {
    return { valid: false, reason: `Unknown typeId: ${typeId}` };
  }

  // Air (block 0) should never be in inventory
  if (typeId === 0) {
    return { valid: false, reason: 'Air cannot be stored' };
  }

  const count = slot.count;
  if (typeof count !== 'number' || !Number.isFinite(count) || count < 1) {
    return { valid: false, reason: `Invalid count: ${count}` };
  }

  const maxStack = getMaxStackSize(typeId);
  if (count > maxStack) {
    return { valid: false, reason: `Count ${count} exceeds max stack ${maxStack} for ${typeId}` };
  }

  return { valid: true };
}

/**
 * Validate a complete inventory array.
 * Returns { valid, errors } where errors is an array of per-slot issues.
 */
function validateInventory(slots, maxSlots) {
  const limit = maxSlots || DEFAULT_TOTAL_SLOTS;
  if (!Array.isArray(slots)) {
    return { valid: false, errors: ['Inventory is not an array'] };
  }

  if (slots.length > limit * 2) {
    return { valid: false, errors: [`Too many slots: ${slots.length} > ${limit * 2}`] };
  }

  const errors = [];
  for (let i = 0; i < slots.length; i++) {
    const result = validateSlot(slots[i]);
    if (!result.valid) {
      errors.push(`Slot ${i}: ${result.reason}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Serialize an Inventory instance (or slots array) to a compact network format.
 * Output: { slots: [...], selectedHotbarSlot: number }
 * Slots are transmitted as-is — each non-null entry is { typeId, count }.
 */
function serializeInventory(slots, selectedHotbarSlot) {
  // If passed an Inventory-like object with .slots, extract it
  if (slots && typeof slots === 'object' && Array.isArray(slots.slots)) {
    return {
      slots: [...slots.slots],
      selectedHotbarSlot: slots.selectedHotbarSlot !== undefined
        ? slots.selectedHotbarSlot
        : (selectedHotbarSlot ?? 0),
    };
  }

  // Plain array
  return {
    slots: Array.isArray(slots) ? [...slots] : [],
    selectedHotbarSlot: selectedHotbarSlot ?? 0,
  };
}

/**
 * Deserialize a network inventory payload into a slots array.
 * Returns { slots: [...], selectedHotbarSlot: number }
 */
function deserializeInventory(data) {
  if (!data || typeof data !== 'object') {
    return { slots: [], selectedHotbarSlot: 0 };
  }

  const slots = Array.isArray(data.slots) ? data.slots : [];
  const selectedHotbarSlot = typeof data.selectedHotbarSlot === 'number'
    ? data.selectedHotbarSlot
    : 0;

  return { slots, selectedHotbarSlot };
}

/**
 * Compute a diff between two inventory states.
 * Returns an array of changes: { index, oldSlot, newSlot }
 * Only includes slots that actually changed (for bandwidth efficiency).
 */
function computeInventoryDiff(oldSlots, newSlots) {
  const changes = [];
  const maxLen = Math.max(oldSlots.length, newSlots.length);

  for (let i = 0; i < maxLen; i++) {
    const oldSlot = i < oldSlots.length ? oldSlots[i] : null;
    const newSlot = i < newSlots.length ? newSlots[i] : null;

    if (!slotsEqual(oldSlot, newSlot)) {
      changes.push({ index: i, oldSlot, newSlot });
    }
  }

  return changes;
}

/**
 * Apply a diff to an inventory state.
 * @param {Array} slots — Current inventory slots
 * @param {Array} changes — Output from computeInventoryDiff
 * @returns {Array} Updated slots array
 */
function applyInventoryDiff(slots, changes) {
  const result = [...slots];

  for (const change of changes) {
    if (change.newSlot === null || change.newSlot === undefined) {
      // Clear the slot
      result[change.index] = null;
    } else {
      result[change.index] = { ...change.newSlot };
    }
  }

  return result;
}

/**
 * Deep equality check for two inventory slots.
 */
function slotsEqual(a, b) {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  return a.typeId === b.typeId && a.count === b.count;
}

/**
 * Count total items of a given type across all slots.
 */
function countItemInSlots(slots, typeId) {
  let total = 0;
  for (const slot of slots) {
    if (slot && slot.typeId === typeId) {
      total += slot.count;
    }
  }
  return total;
}

/**
 * Check if inventory contains a specific item type.
 */
function hasItemInSlots(slots, typeId) {
  return countItemInSlots(slots, typeId) > 0;
}

// ============================================================
// InventorySync Class (Client-Side Sync Manager)
// ============================================================

/**
 * InventorySync — Manages the sync lifecycle for a player's inventory.
 *
 * Usage:
 *   const inv = new Inventory(); // from inventory.js
 *   const sync = new InventorySync(inv, { playerId: 'abc123' });
 *
 *   // On join: send full inventory to host
 *   const payload = sync.createJoinPayload();
 *   client.sendInventoryUpdate(payload);
 *
 *   // On receiving INVENTORY_SYNC from host: apply authoritative state
 *   sync.applyRemoteSync(data.playerId, data.inventory);
 *
 *   // Periodic diff-based sync
 *   const diff = sync.createDiffPayload();
 *   if (diff.changes.length > 0) {
 *     client.sendInventoryUpdate(diff);
 *   }
 */
class InventorySync {
  /**
   * @param {object|null} inventory — Inventory instance or null for testing
   * @param {object} options
   * @param {string} [options.playerId] — Local player ID
   * @param {number} [options.syncIntervalMs] — Milliseconds between periodic syncs (default: 5000)
   */
  constructor(inventory, options = {}) {
    this._inventory = inventory || null;
    this._playerId = options.playerId || 'local';
    this._syncIntervalMs = options.syncIntervalMs || 5000;

    // Track last synced state for diff computation
    this._lastSyncedSlots = null;
    this._lastSyncTime = 0;

    // Pending changes since last sync
    this._pendingChanges = [];

    // Callbacks (set by caller)
    this.onSyncComplete = null;
    this.onSyncError = null;
    this.onInventoryInvalid = null;

    // Sync timer handle (for periodic sync)
    this._syncTimer = null;

    // Remote player inventories: playerId → { slots, lastUpdated }
    this._remoteInventories = new Map();
  }

  // ── State Accessors ───────────────────────────────────────

  /** Get current inventory slots */
  getSlots() {
    if (this._inventory && Array.isArray(this._inventory.slots)) {
      return this._inventory.slots;
    }
    return [];
  }

  /** Check if a sync is due based on interval */
  isSyncDue() {
    return (Date.now() - this._lastSyncTime) >= this._syncIntervalMs;
  }

  /** Number of pending changes since last sync */
  get pendingChangesCount() {
    return this._pendingChanges.length;
  }

  /** Get tracked remote player IDs */
  get remotePlayerIds() {
    return Array.from(this._remoteInventories.keys());
  }

  // ── Join Flow ─────────────────────────────────────────────

  /**
   * Create the initial inventory payload to send on join.
   * Sends full inventory state so host has authoritative copy.
   * Returns { type, playerId, inventory: { slots, selectedHotbarSlot } }
   */
  createJoinPayload() {
    const data = serializeInventory(this.getSlots());
    return {
      type: 'INVENTORY_UPDATE',
      playerId: this._playerId,
      inventory: data,
    };
  }

  /**
   * Process the host's INVENTORY_SYNC response after join.
   * The host may reject invalid items — apply authoritative state.
   */
  handleJoinResponse(data) {
    if (!data || !data.inventory) return false;

    const result = validateInventory(data.inventory.slots);
    if (!result.valid) {
      if (this.onSyncError) {
        this.onSyncError({ reason: 'Invalid inventory from host', errors: result.errors });
      }
      return false;
    }

    // Apply host-validated inventory to local state
    this._applySlots(data.inventory.slots, data.inventory.selectedHotbarSlot);
    this._lastSyncedSlots = [...data.inventory.slots];
    this._lastSyncTime = Date.now();
    this._pendingChanges = [];

    if (this.onSyncComplete) {
      this.onSyncComplete({ type: 'join', playerId: this._playerId });
    }

    return true;
  }

  // ── Periodic Sync ─────────────────────────────────────────

  /**
   * Compute diff-based sync payload. Returns null if no changes.
   */
  createDiffPayload() {
    const currentSlots = this.getSlots();
    if (!this._lastSyncedSlots) {
      // No previous sync — send full inventory
      return this.createJoinPayload();
    }

    const changes = computeInventoryDiff(this._lastSyncedSlots, currentSlots);
    if (changes.length === 0) return null;

    return {
      type: 'INVENTORY_UPDATE',
      playerId: this._playerId,
      inventory: {
        slots: currentSlots,
        selectedHotbarSlot: this._inventory ? this._inventory.selectedHotbarSlot : 0,
      },
      changes, // Diff for bandwidth-efficient sync
    };
  }

  /**
   * Start periodic sync timer. Call createDiffPayload() at intervals.
   * Returns the interval ID for manual cleanup.
   */
  startPeriodicSync(syncCallback) {
    if (this._syncTimer) return this._syncTimer;

    this._syncTimer = setInterval(() => {
      try {
        const payload = this.createDiffPayload();
        if (payload && syncCallback) {
          syncCallback(payload);
        }
      } catch (err) {
        if (this.onSyncError) {
          this.onSyncError({ reason: 'Periodic sync error', error: err.message });
        }
      }
    }, this._syncIntervalMs);

    return this._syncTimer;
  }

  /** Stop periodic sync timer */
  stopPeriodicSync() {
    if (this._syncTimer) {
      clearInterval(this._syncTimer);
      this._syncTimer = null;
    }
  }

  // ── Remote Inventory Tracking ─────────────────────────────

  /**
   * Apply an INVENTORY_SYNC message received from the host about a remote player.
   * @param {string} playerId — The remote player whose inventory is syncing
   * @param {object} inventoryData — { slots, selectedHotbarSlot }
   */
  applyRemoteSync(playerId, inventoryData) {
    if (!playerId || !inventoryData) return false;

    const result = validateInventory(inventoryData.slots);
    if (!result.valid) {
      if (this.onInventoryInvalid) {
        this.onInventoryInvalid({ playerId, errors: result.errors });
      }
      return false;
    }

    this._remoteInventories.set(playerId, {
      slots: inventoryData.slots,
      selectedHotbarSlot: inventoryData.selectedHotbarSlot || 0,
      lastUpdated: Date.now(),
    });

    return true;
  }

  /** Get a remote player's inventory snapshot */
  getRemoteInventory(playerId) {
    const entry = this._remoteInventories.get(playerId);
    if (!entry) return null;

    return {
      slots: [...entry.slots],
      selectedHotbarSlot: entry.selectedHotbarSlot,
      lastUpdated: entry.lastUpdated,
    };
  }

  /** Remove a remote player's inventory tracking */
  removeRemoteInventory(playerId) {
    return this._remoteInventories.delete(playerId);
  }

  // ── Disconnect / Save Flow ────────────────────────────────

  /**
   * Create a save payload for persisting on disconnect.
   * Returns the full inventory state for IndexedDB storage.
   */
  createSavePayload() {
    return serializeInventory(this.getSlots());
  }

  /**
   * Restore inventory from a saved state (on reconnect or load).
   */
  restoreFromSave(savedData) {
    if (!savedData || !Array.isArray(savedData.slots)) return false;

    const result = validateInventory(savedData.slots);
    if (!result.valid) {
      if (this.onSyncError) {
        this.onSyncError({ reason: 'Invalid saved inventory', errors: result.errors });
      }
      return false;
    }

    this._applySlots(savedData.slots, savedData.selectedHotbarSlot);
    this._lastSyncedSlots = [...savedData.slots];
    this._lastSyncTime = Date.now();
    this._pendingChanges = [];

    return true;
  }

  // ── Internal Methods ──────────────────────────────────────

  /** Apply slot data to the local inventory instance */
  _applySlots(slots, selectedHotbarSlot) {
    if (!this._inventory || !Array.isArray(this._inventory.slots)) return;

    const inv = this._inventory;
    for (let i = 0; i < Math.min(slots.length, inv.totalSlots); i++) {
      inv.slots[i] = slots[i] ? { ...slots[i] } : null;
    }

    if (typeof selectedHotbarSlot === 'number' && inv.selectHotbarSlot) {
      inv.selectHotbarSlot(selectedHotbarSlot);
    }
  }

  /** Clean up resources */
  dispose() {
    this.stopPeriodicSync();
    this._remoteInventories.clear();
    this._lastSyncedSlots = null;
    this._pendingChanges = [];
    this.onSyncComplete = null;
    this.onSyncError = null;
    this.onInventoryInvalid = null;
  }
}

// ============================================================
// InventoryValidator (Server-Side Host Validator)
// ============================================================

/**
 * InventoryValidator — Server-authoritative inventory validation for the host.
 *
 * The host uses this to validate inventory state from remote players,
 * ensuring no cheating (impossible items, inflated counts, etc.).
 */
class InventoryValidator {
  constructor(options = {}) {
    // Player inventories: playerId → { slots, lastUpdated }
    this._playerInventories = new Map();

    // Strict mode: reject any item not in the known registry
    this._strictMode = options.strictMode !== false;

    // Callbacks
    this.onValidationFailed = null;
  }

  /** Check if a player's inventory is registered */
  hasPlayer(playerId) {
    return this._playerInventories.has(playerId);
  }

  /** Register/initialize a player's inventory on join */
  registerPlayer(playerId, slots) {
    const result = validateInventory(slots);
    if (!result.valid) {
      // Sanitize: remove invalid items
      const sanitized = this._sanitizeSlots(slots);
      this._playerInventories.set(playerId, {
        slots: sanitized,
        lastUpdated: Date.now(),
      });

      if (this.onValidationFailed) {
        this.onValidationFailed({ playerId, errors: result.errors, sanitized: true });
      }
      return { accepted: false, sanitized: true, errors: result.errors };
    }

    this._playerInventories.set(playerId, {
      slots: [...slots],
      lastUpdated: Date.now(),
    });

    return { accepted: true, sanitized: false };
  }

  /**
   * Validate a block break against the player's inventory.
   * Checks: can the result fit in the inventory? (creative mode bypasses this)
   */
  validateBlockBreak(playerId, dropTypeId, creativeMode) {
    if (creativeMode) return { valid: true }; // Creative mode: unlimited

    const entry = this._playerInventories.get(playerId);
    if (!entry) return { valid: false, reason: 'Player not registered' };

    // Check if inventory has space for the drop
    const slots = entry.slots;
    const maxStack = getMaxStackSize(dropTypeId);

    // First: check if we can stack onto existing slots
    for (const slot of slots) {
      if (slot && slot.typeId === dropTypeId && slot.count < maxStack) {
        return { valid: true }; // Can stack
      }
    }

    // Second: check for empty slots
    const hasEmptySlot = slots.some(s => s === null);
    return { valid: hasEmptySlot };
  }

  /**
   * Validate a block place against the player's inventory.
   * Checks: does the player have the required block in their selected slot?
   */
  validateBlockPlace(playerId, blockTypeId, selectedHotbarSlot) {
    const entry = this._playerInventories.get(playerId);
    if (!entry) return { valid: false, reason: 'Player not registered' };

    // Calculate global hotbar index (row 3 of a 4-row inventory)
    const hotbarStart = 27; // (4-1) * 9
    const globalIndex = hotbarStart + (selectedHotbarSlot || 0);

    const slot = entry.slots[globalIndex];
    if (!slot) return { valid: false, reason: 'Selected slot is empty' };

    if (slot.typeId !== blockTypeId) {
      return { valid: false, reason: `Selected item (${slot.typeId}) != placed block (${blockTypeId})` };
    }

    return { valid: true };
  }

  /**
   * Process an inventory update from a remote player.
   * Validates and stores the updated state.
   */
  processInventoryUpdate(playerId, inventoryData) {
    const result = validateInventory(inventoryData.slots);
    if (!result.valid) {
      if (this._strictMode) {
        // Strict: reject and sanitize
        const sanitized = this._sanitizeSlots(inventoryData.slots);
        this._playerInventories.set(playerId, {
          slots: sanitized,
          lastUpdated: Date.now(),
        });

        if (this.onValidationFailed) {
          this.onValidationFailed({ playerId, errors: result.errors, sanitized: true });
        }

        return { accepted: false, sanitized: true, errors: result.errors };
      }
    }

    // Store validated state
    this._playerInventories.set(playerId, {
      slots: [...inventoryData.slots],
      lastUpdated: Date.now(),
    });

    return { accepted: true, sanitized: false };
  }

  /** Get authoritative inventory for a player */
  getPlayerInventory(playerId) {
    const entry = this._playerInventories.get(playerId);
    if (!entry) return null;
    return { slots: [...entry.slots], lastUpdated: entry.lastUpdated };
  }

  /** Remove a player's inventory on disconnect */
  unregisterPlayer(playerId) {
    // Return the last known inventory for save purposes
    const entry = this._playerInventories.get(playerId);
    if (entry) {
      const saveData = { slots: [...entry.slots] };
      this._playerInventories.delete(playerId);
      return saveData;
    }
    return null;
  }

  /** Get all registered player IDs */
  getPlayerIds() {
    return Array.from(this._playerInventories.keys());
  }

  /** Sanitize an inventory by removing invalid items */
  _sanitizeSlots(slots) {
    if (!Array.isArray(slots)) return [];
    return slots.map(slot => {
      if (slot === null || slot === undefined) return null;
      const result = validateSlot(slot);
      if (!result.valid) return null; // Remove invalid slot
      return { typeId: slot.typeId, count: slot.count };
    });
  }

  /** Clean up */
  dispose() {
    this._playerInventories.clear();
    this.onValidationFailed = null;
  }
}

// ============================================================
// Exports (Node.js / browser compatible)
// ============================================================

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    // Constants
    VALID_BLOCK_IDS,
    VALID_NAMED_ITEMS,
    MAX_STACK,
    NAMED_ITEM_META,
    SINGLE_STACK_BLOCKS,
    DEFAULT_INVENTORY_ROWS,
    DEFAULT_INVENTORY_COLS,
    DEFAULT_TOTAL_SLOTS,
    // Pure functions
    getItemCategory,
    getMaxStackSize,
    isValidTypeId,
    validateSlot,
    validateInventory,
    serializeInventory,
    deserializeInventory,
    computeInventoryDiff,
    applyInventoryDiff,
    slotsEqual,
    countItemInSlots,
    hasItemInSlots,
    // Classes
    InventorySync,
    InventoryValidator,
  };
}
