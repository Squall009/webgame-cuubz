/**
 * Cuubz — Host Logic (Client-Side Authoritative Host)
 *
 * The host player acts as the authoritative game server within a multiplayer session.
 * Responsibilities:
 * - Register session with matchmaking relay
 * - Validate all block changes, inventory updates, and quest progress from remote players
 * - Broadcast validated state changes to all connected clients
 * - Handle player disconnect/reconnect gracefully
 * - Maintain server-authoritative world state on the host client
 *
 * Architecture:
 *   Remote Player → Game Session WS → Relay Server → Host Client (this module)
 *   Host validates → broadcasts back through relay → all other players
 *
 * Testable in Node.js (no browser dependencies).
 */

'use strict';

// Re-export from client.js for protocol consistency
const { CLIENT_STATE, MESSAGE_TYPES } = require('./client');

// ─── Constants ──────────────────────────────────────────────────────

const HOST_STATE = {
  IDLE: 'idle',               // Not hosting
  CONNECTING: 'connecting',   // Connecting to matchmaking
  HOSTING: 'hosting',         // Session created, waiting for players
  ACTIVE: 'active',           // Players connected, game running
  ENDING: 'ending',           // Shutting down session
};

const DEFAULT_HOST_CONFIG = {
  maxPlayers: 4,
  reachDistance: 6,           // Max blocks a player can interact with
  yMin: -32,                  // World Y bounds
  yMax: 64,
  moveRateLimit: 20,          // Max movement updates per second per player
  blockChangeCooldown: 100,   // Min ms between block changes from same player
  inventorySyncInterval: 5000,// How often to request inventory sync (ms)
};

// ─── Validation Helpers ─────────────────────────────────────────────

/**
 * Validate block break request from a remote player.
 * Returns { valid, reason } object.
 */
function validateBlockBreak(playerId, position, x, y, z, config) {
  const cfg = config || DEFAULT_HOST_CONFIG;

  // Integer coordinates
  if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) {
    return { valid: false, reason: 'Non-integer coordinates' };
  }

  // Y bounds check
  if (y < cfg.yMin || y > cfg.yMax) {
    return { valid: false, reason: `Y out of bounds (${cfg.yMin}-${cfg.yMax})` };
  }

  // Distance check from player position
  if (position && typeof position.x === 'number') {
    const dx = x - Math.floor(position.x);
    const dy = y - Math.floor(position.y);
    const dz = z - Math.floor(position.z);
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (dist > cfg.reachDistance) {
      return { valid: false, reason: `Too far away (${dist.toFixed(1)} > ${cfg.reachDistance})` };
    }
  }

  return { valid: true };
}

/**
 * Validate block place request from a remote player.
 * Returns { valid, reason } object.
 */
function validateBlockPlace(playerId, position, x, y, z, blockType, config) {
  const cfg = config || DEFAULT_HOST_CONFIG;

  // Integer coordinates
  if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) {
    return { valid: false, reason: 'Non-integer coordinates' };
  }

  // Y bounds check
  if (y < cfg.yMin || y > cfg.yMax) {
    return { valid: false, reason: `Y out of bounds (${cfg.yMin}-${cfg.yMax})` };
  }

  // Block type validation
  if (blockType === undefined || blockType === null || blockType < 0) {
    return { valid: false, reason: 'Invalid block type' };
  }

  // Distance check from player position
  if (position && typeof position.x === 'number') {
    const dx = x - Math.floor(position.x);
    const dy = y - Math.floor(position.y);
    const dz = z - Math.floor(position.z);
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (dist > cfg.reachDistance) {
      return { valid: false, reason: `Too far away (${dist.toFixed(1)} > ${cfg.reachDistance})` };
    }
  }

  return { valid: true };
}

/**
 * Validate movement data from a remote player.
 * Returns { valid, reason } object.
 */
