#!/usr/bin/env node
/**
 * Cuubz — Server Integration Tests
 * Starts the actual relay server and tests real WebSocket connections.
 * Covers: server startup, matchmaking protocol, session creation, game session join, block validation.
 */

'use strict';

const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const Matchmaking = require('../server/matchmaking');
const SessionManager = require('../server/session');

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

// ─── Test Infrastructure ──────────────────────────────────────

const MATCHMAKING_PORT = 18765;
const SESSION_BASE_PORT = 18766;

process.env.MATCHMAKING_PORT = String(MATCHMAKING_PORT);
process.env.SESSION_BASE_PORT = String(SESSION_BASE_PORT);

let nextSessionPort = SESSION_BASE_PORT;
const sessions = new Map();

// Create matchmaking HTTP server
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
    const sessionId = 'test_session_' + Date.now();
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

// Helper: connect WebSocket client and return promise that resolves with { ws, messages }
function connectWS(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const messages = [];

    // Continuously collect all messages
    ws.on('message', (data) => messages.push(JSON.parse(data.toString())));

    ws.on('open', () => resolve({ ws, messages }));
    ws.on('error', reject);
  });
}

// Helper: drain initial messages (e.g., WELCOME) from a client
function drainMessages(client, count) {
  return new Promise((resolve) => {
    const check = () => {
      if (client.messages.length >= count) {
        resolve(client.messages.splice(0, count));
      } else {
        setTimeout(check, 50);
      }
    };
    setTimeout(check, 10);
  });
}

// Helper: send message and wait for next response
function sendMessage(ws, msg, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout waiting for response')), timeout);
    ws.once('message', (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
    ws.send(JSON.stringify(msg));
  });
}

// Helper: wait for specific message type from a client's continuous buffer
function waitForMessageType(client, msgType, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      // Check already-buffered messages first
      for (let i = 0; i < client.messages.length; i++) {
        if (client.messages[i].type === msgType) {
          const found = client.messages.splice(i, 1)[0];
          resolve(found);
          return;
        }
      }
      // Check timeout
      if (Date.now() - start > timeout) {
        reject(new Error(`Timeout waiting for ${msgType}. Got: ${client.messages.map(m => m.type).join(', ')}`));
        return;
      }
      setTimeout(check, 20);
    };
    check();
  });
}

// Helper: cleanup all connections and servers
function cleanup() {
  for (const [id, entry] of sessions) {
    try { entry.session.dispose(); } catch (e) {}
    try { entry.httpServer.close(); } catch (e) {}
  }
  sessions.clear();
  matchmakingWSS.close();
  matchmakingHttp.close();
}

// ─── Run Tests ─────────────────────────────────────────────────

