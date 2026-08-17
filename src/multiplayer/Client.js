/**
 * Cuubz — WebSocket Client
 * Handles connections to matchmaking relay and game session servers.
 * Supports both browser (WebSocket) and Node.js (ws library) environments.
 *
 * Features:
 * - Dual connection management (matchmaking + game session)
 * - Message queue with reliable delivery ordering
 * - Heartbeat keepalive with automatic reconnection
 * - Retry logic with exponential backoff
 * - Event-driven architecture for message handling
 */

import { CuubzLogger } from '../util/Logger.js';

// D-82: a `'use strict';` stood here, AFTER the import. An ES module is strict already,
// and a directive prologue must be the first statement in the body — after an import it
// is just a discarded string expression. No-op twice over. Same line, same fix, in
// `src/multiplayer/Host.js`.

// Debug logging — set CuubzLogger.DEBUG = true in browser console to enable
// D-27: the `typeof CuubzLogger !== 'undefined'` test and its `else` branch are gone —
// `CuubzLogger` is a module import, so the fallback was unreachable. `var` is deliberate
// (globalCollisions.test.js asserts `^(export )?var _clientLog`).
export var _clientLog = CuubzLogger.log;

// ─── Constants ──────────────────────────────────────────────────────

export const CLIENT_STATE = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  RECONNECTING: 'reconnecting',
};

export const DEFAULT_CONFIG = {
  heartbeatInterval: 25000,    // Send heartbeat every 25s (server timeout is 120s)
  heartbeatTimeout: 30000,     // Consider dead if no ACK in 30s (survives background throttling)
  maxReconnectAttempts: 10,
  reconnectBaseDelay: 1000,    // 1s base delay
  reconnectMaxDelay: 30000,    // Cap at 30s
  reconnectBackoffFactor: 2,   // Exponential backoff multiplier
  messageQueueSize: 500,       // Max queued messages before dropping oldest
};

// The 24-key `MESSAGE_TYPES` that used to be declared here was one of three copies of
// the protocol — `server/session.js` had a 10-key one, `server/matchmaking.js` had no
// symbol at all and 14 bare strings. All three are now `shared/protocol.js`, whose
// header carries the arithmetic. This is a **plain relative import**: `shared/` is
// inside the Vite project root, so the bundle picks it up with no alias and
// `vite.config.js` did not change.
//
// Re-exported because it was exported from here, and `test/unit/multiplayer/
// multiplayerClient.test.js` and everything else that reached for it still can.
import { MESSAGE_TYPES } from '../../shared/protocol.js';
export { MESSAGE_TYPES };

/**
 * Every event name that belongs to the **matchmaking** socket rather than the game
 * session one. `disconnect` and `stateChange` are connection events, not protocol
 * types, which is why this list is not simply a slice of `MESSAGE_TYPES`.
 *
 * ONE list, deliberately. This was written out three times — twice verbatim in `on()`
 * and `off()`, and a third time, subtly different, in `_setupMatchmakingHandlers()`.
 * D-78 is exactly what that costs: `HOST_REJECTED` reached none of the three, so the
 * relay's refusal arrived on the socket, was never routed, and the lobby sat in
 * "connecting" with nothing on screen. `_setupMatchmakingHandlers` derives its own
 * list from this one below rather than keeping a fourth copy.
 */
export const MATCHMAKING_EVENTS = Object.freeze([
  MESSAGE_TYPES.SESSION_LIST,
  MESSAGE_TYPES.HOST_CREATED,
  MESSAGE_TYPES.HOST_REJECTED,
  MESSAGE_TYPES.JOIN_ACCEPTED,
  MESSAGE_TYPES.JOIN_REJECTED,
  MESSAGE_TYPES.LEFT_LOBBY,
  MESSAGE_TYPES.ERROR,
  MESSAGE_TYPES.WELCOME,
  'disconnect',
  'stateChange',
]);

// ─── Message Queue ──────────────────────────────────────────────────

/**
 * Ordered message queue with bounded size.
 * Oldest messages are dropped when capacity is exceeded.
 */
export class MessageQueue {
  constructor(maxSize = DEFAULT_CONFIG.messageQueueSize) {
    this._queue = [];
    this._maxSize = maxSize;
  }

  /** Add message to the end of the queue */
  enqueue(msg) {
    if (this._queue.length >= this._maxSize) {
      // Drop oldest message to make room
      this._queue.shift();
    }
    this._queue.push({
      data: msg,
      timestamp: Date.now(),
      retryCount: 0,
    });
  }

  /** Remove and return the first message */
  dequeue() {
    return this._queue.shift() || null;
  }

  /** Peek at the first message without removing it */
  peek() {
    return this._queue.length > 0 ? this._queue[0] : null;
  }

  /** Get current queue length */
  get size() {
    return this._queue.length;
  }

  /** Check if queue is empty */
  get isEmpty() {
    return this._queue.length === 0;
  }

  /** Clear all messages */
  clear() {
    this._queue = [];
  }
}

// ─── WebSocket Connection Wrapper ───────────────────────────────────

/**
 * Manages a single WebSocket connection with state tracking,
 * message queuing, heartbeat, and reconnection logic.
 *
 * This class is testable in Node.js by providing a mock WebSocket factory.
 */
export class WSConnection {
  /**
   * @param {object} config
   * @param {string} config.url — WebSocket URL (e.g., ws://host:port)
   * @param {function} config.wsFactory — WebSocket constructor (WebSocket in browser, require('ws') in Node)
   * @param {object} [config.options] — Additional options overriding DEFAULT_CONFIG
   */
  constructor(config) {
    this.url = config.url;
    this._wsFactory = config.wsFactory || null; // Null means no WebSocket available (test mode)
    this._options = Object.assign({}, DEFAULT_CONFIG, config.options || {});

    this._state = CLIENT_STATE.DISCONNECTED;
    this._socket = null;
    this._queue = new MessageQueue(this._options.messageQueueSize);
    this._eventHandlers = {}; // eventType → [callbacks]
    this._reconnectAttempts = 0;
    this._reconnectTimer = null;
    this._heartbeatTimer = null;
    this._heartbeatTimeoutTimer = null;
    this._disposed = false;
  }