function validateMove(playerId, position, rotation, config) {
  const cfg = config || DEFAULT_HOST_CONFIG;

  if (!position) {
    return { valid: false, reason: 'Missing position' };
  }

  // Position must have numeric x, y, z
  if (typeof position.x !== 'number' || typeof position.y !== 'number' || typeof position.z !== 'number') {
    return { valid: false, reason: 'Non-numeric position' };
  }

  // Y bounds (allow slight tolerance for movement in progress)
  if (position.y < cfg.yMin - 2 || position.y > cfg.yMax + 2) {
    return { valid: false, reason: `Y out of acceptable range (${cfg.yMin - 2}-${cfg.yMax + 2})` };
  }

  // Rotation validation (if provided)
  if (rotation) {
    if (typeof rotation.yaw !== 'number' || typeof rotation.pitch !== 'number') {
      return { valid: false, reason: 'Non-numeric rotation' };
    }
    // Clamp pitch to reasonable range (-π/2 to π/2)
    if (rotation.pitch < -Math.PI / 2 - 0.1 || rotation.pitch > Math.PI / 2 + 0.1) {
      return { valid: false, reason: 'Pitch out of range' };
    }
  }

  return { valid: true };
}

/**
 * Validate inventory update from a remote player.
 * Returns { valid, reason } object.
 */
function validateInventory(playerId, inventory) {
  if (!inventory || !Array.isArray(inventory)) {
    return { valid: false, reason: 'Invalid inventory format' };
  }

  // Standard inventory is 36 slots (9x4 grid)
  if (inventory.length > 100) {
    return { valid: false, reason: 'Inventory too large (>100 slots)' };
  }

  // Each slot should be null or an object with type/count
  for (let i = 0; i < inventory.length; i++) {
    const slot = inventory[i];
    if (slot === null || slot === undefined) continue;

    if (typeof slot !== 'object') {
      return { valid: false, reason: `Slot ${i} is not an object` };
    }

    if (slot.type === undefined && slot.blockType === undefined) {
      return { valid: false, reason: `Slot ${i} missing type/blockType` };
    }

    const count = slot.count || 1;
    if (typeof count !== 'number' || count < 0 || count > 9999) {
      return { valid: false, reason: `Slot ${i} has invalid count: ${count}` };
    }
  }

  return { valid: true };
}

/**
 * Validate quest progress update.
 * Returns { valid, reason } object.
 */
function validateQuestUpdate(playerId, questUpdate) {
  if (!questUpdate || typeof questUpdate !== 'object') {
    return { valid: false, reason: 'Invalid quest update format' };
  }

  // Must have questId and progress
  if (!questUpdate.questId || typeof questUpdate.questId !== 'string') {
    return { valid: false, reason: 'Missing or invalid questId' };
  }

  if (questUpdate.progress === undefined) {
    return { valid: false, reason: 'Missing progress value' };
  }

  // Progress must be non-negative number
  if (typeof questUpdate.progress !== 'number' || questUpdate.progress < 0) {
    return { valid: false, reason: 'Progress must be a non-negative number' };
  }

  return { valid: true };
}

// ─── Rate Limiter ───────────────────────────────────────────────────

/**
 * Simple rate limiter using token bucket approach.
 * Tracks timestamps of actions per player ID.
 */
class RateLimiter {
  constructor(maxRate = 20, windowMs = 1000) {
    this._maxRate = maxRate;
    this._windowMs = windowMs;
    this._timestamps = new Map(); // playerId → [timestamps]
  }

  /**
   * Check if an action from a player is within rate limits.
   * Returns { allowed, retryAfter } object.
   */
  check(playerId, actionType) {
    const key = `${playerId}:${actionType}`;
    const now = Date.now();
    const windowStart = now - this._windowMs;

    if (!this._timestamps.has(key)) {
      this._timestamps.set(key, []);
    }

    const timestamps = this._timestamps.get(key);

    // Remove old timestamps outside the window
    while (timestamps.length > 0 && timestamps[0] < windowStart) {
      timestamps.shift();
    }

    if (timestamps.length >= this._maxRate) {
      const retryAfter = timestamps[0] + this._windowMs - now;
      return { allowed: false, retryAfter: Math.max(0, retryAfter) };
    }

    // Record this action
    timestamps.push(now);
    return { allowed: true };
  }

  /** Clear rate limit data for a player */
  clearPlayer(playerId) {
    const keysToDelete = [];
    for (const key of this._timestamps.keys()) {
      if (key.startsWith(`${playerId}:`)) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      this._timestamps.delete(key);
    }
  }

