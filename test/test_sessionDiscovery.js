#!/usr/bin/env node
/**
 * Cuubz — Session Discovery Integration Tests
 * Tests the full end-to-end session discovery flow:
 *   1. Host creates a session via matchmaking, then joins their own game session
 *   2. Client browses and sees the session in the list with correct details
 *   3. Client joins and connects to the game session successfully
 *
 * This validates the complete client → matchmaking → game session pipeline.
 */

'use strict';

const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const Matchmaking = require('../server/matchmaking');
const SessionManager = require('../server/session');

// ─── Test Infrastructure ──────────────────────────────────────

let passCount = 0;
let failCount = 0;
const failures = [];

function assert(condition, message) {
  if (condition) {
    passCount++;
    console.log(`  ✅ ${message}`);
  } else {
    failCount++;
    failures.push(message);
    console.log(`  ❌ FAIL — ${message}`);
  }
}

// Ports for test servers
const MATCHMAKING_PORT = 18790;
let nextSessionPort = 18791;
const sessions = new Map(); // sessionId → { session, httpServer, port }

// Create matchmaking HTTP server with health/sessions endpoints
const matchmakingHttp = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', activeSessions: sessions.size }));
  } else if (req.url === '/sessions') {
    const list = [];
    for (const [, entry] of sessions) {
      const info = entry.session.getSessionInfo();
      if (info) list.push({ ...info, sessionPort: entry.port });
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(list));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Cuubz Matchmaking Relay\n');
  }
});

const matchmakingWSS = new WebSocketServer({ server: matchmakingHttp });

// Wire up the Matchmaking module with our callbacks
const matchmaking = new Matchmaking({
  wss: matchmakingWSS,
  onHostRequest: (playerId, sessionName, worldSeed, mode) => {
    const sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    const sessionPort = nextSessionPort++;

    const sessionHttp = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Cuubz Game Session\n');
    });

    const sessionWSS = new WebSocketServer({ server: sessionHttp });
    const session = new SessionManager({
      wss: sessionWSS,
      sessionId,
      hostId: playerId,
      maxPlayers: 4,
      heartbeatInterval: 30000,
    });

    sessions.set(sessionId, { session, httpServer: sessionHttp, port: sessionPort });
    sessionHttp.listen(sessionPort);

    return { sessionId, sessionPort };
  },
  onJoinRequest: (playerId, sessionId) => {
    const entry = sessions.get(sessionId);
    if (!entry) return { error: 'Session not found' };
    if (!entry.session.canPlayerJoin()) return { error: 'Session is full' };
    return { sessionPort: entry.port };
  },
  listSessions: () => {
    const list = [];
    for (const [id, entry] of sessions) {
      const info = entry.session.getSessionInfo();
      if (info) list.push({ ...info, sessionPort: entry.port });
    }
    return list;
  },
  onSessionLeave: (sessionId) => {
    const entry = sessions.get(sessionId);
    if (entry) {
      entry.session.dispose();
      entry.httpServer.close();
      sessions.delete(sessionId);
    }
  },
});

// ─── Test Helpers ──────────────────────────────────────────────

/** Connect WebSocket client and return { ws, messages, playerId } that collects all messages */
function connectWS(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const messages = [];

    ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
    ws.on('open', () => resolve({ ws, messages }));
    ws.on('error', reject);
  });
}

/** Connect to matchmaking and return { ws, messages, playerId } with WELCOME already consumed */
function connectMatchmaking() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${MATCHMAKING_PORT}`);
    const messages = [];

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      messages.push(msg);
      // Resolve immediately on WELCOME so caller gets playerId synchronously
      if (msg.type === 'WELCOME') {
        resolve({ ws, messages, playerId: msg.playerId });
      }
    });
    ws.on('error', reject);

    // Timeout safety
    setTimeout(() => reject(new Error('Timeout connecting to matchmaking')), 3000);
  });
}

/** Wait for the client to receive at least `count` messages, then return them */
function drainMessages(client, count) {
  return new Promise((resolve) => {
    const check = () => {
      if (client.messages.length >= count) {
        resolve(client.messages.splice(0, count));
      } else {
        setTimeout(check, 30);
      }
    };
    setTimeout(check, 10);
  });
}

/** Send a message and wait for the next response */
function sendAndWait(ws, msg, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout waiting for response to ${msg.type}`)),
      timeout
    );
    ws.once('message', (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
    ws.send(JSON.stringify(msg));
  });
}

