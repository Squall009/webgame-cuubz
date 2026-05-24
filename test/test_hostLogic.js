/**
 * Cuubz — Host Logic Tests
 * Tests for js/multiplayer/host.js
 *
 * Test coverage:
 * - Validation functions (block break, block place, move, inventory, quest)
 * - RateLimiter class
 * - RemotePlayerState class
 * - HostManager class (full lifecycle)
 * - Edge cases and error handling
 */

'use strict';

const assert = require('assert');
const path = require('path');

// Import host module
const {
  HOST_STATE,
  DEFAULT_HOST_CONFIG,
  validateBlockBreak,
  validateBlockPlace,
  validateMove,
  validateInventory,
  validateQuestUpdate,
  RateLimiter,
  RemotePlayerState,
  HostManager,
} = require(path.join(__dirname, '..', 'js', 'multiplayer', 'host'));

let passed = 0;
let failed = 0;
let totalAssertions = 0;

function assertEqual(actual, expected, message) {
  totalAssertions++;
  try {
    assert.strictEqual(actual, expected, message);
    passed++;
  } catch (err) {
    failed++;
    console.error(`  ❌ FAIL: ${message || 'Assertion failed'} — Expected: ${expected}, Got: ${actual}`);
  }
}

function assertDeepEqual(actual, expected, message) {
  totalAssertions++;
  try {
    assert.deepStrictEqual(actual, expected, message);
    passed++;
  } catch (err) {
    failed++;
    console.error(`  ❌ FAIL: ${message || 'Assertion failed'} — Expected: ${JSON.stringify(expected)}, Got: ${JSON.stringify(actual)}`);
  }
}

function assertTrue(value, message) {
  totalAssertions++;
  try {
    assert.ok(value, message);
    passed++;
  } catch (err) {
    failed++;
    console.error(`  ❌ FAIL: ${message || 'Expected true'} — Got: ${value}`);
  }
}

function assertFalse(value, message) {
  totalAssertions++;
  try {
    assert.ok(!value, message);
    passed++;
  } catch (err) {
    failed++;
    console.error(`  ❌ FAIL: ${message || 'Expected false'} — Got: ${value}`);
  }
}

function assertThrows(fn, message) {
  totalAssertions++;
  try {
    let threw = false;
    try {
      fn();
    } catch (e) {
      threw = true;
    }
    assert.ok(threw, message || 'Expected function to throw');
    passed++;
  } catch (err) {
    failed++;
    console.error(`  ❌ FAIL: ${message || 'Expected throw'} — ${err.message}`);
  }
}

// ═══════════════════════════════════════════════════════════
// Test Groups
// ═══════════════════════════════════════════════════════════

console.log('=== Host Logic Tests ===\n');

// ─── Test Group 1: Constants ──────────────────────────────

console.log('\n--- Test Group 1: HOST_STATE constants ---');

assertEqual(HOST_STATE.IDLE, 'idle', 'HOST_STATE.IDLE is "idle"');
assertEqual(HOST_STATE.CONNECTING, 'connecting', 'HOST_STATE.CONNECTING is "connecting"');
assertEqual(HOST_STATE.HOSTING, 'hosting', 'HOST_STATE.HOSTING is "hosting"');
assertEqual(HOST_STATE.ACTIVE, 'active', 'HOST_STATE.ACTIVE is "active"');
assertEqual(HOST_STATE.ENDING, 'ending', 'HOST_STATE.ENDING is "ending"');

// ─── Test Group 2: DEFAULT_HOST_CONFIG ─────────────────────

console.log('\n--- Test Group 2: DEFAULT_HOST_CONFIG ---');

assertEqual(DEFAULT_HOST_CONFIG.maxPlayers, 4, 'Default maxPlayers is 4');
assertEqual(DEFAULT_HOST_CONFIG.reachDistance, 6, 'Default reachDistance is 6');
assertEqual(DEFAULT_HOST_CONFIG.yMin, -32, 'Default yMin is -32');
assertEqual(DEFAULT_HOST_CONFIG.yMax, 64, 'Default yMax is 64');
assertEqual(DEFAULT_HOST_CONFIG.moveRateLimit, 20, 'Default moveRateLimit is 20');
assertEqual(DEFAULT_HOST_CONFIG.blockChangeCooldown, 100, 'Default blockChangeCooldown is 100ms');

// ─── Test Group 3: validateBlockBreak ──────────────────────

console.log('\n--- Test Group 3: validateBlockBreak ---');

// Valid break
let result = validateBlockBreak('p1', { x: 10, y: 20, z: 10 }, 10, 20, 10);
assertTrue(result.valid, 'Valid block break at player position');

// Non-integer coordinates
result = validateBlockBreak('p1', { x: 10, y: 20, z: 10 }, 10.5, 20, 10);
assertFalse(result.valid, 'Rejects non-integer X coordinate');
assertEqual(result.reason, 'Non-integer coordinates', 'Non-integer reason message');

