/**
 * Cuubz — Player List HUD Tests
 *
 * Tests for js/multiplayer/playerListHUD.js
 * Pure logic tests (no DOM required) via PlayerListState class.
 */

'use strict';

const assert = require('assert');
const path = require('path');

// Load module
const {
  HUD_CONFIG,
  escapeHtml,
  getHealthColor,
  isMobileViewport,
  PlayerListHUD,
  PlayerListState,
} = require(path.join(__dirname, '..', 'js', 'multiplayer', 'playerListHUD.js'));

let passed = 0;
let failed = 0;

function assertEqual(actual, expected, msg) {
  try {
    assert.strictEqual(actual, expected);
    passed++;
  } catch (e) {
    failed++;
    console.error(`  ❌ FAIL: ${msg} — expected ${expected}, got ${actual}`);
  }
}

function assertTrue(val, msg) {
  assertEqual(val, true, msg);
}

function assertFalse(val, msg) {
  assertEqual(val, false, msg);
}

// ─── Group 1: HUD_CONFIG constants ──────────────────────────────
console.log('\nGroup 1: HUD_CONFIG constants');

assertEqual(HUD_CONFIG.overlayId, 'player-list-overlay', 'overlayId correct');
assertEqual(HUD_CONFIG.countId, 'player-count', 'countId correct');
assertEqual(HUD_CONFIG.itemsId, 'player-list-items', 'itemsId correct');
assertEqual(HUD_CONFIG.toggleId, 'player-list-toggle', 'toggleId correct');
assertEqual(HUD_CONFIG.mobileBreakpoint, 600, 'mobileBreakpoint is 600px');
assertEqual(HUD_CONFIG.collapsedClass, 'collapsed', 'collapsedClass correct');
assertEqual(HUD_CONFIG.hiddenClass, 'hidden', 'hiddenClass correct');
assertEqual(HUD_CONFIG.healthGreenThreshold, 60, 'green threshold is 60%');
assertEqual(HUD_CONFIG.healthYellowThreshold, 30, 'yellow threshold is 30%');

// ─── Group 2: escapeHtml utility ────────────────────────────────
console.log('\nGroup 2: escapeHtml utility');

assertEqual(escapeHtml('Hello'), 'Hello', 'plain text unchanged');
assertEqual(escapeHtml('<script>'), '&lt;script&gt;', 'angle brackets escaped');
assertEqual(escapeHtml('&amp;'), '&amp;amp;', 'ampersand escaped');
assertEqual(escapeHtml('"quotes"'), '&quot;quotes&quot;', 'double quotes escaped');
assertEqual(escapeHtml("'single'"), '&#x27;single&#x27;', 'single quotes escaped');
assertEqual(escapeHtml('<img src="x">'), '&lt;img src=&quot;x&quot;&gt;', 'full XSS attempt escaped');
assertEqual(escapeHtml(''), '', 'empty string returns empty');
assertEqual(escapeHtml(null), '', 'null returns empty string');
assertEqual(escapeHtml(undefined), '', 'undefined returns empty string');
assertEqual(escapeHtml(123), '', 'number returns empty string (type check)');

// ─── Group 3: getHealthColor function ──────────────────────────
console.log('\nGroup 3: getHealthColor function');

assertEqual(getHealthColor(100), '#4CAF50', '100% → green');
assertEqual(getHealthColor(61), '#4CAF50', '61% → green (above threshold)');
assertEqual(getHealthColor(60), '#f1c40f', '60% → yellow (at boundary)');
assertEqual(getHealthColor(50), '#f1c40f', '50% → yellow');
assertEqual(getHealthColor(31), '#f1c40f', '31% → yellow (above threshold)');
assertEqual(getHealthColor(30), '#e74c3c', '30% → red (at boundary)');
assertEqual(getHealthColor(25), '#e74c3c', '25% → red');
assertEqual(getHealthColor(1), '#e74c3c', '1% → red');
assertEqual(getHealthColor(0), '#e74c3c', '0% → red');

// Edge cases: out of range values clamped
assertEqual(getHealthColor(-10), '#e74c3c', '-10 clamped to 0 → red');
assertEqual(getHealthColor(150), '#4CAF50', '150 clamped to 100 → green');

