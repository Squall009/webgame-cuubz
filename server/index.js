/**
 * Cuubz — Relay Server Entry Point
 * Manages matchmaking lobby (port 8765) and game session relaying (dynamic ports).
 */

'use strict';

const { WebSocketServer, WebSocket } = require('ws');
const http = require('http');
const Matchmaking = require('./matchmaking');
const SessionManager = require('./session');

// ─── Configuration ────────────────────────────────────────────

const MATCHMAKING_PORT = process.env.MATCHMAKING_PORT || 8765;
const SESSION_BASE_PORT = parseInt(process.env.SESSION_BASE_PORT) || 8766;
const MAX_PLAYERS_PER_SESSION = 4;
const HEARTBEAT_INTERVAL = 30000; // 30s keepalive

// ─── State ────────────────────────────────────────────────────

let nextSessionPort = SESSION_BASE_PORT;
const sessions = new Map(); // sessionId → SessionManager instance

// ─── Matchmaking Server (Lobby) ───────────────────────────────

const matchmakingServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Cuubz Matchmaking Relay\n');
});

const matchmakingWSS = new WebSocketServer({ server: matchmakingServer });

// Load matchmaking logic
const matchmaking = new Matchmaking({
  wss: matchmakingWSS,
  onHostRequest: (playerId, sessionName, worldSeed, mode) => {
    // Create a new game session on a dynamic port
    const sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    const sessionPort = nextSessionPort++;

    console.log(`[MATCHMAKING] Creating session ${sessionId} for "${sessionName}" on port ${sessionPort}`);

    // Start game session relay server
    const sessionHttp = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Cuubz Game Session\n');
    });

    const sessionWSS = new WebSocketServer({ server: sessionHttp });
    const session = new SessionManager({
      wss: sessionWSS,
      sessionId,
      hostId: playerId,
      maxPlayers: MAX_PLAYERS_PER_SESSION,
      heartbeatInterval: HEARTBEAT_INTERVAL,
    });

    sessions.set(sessionId, { session, httpServer: sessionHttp, port: sessionPort });

    // Start listening
    sessionHttp.listen(sessionPort, () => {
      console.log(`[SESSION] ${sessionId} listening on port ${sessionPort}`);
    }).on('error', (err) => {
      console.error(`[SESSION] Failed to listen on port ${sessionPort}:`, err.message);
      // Clean up the failed session
      sessions.delete(sessionId);
    });

    return { sessionId, sessionPort };
  },
  onJoinRequest: (playerId, sessionId) => {
    const entry = sessions.get(sessionId);
    if (!entry) {
      return { error: 'Session not found' };
    }
    const canJoin = entry.session.canPlayerJoin();
    if (!canJoin) {
      return { error: 'Session is full' };
    }
    return { sessionPort: entry.port };
  },
  listSessions: () => {
    const list = [];
    for (const [id, entry] of sessions) {
      const info = entry.session.getSessionInfo();
      if (info) {
        list.push({ ...info, sessionPort: entry.port });
      }
    }
    return list;
  },
  onSessionLeave: (sessionId) => {
    const entry = sessions.get(sessionId);
    if (entry) {
      console.log(`[MATCHMAKING] Cleaning up session ${sessionId}`);
      entry.session.dispose();
      entry.httpServer.close();
      sessions.delete(sessionId);
    }
  },
});

// ─── Start Servers ────────────────────────────────────────────

matchmakingServer.listen(MATCHMAKING_PORT, () => {
  console.log(`[MATCHMAKING] Lobby listening on port ${MATCHMAKING_PORT}`);
  console.log(`[MATCHMAKING] Sessions will use ports starting from ${SESSION_BASE_PORT}`);
});

// ─── Graceful Shutdown ────────────────────────────────────────

process.on('SIGINT', () => {
  console.log('\n[SERVER] Shutting down...');
  for (const [id, entry] of sessions) {
    try {
      entry.session.dispose();
      entry.httpServer.close();
    } catch (e) {
      console.error(`[SERVER] Error cleaning up session ${id}:`, e.message);
    }
  }
  sessions.clear();
  try { matchmakingWSS.close(); } catch (e) {}
  matchmakingServer.close(() => {
    console.log('[SERVER] Shutdown complete.');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  process.emit('SIGINT');
});

// ─── Process-Level Error Handlers ─────────────────────────────

process.on('uncaughtException', (err) => {
  console.error('[SERVER] Uncaught Exception:', err.message, err.stack);
  // Attempt graceful shutdown
  process.emit('SIGINT');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[SERVER] Unhandled Rejection at:', promise, 'reason:', reason);
});

// ─── Health Check Endpoint ────────────────────────────────────

matchmakingServer.on('request', (req, res) => {
  if (req.url === '/health') {
    const activeSessions = sessions.size;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', activeSessions, uptime: process.uptime() }));
  } else if (req.url === '/sessions') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(matchmaking.listSessions()));
  }
});

module.exports = { matchmaking, sessions };
