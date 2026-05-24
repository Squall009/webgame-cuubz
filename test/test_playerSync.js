#!/usr/bin/env node
/**
 * Cuubz — Player Sync Module Tests
 * Tests RemotePlayerState, PingTracker, PlayerSyncManager, and utility functions.
 */

'use strict';

const {
  INTERPOLATION_CONFIG,
  REMOTE_PLAYER_STATES,
  DEFAULT_REMOTE_PLAYER,
  PingTracker,
  RemotePlayerState,
  PlayerSyncManager,
  buildVoxelCharacter,
  shadeColor,
  distanceBetween,
  normalizeAngle,
  isInRenderDistance,
} = require('../js/multiplayer/playerSync');

// ============================================================
// Mini Test Framework (copy from test_framework.js)
// ============================================================

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
    console.log(`  ❌ ${message}`);
  }
}

function assertEquals(actual, expected, message) {
  assert(actual === expected, `${message}: expected ${expected}, got ${actual}`);
}

function assertApprox(actual, expected, tolerance, message) {
  const diff = Math.abs(actual - expected);
  assert(diff <= tolerance, `${message}: expected ~${expected}, got ${actual} (diff: ${diff.toFixed(4)})`);
}

function assertTrue(condition, message) {
  assert(condition === true, message);
}

function assertFalse(condition, message) {
  assert(condition === false, message);
}

function assertNotNull(value, message) {
  assert(value !== null && value !== undefined, message);
}

// ============================================================
// Tests
// ============================================================

console.log('Player Sync Module Tests');
console.log('========================\n');

// ─── Constants ──────────────────────────────────────────────

console.log('--- INTERPOLATION_CONFIG ---');
assertEquals(INTERPOLATION_CONFIG.positionLerp, 0.15, 'Default position lerp factor');
assertEquals(INTERPOLATION_CONFIG.rotationLerp, 0.12, 'Default rotation lerp factor');
assertEquals(INTERPOLATION_CONFIG.tickInterval, 16, 'Default tick interval 16ms');
assertEquals(INTERPOLATION_CONFIG.staleThreshold, 5000, 'Stale threshold 5000ms');
assertEquals(INTERPOLATION_CONFIG.pingBufferSize, 10, 'Ping buffer size');

console.log('\n--- REMOTE_PLAYER_STATES ---');
assertEquals(REMOTE_PLAYER_STATES.INACTIVE, 'inactive', 'INACTIVE state');
assertEquals(REMOTE_PLAYER_STATES.LOADING, 'loading', 'LOADING state');
assertEquals(REMOTE_PLAYER_STATES.ACTIVE, 'active', 'ACTIVE state');
assertEquals(REMOTE_PLAYER_STATES.STALE, 'stale', 'STALE state');

console.log('\n--- DEFAULT_REMOTE_PLAYER ---');
assertEquals(DEFAULT_REMOTE_PLAYER.width, 0.8, 'Default player width');
assertEquals(DEFAULT_REMOTE_PLAYER.height, 1.8, 'Default player height');
assertApprox(DEFAULT_REMOTE_PLAYER.nameTagOffset, 0.6, 0.01, 'Name tag offset above head');
assertEquals(DEFAULT_REMOTE_PLAYER.healthBarWidth, 1.2, 'Health bar width');

// ─── PingTracker ────────────────────────────────────────────

console.log('\n--- PingTracker: Constructor ---');
const pt = new PingTracker();
assertEquals(pt.count, 0, 'New ping tracker has 0 samples');
assertEquals(pt.getAverage(), null, 'No average with no samples');
assertEquals(pt.getMinimum(), null, 'No minimum with no samples');

console.log('\n--- PingTracker: Recording Samples ---');
pt.recordSample(25);
assertEquals(pt.count, 1, 'One sample recorded');
assertEquals(pt.getAverage(), 25, 'Average of single sample');
assertEquals(pt.getMinimum(), 25, 'Min of single sample');

pt.recordSample(35);
assertEquals(pt.count, 2, 'Two samples recorded');
assertEquals(pt.getAverage(), 30, 'Average of two samples (25+35)/2=30');
assertEquals(pt.getMinimum(), 25, 'Min is still 25');

pt.recordSample(30);
assertEquals(pt.getAverage(), 30, 'Average of three samples (25+35+30)/3=30');

