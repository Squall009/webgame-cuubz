#!/usr/bin/env node
/**
 * Cuubz — Server Module Tests
 * Tests for matchmaking relay, session manager, and server entry point.
 */

'use strict';

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

// ─── Group 1: Matchmaking Module Structure ─────────────────────

console.log('Group 1: Matchmaking module structure');

const Matchmaking = require('../server/matchmaking');
assert(typeof Matchmaking === 'function', 'Matchmaking is a class/function');

// Constructor accepts config with required callbacks
const mockConfig = {
  wss: { on: () => {} }, // Mock WebSocketServer
  onHostRequest: () => ({ sessionId: 'test', sessionPort: 8766 }),
  onJoinRequest: () => ({ sessionPort: 8766 }),
  listSessions: () => [],
  onSessionLeave: () => {},
};

const mm = new Matchmaking(mockConfig);
assert(mm.wss !== undefined, 'Matchmaking stores wss reference');
assert(typeof mm.onHostRequest === 'function', 'onHostRequest callback stored');
assert(typeof mm._generatePlayerId === 'function', '_generatePlayerId method exists');

// Player ID generation
const pid = mm._generatePlayerId();
assert(pid.startsWith('player_'), 'Player ID starts with "player_"');
assert(pid.length > 15, 'Player ID has sufficient length');

// ─── Group 2: Session Manager Module Structure ─────────────────

console.log('\nGroup 2: Session manager module structure');

const SessionManager = require('../server/session');
assert(typeof SessionManager === 'function', 'SessionManager is a class/function');

const sessionConfig = {
  wss: { on: () => {} },
  sessionId: 'test_session',
  hostId: 'host_player',
  maxPlayers: 4,
  heartbeatInterval: 30000,
};

const session = new SessionManager(sessionConfig);
assert(session.sessionId === 'test_session', 'Session ID stored correctly');
assert(session.hostId === 'host_player', 'Host ID stored correctly');
assert(session.maxPlayers === 4, 'Max players stored correctly');
assert(session.players instanceof Map, 'Players is a Map');

// ─── Group 3: Session Manager — Player Capacity ────────────────

console.log('\nGroup 3: Session player capacity');

assert(session.canPlayerJoin() === true, 'Session accepts players when empty');

// Simulate adding players (internal state)
for (let i = 0; i < 4; i++) {
  session.players.set('player_' + i, {
    playerId: 'player_' + i,
    ws: {},
    character: { name: 'Player' + i, color: '#ffffff' },
    position: { x: 0, y: 20, z: 0 },
    rotation: { yaw: 0, pitch: 0 },
    lastHeartbeat: Date.now(),
  });
}

assert(session.canPlayerJoin() === false, 'Session rejects players when full (4/4)');

// ─── Group 4: Session Manager — Player Info ────────────────────

console.log('\nGroup 4: Session info');

const info = session.getSessionInfo();
assert(info.sessionId === 'test_session', 'Session info has correct ID');
assert(info.players === 4, 'Session info shows 4 players');
assert(info.maxPlayers === 4, 'Session info shows max 4 players');

// ─── Group 5: Block Validation ─────────────────────────────────

console.log('\nGroup 5: Block validation');

// Add a test player at position (100, 20, 100)
session.players.set('test_player', {
  playerId: 'test_player',
  ws: {},
  character: { name: 'Test', color: '#ff0000' },
  position: { x: 100.5, y: 20.3, z: 100.7 },
  rotation: { yaw: 0, pitch: 0 },
  lastHeartbeat: Date.now(),
});

// Valid break (within reach)
const validBreak = session._validateBlockBreak('test_player', 100, 20, 105);
assert(validBreak === true, 'Break within range (dist ~5) is valid');

// Invalid break (too far)
const invalidBreak = session._validateBlockBreak('test_player', 200, 20, 200);
assert(invalidBreak === false, 'Break too far away is invalid');

// Invalid break (out of world bounds)
const outOfBounds = session._validateBlockBreak('test_player', 100, -50, 100);
assert(outOfBounds === false, 'Break below world bounds is invalid');

