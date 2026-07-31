/**
 * Cuubz — Matchmaking Module
 * Handles lobby connections, session creation, browsing, and join routing.
 *
 * Message Protocol (JSON over WebSocket). These are the strings that go **on the wire**;
 * the code names every one of them through `MESSAGE_TYPES` from `shared/protocol.js`:
 *   Client → Server:
 *     { type: 'HOST', name, worldSeed, mode, maxPlayers } — Host a new game session
 *     { type: 'BROWSE' }                        — List available sessions
 *     { type: 'JOIN', sessionId }               — Join an existing session
 *     { type: 'LEAVE', sessionId? }             — Leave matchmaking / abandon session
 *     { type: 'HEARTBEAT' }                     — Keepalive ping
 *   Server → Client:
 *     { type: 'WELCOME', playerId }
 *     { type: 'HOST_CREATED', sessionId, sessionPort }
 *     { type: 'HOST_REJECTED', reason }
 *     { type: 'SESSION_LIST', sessions: [...] }
 *     { type: 'JOIN_ACCEPTED', sessionPort }
 *     { type: 'JOIN_REJECTED', reason }
 *     { type: 'LEFT_LOBBY', message }
 *     { type: 'HEARTBEAT_ACK' }
 *     { type: 'ERROR', message }
 *
 * ─── THIS FILE WAS THE THIRD COPY OF THE PROTOCOL ───────────────────────────
 *
 * It carried 14 bare string literals and no symbol at all — the copy that could not be
 * diffed against `Client.js` or `session.js` and therefore the one that drifted.
 * `HOST_REJECTED` below is what that cost: it went out on the wire, was in neither
 * symbol table, was in no routing list on the client and had no handler, so a refused
 * host request produced no feedback at all (`BUGS.md` D-78). Every type here is now a
 * `MESSAGE_TYPES` member and `test/unit/multiplayer/protocol.test.js` asserts, over
 * this file's text, that no bare protocol literal comes back.
 */

import { WebSocket } from 'ws';
import { MESSAGE_TYPES } from '../shared/protocol.js';

class Matchmaking {
  /**
   * @param {object} config
   * @param {WebSocketServer} config.wss — The WebSocket server instance
   * @param {function} config.onHostRequest — Called as
   *   `(playerId, name, worldSeed, mode, maxPlayers)`. Returns { sessionId, sessionPort }
   *   or { error }. `maxPlayers` is whatever the client asked for, or undefined.
   * @param {function} config.onJoinRequest — Called when a player joins. Returns { sessionPort } or { error }.
   * @param {function} config.listSessions — Returns array of active sessions.
   * @param {function} config.onHostLeave — Called when the HOST player leaves matchmaking (session should be destroyed).
   * @param {function} config.onClientLeave — Called when a non-host client leaves matchmaking (session stays alive).
   */
  constructor(config) {
    this.wss = config.wss;
    this.onHostRequest = config.onHostRequest || (() => ({ error: 'Not implemented' }));
    this.onJoinRequest = config.onJoinRequest || (() => ({ error: 'Not implemented' }));
    this.listSessions = config.listSessions || (() => []);
    this.onHostLeave = config.onHostLeave || (() => {});
    this.onClientLeave = config.onClientLeave || (() => {});

    // Track connected clients and their session associations
    // ws → { playerId, sessionId, name, isHost }
    this.clients = new Map();

    this._setupConnectionHandler();
  }

  /**
   * Assign a unique player ID
   */
  _generatePlayerId() {
    return 'player_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
  }

  /**
   * Set up WebSocket connection handler
   */
  _setupConnectionHandler() {
    this.wss.on('connection', (ws, req) => {
      const playerId = this._generatePlayerId();
      console.log(`[MATCHMAKING] Client connected: ${playerId}`);

      this.clients.set(ws, { playerId, sessionId: null, name: 'Unknown', isHost: false });

      // Send welcome message with player ID
      this._send(ws, {
        type: MESSAGE_TYPES.WELCOME,
        playerId,
        message: 'Connected to Cuubz matchmaking lobby',
      });

      // Handle incoming messages
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this._handleMessage(ws, playerId, msg);
        } catch (err) {
          console.error(`[MATCHMAKING] Parse error from ${playerId}:`, err.message);
          this._send(ws, { type: MESSAGE_TYPES.ERROR, message: 'Invalid JSON message' });
        }
      });

      // Handle disconnection — only destroy session if this client is the host
      ws.on('close', () => {
        const client = this.clients.get(ws);
        if (client && client.sessionId) {
          if (client.isHost) {
            console.log(`[MATCHMAKING] Host ${playerId} disconnected — destroying session ${client.sessionId}`);
            this.onHostLeave(client.sessionId, playerId);
          } else {
            console.log(`[MATCHMAKING] Client ${playerId} disconnected from matchmaking (session ${client.sessionId} stays alive)`);
            this.onClientLeave(client.sessionId, playerId);
          }
        }
        this.clients.delete(ws);
        console.log(`[MATCHMAKING] Client disconnected: ${playerId}`);
      });