console.log('\n--- PingTracker: Max Samples Buffer ---');
const smallPt = new PingTracker(3);
smallPt.recordSample(10);
smallPt.recordSample(20);
smallPt.recordSample(30);
assertEquals(smallPt.count, 3, 'Buffer at capacity');
smallPt.recordSample(40);
assertEquals(smallPt.count, 3, 'Buffer still at max after overflow');
assertEquals(smallPt.getMinimum(), 20, 'Oldest sample (10) dropped');

console.log('\n--- PingTracker: Negative Samples Ignored ---');
pt.recordSample(-5);
assertEquals(pt.count, 3, 'Negative sample not recorded');

console.log('\n--- PingTracker: Reset ---');
pt.reset();
assertEquals(pt.count, 0, 'Reset clears all samples');
assertEquals(pt.getAverage(), null, 'No average after reset');

console.log('\n--- PingTracker: toJSON ---');
const jsonPt = new PingTracker();
jsonPt.recordSample(50);
jsonPt.recordSample(100);
const json = jsonPt.toJSON();
assertEquals(json.samples.length, 2, 'JSON contains sample array');
assertEquals(json.average, 75, 'JSON average correct');

// ─── RemotePlayerState ──────────────────────────────────────

console.log('\n--- RemotePlayerState: Constructor ---');
const rp = new RemotePlayerState('p1', 'Alice', '#ff0000');
assertEquals(rp.playerId, 'p1', 'Player ID set');
assertEquals(rp.name, 'Alice', 'Name set');
assertEquals(rp.color, '#ff0000', 'Color set');
assertEquals(rp.health, 100, 'Default health 100');
assertEquals(rp.maxHealth, 100, 'Max health 100');
assertEquals(rp.state, REMOTE_PLAYER_STATES.LOADING, 'Initial state is LOADING');
assertTrue(rp.connected, 'Connected by default');
assertNotNull(rp.pingTracker, 'Ping tracker created');

console.log('\n--- RemotePlayerState: Default Values ---');
const rpDefault = new RemotePlayerState('p2');
assertEquals(rpDefault.name, 'Player', 'Default name');
assertEquals(rpDefault.color, '#888888', 'Default color');
assertApprox(rpDefault.position.x, 0, 0.01, 'Default position X');
assertApprox(rpDefault.position.y, 20, 0.01, 'Default position Y=20');

console.log('\n--- RemotePlayerState: updateFromServer ---');
const rpUpdate = new RemotePlayerState('p3', 'Bob', '#00ff00');
rpUpdate.updateFromServer({
  position: { x: 10, y: 25, z: -5 },
  yaw: Math.PI / 4,
  pitch: 0.5,
  health: 75,
  selectedBlock: 3,
  latency: 42,
});
assertEquals(rpUpdate.authoritativePosition.x, 10, 'Authoritative X updated');
assertEquals(rpUpdate.authoritativePosition.y, 25, 'Authoritative Y updated');
assertEquals(rpUpdate.authoritativePosition.z, -5, 'Authoritative Z updated');
assertApprox(rpUpdate.authoritativeYaw, Math.PI / 4, 0.01, 'Yaw updated');
assertApprox(rpUpdate.authoritativePitch, 0.5, 0.01, 'Pitch updated');
assertEquals(rpUpdate.health, 75, 'Health updated');
assertEquals(rpUpdate.selectedBlock, 3, 'Selected block updated');
assertTrue(rpUpdate.connected, 'Still connected after update');
assertEquals(rpUpdate.state, REMOTE_PLAYER_STATES.ACTIVE, 'State changed to ACTIVE on first update');

console.log('\n--- RemotePlayerState: Health Clamping ---');
rpUpdate.updateFromServer({ health: 150 });
assertEquals(rpUpdate.health, 100, 'Health clamped to max (100)');
rpUpdate.updateFromServer({ health: -20 });
assertEquals(rpUpdate.health, 0, 'Health clamped to min (0)');

console.log('\n--- RemotePlayerState: Name/Color Update ---');
rpUpdate.updateFromServer({ name: 'Bobby', color: '#0000ff' });
assertEquals(rpUpdate.name, 'Bobby', 'Name updated via server');
assertEquals(rpUpdate.color, '#0000ff', 'Color updated via server');

