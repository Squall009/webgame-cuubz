#!/usr/bin/env node
/**
 * Cuubz — Creative Mode Tests
 * Tests for creative mode: unlimited blocks, no gravity, fly mode, block palette, mode toggle.
 */

const Game = require('../js/game');
const Player = require('../js/entities/player');
const { BLOCK_TYPES } = require('../js/world/chunkData');

let passed = 0;
let failed = 0;
let testGroup = '';

function setGroup(name) {
  testGroup = name;
  console.log(`\n[${testGroup}]`);
}

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  ❌ FAIL (${testGroup}): ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  assert(actual === expected, `${message} (expected ${expected}, got ${actual})`);
}

// ============================================================
// Test Suite
// ============================================================

console.log('=== Creative Mode Tests ===');

// --- Group 1: Game mode constants ---
setGroup('Game Mode Constants');
assert(Game.MODES !== undefined, 'Game.MODES should be defined');
assertEqual(Game.MODES.SURVIVAL, 'survival', 'SURVIVAL mode constant');
assertEqual(Game.MODES.CREATIVE, 'creative', 'CREATIVE mode constant');

// --- Group 2: Game constructor defaults ---
setGroup('Game Constructor Defaults');
const game = new Game();
assertEqual(game.mode, 'survival', 'Default mode should be survival');
assertEqual(game.isCreative(), false, 'isCreative() should return false for default');
assertEqual(game.isSurvival(), true, 'isSurvival() should return true for default');
assert(game.running === false, 'Game should not be running by default');

// --- Group 3: Mode switching ---
setGroup('Mode Switching');
game.setMode(Game.MODES.CREATIVE);
assertEqual(game.mode, 'creative', 'Mode should switch to creative');
assertEqual(game.isCreative(), true, 'isCreative() should return true');
assertEqual(game.isSurvival(), false, 'isSurvival() should return false');

game.setMode(Game.MODES.SURVIVAL);
assertEqual(game.mode, 'survival', 'Mode should switch back to survival');
assertEqual(game.isCreative(), false, 'isCreative() should return false');
assertEqual(game.isSurvival(), true, 'isSurvival() should return true');

// Invalid mode should be ignored
game.setMode('invalid_mode');
assertEqual(game.mode, 'survival', 'Invalid mode should not change current mode');

// --- Group 4: Player creative mode physics ---
setGroup('Player Creative Physics');
const player = new Player();

// Default survival physics
assertEqual(player.gravityEnabled, true, 'Gravity should be enabled by default');
assertEqual(player.flyMode, false, 'Fly mode should be off by default');
assertEqual(player.isFlying, false, 'isFlying should be false by default');

// Enable creative mode on player
player.setCreativeMode(true);
assertEqual(player.gravityEnabled, false, 'Gravity should be disabled in creative mode');
assertEqual(player.flySpeed !== undefined, true, 'Fly speed should be set in creative mode');

// Disable creative mode
player.setCreativeMode(false);
assertEqual(player.gravityEnabled, true, 'Gravity should be re-enabled when leaving creative');

// --- Group 5: Fly mode toggle ---
setGroup('Fly Mode Toggle');
player.setCreativeMode(true);

// Initially not flying
assertEqual(player.flyMode, false, 'Fly mode should start as off');
assertEqual(player.isFlying, false, 'isFlying should be false');

// Enable fly mode
player.toggleFlyMode();
assertEqual(player.flyMode, true, 'Fly mode should toggle on');
assertEqual(player.isFlying, true, 'isFlying should be true when fly mode on and moving vertically');

// Disable fly mode
player.toggleFlyMode();
assertEqual(player.flyMode, false, 'Fly mode should toggle off');

// Fly mode should only work in creative
player.setCreativeMode(false);
player.toggleFlyMode();
assertEqual(player.flyMode, false, 'Fly mode should not activate in survival mode');
player.setCreativeMode(true);