  // ── State Accessors ───────────────────────────────────────────

  get state() {
    return this._state;
  }

  get isConnected() {
    return this._state === CLIENT_STATE.CONNECTED;
  }

  get queueSize() {
    return this._queue.size;
  }

  get reconnectAttempts() {
    return this._reconnectAttempts;
  }

  // ── Event System ──────────────────────────────────────────────

  /** Register a handler for a message type */
  on(eventType, callback) {
    if (!this._eventHandlers[eventType]) {
      this._eventHandlers[eventType] = [];
    }
    this._eventHandlers[eventType].push(callback);
  }

  /** Remove a specific handler */
  off(eventType, callback) {
    if (!this._eventHandlers[eventType]) return;
    this._eventHandlers[eventType] = this._eventHandlers[eventType].filter(
      (cb) => cb !== callback
    );
  }

  /** Remove all handlers for an event type */
  removeAllListeners(eventType) {
    delete this._eventHandlers[eventType];
  }

  /** Emit an event to all registered handlers */
  _emit(eventType, data) {
    const handlers = this._eventHandlers[eventType] || [];
    for (const handler of handlers) {
      try {
        handler(data);
      } catch (err) {
        console.error(`[WSConnection] Error in ${eventType} handler:`, err.message);
      }
    }
  }

  // ── Connection Lifecycle ──────────────────────────────────────

  /** Connect to the WebSocket server */
  connect() {
    if (this._disposed) return;
    if (this._state === CLIENT_STATE.CONNECTED || this._state === CLIENT_STATE.CONNECTING) {
      return; // Already connected or connecting
    }

    this._setState(CLIENT_STATE.CONNECTING);

    if (!this._wsFactory) {
      // No WebSocket factory — stay in disconnected state (test mode)
      this._setState(CLIENT_STATE.DISCONNECTED);
      return;
    }

    try {
      this._socket = new this._wsFactory(this.url);

      this._socket.onopen = () => {
        _clientLog(`[WSConnection] Connected to ${this.url}`);
        this._reconnectAttempts = 0; // Reset on successful connection
        this._setState(CLIENT_STATE.CONNECTED);
        this._startHeartbeat();
        this._flushQueue();
      };

      this._socket.onmessage = (event) => {
        try {
          const data = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
          this._handleMessage(data);
        } catch (err) {
          console.error(`[WSConnection] Parse error:`, err.message);
        }
      };

      this._socket.onclose = (event) => {
        _clientLog(`[WSConnection] Disconnected from ${this.url} (${event.code})`);
        this._stopHeartbeat();
        this._setState(CLIENT_STATE.DISCONNECTED);
        this._emit('disconnect', { code: event.code, reason: event.reason });

        // Attempt reconnection if not disposed — check _disposed to prevent reconnect during dispose()
        if (!this._disposed) {
          this._scheduleReconnect();
        }
      };

      this._socket.onerror = (err) => {
        console.error(`[WSConnection] Error on ${this.url}:`, err.message || err);
        this._emit('error', { message: err.message || 'WebSocket error' });
        // Trigger disconnect + reconnect flow so the connection self-heals
        if (!this._disposed && this._state === CLIENT_STATE.CONNECTED) {
          this._stopHeartbeat();
          try { this._socket.close(4000, 'Client error'); } catch (e) {}
          this._socket = null;
          this._setState(CLIENT_STATE.DISCONNECTED);
          if (!this._disposed) {
            this._scheduleReconnect();
          }
        }
      };
    } catch (err) {
      console.error(`[WSConnection] Connection failed:`, err.message);
      this._setState(CLIENT_STATE.DISCONNECTED);
      if (!this._disposed) {
        this._scheduleReconnect();
      }
    }
  }

  /**
   * Disconnect gracefully — sends `LEAVE`, which the relay reads as "this player is
   * done", not "this player blinked".
   *
   * @param {object} [leavePayload] — extra fields merged into the `LEAVE` message, e.g.
   *   `{ sessionId }` for the matchmaking socket.
   */
  disconnect(leavePayload) {
    if (this._disposed) return;

    // Send LEAVE message before closing
    if (this._socket && this._socket.readyState === 1) {
      this._sendRaw(Object.assign({ type: MESSAGE_TYPES.LEAVE }, leavePayload || {}));
    }

    this._closeSocket();
  }

  /**
   * Tear the socket down **without** sending `LEAVE`, for paths that intend to reconnect.
   *
   * D-107. The heartbeat-timeout handler called `disconnect()`, so a socket that had
   * merely gone quiet — a backgrounded tab, a 30 s network stall — announced a
   * deliberate departure to the relay and then reconnected. With `server/session.js` now
   * (correctly) treating an explicit host `LEAVE` as "destroy the session, do not wait",
   * that mislabelling would destroy live games on a hiccup. It was already wrong before:
   * `disconnect()` also calls `_cancelReconnect()`, which zeroes `_reconnectAttempts`, so
   * every heartbeat timeout restarted the backoff at 1 s no matter how many had failed.
   */
  _dropForReconnect() {
    if (this._disposed) return;
    this._closeSocket({ keepReconnectAttempts: true });
  }

  /** Shared socket teardown. */
  _closeSocket(opts = {}) {
    this._stopHeartbeat();
    if (opts.keepReconnectAttempts) {
      if (this._reconnectTimer) {
        clearTimeout(this._reconnectTimer);
        this._reconnectTimer = null;
      }
    } else {
      this._cancelReconnect();
    }

    if (this._socket) {
      try {
        this._socket.close();
      } catch (e) {
        // Already closed
      }
      this._socket = null;
    }

    this._setState(CLIENT_STATE.DISCONNECTED);
  }

