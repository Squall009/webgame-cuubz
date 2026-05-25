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

'use strict';

// Debug logging — set CuubzLogger.DEBUG = true in browser console to enable
const _log = typeof CuubzLogger !== 'undefined' ? CuubzLogger.log : function() {};

// ─── Constants ──────────────────────────────────────────────────────

const CLIENT_STATE = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  RECONNECTING: 'reconnecting',
};

const DEFAULT_CONFIG = {
  heartbeatInterval: 15000,    // Send heartbeat every 15s (server expects within 30s)
  heartbeatTimeout: 5000,      // Consider dead if no response in 5s
  maxReconnectAttempts: 10,
  reconnectBaseDelay: 1000,    // 1s base delay
  reconnectMaxDelay: 30000,    // Cap at 30s
  reconnectBackoffFactor: 2,   // Exponential backoff multiplier
  messageQueueSize: 500,       // Max queued messages before dropping oldest
};

// Message types matching server protocol (session.js + matchmaking.js)
const MESSAGE_TYPES = {
  // Client → Server (Game Session)
  JOIN: 'JOIN',
  LEAVE: 'LEAVE',
  MOVE: 'MOVE',
  BREAK_BLOCK: 'BREAK_BLOCK',
  PLACE_BLOCK: 'PLACE_BLOCK',
  INVENTORY_UPDATE: 'INVENTORY_UPDATE',
  QUEST_UPDATE: 'QUEST_UPDATE',
  HEARTBEAT: 'HEARTBEAT',

  // Client → Server (Matchmaking)
  HOST: 'HOST',
  BROWSE: 'BROWSE',

  // Server → Client (Game Session)
  WELCOME: 'WELCOME',
  PLAYER_JOINED: 'PLAYER_JOINED',
  PLAYER_LEFT: 'PLAYER_LEFT',
  PLAYER_MOVE: 'PLAYER_MOVE',
  BLOCK_BREAK: 'BLOCK_BREAK',
  BLOCK_PLACE: 'BLOCK_PLACE',
  INVENTORY_SYNC: 'INVENTORY_SYNC',
  CHUNK_DATA: 'CHUNK_DATA',

  // Server → Client (Matchmaking)
  HOST_CREATED: 'HOST_CREATED',
  SESSION_LIST: 'SESSION_LIST',
  JOIN_ACCEPTED: 'JOIN_ACCEPTED',
  JOIN_REJECTED: 'JOIN_REJECTED',
  LEFT_LOBBY: 'LEFT_LOBBY',

  // Error handling
  ERROR: 'ERROR',
};

// ─── Message Queue ──────────────────────────────────────────────────

/**
 * Ordered message queue with bounded size.
 * Oldest messages are dropped when capacity is exceeded.
 */
class MessageQueue {
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
class WSConnection {
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
        _log(`[WSConnection] Connected to ${this.url}`);
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
        _log(`[WSConnection] Disconnected from ${this.url} (${event.code})`);
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

