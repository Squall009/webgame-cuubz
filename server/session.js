/**
 * Cuubz — Game Session Manager
 * Handles game session relay: player connections, message broadcasting,
 * server-side validation, heartbeat keepalive, and disconnect cleanup.
 *
 * Message Protocol (JSON over WebSocket). These are the strings that go **on the wire**,
 * which is why they are written out here rather than as `MESSAGE_TYPES.X` — the symbols
 * below are how the code names them, this block is what a packet capture shows:
 *   Client → Server:
 *     { type: 'JOIN', playerId, character } — Join the game session
 *     { type: 'MOVE', position, rotation }  — Player position update
 *     { type: 'BREAK_BLOCK', x, y, z }      — Request to break a block
 *     { type: 'PLACE_BLOCK', x, y, z, blockType } — Request to place a block
 *     { type: 'INVENTORY_UPDATE', inventory } — Inventory state sync
 *     { type: 'TIME_SYNC', timeOfDay, timePaused } — Host's time of day, relayed on
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
 *     { type: 'HEARTBEAT_ACK' }              — Keepalive acknowledgement
 *     { type: 'ERROR', message }
 *
 * This file used to declare its own 10-key `MESSAGE_TYPES` — one of three copies, and
 * the one that agreed with the client on values but not on membership. PR 33 replaced
 * all three with `shared/protocol.js`; see that file for the arithmetic and for why
 * `server/package.json` now says `"type": "module"`.
 */

import { MESSAGE_TYPES } from '../shared/protocol.js';

/** Most chunks one `CHUNK_REQUEST` may ask for — a client's render area plus slack. */
const MAX_CHUNK_REQUEST = 512;

class SessionManager {
  /**
   * @param {object} config
   * @param {WebSocketServer} config.wss — The WebSocket server for this session
   * @param {string} config.sessionName — Human-readable session name
   * @param {string} config.sessionId — Unique session identifier
   * @param {string} config.hostId — Player ID of the host
   * @param {number} config.maxPlayers — Maximum players (default: 4)
   * @param {number} config.heartbeatInterval — Heartbeat timeout in ms (default: 30000)
   * @param {function} [config.onSessionEmpty] — Called when the session has 0 players (for relay cleanup)
   * @param {number} [config.claimTimeout=60000] — How long the host has to open its
   *   `/session/:id` socket before the session is collected as never-claimed. D-103.
   * @param {number} [config.hostGrace=30000] — How long a session survives with its host
   *   absent but other players still connected. D-103.
   */
  constructor(config) {
    this.wss = config.wss;
    this.sessionId = config.sessionId;
    this.sessionName = config.sessionName || 'Untitled';
    this.gameMode = config.gameMode || 'survival';
    this.worldSeed = config.worldSeed || 42;
    this.hostId = config.hostId;
    this.maxPlayers = config.maxPlayers || 4;
    this.heartbeatInterval = config.heartbeatInterval || 30000;
    this.onSessionEmpty = config.onSessionEmpty || (() => {});
    this.claimTimeout = config.claimTimeout !== undefined ? config.claimTimeout : 60000;
    this.hostGrace = config.hostGrace !== undefined ? config.hostGrace : 30000;

    // Connected players: playerId → { ws, character, position, rotation, lastHeartbeat }
    this.players = new Map();

    // World state (server-authoritative)
    this.worldState = {
      chunks: new Map(),       // "cx,cz" → chunk data
      blockChanges: [],        // Log of validated block changes
    };

    this._disposed = false;
    this._heartbeatTimer = null;

    // ─── D-103 — the three ways a session ends ────────────────────────────
    //
    // Before this, there was exactly **one**: `_removePlayer` observing the ≥1 → 0
    // transition. That path cannot fire for a session no player ever joined, which is
    // the whole of the leak — `HOST` registers the session in the relay's map before
    // anybody opens `/session/:id`, so an abandoned "Host" click left a permanent,
    // hostless, unplayable row in every guest's browse list until the relay restarted.
    //
    //   `_claimTimer`     — the host never showed up at all. Armed here, cleared the
    //                       moment `hostId` joins. This is the leak D-103 describes.
    //   `_hostGraceTimer` — the host showed up and left, but other players are still
    //                       connected. Without it a session outlives its host for as
    //                       long as one guest keeps a socket open, and a hostless
    //                       session relays nothing: no chunks, no validation.
    //   `_emptyTimer`     — the pre-existing 0-players grace. Unchanged in duration;
    //                       `_removePlayer` now skips it when the **host said LEAVE**,
    //                       because a deliberate exit is not a reconnect.
    this._hostEverConnected = false;
    this._claimTimer = null;
    this._hostGraceTimer = null;
    this._emptyTimer = null;

    this._setupConnectionHandler();
    this._startHeartbeatCheck();
    this._startClaimTimer();
  }