  /** Dispose — release all resources, no reconnection */
  dispose() {
    this._disposed = true;
    // Disconnect even though _disposed=true — we need cleanup (close socket, null reference)
    // but the onclose guard checks _disposed to prevent reconnect scheduling
    if (this._socket && this._socket.readyState === 1) {
      this._sendRaw({ type: MESSAGE_TYPES.LEAVE });
    }
    this._stopHeartbeat();
    this._cancelReconnect();

    if (this._socket) {
      try {
        this._socket.close();
      } catch (e) {
        // Already closed
      }
      this._socket = null;
    }

    this._setState(CLIENT_STATE.DISCONNECTED);
    this._queue.clear();
    this._eventHandlers = {};
  }

  // ── Message Sending ───────────────────────────────────────────

  /**
   * Send a message. If connected, sends immediately. Otherwise, queues it.
   * @param {object} msg — Message object with at least a 'type' field
   */
  send(msg) {
    if (this._disposed) return;

    if (!msg || !msg.type) {
      console.warn('[WSConnection] Attempted to send message without type');
      return;
    }

    if (this.isConnected && this._socket) {
      // console.log(`[WS] → ${msg.type}`); // JOIN, CHUNK_DATA, MOVE
      this._sendRaw(msg);
    } else {
      // Queue for delivery when connected
      this._queue.enqueue(msg);
    }
  }

  /** Send raw JSON directly (internal use) */
  _sendRaw(msg) {
    if (!this._socket || this._socket.readyState !== 1) return;
    try {
      this._socket.send(JSON.stringify(msg));
    } catch (err) {
      console.error('[WSConnection] Send failed:', err.message);
    }
  }

  // ── Message Handling ──────────────────────────────────────────

  /** Handle incoming message from server */
  _handleMessage(data) {
    if (!data || !data.type) return;

    // Special handling for heartbeat responses
    if (data.type === MESSAGE_TYPES.HEARTBEAT_ACK) {
      this._clearHeartbeatTimeout();
      return;
    }

    // Debug: log only important messages (not PLAYER_MOVE or INVENTORY_SYNC)
    const label = this.url.includes('/session/') ? '[GAME]' : '[MATCH]';
    if (data.type !== MESSAGE_TYPES.PLAYER_MOVE && data.type !== MESSAGE_TYPES.INVENTORY_SYNC) {
      console.log(`${label} recv: ${data.type}`, data.type === MESSAGE_TYPES.CHUNK_DATA ? `chunk ${data.chunkX},${data.chunkZ}` : JSON.stringify(data).substring(0, 200));
    }

    // Route to event handlers
    this._emit(data.type, data);
  }

  // ── Queue Management ──────────────────────────────────────────

  /** Flush queued messages when connection is re-established */
  _flushQueue() {
    while (!this._queue.isEmpty && this.isConnected) {
      const item = this._queue.dequeue();
      if (item) {
        try {
          this._sendRaw(item.data);
        } catch (err) {
          console.error(`[WSConnection] Queue flush failed:`, err.message);
          // Stop flushing if connection broke mid-flush
          break;
        }
      }
    }
  }

  // ── Heartbeat ─────────────────────────────────────────────────

  /** Start sending periodic heartbeats */
  _startHeartbeat() {
    this._stopHeartbeat(); // Clear any existing timers
    this._scheduleNextHeartbeat();
    // Send heartbeat immediately when returning to foreground
    if (typeof document !== 'undefined') {
      this._visibilityHandler = () => {
        if (!document.hidden && this.isConnected && !this._disposed) {
          _clientLog('[WSConnection] Tab visible — sending heartbeat');
          this._sendRaw({ type: MESSAGE_TYPES.HEARTBEAT });
          this._setHeartbeatTimeout();
        }
      };
      document.addEventListener('visibilitychange', this._visibilityHandler);
    }
  }

  /** Schedule the next heartbeat using setTimeout chain (survives tab throttling) */
  _scheduleNextHeartbeat() {
    if (this._disposed || !this.isConnected) return;
    this._heartbeatTimer = setTimeout(() => {
      if (this.isConnected && !this._disposed) {
        this._sendRaw({ type: MESSAGE_TYPES.HEARTBEAT });
        this._setHeartbeatTimeout();
      }
      // Chain the next heartbeat
      this._scheduleNextHeartbeat();
    }, this._options.heartbeatInterval);
  }

  /** Set timeout for heartbeat response */
  _setHeartbeatTimeout() {
    this._clearHeartbeatTimeout();
    this._heartbeatTimeoutTimer = setTimeout(() => {
      // No heartbeat ACK received — connection may be dead
      console.warn('[WSConnection] Heartbeat timeout — reconnecting');
      if (!this._disposed) {
        this._dropForReconnect(); // NOT disconnect() — see D-107 on that method
        this._scheduleReconnect();
      }
    }, this._options.heartbeatTimeout);
  }

  /** Clear heartbeat timeout */
  _clearHeartbeatTimeout() {
    if (this._heartbeatTimeoutTimer) {
      clearTimeout(this._heartbeatTimeoutTimer);
      this._heartbeatTimeoutTimer = null;
    }
  }

  /** Stop all heartbeat timers */
  _stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearTimeout(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
    this._clearHeartbeatTimeout();
    // Remove visibility listener
    if (typeof document !== 'undefined' && this._visibilityHandler) {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
      this._visibilityHandler = null;
    }
  }

  // ── Reconnection ──────────────────────────────────────────────