/** Wait for a specific message type from the client's continuous buffer */
function waitForType(client, msgType, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      for (let i = 0; i < client.messages.length; i++) {
        if (client.messages[i].type === msgType) {
          const found = client.messages.splice(i, 1)[0];
          resolve(found);
          return;
        }
      }
      if (Date.now() - start > timeout) {
        const got = client.messages.map(m => m.type).join(', ');
        reject(new Error(`Timeout waiting for ${msgType}. Got: ${got}`));
        return;
      }
      setTimeout(check, 20);
    };
    check();
  });
}

/** Helper: host a session AND connect the host to their own game session */
async function createSessionWithHost(name, worldSeed, mode) {
  // Connect to matchmaking — get our playerId from WELCOME
  const mmClient = await connectMatchmaking();
  const mmPlayerId = mmClient.playerId;

  // Step 1: Host via matchmaking
  const hostRes = await sendAndWait(mmClient.ws, {
    type: 'HOST',
    name,
    worldSeed,
    mode: mode || 'survival',
  });

  assert(hostRes.type === 'HOST_CREATED', `Host created session "${name}"`);

  const sessionId = hostRes.sessionId;
  const sessionPort = hostRes.sessionPort;

  // Step 2: Connect the host to their own game session using the SAME playerId
  // (the one that onHostRequest received, which is mmPlayerId)
  const gameClient = await connectWS(sessionPort);
  const gameWelcome = await sendAndWait(gameClient.ws, {
    type: 'JOIN',
    playerId: mmPlayerId,
    character: { name: name, color: '#ff0000' },
    position: { x: 0, y: 20, z: 0 },
    rotation: { yaw: 0, pitch: 0 },
  });

  assert(gameWelcome.type === 'WELCOME', `Host joined own game session for "${name}"`);

  return { sessionId, sessionPort, mmClient, gameClient, playerId: mmPlayerId };
}

/** Cleanup all servers and connections */
function cleanup() {
  for (const [id, entry] of sessions) {
    try { entry.session.dispose(); } catch (e) {}
    try { entry.httpServer.close(); } catch (e) {}
  }
  sessions.clear();
  matchmakingWSS.close();
  matchmakingHttp.close();
}

// ─── Test Groups ──────────────────────────────────────────────

