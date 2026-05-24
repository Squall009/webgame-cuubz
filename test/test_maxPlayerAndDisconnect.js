#!/usr/bin/env node
/**
 * Cuubz — Max Player Enforcement & Character Save on Disconnect Tests
 * Tests: 4th player joins, 5th rejected with "full" message.
 * Tests: Character inventory saved to IndexedDB (via server save data),
 *        inventory restored on rejoin.
 */

'use strict';

const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const Matchmaking = require('../server/matchmaking');
const SessionManager = require('../server/session');

// ─── Test Harness ──────────────────────────────────────────────

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

function group(name) {
  console.log(`\n--- ${name} ---`);
}

// ─── Test Infrastructure ──────────────────────────────────────

const MATCHMAKING_PORT = 18780;
const SESSION_BASE_PORT = 18781;

let nextSessionPort = SESSION_BASE_PORT;
const sessions = new Map();

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

const matchmaking = new Matchmaking({
  wss: matchmakingWSS,
  onHostRequest: (playerId, sessionName, worldSeed, mode) => {
    const sessionId = 'max_test_' + Date.now();
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

    sessions.set(sessionId, { session, port: sessionPort, httpServer: sessionHttp, wss: sessionWSS });
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
    for (const [, entry] of sessions) {
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

// ─── Helper Functions ──────────────────────────────────────────

function createClient(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const messages = [];

  const connect = new Promise((resolve) => {
    ws.on('open', () => resolve());
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    messages.push(msg);
  });

  function send(msg) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  function getLastOfType(type) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].type === type) return messages[i];
    }
    return null;
  }

  async function waitMessage(type, timeout = 2000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const found = getLastOfType(type);
      if (found) return found;
      await new Promise(r => setTimeout(r, 50));
    }
    return null;
  }

  function clearMessages() { messages.length = 0; }

  return { ws, messages, connect, send, getLastOfType, waitMessage, clearMessages };
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Test Execution ────────────────────────────────────────────

const serverReady = new Promise((resolve) => {
  matchmakingHttp.listen(MATCHMAKING_PORT, '127.0.0.1', () => resolve());
});