  /**
   * Schedule a reconnection attempt with exponential backoff.
   *
   * ─── D-106: `maxReconnectAttempts` HAD NO READER ────────────────────────────
   *
   * `DEFAULT_CONFIG.maxReconnectAttempts = 10` was declared, documented, and never
   * consulted anywhere in this file — so every connection retried forever. That alone is
   * waste; combined with how the matchmaking socket "disabled" its reconnect it was a
   * live fault. `MultiplayerClient.connectMatchmaking()` set
   * `_options.reconnectBaseDelay = 0` and commented it "effectively disables reconnect".
   * It does not: `_calculateReconnectDelay()` floors its result at `Math.max(100, …)`, so
   * a base of 0 yields **100 ms** and a dead matchmaking socket reconnected ten times a
   * second, indefinitely. Each reconnect drew a fresh `WELCOME` with a fresh `playerId`
   * (D-105), which is how a host could stop being recognised as the host of its own
   * session mid-game.
   *
   * `autoReconnect: false` is what "do not reconnect" is spelled as now, and the attempt
   * cap is enforced here.
   */
  _scheduleReconnect() {
    if (this._disposed) return;
    if (this._options.autoReconnect === false) return;
    if (this._reconnectAttempts >= this._options.maxReconnectAttempts) {
      console.warn(`[WSConnection] Giving up on ${this.url} after ${this._reconnectAttempts} attempts`);
      return;
    }

    const delay = this._calculateReconnectDelay();
    this._reconnectAttempts++;

    _clientLog(`[WSConnection] Reconnecting in ${delay}ms (attempt ${this._reconnectAttempts})`);
    this._setState(CLIENT_STATE.RECONNECTING);

    this._reconnectTimer = setTimeout(() => {
      if (!this._disposed && this._state === CLIENT_STATE.RECONNECTING) {
        this.connect();
      }
    }, delay);
  }

  /** Calculate reconnect delay with exponential backoff and jitter */
  _calculateReconnectDelay() {
    const base = this._options.reconnectBaseDelay;
    const factor = this._options.reconnectBackoffFactor;
    const maxDelay = this._options.reconnectMaxDelay;
    const attempts = Math.min(this._reconnectAttempts, 10); // Cap for calculation

    let delay = base * Math.pow(factor, attempts);
    delay = Math.min(delay, maxDelay);

    // Add jitter (±25%) to avoid thundering herd
    const jitter = delay * 0.25 * (Math.random() * 2 - 1);
    return Math.max(100, Math.round(delay + jitter));
  }

  /** Cancel pending reconnection */
  _cancelReconnect() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    this._reconnectAttempts = 0;
  }

  // ── State Management ──────────────────────────────────────────

  /** Update connection state and emit state change event */
  _setState(newState) {
    const oldState = this._state;
    this._state = newState;
    if (oldState !== newState) {
      this._emit('stateChange', { from: oldState, to: newState });
    }
  }

  // ── Convenience Methods for Game Protocol ─────────────────────

  /** Send JOIN message to game session */
  sendJoin(playerId, character, position, rotation) {
    this.send({
      type: MESSAGE_TYPES.JOIN,
      playerId,
      character: character || { name: 'Player', color: '#ffffff' },
      position: position || { x: 0, y: 20, z: 0 },
      rotation: rotation || { yaw: 0, pitch: 0 },
    });
  }

  /** Send MOVE message with player position/rotation */
  sendMove(position, rotation) {
    this.send({
      type: MESSAGE_TYPES.MOVE,
      position: position || { x: 0, y: 0, z: 0 },
      rotation: rotation || { yaw: 0, pitch: 0 },
    });
  }

  /** Send BREAK_BLOCK message */
  sendBreakBlock(x, y, z) {
    this.send({
      type: MESSAGE_TYPES.BREAK_BLOCK,
      x: Math.floor(x),
      y: Math.floor(y),
      z: Math.floor(z),
    });
  }

  /** Send PLACE_BLOCK message */
  sendPlaceBlock(x, y, z, blockType) {
    this.send({
      type: MESSAGE_TYPES.PLACE_BLOCK,
      x: Math.floor(x),
      y: Math.floor(y),
      z: Math.floor(z),
      blockType,
    });
  }

  /** Send INVENTORY_UPDATE message */
  sendInventoryUpdate(inventory) {
    this.send({
      type: MESSAGE_TYPES.INVENTORY_UPDATE,
      inventory,
    });
  }

  /**
   * Send QUEST_CONTRIBUTE — "I have newly gathered `delta` of this objective".
   *
   * A *delta*, not a total. The sender has already compared what it holds against its
   * own high-water mark (§4.5) and this is the difference; the host adds it to the pool
   * and never sees the raw count. The relay overwrites `contributorId`'s companion
   * `playerId` with the sender's real one, but `contributorId` itself is the **character**
   * id, which the host checks against the character it recorded on join.
   */
  sendQuestContribute(questId, objectiveKey, delta, contributorId) {
    this.send({
      type: MESSAGE_TYPES.QUEST_CONTRIBUTE,
      questId,
      objectiveKey,
      delta,
      contributorId,
    });
  }

  /** Send BOSS_HIT — an attack landed, for the host to validate and apply. */
  sendBossHit(bossId, damage, origin, direction) {
    this.send({
      type: MESSAGE_TYPES.BOSS_HIT,
      bossId,
      damage,
      origin,
      direction,
    });
  }

  /**
   * Send HOST message to matchmaking.
   *
   * `maxPlayers` is D-84: the host form read `#host-max-players`, `SessionHosting.js:87`
   * passed it to `hostSession()`, and it stopped there — this method had no such
   * parameter and the message had no such field, so `server/index.js` hard-coded 4 and a
   * host who limited a session to 2 got 4. It is omitted from the payload entirely when
   * the caller does not supply one, so the relay's "missing → default" path is what an
   * old client still gets.
   */
  sendHost(name, worldSeed, mode, maxPlayers) {
    const msg = {
      type: MESSAGE_TYPES.HOST,
      name,
      worldSeed,
      mode: mode || 'survival',
    };
    if (maxPlayers !== undefined && maxPlayers !== null) {
      msg.maxPlayers = maxPlayers;
    }
    this.send(msg);
  }

  /** Send BROWSE message to matchmaking */
  sendBrowse() {
    this.send({ type: MESSAGE_TYPES.BROWSE });
  }

  /** Send JOIN message to matchmaking for a specific session */
  sendJoinSession(sessionId) {
    this.send({
      type: MESSAGE_TYPES.JOIN,
      sessionId,
    });
  }

  /**
   * Tell matchmaking this player is leaving its session, **without closing the socket**.
   *
   * D-108. The lobby is reached through this socket: browse, host and join all send on
   * it. Leaving a session used to close it, which is why the lobby was dead afterwards.
   * `LEAVE` is the message the relay already has for exactly this (server/matchmaking.js
   * clears `sessionId`/`isHost` and leaves the client connected).
   */
  sendLeaveSession(sessionId) {
    const msg = { type: MESSAGE_TYPES.LEAVE };
    if (sessionId) msg.sessionId = sessionId;
    this.send(msg);
  }
}

