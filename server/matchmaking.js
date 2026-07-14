/**
 * Cuubz — Matchmaking Module
 * Handles lobby connections, session creation, browsing, and join routing.
 *
 * Message Protocol (JSON over WebSocket):
 *   Client → Server:
 *     { type: 'HOST', name, worldSeed, mode } — Host a new game session
 *     { type: 'BROWSE' }                        — List available sessions
 *     { type: 'JOIN', sessionId }               — Join an existing session
 *     { type: 'LEAVE', sessionId? }             — Leave matchmaking / abandon session
 *   Server → Client:
 *     { type: 'HOST_CREATED', sessionId, sessionPort }
 *     { type: 'SESSION_LIST', sessions: [...] }
 *     { type: 'JOIN_ACCEPTED', sessionPort }
 *     { type: 'JOIN_REJECTED', reason }
 *     { type: 'ERROR', message }
 */

'use strict';

const { WebSocket } = require('ws');

class Matchmaking {
  /**
   * @param {object} config
   * @param {WebSocketServer} config.wss — The WebSocket server instance
   * @param {function} config.onHostRequest — Called when a player hosts. Returns { sessionId, sessionPort } or { error }.
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
        type: 'WELCOME',
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
          this._send(ws, { type: 'ERROR', message: 'Invalid JSON message' });
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
      case 'HOST': {
        if (!msg.name || typeof msg.name !== 'string') {
          this._send(ws, { type: 'ERROR', message: 'Session name is required' });
          return;
        }
        if (!msg.worldSeed || typeof msg.worldSeed !== 'number') {
          this._send(ws, { type: 'ERROR', message: 'World seed (number) is required' });
          return;
        }

        client.name = msg.name;
        client.isHost = true;
        const result = this.onHostRequest(playerId, msg.name, msg.worldSeed, msg.mode || 'survival');

        if (result.error) {
          client.isHost = false;
          this._send(ws, { type: 'HOST_REJECTED', reason: result.error });
        } else {
          client.sessionId = result.sessionId;
          this._send(ws, {
            type: 'HOST_CREATED',
            sessionId: result.sessionId,
            sessionPort: result.sessionPort,
            message: `Session "${msg.name}" created. Connect to game session on port ${result.sessionPort}`,
          });
        }
        break;
      }

      case 'BROWSE': {
        const sessions = this.listSessions();
        this._send(ws, { type: 'SESSION_LIST', sessions });
        break;
      }

      case 'JOIN': {
        if (!msg.sessionId) {
          this._send(ws, { type: 'ERROR', message: 'sessionId is required' });
          return;
        }

        const result = this.onJoinRequest(playerId, msg.sessionId);

        if (result.error) {
          this._send(ws, { type: 'JOIN_REJECTED', reason: result.error });
        } else {
          client.sessionId = msg.sessionId;
          client.isHost = false; // Joiners are never the host
          this._send(ws, {
            type: 'JOIN_ACCEPTED',
            sessionId: msg.sessionId,
            sessionPort: result.sessionPort,
            message: `Joining session ${msg.sessionId}. Connect to game session on port ${result.sessionPort}`,
          });
        }
        break;
      }

      case 'LEAVE': {
        if (client.sessionId) {
          if (client.isHost) {
            this.onHostLeave(client.sessionId, playerId);
          } else {
            this.onClientLeave(client.sessionId, playerId);
          }
          client.sessionId = null;
          client.isHost = false;
        }
        this._send(ws, { type: 'LEFT_LOBBY', message: 'Left matchmaking lobby' });
        break;
      }

      case 'HEARTBEAT': {
        // Acknowledge client keepalive so the heartbeat timeout doesn't fire
        this._send(ws, { type: 'HEARTBEAT_ACK' });
        break;
      }

      default:
        this._send(ws, { type: 'ERROR', message: `Unknown message type: ${msg.type}` });
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

module.exports = Matchmaking;