result = validateBlockBreak('p1', { x: 10, y: 20, z: 10 }, 10, 20.5, 10);
assertFalse(result.valid, 'Rejects non-integer Y coordinate');

// Y out of bounds (below)
result = validateBlockBreak('p1', { x: 10, y: 20, z: 10 }, 10, -33, 10);
assertFalse(result.valid, 'Rejects Y below world minimum');
assertTrue(result.reason.includes('out of bounds'), 'Bounds reason message contains "out of bounds"');

// Y out of bounds (above)
result = validateBlockBreak('p1', { x: 10, y: 20, z: 10 }, 10, 65, 10);
assertFalse(result.valid, 'Rejects Y above world maximum');

// Too far away
result = validateBlockBreak('p1', { x: 10, y: 20, z: 10 }, 100, 20, 10);
assertFalse(result.valid, 'Rejects break too far from player');
assertTrue(result.reason.includes('Too far'), 'Far reason message contains "Too far"');

// Edge case: exactly at reach distance (6 blocks)
result = validateBlockBreak('p1', { x: 10, y: 20, z: 10 }, 16, 20, 10);
assertTrue(result.valid, 'Accepts break exactly at reach distance');

// Edge case: one block beyond reach (sqrt(37) ≈ 6.08)
result = validateBlockBreak('p1', { x: 10, y: 20, z: 10 }, 17, 20, 10);
assertFalse(result.valid, 'Rejects break one block beyond reach');

// No position provided (should accept if coords are valid)
result = validateBlockBreak('p1', null, 10, 20, 10);
assertTrue(result.valid, 'Accepts break with null position');

// Custom config with different bounds
const customConfig = { yMin: -16, yMax: 48, reachDistance: 4 };
result = validateBlockBreak('p1', { x: 10, y: 20, z: 10 }, 10, -17, 10, customConfig);
assertFalse(result.valid, 'Rejects with custom lower bound');

result = validateBlockBreak('p1', { x: 10, y: 20, z: 10 }, 14, 20, 10, customConfig);
assertTrue(result.valid, 'Accepts within custom reach distance');

result = validateBlockBreak('p1', { x: 10, y: 20, z: 10 }, 15, 20, 10, customConfig);
assertFalse(result.valid, 'Rejects beyond custom reach distance');

// ─── Test Group 4: validateBlockPlace ──────────────────────

console.log('\n--- Test Group 4: validateBlockPlace ---');

// Valid place
result = validateBlockPlace('p1', { x: 10, y: 20, z: 10 }, 11, 20, 10, 3);
assertTrue(result.valid, 'Valid block place at adjacent position');

// Invalid block type (negative)
result = validateBlockPlace('p1', { x: 10, y: 20, z: 10 }, 11, 20, 10, -1);
assertFalse(result.valid, 'Rejects negative block type');
assertEqual(result.reason, 'Invalid block type', 'Invalid block type reason');

// Invalid block type (undefined)
result = validateBlockPlace('p1', { x: 10, y: 20, z: 10 }, 11, 20, 10, undefined);
assertFalse(result.valid, 'Rejects undefined block type');

// Invalid block type (null)
result = validateBlockPlace('p1', { x: 10, y: 20, z: 10 }, 11, 20, 10, null);
assertFalse(result.valid, 'Rejects null block type');

// Non-integer coordinates
result = validateBlockPlace('p1', { x: 10, y: 20, z: 10 }, 11.5, 20, 10, 3);
assertFalse(result.valid, 'Rejects non-integer X for place');

// Y out of bounds
result = validateBlockPlace('p1', { x: 10, y: 20, z: 10 }, 11, -33, 10, 3);
assertFalse(result.valid, 'Rejects place below world min');

result = validateBlockPlace('p1', { x: 10, y: 20, z: 10 }, 11, 65, 10, 3);
assertFalse(result.valid, 'Rejects place above world max');

// Too far
result = validateBlockPlace('p1', { x: 10, y: 20, z: 10 }, 100, 20, 10, 3);
assertFalse(result.valid, 'Rejects place too far from player');

// Block type 0 (air) should be valid (technically allowed)
result = validateBlockPlace('p1', { x: 10, y: 20, z: 10 }, 11, 20, 10, 0);
assertTrue(result.valid, 'Accepts block type 0 (air) for place');

// ─── Test Group 5: validateMove ────────────────────────────

console.log('\n--- Test Group 5: validateMove ---');

// Valid move
result = validateMove('p1', { x: 10, y: 20, z: 10 }, { yaw: 0, pitch: 0 });
assertTrue(result.valid, 'Valid move with position and rotation');

// Missing position
result = validateMove('p1', null);
assertFalse(result.valid, 'Rejects missing position');
assertEqual(result.reason, 'Missing position', 'Missing position reason');