  /** Clear all rate limit data */
  clear() {
    this._timestamps.clear();
  }
}

// ─── Player State Tracker ────────────────────────────────────────────

/**
 * Tracks state for a remote player in the host session.
 */
class RemotePlayerState {
  constructor(playerId, character, position) {
    this.playerId = playerId;
    this.character = character || { name: 'Player', color: '#ffffff' };
    this.position = position || { x: 0, y: 20, z: 0 };
    this.rotation = { yaw: 0, pitch: 0 };
    this.inventory = [];
    this.lastMoveTime = Date.now();
    this.lastBlockChangeTime = 0;
    this.connected = true;
    this.joinedAt = Date.now();
  }

  /** Update position from movement data */
  updatePosition(position, rotation) {
    if (position) {
      this.position = { ...position };
    }
    if (rotation) {
      this.rotation = { ...rotation };
    }
    this.lastMoveTime = Date.now();
  }

  /** Get state summary for broadcasting */
  getStateSummary() {
    return {
      playerId: this.playerId,
      character: this.character,
      position: { ...this.position },
      rotation: { ...this.rotation },
    };
  }

  /** Serialize for persistence */
  serialize() {
    return {
      playerId: this.playerId,
      character: this.character,
      position: this.position,
      rotation: this.rotation,
      inventory: this.inventory,
      joinedAt: this.joinedAt,
    };
  }

  /** Deserialize from persistence */
  static deserialize(data) {
    const player = new RemotePlayerState(data.playerId, data.character, data.position);
    player.rotation = data.rotation || { yaw: 0, pitch: 0 };
    player.inventory = data.inventory || [];
    player.joinedAt = data.joinedAt || Date.now();
    return player;
  }
}

// ─── Host Manager (Main Class) ──────────────────────────────────────

/**
 * HostManager — Client-side authoritative host for multiplayer sessions.
 *
 * Usage:
 *   const host = new HostManager({ client, character });
 *   host.startSession('My World', 12345, 'survival');
 *   // Handle events via callbacks
 *   host.onPlayerJoined = (data) => { ... };
 *   host.onBlockBreak = (data) => { ... };
 */
class HostManager {
  /**
   * @param {object} config
   * @param {MultiplayerClient|null} [config.client] — The MultiplayerClient instance (optional for testing)
   * @param {object} [config.character] — Host's character data
   * @param {object} [config.options] — Options overriding DEFAULT_HOST_CONFIG
   */
  constructor(config = {}) {
    this._client = config.client || null;
    this._character = config.character || { name: 'Host', color: '#ffffff' };
    this._options = Object.assign({}, DEFAULT_HOST_CONFIG, config.options || {});

    // Host state
    this._state = HOST_STATE.IDLE;
    this._sessionId = null;
    this._hostPlayerId = null;
    this._mode = 'survival';

    // Remote players: playerId → RemotePlayerState
    this._players = new Map();

    // World state (server-authoritative on host)
    this._worldState = {
      blockChanges: [],       // Log of validated block changes
      questProgress: {},      // questId → progress value
    };

    // Rate limiting
    this._rateLimiter = new RateLimiter(
      this._options.moveRateLimit,
      1000
    );

    // Event callbacks (set by caller)
    this.onPlayerJoined = null;
    this.onPlayerLeft = null;
    this.onBlockBreakValidated = null;
    this.onBlockPlaceValidated = null;
    this.onInventorySynced = null;
    this.onQuestUpdated = null;
    this.onError = null;

    // Internal message handlers for game session events
    this._gameHandlers = {};
  }

  // ── State Accessors ───────────────────────────────────────────

  get state() {
    return this._state;
  }

  get sessionId() {
    return this._sessionId;
  }

  get hostPlayerId() {
    return this._hostPlayerId;
  }

  get playerCount() {
    let count = 0;
    for (const [, player] of this._players) {
      if (player.connected) count++;
    }
    return count + (this._state === HOST_STATE.ACTIVE ? 1 : 0); // +1 for host
  }

  get maxPlayers() {
    return this._options.maxPlayers;
  }

  get mode() {
    return this._mode;
  }

