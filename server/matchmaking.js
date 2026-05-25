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
   * @param {function} config.onSessionLeave — Called when a session is abandoned.
   */
  constructor(config) {
    this.wss = config.wss;
    this.onHostRequest = config.onHostRequest || (() => ({ error: 'Not implemented' }));
    this.onJoinRequest = config.onJoinRequest || (() => ({ error: 'Not implemented' }));
    this.listSessions = config.listSessions || (() => []);
    this.onSessionLeave = config.onSessionLeave || (() => {});

    // Track connected clients and their session associations
    this.clients = new Map(); // ws → { playerId, sessionId, name }

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

      this.clients.set(ws, { playerId, sessionId: null, name: 'Unknown' });

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

      // Handle disconnection
      ws.on('close', () => {
        const client = this.clients.get(ws);
        if (client && client.sessionId) {
          console.log(`[MATCHMAKING] Client ${playerId} disconnected from session ${client.sessionId}`);
          this.onSessionLeave(client.sessionId);
        }
        this.clients.delete(ws);
        console.log(`[MATCHMAKING] Client disconnected: ${playerId}`);
      });

      // Handle errors
      ws.on('error', (err) => {
        console.error(`[MATCHMAKING] WebSocket error for ${playerId}:`, err.message);
        // Clean up the client on WebSocket error to prevent dangling connections
        const client = this.clients.get(ws);
        if (client && client.sessionId) {
          console.log(`[MATCHMAKING] Cleaning up session ${client.sessionId} due to error`);
          this.onSessionLeave(client.sessionId);
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
        const result = this.onHostRequest(playerId, msg.name, msg.worldSeed, msg.mode || 'survival');

        if (result.error) {
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
          this._send(ws, {
            type: 'JOIN_ACCEPTED',
            sessionPort: result.sessionPort,
            message: `Joining session ${msg.sessionId}. Connect to game session on port ${result.sessionPort}`,
          });
        }
        break;
      }

      case 'LEAVE': {
        if (client.sessionId) {
          this.onSessionLeave(client.sessionId);
          client.sessionId = null;
        }
        this._send(ws, { type: 'LEFT_LOBBY', message: 'Left matchmaking lobby' });
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