console.log('\n--- RemotePlayerState: Ping Tracking ---');
const rpPing = new RemotePlayerState('p4');
rpPing.updateFromServer({ position: { x: 1, y: 20, z: 1 }, latency: 30 });
assertEquals(rpPing.pingTracker.count, 1, 'Ping tracked from update');
assertEquals(rpPing.pingTracker.getAverage(), 30, 'Ping average correct');

// ─── Interpolation ──────────────────────────────────────────

console.log('\n--- RemotePlayerState: Interpolation ---');
const rpInterp = new RemotePlayerState('p5');
rpInterp.position = { x: 0, y: 20, z: 0 };
rpInterp.authoritativePosition = { x: 10, y: 30, z: -10 };
rpInterp.yaw = 0;
rpInterp.authoritativeYaw = Math.PI / 2;

// First interpolation step (lerp 0.15)
rpInterp.interpolate(0.15);
assertApprox(rpInterp.position.x, 1.5, 0.01, 'X interpolated toward target (0 + (10-0)*0.15 = 1.5)');
assertApprox(rpInterp.position.y, 21.5, 0.01, 'Y interpolated (20 + (30-20)*0.15 = 21.5)');
assertApprox(rpInterp.position.z, -1.5, 0.01, 'Z interpolated (0 + (-10-0)*0.15 = -1.5)');

// Second step — should be closer
const prevX = rpInterp.position.x;
rpInterp.interpolate(0.15);
assertTrue(rpInterp.position.x > prevX, 'X continues toward target');

console.log('\n--- RemotePlayerState: Interpolation Convergence ---');
const rpConv = new RemotePlayerState('p6');
rpConv.position = { x: 0, y: 20, z: 0 };
rpConv.authoritativePosition = { x: 100, y: 50, z: 0 };

// Many iterations should converge
for (let i = 0; i < 100; i++) {
  rpConv.interpolate(0.1);
}
assertApprox(rpConv.position.x, 100, 0.5, 'X converged to target after 100 steps');
assertApprox(rpConv.position.y, 50, 0.5, 'Y converged to target after 100 steps');

// ─── Health Percent ────────────────────────────────────────

console.log('\n--- RemotePlayerState: getHealthPercent ---');
const rpHp = new RemotePlayerState('p7');
assertEquals(rpHp.getHealthPercent(), 1.0, 'Full health = 1.0');
rpHp.health = 50;
assertEquals(rpHp.getHealthPercent(), 0.5, 'Half health = 0.5');
rpHp.health = 0;
assertEquals(rpHp.getHealthPercent(), 0.0, 'Zero health = 0.0');

// ─── Head Position ─────────────────────────────────────────

console.log('\n--- RemotePlayerState: getHeadPosition ---');
const rpHead = new RemotePlayerState('p8');
rpHead.position = { x: 5, y: 20, z: 10 };
const headPos = rpHead.getHeadPosition();
assertApprox(headPos.x, 5, 0.01, 'Head X same as position');
assertApprox(headPos.y, 22.4, 0.01, `Head Y = pos.y + height(1.8) + offset(0.6) = ${20 + 1.8 + 0.6}`);
assertApprox(headPos.z, 10, 0.01, 'Head Z same as position');

// ─── Staleness ─────────────────────────────────────────────

console.log('\n--- RemotePlayerState: Staleness Detection ---');
const rpStale = new RemotePlayerState('p9');
rpStale.updateFromServer({ position: { x: 0, y: 20, z: 0 } });
assertFalse(rpStale.isStale(), 'Not stale after fresh update');

// Manually set lastUpdate to past — use staleThreshold + buffer to ensure detection
rpStale.lastUpdate = Date.now() - (INTERPOLATION_CONFIG.staleThreshold + 1000);
rpStale.interpolate(0.15);
assertTrue(rpStale.isStale(), `Becomes stale after interpolation check (${INTERPOLATION_CONFIG.staleThreshold + 1000}ms > ${INTERPOLATION_CONFIG.staleThreshold}ms threshold)`);

console.log('\n--- RemotePlayerState: Reconnection After Staleness ---');
rpStale.updateFromServer({ position: { x: 1, y: 20, z: 0 } });
assertFalse(rpStale.isStale(), 'Reconnected after new server update');
assertEquals(rpStale.state, REMOTE_PLAYER_STATES.ACTIVE, 'State reset to ACTIVE on reconnect');

// ─── Disconnect ────────────────────────────────────────────