  /** Get list of all connected players (host + remote) */
  getPlayerList() {
    const list = [];

    // Add host
    if (this._state === HOST_STATE.ACTIVE || this._state === HOST_STATE.HOSTING) {
      list.push({
        playerId: this._hostPlayerId,
        character: this._character,
        isHost: true,
      });
    }

    // Add remote players
    for (const [, player] of this._players) {
      if (player.connected) {
        const summary = player.getStateSummary();
        summary.isHost = false;
        list.push(summary);
      }
    }

    return list;
  }

  /** Get remote player state by ID */
  getRemotePlayer(playerId) {
    return this._players.get(playerId) || null;
  }

  // ── Session Lifecycle ────────────────────────────────────────

  /**
   * Start hosting a new session.
   * Registers with matchmaking relay and waits for players.
   */
  startSession(name, worldSeed, mode) {
    if (this._state !== HOST_STATE.IDLE) {
      return false;
    }

    this._setState(HOST_STATE.CONNECTING);
    this._mode = mode || 'survival';

    // Set up game session event handlers before connecting
    this._setupGameHandlers();

    // Connect to matchmaking via client
    if (this._client) {
      // Register for matchmaking events
      this._client.onMatchmaking('HOST_CREATED', (data) => {
        this._sessionId = data.sessionId;
        this._setState(HOST_STATE.HOSTING);
        console.log(`[HostManager] Session created: ${this._sessionId}`);
      });

      this._client.onMatchmaking('ERROR', (data) => {
        this._setState(HOST_STATE.IDLE);
        this._emitError('Failed to create session: ' + (data.message || 'Unknown error'));
      });

      // Connect and host
      this._client.connectMatchmaking();
      this._client.hostSession(name, worldSeed, mode);
    } else {
      // No client — simulate hosting for testing
      this._sessionId = 'test_session';
      this._hostPlayerId = 'host_player';
      this._setState(HOST_STATE.ACTIVE);
    }

    return true;
  }

  /**
   * End the current session and clean up.
   */
  endSession() {
    if (this._state === HOST_STATE.IDLE) return;

    this._setState(HOST_STATE.ENDING);

    // Disconnect all remote players
    for (const [, player] of this._players) {
      player.connected = false;
    }

    // Disconnect client
    if (this._client) {
      this._client.disconnect();
    }

    // Clear state
    this._sessionId = null;
    this._hostPlayerId = null;
    this._players.clear();
    this._worldState.blockChanges = [];
    this._rateLimiter.clear();

    this._setState(HOST_STATE.IDLE);
  }

  /**
   * Dispose — release all resources permanently.
   */
  dispose() {
    this.endSession();
    this._gameHandlers = {};
  }

  // ── Game Session Event Setup ──────────────────────────────────

  /** Set up internal game session message routing */
  _setupGameHandlers() {
    if (!this._client) return;

    const handlers = {
      WELCOME: (data) => {
        this._hostPlayerId = data.playerId || this._hostPlayerId;
        this._sessionId = data.sessionId || this._sessionId;
        // Transition to active state once in game session
        if (this._state === HOST_STATE.HOSTING) {
          this._setState(HOST_STATE.ACTIVE);
        }
      },

      PLAYER_JOINED: (data) => {
        this._handlePlayerJoined(data);
      },

      PLAYER_LEFT: (data) => {
        this._handlePlayerLeft(data.playerId);
      },

      PLAYER_MOVE: (data) => {
        this._handlePlayerMove(data);
      },

      BLOCK_BREAK: (data) => {
        // This is from relay — host validates and re-broadcasts
        this._handleRemoteBlockBreak(data);
      },

      BLOCK_PLACE: (data) => {
        this._handleRemoteBlockPlace(data);
      },

      INVENTORY_SYNC: (data) => {
        this._handleInventorySync(data);
      },
    };

    for (const [eventType, handler] of Object.entries(handlers)) {
      this._client.onGame(eventType, handler);
    }
  }

  // ── Player Event Handlers ─────────────────────────────────────