// Non-integer coordinates
const floatCoords = session._validateBlockBreak('test_player', 100.5, 20, 100);
assert(floatCoords === false, 'Float coordinates rejected for break');

// Valid place (within reach)
const validPlace = session._validateBlockPlace('test_player', 101, 21, 101, 3);
assert(validPlace === true, 'Place within range is valid');

// Invalid place (non-existent player)
const noPlayer = session._validateBlockPlace('ghost', 100, 20, 100, 3);
assert(noPlayer === false, 'Non-existent player rejected for place');

// Invalid place (negative block type)
const negBlock = session._validateBlockPlace('test_player', 101, 21, 101, -1);
assert(negBlock === false, 'Negative block type rejected for place');

// ─── Group 6: Session Manager — Player List ────────────────────

console.log('\nGroup 6: Player list');

const playerList = session._getPlayerList();
assert(Array.isArray(playerList), 'getPlayerList returns array');
assert(playerList.length === 5, 'Player list has correct count (4 + test_player)');
assert(playerList[0].playerId !== undefined, 'Each entry has playerId');
assert(playerList[0].name !== undefined, 'Each entry has name');

// ─── Group 7: Session Manager — Remove Player ──────────────────

console.log('\nGroup 7: Player removal');

const beforeCount = session.players.size;
session._removePlayer('player_0');
assert(session.players.size === beforeCount - 1, 'Player count decreased after removal');
assert(!session.players.has('player_0'), 'Removed player not in map');

// ─── Group 8: Session Manager — Dispose ────────────────────────

console.log('\nGroup 8: Session dispose');

const session2 = new SessionManager({
  wss: { on: () => {}, close: () => {} },
  sessionId: 'dispose_test',
  hostId: 'host',
  maxPlayers: 2,
  heartbeatInterval: 1000,
});

session2.dispose();
assert(session2._disposed === true, 'Session marked as disposed');

// Double dispose should not error
session2.dispose();
assert(true, 'Double dispose does not throw');

// ─── Group 9: Server index.js structure ─────────────────────────

console.log('\nGroup 9: Server entry point');

// Verify server files exist and are valid JS
try {
  require.resolve('../server/index.js');
  assert(true, 'server/index.js is a valid module');
} catch (e) {
  assert(false, 'server/index.js failed to resolve: ' + e.message);
}

try {
  require.resolve('../server/package.json');
  assert(true, 'server/package.json exists');
} catch (e) {
  assert(false, 'server/package.json not found');
}

// Verify package.json has ws dependency
const pkg = require('../server/package.json');
assert(pkg.dependencies && pkg.dependencies.ws, 'package.json has ws dependency');
assert(pkg.scripts && pkg.scripts.start, 'package.json has start script');

// ─── Group 10: Heartbeat tracking ──────────────────────────────

console.log('\nGroup 10: Heartbeat');

const session3 = new SessionManager({
  wss: { on: () => {} },
  sessionId: 'hb_test',
  hostId: 'host',
  maxPlayers: 4,
  heartbeatInterval: 5000,
});

session3.players.set('hb_player', {
  playerId: 'hb_player',
  ws: {},
  character: { name: 'HB', color: '#00ff00' },
  position: { x: 0, y: 20, z: 0 },
  rotation: { yaw: 0, pitch: 0 },
  lastHeartbeat: Date.now() - 10000, // Old heartbeat
});

const beforeHb = session3.players.get('hb_player').lastHeartbeat;
session3._handleHeartbeat('hb_player');
const afterHb = session3.players.get('hb_player').lastHeartbeat;
assert(afterHb > beforeHb, 'Heartbeat timestamp updated after _handleHeartbeat');

// ─── Summary ────────────────────────────────────────────────────

console.log('\n===================================');
console.log(`Results: ${passCount} passed, ${failCount} failed`);
console.log('===================================');

if (failCount > 0) {
  console.error('\n❌ Failures:');
  failures.forEach(f => console.error(`  - ${f}`));
  process.exit(1);
} else {
  console.log('\n🎉 All server tests passing!');
  process.exit(0);
}