// Non-numeric position
result = validateMove('p1', { x: 'a', y: 20, z: 10 });
assertFalse(result.valid, 'Rejects non-numeric X in position');
assertEqual(result.reason, 'Non-numeric position', 'Non-numeric position reason');

// Y out of range (below with tolerance)
result = validateMove('p1', { x: 10, y: -35, z: 10 });
assertFalse(result.valid, 'Rejects Y below acceptable range (-34)');

// Y at lower tolerance boundary
result = validateMove('p1', { x: 10, y: -34, z: 10 });
assertTrue(result.valid, 'Accepts Y at lower tolerance boundary');

// Y at upper tolerance boundary
result = validateMove('p1', { x: 10, y: 66, z: 10 });
assertTrue(result.valid, 'Accepts Y at upper tolerance boundary');

// Y above tolerance boundary
result = validateMove('p1', { x: 10, y: 67, z: 10 });
assertFalse(result.valid, 'Rejects Y above acceptable range (66)');

// Pitch out of range (too high)
result = validateMove('p1', { x: 10, y: 20, z: 10 }, { yaw: 0, pitch: Math.PI });
assertFalse(result.valid, 'Rejects pitch at PI (too high)');

// Pitch out of range (too low)
result = validateMove('p1', { x: 10, y: 20, z: 10 }, { yaw: 0, pitch: -Math.PI });
assertFalse(result.valid, 'Rejects pitch at -PI (too low)');

// Pitch at valid boundary
result = validateMove('p1', { x: 10, y: 20, z: 10 }, { yaw: 0, pitch: Math.PI / 2 });
assertTrue(result.valid, 'Accepts pitch at PI/2');

result = validateMove('p1', { x: 10, y: 20, z: 10 }, { yaw: 0, pitch: -Math.PI / 2 });
assertTrue(result.valid, 'Accepts pitch at -PI/2');

// Non-numeric rotation
result = validateMove('p1', { x: 10, y: 20, z: 10 }, { yaw: 'a', pitch: 0 });
assertFalse(result.valid, 'Rejects non-numeric yaw');
assertEqual(result.reason, 'Non-numeric rotation', 'Non-numeric rotation reason');

// ─── Test Group 6: validateInventory ───────────────────────

console.log('\n--- Test Group 6: validateInventory ---');

// Valid empty inventory
result = validateInventory('p1', []);
assertTrue(result.valid, 'Valid empty inventory array');

// Valid inventory with items
const validInv = [
  { type: 'stone', count: 64 },
  { type: 'wood_log', count: 32 },
  null,
  { blockType: 1, count: 10 },
];
result = validateInventory('p1', validInv);
assertTrue(result.valid, 'Valid inventory with mixed items');

// Invalid: not an array
result = validateInventory('p1', 'not-array');
assertFalse(result.valid, 'Rejects string as inventory');

result = validateInventory('p1', null);
assertFalse(result.valid, 'Rejects null inventory');

result = validateInventory('p1', {});
assertFalse(result.valid, 'Rejects object as inventory');

// Invalid: too large
result = validateInventory('p1', Array(101).fill({ type: 'stone', count: 1 }));
assertFalse(result.valid, 'Rejects inventory with >100 slots');

// Exactly at limit (100 slots) should be valid
result = validateInventory('p1', Array(100).fill({ type: 'stone', count: 1 }));
assertTrue(result.valid, 'Accepts inventory with exactly 100 slots');

// Invalid slot type (not an object)
result = validateInventory('p1', ['string-slot']);
assertFalse(result.valid, 'Rejects string as slot value');

// Missing type/blockType in slot
result = validateInventory('p1', [{ count: 5 }]);
assertFalse(result.valid, 'Rejects slot without type or blockType');

// Invalid count (negative)
result = validateInventory('p1', [{ type: 'stone', count: -1 }]);
assertFalse(result.valid, 'Rejects negative item count');

// Invalid count (too large)
result = validateInventory('p1', [{ type: 'stone', count: 10000 }]);
assertFalse(result.valid, 'Rejects count > 9999');

// Valid count at boundary
result = validateInventory('p1', [{ type: 'stone', count: 9999 }]);
assertTrue(result.valid, 'Accepts count of 9999');

// ─── Test Group 7: validateQuestUpdate ─────────────────────

console.log('\n--- Test Group 7: validateQuestUpdate ---');

// Valid quest update
result = validateQuestUpdate('p1', { questId: 'Q01', progress: 5 });
assertTrue(result.valid, 'Valid quest update');

// Invalid: missing questId
result = validateQuestUpdate('p1', { progress: 5 });
assertFalse(result.valid, 'Rejects update without questId');

// Invalid: non-string questId
result = validateQuestUpdate('p1', { questId: 123, progress: 5 });
assertFalse(result.valid, 'Rejects numeric questId');

// Invalid: missing progress
result = validateQuestUpdate('p1', { questId: 'Q01' });
assertFalse(result.valid, 'Rejects update without progress');