  /** Handle a player joining the session */
  _handlePlayerJoined(data) {
    const playerId = data.playerId;
    if (!playerId || typeof playerId !== 'string') return;

    // Don't create state for host
    if (playerId === this._hostPlayerId) return;

    // Don't duplicate existing players
    if (this._players.has(playerId)) return;

    const playerState = new RemotePlayerState(
      playerId,
      data.character,
      data.position
    );

    this._players.set(playerId, playerState);

    console.log(`[HostManager] Player joined: ${playerId} (${data.character?.name || 'Unknown'})`);

    // Callback
    if (this.onPlayerJoined) {
      try {
        this.onPlayerJoined({
          playerId,
          character: data.character,
          position: data.position,
          playerCount: this.playerCount,
        });
      } catch (err) {
        console.error('[HostManager] Error in onPlayerJoined callback:', err.message);
      }
    }
  }

  /** Handle a player leaving the session */
  _handlePlayerLeft(playerId) {
    if (!playerId) return;

    const player = this._players.get(playerId);
    if (!player) return;

    player.connected = false;
    this._rateLimiter.clearPlayer(playerId);

    console.log(`[HostManager] Player left: ${playerId}`);

    // Callback
    if (this.onPlayerLeft) {
      try {
        this.onPlayerLeft({ playerId, playerCount: this.playerCount });
      } catch (err) {
        console.error('[HostManager] Error in onPlayerLeft callback:', err.message);
      }
    }
  }

  // ── Movement Handling ─────────────────────────────────────────

  /** Handle movement update from a remote player */
  _handlePlayerMove(data) {
    const playerId = data.playerId;
    if (!playerId) return;

    const player = this._players.get(playerId);
    if (!player || !player.connected) return;

    // Rate limit check
    const rateCheck = this._rateLimiter.check(playerId, 'move');
    if (!rateCheck.allowed) {
      console.warn(`[HostManager] Move rate limited: ${playerId}`);
      return;
    }

    // Validate movement data
    const valid = validateMove(
      playerId,
      data.position,
      data.rotation,
      this._options
    );

    if (!valid.valid) {
      console.warn(`[HostManager] Invalid move from ${playerId}: ${valid.reason}`);
      return;
    }

    // Update player state (server-authoritative on host)
    player.updatePosition(data.position, data.rotation);
  }

  // ── Block Change Handling ─────────────────────────────────────

  /** Handle block break request from a remote player */
  _handleRemoteBlockBreak(data) {
    const playerId = data.playerId || 'unknown';
    const player = this._players.get(playerId);

    if (!player || !player.connected) return;

    // Block change cooldown check
    const now = Date.now();
    if (now - player.lastBlockChangeTime < this._options.blockChangeCooldown) {
      console.warn(`[HostManager] Block break too fast: ${playerId}`);
      return;
    }

    // Validate block break
    const valid = validateBlockBreak(
      playerId,
      player.position,
      data.x,
      data.y,
      data.z,
      this._options
    );

    if (!valid.valid) {
      console.warn(`[HostManager] Invalid block break from ${playerId}: ${valid.reason}`);
      // Send rejection back through client (if connected)
      if (this._client && this._client.isGameSessionConnected) {
        this._broadcast({
          type: MESSAGE_TYPES.ERROR,
          message: `Block break rejected: ${valid.reason}`,
          targetPlayerId: playerId,
        });
      }
      return;
    }

    // Accept and log the change (server-authoritative)
    player.lastBlockChangeTime = now;
    this._worldState.blockChanges.push({
      type: 'BREAK',
      x: data.x,
      y: data.y,
      z: data.z,
      playerId,
      timestamp: now,
    });

    // Broadcast validated break to all players (if connected)
    if (this._client && this._client.isGameSessionConnected) {
      this._broadcast({
        type: MESSAGE_TYPES.BLOCK_BREAK,
        x: data.x,
        y: data.y,
        z: data.z,
        blockType: 0, // AIR
        validatedBy: 'host',
      });
    }

    // Callback (always fires regardless of connection state)
    if (this.onBlockBreakValidated) {
      try {
        this.onBlockBreakValidated({ playerId, x: data.x, y: data.y, z: data.z });
      } catch (err) {
        console.error('[HostManager] Error in onBlockBreakValidated:', err.message);
      }
    }
  }