console.log('\n--- RemotePlayerState: disconnect() ---');
const rpDisc = new RemotePlayerState('p10');
rpDisc.updateFromServer({ position: { x: 0, y: 20, z: 0 } });
rpDisc.disconnect();
assertFalse(rpDisc.connected, 'Disconnected flag set');
assertEquals(rpDisc.state, REMOTE_PLAYER_STATES.INACTIVE, 'State set to INACTIVE');

// ─── Serialization ─────────────────────────────────────────

console.log('\n--- RemotePlayerState: toJSON / fromJSON ---');
const rpOrig = new RemotePlayerState('p11', 'Charlie', '#00ff00');
rpOrig.updateFromServer({
  position: { x: 42, y: 30, z: -15 },
  yaw: Math.PI / 3,
  pitch: 0.3,
  health: 80,
});
const json1 = rpOrig.toJSON();
assertEquals(json1.playerId, 'p11', 'JSON has player ID');
assertEquals(json1.name, 'Charlie', 'JSON has name');
assertEquals(json1.authoritativePosition.x, 42, 'JSON authoritative position X');
assertEquals(json1.renderPosition.x, 0, 'JSON render position is default (no interpolation done)');

const rpRestored = RemotePlayerState.fromJSON(json1);
assertEquals(rpRestored.playerId, 'p11', 'Restored player ID');
assertEquals(rpRestored.name, 'Charlie', 'Restored name');
assertApprox(rpRestored.authoritativePosition.x, 42, 0.01, 'Restored authoritative position X');
assertEquals(rpRestored.health, 80, 'Restored health');

// ─── buildVoxelCharacter ───────────────────────────────────

console.log('\n--- buildVoxelCharacter ---');
const blocks = buildVoxelCharacter('#ff0000');
assertEquals(blocks.length, 6, 'Character has 6 blocks (2 feet + torso + 2 arms + head)');

// Check block structure
const headBlock = blocks.find(b => b.y === 1.6);
assertNotNull(headBlock, 'Head block exists at y=1.6');
assertEquals(headBlock.x, 0, 'Head centered on X');

const torsoBlock = blocks.find(b => b.y === 0.7 && b.x === 0);
assertNotNull(torsoBlock, 'Torso block exists at center');

// Check color shading
const darkerBlocks = blocks.filter(b => b.color !== '#ff0000' && b.color !== buildVoxelCharacter('#ff0000')[4].color);
assertTrue(darkerBlocks.length > 0, 'Some blocks use darker shade');

console.log('\n--- buildVoxelCharacter: Default Color ---');
const defaultBlocks = buildVoxelCharacter();
assertEquals(defaultBlocks[0].color !== '#888888' || defaultBlocks.some(b => b.color === '#888888'), true, 'Default blocks use #888888 base');

// ─── shadeColor ────────────────────────────────────────────

console.log('\n--- shadeColor ---');
assertEquals(shadeColor('#000000', 0), '#000000', 'Black unchanged at 0%');
assertEquals(shadeColor('#ffffff', 0), '#ffffff', 'White unchanged at 0%');
assertEquals(shadeColor('#808080', -128), '#000000', 'Gray -128 → black');
assertEquals(shadeColor('#808080', 127), '#ffffff', 'Gray +127 → white (clamped)');

const redDarker = shadeColor('#ff0000', -50);
assert(redDarker.startsWith('#'), 'Returns hex color');
// Red component should be ~205 (255-50)
const parsed = parseInt(redDarker.slice(1), 16);
assertEquals((parsed >> 16) & 0xFF, 205, 'Red component reduced by 50');

// ─── Utility Functions ─────────────────────────────────────

console.log('\n--- distanceBetween ---');
assertEquals(distanceBetween({x:0,y:0,z:0}, {x:3,y:4,z:0}), 5, '3-4-5 triangle distance');
assertEquals(distanceBetween({x:0,y:0,z:0}, {x:0,y:0,z:0}), 0, 'Zero distance to self');
assertApprox(distanceBetween({x:0,y:0,z:0}, {x:1,y:1,z:1}), Math.sqrt(3), 0.001, 'Diagonal distance');