// ─── Multiplayer Client (High-Level API) ──────────────────────────

/**
 * High-level multiplayer client managing both matchmaking and game session connections.
 *
 * Usage:
 *   const client = new MultiplayerClient({ host: '10.0.30.XXX' });
 *
 *   // Matchmaking flow
 *   client.onMatchmaking('SESSION_LIST', (data) => { ... });
 *   client.browseSessions();
 *   client.joinSession(sessionId); // Automatically connects to game session
 *
 *   // Game session flow
 *   client.onGame('PLAYER_MOVE', (data) => { ... });
 *   client.sendMove(position, rotation);
 */
export class MultiplayerClient {
  /**
   * @param {object} config
   * @param {string} config.host — Server hostname/IP
   * @param {number} [config.matchmakingPort=8765] — Matchmaking relay port
   * @param {function|null} [config.wsFactory=null] — WebSocket constructor (auto-detected if null)
   */
  constructor(config) {
    // Support full URL (e.g., wss://example.com/ws) or host + port combo.
    this._explicitProtocol = null; // Override _getProtocol() when set
    if (config.url) {
      const urlObj = new URL(config.url);
      this.host = urlObj.hostname;
      this._wsPath = urlObj.pathname || '/';
      const protocol = config.url.startsWith('wss') ? 'wss' : 'ws';
      this._explicitProtocol = protocol; // Preserve explicit protocol from URL
      this.matchmakingPort = protocol === 'wss' ? null : parseInt(urlObj.port || '8765', 10);
    } else {
      this.host = config.host;
      this._wsPath = '/';
      this.matchmakingPort = config.matchmakingPort !== undefined ? config.matchmakingPort : null;
    }
    this._wsFactory = config.wsFactory || null;

    // Auto-detect WebSocket factory
    if (!this._wsFactory) {
      if (typeof WebSocket !== 'undefined') {
        this._wsFactory = WebSocket;
      } else if (typeof window !== 'undefined') {
        this._wsFactory = window.WebSocket;
      }
    }

    // Connection state
    this._matchmakingConn = null;
    this._gameSessionConn = null;
    this._currentSessionId = null;
    // Which session `_gameSessionConn` is actually bolted to. Distinct from
    // `_currentSessionId`, which `joinSession()` sets optimistically before the relay has
    // accepted. D-108 uses it to tell "reconnecting to the same session" from "this is a
    // different session now".
    this._connectedGameSessionId = null;
    this._playerId = null;
    this._disposed = false;

    // Queued game join — filled by joinGame() before _gameSessionConn exists,
    // sent automatically once the game session WebSocket connects.
    this._pendingGameJoin = null;

    // Last join data — stored for reconnection. When the WebSocket auto-reconnects
    // after a network blip, we must resend JOIN so the server updates its ws mapping.
    this._lastGameJoin = null;

    // High-level event handlers
    this._matchmakingHandlers = {};
    this._gameHandlers = {};

    // Connection state tracking
    this.state = {
      matchmaking: CLIENT_STATE.DISCONNECTED,
      gameSession: CLIENT_STATE.DISCONNECTED,
    };
  }

  // ── State Accessors ───────────────────────────────────────────

  // Coerced to real booleans: these returned `null` before a connection object
  // existed, which contradicts the `is*` naming and breaks strict comparison and
  // JSON serialization. Every caller uses them for truthiness, so this is a no-op
  // for behaviour.
  get isMatchmakingConnected() {
    return !!(this._matchmakingConn && this._matchmakingConn.isConnected);
  }

  get isGameSessionConnected() {
    return !!(this._gameSessionConn && this._gameSessionConn.isConnected);
  }

  get currentSessionId() {
    return this._currentSessionId;
  }

  get playerId() {
    return this._playerId;
  }

  // ── Matchmaking Event Handlers ────────────────────────────────

  /** Register handler for matchmaking messages */
  onMatchmaking(eventType, callback) {
    if (!this._matchmakingHandlers[eventType]) {
      this._matchmakingHandlers[eventType] = [];
    }
    this._matchmakingHandlers[eventType].push(callback);
  }

  offMatchmaking(eventType, callback) {
    if (!this._matchmakingHandlers[eventType]) return;
    this._matchmakingHandlers[eventType] = this._matchmakingHandlers[eventType].filter(
      (cb) => cb !== callback
    );
  }

  // ── Game Session Event Handlers ───────────────────────────────

  /** Register handler for game session messages */
  onGame(eventType, callback) {
    if (!this._gameHandlers[eventType]) {
      this._gameHandlers[eventType] = [];
    }
    this._gameHandlers[eventType].push(callback);
  }