// Invalid: negative progress
result = validateQuestUpdate('p1', { questId: 'Q01', progress: -1 });
assertFalse(result.valid, 'Rejects negative progress');

// Valid: zero progress
result = validateQuestUpdate('p1', { questId: 'Q01', progress: 0 });
assertTrue(result.valid, 'Accepts zero progress');

// Invalid: non-object
result = validateQuestUpdate('p1', 'not-an-object');
assertFalse(result.valid, 'Rejects string as quest update');

result = validateQuestUpdate('p1', null);
assertFalse(result.valid, 'Rejects null quest update');

// ─── Test Group 8: RateLimiter ──────────────────────────────

console.log('\n--- Test Group 8: RateLimiter ---');

const limiter = new RateLimiter(5, 1000); // 5 actions per second

// First 5 should pass
for (let i = 0; i < 5; i++) {
  const r = limiter.check('p1', 'move');
  assertTrue(r.allowed, `Rate limit allows action ${i + 1} of 5`);
}

// 6th should fail
const r6 = limiter.check('p1', 'move');
assertFalse(r6.allowed, 'Rate limit blocks 6th action in window');
assertTrue(typeof r6.retryAfter === 'number', 'retryAfter is a number');
assertTrue(r6.retryAfter > 0, 'retryAfter is positive');

// Different player should not be affected
const rOther = limiter.check('p2', 'move');
assertTrue(rOther.allowed, 'Different player not rate limited');

// Different action type should have separate limit
const rAction = limiter.check('p1', 'block_change');
assertTrue(rAction.allowed, 'Different action type has separate limit');

// Clear player
limiter.clearPlayer('p1');
const rAfterClear = limiter.check('p1', 'move');
assertTrue(rAfterClear.allowed, 'Rate limit resets after clearPlayer');

// Clear all
limiter.clear();
const rAfterAllClear = limiter.check('p2', 'move');
assertTrue(rAfterAllClear.allowed, 'Rate limit resets after clear()');

// ─── Test Group 9: RemotePlayerState ────────────────────────

console.log('\n--- Test Group 9: RemotePlayerState ---');

const player = new RemotePlayerState('p1', { name: 'TestPlayer', color: '#ff0000' }, { x: 10, y: 20, z: 10 });

assertEqual(player.playerId, 'p1', 'Player ID set correctly');
assertDeepEqual(player.character, { name: 'TestPlayer', color: '#ff0000' }, 'Character set correctly');
assertDeepEqual(player.position, { x: 10, y: 20, z: 10 }, 'Position set correctly');
assertDeepEqual(player.rotation, { yaw: 0, pitch: 0 }, 'Default rotation is zero');
assertTrue(player.connected, 'Player starts connected');
assertTrue(player.joinedAt > 0, 'joinedAt is a valid timestamp');

// updatePosition
const beforeUpdate = Date.now();
player.updatePosition({ x: 15, y: 22, z: 12 }, { yaw: Math.PI / 4, pitch: 0.3 });
assertDeepEqual(player.position, { x: 15, y: 22, z: 12 }, 'Position updated');
assertDeepEqual(player.rotation, { yaw: Math.PI / 4, pitch: 0.3 }, 'Rotation updated');
assertTrue(player.lastMoveTime >= beforeUpdate, 'lastMoveTime updated after position change');

// getStateSummary
const summary = player.getStateSummary();
assertEqual(summary.playerId, 'p1', 'Summary has correct playerId');
assertDeepEqual(summary.character, { name: 'TestPlayer', color: '#ff0000' }, 'Summary has character');
assertDeepEqual(summary.position, { x: 15, y: 22, z: 12 }, 'Summary has position');

// Serialization round-trip
const serialized = player.serialize();
assertEqual(serialized.playerId, 'p1', 'Serialized playerId');
assertDeepEqual(serialized.character, { name: 'TestPlayer', color: '#ff0000' }, 'Serialized character');
assertDeepEqual(serialized.position, { x: 15, y: 22, z: 12 }, 'Serialized position');

const deserialized = RemotePlayerState.deserialize(serialized);
assertEqual(deserialized.playerId, 'p1', 'Deserialized playerId matches');
assertDeepEqual(deserialized.character, { name: 'TestPlayer', color: '#ff0000' }, 'Deserialized character matches');
assertDeepEqual(deserialized.position, { x: 15, y: 22, z: 12 }, 'Deserialized position matches');

// Default character when not provided
const defaultPlayer = new RemotePlayerState('p2');
assertDeepEqual(defaultPlayer.character, { name: 'Player', color: '#ffffff' }, 'Default character values');
assertDeepEqual(defaultPlayer.position, { x: 0, y: 20, z: 0 }, 'Default position values');

// ─── Test Group 10: HostManager Constructor ─────────────────

console.log('\n--- Test Group 10: HostManager constructor ---');