// --- Group 6: Double-tap space detection ---
setGroup('Double-Tap Space Detection');
const doubleTapDetector = new (require('../js/game')).DoubleTapDetector();

// Single tap — no double tap detected
doubleTapDetector.check(1000);
assertEqual(doubleTapDetector.lastTapTime, 1000, 'Should record first tap time');

// Tap too soon after (within threshold) — should detect
const result = doubleTapDetector.check(1150); // 150ms later (< 300ms threshold)
assertEqual(result, true, 'Two taps within 300ms should be detected as double tap');

// Next single tap after cooldown — no double tap
doubleTapDetector.check(2000); // 850ms later (> 300ms threshold)
const result2 = doubleTapDetector.check(2100); // 100ms later
assertEqual(result2, true, 'Two close taps after cooldown should detect again');

// Reset and single tap — no detection
doubleTapDetector.reset();
const result3 = doubleTapDetector.check(3000);
assertEqual(result3, false, 'Single tap after reset should not trigger');

// --- Group 7: Fly speed constants ---
setGroup('Fly Speed Constants');
player.setCreativeMode(true);
assert(player.flySpeed > player.moveSpeed, `Fly speed (${player.flySpeed}) should be greater than walk speed (${player.moveSpeed})`);
assertEqual(typeof player.flySpeed, 'number', 'flySpeed should be a number');

// --- Group 8: Creative mode block placement (unlimited) ---
setGroup('Creative Block Placement');
const game2 = new Game();
game2.setMode(Game.MODES.CREATIVE);

// In creative mode, canPlaceBlock should always return true regardless of inventory
assertEqual(game2.canPlaceBlock(null), true, 'Creative mode should allow placing any block without inventory');
assertEqual(game2.canPlaceBlock(0), true, 'Creative mode should allow placing air (ID=0)');
assertEqual(game2.canPlaceBlock(99), true, 'Creative mode should allow placing any block ID');

game2.setMode(Game.MODES.SURVIVAL);
// In survival mode, canPlaceBlock depends on inventory
assertEqual(game2.canPlaceBlock(null, null), false, 'Survival mode without inventory should deny placement');

// --- Group 9: Block palette ---
setGroup('Block Palette');
const palette = new (require('../js/game')).BlockPalette();

// Default selected block should be stone
assertEqual(palette.selectedBlock, BLOCK_TYPES.STONE, 'Default selected block should be stone');

// Select by ID
palette.selectBlock(BLOCK_TYPES.DIRT);
assertEqual(palette.selectedBlock, BLOCK_TYPES.DIRT, 'Should select dirt block');

palette.selectBlock(BLOCK_TYPES.OBSIDIAN);
assertEqual(palette.selectedBlock, BLOCK_TYPES.OBSIDIAN, 'Should select obsidian block');

// Invalid block should not change selection
const prevSelection = palette.selectedBlock;
palette.selectBlock(-1);
assertEqual(palette.selectedBlock, prevSelection, 'Invalid block ID should not change selection');

// Cycle forward
palette.selectBlock(BLOCK_TYPES.STONE);
palette.cycleForward();
assert(palette.selectedBlock !== BLOCK_TYPES.STONE, 'cycleForward should change selection');

// Cycle backward
const beforeBack = palette.selectedBlock;
palette.cycleBackward();
assert(palette.selectedBlock !== beforeBack, 'cycleBackward should change selection');

// Get all blocks list
const allBlocks = palette.getAllBlocks();
assert(Array.isArray(allBlocks), 'getAllBlocks should return an array');
assert(allBlocks.length > 0, 'getAllBlocks should have at least one block');
assert(allBlocks.includes(BLOCK_TYPES.STONE), 'Should include stone');
assert(allBlocks.includes(BLOCK_TYPES.DIRT), 'Should include dirt');