async function runTests() {
  // Start servers
  await new Promise((resolve) => matchmakingHttp.listen(MATCHMAKING_PORT, resolve));
  console.log('Matchmaking server started on port', MATCHMAKING_PORT);

  // ─── Group 1: Matchmaking connection & WELCOME ──────────────
  console.log('\nGroup 1: Matchmaking connection & WELCOME');

  const mmConn = await connectMatchmaking();
  assert(mmConn.ws.readyState === WebSocket.OPEN, 'Matchmaking client connected');
  assert(mmConn.playerId.startsWith('player_'), 'WELCOME contains valid playerId prefix');

  // ─── Group 2: Host creates a session and joins it ────────────
  console.log('\nGroup 2: Host creates a session and joins their own game session');

  const host1 = await createSessionWithHost(
    'Discovery Test World',
    12345,
    'survival'
  );
  assert(typeof host1.sessionId === 'string', 'Session has valid ID');
  assert(typeof host1.sessionPort === 'number', 'Session has valid port');
  assert(host1.playerId.startsWith('player_'), 'Host has valid playerId in game session');

  // Verify the session exists internally
  const trackedEntry = sessions.get(host1.sessionId);
  assert(trackedEntry !== undefined, 'Session is tracked internally');
  assert(trackedEntry.port === host1.sessionPort, 'Tracked port matches response port');

  // ─── Group 3: Browse — Host session appears in list with correct details ──
  console.log('\nGroup 3: Browse sessions — Host session appears with correct details');

  const browseConn = await connectMatchmaking();
  const browseClient = { ws: browseConn.ws, messages: [] };

  // Set up continuous message collection for browse client
  browseConn.ws.on('message', (data) => browseClient.messages.push(JSON.parse(data.toString())));

  const browseRes = await sendAndWait(browseConn.ws, { type: 'BROWSE' });
  assert(browseRes.type === 'SESSION_LIST', 'Received SESSION_LIST response');
  assert(Array.isArray(browseRes.sessions), 'SESSION_LIST has sessions array');
  assert(browseRes.sessions.length >= 1, 'At least 1 session in browse list');

  const listedSession = browseRes.sessions.find(s => s.sessionId === host1.sessionId);
  assert(listedSession !== undefined, `Session ${host1.sessionId} found in browse list`);
  assert(listedSession.name === 'Discovery Test World', 'Session name matches in browse list');
  assert(listedSession.players === 1, 'Session shows 1 player (host only)');
  assert(listedSession.maxPlayers === 4, 'Session maxPlayers is 4');
  assert(listedSession.mode === 'survival', 'Session mode is survival');
  assert(typeof listedSession.sessionPort === 'number', 'Browse list includes sessionPort');

  // ─── Group 4: Create second session, browse shows both ──────
  console.log('\nGroup 4: Multiple sessions in browse list');

  const host2 = await createSessionWithHost(
    'Second Test World',
    99999,
    'creative'
  );
  assert(typeof host2.sessionId === 'string', 'Second session created');

  // Browse again — should see both sessions
  const browseRes2 = await sendAndWait(browseConn.ws, { type: 'BROWSE' });
  assert(browseRes2.sessions.length >= 2, 'Browse list shows 2+ sessions');

  const sess1 = browseRes2.sessions.find(s => s.sessionId === host1.sessionId);
  const sess2 = browseRes2.sessions.find(s => s.sessionId === host2.sessionId);
  assert(sess1 !== undefined, 'First session still in browse list');
  assert(sess2 !== undefined, 'Second session now in browse list');
  assert(sess1.name === 'Discovery Test World', 'First session name correct');
  assert(sess2.name === 'Second Test World', 'Second session name correct');
  assert(sess1.name !== sess2.name, 'Sessions have different names');
  assert(sess1.players === 1, 'First session shows 1 player');
  assert(sess2.players === 1, 'Second session shows 1 player');

  // ─── Group 5: Join connects to game session successfully ─────
  console.log('\nGroup 5: Join connects to game session successfully');

  const joinConn = await connectMatchmaking();
  const joinMMClient = { ws: joinConn.ws, messages: [] };
  joinConn.ws.on('message', (data) => joinMMClient.messages.push(JSON.parse(data.toString())));

  const joinRes = await sendAndWait(joinConn.ws, {
    type: 'JOIN',
    sessionId: host1.sessionId,
  });
  assert(joinRes.type === 'JOIN_ACCEPTED', 'Received JOIN_ACCEPTED response');
  assert(joinRes.sessionPort === host1.sessionPort, 'Join response has correct session port');
  assert(typeof joinRes.message === 'string', 'Join response includes message text');

  // Connect to the game session
  const gameJoiner = await connectWS(host1.sessionPort);
  assert(gameJoiner.ws.readyState === WebSocket.OPEN, 'Game client connected to session port');

  // Set up listener on host's game client BEFORE joiner sends JOIN
  const joinedPromise = waitForType(host1.gameClient, 'PLAYER_JOINED', 2000);

  const gameWelcome = await sendAndWait(gameJoiner.ws, {
    type: 'JOIN',
    playerId: 'joiner_' + Date.now(),
    character: { name: 'JoinPlayer', color: '#00ff00' },
    position: { x: 5, y: 20, z: 5 },
    rotation: { yaw: 0, pitch: 0 },
  });
  assert(gameWelcome.type === 'WELCOME', 'Received WELCOME from game session');
  assert(gameWelcome.sessionId === host1.sessionId, 'Game WELCOME has correct sessionId');
  assert(typeof gameWelcome.playerId === 'string', 'Game WELCOME includes playerId');
  assert(Array.isArray(gameWelcome.players), 'Game WELCOME includes players list');
  assert(gameWelcome.players.length >= 2, `Player list shows ${gameWelcome.players.length} players (host + joiner)`);

  // Verify host is in the player list
  const hostInList = gameWelcome.players.some(p => p.name === 'Discovery Test World' || p.playerId === host1.playerId);
  assert(hostInList, `Host player (${host1.playerId}) appears in WELCOME player list`);

  // Verify PLAYER_JOINED broadcast was received by host
  let joinedMsg;
  try {
    joinedMsg = await joinedPromise;
    assert(true, 'Host received PLAYER_JOINED broadcast for new joiner');
    assert(joinedMsg.character.name === 'JoinPlayer', 'Broadcast includes correct player name');
  } catch (e) {
    assert(false, `PLAYER_JOINED broadcast received (${e.message})`);
  }

  // ─── Group 6: Full E2E — Browse → Join different session ─────
  console.log('\nGroup 6: Full E2E — Browse → Join second session');

  const e2eConn = await connectMatchmaking();
  const e2eMMClient = { ws: e2eConn.ws, messages: [] };
  e2eConn.ws.on('message', (data) => e2eMMClient.messages.push(JSON.parse(data.toString())));

  // Step 1: Browse to find the second session
  const e2eBrowse = await sendAndWait(e2eConn.ws, { type: 'BROWSE' });
  const targetSession = e2eBrowse.sessions.find(s => s.sessionId === host2.sessionId);
  assert(targetSession !== undefined, 'Found second session via browse');
  assert(targetSession.name === 'Second Test World', 'Target session name correct');

  // Step 2: Join the second session via matchmaking
  const e2eJoinRes = await sendAndWait(e2eConn.ws, {
    type: 'JOIN',
    sessionId: host2.sessionId,
  });
  assert(e2eJoinRes.type === 'JOIN_ACCEPTED', 'E2E join accepted');

  // Step 3: Connect to game session and JOIN
  const e2eGameClient = await connectWS(e2eJoinRes.sessionPort);
  const e2eGameWelcome = await sendAndWait(e2eGameClient.ws, {
    type: 'JOIN',
    playerId: 'e2e_joiner_' + Date.now(),
    character: { name: 'E2EPlayer', color: '#ff00ff' },
    position: { x: 10, y: 20, z: 10 },
    rotation: { yaw: 1.57, pitch: 0.3 },
  });
  assert(e2eGameWelcome.type === 'WELCOME', 'E2E game WELCOME received');
  assert(e2eGameWelcome.sessionId === host2.sessionId, 'E2E WELCOME has correct session');
  assert(e2eGameWelcome.players.length >= 2, 'E2E session shows 2+ players (host + joiner)');

  // ─── Group 7: Join non-existent session (error handling) ──────
  console.log('\nGroup 7: Join non-existent session — error handling');

  const errorConn = await connectMatchmaking();
  const errorMMClient = { ws: errorConn.ws, messages: [] };
  errorConn.ws.on('message', (data) => errorMMClient.messages.push(JSON.parse(data.toString())));

  const errorRes = await sendAndWait(errorConn.ws, {
    type: 'JOIN',
    sessionId: 'nonexistent_session_id_abc',
  });
  assert(errorRes.type === 'JOIN_REJECTED', 'Join rejected for non-existent session');
  assert(errorRes.reason === 'Session not found', 'Reason says "Session not found"');

  // ─── Group 8: HTTP /sessions endpoint mirrors browse data ────
  console.log('\nGroup 8: HTTP /sessions endpoint mirrors browse data');

  const httpSessions = await fetch(`http://127.0.0.1:${MATCHMAKING_PORT}/sessions`)
    .then(r => r.json());
  assert(Array.isArray(httpSessions), '/sessions returns an array');
  assert(httpSessions.length >= 2, '/sessions shows at least 2 active sessions');

  const httpSess1 = httpSessions.find(s => s.sessionId === host1.sessionId);
  const httpSess2 = httpSessions.find(s => s.sessionId === host2.sessionId);
  assert(httpSess1 !== undefined, 'First session in HTTP /sessions');
  assert(httpSess2 !== undefined, 'Second session in HTTP /sessions');
  assert(httpSess1.name === 'Discovery Test World', 'HTTP session name matches first');
  assert(httpSess2.name === 'Second Test World', 'HTTP session name matches second');

  // ─── Group 9: Session player count updates in browse list ─────
  console.log('\nGroup 9: Session player count updates after joins');

  const browseAfterJoin = await sendAndWait(browseConn.ws, { type: 'BROWSE' });
  const updatedSess1 = browseAfterJoin.sessions.find(s => s.sessionId === host1.sessionId);
  const updatedSess2 = browseAfterJoin.sessions.find(s => s.sessionId === host2.sessionId);

  assert(updatedSess1 !== undefined, 'First session still listed after joins');
  assert(updatedSess1.players >= 2, `Session 1 player count is ${updatedSess1.players} (expected ≥ 2: host + joiner)`);

  assert(updatedSess2 !== undefined, 'Second session still listed after joins');
  assert(updatedSess2.players >= 2, `Session 2 player count is ${updatedSess2.players} (expected ≥ 2: host + e2e joiner)`);

  // ─── Group 10: Session full enforcement via browse ────────────
  console.log('\nGroup 10: Session fills up — 4th player accepted, 5th rejected');

  // Fill session 1 to capacity (already has host + joiner = 2 players)
  const filler3 = await connectWS(host1.sessionPort);
  await sendAndWait(filler3.ws, {
    type: 'JOIN',
    playerId: 'filler3_' + Date.now(),
    character: { name: 'Filler3', color: '#0000ff' },
    position: { x: 15, y: 20, z: 15 },
    rotation: { yaw: 0, pitch: 0 },
  });

  const filler4 = await connectWS(host1.sessionPort);
  const filler4Welcome = await sendAndWait(filler4.ws, {
    type: 'JOIN',
    playerId: 'filler4_' + Date.now(),
    character: { name: 'Filler4', color: '#ffff00' },
    position: { x: 20, y: 20, z: 20 },
    rotation: { yaw: 0, pitch: 0 },
  });
  assert(filler4Welcome.type === 'WELCOME', '4th player accepted into session');

  // 5th player should be rejected at game session level
  const filler5 = await connectWS(host1.sessionPort);
  const filler5Res = await sendAndWait(filler5.ws, {
    type: 'JOIN',
    playerId: 'filler5_' + Date.now(),
    character: { name: 'Filler5', color: '#ff00ff' },
    position: { x: 25, y: 20, z: 25 },
    rotation: { yaw: 0, pitch: 0 },
  });
  assert(filler5Res.type === 'ERROR', '5th player rejected with ERROR at game session');
  assert(filler5Res.message === 'Session is full', 'Error message says "Session is full"');

  // ─── Cleanup ────────────────────────────────────────────────
  console.log('\n--- Cleanup ---');
  try { cleanup(); } catch (e) { /* ignore */ }

  // ─── Report Results ─────────────────────────────────────────
  const total = passCount + failCount;
  console.log(`\n===================================`);
  console.log(`  Session Discovery: ${passCount}/${total} passed, ${failCount} failed`);
  console.log(`===================================`);

  if (failures.length > 0) {
    console.log('\nFailed assertions:');
    for (const f of failures) console.log(`  ❌ ${f}`);
    process.exit(1);
  } else {
    console.log('  🎉 All session discovery tests passing!');
    process.exit(0);
  }
}

// Run the tests
runTests().catch(err => {
  console.error('Test runner error:', err.message);
  cleanup();
  process.exit(1);
});