const host = new HostManager({
  character: { name: 'HostPlayer', color: '#00ff00' },
});

assertEqual(host.state, HOST_STATE.IDLE, 'Starts in IDLE state');
assertEqual(host.sessionId, null, 'No session ID initially');
assertEqual(host.hostPlayerId, null, 'No host player ID initially');
assertEqual(host.playerCount, 0, 'Zero players initially');
assertEqual(host.maxPlayers, 4, 'Default maxPlayers is 4');
assertEqual(host.mode, 'survival', 'Default mode is survival');

// Custom options
const customHost = new HostManager({
  options: { maxPlayers: 8, reachDistance: 10 },
});
assertEqual(customHost.maxPlayers, 8, 'Custom maxPlayers applied');

// ─── Test Group 11: HostManager Session Lifecycle (no client) ──

console.log('\n--- Test Group 11: HostManager session lifecycle ---');

const testHost = new HostManager({
  character: { name: 'TestHost', color: '#0000ff' },
});

// Start session without client (test mode)
const started = testHost.startSession('Test World', 42, 'creative');
assertTrue(started, 'startSession returns true');
assertEqual(testHost.state, HOST_STATE.ACTIVE, 'Transitions to ACTIVE without client');
assertEqual(testHost.sessionId, 'test_session', 'Test session ID assigned');
assertEqual(testHost.hostPlayerId, 'host_player', 'Test host player ID assigned');
assertEqual(testHost.mode, 'creative', 'Mode set to creative');

// Can't start another session while active
const doubleStart = testHost.startSession('Other World', 99);
assertFalse(doubleStart, 'Cannot start second session while active');

// Player count includes host
assertEqual(testHost.playerCount, 1, 'Player count is 1 (host only)');

// getPlayerList includes host
const playerList = testHost.getPlayerList();
assertEqual(playerList.length, 1, 'Player list has 1 entry');
assertEqual(playerList[0].isHost, true, 'Host marked as isHost');

// End session
testHost.endSession();
assertEqual(testHost.state, HOST_STATE.IDLE, 'Back to IDLE after endSession');
assertEqual(testHost.sessionId, null, 'Session ID cleared');
assertEqual(testHost.hostPlayerId, null, 'Host player ID cleared');
assertEqual(testHost.playerCount, 0, 'Zero players after end');

// End session when already idle (no-op)
testHost.endSession();
assertEqual(testHost.state, HOST_STATE.IDLE, 'EndSession is idempotent');

// ─── Test Group 12: HostManager Player Management ────────────

console.log('\n--- Test Group 12: HostManager player management ---');

const pmHost = new HostManager({
  character: { name: 'PMHost', color: '#ffffff' },
});
pmHost.startSession('PM World', 42);

// Simulate player join via internal handler
const joinedData = {
  playerId: 'remote_p1',
  character: { name: 'RemotePlayer1', color: '#ff0000' },
  position: { x: 5, y: 20, z: 5 },
};
pmHost._handlePlayerJoined(joinedData);

assertEqual(pmHost.playerCount, 2, 'Player count is 2 (host + 1 remote)');

const remote = pmHost.getRemotePlayer('remote_p1');
assertTrue(remote !== null, 'Remote player state exists');
assertEqual(remote.character.name, 'RemotePlayer1', 'Remote character name correct');
assertDeepEqual(remote.position, { x: 5, y: 20, z: 5 }, 'Remote position correct');
assertTrue(remote.connected, 'Remote player is connected');

// Player list includes both
const list = pmHost.getPlayerList();
assertEqual(list.length, 2, 'Player list has 2 entries');

// Simulate player leave
pmHost._handlePlayerLeft('remote_p1');
assertFalse(pmHost.getRemotePlayer('remote_p1').connected, 'Remote player disconnected after leave');

// End session to clear state
pmHost.endSession();

// End session first — these edge cases test behavior after session ends
pmHost.endSession();
assertEqual(pmHost.state, HOST_STATE.IDLE, 'State is IDLE after endSession');

// Handle join for non-existent player (no-op) — after endSession, state is IDLE and players cleared
pmHost._handlePlayerJoined({ playerId: null });
assertEqual(pmHost.playerCount, 0, 'Null player join is no-op after session ended');

// Host own join is ignored
pmHost._handlePlayerJoined({ playerId: pmHost.hostPlayerId });
assertEqual(pmHost.playerCount, 0, 'Host rejoin does not add duplicate after session ended');

console.log('\n--- Test Group 13: HostManager movement validation ---');

const moveHost = new HostManager({
  character: { name: 'MoveHost', color: '#00ffff' },
});
moveHost.startSession('Move World', 42);

// Add a remote player
const movePlayer = new (require(path.join(__dirname, '..', 'js', 'multiplayer', 'host')).RemotePlayerState)(
  'move_p1',
  { name: 'MovePlayer', color: '#ffff00' },
  { x: 10, y: 20, z: 10 }
);
moveHost._players.set('move_p1', movePlayer);