async function runTests() {
  // Start matchmaking server
  await new Promise((resolve) => matchmakingHttp.listen(MATCHMAKING_PORT, resolve));

  // ─── Group 1: Server starts and accepts connections ──────────
  console.log('Group 1: Server starts and accepts connections');

  const healthRes = await fetch(`http://127.0.0.1:${MATCHMAKING_PORT}/health`)
    .then(r => r.json());
  assert(healthRes.status === 'ok', 'Health endpoint returns ok');
  assert(healthRes.activeSessions === 0, 'No active sessions at startup');

  // ─── Group 2: Matchmaking WebSocket connection ──────────────
  console.log('\nGroup 2: Matchmaking WebSocket connection');

  const mmClient1 = await connectWS(MATCHMAKING_PORT);
  assert(mmClient1.ws.readyState === WebSocket.OPEN, 'Matchmaking client connected');

  // Drain WELCOME message
  const welcomeMsgs = await drainMessages(mmClient1, 1);
  assert(welcomeMsgs[0].type === 'WELCOME', 'Received WELCOME message on connect');
  assert(welcomeMsgs[0].playerId.startsWith('player_'), 'WELCOME contains valid playerId');

  // ─── Group 3: Host a session ────────────────────────────────
  console.log('\nGroup 3: Host a session');

  const hostRes = await sendMessage(mmClient1.ws, {
    type: 'HOST',
    name: 'Test World',
    worldSeed: 42,
    mode: 'survival',
  });
  assert(hostRes.type === 'HOST_CREATED', 'Received HOST_CREATED response');
  assert(hostRes.sessionId !== undefined, 'Host response has sessionId');
  assert(hostRes.sessionPort !== undefined, 'Host response has sessionPort');
  const testSessionId = hostRes.sessionId;
  const testSessionPort = hostRes.sessionPort;

  // ─── Group 4: Browse sessions ───────────────────────────────
  console.log('\nGroup 4: Browse sessions');

  const mmClient2 = await connectWS(MATCHMAKING_PORT);
  await drainMessages(mmClient2, 1); // consume WELCOME

  const browseRes = await sendMessage(mmClient2.ws, { type: 'BROWSE' });
  assert(browseRes.type === 'SESSION_LIST', 'Received SESSION_LIST response');
  assert(Array.isArray(browseRes.sessions), 'SESSION_LIST has sessions array');
  assert(browseRes.sessions.length >= 1, 'At least 1 session listed');
  const listedSession = browseRes.sessions.find(s => s.sessionId === testSessionId);
  assert(listedSession !== undefined, 'Hosted session appears in browse list');

  // ─── Group 5: Join a session (via matchmaking) ──────────────
  console.log('\nGroup 5: Join a session (matchmaking routing)');

  const joinRes = await sendMessage(mmClient2.ws, { type: 'JOIN', sessionId: testSessionId });
  assert(joinRes.type === 'JOIN_ACCEPTED', 'Received JOIN_ACCEPTED response');
  assert(joinRes.sessionPort === testSessionPort, 'Join response has correct session port');

  // ─── Group 6: Game session connection ───────────────────────
  console.log('\nGroup 6: Game session connection');

  const gameClient1 = await connectWS(testSessionPort);
  assert(gameClient1.ws.readyState === WebSocket.OPEN, 'Game client connected to session');

  // Send JOIN message — note: server generates its own playerId via _generatePlayerId()
  // when no playerId is provided, OR uses the one sent. Let's send one and capture it.
  const gameWelcome = await sendMessage(gameClient1.ws, {
    type: 'JOIN',
    character: { name: 'HostPlayer', color: '#ff0000' },
    position: { x: 0, y: 20, z: 0 },
    rotation: { yaw: 0, pitch: 0 },
  });
  assert(gameWelcome.type === 'WELCOME', 'Received WELCOME from game session');
  assert(gameWelcome.sessionId === testSessionId, 'Game WELCOME has correct sessionId');
  assert(typeof gameWelcome.playerId === 'string', 'Game WELCOME includes assigned playerId');
  const hostPlayerId = gameWelcome.playerId; // Capture the actual ID assigned
  assert(Array.isArray(gameWelcome.players), 'Game WELCOME includes players list');

  // ─── Group 7: Second player joins game session ──────────────
  console.log('\nGroup 7: Second player joins game session');

  const gameClient2 = await connectWS(testSessionPort);
  const gameWelcome2 = await sendMessage(gameClient2.ws, {
    type: 'JOIN',
    character: { name: 'RemotePlayer', color: '#00ff00' },
    position: { x: 5, y: 20, z: 5 },
    rotation: { yaw: 1.57, pitch: 0 },
  });
  const remotePlayerId = gameWelcome2.playerId; // Capture actual ID
  assert(gameWelcome2.type === 'WELCOME', 'Second player received WELCOME');
  assert(gameWelcome2.players.length >= 2, 'Player list shows 2+ players');

  // ─── Group 8: Movement relay ────────────────────────────────
  console.log('\nGroup 8: Movement relay');

  // Set up listener on gameClient1 BEFORE sending move from gameClient2
  const movePromise = waitForMessageType(gameClient1, 'PLAYER_MOVE', 2000);
  gameClient2.ws.send(JSON.stringify({
    type: 'MOVE',
    position: { x: 10, y: 20, z: 10 },
    rotation: { yaw: 3.14, pitch: 0.5 },
  }));

  let moveMsg;
  try {
    moveMsg = await movePromise;
    assert(true, 'Movement relayed to other player');
    assert(moveMsg.playerId === remotePlayerId, 'Move message has correct playerId');
    assert(moveMsg.position.x === 10, 'Move message has correct position X');
    assert(moveMsg.position.z === 10, 'Move message has correct position Z');
  } catch (e) {
    assert(false, `Movement relayed to other player (${e.message})`);
  }

  // ─── Group 9: Block break validation ────────────────────────
  console.log('\nGroup 9: Block break validation');

  // Valid break — host is at (0,20,0), break at (3,20,3) = ~5.2 blocks away (within 6-block reach)
  const breakPromise = waitForMessageType(gameClient2, 'BLOCK_BREAK', 2000);
  gameClient1.ws.send(JSON.stringify({
    type: 'BREAK_BLOCK',
    x: 3, y: 20, z: 3,
  }));
  let breakMsg;
  try {
    breakMsg = await breakPromise;
    assert(true, 'Valid block break relayed to other players');
    assert(breakMsg.x === 3 && breakMsg.y === 20 && breakMsg.z === 3, 'Break has correct coordinates');
  } catch (e) {
    assert(false, `Valid block break relayed (${e.message})`);
  }

  // Invalid break (too far away)
  const errorPromise = new Promise(resolve => {
    gameClient1.ws.once('message', (data) => resolve(JSON.parse(data.toString())));
  });
  gameClient1.ws.send(JSON.stringify({
    type: 'BREAK_BLOCK',
    x: 100, y: 20, z: 100,
  }));
  const errorRes = await Promise.race([
    errorPromise,
    new Promise((resolve) => setTimeout(() => resolve({ type: 'TIMEOUT' }), 500)),
  ]);
  assert(errorRes.type === 'ERROR', 'Invalid block break (too far) returns ERROR');

  // ─── Group 10: Block place validation ───────────────────────
  console.log('\nGroup 10: Block place validation');

  // Drain any pending messages from gameClient2
  await new Promise(r => setTimeout(r, 100));

  const placePromise = waitForMessageType(gameClient2, 'BLOCK_PLACE', 2000);
  gameClient1.ws.send(JSON.stringify({
    type: 'PLACE_BLOCK',
    x: 1, y: 21, z: 1,
    blockType: 3, // Stone
  }));
  let placeMsg;
  try {
    placeMsg = await placePromise;
    assert(true, 'Valid block place relayed to other players');
    assert(placeMsg.blockType === 3, 'Place has correct block type');
  } catch (e) {
    assert(false, `Valid block place relayed (${e.message})`);
  }

  // Invalid place (negative block type)
  await new Promise(r => setTimeout(r, 100));
  const error2Promise = new Promise(resolve => {
    gameClient1.ws.once('message', (data) => resolve(JSON.parse(data.toString())));
  });
  gameClient1.ws.send(JSON.stringify({
    type: 'PLACE_BLOCK',
    x: 1, y: 21, z: 1,
    blockType: -1,
  }));
  const errorRes2 = await Promise.race([
    error2Promise,
    new Promise((resolve) => setTimeout(() => resolve({ type: 'TIMEOUT' }), 500)),
  ]);
  assert(errorRes2.type === 'ERROR', 'Invalid block place (negative type) returns ERROR');

  // ─── Group 11: Heartbeat keepalive ──────────────────────────
  console.log('\nGroup 11: Heartbeat keepalive');

  gameClient1.ws.send(JSON.stringify({ type: 'HEARTBEAT' }));
  await new Promise(r => setTimeout(r, 200)); // Allow processing

  const entry = sessions.get(testSessionId);
  assert(entry !== undefined, 'Session still exists after heartbeat');
  // Check that the actual playerId assigned by server is in the session
  const hasPlayer = Array.from(entry.session.players.keys()).some(id => id === hostPlayerId || id.includes('remote'));
  assert(hasPlayer, 'Host player still in session after heartbeat');
  assert(entry.session.players.size >= 2, `Session has ${entry.session.players.size} players`);

  // ─── Group 12: Max player enforcement ───────────────────────
  console.log('\nGroup 12: Max player enforcement');

  const gameClient3 = await connectWS(testSessionPort);
  await sendMessage(gameClient3.ws, {
    type: 'JOIN',
    character: { name: 'P3', color: '#0000ff' },
    position: { x: 0, y: 20, z: 0 },
  });

  const gameClient4 = await connectWS(testSessionPort);
  await sendMessage(gameClient4.ws, {
    type: 'JOIN',
    character: { name: 'P4', color: '#ffff00' },
    position: { x: 0, y: 20, z: 0 },
  });

  // Now try a 5th player — should be rejected
  const gameClient5 = await connectWS(testSessionPort);
  const fullRes = await sendMessage(gameClient5.ws, {
    type: 'JOIN',
    character: { name: 'P5', color: '#ff00ff' },
    position: { x: 0, y: 20, z: 0 },
  });
  assert(fullRes.type === 'ERROR', '5th player rejected with ERROR');
  assert(fullRes.message === 'Session is full', 'Error message says session is full');

  // ─── Group 13: Player disconnect and PLAYER_LEFT broadcast ──
  console.log('\nGroup 13: Player disconnect handling');

  const disconnectPromise = waitForMessageType(gameClient1, 'PLAYER_LEFT', 2000);
  gameClient2.ws.close();
  let leftMsg;
  try {
    leftMsg = await disconnectPromise;
    assert(true, 'PLAYER_LEFT broadcast when player disconnects');
  } catch (e) {
    assert(false, `PLAYER_LEFT broadcast (${e.message})`);
  }

  // ─── Group 14: Inventory sync ───────────────────────────────
  console.log('\nGroup 14: Inventory sync relay');

  const invPromise = waitForMessageType(gameClient3, 'INVENTORY_SYNC', 2000);
  gameClient1.ws.send(JSON.stringify({
    type: 'INVENTORY_UPDATE',
    inventory: [{ typeId: 1, count: 64 }, { typeId: 3, count: 20 }],
  }));
  let invMsg;
  try {
    invMsg = await invPromise;
    assert(true, 'Inventory update relayed to other players');
    assert(invMsg.type === 'INVENTORY_SYNC', 'Relayed message type is INVENTORY_SYNC');
  } catch (e) {
    assert(false, `Inventory update relayed (${e.message})`);
  }

  // ─── Group 15: HTTP health and sessions endpoints ────────────
  console.log('\nGroup 15: HTTP endpoints');

  const health2 = await fetch(`http://127.0.0.1:${MATCHMAKING_PORT}/health`).then(r => r.json());
  assert(health2.status === 'ok', 'Health endpoint still works mid-test');
  assert(health2.activeSessions >= 1, 'Active sessions tracked in health response');

  const sessionsRes = await fetch(`http://127.0.0.1:${MATCHMAKING_PORT}/sessions`).then(r => r.json());
  assert(Array.isArray(sessionsRes), '/sessions endpoint returns array');

  // ─── Group 16: Edge cases ───────────────────────────────────
  console.log('\nGroup 16: Edge cases');

  // Invalid JSON message
  const mmClient3 = await connectWS(MATCHMAKING_PORT);
  await drainMessages(mmClient3, 1);
  const invalidJsonPromise = new Promise(resolve => {
    mmClient3.ws.once('message', (data) => resolve(JSON.parse(data.toString())));
  });
  mmClient3.ws.send('not json at all {{{');
  const invalidRes = await Promise.race([
    invalidJsonPromise,
    new Promise((resolve) => setTimeout(() => resolve({ type: 'TIMEOUT' }), 500)),
  ]);
  assert(invalidRes.type === 'ERROR', 'Invalid JSON returns ERROR message');

  // Unknown message type
  const mmClient4 = await connectWS(MATCHMAKING_PORT);
  await drainMessages(mmClient4, 1);
  const unknownPromise = new Promise(resolve => {
    mmClient4.ws.once('message', (data) => resolve(JSON.parse(data.toString())));
  });
  mmClient4.ws.send(JSON.stringify({ type: 'NONEXISTENT_TYPE' }));
  const unknownRes = await Promise.race([
    unknownPromise,
    new Promise((resolve) => setTimeout(() => resolve({ type: 'TIMEOUT' }), 500)),
  ]);
  assert(unknownRes.type === 'ERROR', 'Unknown message type returns ERROR');

  // HOST without name
  const mmClient5 = await connectWS(MATCHMAKING_PORT);
  await drainMessages(mmClient5, 1);
  const noNamePromise = new Promise(resolve => {
    mmClient5.ws.once('message', (data) => resolve(JSON.parse(data.toString())));
  });
  mmClient5.ws.send(JSON.stringify({ type: 'HOST' }));
  const noNameRes = await Promise.race([
    noNamePromise,
    new Promise((resolve) => setTimeout(() => resolve({ type: 'TIMEOUT' }), 500)),
  ]);
  assert(noNameRes.type === 'ERROR', 'HOST without name returns ERROR');

  // HOST without worldSeed
  const mmClient6 = await connectWS(MATCHMAKING_PORT);
  await drainMessages(mmClient6, 1);
  const noSeedPromise = new Promise(resolve => {
    mmClient6.ws.once('message', (data) => resolve(JSON.parse(data.toString())));
  });
  mmClient6.ws.send(JSON.stringify({ type: 'HOST', name: 'NoSeed' }));
  const noSeedRes = await Promise.race([
    noSeedPromise,
    new Promise((resolve) => setTimeout(() => resolve({ type: 'TIMEOUT' }), 500)),
  ]);
  assert(noSeedRes.type === 'ERROR', 'HOST without worldSeed returns ERROR');

  // JOIN nonexistent session
  const mmClient7 = await connectWS(MATCHMAKING_PORT);
  await drainMessages(mmClient7, 1);
  const badJoinPromise = new Promise(resolve => {
    mmClient7.ws.once('message', (data) => resolve(JSON.parse(data.toString())));
  });
  mmClient7.ws.send(JSON.stringify({ type: 'JOIN', sessionId: 'nonexistent_session_999' }));
  const badJoinRes = await Promise.race([
    badJoinPromise,
    new Promise((resolve) => setTimeout(() => resolve({ type: 'TIMEOUT' }), 500)),
  ]);
  assert(badJoinRes.type === 'JOIN_REJECTED', 'JOIN nonexistent session returns JOIN_REJECTED');

  // LEAVE matchmaking
  const mmClient8 = await connectWS(MATCHMAKING_PORT);
  await drainMessages(mmClient8, 1);
  const leavePromise = new Promise(resolve => {
    mmClient8.ws.once('message', (data) => resolve(JSON.parse(data.toString())));
  });
  mmClient8.ws.send(JSON.stringify({ type: 'LEAVE' }));
  const leaveRes = await Promise.race([
    leavePromise,
    new Promise((resolve) => setTimeout(() => resolve({ type: 'TIMEOUT' }), 500)),
  ]);
  assert(leaveRes.type === 'LEFT_LOBBY', 'LEAVE returns LEFT_LOBBY message');

  // ─── Cleanup ────────────────────────────────────────────────
  console.log('\nCleaning up...');
  mmClient1.ws.close();
  mmClient2.ws.close();
  gameClient1.ws.close();
  gameClient3.ws.close();
  gameClient4.ws.close();
  gameClient5.ws.close();
  cleanup();

  // Wait for servers to fully close
  await new Promise(r => setTimeout(r, 500));

  // ─── Summary ────────────────────────────────────────────────
  console.log('\n===================================');
  console.log(`Results: ${passCount} passed, ${failCount} failed`);
  console.log('===================================');

  if (failCount > 0) {
    console.error('\n❌ Failures:');
    failures.forEach(f => console.error(`  - ${f}`));
    process.exit(1);
  } else {
    console.log('\n🎉 All server integration tests passing!');
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('Test runner error:', err.message);
  cleanup();
  process.exit(1);
});