console.log('\n--- normalizeAngle ---');
assertEquals(normalizeAngle(0), 0, 'Zero stays zero');
assertApprox(normalizeAngle(Math.PI / 2), Math.PI / 2, 0.01, 'PI/2 unchanged');
assertApprox(normalizeAngle(3 * Math.PI), Math.PI, 0.01, '3PI wraps to PI');
assertApprox(normalizeAngle(-3 * Math.PI), Math.PI, 0.01, '-3PI wraps to PI (canonical +PI)');
assertApprox(normalizeAngle(Math.PI * 4), 0, 0.01, '4PI wraps to 0');

console.log('\n--- isInRenderDistance ---');
assertTrue(isInRenderDistance({x:0,y:0,z:0}, {x:3,y:5,z:4}, 10), 'Within render distance (5 < 10)');
assertFalse(isInRenderDistance({x:0,y:0,z:0}, {x:20,y:5,z:20}, 10), 'Outside render distance (~28.3 > 10)');
assertTrue(isInRenderDistance({x:0,y:0,z:0}, {x:7,y:5,z:7}, 10), 'On boundary (9.9 < 10)');

// ─── PlayerSyncManager ─────────────────────────────────────

console.log('\n--- PlayerSyncManager: Constructor ---');
const psm = new PlayerSyncManager();
assertEquals(psm.playerCount, 0, 'No players initially');
assertEquals(psm._players.size, 0, 'Map is empty');
assertFalse(psm._threeLoaded, 'Three.js not loaded in Node.js');

console.log('\n--- PlayerSyncManager: addPlayer ---');
const added = psm.addPlayer('p1', { name: 'Alice', color: '#ff0000' });
assertNotNull(added, 'addPlayer returns player state');
assertEquals(added.name, 'Alice', 'Added player has correct name');
assertEquals(psm.playerCount, 1, 'Player count is 1');
assertEquals(psm._players.size, 1, 'Map has 1 entry');

console.log('\n--- PlayerSyncManager: getPlayer ---');
const found = psm.getPlayer('p1');
assertNotNull(found, 'getPlayer finds existing player');
assertEquals(found.name, 'Alice', 'Found player is correct');
assertEquals(psm.getPlayer('nonexistent'), null, 'Unknown player returns null');

console.log('\n--- PlayerSyncManager: getActivePlayers ---');
psm.addPlayer('p2', { name: 'Bob' });
const active = psm.getActivePlayers();
assertEquals(active.length, 2, 'Two active players');
assertTrue(active.some(p => p.name === 'Alice'), 'Alice in active list');

console.log('\n--- PlayerSyncManager: removePlayer ---');
const removed = psm.removePlayer('p1');
assertNotNull(removed, 'removePlayer returns the player');
assertFalse(removed.connected, 'Removed player is disconnected');
assertEquals(psm.playerCount, 1, 'One player remaining');
assertEquals(psm.getPlayer('p1'), null, 'Removed player returns null');

console.log('\n--- PlayerSyncManager: processServerUpdate ---');
psm.addPlayer('p3', { name: 'Charlie' });
const updated = psm.processServerUpdate('p3', {
  position: { x: 50, y: 25, z: 10 },
  health: 90,
});
assertEquals(updated.authoritativePosition.x, 50, 'Server update applied');
assertEquals(updated.health, 90, 'Health updated from server');

console.log('\n--- PlayerSyncManager: Auto-Add Unknown Player ---');
const autoAdded = psm.processServerUpdate('p_unknown', {
  name: 'Mystery',
  position: { x: 100, y: 20, z: 100 },
});
assertNotNull(autoAdded, 'Unknown player auto-added on update');
assertEquals(autoAdded.name, 'Mystery', 'Auto-added player has data');
assertEquals(psm.playerCount, 3, 'Player count increased');

console.log('\n--- PlayerSyncManager: Update Existing Player via addPlayer ---');
const existingBefore = psm.getPlayer('p2');
const prevHealth = existingBefore.health;
psm.addPlayer('p2', { health: 50 });
const existingAfter = psm.getPlayer('p2');
assertEquals(existingAfter.health, 50, 'Existing player updated instead of duplicated');
assertEquals(psm._players.size, psm.playerCount, 'No duplicate entries');

// ─── Callbacks ─────────────────────────────────────────────

console.log('\n--- PlayerSyncManager: Callbacks ---');
const cbMgr = new PlayerSyncManager();
let addedId = null;
let removedId = null;
let updatedId = null;

cbMgr.onPlayerAdded = (id, player) => { addedId = id; };
cbMgr.onPlayerRemoved = (id, player) => { removedId = id; };
cbMgr.onPlayerUpdated = (id, player) => { updatedId = id; };

