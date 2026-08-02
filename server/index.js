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

import { WebSocketServer } from 'ws';
import http from 'node:http';
import Matchmaking from './matchmaking.js';
import SessionManager from './session.js';
import { clampMaxPlayers } from '../shared/protocol.js';

// `require('url')` used to be imported here and was never referenced — the upgrade
// router below uses the global `URL`. It went with the ESM conversion, as did the
// unused `WebSocket` half of the `ws` destructure. `'use strict'` went too: a module
// is always strict.

// ─── Configuration ────────────────────────────────────────────

const PORT = parseInt(process.env.MATCHMAKING_PORT) || 8765;
// `MAX_PLAYERS_PER_SESSION = 4` used to be declared here. It moved to
// `shared/protocol.js` as `MAX_PLAYERS_LIMIT` so the ceiling, the clamp that enforces
// it and the client's slider range (src/ui/templates/lobbyScreen.js:117, min=2 max=4)
// cannot drift apart. D-84.
const HEARTBEAT_INTERVAL = 120000; // 120s keepalive (browser throttles background tabs hard)

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
  onHostRequest: (playerId, sessionName, worldSeed, mode, maxPlayers) => {
    const sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

    // D-84. This used to be `maxPlayers: MAX_PLAYERS_PER_SESSION`, full stop — the host
    // form's slider was read, passed to `hostSession()` and then dropped by a destructure
    // in Client.js that did not name it, so a host who asked for 2 got 4. The field now
    // arrives; it is still not trusted, so it is clamped to
    // [MIN_PLAYERS_LIMIT, MAX_PLAYERS_LIMIT] and a missing or unusable value falls back
    // to the old hard-coded default of 4.
    const cap = clampMaxPlayers(maxPlayers);

    console.log(`[MATCHMAKING] Creating session ${sessionId} for "${sessionName}" (cap ${cap})`);

    // Create a dedicated WebSocket server for this session
    const sessionWss = new WebSocketServer({ noServer: true });
    const session = new SessionManager({
      wss: sessionWss,
      sessionId,
      sessionName: sessionName || 'Untitled',
      worldSeed: worldSeed || 42,
      gameMode: mode || 'survival',
      hostId: playerId,
      maxPlayers: cap,
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
    if (!entry.session.canPlayerJoin()) {
      return { error: 'Session is full' };
    }
    // D-103. `canPlayerJoin()` is a capacity check and nothing else, so a hostless
    // session — one whose host never arrived, or left — passed it and the joiner got
    // `JOIN_ACCEPTED` for a world nobody was serving. `isJoinable()` is capacity **and**
    // a host that is either present or still inside its reaper window.
    if (!entry.session.isJoinable()) {
      return { error: 'Session host is not connected' };
    }
    return { sessionId };
  },
  listSessions: () => listSessions(),
  // Host leaving matchmaking is normal (tab background, network blip) — a session whose
  // host has actually joined it cleans up through `server/session.js`'s own reapers.
  //
  // D-103's first half: the log line here used to say "stays alive" while the caller in
  // `matchmaking.js:105` logged "destroying session", and neither of them destroyed
  // anything. A session the host has **never** joined has no other collection path — the
  // claim timer would get it eventually, but the host closing its lobby socket is
  // positive evidence right now that it is not coming, so take it.
  onHostLeave: (sessionId, playerId) => {
    const entry = sessions.get(sessionId);
    if (entry && !entry.session._hostEverConnected) {
      console.log(`[MATCHMAKING] Host ${playerId} left matchmaking before ever joining session ${sessionId} — destroying`);
      destroySession(sessionId);
      return;
    }
    console.log(`[MATCHMAKING] Host ${playerId} left matchmaking (session ${sessionId} stays alive)`);
  },
  // Non-host clients disconnecting from matchmaking is normal — session stays alive
  onClientLeave: (sessionId, playerId) => {
    console.log(`[MATCHMAKING] Client ${playerId} left matchmaking (session ${sessionId} stays alive)`);
  },
});

// ─── Helper: List Active Sessions ─────────────────────────────

// D-103. This used to list every entry in the map. The map holds a session from the
// instant `HOST` is answered — before the host has opened `/session/:id`, and after it
// has gone — so "in the map" and "worth showing a guest" are different questions.
// `isListable()` is the second one; see `server/session.js`.
function listSessions() {
  const list = [];
  for (const [id, entry] of sessions) {
    if (!entry.session.isListable()) continue;
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

// D-8 (PR 10). This block used to route `uncaughtException` into the SIGINT handler,
// which exits 0. `cuubz-relay.service` says `Restart=on-failure`, and **exit code 0 is
// not a failure** — so after any unhandled error the relay shut itself down cleanly and
// systemd left it down, permanently, with a log line nobody was reading.
// `unhandledRejection` was worse: it logged and did nothing at all, leaving the process
// in whatever state the rejection left it.
//
// Ruling (BUGS.md decision 3): a **non-zero exit code**, not `Restart=always`. Both make
// the relay come back after a crash, but `Restart=always` would also restart a
// deliberate `systemctl stop` — it changes what a shutdown means, and the bug is that a
// crash is not being reported as one.
//
// So: a deliberate stop (SIGINT / SIGTERM) exits 0 and stays down; a crash exits 1 and
// systemd brings it back in RestartSec=5.

let shuttingDown = false;

/**
 * Dispose every session, close both servers, exit with `code`.
 *
 * The watchdog is not decoration. `server.close()` only fires its callback once every
 * connection has ended, and a relay's connections are long-lived WebSockets — so a
 * crash could leave the process alive, holding port 8765, having already torn down its
 * sessions, with systemd seeing a running unit. That is the same "relay stays down"
 * outcome by a different route, so shutdown is bounded.
 */
function shutdown(reason, code) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[SERVER] Shutting down (${reason}, exit ${code})...`);

  for (const [id, entry] of sessions) {
    try {
      entry.session.dispose();
    } catch (e) {
      console.error(`[SERVER] Error cleaning up session ${id}:`, e.message);
    }
  }
  sessions.clear();
  try { wss.close(); } catch (e) {}

  const watchdog = setTimeout(() => {
    console.error('[SERVER] Shutdown timed out after 5s — forcing exit.');
    process.exit(code);
  }, 5000);
  watchdog.unref();

  server.close(() => {
    clearTimeout(watchdog);
    console.log('[SERVER] Shutdown complete.');
    process.exit(code);
  });
}

process.on('SIGINT', () => shutdown('SIGINT', 0));
process.on('SIGTERM', () => shutdown('SIGTERM', 0));

process.on('uncaughtException', (err) => {
  console.error('[SERVER] Uncaught Exception:', err.message, err.stack);
  shutdown('uncaughtException', 1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[SERVER] Unhandled Rejection at:', promise, 'reason:', reason);
  shutdown('unhandledRejection', 1);
});

export { matchmaking, sessions };