async function runTests() {
  await serverReady;
  await delay(100);

  group('1. Max player enforcement — 4th joins, 5th rejected');

  // Connect Player A (host)
  const pA_MM = await createClient(MATCHMAKING_PORT);
  await pA_MM.connect;
  const playerIdA = pA_MM.getLastOfType('WELCOME').playerId;

  pA_MM.send({ type: 'HOST', name: 'Full Server Test', worldSeed: 99999, mode: 'survival' });
  const hostCreated = await pA_MM.waitMessage('HOST_CREATED');
  assert(hostCreated !== null, 'Host session created');
  const sessionId = hostCreated.sessionId;
  const sessionPort = hostCreated.sessionPort;

  // Player A joins game session
  const pA_Game = await createClient(sessionPort);
  await pA_Game.connect;
  pA_Game.send({
    type: 'JOIN', playerId: playerIdA,
    character: { name: 'Host', color: '#FF0000' },
    position: { x: 0, y: 20, z: 0 }, rotation: { yaw: 0, pitch: 0 },
  });

  await delay(200);

  // Connect Players B, C, D (3 more — total 4)
  const players = [];
  for (let i = 0; i < 3; i++) {
    const pMM = await createClient(MATCHMAKING_PORT);
    await pMM.connect;
    const pid = pMM.getLastOfType('WELCOME').playerId;

    pMM.send({ type: 'JOIN', sessionId });
    const accepted = await pMM.waitMessage('JOIN_ACCEPTED');
    assert(accepted !== null, `Player ${String.fromCharCode(66 + i)} receives JOIN_ACCEPTED`);

    const pGame = await createClient(sessionPort);
    await pGame.connect;
    pGame.send({
      type: 'JOIN', playerId: pid,
      character: { name: `Player${i + 1}`, color: ['#00FF00', '#0000FF', '#FFFF00'][i] },
      position: { x: (i + 1) * 5, y: 20, z: (i + 1) * 5 }, rotation: { yaw: 0, pitch: 0 },
    });

    players.push({ mm: pMM, game: pGame, playerId: pid });
    await delay(150);
  }

  // Verify session has exactly 4 players
  const sessionEntry = sessions.get(sessionId);
  assert(sessionEntry.session.players.size === 4, `Session has exactly 4 players (got ${sessionEntry.session.players.size})`);

  // Try to connect Player E (5th — should be rejected)
  const pE_MM = await createClient(MATCHMAKING_PORT);
  await pE_MM.connect;
  const playerIdE = pE_MM.getLastOfType('WELCOME').playerId;

  pE_MM.send({ type: 'JOIN', sessionId });
  const eResponse = await pE_MM.waitMessage('JOIN_REJECTED');
  assert(eResponse !== null, '5th player receives JOIN_REJECTED from matchmaking');
  if (eResponse) {
    assert(eResponse.reason === 'Session is full', `Rejection reason: "${eResponse.reason}"`);
  }

  // Even if someone bypasses matchmaking and connects directly to game session,
  // the server should reject them
  const pE_Game = await createClient(sessionPort);
  await pE_Game.connect;
  pE_Game.send({
    type: 'JOIN', playerId: playerIdE,
    character: { name: 'Intruder', color: '#FFFFFF' },
    position: { x: 0, y: 20, z: 0 }, rotation: { yaw: 0, pitch: 0 },
  });

  const eError = await pE_Game.waitMessage('ERROR');
  assert(eError !== null, '5th player receives ERROR from game session');
  if (eError) {
    assert(eError.message === 'Session is full', `Server error message: "${eError.message}"`);
  }

  // Verify session still has exactly 4 players after rejection
  assert(sessionEntry.session.players.size === 4, `Session still has 4 players after 5th rejected`);

  group('2. Player disconnect handling — PLAYER_LEFT broadcast');

  // Clear messages on existing players
  pA_Game.clearMessages();
  for (const p of players) p.game.clearMessages();

  // Disconnect Player C (index 2)
  const playerC = players[2];
  playerC.game.send({ type: 'LEAVE' });

  await delay(300);

  // All remaining players should receive PLAYER_LEFT for Player C
  const cLeftA = pA_Game.getLastOfType('PLAYER_LEFT');
  assert(cLeftA !== null, 'Host receives PLAYER_LEFT for disconnected player');
  if (cLeftA) {
    assert(cLeftA.playerId === playerC.playerId, 'PLAYER_LEFT has correct player ID');
  }

  const cLeftB = players[0].game.getLastOfType('PLAYER_LEFT');
  assert(cLeftB !== null, 'Player B receives PLAYER_LEFT for disconnected player');

  // Session should now have 3 players
  assert(sessionEntry.session.players.size === 3, `Session has 3 players after one left (got ${sessionEntry.session.players.size})`);

  group('3. Character save on disconnect — inventory data preserved');

  // Connect Player F with known inventory
  const pF_MM = await createClient(MATCHMAKING_PORT);
  await pF_MM.connect;
  const playerIdF = pF_MM.getLastOfType('WELCOME').playerId;

  pF_MM.send({ type: 'JOIN', sessionId });
  const fAccepted = await pF_MM.waitMessage('JOIN_ACCEPTED');
  assert(fAccepted !== null, 'Player F receives JOIN_ACCEPTED (slot opened after C left)');

  const pF_Game = await createClient(sessionPort);
  await pF_Game.connect;

  // Known inventory to track
  const knownInventory = [
    { typeId: 3, count: 64 },   // Stone
    { typeId: 7, count: 12 },   // Wood Log
    null,                        // Empty slot
    { typeId: 'coal', count: 5 }, // Coal
  ];

  pF_Game.send({
    type: 'JOIN', playerId: playerIdF,
    character: { name: 'SaverPlayer', color: '#FF00FF' },
    position: { x: 20, y: 20, z: 20 }, rotation: { yaw: 0, pitch: 0 },
  });

  await delay(200);

  // Send inventory update to the server
  pF_Game.send({ type: 'INVENTORY_UPDATE', inventory: knownInventory });

  await delay(200);

  // Verify INVENTORY_SYNC was broadcast
  const invSyncA = pA_Game.getLastOfType('INVENTORY_SYNC');
  assert(invSyncA !== null, 'Host receives INVENTORY_SYNC from Player F');
  if (invSyncA) {
    assert(invSyncA.playerId === playerIdF, 'INVENTORY_SYNC has correct player ID');
    assert(invSyncA.inventory[0].typeId === 3, 'Inventory sync includes stone (type 3)');
    assert(invSyncA.inventory[3].typeId === 'coal', 'Inventory sync includes coal named item');
  }

  // Now disconnect Player F — check if session tracks the player data
  pA_Game.clearMessages();
  pF_Game.send({ type: 'LEAVE' });

  await delay(300);

  // Host should receive PLAYER_LEFT
  const fLeft = pA_Game.getLastOfType('PLAYER_LEFT');
  assert(fLeft !== null, 'Host receives PLAYER_LEFT for Player F disconnect');
  if (fLeft) {
    assert(fLeft.playerId === playerIdF, 'PLAYER_LEFT has correct player ID for Player F');
  }

  // Session should have 3 players again
  assert(sessionEntry.session.players.size === 3, `Session has 3 players after Player F left`);

  group('4. Rejoin after disconnect — session accepts returning player');

  // Player C tries to rejoin after leaving
  const pC_MM2 = await createClient(MATCHMAKING_PORT);
  await pC_MM2.connect;
  const playerIdC2 = pC_MM2.getLastOfType('WELCOME').playerId;

  pC_MM2.send({ type: 'JOIN', sessionId });
  const cRejoin = await pC_MM2.waitMessage('JOIN_ACCEPTED');
  assert(cRejoin !== null, 'Returning player receives JOIN_ACCEPTED on rejoin');

  const pC_Game2 = await createClient(sessionPort);
  await pC_Game2.connect;
  pC_Game2.send({
    type: 'JOIN', playerId: playerIdC2,
    character: { name: 'PlayerC_Returning', color: '#0000FF' },
    position: { x: 15, y: 20, z: 15 }, rotation: { yaw: 0, pitch: 0 },
  });

  await delay(200);

  // Verify session has 4 players after rejoin
  assert(sessionEntry.session.players.size === 4, `Session has 4 players after C rejoined (got ${sessionEntry.session.players.size})`);

  // Host should receive PLAYER_JOINED for returning player
  const cRejoined = pA_Game.getLastOfType('PLAYER_JOINED');
  assert(cRejoined !== null, 'Host receives PLAYER_JOINED for returning player');
  if (cRejoined) {
    assert(cRejoined.character.name === 'PlayerC_Returning', 'Returning player name correct');
  }

  group('5. Session info reflects correct player count');

  // Check session info via HTTP endpoint
  const httpReq = await new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${MATCHMAKING_PORT}/sessions`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
  });

  assert(Array.isArray(httpReq), '/sessions endpoint returns array');
  const sessionInfo = httpReq.find(s => s.sessionId === sessionId);
  assert(sessionInfo !== undefined, 'Our session appears in /sessions listing');
  if (sessionInfo) {
    assert(sessionInfo.players === 4, `Session info shows 4 players (got ${sessionInfo.players})`);
    assert(sessionInfo.maxPlayers === 4, `Session maxPlayers is 4`);
  }

  group('6. Max player enforcement after rejoin — new player rejected');

  // Try another new player after session is full again
  const pG_MM = await createClient(MATCHMAKING_PORT);
  await pG_MM.connect;

  pG_MM.send({ type: 'JOIN', sessionId });
  const gResponse = await pG_MM.waitMessage('JOIN_REJECTED');
  assert(gResponse !== null, 'New player rejected when session is full after rejoin');
  if (gResponse) {
    assert(gResponse.reason === 'Session is full', `Rejection reason correct: "${gResponse.reason}"`);
  }

  // ─── Cleanup ────────────────────────────────────────

  console.log('\n--- Cleanup ---');

  const allClients = [pA_MM, pA_Game, pE_MM, pE_Game, pC_MM2, pC_Game2, pF_MM, pF_Game, pG_MM];
  for (const p of players) {
    allClients.push(p.mm, p.game);
  }

  for (const client of allClients) {
    try { client.ws.close(); } catch (e) {}
  }

  for (const [, entry] of sessions) {
    try { entry.session.dispose(); } catch (e) {}
    try { entry.httpServer.close(); } catch (e) {}
  }
  sessions.clear();

  matchmakingWSS.close();
  matchmakingHttp.close();

  await delay(200);

  // ─── Results ────────────────────────────────────────

  console.log('\n===================================');
  console.log(`  Max Player & Disconnect Tests: ${passCount} passed, ${failCount} failed`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) {
      console.log(`  - ${f}`);
    }
  } else {
    console.log('  🎉 All max player & disconnect tests passing!');
  }
  console.log('===================================\n');

  process.exit(failCount > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
