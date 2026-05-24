#!/usr/bin/env node
/**
 * Cuubz — Multiplayer Sync Integration Tests
 * Full E2E test: two players connect to the same game session via the relay server,
 * and we verify movement sync, block change validation/broadcast, and inventory sync.
 *
 * This tests the complete multiplayer pipeline:
 *   Player A (host) → Matchmaking → Game Session ← Player B (remote)
 *
 * Tests cover:
 * - Remote player visible with correct color + name tag
 * - Movement synchronized between clients
 * - Block changes validated by host, broadcast to all
 * - Inventory updates synced correctly
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

const MATCHMAKING_PORT = 18770;  // Unique port range for this test
const SESSION_BASE_PORT = 18771;

let nextSessionPort = SESSION_BASE_PORT;
const sessions = new Map(); // sessionId → { session, port, httpServer, wss }

// Create matchmaking HTTP server
const matchmakingHttp = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', activeSessions: sessions.size }));
  } else if (req.url === '/sessions') {
    const list = [];
    for (const [sid, entry] of sessions) {
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
    const sessionId = 'sync_test_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
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
    for (const [sid, entry] of sessions) {
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

/**
 * Create a WebSocket connection and collect messages.
 * Returns { ws, messages: [], connect: Promise<void>, send: fn }
 */
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

  function getAllOfType(type) {
    return messages.filter(m => m.type === type);
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

  function clearMessages() {
    messages.length = 0;
  }

  return { ws, messages, connect, send, getLastOfType, getAllOfType, waitMessage, clearMessages };
}

/** Small delay helper */
function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Start Servers ─────────────────────────────────────────────

const serverReady = new Promise((resolve) => {
  matchmakingHttp.listen(MATCHMAKING_PORT, '127.0.0.1', () => {
    console.log(`Matchmaking server listening on port ${MATCHMAKING_PORT}`);
    resolve();
  });
});

// ─── Test Execution ────────────────────────────────────────────