// Valid move
moveHost._handlePlayerMove({
  playerId: 'move_p1',
  position: { x: 12, y: 20, z: 11 },
  rotation: { yaw: Math.PI / 4, pitch: 0.1 },
});
assertDeepEqual(moveHost.getRemotePlayer('move_p1').position, { x: 12, y: 20, z: 11 }, 'Position updated from valid move');

// Invalid move (non-numeric) — should be silently ignored
moveHost._handlePlayerMove({
  playerId: 'move_p1',
  position: { x: 'invalid', y: 20, z: 11 },
});
assertDeepEqual(moveHost.getRemotePlayer('move_p1').position, { x: 12, y: 20, z: 11 }, 'Position unchanged after invalid move');

// Non-existent player — no-op
moveHost._handlePlayerMove({
  playerId: 'nonexistent',
  position: { x: 99, y: 99, z: 99 },
});
assertEqual(moveHost.getRemotePlayer('nonexistent'), null, 'Nonexistent player returns null');

// Disconnected player — no-op
moveHost.getRemotePlayer('move_p1').connected = false;
moveHost._handlePlayerMove({
  playerId: 'move_p1',
  position: { x: 99, y: 99, z: 99 },
});
assertDeepEqual(moveHost.getRemotePlayer('move_p1').position, { x: 12, y: 20, z: 11 }, 'Position unchanged for disconnected player');

moveHost.endSession();

// ─── Test Group 14: HostManager Block Validation ─────────────

console.log('\n--- Test Group 14: HostManager block validation ---');

const blockHost = new HostManager({
  character: { name: 'BlockHost', color: '#ff00ff' },
});
blockHost.startSession('Block World', 42);

// Add remote player at known position
const blockPlayer = new (require(path.join(__dirname, '..', 'js', 'multiplayer', 'host')).RemotePlayerState)(
  'block_p1',
  { name: 'BlockPlayer', color: '#00ff00' },
  { x: 10, y: 20, z: 10 }
);
blockHost._players.set('block_p1', blockPlayer);

// Valid block break (within reach)
let breakCalled = false;
blockHost.onBlockBreakValidated = () => { breakCalled = true; };
// Reset cooldown so first break passes
blockPlayer.lastBlockChangeTime = 0;
blockHost._handleRemoteBlockBreak({ playerId: 'block_p1', x: 11, y: 20, z: 10 });
assertTrue(breakCalled, 'onBlockBreakValidated callback fired for valid break');

// Check block change logged
assertEqual(blockHost._worldState.blockChanges.length, 1, 'One block change logged');
assertEqual(blockHost._worldState.blockChanges[0].type, 'BREAK', 'Logged as BREAK type');

// Invalid block break (too far)
blockHost.onBlockBreakValidated = () => {}; // Reset — should NOT fire
blockHost._handleRemoteBlockBreak({ playerId: 'block_p1', x: 100, y: 20, z: 10 });
assertEqual(blockHost._worldState.blockChanges.length, 1, 'No additional change for too-far break');

// Reset cooldown before testing block place
blockPlayer.lastBlockChangeTime = 0;

// Valid block place
let placeCalled = false;
blockHost.onBlockPlaceValidated = () => { placeCalled = true; };
blockHost._handleRemoteBlockPlace({ playerId: 'block_p1', x: 11, y: 20, z: 10, blockType: 3 });
assertTrue(placeCalled, 'onBlockPlaceValidated callback fired for valid place');
assertEqual(blockHost._worldState.blockChanges.length, 2, 'Two block changes logged (break + place)');
assertEqual(blockHost._worldState.blockChanges[1].type, 'PLACE', 'Logged as PLACE type');

// Invalid block place (negative blockType) — reset cooldown again
blockPlayer.lastBlockChangeTime = 0;
blockHost._handleRemoteBlockPlace({ playerId: 'block_p1', x: 11, y: 20, z: 10, blockType: -1 });
assertEqual(blockHost._worldState.blockChanges.length, 2, 'No additional change for invalid place');

// Non-existent player block action — no-op
blockHost._handleRemoteBlockBreak({ playerId: 'nonexistent', x: 11, y: 20, z: 10 });
assertEqual(blockHost._worldState.blockChanges.length, 2, 'Nonexistent player break is no-op');

// Host-initiated block actions (bypass validation)
blockHost.hostBreakBlock(50, 30, 50);
assertEqual(blockHost._worldState.blockChanges.length, 3, 'Host break logged without validation');

blockHost.hostPlaceBlock(51, 30, 50, 7);
assertEqual(blockHost._worldState.blockChanges.length, 4, 'Host place logged without validation');

blockHost.endSession();

// ─── Test Group 15: HostManager Inventory Validation ─────────

console.log('\n--- Test Group 15: HostManager inventory validation ---');