// ─── Group 4: isMobileViewport in Node.js ──────────────────────
console.log('\nGroup 4: isMobileViewport in Node.js context');

assertFalse(isMobileViewport(), 'returns false in Node.js (no window)');

// ─── Group 5: PlayerListState — constructor defaults ──────────
console.log('\nGroup 5: PlayerListState — constructor defaults');

const state = new PlayerListState();
assertEqual(state.players.length, 0, 'starts with empty players array');
assertFalse(state.collapsed, 'starts not collapsed');
assertFalse(state.visible, 'starts not visible');
assertEqual(state.getPlayerCount(), 0, 'getPlayerCount returns 0');

// ─── Group 6: PlayerListState — addPlayer ──────────────────────
console.log('\nGroup 6: PlayerListState — addPlayer');

const state2 = new PlayerListState();

// Add first player
assertTrue(state2.addPlayer({ id: 'p1', name: 'Alice', color: '#FF0000', health: 80 }), 'add first player returns true');
assertEqual(state2.getPlayerCount(), 1, 'count is 1 after add');
assertTrue(state2.visible, 'visible set to true after adding player');

// Add second player
assertTrue(state2.addPlayer({ id: 'p2', name: 'Bob', color: '#00FF00', health: 50 }), 'add second player returns true');
assertEqual(state2.getPlayerCount(), 2, 'count is 2 after second add');

// Add third player
assertTrue(state2.addPlayer({ id: 'p3', name: 'Charlie', color: '#0000FF', health: 15 }), 'add third player returns true');
assertEqual(state2.getPlayerCount(), 3, 'count is 3 after third add');

// ─── Group 7: PlayerListState — update existing player ────────
console.log('\nGroup 7: PlayerListState — update existing player');

assertFalse(state2.addPlayer({ id: 'p1', name: 'Alice Updated', health: 45 }), 'update existing returns false');
assertEqual(state2.getPlayerCount(), 3, 'count unchanged after update');

const updated = state2.getPlayer('p1');
assertEqual(updated.name, 'Alice Updated', 'name updated');
assertEqual(updated.health, 45, 'health updated');
assertEqual(updated.color, '#FF0000', 'color preserved from original');

// ─── Group 8: PlayerListState — getPlayer ──────────────────────
console.log('\nGroup 8: PlayerListState — getPlayer');

const p1 = state2.getPlayer('p1');
assertEqual(p1.id, 'p1', 'getPlayer returns correct player');
assertEqual(p1.name, 'Alice Updated', 'getPlayer returns updated data');

const p2 = state2.getPlayer('p2');
assertEqual(p2.name, 'Bob', 'getPlayer returns second player');

assertEqual(state2.getPlayer('nonexistent'), null, 'getPlayer returns null for unknown ID');

// ─── Group 9: PlayerListState — removePlayer ──────────────────
console.log('\nGroup 9: PlayerListState — removePlayer');

assertTrue(state2.removePlayer('p1'), 'remove existing player returns true');
assertEqual(state2.getPlayerCount(), 2, 'count is 2 after removal');
assertEqual(state2.getPlayer('p1'), null, 'removed player returns null');

assertFalse(state2.removePlayer('nonexistent'), 'remove non-existent returns false');
assertEqual(state2.getPlayerCount(), 2, 'count unchanged after failed remove');

// ─── Group 10: PlayerListState — remove last player hides HUD ──
console.log('\nGroup 10: PlayerListState — remove all players');

const state3 = new PlayerListState();
state3.addPlayer({ id: 'only', name: 'Solo' });
assertTrue(state3.visible, 'visible with one player');

state3.removePlayer('only');
assertFalse(state3.visible, 'hidden after removing last player');
assertEqual(state3.getPlayerCount(), 0, 'count is 0');

// ─── Group 11: PlayerListState — clear ────────────────────────
console.log('\nGroup 11: PlayerListState — clear');

const state4 = new PlayerListState();
state4.addPlayer({ id: 'a', name: 'A' });
state4.addPlayer({ id: 'b', name: 'B' });
state4.addPlayer({ id: 'c', name: 'C' });
assertEqual(state4.getPlayerCount(), 3, 'has 3 players before clear');