  /** Handle block place request from a remote player */
  _handleRemoteBlockPlace(data) {
    const playerId = data.playerId || 'unknown';
    const player = this._players.get(playerId);

    if (!player || !player.connected) return;

    // Block change cooldown check
    const now = Date.now();
    if (now - player.lastBlockChangeTime < this._options.blockChangeCooldown) {
      console.warn(`[HostManager] Block place too fast: ${playerId}`);
      return;
    }

    // Validate block place
    const valid = validateBlockPlace(
      playerId,
      player.position,
      data.x,
      data.y,
      data.z,
      data.blockType,
      this._options
    );

    if (!valid.valid) {
      console.warn(`[HostManager] Invalid block place from ${playerId}: ${valid.reason}`);
      // Send rejection back through client (if connected)
      if (this._client && this._client.isGameSessionConnected) {
        this._broadcast({
          type: MESSAGE_TYPES.ERROR,
          message: `Block place rejected: ${valid.reason}`,
          targetPlayerId: playerId,
        });
      }
      return;
    }

    // Accept and log the change (server-authoritative)
    player.lastBlockChangeTime = now;
    this._worldState.blockChanges.push({
      type: 'PLACE',
      x: data.x,
      y: data.y,
      z: data.z,
      blockType: data.blockType,
      playerId,
      timestamp: now,
    });

    // Broadcast validated place to all players (if connected)
    if (this._client && this._client.isGameSessionConnected) {
      this._broadcast({
        type: MESSAGE_TYPES.BLOCK_PLACE,
        x: data.x,
        y: data.y,
        z: data.z,
        blockType: data.blockType,
        validatedBy: 'host',
      });
    }

    // Callback (always fires regardless of connection state)
    if (this.onBlockPlaceValidated) {
      try {
        this.onBlockPlaceValidated({
          playerId,
          x: data.x,
          y: data.y,
          z: data.z,
          blockType: data.blockType,
        });
      } catch (err) {
        console.error('[HostManager] Error in onBlockPlaceValidated:', err.message);
      }
    }
  }

  // ── Inventory Handling ────────────────────────────────────────

  /** Handle inventory sync from a remote player */
  _handleInventorySync(data) {
    const playerId = data.playerId;
    if (!playerId) return;

    const player = this._players.get(playerId);
    if (!player || !player.connected) return;

    // Validate inventory
    const valid = validateInventory(playerId, data.inventory);
    if (!valid.valid) {
      console.warn(`[HostManager] Invalid inventory from ${playerId}: ${valid.reason}`);
      return;
    }

    // Update player inventory state
    player.inventory = [...data.inventory];

    // Callback
    if (this.onInventorySynced) {
      try {
        this.onInventorySynced({ playerId, inventory: data.inventory });
      } catch (err) {
        console.error('[HostManager] Error in onInventorySynced:', err.message);
      }
    }
  }

  /**
   * Request inventory sync from a specific player.
   */
  requestInventorySync(playerId) {
    if (!this._client || !this._client.isGameSessionConnected) return;

    // Send empty INVENTORY_UPDATE to trigger client sync response
    this._broadcast({
      type: MESSAGE_TYPES.INVENTORY_SYNC,
      playerId: 'host',
      inventory: null,
      request: true,
    });
  }

  // ── Quest Progress Handling ───────────────────────────────────

  /**
   * Handle quest progress update from a player.
   * Validates and stores in world state (shared by all players).
   */
  handleQuestUpdate(playerId, questUpdate) {
    const player = this._players.get(playerId);
    if (!player || !player.connected) return false;

    // Validate quest update
    const valid = validateQuestUpdate(playerId, questUpdate);
    if (!valid.valid) {
      console.warn(`[HostManager] Invalid quest update from ${playerId}: ${valid.reason}`);
      return false;
    }

    // Store in world state (quest progress lives with the world)
    const current = this._worldState.questProgress[questUpdate.questId] || 0;
    if (questUpdate.progress > current) {
      this._worldState.questProgress[questUpdate.questId] = questUpdate.progress;
    }

    // Broadcast to all players
    if (this._client && this._client.isGameSessionConnected) {
      this._broadcast({
        type: MESSAGE_TYPES.QUEST_UPDATE,
        questId: questUpdate.questId,
        progress: questUpdate.progress,
        updatedBy: playerId,
      });
    }

    // Callback
    if (this.onQuestUpdated) {
      try {
        this.onQuestUpdated({
          playerId,
          questId: questUpdate.questId,
          progress: questUpdate.progress,
        });
      } catch (err) {
        console.error('[HostManager] Error in onQuestUpdated:', err.message);
      }
    }

    return true;
  }