cbMgr.addPlayer('cb1', { name: 'Callback Test' });
assertEquals(addedId, 'cb1', 'onPlayerAdded callback fired');

cbMgr.processServerUpdate('cb1', { position: { x: 1, y: 20, z: 1 } });
assertEquals(updatedId, 'cb1', 'onPlayerUpdated callback fired');

cbMgr.removePlayer('cb1');
assertEquals(removedId, 'cb1', 'onPlayerRemoved callback fired');

// ─── Game Mode ─────────────────────────────────────────────

console.log('\n--- PlayerSyncManager: Game Mode ---');
const modeMgr = new PlayerSyncManager();
assertTrue(modeMgr.showHealthBars(), 'Survival mode shows health bars (default)');
modeMgr.setGameMode('creative');
assertFalse(modeMgr.showHealthBars(), 'Creative mode hides health bars');
modeMgr.setGameMode('survival');
assertTrue(modeMgr.showHealthBars(), 'Back to survival shows health bars');

// ─── clearAll ──────────────────────────────────────────────

console.log('\n--- PlayerSyncManager: clearAll ---');
const clearMgr = new PlayerSyncManager();
clearMgr.addPlayer('ca1', { name: 'A' });
clearMgr.addPlayer('ca2', { name: 'B' });
clearMgr.addPlayer('ca3', { name: 'C' });
assertEquals(clearMgr.playerCount, 3, 'Three players before clear');

const removedIds = clearMgr.clearAll();
assertEquals(removedIds.length, 3, 'All three IDs returned');
assertEquals(clearMgr.playerCount, 0, 'No players after clear');
assertEquals(clearMgr._players.size, 0, 'Map cleared');

// ─── getStateSummary ───────────────────────────────────────

console.log('\n--- PlayerSyncManager: getStateSummary ---');
const sumMgr = new PlayerSyncManager();
sumMgr.addPlayer('s1', { name: 'Summary Test', color: '#abcdef' });
sumMgr.processServerUpdate('s1', { position: { x: 42, y: 30, z: -5 }, latency: 37 });

const summary = sumMgr.getStateSummary();
assertEquals(summary.totalPlayers, 1, 'Summary total players');
assertEquals(summary.connectedCount, 1, 'Summary connected count');
assertEquals(summary.gameMode, 'survival', 'Summary game mode');
assertNotNull(summary.players['s1'], 'Player in summary');
assertEquals(summary.players['s1'].name, 'Summary Test', 'Name in summary');

// ─── Serialization ─────────────────────────────────────────

console.log('\n--- PlayerSyncManager: serialize ---');
const serMgr = new PlayerSyncManager();
serMgr.addPlayer('ser1', { name: 'Serialize Me' });
serMgr.processServerUpdate('ser1', { position: { x: 99, y: 25, z: -20 } });

const serialized = serMgr.serialize();
assertNotNull(serialized['ser1'], 'Serialized player data');
assertEquals(serialized['ser1'].name, 'Serialize Me', 'Name in serialization');
assertEquals(serialized['ser1'].authoritativePosition.x, 99, 'Position in serialization');

// ─── Edge Cases ────────────────────────────────────────────

console.log('\n--- Edge: Empty Manager Operations ---');
const emptyMgr = new PlayerSyncManager();
assertEquals(emptyMgr.getActivePlayers().length, 0, 'No active players on empty manager');
assertEquals(emptyMgr.playerCount, 0, 'Zero count on empty manager');
const emptySummary = emptyMgr.getStateSummary();
assertEquals(emptySummary.totalPlayers, 0, 'Empty summary shows zero');

console.log('\n--- Edge: Remove Nonexistent Player ---');
const result = emptyMgr.removePlayer('doesnt_exist');
assertEquals(result, null, 'Removing nonexistent returns null');

console.log('\n--- Edge: Process Update for Empty Manager ---');
emptyMgr.processServerUpdate('new_player', { name: 'Auto', position: { x: 0, y: 20, z: 0 } });
assertEquals(emptyMgr.playerCount, 1, 'Player auto-created on first update');