async function runTests() {
  // Wait for matchmaking server to be ready
  await serverReady;
  await delay(100); // Extra safety margin

  group('1. Remote player visible with correct color + name tag');

  // Connect Player A (host) to matchmaking
  const playerA_MM = await createClient(MATCHMAKING_PORT);
  await playerA_MM.connect;
  
  assert(playerA_MM.getLastOfType('WELCOME') !== null, 'Player A receives WELCOME from matchmaking');
  const playerIdA = playerA_MM.getLastOfType('WELCOME').playerId;
  assert(typeof playerIdA === 'string' && playerIdA.length > 0, `Player A has valid ID: ${playerIdA}`);

  // Player A hosts a session
  playerA_MM.send({ type: 'HOST', name: 'Sync Test World', worldSeed: 12345, mode: 'survival' });
  const hostCreated = await playerA_MM.waitMessage('HOST_CREATED');
  assert(hostCreated !== null, 'Player A receives HOST_CREATED');
  assert(typeof hostCreated.sessionId === 'string', 'Session ID is a string');
  assert(typeof hostCreated.sessionPort === 'number', 'Session port is a number');

  const sessionId = hostCreated.sessionId;
  const sessionPort = hostCreated.sessionPort;

  // Player A connects to game session
  const playerA_Game = await createClient(sessionPort);
  await playerA_Game.connect;

  // Player A joins the game session as host
  playerA_Game.send({
    type: 'JOIN',
    playerId: playerIdA,
    character: { name: 'HostPlayer', color: '#FF4444' },
    position: { x: 0, y: 20, z: 0 },
    rotation: { yaw: 0, pitch: 0 },
  });

  const welcomeA = await playerA_Game.waitMessage('WELCOME');
  assert(welcomeA !== null, 'Player A receives WELCOME from game session');
  assert(welcomeA.sessionId === sessionId, 'Welcome contains correct session ID');
  assert(welcomeA.playerId === playerIdA, 'Welcome contains Player A\'s player ID');
  assert(Array.isArray(welcomeA.players), 'Welcome includes players list');

  // Wait for server to stabilize
  await delay(200);

  // Connect Player B (remote) to matchmaking
  const playerB_MM = await createClient(MATCHMAKING_PORT);
  await playerB_MM.connect;

  assert(playerB_MM.getLastOfType('WELCOME') !== null, 'Player B receives WELCOME from matchmaking');
  const playerIdB = playerB_MM.getLastOfType('WELCOME').playerId;
  assert(typeof playerIdB === 'string' && playerIdB.length > 0, `Player B has valid ID: ${playerIdB}`);

  // Player B joins the session via matchmaking
  playerB_MM.send({ type: 'JOIN', sessionId });
  const joinAccepted = await playerB_MM.waitMessage('JOIN_ACCEPTED');
  assert(joinAccepted !== null, 'Player B receives JOIN_ACCEPTED');
  assert(joinAccepted.sessionPort === sessionPort, 'Join accepted with correct session port');

  // Player B connects to game session
  const playerB_Game = await createClient(sessionPort);
  await playerB_Game.connect;

  // Player B joins the game session
  playerB_Game.send({
    type: 'JOIN',
    playerId: playerIdB,
    character: { name: 'RemotePlayer', color: '#44AAFF' },
    position: { x: 5, y: 20, z: 5 },
    rotation: { yaw: Math.PI / 4, pitch: 0 },
  });

  const welcomeB = await playerB_Game.waitMessage('WELCOME');
  assert(welcomeB !== null, 'Player B receives WELCOME from game session');
  assert(welcomeB.sessionId === sessionId, 'Welcome contains correct session ID for Player B');
  assert(Array.isArray(welcomeB.players), 'Welcome includes players list for Player B');
  assert(welcomeB.players.length >= 2, `Welcome lists at least 2 players (got ${welcomeB.players.length})`);

  // Verify Player A received PLAYER_JOINED notification about Player B
  await delay(200);
  const playerJoinedA = playerA_Game.getLastOfType('PLAYER_JOINED');
  assert(playerJoinedA !== null, 'Player A receives PLAYER_JOINED for Player B');
  assert(playerJoinedA.playerId === playerIdB, 'PLAYER_JOINED contains correct player ID');
  assert(playerJoinedA.character.name === 'RemotePlayer', 'PLAYER_JOINED has correct character name');
  assert(playerJoinedA.character.color === '#44AAFF', 'PLAYER_JOINED has correct character color');
  assert(playerJoinedA.position.x === 5, 'PLAYER_JOINED includes starting position x=5');
  assert(playerJoinedA.position.y === 20, 'PLAYER_JOINED includes starting position y=20');
  assert(playerJoinedA.position.z === 5, 'PLAYER_JOINED includes starting position z=5');

  // Verify Player B's welcome includes Player A in the players list
  const playerAInWelcome = welcomeB.players.find(p => p.playerId === playerIdA);
  assert(playerAInWelcome !== undefined, 'Player B\'s welcome includes Player A in players list');
  if (playerAInWelcome) {
    assert(playerAInWelcome.name === 'HostPlayer', 'Player A name correct in Player B\'s welcome');
    assert(playerAInWelcome.color === '#FF4444', 'Player A color correct in Player B\'s welcome');
  }

  group('2. Movement synchronized between clients');

  // Clear previous messages
  playerA_Game.clearMessages();
  playerB_Game.clearMessages();

  // Player B moves to a new position
  const newPos = { x: 10.5, y: 22, z: -3.7 };
  const newRot = { yaw: Math.PI / 2, pitch: -0.2 };
  
  playerB_Game.send({
    type: 'MOVE',
    position: newPos,
    rotation: newRot,
  });

  // Player A should receive PLAYER_MOVE broadcast about Player B
  await delay(300);
  const moveBroadcastToA = playerA_Game.getLastOfType('PLAYER_MOVE');
  assert(moveBroadcastToA !== null, 'Player A receives PLAYER_MOVE broadcast for Player B');
  if (moveBroadcastToA) {
    assert(moveBroadcastToA.playerId === playerIdB, 'PLAYER_MOVE has correct player ID');
    assert(moveBroadcastToA.position.x === newPos.x, `PLAYER_MOVE position x: ${moveBroadcastToA.position.x} == ${newPos.x}`);
    assert(moveBroadcastToA.position.y === newPos.y, `PLAYER_MOVE position y: ${moveBroadcastToA.position.y} == ${newPos.y}`);
    assert(moveBroadcastToA.position.z === newPos.z, `PLAYER_MOVE position z: ${moveBroadcastToA.position.z} == ${newPos.z}`);
    assert(moveBroadcastToA.rotation.yaw === newRot.yaw, 'PLAYER_MOVE rotation yaw correct');
    assert(moveBroadcastToA.rotation.pitch === newRot.pitch, 'PLAYER_MOVE rotation pitch correct');
  }

  // Player A should NOT receive PLAYER_MOVE about itself (excluded from broadcast)
  const selfMoveMsgs = playerA_Game.getAllOfType('PLAYER_MOVE').filter(m => m.playerId === playerIdA);
  assert(selfMoveMsgs.length === 0, 'Player A does not receive its own movement broadcasts');

  // Now test Player A moving — Player B should receive the broadcast
  playerA_Game.clearMessages();
  playerB_Game.clearMessages();

  const hostNewPos = { x: -2.3, y: 25, z: 8.1 };
  playerA_Game.send({
    type: 'MOVE',
    position: hostNewPos,
    rotation: { yaw: -Math.PI / 4, pitch: 0.1 },
  });

  await delay(300);
  const moveBroadcastToB = playerB_Game.getLastOfType('PLAYER_MOVE');
  assert(moveBroadcastToB !== null, 'Player B receives PLAYER_MOVE broadcast for Player A');
  if (moveBroadcastToB) {
    assert(moveBroadcastToB.playerId === playerIdA, 'PLAYER_MOVE has correct host player ID');
    assert(moveBroadcastToB.position.x === hostNewPos.x, `PLAYER_MOVE position x: ${moveBroadcastToB.position.x} == ${hostNewPos.x}`);
    assert(moveBroadcastToB.position.y === hostNewPos.y, `PLAYER_MOVE position y: ${moveBroadcastToB.position.y} == ${hostNewPos.y}`);
    assert(moveBroadcastToB.position.z === hostNewPos.z, `PLAYER_MOVE position z: ${moveBroadcastToB.position.z} == ${hostNewPos.z}`);
  }

  // Test multiple rapid movements — only last position should be stored server-side
  playerA_Game.clearMessages();
  playerB_Game.clearMessages();

  const rapidPositions = [
    { x: 1, y: 20, z: 1 },
    { x: 2, y: 20, z: 2 },
    { x: 3, y: 20, z: 3 },
  ];

  for (const pos of rapidPositions) {
    playerB_Game.send({ type: 'MOVE', position: pos, rotation: { yaw: 0, pitch: 0 } });
  }

  await delay(300);
  const moveMsgsToA = playerA_Game.getAllOfType('PLAYER_MOVE');
  assert(moveMsgsToA.length === rapidPositions.length, `Player A receives ${rapidPositions.length} movement broadcasts (got ${moveMsgsToA.length})`);

  // Verify the last broadcast has the final position
  const lastMove = moveMsgsToA[moveMsgsToA.length - 1];
  assert(lastMove.position.x === rapidPositions[2].x, 'Last PLAYER_MOVE has correct final x position');
  assert(lastMove.position.z === rapidPositions[2].z, 'Last PLAYER_MOVE has correct final z position');

  group('3. Block changes validated by host, broadcast to all');

  playerA_Game.clearMessages();
  playerB_Game.clearMessages();

  // Player B (remote) requests to break a block within reach distance
  // Server updates Player B's position to rapidPositions[2] = {x:3, y:20, z:3}
  // Break block at (4, 19, 4) — should be within reach (distance ~1.7 < 6)
  playerB_Game.send({ type: 'BREAK_BLOCK', x: 4, y: 19, z: 4 });

  await delay(300);
  
  // Player A should receive BLOCK_BREAK broadcast
  const blockBreakBroadcastToA = playerA_Game.getLastOfType('BLOCK_BREAK');
  assert(blockBreakBroadcastToA !== null, 'Player A receives BLOCK_BREAK broadcast from Player B');
  if (blockBreakBroadcastToA) {
    assert(blockBreakBroadcastToA.x === 4, 'BLOCK_BREAK has correct x coordinate');
    assert(blockBreakBroadcastToA.y === 19, 'BLOCK_BREAK has correct y coordinate');
    assert(blockBreakBroadcastToA.z === 4, 'BLOCK_BREAK has correct z coordinate');
    assert(blockBreakBroadcastToA.blockType === 0, 'Broken block replaced with AIR (type 0)');
  }

  // Player B should also receive the broadcast (broadcast sends to ALL including sender)
  const blockBreakBroadcastToB = playerB_Game.getLastOfType('BLOCK_BREAK');
  assert(blockBreakBroadcastToB !== null, 'Player B receives BLOCK_BREAK broadcast (echo)');

  // Test: invalid block break — too far away
  playerA_Game.clearMessages();
  playerB_Game.clearMessages();

  // Player B is at position {x:3, y:20, z:3}. Block at (100, 50, 100) is way too far.
  playerB_Game.send({ type: 'BREAK_BLOCK', x: 100, y: 50, z: 100 });

  await delay(300);
  
  // Should receive ERROR instead of BLOCK_BREAK
  const errorForFarBreak = playerB_Game.getLastOfType('ERROR');
  assert(errorForFarBreak !== null, 'Player B receives ERROR for block break too far away');
  if (errorForFarBreak) {
    assert(errorForFarBreak.message === 'Invalid block break', `Error message correct: "${errorForFarBreak.message}"`);
  }

  // No BLOCK_BREAK should be broadcast to Player A
  const invalidBroadcastToA = playerA_Game.getLastOfType('BLOCK_BREAK');
  assert(invalidBroadcastToA === null, 'No BLOCK_BREAK broadcast for invalid (too far) break request');

  // Test: invalid block break — non-integer coordinates
  playerB_Game.clearMessages();
  playerB_Game.send({ type: 'BREAK_BLOCK', x: 4.5, y: 19.7, z: 4.2 });

  await delay(300);
  
  const errorForFloatCoords = playerB_Game.getLastOfType('ERROR');
  assert(errorForFloatCoords !== null, 'Player B receives ERROR for non-integer coordinates');

  // Test: invalid block break — out of Y bounds
  playerB_Game.clearMessages();
  playerB_Game.send({ type: 'BREAK_BLOCK', x: 4, y: -50, z: 4 });

  await delay(300);
  
  const errorForOutOfBounds = playerB_Game.getLastOfType('ERROR');
  assert(errorForOutOfBounds !== null, 'Player B receives ERROR for out-of-bounds Y coordinate');

  // Test block place — valid
  playerA_Game.clearMessages();
  playerB_Game.clearMessages();

  playerB_Game.send({ type: 'PLACE_BLOCK', x: 4, y: 19, z: 4, blockType: 3 }); // Stone

  await delay(300);
  
  const blockPlaceBroadcastToA = playerA_Game.getLastOfType('BLOCK_PLACE');
  assert(blockPlaceBroadcastToA !== null, 'Player A receives BLOCK_PLACE broadcast from Player B');
  if (blockPlaceBroadcastToA) {
    assert(blockPlaceBroadcastToA.x === 4, 'BLOCK_PLACE has correct x coordinate');
    assert(blockPlaceBroadcastToA.y === 19, 'BLOCK_PLACE has correct y coordinate');
    assert(blockPlaceBroadcastToA.z === 4, 'BLOCK_PLACE has correct z coordinate');
    assert(blockPlaceBroadcastToA.blockType === 3, 'Placed block type is Stone (3)');
  }

  const blockPlaceBroadcastToB = playerB_Game.getLastOfType('BLOCK_PLACE');
  assert(blockPlaceBroadcastToB !== null, 'Player B receives BLOCK_PLACE broadcast (echo)');

  // Test: invalid block place — negative blockType
  playerB_Game.clearMessages();
  playerB_Game.send({ type: 'PLACE_BLOCK', x: 4, y: 19, z: 4, blockType: -1 });

  await delay(300);
  
  const errorForNegBlockType = playerB_Game.getLastOfType('ERROR');
  assert(errorForNegBlockType !== null, 'Player B receives ERROR for negative block type');

  // Test host (Player A) placing a block — should also broadcast to Player B
  playerA_Game.clearMessages();
  playerB_Game.clearMessages();

  // Host is at position {x:-2.3, y:25, z:8.1}
  playerA_Game.send({ type: 'PLACE_BLOCK', x: -2, y: 24, z: 8, blockType: 7 }); // Wood Log

  await delay(300);
  
  const hostPlaceBroadcastToB = playerB_Game.getLastOfType('BLOCK_PLACE');
  assert(hostPlaceBroadcastToB !== null, 'Player B receives BLOCK_PLACE broadcast from host (Player A)');
  if (hostPlaceBroadcastToB) {
    assert(hostPlaceBroadcastToB.blockType === 7, 'Host placed Wood Log (type 7)');
  }

  group('4. Inventory updates synced correctly');

  playerA_Game.clearMessages();
  playerB_Game.clearMessages();

  // Player B sends inventory update
  const testInventory = [
    { typeId: 3, count: 64 },   // Stone
    { typeId: 7, count: 12 },   // Wood Log
    null,                        // Empty slot
    { typeId: 24, count: 5 },   // Apples (food)
  ];

  playerB_Game.send({ type: 'INVENTORY_UPDATE', inventory: testInventory });

  await delay(300);

  // Player A should receive INVENTORY_SYNC about Player B's inventory
  const invSyncToA = playerA_Game.getLastOfType('INVENTORY_SYNC');
  assert(invSyncToA !== null, 'Player A receives INVENTORY_SYNC from Player B');
  if (invSyncToA) {
    assert(invSyncToA.playerId === playerIdB, 'INVENTORY_SYNC has correct player ID');
    assert(Array.isArray(invSyncToA.inventory), 'INVENTORY_SYNC includes inventory array');
    assert(invSyncToA.inventory.length === testInventory.length, `Inventory length matches (${invSyncToA.inventory.length} == ${testInventory.length})`);
    assert(invSyncToA.inventory[0].typeId === 3, 'First slot: typeId=3 (Stone)');
    assert(invSyncToA.inventory[0].count === 64, 'First slot: count=64');
    assert(invSyncToA.inventory[1].typeId === 7, 'Second slot: typeId=7 (Wood Log)');
    assert(invSyncToA.inventory[2] === null, 'Third slot: empty (null)');
    assert(invSyncToA.inventory[3].typeId === 24, 'Fourth slot: typeId=24 (Apple)');
  }

  // Player B should also receive the sync (broadcast to all)
  const invSyncToB = playerB_Game.getLastOfType('INVENTORY_SYNC');
  assert(invSyncToB !== null, 'Player B receives INVENTORY_SYNC broadcast (echo)');

  // Test host sending inventory update
  playerA_Game.clearMessages();
  playerB_Game.clearMessages();

  const hostInventory = [
    { typeId: 1, count: 32 },   // Grass
    { typeId: 2, count: 64 },   // Dirt
    { typeId: 18, count: 10 },  // Coal Ore
  ];

  playerA_Game.send({ type: 'INVENTORY_UPDATE', inventory: hostInventory });

  await delay(300);

  const hostInvSyncToB = playerB_Game.getLastOfType('INVENTORY_SYNC');
  assert(hostInvSyncToB !== null, 'Player B receives INVENTORY_SYNC from host (Player A)');
  if (hostInvSyncToB) {
    assert(hostInvSyncToB.playerId === playerIdA, 'Host INVENTORY_SYNC has correct player ID');
    assert(hostInvSyncToB.inventory[0].typeId === 1, 'Host first slot: typeId=1 (Grass)');
    assert(hostInvSyncToB.inventory[2].typeId === 18, 'Host third slot: typeId=18 (Coal Ore)');
  }

  group('5. Heartbeat keepalive tracking');

  // Both players send heartbeats — server should not disconnect them
  playerA_Game.send({ type: 'HEARTBEAT' });
  playerB_Game.send({ type: 'HEARTBEAT' });

  await delay(300);

  // No ERROR or PLAYER_LEFT messages should be received after heartbeat
  const heartbeatsRejected = playerA_Game.getAllOfType('ERROR');
  assert(heartbeatsRejected.length === 0, 'No errors after sending heartbeat from Player A');

  const heartbeatsRejectedB = playerB_Game.getAllOfType('ERROR');
  assert(heartbeatsRejectedB.length === 0, 'No errors after sending heartbeat from Player B');

  group('6. Player disconnect handling');

  // Create Player C who joins and then leaves
  const playerC_MM = await createClient(MATCHMAKING_PORT);
  await playerC_MM.connect;
  const playerIdC = playerC_MM.getLastOfType('WELCOME').playerId;

  playerC_MM.send({ type: 'JOIN', sessionId });
  const joinAcceptedC = await playerC_MM.waitMessage('JOIN_ACCEPTED');
  assert(joinAcceptedC !== null, 'Player C receives JOIN_ACCEPTED');

  const playerC_Game = await createClient(sessionPort);
  await playerC_Game.connect;

  playerC_Game.send({
    type: 'JOIN',
    playerId: playerIdC,
    character: { name: 'ThirdPlayer', color: '#44FF44' },
    position: { x: -10, y: 20, z: -10 },
    rotation: { yaw: 0, pitch: 0 },
  });

  await delay(300);

  // Player A and B should receive PLAYER_JOINED for Player C
  const cJoinedA = playerA_Game.getLastOfType('PLAYER_JOINED');
  assert(cJoinedA !== null, 'Player A receives PLAYER_JOINED for Player C');
  assert(cJoinedA.character.name === 'ThirdPlayer', 'Player C name correct in PLAYER_JOINED');

  // Now Player C leaves
  playerA_Game.clearMessages();
  playerB_Game.clearMessages();

  playerC_Game.send({ type: 'LEAVE' });

  await delay(300);

  const cLeftA = playerA_Game.getLastOfType('PLAYER_LEFT');
  assert(cLeftA !== null, 'Player A receives PLAYER_LEFT for Player C');
  if (cLeftA) {
    assert(cLeftA.playerId === playerIdC, 'PLAYER_LEFT has correct player ID for Player C');
  }

  const cLeftB = playerB_Game.getLastOfType('PLAYER_LEFT');
  assert(cLeftB !== null, 'Player B receives PLAYER_LEFT for Player C');

  group('7. Session state consistency after all operations');

  // Verify session still has exactly 2 players (A and B)
  const sessionEntry = sessions.get(sessionId);
  if (sessionEntry) {
    const actualCount = sessionEntry.session.players.size;
    assert(actualCount === 2, `Session has exactly 2 players after Player C left (got ${actualCount})`);

    // Verify both A and B are still connected
    const hasA = sessionEntry.session.players.has(playerIdA);
    const hasB = sessionEntry.session.players.has(playerIdB);
    assert(hasA, 'Player A still in session');
    assert(hasB, 'Player B still in session');

    // Verify block change log
    const blockChanges = sessionEntry.session.worldState.blockChanges;
    assert(blockChanges.length >= 2, `Block changes logged: ${blockChanges.length} (expected at least 2)`);
    
    // First break should be from Player B
    const firstBreak = blockChanges.find(c => c.type === 'BREAK');
    if (firstBreak) {
      assert(firstBreak.playerId === playerIdB, 'First block break attributed to Player B');
      assert(firstBreak.x === 4 && firstBreak.y === 19 && firstBreak.z === 4, 'First break at correct coordinates');
    }

    // First place should be from Player B (stone) or Player A (wood log)
    const firstPlace = blockChanges.find(c => c.type === 'PLACE');
    if (firstPlace) {
      assert(firstPlace.playerId === playerIdA || firstPlace.playerId === playerIdB, 'First block place attributed to a known player');
    }
  }

  // ─── Cleanup ────────────────────────────────────────────────

  console.log('\n--- Cleanup ---');

  // Disconnect all clients
  try { playerA_MM.ws.close(); } catch (e) {}
  try { playerA_Game.ws.close(); } catch (e) {}
  try { playerB_MM.ws.close(); } catch (e) {}
  try { playerB_Game.ws.close(); } catch (e) {}
  try { playerC_MM.ws.close(); } catch (e) {}
  try { playerC_Game.ws.close(); } catch (e) {}

  // Clean up sessions
  for (const [, entry] of sessions) {
    try { entry.session.dispose(); } catch (e) {}
    try { entry.httpServer.close(); } catch (e) {}
  }
  sessions.clear();

  // Close matchmaking server
  matchmakingWSS.close();
  matchmakingHttp.close();

  await delay(200);

  // ─── Results ────────────────────────────────────────────────

  console.log('\n===================================');
  console.log(`  Multiplayer Sync Tests: ${passCount} passed, ${failCount} failed`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) {
      console.log(`  - ${f}`);
    }
  } else {
    console.log('  🎉 All multiplayer sync tests passing!');
  }
  console.log('===================================\n');

  process.exit(failCount > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