  /** Disconnect gracefully */
  disconnect() {
    if (this._disposed) return;

    // Send LEAVE message before closing
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
    if (data.type === 'HEARTBEAT_ACK') {
      this._clearHeartbeatTimeout();
      return;
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
    this._heartbeatTimer = setInterval(() => {
      if (this.isConnected && !this._disposed) {
        this._sendRaw({ type: MESSAGE_TYPES.HEARTBEAT });
        this._setHeartbeatTimeout();
      }
    }, this._options.heartbeatInterval);
  }

  /** Set timeout for heartbeat response */
  _setHeartbeatTimeout() {
    this._clearHeartbeatTimeout();
    this._heartbeatTimeoutTimer = setTimeout(() => {
      // No heartbeat ACK received — connection may be dead
      console.warn('[WSConnection] Heartbeat timeout — reconnecting');
      if (!this._disposed) {
        this.disconnect();
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
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
    this._clearHeartbeatTimeout();
  }

  // ── Reconnection ──────────────────────────────────────────────

  /** Schedule a reconnection attempt with exponential backoff */
  _scheduleReconnect() {
    if (this._disposed) return;

    const delay = this._calculateReconnectDelay();
    this._reconnectAttempts++;

    _log(`[WSConnection] Reconnecting in ${delay}ms (attempt ${this._reconnectAttempts})`);
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

  /** Send HOST message to matchmaking */
  sendHost(name, worldSeed, mode) {
    this.send({
      type: MESSAGE_TYPES.HOST,
      name,
      worldSeed,
      mode: mode || 'survival',
    });
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
class MultiplayerClient {
  /**
   * @param {object} config
   * @param {string} config.host — Server hostname/IP
   * @param {number} [config.matchmakingPort=8765] — Matchmaking relay port
   * @param {function|null} [config.wsFactory=null] — WebSocket constructor (auto-detected if null)
   */
  constructor(config) {
    this.host = config.host;
    this.matchmakingPort = config.matchmakingPort || 8765;
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
    this._playerId = null;
    this._disposed = false;

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

  get isMatchmakingConnected() {
    return this.state.matchmaking === CLIENT_STATE.CONNECTED;
  }

  get isGameSessionConnected() {
    return this.state.gameSession === CLIENT_STATE.CONNECTED;
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

  // ── Connection Management ─────────────────────────────────────

  /** Connect to matchmaking relay */
  connectMatchmaking() {
    if (this._disposed || this._matchmakingConn) return;

    try {
      const url = `${this._getProtocol()}://${this.host}:${this.matchmakingPort}`;
      this._matchmakingConn = new WSConnection({
        url,
        wsFactory: this._wsFactory,
      });

      // Wire up matchmaking event handlers
      this._setupMatchmakingHandlers();

      this._matchmakingConn.connect();
    } catch (err) {
      console.error(`[MultiplayerClient] Failed to connect matchmaking:`, err.message);
      if (this._matchmakingConn) {
        this._matchmakingConn.dispose();
        this._matchmakingConn = null;
      }
    }
  }

  /** Set up internal matchmaking message routing */
  _setupMatchmakingHandlers() {
    if (!this._matchmakingConn) return;

    // Route WELCOME to capture player ID
    this._matchmakingConn.on('WELCOME', (data) => {
      if (data.playerId) {
        this._playerId = data.playerId;
      }
      this._emitMatchmaking('WELCOME', data);
    });

    // Route all other matchmaking events
    const sessionEvents = [
      'HOST_CREATED', 'SESSION_LIST', 'JOIN_ACCEPTED', 'JOIN_REJECTED',
      'LEFT_LOBBY', 'ERROR', 'disconnect', 'stateChange',
    ];
    for (const eventType of sessionEvents) {
      this._matchmakingConn.on(eventType, (data) => {
        // Auto-connect to game session when join is accepted
        if (eventType === 'JOIN_ACCEPTED' && data.sessionPort) {
          this._connectToGameSession(data.sessionPort);
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

  /** Connect to game session server */
  _connectToGameSession(sessionPort) {
    if (this._disposed || this._gameSessionConn) return;

    try {
      const url = `${this._getProtocol()}://${this.host}:${sessionPort}`;
      this._gameSessionConn = new WSConnection({
        url,
        wsFactory: this._wsFactory,
      });

      // Wire up game session event handlers
      this._setupGameSessionHandlers();

      this._gameSessionConn.connect();
    } catch (err) {
      console.error(`[MultiplayerClient] Failed to connect game session:`, err.message);
      if (this._gameSessionConn) {
        this._gameSessionConn.dispose();
        this._gameSessionConn = null;
      }
    }
  }

  /** Set up internal game session message routing */
  _setupGameSessionHandlers() {
    if (!this._gameSessionConn) return;

    const gameEvents = [
      'WELCOME', 'PLAYER_JOINED', 'PLAYER_LEFT', 'PLAYER_MOVE',
      'BLOCK_BREAK', 'BLOCK_PLACE', 'INVENTORY_SYNC', 'CHUNK_DATA',
      'ERROR', 'disconnect', 'stateChange',
    ];
    for (const eventType of gameEvents) {
      this._gameSessionConn.on(eventType, (data) => {
        // Capture session ID from WELCOME
        if (eventType === 'WELCOME' && data.sessionId) {
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

  /** Host a new session */
  hostSession(name, worldSeed, mode) {
    if (this._matchmakingConn) {
      this._matchmakingConn.sendHost(name, worldSeed, mode);
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
    if (this._gameSessionConn) {
      this._gameSessionConn.sendJoin(this._playerId, character, position, rotation);
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

  // ── Disconnect / Dispose ──────────────────────────────────────

  /** Disconnect from all servers */
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
    }
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
    this._matchmakingHandlers = {};
    this._gameHandlers = {};
  }
}

// ─── Exports ────────────────────────────────────────────────────────

module.exports = {
  CLIENT_STATE,
  DEFAULT_CONFIG,
  MESSAGE_TYPES,
  MessageQueue,
  WSConnection,
  MultiplayerClient,
};