// --- Group 10: Creative mode update loop ---
setGroup('Creative Update Loop');
const game3 = new Game();
game3.setMode(Game.MODES.CREATIVE);

// Mock player for testing
game3.player = {
  gravityEnabled: false,
  flyMode: false,
  isFlying: false,
  velocity: { x: 0, y: 0, z: 0 },
  position: { x: 0, y: 20, z: 0 },
  setCreativeMode: function(creative) { this.gravityEnabled = !creative; }
};
game3.player.setCreativeMode(true);

// Player should have gravity disabled in creative mode
assertEqual(game3.player.gravityEnabled, false, 'Player gravity should be disabled in creative');

// --- Group 11: Mode callback system ---
setGroup('Mode Callback System');
const game4 = new Game();
let modeChangeCount = 0;
game4.onModeChange = (newMode, oldMode) => {
  modeChangeCount++;
};

game4.setMode(Game.MODES.CREATIVE);
assertEqual(modeChangeCount, 1, 'onModeChange should fire once on first mode change');

game4.setMode(Game.MODES.SURVIVAL);
assertEqual(modeChangeCount, 2, 'onModeChange should fire again on second mode change');

// Setting same mode should not trigger callback
game4.setMode(Game.MODES.SURVIVAL);
assertEqual(modeChangeCount, 2, 'Setting same mode should not trigger callback');

// --- Group 12: Game start with mode ---
setGroup('Game Start with Mode');
const game5 = new Game();
game5.start(Game.MODES.CREATIVE);
assertEqual(game5.mode, 'creative', 'start() should set the mode');
assertEqual(game5.running, true, 'start() should set running to true');

game5.stop();
assertEqual(game5.running, false, 'stop() should set running to false');

// --- Group 13: Integration test — full creative cycle ---
setGroup('Creative Mode Integration Cycle');
const game6 = new Game();
const player6 = new Player();
game6.player = player6;

// Start in survival
game6.start(Game.MODES.SURVIVAL);
assertEqual(game6.mode, 'survival', 'Started in survival mode');
assertEqual(player6.gravityEnabled, true, 'Player has gravity in survival');

// Switch to creative
game6.setMode(Game.MODES.CREATIVE);
assertEqual(game6.mode, 'creative', 'Switched to creative mode');
assertEqual(player6.gravityEnabled, false, 'Player gravity disabled in creative');
assertEqual(player6.flySpeed !== undefined, true, 'Fly speed set in creative');

// Toggle fly mode
player6.toggleFlyMode();
assertEqual(player6.flyMode, true, 'Fly mode activated');

// Switch back to survival
game6.setMode(Game.MODES.SURVIVAL);
assertEqual(game6.mode, 'survival', 'Switched back to survival');
assertEqual(player6.gravityEnabled, true, 'Player gravity re-enabled in survival');
assertEqual(player6.flyMode, false, 'Fly mode disabled when leaving creative');

// --- Group 14: Edge cases ---
setGroup('Edge Cases');

// Null player — setMode should not crash
const game7 = new Game();
game7.player = null;
game7.setMode(Game.MODES.CREATIVE);
assertEqual(game7.mode, 'creative', 'setMode should work without player reference');

// Player without setCreativeMode method (mock)
game7.player = {};
game7.setMode(Game.MODES.SURVIVAL);
assertEqual(game7.mode, 'survival', 'setMode should handle bare player object');

// Block palette with empty block list
const emptyPalette = new (require('../js/game')).BlockPalette();
emptyPalette._availableBlocks = [];
emptyPalette.cycleForward();
assert(true, 'cycleForward on empty palette should not crash');
emptyPalette.cycleBackward();
assert(true, 'cycleBackward on empty palette should not crash');

// ============================================================
// Summary
// ============================================================
console.log(`\n===================================`);
console.log(`Creative Mode Tests: ${passed} passed, ${failed} failed`);
console.log(`===================================`);
process.exit(failed > 0 ? 1 : 0);
