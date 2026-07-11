#!/usr/bin/env node
/**
 * Cuubz — Player Physics Tests
 * Tests for AABB collision, gravity, movement, ground detection
 */

const Player = require('../js/entities/player');
const { BLOCK_TYPES, BLOCK_PROPERTIES } = require('../js/world/chunkData');

// Globals needed by player.js
global.MIN_Y = -64;
global.SEA_LEVEL = 30;
global.BLOCK_TYPES = BLOCK_TYPES;
global.BLOCK_PROPERTIES = BLOCK_PROPERTIES;

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${message}`);
  }
}

console.log('Testing player physics...');

// --- Test 1: Player constructor defaults ---
const player = new Player();
assert(player.position.x === 0, 'Default X should be 0');
assert(player.position.y === 20, 'Default Y should be 20 (above ground)');
assert(player.position.z === 0, 'Default Z should be 0');
assert(player.width === 0.6, 'Player width should be 0.6 blocks');
assert(player.height === 1.8, 'Player height should be 1.8 blocks');

// --- Test 2: Physics constants ---
assert(player.gravity < 0, 'Gravity should be negative (downward)');
assert(player.jumpVelocity > 0, 'Jump velocity should be positive');
assert(player.moveSpeed > 0, 'Move speed should be positive');
assert(player.sprintMultiplier > 1, 'Sprint multiplier should be > 1');

// --- Test 3: Player starts not on ground (in air) ---
assert(player.onGround === false, 'Player should start in the air');

// --- Test 4: Velocity starts at zero ---
assert(player.velocity.x === 0, 'Initial X velocity should be 0');
assert(player.velocity.y === 0, 'Initial Y velocity should be 0');
assert(player.velocity.z === 0, 'Initial Z velocity should be 0');

// --- Test 5: Gravity applies without world ---
const player2 = new Player();
player2.update(0.1, { forward: false, backward: false, left: false, right: false, jumpDown: false, jumpHeld: false }, null);
assert(player2.velocity.y < 0, 'Gravity should reduce Y velocity');

// --- Test 6: Position changes with gravity (no world) ---
const startY = player2.position.y;
player2.update(0.5, { forward: false, backward: false, left: false, right: false, jumpDown: false, jumpHeld: false }, null);
assert(player2.position.y < startY, 'Player should fall when no ground');

// --- Test 7: Jump works when on ground (edge-based input) ---
const player3 = new Player();
player3.onGround = true;
player3.update(0.1, { forward: false, backward: false, left: false, right: false, jumpDown: true, jumpHeld: false }, null);
assert(player3.velocity.y > 0, 'Jump should set positive Y velocity');
assert(player3.velocity.y === player3.jumpVelocity, 'Jump velocity should match configured value');

// --- Test 8: Jump doesn't work in air (no double jump) ---
const player4 = new Player();
player4.onGround = false;
player4.update(0.1, { forward: false, backward: false, left: false, right: false, jumpDown: true, jumpHeld: false }, null);
assert(player4.velocity.y < 0 || player4.velocity.y === 0, 'Jump in air should not boost upward');

// --- Test 9: Movement direction calculation ---
const player5 = new Player();
player5.yaw = 0; // Facing -Z (forward in Three.js YXZ Euler)
player5.update(0.1, { forward: true, backward: false, left: false, right: false, jumpDown: false, jumpHeld: false }, null);
assert(player5.velocity.z < 0, 'Forward at yaw=0 should move in -Z');

// --- Test 10: Sprint multiplier applied (Shift + moving) ---
const player6 = new Player();
player6.yaw = 0;
player6.update(0.1, { forward: true, backward: false, left: false, right: false, jumpDown: false, jumpHeld: false, sprint: true }, null);
const sprintMag = Math.abs(player6.velocity.z);
const baseMag = player.moveSpeed;
assert(sprintMag > baseMag, `Sprint should increase speed beyond base (${sprintMag.toFixed(2)} > ${baseMag})`);
assert(player6.isSprinting === true, 'isSprinting auto-set when sprint input + moving');

// --- Test 11: getEyePosition returns correct offset ---
const eye = player.getEyePosition();
assert(eye.y === player.position.y + 1.6, 'Eye Y should be position + 1.6');
assert(eye.x === player.position.x, 'Eye X should match position');
assert(eye.z === player.position.z, 'Eye Z should match position');

// --- Test 12: Respawn resets velocity ---
player.velocity = { x: 10, y: 10, z: 10 };
player.respawn({ x: 0, y: 20, z: 0 });
assert(player.velocity.x === 0, 'Respawn should reset X velocity');
assert(player.velocity.y === 0, 'Respawn should reset Y velocity');
assert(player.velocity.z === 0, 'Respawn should reset Z velocity');

// --- Test 13: Respawn sets position ---
player.respawn({ x: 5, y: 30, z: -10 });
assert(player.position.x === 5, 'Respawn X should match spawn point');
assert(player.position.y === 30, 'Respawn Y should match spawn point');
assert(player.position.z === -10, 'Respawn Z should match spawn point');

// --- Test 14: Respawn with no spawn point uses defaults ---
player.respawn(null);
assert(player.position.x === 0, 'Default respawn X should be 0');
assert(player.position.y === SEA_LEVEL + 4, 'Default respawn Y should be SEA_LEVEL+4');
assert(player.position.z === 0, 'Default respawn Z should be 0');

// --- Test 15: _isSolidAt correctly identifies solid blocks ---
const mockWorld = {
  getBlockAtWorld: (x, y, z) => BLOCK_TYPES.STONE
};
assert(player._isSolidAt(0, 0, 0, mockWorld) === true, 'Stone should be solid');

// --- Test 16: _isSolidAt correctly identifies non-solid blocks ---
const airWorld = {
  getBlockAtWorld: (x, y, z) => BLOCK_TYPES.AIR
};
assert(player._isSolidAt(0, 0, 0, airWorld) === false, 'Air should not be solid');

// --- Test 17: Diagonal movement normalization ---
const player7 = new Player();
player7.yaw = Math.PI / 4; // 45 degrees
player7.update(0.1, { forward: true, backward: false, left: true, right: false, jumpDown: false, jumpHeld: false }, null);
// After normalization, velocity magnitude should not exceed moveSpeed * sqrt(2)
const mag = Math.sqrt(player7.velocity.x ** 2 + player7.velocity.z ** 2);
assert(mag <= player7.moveSpeed * 1.01, `Diagonal movement should be normalized (mag=${mag.toFixed(3)})`);

// --- Test 18: setCreativeMode disables gravity ---
const player8 = new Player();
player8.setCreativeMode(true);
assert(player8.gravityEnabled === false, 'Creative mode should disable gravity');
assert(player8.flySpeed !== undefined, 'Creative mode should set fly speed');

// --- Test 19: setCreativeMode re-enables gravity on exit ---
player8.setCreativeMode(false);
assert(player8.gravityEnabled === true, 'Leaving creative should re-enable gravity');
assert(player8.flyMode === false, 'Leaving creative should disable fly mode');

// --- Summary ---
console.log(`\nPlayer Physics Tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
