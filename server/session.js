/**
 * Cuubz — Game Session Manager
 * Handles game session relay: player connections, message broadcasting,
 * server-side validation, heartbeat keepalive, and disconnect cleanup.
 *
 * Message Protocol (JSON over WebSocket):
 *   Client → Server:
 *     { type: 'JOIN', playerId, character } — Join the game session
 *     { type: 'MOVE', position, rotation }  — Player position update
 *     { type: 'BREAK_BLOCK', x, y, z }      — Request to break a block
 *     { type: 'PLACE_BLOCK', x, y, z, blockType } — Request to place a block
 *     { type: 'INVENTORY_UPDATE', inventory } — Inventory state sync
 *     { type: 'HEARTBEAT' }                  — Keepalive ping
 *     { type: 'LEAVE' }                      — Leave the session
 *   Server → Client:
 *     { type: 'WELCOME', sessionId, players }
 *     { type: 'PLAYER_JOINED', playerId, character, position }
 *     { type: 'PLAYER_LEFT', playerId }
 *     { type: 'PLAYER_MOVE', playerId, position, rotation }
 *     { type: 'BLOCK_BREAK', x, y, z, blockType }
 *     { type: 'BLOCK_PLACE', x, y, z, blockType }
 *     { type: 'INVENTORY_SYNC', playerId, inventory }
 *     { type: 'CHUNK_DATA', chunkX, chunkZ, data } — Chunk streaming
 *     { type: 'ERROR', message }
 */

'use strict';

// Message types
const MESSAGE_TYPES = {
  JOIN: 'JOIN',
  LEAVE: 'LEAVE',
  MOVE: 'MOVE',
  BREAK_BLOCK: 'BREAK_BLOCK',
  PLACE_BLOCK: 'PLACE_BLOCK',
  CHUNK_DATA: 'CHUNK_DATA',
  INVENTORY_UPDATE: 'INVENTORY_UPDATE',
  QUEST_UPDATE: 'QUEST_UPDATE',
  HEARTBEAT: 'HEARTBEAT',
};

class SessionManager {
  /**
   * @param {object} config
   * @param {WebSocketServer} config.wss — The WebSocket server for this session
   * @param {string} config.sessionId — Unique session identifier
   * @param {string} config.hostId — Player ID of the host
   * @param {number} config.maxPlayers — Maximum players (default: 4)
   * @param {number} config.heartbeatInterval — Heartbeat timeout in ms (default: 30000)
   */
  constructor(config) {
    this.wss = config.wss;
    this.sessionId = config.sessionId;
    this.hostId = config.hostId;
    this.maxPlayers = config.maxPlayers || 4;
    this.heartbeatInterval = config.heartbeatInterval || 30000;

    // Connected players: playerId → { ws, character, position, rotation, lastHeartbeat }
    this.players = new Map();

    // World state (server-authoritative)
    this.worldState = {
      chunks: new Map(),       // "cx,cz" → chunk data
      blockChanges: [],        // Log of validated block changes
    };

    this._disposed = false;
    this._setupConnectionHandler();
  }

  /**
   * Set up WebSocket connection handler for game session
   */
  _setupConnectionHandler() {
    this.wss.on('connection', (ws) => {
      console.log(`[SESSION ${this.sessionId}] Client connected`);

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this._handleMessage(ws, msg);
        } catch (err) {
          console.error(`[SESSION ${this.sessionId}] Parse error:`, err.message);
          this._send(ws, { type: 'ERROR', message: 'Invalid JSON' });
        }
      });

      ws.on('close', () => {
        const playerId = this._findPlayerIdByWs(ws);
        if (playerId) {
          console.log(`[SESSION ${this.sessionId}] Player ${playerId} disconnected`);
          this._removePlayer(playerId);
        }
      });