  offGame(eventType, callback) {
    if (!this._gameHandlers[eventType]) return;
    this._gameHandlers[eventType] = this._gameHandlers[eventType].filter(
      (cb) => cb !== callback
    );
  }

  // ── Generic Event Registration (routes to matchmaking or game) ───────────────────

  /**
   * Generic event registration — auto-routes to matchmaking or game handlers.
   * Used by SessionManager for simple event wiring.
   */
  on(eventType, callback) {
    if (MATCHMAKING_EVENTS.includes(eventType)) {
      this.onMatchmaking(eventType, callback);
    } else {
      this.onGame(eventType, callback);
    }
  }

  off(eventType, callback) {
    if (MATCHMAKING_EVENTS.includes(eventType)) {
      this.offMatchmaking(eventType, callback);
    } else {
      this.offGame(eventType, callback);
    }
  }

  // ── Connection Management ─────────────────────────────────────

  /** Connect to matchmaking relay */
  connectMatchmaking() {
    if (this._disposed || this._matchmakingConn) return;

    try {
      const port = this.matchmakingPort ? `:${this.matchmakingPort}` : '';
      const url = `${this._getProtocol()}://${this.host}${port}/matchmaking`;
      this._matchmakingConn = new WSConnection({
        url,
        wsFactory: this._wsFactory,
      });

      // Wire up matchmaking event handlers
      this._setupMatchmakingHandlers();

      // D-106. This line used to read `_options.reconnectBaseDelay = 0` under the comment
      // "Effectively disables reconnect". It disabled nothing — `_calculateReconnectDelay`
      // floors at 100 ms — and turned a dropped lobby socket into a ten-per-second
      // reconnect storm. The lobby genuinely does want to come back after a blip (browse,
      // host and join all ride this socket), so it keeps the default 1 s → 30 s backoff
      // and the attempt cap `_scheduleReconnect` now honours.
      this._matchmakingConn.connect();
    } catch (err) {
      console.warn(`[MultiplayerClient] Matchmaking unavailable:`, err.message);
      if (this._matchmakingConn) {
        this._matchmakingConn.dispose();
        this._matchmakingConn = null;
      }
    }
  }

  /** Set up internal matchmaking message routing */
  _setupMatchmakingHandlers() {
    if (!this._matchmakingConn) return;

    // Route WELCOME to capture player ID.
    //
    // ─── D-105: THE FIRST `WELCOME` WINS ────────────────────────────────────
    //
    // The relay mints a new `playerId` per matchmaking *connection*
    // (`matchmaking.js:_generatePlayerId`), and this used to overwrite `_playerId` with
    // every one of them. `_playerId` is the identity the **game** socket joins under
    // (`joinGame` → `sendJoin(this._playerId, …)`) and the identity the relay recorded as
    // `hostId` when the session was created — so a matchmaking reconnect mid-session
    // silently renamed the player. For a host that is fatal in a specific, silent way:
    // `session.js:_handleChunkData` compares the sender against `hostId`, so after the
    // rename the host's own chunk streams were rejected as "Non-host sent CHUNK_DATA"
    // and joiners saw an empty world. Under D-106's 100 ms reconnect storm this was not
    // a rare race.
    //
    // The id is therefore taken once and kept for the lifetime of the client, and
    // `setPlayerId()` is the only other way to set it (a rejoin reclaiming its session).
    this._matchmakingConn.on(MESSAGE_TYPES.WELCOME, (data) => {
      if (data.playerId && !this._playerId) {
        this._playerId = data.playerId;
      }
      this._emitMatchmaking(MESSAGE_TYPES.WELCOME, data);
    });

    // Route all other matchmaking events. Derived from MATCHMAKING_EVENTS rather than
    // written out again — a private copy here is how HOST_REJECTED went missing (D-78).
    const sessionEvents = MATCHMAKING_EVENTS.filter((e) => e !== MESSAGE_TYPES.WELCOME);
    for (const eventType of sessionEvents) {
      this._matchmakingConn.on(eventType, (data) => {
        // Auto-connect to game session when join is accepted
        if (eventType === MESSAGE_TYPES.JOIN_ACCEPTED && data.sessionId) {
          this._connectToGameSession(data.sessionId);
        }
        // Auto-connect to game session when host is created
        if (eventType === MESSAGE_TYPES.HOST_CREATED && data.sessionId) {
          this._connectToGameSession(data.sessionId);
        }
        this._emitMatchmaking(eventType, data);
      });
    }
  }

  /** Emit matchmaking event to registered handlers */
  _emitMatchmaking(eventType, data) {
    const handlers = this._matchmakingHandlers[eventType] || [];
    for (const handler of handlers) {
      try {
        handler(data);
      } catch (err) {
        console.error(`[MultiplayerClient] Error in matchmaking ${eventType} handler:`, err.message);
      }
    }
  }