  // ── Session lifetime timers (D-103) ─────────────────────────────────────

  /** Arm the never-claimed reaper. Cleared by the host's first JOIN. */
  _startClaimTimer() {
    if (this.claimTimeout <= 0) return;
    this._claimTimer = setTimeout(() => {
      if (this._disposed || this._hostEverConnected) return;
      console.log(`[SESSION ${this.sessionId}] Host never connected within ${this.claimTimeout}ms — destroying`);
      this.onSessionEmpty(this.sessionId);
    }, this.claimTimeout);
    if (this._claimTimer.unref) this._claimTimer.unref();
  }

  _clearClaimTimer() {
    if (this._claimTimer) {
      clearTimeout(this._claimTimer);
      this._claimTimer = null;
    }
  }

  /** Arm the host-absent reaper. Cleared when `hostId` rejoins. */
  _startHostGraceTimer() {
    this._clearHostGraceTimer();
    if (this.hostGrace <= 0) return;
    this._hostGraceTimer = setTimeout(() => {
      if (this._disposed || this.players.has(this.hostId)) return;
      console.log(`[SESSION ${this.sessionId}] Host did not return within ${this.hostGrace}ms — destroying`);
      this.onSessionEmpty(this.sessionId);
    }, this.hostGrace);
    if (this._hostGraceTimer.unref) this._hostGraceTimer.unref();
  }

  _clearHostGraceTimer() {
    if (this._hostGraceTimer) {
      clearTimeout(this._hostGraceTimer);
      this._hostGraceTimer = null;
    }
  }

  /**
   * Start periodic heartbeat enforcement — kicks players who haven't
   * sent a heartbeat within the configured interval.
   */
  _startHeartbeatCheck() {
    const checkInterval = Math.max(this.heartbeatInterval / 2, 5000); // Check every 15s (half of timeout)

    this._heartbeatTimer = setInterval(() => {
      if (this._disposed) {
        this._stopHeartbeatCheck();
        return;
      }

      const now = Date.now();
      const stalePlayers = [];

      for (const [playerId, player] of this.players) {
        const elapsed = now - player.lastHeartbeat;
        if (elapsed > this.heartbeatInterval) {
          stalePlayers.push(playerId);
        }
      }

      for (const playerId of stalePlayers) {
        console.log(`[SESSION ${this.sessionId}] Heartbeat timeout for ${playerId} — kicking`);
        this._removePlayer(playerId);
      }
    }, checkInterval);
  }

  /**
   * Stop the heartbeat enforcement timer.
   */
  _stopHeartbeatCheck() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
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
          this._send(ws, { type: MESSAGE_TYPES.ERROR, message: 'Invalid JSON' });
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

      case MESSAGE_TYPES.CHUNK_DATA:
        this._handleChunkData(playerId, msg);
        break;

      case MESSAGE_TYPES.CHUNK_REQUEST:
        this._handleChunkRequest(playerId, msg);
        break;

      case MESSAGE_TYPES.QUEST_UPDATE:
      case MESSAGE_TYPES.QUEST_SYNC:
      case MESSAGE_TYPES.SEAL_UPDATE:
      case MESSAGE_TYPES.BOSS_SPAWN:
      case MESSAGE_TYPES.BOSS_STATE:
      case MESSAGE_TYPES.BOSS_DEFEATED:
      case MESSAGE_TYPES.BOSS_DESPAWN:
      case MESSAGE_TYPES.BOSS_LOOT:
        // Host → everyone. The relay holds no quest state and no boss: the host is the
        // authority for both, exactly as it is for chunks, so these are pure forwarding.
        // Anyone but the host sending one is ignored rather than relayed — a guest
        // cannot announce that a seal broke.
        this._relayFromHost(playerId, msg);
        break;

      case MESSAGE_TYPES.QUEST_CONTRIBUTE:
      case MESSAGE_TYPES.BOSS_HIT:
        // Client → host, with the sender's `playerId` attached — the same shape as
        // CHUNK_REQUEST and for the same reason: the host needs to know who asked and
        // the client is not a trusted source for its own identity.
        this._relayToHost(playerId, msg);
        break;

      case MESSAGE_TYPES.HEARTBEAT:
        this._handleHeartbeat(playerId);
        break;