const invHost = new HostManager({
  character: { name: 'InvHost', color: '#ffff00' },
});
invHost.startSession('Inv World', 42);

const invPlayer = new (require(path.join(__dirname, '..', 'js', 'multiplayer', 'host')).RemotePlayerState)(
  'inv_p1',
  { name: 'InvPlayer', color: '#0000ff' },
  { x: 10, y: 20, z: 10 }
);
invHost._players.set('inv_p1', invPlayer);

let syncCalled = false;
invHost.onInventorySynced = (data) => {
  syncCalled = true;
  assertEqual(data.playerId, 'inv_p1', 'Inventory synced for correct player');
};

// Valid inventory sync
invHost._handleInventorySync({
  playerId: 'inv_p1',
  inventory: [{ type: 'stone', count: 64 }, null],
});
assertTrue(syncCalled, 'onInventorySynced callback fired for valid inventory');

const syncedPlayer = invHost.getRemotePlayer('inv_p1');
assertEqual(syncedPlayer.inventory.length, 2, 'Player inventory updated (2 slots)');

// Invalid inventory — should be silently ignored
syncCalled = false;
invHost._handleInventorySync({
  playerId: 'inv_p1',
  inventory: 'invalid',
});
assertFalse(syncCalled, 'onInventorySynced NOT fired for invalid inventory');

// Non-existent player inventory — no-op
invHost._handleInventorySync({
  playerId: 'nonexistent',
  inventory: [],
});

invHost.endSession();

// ─── Test Group 16: HostManager Quest Update ────────────────

console.log('\n--- Test Group 16: HostManager quest update ---');

const questHost = new HostManager({
  character: { name: 'QuestHost', color: '#ff8800' },
});
questHost.startSession('Quest World', 42);

const questPlayer = new (require(path.join(__dirname, '..', 'js', 'multiplayer', 'host')).RemotePlayerState)(
  'quest_p1',
  { name: 'QuestPlayer', color: '#88ff00' },
  { x: 10, y: 20, z: 10 }
);
questHost._players.set('quest_p1', questPlayer);

let questCalled = false;
questHost.onQuestUpdated = (data) => {
  questCalled = true;
  assertEqual(data.questId, 'Q01', 'Quest update for Q01');
};

// Valid quest update
const questResult = questHost.handleQuestUpdate('quest_p1', { questId: 'Q01', progress: 5 });
assertTrue(questResult, 'handleQuestUpdate returns true for valid update');
assertTrue(questCalled, 'onQuestUpdated callback fired');

// Check world state
const progress = questHost.getQuestProgress();
assertEqual(progress.Q01, 5, 'Quest Q01 progress stored as 5');

// Update with higher progress
questHost.handleQuestUpdate('quest_p1', { questId: 'Q01', progress: 10 });
assertEqual(questHost.getQuestProgress().Q01, 10, 'Quest progress updated to 10');

// Update with lower progress — should NOT decrease
questHost.handleQuestUpdate('quest_p1', { questId: 'Q01', progress: 3 });
assertEqual(questHost.getQuestProgress().Q01, 10, 'Quest progress not decreased from invalid update');

// Invalid quest update
const invResult = questHost.handleQuestUpdate('quest_p1', { questId: 123, progress: 5 });
assertFalse(invResult, 'handleQuestUpdate returns false for invalid questId');

// Non-existent player quest update
const neResult = questHost.handleQuestUpdate('nonexistent', { questId: 'Q01', progress: 5 });
assertFalse(neResult, 'handleQuestUpdate returns false for nonexistent player');

// Disconnected player quest update
questPlayer.connected = false;
const discResult = questHost.handleQuestUpdate('quest_p1', { questId: 'Q02', progress: 1 });
assertFalse(discResult, 'handleQuestUpdate returns false for disconnected player');

questHost.endSession();

// ─── Test Group 17: HostManager Kick Player ─────────────────

console.log('\n--- Test Group 17: HostManager kick player ---');

const kickHost = new HostManager({
  character: { name: 'KickHost', color: '#ff0088' },
});
kickHost.startSession('Kick World', 42);

const kickPlayer = new (require(path.join(__dirname, '..', 'js', 'multiplayer', 'host')).RemotePlayerState)(
  'kick_p1',
  { name: 'KickPlayer', color: '#88ff00' },
  { x: 10, y: 20, z: 10 }
);
kickHost._players.set('kick_p1', kickPlayer);

let kicked = false;
kickHost.onPlayerLeft = (data) => {
  if (data.kicked) {
    kicked = true;
  }
};

const kickResult = kickHost.kickPlayer('kick_p1');
assertTrue(kickResult, 'kickPlayer returns true for existing player');
assertTrue(kicked, 'onPlayerLeft fired with kicked flag');
assertFalse(kickHost.getRemotePlayer('kick_p1').connected, 'Kicked player is disconnected');