  /**
   * Connect to game session server via path-based routing.
   *
   * D-108. The guard was `if (this._disposed || this._gameSessionConn) return` — any
   * existing game socket, for any session, made this a no-op. Host once, leave, host
   * again in the same page and the second `HOST_CREATED` arrived at a client still bolted
   * to the first session's socket: the new session got a relay entry, no host ever joined
   * it, and it sat in the browse list as a row nobody could enter. Re-entering the
   * **same** session is still a no-op (that is the reconnect path); a **different** one
   * replaces the socket.
   */
  _connectToGameSession(sessionId) {
    if (this._disposed) return;

    if (this._gameSessionConn) {
      if (this._connectedGameSessionId === sessionId) return;
      console.log(`[MP] Switching game session ${this._connectedGameSessionId} → ${sessionId}`);
      try {
        this._gameSessionConn.disconnect();
        this._gameSessionConn.dispose();
      } catch (e) { /* already gone */ }
      this._gameSessionConn = null;
    }
    this._connectedGameSessionId = sessionId;

    console.log(`[MP] Connecting to game session: ${sessionId}`);

    try {
      const port = this.matchmakingPort ? `:${this.matchmakingPort}` : '';
      const url = `${this._getProtocol()}://${this.host}${port}/session/${sessionId}`;
      this._gameSessionConn = new WSConnection({
        url,
        wsFactory: this._wsFactory,
      });

      // Wire up game session event handlers
      this._setupGameSessionHandlers();

      // Send join on initial connection AND on reconnection.
      // On initial connect, _pendingGameJoin holds the queued join data.
      // On reconnect, _lastGameJoin holds the data from the previous joinGame() call
      // so the server can update its WebSocket mapping (the old ws was closed).
      this._gameSessionConn.on('stateChange', (data) => {
        if (data.to === 'connected') {
          if (this._pendingGameJoin) {
            const join = this._pendingGameJoin;
            this._pendingGameJoin = null;
            console.log('[MP] Game session connected — sending queued JOIN');
            this._gameSessionConn.sendJoin(this._playerId, join.character, join.position, join.rotation);
          } else if (this._lastGameJoin) {
            console.log('[MP] Game session reconnected — resending JOIN');
            const join = this._lastGameJoin;
            this._gameSessionConn.sendJoin(this._playerId, join.character, join.position, join.rotation);
          }
        }
      });

      this._gameSessionConn.connect();
    } catch (err) {
      console.error(`[MP] Failed to connect game session:`, err.message);
      if (this._gameSessionConn) {
        this._gameSessionConn.dispose();
        this._gameSessionConn = null;
      }
    }
  }

  /** Set up internal game session message routing */
  _setupGameSessionHandlers() {
    if (!this._gameSessionConn) return;

    // Every type that reaches a game-session handler has to be listed here. It is a
    // whitelist, and a type missing from it is not an error anywhere — the message
    // simply arrives and is dropped, in silence, on every client including the one that
    // sent it. That is exactly what happened to `QUEST_UPDATE`, which was in the
    // protocol and relayed by the server from the day both were written and was in this
    // list until S0 added it (§2.1). The quest, seal and boss types are here in full,
    // including the two that travel *upward* — `QUEST_CONTRIBUTE` and `BOSS_HIT` are
    // relayed to the host, and the host is a client of this class like any other.
    const gameEvents = [
      MESSAGE_TYPES.WELCOME, MESSAGE_TYPES.PLAYER_JOINED, MESSAGE_TYPES.PLAYER_LEFT,
      MESSAGE_TYPES.PLAYER_MOVE, MESSAGE_TYPES.BLOCK_BREAK, MESSAGE_TYPES.BLOCK_PLACE,
      MESSAGE_TYPES.INVENTORY_SYNC, MESSAGE_TYPES.CHUNK_DATA, MESSAGE_TYPES.CHUNK_REQUEST,
      MESSAGE_TYPES.TIME_SYNC,
      MESSAGE_TYPES.QUEST_UPDATE, MESSAGE_TYPES.QUEST_SYNC, MESSAGE_TYPES.QUEST_CONTRIBUTE,
      MESSAGE_TYPES.SEAL_UPDATE,
      MESSAGE_TYPES.BOSS_SPAWN, MESSAGE_TYPES.BOSS_STATE, MESSAGE_TYPES.BOSS_HIT,
      MESSAGE_TYPES.BOSS_DEFEATED, MESSAGE_TYPES.BOSS_DESPAWN, MESSAGE_TYPES.BOSS_LOOT,
      MESSAGE_TYPES.ERROR, 'disconnect', 'stateChange',
    ];
    for (const eventType of gameEvents) {
      this._gameSessionConn.on(eventType, (data) => {
        // Capture session ID from WELCOME
        if (eventType === MESSAGE_TYPES.WELCOME && data.sessionId) {
          this._currentSessionId = data.sessionId;
        }
        this._emitGame(eventType, data);
      });
    }
  }

  /** Emit game event to registered handlers */
  _emitGame(eventType, data) {
    const handlers = this._gameHandlers[eventType] || [];
    for (const handler of handlers) {
      try {
        handler(data);
      } catch (err) {
        console.error(`[MultiplayerClient] Error in game ${eventType} handler:`, err.message);
      }
    }
  }

