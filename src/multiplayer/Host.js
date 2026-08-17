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

import { MESSAGE_TYPES } from './Client.js';
import { CuubzLogger } from '../util/Logger.js';
import {
  createQuestState,
  migrateQuestState,
  serializeQuestState,
  applyPooledDelta,
  setSealState,
  addSealContributor,
  peekPendingLoot,
  takePendingLoot,
} from '../game/data/QuestState.js';

// D-82: a `'use strict';` directive stood here, AFTER the imports. Two things were wrong
// with it and both are silent. An ES module is strict mode already, so it could never
// have any effect; and a directive prologue must be the FIRST statement in the body, so
// once imports precede it, it is not a directive at all — it is an expression statement
// evaluating a string literal and discarding it. It read as a guarantee and was a no-op
// twice over. `src/multiplayer/Client.js` carried the identical line.

// Debug logging — set CuubzLogger.DEBUG = true in browser console to enable
// D-27: the `typeof CuubzLogger !== 'undefined'` test and its `else` branch are gone.
// `CuubzLogger` is a module import, so `typeof` was a constant `'function'` and the
// no-op fallback was unreachable. `var` is deliberate: globalCollisions.test.js asserts
// each of these four files declares `^(export )?var <name>` of its own.
export var _hostLog = CuubzLogger.log;

// D-82: this said "Use globals from client.js: CLIENT_STATE, MESSAGE_TYPES (server-side
// only)", which the `import { MESSAGE_TYPES } from './Client.js'` ten lines above
// contradicts outright. Nothing here has come off a global since PR 9 turned the tree
// into ES modules; `MESSAGE_TYPES` is a named import and `CLIENT_STATE` is not used in
// this file at all. A comment that claims a global is not merely stale — it is the exact
// assumption `test/unit/meta/globalCollisions.test.js` exists to stop anyone acting on.

// ─── Constants ──────────────────────────────────────────────────────

export const HOST_STATE = {
  IDLE: 'idle',               // Not hosting
  CONNECTING: 'connecting',   // Connecting to matchmaking
  HOSTING: 'hosting',         // Session created, waiting for players
  ACTIVE: 'active',           // Players connected, game running
  ENDING: 'ending',           // Shutting down session
};

export const DEFAULT_HOST_CONFIG = {
  maxPlayers: 4,
  reachDistance: 6,           // Max blocks a player can interact with
  yMin: 0,                    // World Y bounds (aligned with chunkData.js MIN_Y/MAX_Y)
  yMax: 96,
  moveRateLimit: 20,          // Max movement updates per second per player
  blockChangeCooldown: 100,   // Min ms between block changes from same player
  inventorySyncInterval: 5000,// How often to request inventory sync (ms)
  // Position extrapolation anti-cheat
  extrapolationMaxDeviation: 8,  // Max blocks player can deviate from predicted position
  extrapolationMaxSpeed: 30,     // Max blocks/s (walking ~5, sprinting ~8, falling ~20)
  extrapolationGracePeriod: 2000,// ms after join before extrapolation kicks in
};

// ─── Validation Helpers ─────────────────────────────────────────────

/**
 * Validate block break request from a remote player.
 * Returns { valid, reason } object.
 */