      ws.on('error', (err) => {
        console.error(`[SESSION ${this.sessionId}] WebSocket error:`, err.message);
        // Clean up the player on WebSocket error to prevent dangling connections
        const playerId = this._findPlayerIdByWs(ws);
        if (playerId) {
          this._removePlayer(playerId);
        }
      });
    });
  }

  /**
   * Handle incoming messages from players
   */
  _handleMessage(ws, msg) {
    const playerId = this._findPlayerIdByWs(ws);

    switch (msg.type) {
      case MESSAGE_TYPES.JOIN:
        // Use playerId from message if provided (e.g., host reconnecting),
        // otherwise use lookup or generate new one
        const joinPlayerId = msg.playerId || playerId || this._generatePlayerId();
        this._handleJoin(ws, joinPlayerId, msg);
        break;

      case MESSAGE_TYPES.MOVE:
        this._handleMove(playerId, msg);
        break;

      case MESSAGE_TYPES.BREAK_BLOCK:
        this._handleBreakBlock(playerId, ws, msg);
        break;

      case MESSAGE_TYPES.PLACE_BLOCK:
        this._handlePlaceBlock(playerId, ws, msg);
        break;

      case MESSAGE_TYPES.INVENTORY_UPDATE:
        this._handleInventoryUpdate(playerId, msg);
        break;

      case MESSAGE_TYPES.HEARTBEAT:
        this._handleHeartbeat(playerId);
        break;

      case MESSAGE_TYPES.LEAVE:
        if (playerId) {
          this._removePlayer(playerId);
        }
        break;

      default:
        console.warn(`[SESSION ${this.sessionId}] Unknown message type: ${msg.type}`);
    }
  }

  /**
   * Handle player join
   */
  _handleJoin(ws, playerId, msg) {
    if (this.players.size >= this.maxPlayers) {
      this._send(ws, { type: 'ERROR', message: 'Session is full' });
      ws.close();
      return;
    }

    const player = {
      playerId,
      ws,
      character: msg.character || { name: 'Player', color: '#ffffff' },
      position: msg.position || { x: 0, y: 20, z: 0 },
      rotation: msg.rotation || { yaw: 0, pitch: 0 },
      lastHeartbeat: Date.now(),
    };

    this.players.set(playerId, player);

    // Send welcome to joining player
    this._send(ws, {
      type: 'WELCOME',
      sessionId: this.sessionId,
      playerId,
      players: this._getPlayerList(),
    });

    // Broadcast to all other players
    if (this.players.size > 1) {
      this._broadcast(playerId, {
        type: 'PLAYER_JOINED',
        playerId,
        character: player.character,
        position: player.position,
      });
    }

    console.log(`[SESSION ${this.sessionId}] Player ${playerId} joined (${this.players.size}/${this.maxPlayers})`);
  }

  /**
   * Handle player movement — relay to all other players
   */
  _handleMove(playerId, msg) {
    const player = this.players.get(playerId);
    if (!player) return;

    // Update local state (server-authoritative)
    player.position = msg.position || player.position;
    player.rotation = msg.rotation || player.rotation;

    // Broadcast position update to all other players
    this._broadcast(playerId, {
      type: 'PLAYER_MOVE',
      playerId,
      position: player.position,
      rotation: player.rotation,
    });
  }

  /**
   * Handle block break request — validate and relay
   */
  _handleBreakBlock(playerId, ws, msg) {
    const player = this.players.get(playerId);
    if (!player) return;

    // Server-side validation
    const valid = this._validateBlockBreak(playerId, msg.x, msg.y, msg.z);
    if (!valid) {
      this._send(ws, { type: 'ERROR', message: 'Invalid block break' });
      return;
    }

    // Log the change
    this.worldState.blockChanges.push({
      type: 'BREAK',
      x: msg.x, y: msg.y, z: msg.z,
      playerId,
      timestamp: Date.now(),
    });

    // Broadcast to all players
    this._broadcast(null, {
      type: 'BLOCK_BREAK',
      x: msg.x, y: msg.y, z: msg.z,
      blockType: msg.blockType || 0, // AIR
    });
  }

  /**
   * Handle block place request — validate and relay
   */
  _handlePlaceBlock(playerId, ws, msg) {
    const player = this.players.get(playerId);
    if (!player) return;

    // Server-side validation
    const valid = this._validateBlockPlace(playerId, msg.x, msg.y, msg.z, msg.blockType);
    if (!valid) {
      this._send(ws, { type: 'ERROR', message: 'Invalid block place' });
      return;
    }

    // Log the change
    this.worldState.blockChanges.push({
      type: 'PLACE',
      x: msg.x, y: msg.y, z: msg.z,
      blockType: msg.blockType,
      playerId,
      timestamp: Date.now(),
    });

    // Broadcast to all players
    this._broadcast(null, {
      type: 'BLOCK_PLACE',
      x: msg.x, y: msg.y, z: msg.z,
      blockType: msg.blockType,
    });
  }

  /**
   * Handle inventory update — relay to host for validation
   */
  _handleInventoryUpdate(playerId, msg) {
    // Broadcast inventory state to all players (host validates)
    this._broadcast(null, {
      type: 'INVENTORY_SYNC',
      playerId,
      inventory: msg.inventory,
    });
  }

  /**
   * Handle heartbeat keepalive
   */
  _handleHeartbeat(playerId) {
    const player = this.players.get(playerId);
    if (player) {
      player.lastHeartbeat = Date.now();
    }
  }

  /**
   * Server-side validation: block break
   */
  _validateBlockBreak(playerId, x, y, z) {
    // Basic validation: coordinates must be integers within world bounds
    if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) {
      return false;
    }
    if (y < -32 || y > 64) {
      return false; // Out of world Y range
    }

    // Distance check: player must be within reach distance (6 blocks)
    const player = this.players.get(playerId);
    if (!player) return false;

    const dx = x - Math.floor(player.position.x);
    const dy = y - Math.floor(player.position.y);
    const dz = z - Math.floor(player.position.z);
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (dist > 6) {
      return false; // Too far away
    }

    return true;
  }

  /**
   * Server-side validation: block place
   */
  _validateBlockPlace(playerId, x, y, z, blockType) {
    if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) {
      return false;
    }
    if (y < -32 || y > 64) return false;
    if (blockType === undefined || blockType < 0) return false;

    // Distance check
    const player = this.players.get(playerId);
    if (!player) return false;

    const dx = x - Math.floor(player.position.x);
    const dy = y - Math.floor(player.position.y);
    const dz = z - Math.floor(player.position.z);
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (dist > 6) return false;

    return true;
  }

  /**
   * Remove a player from the session
   */
  _removePlayer(playerId) {
    const player = this.players.get(playerId);
    if (!player) return;

    // Close WebSocket
    try {
      player.ws.close();
    } catch (e) {
      // Already closed
    }

    this.players.delete(playerId);

    // Broadcast to remaining players
    this._broadcast(null, {
      type: 'PLAYER_LEFT',
      playerId,
    });

    console.log(`[SESSION ${this.sessionId}] Player ${playerId} removed (${this.players.size}/${this.maxPlayers})`);

    // If host left and session is empty, signal cleanup
    if (playerId === this.hostId || this.players.size === 0) {
      console.log(`[SESSION ${this.sessionId}] Session ending (host left or empty)`);
    }
  }

  /**
   * Check if a new player can join
   */
  canPlayerJoin() {
    return this.players.size < this.maxPlayers;
  }

  /**
   * Get session info for matchmaking listing
   */
  getSessionInfo() {
    const host = this.players.get(this.hostId);
    return {
      sessionId: this.sessionId,
      name: host ? host.character.name : 'Unknown',
      players: this.players.size,
      maxPlayers: this.maxPlayers,
      mode: 'survival', // TODO: track mode per session
    };
  }

  /**
   * Get list of connected players
   */
  _getPlayerList() {
    const list = [];
    for (const [id, player] of this.players) {
      list.push({
        playerId: id,
        name: player.character.name,
        color: player.character.color,
        position: player.position,
      });
    }
    return list;
  }

  /**
   * Find player ID by WebSocket reference
   */
  _findPlayerIdByWs(ws) {
    for (const [id, player] of this.players) {
      if (player.ws === ws) return id;
    }
    return null;
  }

  /**
   * Generate a player ID
   */
  _generatePlayerId() {
    return 'remote_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
  }

  /**
   * Send message to a specific WebSocket
   */
  _send(ws, data) {
    if (ws.readyState === 1) { // WebSocket.OPEN = 1
      try {
        ws.send(JSON.stringify(data));
      } catch (err) {
        console.error(`[SESSION ${this.sessionId}] Send failed:`, err.message);
      }
    }
  }

  /**
   * Broadcast message to all players except the sender
   * @param {string|null} excludePlayerId — Player ID to exclude, or null to send to everyone
   */
  _broadcast(excludePlayerId, data) {
    for (const player of this.players.values()) {
      if (excludePlayerId && player.playerId === excludePlayerId) continue;
      try {
        this._send(player.ws, data);
      } catch (err) {
        console.error(`[SESSION ${this.sessionId}] Broadcast to ${player.playerId} failed:`, err.message);
        // Continue broadcasting to remaining players
      }
    }
  }

  /**
   * Dispose session — clean up resources
   */
  dispose() {
    if (this._disposed) return;
    this._disposed = true;

    // Disconnect all players
    for (const player of this.players.values()) {
      try { player.ws.close(); } catch (e) {}
    }
    this.players.clear();

    // Close WebSocket server
    this.wss.close();
  }
}

module.exports = SessionManager;