state4.clear();
assertEqual(state4.getPlayerCount(), 0, 'clear removes all players');
assertFalse(state4.visible, 'clear hides HUD');

// ─── Group 12: PlayerListState — collapse toggle ──────────────
console.log('\nGroup 12: PlayerListState — collapse toggle');

const state5 = new PlayerListState();
assertFalse(state5.collapsed, 'starts not collapsed');

state5.toggleCollapse();
assertTrue(state5.collapsed, 'toggle sets collapsed to true');

state5.toggleCollapse();
assertFalse(state5.collapsed, 'toggle again sets collapsed to false');

// Explicit set
state5.setCollapsed(true);
assertTrue(state5.collapsed, 'setCollapsed(true) works');

state5.setCollapsed(false);
assertFalse(state5.collapsed, 'setCollapsed(false) works');

// ─── Group 13: PlayerListState — getHealthColor per player ────
console.log('\nGroup 13: PlayerListState — getHealthColor per player');

const state6 = new PlayerListState();
assertEqual(state6.getHealthColor(100), '#4CAF50', 'full health → green');
assertEqual(state6.getHealthColor(61), '#4CAF50', 'above 60% → green');
assertEqual(state6.getHealthColor(31), '#f1c40f', 'above 30% → yellow');
assertEqual(state6.getHealthColor(10), '#e74c3c', 'below 30% → red');
assertEqual(state6.getHealthColor(undefined), '#4CAF50', 'undefined defaults to 100% → green');

// ─── Group 14: PlayerListState — getStateSummary ──────────────
console.log('\nGroup 14: PlayerListState — getStateSummary');

const state7 = new PlayerListState();
state7.addPlayer({ id: 'x', name: 'Xander', health: 75 });
state7.addPlayer({ id: 'y', name: 'Yara', health: 20 });
state7.toggleCollapse();

const summary = state7.getStateSummary();
assertEqual(summary.playerCount, 2, 'summary has correct count');
assertTrue(summary.collapsed, 'summary reflects collapsed state');
assertTrue(summary.visible, 'summary reflects visible state');
assertEqual(summary.players.length, 2, 'summary includes player list');
assertEqual(summary.players[0].id, 'x', 'first player in summary');
assertEqual(summary.players[1].health, 20, 'second player health in summary');

// ─── Group 15: PlayerListState — addPlayer validation ─────────
console.log('\nGroup 15: PlayerListState — addPlayer validation');

const state8 = new PlayerListState();
assertFalse(state8.addPlayer(null), 'null player rejected');
assertFalse(state8.addPlayer(undefined), 'undefined player rejected');
assertFalse(state8.addPlayer({}), 'player without id rejected');
assertFalse(state8.addPlayer({ name: 'NoID' }), 'player missing id rejected');

// ─── Group 16: PlayerListState — duplicate handling ───────────
console.log('\nGroup 16: PlayerListState — duplicate player add');

const state9 = new PlayerListState();
state9.addPlayer({ id: 'dup', name: 'Original', health: 100 });
assertFalse(state9.addPlayer({ id: 'dup', name: 'Updated', health: 50 }), 'duplicate returns false (update)');
assertEqual(state9.getPlayerCount(), 1, 'count unchanged for duplicate');

const dup = state9.getPlayer('dup');
assertEqual(dup.name, 'Updated', 'name updated on duplicate add');
assertEqual(dup.health, 50, 'health updated on duplicate add');

// ─── Group 17: PlayerListHUD class — constructor with null ────
console.log('\nGroup 17: PlayerListHUD — constructor with null/missing DOM');

const hud = new PlayerListHUD(null);
assertEqual(hud.getPlayerCount(), 0, 'null elements → 0 players');
assertFalse(hud.getVisible(), 'null elements → not visible');
assertFalse(hud.getCollapsed(), 'null elements → not collapsed');

// Methods should not throw with null DOM
hud.show(); // Should be no-op
hud.hide(); // Should be no-op
hud.clear(); // Should be no-op
hud.updatePlayers([{ id: 'test', name: 'Test' }]); // Should store but not render
assertEqual(hud.getPlayerCount(), 1, 'updatePlayers stores data even without DOM');