export function validateBlockBreak(playerId, position, x, y, z, config) {
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
export function validateBlockPlace(playerId, position, x, y, z, blockType, config) {
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
export function validateMove(playerId, position, rotation, config) {
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
 * Validate movement using position extrapolation.
 * Predicts where the player should be based on their last known velocity,
 * and rejects positions that deviate too far from the prediction.
 * Returns { valid, reason } object.
 */
export function validateMoveExtrapolation(playerId, player, position, config) {
  const cfg = config || DEFAULT_HOST_CONFIG;
  const now = Date.now();
  const elapsed = now - player.lastMoveTime;

  // Grace period after join — don't extrapolate immediately
  if (elapsed < cfg.extrapolationGracePeriod) {
    return { valid: true };
  }

  // Need at least one previous position to extrapolate
  if (!player._prevPosition || !player._velocity) {
    return { valid: true };
  }

  // Extrapolate expected position from last known velocity
  const dt = elapsed / 1000; // seconds
  const expectedX = player._prevPosition.x + player._velocity.x * dt;
  const expectedY = player._prevPosition.y + player._velocity.y * dt;
  const expectedZ = player._prevPosition.z + player._velocity.z * dt;

  // Calculate deviation from predicted position
  const dx = position.x - expectedX;
  const dy = position.y - expectedY;
  const dz = position.z - expectedZ;
  const deviation = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (deviation > cfg.extrapolationMaxDeviation) {
    return {
      valid: false,
      reason: `Extrapolation deviation ${deviation.toFixed(1)} > ${cfg.extrapolationMaxDeviation} blocks (dt=${dt.toFixed(2)}s)`,
    };
  }

  return { valid: true };
}

/**
 * Validate inventory update from a remote player.
 * Returns { valid, reason } object.
 */
export function validateHostInventory(playerId, inventory) {
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
 * Largest delta one `QUEST_CONTRIBUTE` may carry.
 *
 * A stack is 64 and the tracker polls twice a second, so a legitimate single message
 * cannot exceed one stack's worth of newly-observed items by any normal route. This is a
 * bound on absurdity, not an anti-cheat: a player who genuinely picked up two stacks
 * between polls sends two messages and both are credited. §6.3 — never kick, and a
 * laggy client is not a cheater.
 */
export const MAX_CONTRIBUTION_DELTA = 64;

/**
 * Validate a pooled quest contribution.
 *
 * ─── THIS REPLACED `validateQuestUpdate`, IT DID NOT EXTEND IT ──────────────
 *
 * The old function validated `{ questId, progress: number }` and the old handler stored
 * a monotonic **max** of that number. Pooled objectives (D-Q2, §4.5) need
 * accumulate-a-delta from an identified contributor, which is a different message with
 * different arithmetic: `max` and `+=` disagree about everything the moment two players
 * contribute. Reshaping in place would have left a function whose name said `progress`
 * and whose body meant `delta`.
 *
 * Neither the old validator nor the old handler had a caller — `handleQuestUpdate()` was
 * never registered on the host and `QUEST_UPDATE` was never forwarded by the client, so
 * nothing on either side of the wire ever ran. Nothing depended on the old shape.
 *
 * @param {string} playerId — the sender, as the **relay** attached it (not from the body)
 * @param {object} contribution — `{ questId, objectiveKey, delta, contributorId }`
 * @param {string|null} [expectedContributorId] — the character id the host recorded for
 *   this player on join. When supplied, a mismatch is rejected: a client may contribute
 *   only as itself, or it could inflate another player's high-water mark and, worse,
 *   suppress their real contributions afterwards.
 * @returns {{valid: boolean, reason?: string}}
 */
export function validateQuestContribute(playerId, contribution, expectedContributorId = null) {
  if (!contribution || typeof contribution !== 'object') {
    return { valid: false, reason: 'Invalid contribution format' };
  }

  if (!contribution.questId || typeof contribution.questId !== 'string') {
    return { valid: false, reason: 'Missing or invalid questId' };
  }

  if (!contribution.objectiveKey || typeof contribution.objectiveKey !== 'string') {
    return { valid: false, reason: 'Missing or invalid objectiveKey' };
  }

  const { delta } = contribution;
  if (typeof delta !== 'number' || !Number.isFinite(delta)) {
    return { valid: false, reason: 'Delta must be a finite number' };
  }
  // Strictly positive: the pool is monotonic, so a zero carries no information and a
  // negative one is the only thing that could ever take progress away.
  if (delta <= 0) {
    return { valid: false, reason: 'Delta must be greater than zero' };
  }
  if (delta > MAX_CONTRIBUTION_DELTA) {
    return { valid: false, reason: `Delta exceeds ${MAX_CONTRIBUTION_DELTA}` };
  }

  if (!contribution.contributorId || typeof contribution.contributorId !== 'string') {
    return { valid: false, reason: 'Missing or invalid contributorId' };
  }

  if (expectedContributorId && contribution.contributorId !== expectedContributorId) {
    return { valid: false, reason: 'contributorId does not match the sender' };
  }

  return { valid: true };
}

// ─── Rate Limiter ───────────────────────────────────────────────────

/**
 * Simple rate limiter using token bucket approach.
 * Tracks timestamps of actions per player ID.
 */
export class RateLimiter {
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
export class HostRemotePlayer {
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

    // Position extrapolation anti-cheat state
    this._prevPosition = null;    // Previous authoritative position
    this._prevMoveTime = null;    // Timestamp of previous move
    this._velocity = null;        // Calculated velocity { x, y, z } in blocks/s
  }

  /** Update position from movement data (with velocity tracking for extrapolation) */
  updatePosition(position, rotation) {
    if (position) {
      // Track velocity for extrapolation anti-cheat
      if (this._prevPosition && this._prevMoveTime) {
        const dt = Math.max((Date.now() - this._prevMoveTime) / 1000, 0.016);
        this._velocity = {
          x: (position.x - this._prevPosition.x) / dt,
          y: (position.y - this._prevPosition.y) / dt,
          z: (position.z - this._prevPosition.z) / dt,
        };
      }
      this._prevPosition = { ...this.position };
      this._prevMoveTime = this.lastMoveTime;
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
    const player = new HostRemotePlayer(data.playerId, data.character, data.position);
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
export class HostManager {
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
      blockChanges: [],                    // Log of validated block changes
      // The §4.1 schema, seeded from the host's world config by `seedQuestState()` at
      // session start and written back by `saveWorldState`. Was `questProgress: {}`,
      // a `questId → number` map that disagreed with both of the other two shapes the
      // codebase had for the same idea (§2.1).
      questState: createQuestState(),
    };

    // S2 — the live `QuestSystem`, when there is one. `setQuestSystem` explains why
    // there must not be two quest states on a host.
    this._questSystem = null;

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
    /** S6 — `(playerId, {bossId, damage, origin, direction})`. Set by `BossEncounter`. */
    this.onBossHit = null;
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
        _hostLog(`[HostManager] Session created: ${this._sessionId}`);
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

      // §2.1 — the half of the broken wire path that lived on this side. The host's
      // quest handler existed, was correct enough to call, and had **no caller
      // anywhere in `src/`**: this table is the registration list, and quests were
      // simply not in it. The other half was `Client._setupGameSessionHandlers`, which
      // dropped the type before it could reach here.
      QUEST_CONTRIBUTE: (data) => {
        this._noteActivity(data.playerId);
        this.handleQuestContribute(data.playerId, data);
      },

      // S6 — a client reporting a landed attack. Registered here from S0 so the
      // routing table has one shape and the boss work is a handler body, not a
      // re-plumbing job.
      BOSS_HIT: (data) => {
        this._noteActivity(data.playerId);
        if (this.onBossHit) {
          try {
            this.onBossHit(data.playerId, data);
          } catch (err) {
            console.error('[HostManager] Error in onBossHit:', err.message);
          }
        }
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

    const playerState = new HostRemotePlayer(
      playerId,
      data.character,
      data.position
    );

    this._players.set(playerId, playerState);

    _hostLog(`[HostManager] Player joined: ${playerId} (${data.character?.name || 'Unknown'})`);

    // §5.2 — a joining client holds a *view* of the host's quest state, not a copy, and
    // it has none of it until this arrives. Sent to the joiner alone: everyone else
    // already has it.
    this.broadcastQuestSync(playerId);
    // S12 — a boss they fought may have died while they were away. See the method.
    this.flushPendingLoot(playerId);

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

  /**
   * A message arrived from this player, so they are connected — whatever this class
   * last believed. **D-120.**
   *
   * `_handlePlayerLeft` sets `connected = false`, and every host-side handler guards on
   * that flag. Nothing ever set it back: the relay's `_handleJoin` treats a returning
   * `playerId` as a *reconnection* and deliberately does **not** re-broadcast
   * `PLAYER_JOINED` (it replies `WELCOME` to the reconnector alone, so the other clients
   * do not re-add an avatar they already have). So the host had no signal at all that a
   * dropped player was back, and silently discarded everything they sent for the rest of
   * the session.
   *
   * The relay only forwards from live sockets, so an inbound message *is* the proof:
   * there is no way for one to arrive from a player who is not connected. Flipping the
   * flag here is not a weakened guard — it is the guard finally being given the
   * information it was always missing.
   */
  _noteActivity(playerId) {
    if (!playerId) return;
    const player = this._players.get(playerId);
    if (!player || player.connected) return;
    player.connected = true;
    _hostLog(`[HostManager] Player ${playerId} is active again (reconnected)`);
    if (this.onPlayerJoined) {
      try {
        this.onPlayerJoined({
          playerId,
          character: player.character,
          position: player.position,
          playerCount: this.playerCount,
          reconnected: true,
        });
      } catch (err) {
        console.error('[HostManager] Error in onPlayerJoined callback:', err.message);
      }
    }
    // Their view of the world is whatever they had when the connection dropped, and the
    // quest state may have moved on without them.
    this.broadcastQuestSync(playerId);
    this.flushPendingLoot(playerId);
  }

  /** Handle a player leaving the session */
  _handlePlayerLeft(playerId) {
    if (!playerId) return;

    const player = this._players.get(playerId);
    if (!player) return;

    player.connected = false;
    this._rateLimiter.clearPlayer(playerId);

    _hostLog(`[HostManager] Player left: ${playerId}`);

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

    // Speed validation: reject positions that require impossible velocity
    const now = Date.now();
    const dt = Math.max((now - player.lastMoveTime) / 1000, 0.016); // seconds since last move
    const dx = data.position.x - player.position.x;
    const dy = data.position.y - player.position.y;
    const dz = data.position.z - player.position.z;
    const speed = Math.sqrt(dx * dx + dy * dy + dz * dz) / dt;
    const maxSpeed = this._options.extrapolationMaxSpeed || 30;

    if (speed > maxSpeed) {
      console.warn(`[HostManager] Speed violation from ${playerId}: ${speed.toFixed(1)} > ${maxSpeed} blocks/s`);
      return; // Reject impossible movement
    }

    // Position extrapolation anti-cheat: predict expected position from velocity
    const extrapolationValid = validateMoveExtrapolation(playerId, player, data.position, this._options);
    if (!extrapolationValid.valid) {
      console.warn(`[HostManager] Extrapolation violation from ${playerId}: ${extrapolationValid.reason}`);
      return; // Reject position that deviates too far from prediction
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
        chunkX: Math.floor(data.x / 16),
        chunkZ: Math.floor(data.z / 16),
        validatedBy: 'host',
      });
    }

    // Callback (always fires regardless of connection state)
    if (this.onBlockBreakValidated) {
      try {
        this.onBlockBreakValidated({ 
          playerId, 
          x: data.x, y: data.y, z: data.z,
          chunkX: Math.floor(data.x / 16),
          chunkZ: Math.floor(data.z / 16),
        });
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
        chunkX: Math.floor(data.x / 16),
        chunkZ: Math.floor(data.z / 16),
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
          chunkX: Math.floor(data.x / 16),
          chunkZ: Math.floor(data.z / 16),
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
    const valid = validateHostInventory(playerId, data.inventory);
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

  // ── Quest State (§4.1, §4.5) ──────────────────────────────────

  /**
   * Seed the authoritative quest state from the host's world config at session start.
   *
   * §5.2: progress saves on the **host's** device, in the host's world slot. A world
   * hosted by A and joined by B advances A's copy, and B's device never accumulates a
   * half-finished copy of A's world. Anything unrecognised becomes a fresh state via the
   * migration, so a corrupt blob cannot stop a session from starting.
   */
  seedQuestState(raw) {
    this._worldState.questState = migrateQuestState(raw);
    return this._worldState.questState;
  }

  /** The live authoritative state. Mutable, host-owned — callers must not hand it out. */
  getQuestState() {
    return this._worldState.questState;
  }

  /** A deep copy, budget-collapsed, for storage and for the wire (§4.1). */
  serializeQuestState() {
    return serializeQuestState(this._worldState.questState);
  }

  /**
   * Send the full quest state to one joining player, or to everyone.
   *
   * A late joiner needs the whole thing — pools, seal states, sites and titles — because
   * every one of those affects what their HUD shows and where their markers point. It is
   * a few hundred bytes, once, on join.
   */
  broadcastQuestSync(targetPlayerId = null) {
    if (!this._client || !this._client.isGameSessionConnected) return;
    const msg = {
      type: MESSAGE_TYPES.QUEST_SYNC,
      questState: this.serializeQuestState(),
    };
    if (targetPlayerId) msg.targetPlayers = [targetPlayerId];
    this._broadcast(msg);
  }

  /**
   * Hand a joining player whatever a boss owed them while they were gone (S12, §14).
   *
   * ─── WHY THE HOST IS THE ONE HOLDING IT ─────────────────────────────────────
   *
   * §13 recorded the gap plainly: "a player who fought and disconnected before it died
   * keeps their `brokenBy` entry and gets nothing, because there is nowhere to put it."
   * `questState.pendingLoot` is the somewhere, and it is the host's world's, which is
   * consistent with the ruling Q3 already made about everything else a guest earns — a
   * guest holds a *view*, their contributions live in the host's world keyed on their
   * character id, and they carry nothing home. Pending loot is one more of those.
   *
   * ─── AT MOST ONCE, AND THE WINDOW THAT IS DELIBERATELY LEFT OPEN ────────────
   *
   * The entry is cleared **on a successful send**, not on an acknowledgement. An ack
   * would make delivery at-*least*-once instead: a lost ack means a re-send, and a
   * re-send means duplicated diamonds every time a player's confirmation goes missing.
   * D-117 is this repo's standing lesson about crediting the same thing twice across a
   * reconnect, and the same argument applies to an item grant.
   *
   * So the residual loss window is "the socket died between this write and the client's
   * read" — measured in milliseconds, against the original bug's window of an entire
   * boss fight. And it is only reached at all when `_send` reported success, which is
   * why an unsent message leaves the entry exactly where it was.
   *
   * @param {string} playerId — the relay's per-connection id
   * @returns {boolean} whether anything was sent
   */
  flushPendingLoot(playerId) {
    const player = this._players.get(playerId);
    // Keyed on the **character** id, not the connection: a per-connection `playerId`
    // changes on every reconnect, which is the whole reason D-117 exists.
    const contributorId = player?.character?.id || null;
    if (!contributorId) return false;

    const state = this.getQuestState();
    const owed = peekPendingLoot(state, contributorId);
    if (owed.length === 0) return false;

    if (!this._client || !this._client.isGameSessionConnected) return false;
    this._broadcast({
      type: MESSAGE_TYPES.BOSS_LOOT,
      contributorId,
      loot: owed,
      targetPlayers: [playerId],
    });
    takePendingLoot(state, contributorId);
    _hostLog(`[HostManager] Delivered ${owed.length} pending loot stacks to ${contributorId}`);
    return true;
  }

  /**
   * Attach the live `QuestSystem` (S2).
   *
   * ─── THERE IS ONE QUEST STATE, NOT TWO ────────────────────────────────────
   *
   * `HostManager` has `_worldState.questState` and `initQuests` builds a `QuestSystem`
   * over the world's. On a host those are the *same* fact, and keeping two objects for
   * it would mean the host's pooling and the host player's quest log disagreeing the
   * first time either changed — which is §2.1's original defect wearing a new hat.
   *
   * So the system is the authority and this class defers to it: `_applyContribution`
   * routes through `questSystem.applyDelta`, which is also what runs completion,
   * rewards and the next quest. `_worldState.questState` remains only as the fallback
   * for a `HostManager` constructed without one (the unit tests), and is kept pointing
   * at the same object so `serializeQuestState` works either way.
   */
  setQuestSystem(questSystem) {
    this._questSystem = questSystem || null;
    if (questSystem) this._worldState.questState = questSystem.getState();
  }

  /**
   * Apply one player's pooled contribution, from the relay.
   *
   * The message carries a **delta**, already measured against that contributor's own
   * high-water mark on the sending side (§4.5). Everything untrusted is checked here;
   * the arithmetic is `_applyContribution`, which the host's own gathering also uses.
   *
   * @param {string} playerId — as the relay attached it
   * @param {object} contribution — `{ questId, objectiveKey, delta, contributorId }`
   * @returns {boolean} whether it was applied
   */
  handleQuestContribute(playerId, contribution) {
    const player = this._players.get(playerId);
    if (!player || !player.connected) return false;

    // §6.3 — a client may contribute only as itself. `character.id` is what the player
    // sent on join; if it is absent (an older client) the check is skipped rather than
    // failing closed, because refusing every contribution from a client that predates
    // this field is a worse outcome than the exploit it prevents in a co-op game.
    const expected = player.character?.id || null;
    const valid = validateQuestContribute(playerId, contribution, expected);
    if (!valid.valid) {
      console.warn(`[HostManager] Rejected quest contribution from ${playerId}: ${valid.reason}`);
      return false;
    }

    const rate = this._rateLimiter.check(playerId, 'quest');
    if (!rate.allowed) {
      console.warn(`[HostManager] Quest contribution rate limited: ${playerId}`);
      return false;
    }

    return this._applyContribution(playerId, contribution);
  }

  /**
   * The host's own contribution, arriving by function call instead of by socket.
   *
   * **§6.4, and it is the most important rule in the plan.** The host runs in a browser
   * beside its own inventory and its own tracker, and its gathering has to reach the
   * pool by the same route a guest's does. Not "an equivalent route" — the same one, so
   * that a change to pooling cannot land on one and miss the other. The only thing this
   * skips is the part that is meaningless locally: a connection check on a player who is
   * not in `_players`, an identity check against a socket, and a rate limit on a
   * function call the host makes to itself.
   *
   * The repo's history is a list of what happens when two paths exist for one thing.
   */
  handleLocalQuestContribute(contribution) {
    const valid = validateQuestContribute(this._hostPlayerId, contribution, null);
    if (!valid.valid) {
      console.warn(`[HostManager] Rejected host's own contribution: ${valid.reason}`);
      return false;
    }
    return this._applyContribution(this._hostPlayerId, contribution);
  }

  /**
   * The pooling itself, shared by both entry points.
   *
   * Broadcasts the authoritative pool — `n` and `target`, not the delta — because a
   * client that missed a packet has to be able to catch up from any single message.
   */
  _applyContribution(playerId, contribution) {
    const result = this._questSystem
      ? this._questSystem.applyDelta(
        contribution.questId,
        contribution.objectiveKey,
        contribution.delta,
        contribution.contributorId
      )
      : applyPooledDelta(
        this._worldState.questState,
        contribution.questId,
        contribution.objectiveKey,
        contribution.delta,
        0,
        contribution.contributorId
      );

    if (!result || result.credited <= 0) return false;

    this.broadcastQuestUpdate(contribution.questId, contribution.objectiveKey, result);

    if (this.onQuestUpdated) {
      try {
        this.onQuestUpdated({
          playerId,
          questId: contribution.questId,
          objectiveKey: contribution.objectiveKey,
          contributorId: contribution.contributorId,
          credited: result.credited,
          n: result.n,
          target: result.target,
          complete: result.complete,
        });
      } catch (err) {
        console.error('[HostManager] Error in onQuestUpdated:', err.message);
      }
    }

    return true;
  }

  /**
   * Broadcast the authoritative total for one objective.
   *
   * `QUEST_UPDATE` existed before any of this and had never travelled: the host never
   * registered a handler and the client never forwarded it (§2.1). This is its first
   * real use, and it carries `{ n, target }` — the state, not the change.
   */
  broadcastQuestUpdate(questId, objectiveKey, result) {
    if (!this._client || !this._client.isGameSessionConnected) return;
    this._broadcast({
      type: MESSAGE_TYPES.QUEST_UPDATE,
      questId,
      objectiveKey,
      n: result.n,
      target: result.target,
      complete: result.complete,
    });
  }

  /**
   * Advance a seal and tell everyone. Host-only: `setSealState` refuses to move
   * backwards, so a duplicate or reordered call is a no-op rather than a regression.
   */
  setSeal(sealId, state, contributors = null) {
    // Through the system when there is one: `QuestSystem.setSeal` also satisfies any
    // `seal_state` objective waiting on the transition and opens the finale on the
    // fifth break. Doing it against the raw state here would advance the seal and
    // silently skip both.
    const changed = this._questSystem
      ? this._questSystem.setSeal(sealId, state)
      : setSealState(this._worldState.questState, sealId, state);
    if (!changed) return false;

    const seal = this._worldState.questState.seals[sealId];
    if (Array.isArray(contributors)) {
      for (const id of contributors) addSealContributor(this._worldState.questState, sealId, id);
    }
    if (state === 'broken' && !seal.brokenAt) seal.brokenAt = Date.now();

    if (this._client && this._client.isGameSessionConnected) {
      this._broadcast({
        type: MESSAGE_TYPES.SEAL_UPDATE,
        sealId,
        state,
        brokenBy: [...seal.brokenBy],
        brokenAt: seal.brokenAt,
      });
    }
    return true;
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
      questState: this.serializeQuestState(),
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