// Kick non-existent player
const kickNe = kickHost.kickPlayer('nonexistent');
assertFalse(kickNe, 'kickPlayer returns false for nonexistent player');

kickHost.endSession();

// ─── Test Group 18: HostManager getStateSummary ──────────────

console.log('\n--- Test Group 18: HostManager getStateSummary ---');

const summaryHost = new HostManager({
  character: { name: 'SummaryHost', color: '#0088ff' },
});
summaryHost.startSession('Summary World', 42);

const sPlayer = new (require(path.join(__dirname, '..', 'js', 'multiplayer', 'host')).RemotePlayerState)(
  's_p1',
  { name: 'SPlayer', color: '#ff0088' },
  { x: 5, y: 20, z: 5 }
);
summaryHost._players.set('s_p1', sPlayer);

const stateSummary = summaryHost.getStateSummary();
assertEqual(stateSummary.state, HOST_STATE.ACTIVE, 'Summary state is ACTIVE');
assertEqual(stateSummary.sessionId, 'test_session', 'Summary has session ID');
assertEqual(stateSummary.mode, 'survival', 'Summary has mode');
assertEqual(stateSummary.playerCount, 2, 'Summary player count is 2');
assertEqual(stateSummary.maxPlayers, 4, 'Summary maxPlayers is 4');
assertEqual(stateSummary.players.length, 1, 'Summary has 1 remote player');

summaryHost.endSession();

// ─── Test Group 19: HostManager Dispose ──────────────────────

console.log('\n--- Test Group 19: HostManager dispose ---');

const disposeHost = new HostManager({
  character: { name: 'DisposeHost', color: '#88ff00' },
});
disposeHost.startSession('Dispose World', 42);

disposeHost.dispose();
assertEqual(disposeHost.state, HOST_STATE.IDLE, 'State is IDLE after dispose');
assertEqual(disposeHost.sessionId, null, 'Session cleared after dispose');
assertEqual(disposeHost.playerCount, 0, 'No players after dispose');

// Dispose again (idempotent)
disposeHost.dispose();
assertEqual(disposeHost.state, HOST_STATE.IDLE, 'Dispose is idempotent');

// ─── Test Group 20: Block Change Cooldown ────────────────────

console.log('\n--- Test Group 20: Block change cooldown ---');

const cdHost = new HostManager({
  character: { name: 'CDHost', color: '#ff8800' },
  options: { blockChangeCooldown: 50 }, // 50ms cooldown for testing
});
cdHost.startSession('CD World', 42);

const cdPlayer = new (require(path.join(__dirname, '..', 'js', 'multiplayer', 'host')).RemotePlayerState)(
  'cd_p1',
  { name: 'CDPlayer', color: '#00ff88' },
  { x: 10, y: 20, z: 10 }
);
// Set lastBlockChangeTime to 0 so first break always passes
cdPlayer.lastBlockChangeTime = 0;
cdHost._players.set('cd_p1', cdPlayer);

// First break — should pass (lastBlockChangeTime was 0)
let cdBreakCount = 0;
cdHost.onBlockBreakValidated = () => { cdBreakCount++; };
cdHost._handleRemoteBlockBreak({ playerId: 'cd_p1', x: 11, y: 20, z: 10 });
assertEqual(cdBreakCount, 1, 'First break passes cooldown');

// Immediate second break — should be blocked by cooldown (< 50ms since last)
cdHost._handleRemoteBlockBreak({ playerId: 'cd_p1', x: 12, y: 20, z: 10 });
assertEqual(cdBreakCount, 1, 'Second break blocked by cooldown');

// Simulate time passing by setting lastBlockChangeTime far in the past
cdPlayer.lastBlockChangeTime = Date.now() - 1000; // 1 second ago
cdHost._handleRemoteBlockBreak({ playerId: 'cd_p1', x: 13, y: 20, z: 10 });
assertEqual(cdBreakCount, 2, 'Third break passes after simulated cooldown expiry');

// Test cooldown works per-player (different player not affected)
const cdPlayer2 = new (require(path.join(__dirname, '..', 'js', 'multiplayer', 'host')).RemotePlayerState)(
  'cd_p2',
  { name: 'CDPlayer2', color: '#8800ff' },
  { x: 10, y: 20, z: 10 }
);
cdPlayer2.lastBlockChangeTime = 0;
cdHost._players.set('cd_p2', cdPlayer2);

cdHost._handleRemoteBlockBreak({ playerId: 'cd_p2', x: 14, y: 20, z: 10 });
assertEqual(cdBreakCount, 3, 'Different player break passes independently');

cdHost.endSession();

// ─── FINAL RESULTS ──────────────────────────────────────
console.log('\n===================================');
console.log(`  Results: ${passed}/${totalAssertions} assertions passed`);
if (failed > 0) {
  console.log(`  ❌ ${failed} assertions FAILED`);
  process.exit(1);
} else {
  console.log('  ✅ All assertions passed!');
  process.exit(0);
}