// ─── Group 18: PlayerListHUD — player management (no DOM) ─────
console.log('\nGroup 18: PlayerListHUD — player management without DOM');

const hud2 = new PlayerListHUD({ overlay: null, count: null, items: null });

hud2.addPlayer({ id: 'a', name: 'Alpha', color: '#FF0000', health: 90 });
assertEqual(hud2.getPlayerCount(), 1, 'add player tracked');

hud2.addPlayer({ id: 'b', name: 'Beta', color: '#00FF00', health: 45 });
assertEqual(hud2.getPlayerCount(), 2, 'second player added');

const players = hud2.getPlayers();
assertEqual(players.length, 2, 'getPlayers returns all');
assertEqual(players[0].id, 'a', 'first player correct');

hud2.removePlayer('a');
assertEqual(hud2.getPlayerCount(), 1, 'player removed');
assertEqual(hud2.getPlayers()[0].id, 'b', 'remaining player correct');

// ─── Group 19: PlayerListHUD — updatePlayers replaces all ─────
console.log('\nGroup 19: PlayerListHUD — updatePlayers replaces all');

const hud3 = new PlayerListHUD({ overlay: null, count: null, items: null });
hud3.updatePlayers([
  { id: '1', name: 'One' },
  { id: '2', name: 'Two' },
]);
assertEqual(hud3.getPlayerCount(), 2, 'updatePlayers sets 2 players');

hud3.updatePlayers([{ id: '3', name: 'Three' }]);
assertEqual(hud3.getPlayerCount(), 1, 'updatePlayers replaces all with new list');
assertEqual(hud3.getPlayers()[0].id, '3', 'new player is only one remaining');

// ─── Group 20: PlayerListHUD — collapse state ──────────────────
console.log('\nGroup 20: PlayerListHUD — collapse state management');

const hud4 = new PlayerListHUD({ overlay: null, count: null, items: null });
assertFalse(hud4.getCollapsed(), 'starts not collapsed');

hud4.setCollapsed(true);
assertTrue(hud4.getCollapsed(), 'setCollapsed(true) works');

hud4.toggleCollapse();
assertFalse(hud4.getCollapsed(), 'toggleCollapse flips to false');

hud4.toggleCollapse();
assertTrue(hud4.getCollapsed(), 'toggleCollapse flips back to true');

// ─── Group 21: PlayerListHUD — visible state ──────────────────
console.log('\nGroup 21: PlayerListHUD — visible state');

const hud5 = new PlayerListHUD({ overlay: null, count: null, items: null });
assertFalse(hud5.getVisible(), 'starts not visible');

hud5.show();
assertTrue(hud5.getVisible(), 'show() sets visible to true');

hud5.hide();
assertFalse(hud5.getVisible(), 'hide() sets visible to false');

// ─── Group 22: PlayerListHUD — onToggle callback ──────────────
console.log('\nGroup 22: PlayerListHUD — onToggle callback');

const hud6 = new PlayerListHUD({ overlay: null, count: null, items: null });
let toggleCalled = false;
let toggleValue = null;

hud6.onToggle = (collapsed) => {
  toggleCalled = true;
  toggleValue = collapsed;
};

hud6.setCollapsed(true);
assertTrue(toggleCalled, 'onToggle called on setCollapsed');
assertTrue(toggleValue, 'onToggle receives true for collapse');

toggleCalled = false;
hud6.setCollapsed(false);
assertTrue(toggleCalled, 'onToggle called again');
assertFalse(toggleValue, 'onToggle receives false for expand');

// ─── Group 23: PlayerListHUD — addPlayer deduplication ────────
console.log('\nGroup 23: PlayerListHUD — addPlayer deduplication');

const hud7 = new PlayerListHUD({ overlay: null, count: null, items: null });
hud7.addPlayer({ id: 'dedup', name: 'First', health: 100 });
hud7.addPlayer({ id: 'dedup', name: 'Second', health: 50 });

assertEqual(hud7.getPlayerCount(), 1, 'duplicate add does not increase count');
const deduped = hud7.getPlayers()[0];
assertEqual(deduped.name, 'Second', 'name updated on duplicate');
assertEqual(deduped.health, 50, 'health updated on duplicate');