      case MESSAGE_TYPES.TIME_SYNC:
        // Relay time-of-day sync from host to all non-host players
        this._broadcast(playerId, {
          type: MESSAGE_TYPES.TIME_SYNC,
          timeOfDay: msg.timeOfDay,
          timePaused: msg.timePaused,
        });
        break;

      case MESSAGE_TYPES.LEAVE:
        // `explicit` — the client said goodbye rather than dropping. D-103: the 30 s
        // grace in `_removePlayer` exists so a WS auto-reconnect does not destroy a live
        // game; a host that deliberately left is not coming back, and making it wait
        // 30 s is exactly how an exited session stays in the browse list.
        if (playerId) {
          this._removePlayer(playerId, { explicit: true });
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
    console.log(`[SESSION ${this.sessionId}] JOIN from ${playerId}: ${msg.character?.name || 'unknown'} at ${JSON.stringify(msg.position)}`);

    // Handle reconnection — update the WebSocket for an existing player.
    // This happens when a player's WebSocket auto-reconnects after a network blip.
    // We must NOT broadcast PLAYER_JOINED again for a reconnecting player.
    if (playerId === this.hostId) {
      this._hostEverConnected = true;
      this._clearClaimTimer();
      this._clearHostGraceTimer();
    }

    if (this.players.has(playerId)) {
      const existing = this.players.get(playerId);
      existing.ws = ws;
      existing.lastHeartbeat = Date.now();
      if (msg.position) existing.position = msg.position;
      if (msg.rotation) existing.rotation = msg.rotation;
      if (msg.character) existing.character = msg.character;

      console.log(`[SESSION ${this.sessionId}] Player ${playerId} reconnected (WebSocket updated)`);

      // Send welcome with current player list so the reconnecting client can resync
      this._send(ws, {
        type: MESSAGE_TYPES.WELCOME,
        sessionId: this.sessionId,
        playerId,
        mode: this.gameMode,
        worldSeed: this.worldSeed,
        players: this._getPlayerList(),
      });
      return;
    }

    // Max players check for NEW players only
    if (this.players.size >= this.maxPlayers) {
      this._send(ws, { type: MESSAGE_TYPES.ERROR, message: 'Session is full' });
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
      type: MESSAGE_TYPES.WELCOME,
      sessionId: this.sessionId,
      playerId,
      mode: this.gameMode,
      worldSeed: this.worldSeed,
      players: this._getPlayerList(),
    });