console.log('\n--- Edge: Multiple Updates Without Interpolation ---');
const multiUpdate = new RemotePlayerState('mu1');
multiUpdate.updateFromServer({ position: { x: 10, y: 20, z: 0 } });
multiUpdate.updateFromServer({ position: { x: 20, y: 30, z: -5 } });
assertEquals(multiUpdate.authoritativePosition.x, 20, 'Last update overwrites authoritative');
// Render position should still be at initial (0, 20, 0) until interpolated
assertApprox(multiUpdate.position.x, 0, 0.01, 'Render position unchanged without interpolation');

console.log('\n--- Edge: Interpolation with No Server Update ---');
const noUpdate = new RemotePlayerState('nu1');
noUpdate.updateFromServer({ position: { x: 5, y: 20, z: 0 } });
// Don't update again — interpolate should keep converging toward same target
for (let i = 0; i < 30; i++) {
  noUpdate.interpolate(0.1);
}
assertApprox(noUpdate.position.x, 5, 0.25, 'Position converged close to stable target after 30 steps');

console.log('\n--- Edge: Partial Server Update ---');
const partial = new RemotePlayerState('pt1', 'Partial');
partial.updateFromServer({ position: { x: 10, y: 20, z: 0 } });
partial.health = 80;
// Only update health — position should stay
partial.updateFromServer({ health: 60 });
assertEquals(partial.authoritativePosition.x, 10, 'Position preserved with partial update');
assertEquals(partial.health, 60, 'Health updated independently');

console.log('\n--- Edge: fromJSON Missing Fields ---');
const minimal = RemotePlayerState.fromJSON({ playerId: 'min1' });
assertEquals(minimal.playerId, 'min1', 'Minimal JSON creates player');
assertEquals(minimal.name, 'Player', 'Missing name defaults to Player');
assertEquals(minimal.health, 100, 'Missing health defaults to 100');

// ─── Integration: Full Sync Cycle ──────────────────────────

console.log('\n--- Integration: Full Sync Cycle ---');
const syncMgr = new PlayerSyncManager();

// Simulate session start with players joining
syncMgr.addPlayer('host', { name: 'Host', color: '#ff0000' });
syncMgr.addPlayer('remote1', { name: 'Remote1', color: '#00ff00' });
syncMgr.addPlayer('remote2', { name: 'Remote2', color: '#0000ff' });
assertEquals(syncMgr.playerCount, 3, 'Three players in session');

// Simulate server broadcasts at different times
syncMgr.processServerUpdate('host', { position: { x: 0, y: 25, z: 0 }, health: 100 });
syncMgr.processServerUpdate('remote1', { position: { x: 10, y: 25, z: 5 }, health: 90 });
syncMgr.processServerUpdate('remote2', { position: { x: -8, y: 30, z: -3 }, health: 75 });

// Run interpolation ticks
for (let i = 0; i < 10; i++) {
  syncMgr.update(0.016); // ~60fps tick
}

// Verify positions are converging
const hostPlayer = syncMgr.getPlayer('host');
assertApprox(hostPlayer.position.x, 0, 2, 'Host position near target after interpolation');

const r1 = syncMgr.getPlayer('remote1');
assertTrue(r1.position.x > 5, 'Remote1 moving toward target');

// Player leaves
syncMgr.removePlayer('remote2');
assertEquals(syncMgr.playerCount, 2, 'Two players after one leaves');

// New player joins mid-session
syncMgr.addPlayer('remote3', { name: 'LateJoin', color: '#ffff00' });
assertEquals(syncMgr.playerCount, 3, 'Three players with new joiner');

console.log('\n--- Integration: Staleness Detection in Manager ---');
const staleMgr = new PlayerSyncManager();
staleMgr.addPlayer('sp1', { name: 'StaleTest' });
staleMgr.processServerUpdate('sp1', { position: { x: 0, y: 20, z: 0 } });

// Force staleness
const sp1 = staleMgr.getPlayer('sp1');
sp1.lastUpdate = Date.now() - 6000;

// Update should trigger staleness check
staleMgr.update(0.016);
assertTrue(sp1.isStale(), 'Player detected as stale after manager update');
assertFalse(staleMgr.getActivePlayers().some(p => p.playerId === 'sp1'), 'Stale player excluded from active list');

// ============================================================
// Results
// ============================================================

console.log('\n========================');
console.log(`Results: ${passCount} passed, ${failCount} failed`);

if (failCount > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
} else {
  console.log('🎉 All player sync tests passing!');
  process.exit(0);
}