// ─── Group 24: PlayerListHUD — null/undefined addPlayer ────────
console.log('\nGroup 24: PlayerListHUD — null/undefined addPlayer safety');

const hud8 = new PlayerListHUD({ overlay: null, count: null, items: null });
hud8.addPlayer(null); // Should not throw
hud8.addPlayer(undefined); // Should not throw
assertEqual(hud8.getPlayerCount(), 0, 'null/undefined players rejected');

// ─── Group 25: Integration — full lifecycle simulation ────────
console.log('\nGroup 25: Integration — full HUD lifecycle simulation');

const hud9 = new PlayerListHUD({ overlay: null, count: null, items: null });

// Initial state
assertFalse(hud9.getVisible(), 'starts hidden');
assertEqual(hud9.getPlayerCount(), 0, 'no players initially');

// Players join one by one
hud9.addPlayer({ id: 'host', name: 'Host', color: '#4CAF50', health: 100 });
assertTrue(hud9.getVisible(), 'auto-shows when first player added');
assertEqual(hud9.getPlayerCount(), 1, '1 player after host joins');

hud9.addPlayer({ id: 'p2', name: 'Player2', color: '#FF5722', health: 80 });
assertEqual(hud9.getPlayerCount(), 2, '2 players after join');

hud9.addPlayer({ id: 'p3', name: 'Player3', color: '#2196F3', health: 40 });
assertEqual(hud9.getPlayerCount(), 3, '3 players after join');

// Player state changes (health drops)
hud9.addPlayer({ id: 'p3', health: 15 }); // Health update via duplicate add
const p3 = hud9.getPlayers().find(p => p.id === 'p3');
assertEqual(p3.health, 15, 'health updated to critical level');

// Player disconnects
hud9.removePlayer('p2');
assertEqual(hud9.getPlayerCount(), 2, '2 players after one leaves');

// Collapse on mobile
hud9.setCollapsed(true);
assertTrue(hud9.getCollapsed(), 'collapsed for mobile view');

// Expand back
hud9.toggleCollapse();
assertFalse(hud9.getCollapsed(), 'expanded again');

// All disconnect
hud9.clear();
assertEqual(hud9.getPlayerCount(), 0, 'all players cleared');
assertFalse(hud9.getVisible(), 'hidden after clear');

// ─── Group 26: Edge cases — extreme health values ──────────────
console.log('\nGroup 26: Edge cases — extreme health values');

const hud10 = new PlayerListHUD({ overlay: null, count: null, items: null });
hud10.addPlayer({ id: 'neg', name: 'Negative', health: -50 });
hud10.addPlayer({ id: 'over', name: 'Over9000', health: 9000 });

// Health should be clamped in rendering logic (tested via getHealthColor)
const stateForEdge = new PlayerListState();
assertEqual(stateForEdge.getHealthColor(-50), '#e74c3c', 'negative health → red (clamped to 0)');
assertEqual(stateForEdge.getHealthColor(9000), '#4CAF50', '9000 health → green (clamped to 100)');

// ─── Group 27: Edge cases — XSS in player names ────────────────
console.log('\nGroup 27: Edge cases — XSS prevention in names');

const xssName = '<script>alert("xss")</script>';
assertEqual(escapeHtml(xssName), '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;', 'XSS payload fully escaped');

// ─── Group 28: PlayerListHUD — destroy cleanup ────────────────
console.log('\nGroup 28: PlayerListHUD — destroy cleanup');

const hud11 = new PlayerListHUD({ overlay: null, count: null, items: null });
hud11.addPlayer({ id: 'cleanup', name: 'Cleanup' });
assertEqual(hud11.getPlayerCount(), 1, 'has player before destroy');

hud11.destroy();
assertEqual(hud11._players.length, 0, 'destroy clears players');

// ─── Summary ──────────────────────────────────────────────────
const total = passed + failed;
console.log(`\n===================================`);
console.log(`  Results: ${passed}/${total} assertions passed, ${failed} failed`);
console.log(`===================================`);

if (failed > 0) {
  console.error('  ❌ Some tests failed!');
  process.exit(1);
} else {
  console.log('  ✅ All player list HUD tests passing!');
  process.exit(0);
}