  /** Get current quest progress for all quests */
  getQuestProgress() {
    return { ...this._worldState.questProgress };
  }

  // ── Broadcasting ──────────────────────────────────────────────

  /** Broadcast a message through the game session connection */
  _broadcast(message) {
    if (this._client && this._client.isGameSessionConnected) {
      // Use internal send method of the game session connection
      // The relay server will handle distribution to all players
      try {
        this._client._gameSessionConn?.send(message);
      } catch (err) {
        console.error('[HostManager] Broadcast failed:', err.message);
      }
    }
  }

  /** Emit error event */
  _emitError(message) {
    if (this.onError) {
      try {
        this.onError({ message });
      } catch (err) {
        console.error('[HostManager] Error callback threw:', err.message);
      }
    }
  }

  // ── State Management ──────────────────────────────────────────

  /** Update host state */
  _setState(newState) {
    this._state = newState;
  }

  /** Get full host state summary for debugging/HUD */
  getStateSummary() {
    return {
      state: this._state,
      sessionId: this._sessionId,
      hostPlayerId: this._hostPlayerId,
      mode: this._mode,
      playerCount: this.playerCount,
      maxPlayers: this.maxPlayers,
      players: Array.from(this._players.values()).map((p) => p.getStateSummary()),
      blockChangesLog: this._worldState.blockChanges.length,
      questProgress: this.getQuestProgress(),
    };
  }

  // ── Server-Authoritative Actions (Host Initiated) ─────────────

  /**
   * Host initiates a block break (for host's own actions).
   * This bypasses validation since the host is authoritative.
   */
  hostBreakBlock(x, y, z) {
    this._worldState.blockChanges.push({
      type: 'BREAK',
      x,
      y,
      z,
      playerId: this._hostPlayerId,
      timestamp: Date.now(),
    });

    if (this._client && this._client.isGameSessionConnected) {
      this._broadcast({
        type: MESSAGE_TYPES.BLOCK_BREAK,
        x,
        y,
        z,
        blockType: 0,
        validatedBy: 'host',
      });
    }
  }

  /**
   * Host initiates a block place.
   */
  hostPlaceBlock(x, y, z, blockType) {
    this._worldState.blockChanges.push({
      type: 'PLACE',
      x,
      y,
      z,
      blockType,
      playerId: this._hostPlayerId,
      timestamp: Date.now(),
    });

    if (this._client && this._client.isGameSessionConnected) {
      this._broadcast({
        type: MESSAGE_TYPES.BLOCK_PLACE,
        x,
        y,
        z,
        blockType,
        validatedBy: 'host',
      });
    }
  }

  /**
   * Kick a player from the session.
   */
  kickPlayer(playerId) {
    const player = this._players.get(playerId);
    if (!player) return false;

    player.connected = false;
    this._rateLimiter.clearPlayer(playerId);

    // Broadcast removal
    if (this._client && this._client.isGameSessionConnected) {
      this._broadcast({
        type: MESSAGE_TYPES.PLAYER_LEFT,
        playerId,
        reason: 'kicked_by_host',
      });
    }

    if (this.onPlayerLeft) {
      try {
        this.onPlayerLeft({ playerId, playerCount: this.playerCount, kicked: true });
      } catch (err) {
        console.error('[HostManager] Error in kick callback:', err.message);
      }
    }

    return true;
  }
}

// ─── Exports ──────────────────────────────────────────────────────

module.exports = {
  HOST_STATE,
  DEFAULT_HOST_CONFIG,
  // Validation functions (exported for testing)
  validateBlockBreak,
  validateBlockPlace,
  validateMove,
  validateInventory,
  validateQuestUpdate,
  // Utility classes
  RateLimiter,
  RemotePlayerState,
  // Main class
  HostManager,
};
