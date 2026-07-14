/**
 * Cuubz — Relay Server Entry Point
 *
 * Single WebSocket server on one port with path-based routing:
 *   /matchmaking  → session discovery, host/join routing
 *   /session/:id  → game session relay
 *
 * No dynamic ports — everything goes through the same server.
 * Nginx reverse proxy can handle TLS termination.
 */

'use strict';

const { WebSocketServer, WebSocket } = require('ws');
const http = require('http');
const url = require('url');
const Matchmaking = require('./matchmaking');
const SessionManager = require('./session');

// ─── Configuration ────────────────────────────────────────────

const PORT = parseInt(process.env.MATCHMAKING_PORT) || 8765;
const MAX_PLAYERS_PER_SESSION = 4;
const HEARTBEAT_INTERVAL = 30000; // 30s keepalive

// ─── State ────────────────────────────────────────────────────

const sessions = new Map(); // sessionId → SessionManager instance

// ─── CORS Configuration ─────────────────────────────────────
const ALLOWED_ORIGINS = new Set([
  'https://cuubz.thehomelabguy.com',
  'https://cuubz-relay.thehomelabguy.com',
  'http://localhost',
  'http://127.0.0.1',
]);

function getCorsHeaders(origin) {
  if (ALLOWED_ORIGINS.has(origin) || origin === '*') {
    return {
      'Access-Control-Allow-Origin': origin || '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    };
  }
  return {};
}

// ─── HTTP Server ──────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const origin = req.headers.origin || '';
  const corsHeaders = getCorsHeaders(origin);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Content-Type': 'text/plain', ...corsHeaders });
    res.end();
    return;
  }

  if (req.url === '/health') {
    const activeSessions = sessions.size;
    res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
    res.end(JSON.stringify({ status: 'ok', activeSessions, uptime: process.uptime() }));
  } else if (req.url === '/sessions') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
    res.end(JSON.stringify(listSessions()));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain', ...corsHeaders });
    res.end('Cuubz Relay Server\n');
  }
});

// ─── WebSocket Server (noServer mode for path routing) ────────

const wss = new WebSocketServer({ noServer: true });

// Route WebSocket connections by URL path
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;

  // /matchmaking → matchmaking relay
  if (pathname === '/matchmaking') {
    return wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  }

  // /session/:id → game session relay
  const sessionMatch = pathname.match(/^\/session\/([^/]+)$/);
  if (sessionMatch) {
    const sessionId = sessionMatch[1];
    const entry = sessions.get(sessionId);
    if (!entry) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\nSession not found');
      socket.destroy();
      return;
    }
    return entry.wss.handleUpgrade(request, socket, head, (ws) => {
      entry.wss.emit('connection', ws, request);
    });
  }

  // Unknown path — reject
  socket.write('HTTP/1.1 404 Not Found\r\n\r\nUnknown path');
  socket.destroy();
});

// ─── Helper: Destroy a session and remove from the map ────────

function destroySession(sessionId) {
  const entry = sessions.get(sessionId);
  if (entry) {
    console.log(`[RELAY] Destroying session ${sessionId}`);
    entry.session.dispose();
    sessions.delete(sessionId);
  }
}

// ─── Matchmaking Logic ────────────────────────────────────────

const matchmaking = new Matchmaking({
  wss,
  onHostRequest: (playerId, sessionName, worldSeed, mode) => {
    const sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

    console.log(`[MATCHMAKING] Creating session ${sessionId} for "${sessionName}"`);

    // Create a dedicated WebSocket server for this session
    const sessionWss = new WebSocketServer({ noServer: true });
    const session = new SessionManager({
      wss: sessionWss,
      sessionId,
      sessionName: sessionName || 'Untitled',
      worldSeed: worldSeed || 42,
      gameMode: mode || 'survival',
      hostId: playerId,
      maxPlayers: MAX_PLAYERS_PER_SESSION,
      heartbeatInterval: HEARTBEAT_INTERVAL,
      onSessionEmpty: () => {
        destroySession(sessionId);
      },
    });

    sessions.set(sessionId, { session, wss: sessionWss });

    console.log(`[SESSION] ${sessionId} created (path: /session/${sessionId})`);
    return { sessionId };
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
    return { sessionId };
  },
  listSessions: () => listSessions(),
  // Only destroy the session when the HOST player disconnects from matchmaking
  onHostLeave: (sessionId, playerId) => {
    console.log(`[MATCHMAKING] Host ${playerId} left matchmaking — destroying session ${sessionId}`);
    destroySession(sessionId);
  },
  // Non-host clients disconnecting from matchmaking is normal — session stays alive
  onClientLeave: (sessionId, playerId) => {
    console.log(`[MATCHMAKING] Client ${playerId} left matchmaking (session ${sessionId} stays alive)`);
  },
});

// ─── Helper: List Active Sessions ─────────────────────────────

function listSessions() {
  const list = [];
  for (const [id, entry] of sessions) {
    const info = entry.session.getSessionInfo();
    if (info) {
      list.push(info);
    }
  }
  return list;
}

// ─── Start Server ─────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`[RELAY] Listening on port ${PORT}`);
  console.log(`[RELAY] Matchmaking: ws://<host>:${PORT}/matchmaking`);
  console.log(`[RELAY] Sessions:    ws://<host>:${PORT}/session/:id`);
});

// ─── Graceful Shutdown ────────────────────────────────────────

process.on('SIGINT', () => {
  console.log('\n[SERVER] Shutting down...');
  for (const [id, entry] of sessions) {
    try {
      entry.session.dispose();
    } catch (e) {
      console.error(`[SERVER] Error cleaning up session ${id}:`, e.message);
    }
  }
  sessions.clear();
  try { wss.close(); } catch (e) {}
  server.close(() => {
    console.log('[SERVER] Shutdown complete.');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  process.emit('SIGINT');
});

process.on('uncaughtException', (err) => {
  console.error('[SERVER] Uncaught Exception:', err.message, err.stack);
  process.emit('SIGINT');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[SERVER] Unhandled Rejection at:', promise, 'reason:', reason);
});

module.exports = { matchmaking, sessions };