  /** Determine WebSocket protocol (ws vs wss) */
  _getProtocol() {
    if (this._explicitProtocol) return this._explicitProtocol;
    // Use wss if running on HTTPS, ws otherwise
    if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
      return 'wss';
    }
    return 'ws';
  }

  // ── Matchmaking Actions ───────────────────────────────────────

  /** Browse available sessions */
  browseSessions() {
    if (this._matchmakingConn) {
      this._matchmakingConn.sendBrowse();
    }
  }

  /**
   * Host a new session.
   *
   * @param {string|{name: string, seed: number, mode: string, maxPlayers?: number}} name
   * @param {number} [worldSeed]
   * @param {string} [mode]
   * @param {number} [maxPlayers] — session cap. The relay clamps it; see D-84 on
   *   `sendHost` above for why it used to go no further than this destructure.
   */
  hostSession(name, worldSeed, mode, maxPlayers) {
    if (this._matchmakingConn) {
      // Support both positional args and object param for SessionManager compatibility
      if (typeof name === 'object' && name !== null) {
        // D-84: `maxPlayers` was NOT in this destructure, so `SessionHosting.js`'s
        // fourth property was read off the object by nobody and silently discarded.
        const { name: sessionName, seed, mode: gameMode, maxPlayers: cap } = name;
        this._matchmakingConn.sendHost(sessionName, seed, gameMode, cap);
      } else {
        this._matchmakingConn.sendHost(name, worldSeed, mode, maxPlayers);
      }
    }
  }

  /** Join an existing session by ID */
  joinSession(sessionId) {
    this._currentSessionId = sessionId;
    if (this._matchmakingConn) {
      this._matchmakingConn.sendJoinSession(sessionId);
    }
  }

  // ── Game Session Actions ──────────────────────────────────────

  /** Join game session with player info */
  joinGame(character, position, rotation) {
    // Always store join data for reconnection support
    this._lastGameJoin = { character, position, rotation };

    if (this._gameSessionConn) {
      this._gameSessionConn.sendJoin(this._playerId, character, position, rotation);
    } else {
      // Queue the join — it will be sent when the game session connects
      this._pendingGameJoin = { character, position, rotation };
      console.log('[MultiplayerClient] Queued game join (game session not connected yet)');
    }
  }

  /** Send movement update */
  sendMove(position, rotation) {
    if (this._gameSessionConn) {
      this._gameSessionConn.sendMove(position, rotation);
    }
  }

  /** Break a block */
  breakBlock(x, y, z) {
    if (this._gameSessionConn) {
      this._gameSessionConn.sendBreakBlock(x, y, z);
    }
  }

  /** Place a block */
  placeBlock(x, y, z, blockType) {
    if (this._gameSessionConn) {
      this._gameSessionConn.sendPlaceBlock(x, y, z, blockType);
    }
  }

  /** Send inventory update */
  sendInventory(inventory) {
    if (this._gameSessionConn) {
      this._gameSessionConn.sendInventoryUpdate(inventory);
    }
  }

  /** Contribute a positive delta toward a pooled quest objective (§4.5). */
  sendQuestContribute(questId, objectiveKey, delta, contributorId) {
    if (this._gameSessionConn) {
      this._gameSessionConn.sendQuestContribute(questId, objectiveKey, delta, contributorId);
    }
  }

  /** Report a landed attack on a boss for the host to validate (§6.3). */
  sendBossHit(bossId, damage, origin, direction) {
    if (this._gameSessionConn) {
      this._gameSessionConn.sendBossHit(bossId, damage, origin, direction);
    }
  }

  // ── Disconnect / Dispose ──────────────────────────────────────

  /** Disconnect from all servers, matchmaking included. */
  disconnect() {
    try {
      if (this._matchmakingConn) {
        this._matchmakingConn.disconnect();
        this._matchmakingConn = null;
      }
      if (this._gameSessionConn) {
        this._gameSessionConn.disconnect();
        this._gameSessionConn = null;
      }
    } catch (err) {
      console.error(`[MultiplayerClient] Disconnect error:`, err.message);
    } finally {
      this._currentSessionId = null;
      this._connectedGameSessionId = null;
      this._pendingGameJoin = null;
      this._lastGameJoin = null;
    }
  }

  /**
   * Leave the current session and return to the lobby.
   *
   * ─── D-108 — THIS WAS `disconnect()`, AND THAT IS THE WHOLE BUG ─────────────
   *
   * `leaveSession()` was a one-line alias for `disconnect()`, which closes the
   * **matchmaking** socket and sets `_matchmakingConn = null`. Nothing ever calls
   * `connectMatchmaking()` a second time — `Bootstrap.js:226` runs it once per page load
   * — and every lobby action is guarded on that field:
   *
   *   browseSessions() → `if (this._matchmakingConn)`   … silent no-op
   *   hostSession()    → `if (this._matchmakingConn)`   … silent no-op
   *   joinSession()    → `if (this._matchmakingConn)`   … silent no-op
   *
   * So the first exit-to-menu killed the lobby for the rest of the page, silently and
   * with no error anywhere. That is all three reported symptoms at once: Refresh drew
   * nothing, so `#session-list` kept the rows it had painted before the game started
   * ("duplicates … stale"); clicking one sent no `JOIN` ("cannot actually be entered");
   * and hosting again sent no `HOST`, so the new session never reached the relay
   * ("another one doesn't show up if you create a new one").
   *
   * Leaving a session and leaving the lobby are different things. This one keeps the
   * matchmaking socket, tells the relay with `LEAVE` (which `server/matchmaking.js`
   * already handles), and drops only the game socket.
   */
  leaveSession() {
    const sessionId = this._currentSessionId;
    try {
      if (this._gameSessionConn) {
        // Explicit LEAVE on the game socket — `server/session.js` reads it as a
        // deliberate exit and collects the session immediately rather than holding it
        // for the 30 s reconnect grace. D-103.
        this._gameSessionConn.disconnect();
        this._gameSessionConn.dispose();
        this._gameSessionConn = null;
      }
      if (this._matchmakingConn) {
        this._matchmakingConn.sendLeaveSession(sessionId);
      } else if (!this._disposed) {
        // The socket died at some point during the session — put the lobby back.
        this.connectMatchmaking();
      }
    } catch (err) {
      console.error(`[MultiplayerClient] Leave error:`, err.message);
    } finally {
      this._currentSessionId = null;
      this._connectedGameSessionId = null;
      this._pendingGameJoin = null;
      this._lastGameJoin = null;
    }
  }

  /**
   * Adopt a previously-issued player id, so a reloaded page can reclaim its own seat in
   * a session instead of arriving as a stranger. Paired with D-105's sticky `_playerId`:
   * set before the matchmaking `WELCOME` lands, it is what the relay sees on `JOIN`.
   *
   * @param {string} playerId
   */
  setPlayerId(playerId) {
    if (playerId) this._playerId = playerId;
  }

  /** Dispose — release all resources */
  dispose() {
    this._disposed = true;
    if (this._matchmakingConn) {
      this._matchmakingConn.dispose();
      this._matchmakingConn = null;
    }
    if (this._gameSessionConn) {
      this._gameSessionConn.dispose();
      this._gameSessionConn = null;
    }
    this._connectedGameSessionId = null;
    this._matchmakingHandlers = {};
    this._gameHandlers = {};
  }
}

// ─── Exports ────────────────────────────────────────────────