      // Handle errors — same logic as close
      ws.on('error', (err) => {
        console.error(`[MATCHMAKING] WebSocket error for ${playerId}:`, err.message);
        const client = this.clients.get(ws);
        if (client && client.sessionId) {
          if (client.isHost) {
            console.log(`[MATCHMAKING] Host ${playerId} error — destroying session ${client.sessionId}`);
            this.onHostLeave(client.sessionId, playerId);
          } else {
            console.log(`[MATCHMAKING] Client ${playerId} matchmaking error (session stays alive)`);
            this.onClientLeave(client.sessionId, playerId);
          }
        }
        this.clients.delete(ws);
      });
    });
  }

  /**
   * Handle incoming messages from clients
   */
  _handleMessage(ws, playerId, msg) {
    const client = this.clients.get(ws);
    if (!client) return;

    switch (msg.type) {
      case MESSAGE_TYPES.HOST: {
        if (!msg.name || typeof msg.name !== 'string') {
          this._send(ws, { type: MESSAGE_TYPES.ERROR, message: 'Session name is required' });
          return;
        }
        if (!msg.worldSeed || typeof msg.worldSeed !== 'number') {
          this._send(ws, { type: MESSAGE_TYPES.ERROR, message: 'World seed (number) is required' });
          return;
        }

        client.name = msg.name;
        client.isHost = true;
        // `msg.maxPlayers` is passed straight through, unvalidated, on purpose: the
        // clamp belongs where the ceiling is defined (server/index.js, via
        // `clampMaxPlayers`), and a client is not a trusted source for a session cap.
        // An old client sends no field at all and gets the default. D-84.
        const result = this.onHostRequest(
          playerId, msg.name, msg.worldSeed, msg.mode || 'survival', msg.maxPlayers
        );

        if (result.error) {
          client.isHost = false;
          this._send(ws, { type: MESSAGE_TYPES.HOST_REJECTED, reason: result.error });
        } else {
          client.sessionId = result.sessionId;
          this._send(ws, {
            type: MESSAGE_TYPES.HOST_CREATED,
            sessionId: result.sessionId,
            sessionPort: result.sessionPort,
            message: `Session "${msg.name}" created. Connect to game session on port ${result.sessionPort}`,
          });
        }
        break;
      }

      case MESSAGE_TYPES.BROWSE: {
        const sessions = this.listSessions();
        this._send(ws, { type: MESSAGE_TYPES.SESSION_LIST, sessions });
        break;
      }

      case MESSAGE_TYPES.JOIN: {
        if (!msg.sessionId) {
          this._send(ws, { type: MESSAGE_TYPES.ERROR, message: 'sessionId is required' });
          return;
        }

        const result = this.onJoinRequest(playerId, msg.sessionId);

        if (result.error) {
          this._send(ws, { type: MESSAGE_TYPES.JOIN_REJECTED, reason: result.error });
        } else {
          client.sessionId = msg.sessionId;
          client.isHost = false; // Joiners are never the host
          this._send(ws, {
            type: MESSAGE_TYPES.JOIN_ACCEPTED,
            sessionId: msg.sessionId,
            sessionPort: result.sessionPort,
            message: `Joining session ${msg.sessionId}. Connect to game session on port ${result.sessionPort}`,
          });
        }
        break;
      }

      case MESSAGE_TYPES.LEAVE: {
        if (client.sessionId) {
          if (client.isHost) {
            this.onHostLeave(client.sessionId, playerId);
          } else {
            this.onClientLeave(client.sessionId, playerId);
          }
          client.sessionId = null;
          client.isHost = false;
        }
        this._send(ws, { type: MESSAGE_TYPES.LEFT_LOBBY, message: 'Left matchmaking lobby' });
        break;
      }

      case MESSAGE_TYPES.HEARTBEAT: {
        // Acknowledge client keepalive so the heartbeat timeout doesn't fire
        this._send(ws, { type: MESSAGE_TYPES.HEARTBEAT_ACK });
        break;
      }

      default:
        this._send(ws, { type: MESSAGE_TYPES.ERROR, message: `Unknown message type: ${msg.type}` });
    }
  }

  /**
   * Send JSON message to a client
   */
  _send(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(data));
      } catch (err) {
        console.error(`[MATCHMAKING] Send failed:`, err.message);
      }
    }
  }

  /**
   * Get active session count
   */
  getActiveSessionCount() {
    return this.listSessions().length;
  }
}

export default Matchmaking;