    // Broadcast to all other players
    if (this.players.size > 1) {
      this._broadcast(playerId, {
        type: MESSAGE_TYPES.PLAYER_JOINED,
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
    if (!player) {
      console.warn(`[SESSION ${this.sessionId}] MOVE from unknown player ${playerId}`);
      return;
    }

    // Update local state (server-authoritative)
    player.position = msg.position || player.position;
    player.rotation = msg.rotation || player.rotation;

    console.log(`[SESSION ${this.sessionId}] MOVE relay: ${playerId} → ${this.players.size - 1} players`);

    // Broadcast position update to all other players
    this._broadcast(playerId, {
      type: MESSAGE_TYPES.PLAYER_MOVE,
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
      this._send(ws, { type: MESSAGE_TYPES.ERROR, message: 'Invalid block break' });
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
      type: MESSAGE_TYPES.BLOCK_BREAK,
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
      this._send(ws, { type: MESSAGE_TYPES.ERROR, message: 'Invalid block place' });
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
      type: MESSAGE_TYPES.BLOCK_PLACE,
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
      type: MESSAGE_TYPES.INVENTORY_SYNC,
      playerId,
      inventory: msg.inventory,
    });
  }

  /**
   * Forward a host-authored message to every other player, unchanged.
   *
   * The quest, seal and boss messages are all "the host has decided something" — a pool
   * total, a seal transition, a boss's position. The relay holds none of that state and
   * validates none of it; its whole job is to be the wire. What it *does* enforce is who
   * may speak: a guest that sends `SEAL_UPDATE` is dropped with a warning rather than
   * relayed, because a client that can announce a broken seal can hand itself the finale.
   *
   * `targetPlayers` is honoured for the same reason `_handleChunkData` honours it — a
   * `QUEST_SYNC` is for the one player who just joined, not for everyone.
   */
  _relayFromHost(playerId, msg) {
    if (!playerId) return;
    if (playerId !== this.hostId) {
      console.warn(`[SESSION ${this.sessionId}] Non-host ${playerId} sent ${msg.type} — ignoring (hostId=${this.hostId})`);
      return;
    }

    // Re-emit rather than forwarding `msg` itself: an object straight off the wire can
    // carry any field a client felt like adding, and the relay should not be the thing
    // that widens it. `type` is taken from the switch's own case, not from the payload.
    const out = { ...msg, type: msg.type };
    delete out.targetPlayers;

    if (Array.isArray(msg.targetPlayers) && msg.targetPlayers.length > 0) {
      for (const targetId of msg.targetPlayers) {
        if (targetId === playerId) continue;
        const target = this.players.get(targetId);
        if (target) this._send(target.ws, out);
      }
      return;
    }
    this._broadcast(playerId, out);
  }

  /**
   * Forward a client's message to the host alone, with the sender's `playerId` attached.
   *
   * `QUEST_CONTRIBUTE` and `BOSS_HIT` are the two untrusted, upward messages. The relay
   * adds the identity because the client cannot be trusted to supply it — the same rule
   * `_handleChunkRequest` established for D-116 — and the host validates everything else
   * (§6.3). A host that sends one to itself is a no-op here: it calls its own handler
   * directly through the local transport, which is §6.4's one-code-path rule.
   */
  _relayToHost(playerId, msg) {
    if (!playerId) return;
    if (playerId === this.hostId) return;

    const host = this.players.get(this.hostId);
    if (!host) return;

    const out = { ...msg, type: msg.type, playerId };
    this._send(host.ws, out);
  }

  /**
   * Handle chunk data streaming — relay to target players or all players.
   * Only the host may send chunk data.
   */
  _handleChunkData(playerId, msg) {
    if (!playerId) return;

    // Only the host should send chunk data
    if (playerId !== this.hostId) {
      console.warn(`[SESSION ${this.sessionId}] Non-host ${playerId} sent CHUNK_DATA — ignoring (hostId=${this.hostId})`);
      return;
    }

    console.log(`[SESSION ${this.sessionId}] Host ${playerId} streaming chunk ${msg.chunkX},${msg.chunkZ} (${msg.compressed ? 'compressed' : 'raw'}) to ${this.players.size - 1} players`);

    // Build the forwarded message — include all fields (neighborEdges, humidityMap, etc.)
    // so clients have everything they need for correct rendering
    const chunkMsg = {
      type: MESSAGE_TYPES.CHUNK_DATA,
      chunkX: msg.chunkX,
      chunkZ: msg.chunkZ,
      data: msg.data,
      compressed: msg.compressed || false,
      dirty: msg.dirty || false,
    };
    // Forward optional fields needed by clients
    if (msg.neighborEdges) chunkMsg.neighborEdges = msg.neighborEdges;
    if (msg.humidityMap) chunkMsg.humidityMap = msg.humidityMap;

    // Send to target players if specified, otherwise all non-host players
    if (msg.targetPlayers && Array.isArray(msg.targetPlayers) && msg.targetPlayers.length > 0) {
      for (const targetId of msg.targetPlayers) {
        if (targetId === playerId) continue; // Skip sender
        const target = this.players.get(targetId);
        if (target) {
          this._send(target.ws, chunkMsg);
        }
      }
    } else {
      // Broadcast to all non-host players
      this._broadcast(playerId, chunkMsg);
    }
  }

  /**
   * Handle a client asking the host for chunks it is missing (D-116).
   *
   * The relay holds no terrain, so this is pure forwarding — the one thing it adds is the
   * asking `playerId`, which the host needs to know who to send the chunks back to and
   * which the client cannot be trusted to supply.
   */
  _handleChunkRequest(playerId, msg) {
    if (!playerId) return;
    if (playerId === this.hostId) return; // The host serves itself from memory.
    if (!Array.isArray(msg.chunks) || msg.chunks.length === 0) return;

    const host = this.players.get(this.hostId);
    if (!host) return; // No host connected — nothing can serve chunks.

    // Cap what one request can ask for. A client's render area is ~289 chunks; anything
    // beyond that is a malformed or hostile request, not a resync.
    const chunks = msg.chunks.slice(0, MAX_CHUNK_REQUEST);

    this._send(host.ws, {
      type: MESSAGE_TYPES.CHUNK_REQUEST,
      playerId,
      chunks,
    });
  }

  /**
   * Handle heartbeat keepalive
   */
  _handleHeartbeat(playerId) {
    const player = this.players.get(playerId);
    if (player) {
      player.lastHeartbeat = Date.now();
      this._send(player.ws, { type: MESSAGE_TYPES.HEARTBEAT_ACK });
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
    if (y < 0 || y > 96) {
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
    if (y < 0 || y > 96) return false;
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
   *
   * @param {string} playerId
   * @param {{explicit?: boolean}} [opts] — `explicit` when the player sent `LEAVE` rather
   *   than having its socket drop. D-103: only a drop earns the reconnect grace.
   */
  _removePlayer(playerId, opts = {}) {
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
      type: MESSAGE_TYPES.PLAYER_LEFT,
      playerId,
    });

    console.log(`[SESSION ${this.sessionId}] Player ${playerId} removed (${this.players.size}/${this.maxPlayers})`);

    // Session cleanup — only destroy when ALL players are gone.
    // The host can momentarily disconnect and reconnect (WS auto-reconnect),
    // so we must NOT destroy the session just because the host left briefly.
    // The grace period allows the host time to reconnect before cleanup.
    if (this.players.size === 0) {
      if (opts.explicit && playerId === this.hostId) {
        // D-103. The host exited to the menu. Waiting 30 s here is what put a dead
        // session in front of the next guest who opened the browse list.
        console.log(`[SESSION ${this.sessionId}] Host left deliberately and session is empty — destroying now`);
        this.onSessionEmpty(this.sessionId);
        return;
      }
      console.log(`[SESSION ${this.sessionId}] Session empty — scheduling cleanup in 30s`);
      // Give the host 30 seconds to reconnect before destroying the session
      if (this._emptyTimer) clearTimeout(this._emptyTimer);
      this._emptyTimer = setTimeout(() => {
        if (this.players.size === 0) {
          console.log(`[SESSION ${this.sessionId}] Session still empty after grace period — destroying`);
          this.onSessionEmpty(this.sessionId);
        }
      }, 30000);
    } else if (playerId === this.hostId) {
      // Host left but others are still here. The relay is a dumb forwarder — with no
      // host there is no chunk streaming and no validation, so this is a countdown, not
      // a steady state. D-103: it used to be a steady state, and the session lived for
      // as long as one guest held a socket open.
      console.log(`[SESSION ${this.sessionId}] Host ${playerId} disconnected but ${this.players.size} players remain — ${this.hostGrace}ms to return`);
      this._startHostGraceTimer();
    }
  }

  /**
   * Check if a new player can join
   *
   * Capacity only — {@link isJoinable} is the question the relay's join handler asks.
   */
  canPlayerJoin() {
    return this.players.size < this.maxPlayers;
  }

  /**
   * Is the host in the session right now?
   */
  hasHost() {
    return this.players.has(this.hostId);
  }

  /**
   * Should this session appear in the browse list?
   *
   * D-103. `listSessions()` used to answer "does the object exist", which is not the same
   * question: a session whose host never connected, or left minutes ago, is an entry that
   * renders, accepts a click, hands out `JOIN_ACCEPTED` and then does nothing — there is
   * no host to stream a world. That is the "stale rows I cannot enter" report.
   *
   * A session is listed while its host is connected, and — once the host has joined at
   * least once — for as long as a reaper is still counting down on its absence. That
   * second clause is not slack: it is the window a host's **page refresh** lands in, and
   * it is what lets `AutoRejoin` find the session it is about to reclaim. A session the
   * host has never joined is never listed; there is nothing behind it yet.
   */
  isListable() {
    if (this._disposed) return false;
    if (!this._hostEverConnected) return false;
    if (this.hasHost()) return true;
    // Host is absent: only listable while a reaper is still counting down for it.
    return !!(this._hostGraceTimer || this._emptyTimer);
  }

  /** Listable and not full. This is what `onJoinRequest` asks. */
  isJoinable() {
    return this.isListable() && this.canPlayerJoin();
  }

  /**
   * Get session info for matchmaking listing
   */
  getSessionInfo() {
    return {
      sessionId: this.sessionId,
      name: this.sessionName,
      mode: this.gameMode,
      seed: this.worldSeed,
      players: this.players.size,
      maxPlayers: this.maxPlayers,
      hasHost: this.hasHost(),
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

    this._stopHeartbeatCheck();

    // Clear any pending empty-session cleanup timer
    if (this._emptyTimer) {
      clearTimeout(this._emptyTimer);
      this._emptyTimer = null;
    }
    // …and the two D-103 reapers, which would otherwise keep the process alive and fire
    // `onSessionEmpty` for a session the relay has already dropped from its map.
    this._clearClaimTimer();
    this._clearHostGraceTimer();

    // Disconnect all players
    for (const player of this.players.values()) {
      try { player.ws.close(); } catch (e) {}
    }
    this.players.clear();

    // Close WebSocket server
    try { this.wss.close(); } catch (e) {}
  }
}

export default SessionManager;