#!/usr/bin/env node
/**
 * Cuubz — Server Validation Tests
 * Tests that the host properly validates all block changes, inventory updates,
 * and movement from remote players. Covers: range checks, coordinate validation,
 * inventory verification, rate limiting, and edge cases.
 */

'use strict';

const { validateBlockBreak, validateBlockPlace, validateMove, validateQuestUpdate } = require('../js/multiplayer/host');
const { InventoryValidator, VALID_BLOCK_IDS, VALID_NAMED_ITEMS, MAX_STACK, isValidTypeId, validateSlot, slotsEqual, DEFAULT_INVENTORY_ROWS, DEFAULT_INVENTORY_COLS, validateInventory: invSyncValidateInventory } = require('../js/multiplayer/inventorySync');
const { HOST_STATE, DEFAULT_HOST_CONFIG, RateLimiter } = require('../js/multiplayer/host');

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

// ─── Test Execution ────────────────────────────────────────────

function runTests() {
  group('1. Host rejects invalid block break — coordinate validation');

  const hostConfig = DEFAULT_HOST_CONFIG;
  const playerPos = { x: 8.5, y: 20.3, z: 8.5 }; // Player at ~floor (8, 20, 8)

  // Valid break: integer coords within reach
  let result = validateBlockBreak('player1', playerPos, 8, 19, 8, hostConfig);
  assert(result.valid === true, 'Valid block break accepted (integer coords, in range)');

  // Invalid: non-integer coordinates
  result = validateBlockBreak('player1', playerPos, 8.5, 19.7, 8.2, hostConfig);
  assert(result.valid === false, 'Non-integer coordinates rejected');
  assert(result.reason === 'Non-integer coordinates', `Reason correct: "${result.reason}"`);

  // Invalid: Y below world minimum (-32)
  result = validateBlockBreak('player1', playerPos, 8, -33, 8, hostConfig);
  assert(result.valid === false, 'Y below -32 rejected');
  assert(result.reason.includes('out of bounds'), `Reason mentions bounds: "${result.reason}"`);

  // Invalid: Y above world maximum (64)
  result = validateBlockBreak('player1', playerPos, 8, 65, 8, hostConfig);
  assert(result.valid === false, 'Y above 64 rejected');

  // Invalid: too far away (reach distance = 6 blocks by default)
  result = validateBlockBreak('player1', playerPos, 20, 20, 20, hostConfig);
  assert(result.valid === false, 'Block break too far away rejected');
  assert(result.reason.includes('far away'), `Reason mentions distance: "${result.reason}"`);

  // Edge case: exactly at reach distance boundary (distance = 6)
  result = validateBlockBreak('player1', playerPos, 14, 20, 8, hostConfig);
  assert(result.valid === true, 'Block break at exact reach distance (6 blocks) accepted');

  // Edge case: one block past reach distance
  result = validateBlockBreak('player1', playerPos, 15, 20, 8, hostConfig);
  assert(result.valid === false, 'Block break one block past reach distance rejected');

  group('2. Host rejects invalid block place — coordinate + type validation');

  // Valid place: integer coords, valid blockType within reach
  result = validateBlockPlace('player1', playerPos, 8, 21, 8, 3, hostConfig);
  assert(result.valid === true, 'Valid block place accepted (integer coords, in range, stone type)');

  // Invalid: non-integer coordinates
  result = validateBlockPlace('player1', playerPos, 8.5, 21, 8, 3, hostConfig);
  assert(result.valid === false, 'Non-integer place coordinates rejected');

  // Invalid: Y out of bounds
  result = validateBlockPlace('player1', playerPos, 8, -40, 8, 3, hostConfig);
  assert(result.valid === false, 'Y below world min rejected for block place');

  result = validateBlockPlace('player1', playerPos, 8, 70, 8, 3, hostConfig);
  assert(result.valid === false, 'Y above world max rejected for block place');

  // Invalid: negative blockType
  result = validateBlockPlace('player1', playerPos, 8, 21, 8, -1, hostConfig);
  assert(result.valid === false, 'Negative blockType rejected');

  // Invalid: undefined blockType
  result = validateBlockPlace('player1', playerPos, 8, 21, 8, undefined, hostConfig);
  assert(result.valid === false, 'Undefined blockType rejected');

  // Invalid: too far away
  result = validateBlockPlace('player1', playerPos, 50, 20, 50, 3, hostConfig);
  assert(result.valid === false, 'Block place too far away rejected');

  // Valid: zero blockType (air — technically valid placement)
  result = validateBlockPlace('player1', playerPos, 8, 21, 8, 0, hostConfig);
  assert(result.valid === true, 'Zero blockType (air) accepted for placement');

  group('3. Movement validation — position and rotation checks');

  // Valid movement: reasonable coordinates with rotation
  result = validateMove('player1', { x: 8, y: 20, z: 8 }, { yaw: 0.5, pitch: -0.2 });
  assert(result.valid === true, 'Valid movement accepted (with rotation)');

  // Invalid: non-numeric rotation
  result = validateMove('player1', { x: 8, y: 20, z: 8 }, { yaw: 'invalid', pitch: 0 });
  assert(result.valid === false, 'Non-numeric rotation rejected');

  // Valid: null rotation (server may use last known)
  result = validateMove('player1', { x: 8, y: 20, z: 8 }, null);
  assert(result.valid === true, 'Null rotation accepted (uses last known)');

  group('4. Inventory validation — slot and item verification');

  // Test pure utility functions first
  assert(isValidTypeId(3) === true, 'isValidTypeId(3) returns true for block type');
  assert(isValidTypeId('coal') === true, 'isValidTypeId("coal") returns true for named item');
  assert(isValidTypeId(-1) === false, 'isValidTypeId(-1) returns false');
  assert(isValidTypeId('unknown_item') === false, 'isValidTypeId("unknown_item") returns false');

  // Test validateSlot
  let slotResult = validateSlot({ typeId: 3, count: 64 });
  assert(slotResult.valid === true, 'Valid slot (stone, 64) passes validation');

  slotResult = validateSlot({ typeId: 3, count: -5 });
  assert(slotResult.valid === false, 'Negative count fails slot validation');

  slotResult = validateSlot(null);
  assert(slotResult.valid === true, 'Null slot (empty) passes validation');

  // Test validateInventory with proper structure
  const validInventory = [
    { typeId: 3, count: 64 },   // Stone (block type)
    { typeId: 7, count: 12 },   // Wood Log
    null,                        // Empty slot
    { typeId: 'coal', count: 10 }, // Named item
  ];

  let invResult = invSyncValidateInventory(validInventory);
  assert(invResult.valid === true && invResult.errors.length === 0, 'Valid inventory structure passes validation with no errors');

  // Invalid inventory: wrong type for a slot
  const badInventory = [
    { typeId: 3, count: 64 },
    'not_an_object',             // Invalid slot
  ];
  invResult = invSyncValidateInventory(badInventory);
  assert(invResult.valid === false, 'Inventory with non-object slot fails validation');

  group('5. InventoryValidator — block place checks hotbar slot');

  const validator = new InventoryValidator();

  // Build a full inventory (9x4=36 slots) with stone in hotbar slot 0 (global index 27)
  const fullInventory = new Array(36).fill(null);
  fullInventory[27] = { typeId: 3, count: 64 }; // Stone in selected hotbar slot

  validator.registerPlayer('player1', fullInventory);
  assert(validator.hasPlayer('player1') === true, 'Player registered in validator');

  // Validate block break — no inventory check needed for breaking
  let vResult = validator.validateBlockBreak('player1', 3, false);
  assert(vResult.valid === true, 'Block break validated (has space or can stack)');

  // Block place with stone — player has it in selected hotbar slot (index 0 → global 27)
  vResult = validator.validateBlockPlace('player1', 3, 0);
  assert(vResult.valid === true, 'Block place accepted — stone in selected hotbar slot');

  // Block place with diamond ore — not in any inventory slot
  vResult = validator.validateBlockPlace('player1', 21, 0);
  assert(vResult.valid === false, 'Block place rejected — diamond ore not in selected slot');

  group('6. InventoryValidator — edge cases and sanitization');

  // Empty inventory player
  const emptyValidator = new InventoryValidator();
  emptyValidator.registerPlayer('emptyplayer', []);
  vResult = emptyValidator.validateBlockPlace('emptyplayer', 3, 0);
  assert(vResult.valid === false, 'Empty inventory rejected for block place');

  // Player with only null (empty) slots
  const nullValidator = new InventoryValidator();
  nullValidator.registerPlayer('nullplayer', new Array(36).fill(null));
  vResult = nullValidator.validateBlockPlace('nullplayer', 3, 0);
  assert(vResult.valid === false, 'All-null inventory rejected for block place');

  group('7. Quest update validation — numeric progress');

  // Valid quest progress update — progress must be a number
  result = validateQuestUpdate('player1', { questId: 'Q01', progress: 5 });
  assert(result.valid === true, 'Valid quest update accepted (numeric progress)');

  // Invalid: missing questId
  result = validateQuestUpdate('player1', { progress: 5 });
  assert(result.valid === false, 'Quest update without questId rejected');

  // Invalid: null progress data
  result = validateQuestUpdate('player1', { questId: 'Q01', progress: null });
  assert(result.valid === false, 'Null progress data rejected');

  // Invalid: negative progress
  result = validateQuestUpdate('player1', { questId: 'Q01', progress: -1 });
  assert(result.valid === false, 'Negative progress rejected');

  // Valid: zero progress (starting a quest)
  result = validateQuestUpdate('player1', { questId: 'Q01', progress: 0 });
  assert(result.valid === true, 'Zero progress accepted (quest start)');

  group('8. Multi-player validation — each player validated independently');

  const multiValidator = new InventoryValidator();

  // Player A has stone in hotbar slot 0 (global index 27)
  const invA = new Array(36).fill(null);
  invA[27] = { typeId: 3, count: 64 };
  multiValidator.registerPlayer('playerA', invA);

  // Player B has wood in hotbar slot 0 (global index 27)
  const invB = new Array(36).fill(null);
  invB[27] = { typeId: 7, count: 12 };
  multiValidator.registerPlayer('playerB', invB);

  // Player A can place stone but not wood
  vResult = multiValidator.validateBlockPlace('playerA', 3, 0);
  assert(vResult.valid === true, 'Player A can place stone (in their selected hotbar slot)');

  vResult = multiValidator.validateBlockPlace('playerA', 7, 0);
  assert(vResult.valid === false, 'Player A cannot place wood (not in their inventory)');

  // Player B can place wood but not stone
  vResult = multiValidator.validateBlockPlace('playerB', 7, 0);
  assert(vResult.valid === true, 'Player B can place wood (in their selected hotbar slot)');

  vResult = multiValidator.validateBlockPlace('playerB', 3, 0);
  assert(vResult.valid === false, 'Player B cannot place stone (not in their inventory)');

  group('9. Boundary condition — Y coordinate edge cases');

  // Exactly at world boundaries
  result = validateBlockBreak('player1', { x: 0, y: -32, z: 0 }, 0, -32, 0, hostConfig);
  assert(result.valid === true, 'Block break at Y=-32 (world bottom) accepted');

  result = validateBlockBreak('player1', { x: 0, y: 64, z: 0 }, 0, 64, 0, hostConfig);
  assert(result.valid === true, 'Block break at Y=64 (world top) accepted');

  // One past boundaries
  result = validateBlockBreak('player1', { x: 0, y: -32, z: 0 }, 0, -33, 0, hostConfig);
  assert(result.valid === false, 'Block break at Y=-33 rejected (below world)');

  result = validateBlockBreak('player1', { x: 0, y: 64, z: 0 }, 0, 65, 0, hostConfig);
  assert(result.valid === false, 'Block break at Y=65 rejected (above world)');

  group('10. Custom configuration overrides');

  // Test with custom reach distance
  const wideReachConfig = Object.assign({}, DEFAULT_HOST_CONFIG, { reachDistance: 12 });
  result = validateBlockBreak('player1', playerPos, 20, 20, 8, wideReachConfig);
  assert(result.valid === true, 'Wide reach config (12 blocks) allows distant break');

  // Test with narrow Y bounds
  const narrowYConfig = Object.assign({}, DEFAULT_HOST_CONFIG, { yMin: -16, yMax: 48 });
  result = validateBlockBreak('player1', playerPos, 8, -32, 8, narrowYConfig);
  assert(result.valid === false, 'Narrow Y bounds reject Y=-32 when min is -16');

  result = validateBlockBreak('player1', playerPos, 8, 50, 8, narrowYConfig);
  assert(result.valid === false, 'Narrow Y bounds reject Y=50 when max is 48');

  group('11. RateLimiter — throttles rapid actions');

  const rl = new RateLimiter(10, 1000); // Max 10 per second
  assert(rl.check().allowed === true, 'First action allowed by rate limiter');

  let allowedCount = 1;
  for (let i = 0; i < 9; i++) {
    if (rl.check().allowed) allowedCount++;
  }
  assert(allowedCount === 10, `Rate limiter allows exactly 10 actions per window (got ${allowedCount})`);

  // 11th should be blocked
  assert(rl.check().allowed === false, '11th action blocked by rate limiter');

  group('12. Inventory utility functions');

  // slotsEqual deep comparison
  assert(slotsEqual({ typeId: 3, count: 64 }, { typeId: 3, count: 64 }) === true, 'slotsEqual: identical slots match');
  assert(slotsEqual({ typeId: 3, count: 64 }, { typeId: 7, count: 64 }) === false, 'slotsEqual: different typeId mismatches');
  assert(slotsEqual(null, null) === true, 'slotsEqual: both null match');
  assert(slotsEqual({ typeId: 3, count: 10 }, null) === false, 'slotsEqual: slot vs null mismatch');

  // VALID_BLOCK_IDS and VALID_NAMED_ITEMS constants (Sets)
  assert(VALID_BLOCK_IDS instanceof Set, 'VALID_BLOCK_IDS is a Set');
  assert(VALID_BLOCK_IDS.has(3), 'VALID_BLOCK_IDS includes stone (3)');
  assert(VALID_BLOCK_IDS.has(0), 'VALID_BLOCK_IDS includes air (0)');

  assert(VALID_NAMED_ITEMS instanceof Set, 'VALID_NAMED_ITEMS is a Set');
  assert(VALID_NAMED_ITEMS.has('coal'), 'VALID_NAMED_ITEMS includes coal');
  assert(VALID_NAMED_ITEMS.has('apple'), 'VALID_NAMED_ITEMS includes apple');

  // MAX_STACK constant (object with per-category limits)
  assert(typeof MAX_STACK === 'object', 'MAX_STACK is an object');
  assert(MAX_STACK.block === 64, `Block max stack is 64`);
  assert(MAX_STACK.food === 16, `Food max stack is 16`);

  group('13. Host state machine constants');

  assert(HOST_STATE.IDLE === 'idle', 'HOST_STATE.IDLE is "idle"');
  assert(HOST_STATE.CONNECTING === 'connecting', 'HOST_STATE.CONNECTING is "connecting"');
  assert(HOST_STATE.HOSTING === 'hosting', 'HOST_STATE.HOSTING is "hosting"');
  assert(HOST_STATE.ACTIVE === 'active', 'HOST_STATE.ACTIVE is "active"');
  assert(HOST_STATE.ENDING === 'ending', 'HOST_STATE.ENDING is "ending"');

  // DEFAULT_HOST_CONFIG expected values
  assert(DEFAULT_HOST_CONFIG.reachDistance === 6, `Default reach distance is 6`);
  assert(DEFAULT_HOST_CONFIG.yMin === -32, `Default Y min is -32`);
  assert(DEFAULT_HOST_CONFIG.yMax === 64, `Default Y max is 64`);
  assert(DEFAULT_HOST_CONFIG.maxPlayers === 4, `Default max players is 4`);

  group('14. InventoryValidator — processInventoryUpdate');

  const updateValidator = new InventoryValidator();
  const initialInv = new Array(36).fill(null);
  initialInv[27] = { typeId: 3, count: 64 };
  updateValidator.registerPlayer('p1', initialInv);

  // Process a valid inventory update
  const updatedSlots = [...initialInv];
  updatedSlots[27] = { typeId: 3, count: 63 }; // Used one stone
  let updateResult = updateValidator.processInventoryUpdate('p1', { slots: updatedSlots });
  assert(updateResult.accepted === true, 'Valid inventory update accepted');

  // Verify the update was stored
  let playerInv = updateValidator.getPlayerInventory('p1');
  assert(playerInv !== null, 'getPlayerInventory returns data after update');
  assert(playerInv.slots[27].count === 63, 'Stone count reduced to 63 after update');

  // Process an invalid inventory update (strict mode sanitizes)
  const badSlots = [...initialInv];
  badSlots[27] = { typeId: -1, count: 999 }; // Invalid type
  updateResult = updateValidator.processInventoryUpdate('p1', { slots: badSlots });
  assert(updateResult.accepted === false, 'Invalid inventory update rejected in strict mode');
  assert(updateResult.sanitized === true, 'Rejected update was sanitized');

  group('15. InventoryValidator — unregister and save data');

  const saveValidator = new InventoryValidator();
  const saveInv = new Array(36).fill(null);
  saveInv[27] = { typeId: 7, count: 10 };
  saveInv[28] = { typeId: 'coal', count: 5 };
  saveValidator.registerPlayer('quitting', saveInv);

  // Unregister should return save data
  const saveData = saveValidator.unregisterPlayer('quitting');
  assert(saveData !== null, 'unregisterPlayer returns save data');
  assert(saveData.slots[27].typeId === 7, 'Save data preserves wood log');
  assert(saveData.slots[28].typeId === 'coal', 'Save data preserves coal');

  assert(saveValidator.hasPlayer('quitting') === false, 'Player removed after unregister');

  // ─── Results ────────────────────────────────────────

  console.log('\n===================================');
  console.log(`  Server Validation Tests: ${passCount} passed, ${failCount} failed`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) {
      console.log(`  - ${f}`);
    }
  } else {
    console.log('  🎉 All server validation tests passing!');
  }
  console.log('===================================\n');

  process.exit(failCount > 0 ? 1 : 0);
}

runTests();
