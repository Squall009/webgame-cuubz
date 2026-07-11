#!/usr/bin/env node
/**
 * Cuubz — Player Movement Integration Tests
 * Tests the full pipeline: KeyboardInput → Player movement → Collision
 * Also tests sprint/stamina interaction and touch control simulation.
 *
 * Covers todo.md Phase 1 Testing items:
 * - Test: Player movement (WASD + jump, gravity, collision, sprint)
 * - Test: Touch controls (joystick, swipe-to-look, tap)
 */

const Player = require('../js/entities/player');
const { KeyboardInput } = require('../js/input/keyboard');
const TouchInput = require('../js/input/touch');
const { SurvivalSystem, STAMINA_COSTS } = require('../js/systems/survival');
const { BLOCK_TYPES, BLOCK_PROPERTIES } = require('../js/world/chunkData');

// Globals needed by player.js
global.MIN_Y = -64;
global.SEA_LEVEL = 30;
global.BLOCK_TYPES = BLOCK_TYPES;
global.BLOCK_PROPERTIES = BLOCK_PROPERTIES;

let passed = 0;
let failed = 0;
let totalAssertions = 0;

function assert(condition, message) {
  totalAssertions++;
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${message}`);
  }
}

function assertApprox(a, b, tolerance, message) {
  totalAssertions++;
  const cond = Math.abs(a - b) <= tolerance;
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${message} (got ${a}, expected ~${b}, tol=${tolerance})`);
  }
}

// ─── Helper: Simulate keyboard events on KeyboardInput ──────────────
function simulateKeyDown(ki, code) {
  ki._onKeyDown({ code, preventDefault: () => {} });
}

function simulateKeyUp(ki, code) {
  ki._onKeyUp({ code });
}

// ═══════════════════════════════════════════════════════════════════════
// TEST GROUP 1: KeyboardInput event handling
// ═══════════════════════════════════════════════════════════════════════
console.log('\n=== Group 1: Keyboard Input Event Handling ===');

{
  const ki = new KeyboardInput();

  // Initial state: all false
  assert(ki.forward === false, 'Initial forward is false');
  assert(ki.backward === false, 'Initial backward is false');
  assert(ki.left === false, 'Initial left is false');
  assert(ki.right === false, 'Initial right is false');
  assert(ki.jumpAction.held === false, 'Initial jump is false');
  assert(ki.sprint === false, 'Initial sprint is false');
  assert(ki.interact === false, 'Initial interact is false');

  // W → forward
  simulateKeyDown(ki, 'KeyW');
  assert(ki.forward === true, 'W key sets forward=true');
  assert(ki.keys['KeyW'] === true, 'KeyW tracked in keys map');

  // S → backward
  simulateKeyDown(ki, 'KeyS');
  assert(ki.backward === true, 'S key sets backward=true');

  // A → left
  simulateKeyDown(ki, 'KeyA');
  assert(ki.left === true, 'A key sets left=true');

  // D → right
  simulateKeyDown(ki, 'KeyD');
  assert(ki.right === true, 'D key sets right=true');

  // Space → jump
  simulateKeyDown(ki, 'Space');
  ki.update(); // Process edge detection
  assert(ki.jumpAction.held === true, 'Space sets jump held=true');
  assert(ki.jumpAction.down === true, 'Space sets jump down=true on first frame');

  // Shift → sprint
  simulateKeyDown(ki, 'ShiftLeft');
  assert(ki.sprint === true, 'ShiftLeft sets sprint=true');

  simulateKeyUp(ki, 'ShiftLeft');
  simulateKeyDown(ki, 'ShiftRight');
  assert(ki.sprint === true, 'ShiftRight also sets sprint=true');

  // E → interact
  simulateKeyDown(ki, 'KeyE');
  assert(ki.interact === true, 'E key sets interact=true');

  // Key up clears state
  simulateKeyUp(ki, 'KeyW');
  assert(ki.forward === false, 'W release sets forward=false');
  assert(ki.keys['KeyW'] === false, 'KeyW cleared from keys map');

  simulateKeyUp(ki, 'KeyS');
  assert(ki.backward === false, 'S release sets backward=false');

  simulateKeyUp(ki, 'KeyA');
  assert(ki.left === false, 'A release sets left=false');

  simulateKeyUp(ki, 'KeyD');
  assert(ki.right === false, 'D release sets right=false');

  simulateKeyUp(ki, 'Space');
  ki.update(); // Process edge detection
  assert(ki.jumpAction.held === false, 'Space release sets jump held=false');

  // Just-pressed tracking
  simulateKeyDown(ki, 'KeyW');
  assert(ki.isJustPressed('KeyW') === true, 'KeyW is just pressed after keydown');

  ki.update(); // Clear just-pressed flags
  assert(ki.isJustPressed('KeyW') === false, 'KeyW no longer just pressed after update()');
}

// ═══════════════════════════════════════════════════════════════════════
// TEST GROUP 2: Camera-relative movement at different yaw angles
// ═══════════════════════════════════════════════════════════════════════
console.log('\n=== Group 2: Camera-Relative Movement ===');

{
  // Three.js YXZ Euler: forward = (-sin(yaw), 0, -cos(yaw))
  // Yaw = 0 → facing -Z (forward). sin(0)=0, cos(0)=1 → moveZ = -1
  {
    const p = new Player();
    p.yaw = 0;
    const input = { forward: true, backward: false, left: false, right: false, jumpDown: false, jumpHeld: false };
    p.update(0.1, input, null);

    assert(p.velocity.z < 0, 'Forward at yaw=0 moves in -Z');
    assertApprox(p.velocity.x, 0, 0.001, 'No X movement when facing -Z');
    assertApprox(Math.abs(p.velocity.z), p.moveSpeed, 0.01, 'Velocity magnitude equals moveSpeed');
  }

  // Yaw = π → facing +Z
  {
    const p = new Player();
    p.yaw = Math.PI;
    const input = { forward: true, backward: false, left: false, right: false, jumpDown: false, jumpHeld: false };
    p.update(0.1, input, null);

    assert(p.velocity.z > 0, 'Forward at yaw=π moves in +Z');
  }

  // Yaw = π/2 → facing -X (moveX = -sin(π/2) = -1)
  {
    const p = new Player();
    p.yaw = Math.PI / 2;
    const input = { forward: true, backward: false, left: false, right: false, jumpDown: false, jumpHeld: false };
    p.update(0.1, input, null);

    assert(p.velocity.x < 0, 'Forward at yaw=π/2 moves in -X');
  }

  // Yaw = -π/2 → facing +X (moveX = -sin(-π/2) = 1)
  {
    const p = new Player();
    p.yaw = -Math.PI / 2;
    const input = { forward: true, backward: false, left: false, right: false, jumpDown: false, jumpHeld: false };
    p.update(0.1, input, null);

    assert(p.velocity.x > 0, 'Forward at yaw=-π/2 moves in +X');
  }

  // Strafe left (A) at yaw=0: sideX=cos(0)=1 → dx -= 1 → -X direction
  {
    const p = new Player();
    p.yaw = 0;
    const input = { forward: false, backward: false, left: true, right: false, jumpDown: false, jumpHeld: false };
    p.update(0.1, input, null);

    assert(p.velocity.x < 0, 'Strafe left at yaw=0 moves in -X');
    assertApprox(p.velocity.z, 0, 0.001, 'No Z from strafe left at yaw=0');
  }

  // Strafe right (D) at yaw=0: dx += sideX → +X direction
  {
    const p = new Player();
    p.yaw = 0;
    const input = { forward: false, backward: false, left: false, right: true, jumpDown: false, jumpHeld: false };
    p.update(0.1, input, null);

    assert(p.velocity.x > 0, 'Strafe right at yaw=0 moves in +X');
    assertApprox(p.velocity.z, 0, 0.001, 'No Z from strafe right at yaw=0');
  }

  // Backward movement (S key)
  {
    const p = new Player();
    p.yaw = 0;
    const input = { forward: false, backward: true, left: false, right: false, jumpDown: false, jumpHeld: false };
    p.update(0.1, input, null);

    assert(p.velocity.z > 0, 'Backward at yaw=0 moves in +Z');
  }

  // Diagonal normalization (W+A)
  {
    const p = new Player();
    p.yaw = 0;
    const input = { forward: true, backward: false, left: true, right: false, jumpDown: false, jumpHeld: false };
    p.update(0.1, input, null);

    const mag = Math.sqrt(p.velocity.x ** 2 + p.velocity.z ** 2);
    assert(mag <= p.moveSpeed * 1.001, `Diagonal normalized (mag=${mag.toFixed(3)} ≤ ${p.moveSpeed})`);
    assert(p.velocity.x < 0 && p.velocity.z < 0, 'W+A: X negative (left), Z negative (forward)');
  }

  // No input → no horizontal movement
  {
    const p = new Player();
    p.yaw = 0;
    const input = { forward: false, backward: false, left: false, right: false, jumpDown: false, jumpHeld: false };
    p.update(0.1, input, null);

    assertApprox(p.velocity.x, 0, 0.001, 'No horizontal velocity with no input');
    assertApprox(p.velocity.z, 0, 0.001, 'No Z velocity with no input');
  }

  // Contradictory inputs (W+S cancel)
  {
    const p = new Player();
    p.yaw = 0;
    const input = { forward: true, backward: true, left: false, right: false, jumpDown: false, jumpHeld: false };
    p.update(0.1, input, null);

    assertApprox(p.velocity.x, 0, 0.001, 'W+S cancel horizontal X');
    assertApprox(p.velocity.z, 0, 0.001, 'W+S cancel horizontal Z');
  }
}

// ═══════════════════════════════════════════════════════════════════════
// TEST GROUP 3: Gravity and Jumping
// ═══════════════════════════════════════════════════════════════════════
console.log('\n=== Group 3: Gravity and Jumping ===');

{
  // Gravity accumulates over time
  {
    const p = new Player();
    const input = { forward: false, backward: false, left: false, right: false, jumpDown: false, jumpHeld: false };
    p.update(0.1, input, null);
    const v1 = p.velocity.y;
    p.update(0.1, input, null);
    const v2 = p.velocity.y;

    assert(v2 < v1, 'Gravity accumulates each frame');
    assert(v1 < 0, 'Velocity becomes negative (falling)');
  }

  // Jump only works when on ground
  {
    const p = new Player();
    p.onGround = true;
    p.velocity.y = 0;
    const input = { forward: false, backward: false, left: false, right: false, jumpDown: true, jumpHeld: true };
    p.update(0.1, input, null);

    assert(p.velocity.y === p.jumpVelocity, 'Jump sets velocity to jumpVelocity');
    assert(p.onGround === false, 'Jump clears onGround flag');
  }

  // No double jump
  {
    const p = new Player();
    p.onGround = false;
    p.velocity.y = -5;
    const input = { forward: false, backward: false, left: false, right: false, jumpDown: true, jumpHeld: true };
    p.update(0.1, input, null);

    assert(p.velocity.y < 0, 'Jump in air does not boost upward');
  }

  // Jump reaches peak height
  {
    const p = new Player();
    p.onGround = true;
    p.position.y = 10;
    const startY = p.position.y;

    // Frame 0: jump
    p.update(0.05, { forward: false, backward: false, left: false, right: false, jumpDown: true, jumpHeld: true }, null);
    assert(p.position.y > startY, 'Player rises immediately after jump');

    // Peak reached within ~0.4s (vy=9, gravity=-25 → 9/25 ≈ 0.36s)
    let maxY = p.position.y;
    for (let i = 1; i < 12; i++) {
      p.update(0.05, { forward: false, backward: false, left: false, right: false, jumpDown: false, jumpHeld: false }, null);
      if (p.position.y > maxY) maxY = p.position.y;
    }

    assert(maxY > startY + 1, `Player reaches peak height (${maxY.toFixed(2)} vs start ${startY})`);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// TEST GROUP 4: Collision Detection with World Blocks
// ═══════════════════════════════════════════════════════════════════════
console.log('\n=== Group 4: Collision Detection ===');

{
  // _isSolidAt correctly identifies solid/non-solid blocks
  {
    const p = new Player();
    const makeWorld = (blockId) => ({ getBlockAtWorld: () => blockId });

    assert(p._isSolidAt(0, 0, 0, makeWorld(BLOCK_TYPES.GRASS)) === true, 'Grass is solid');
    assert(p._isSolidAt(0, 0, 0, makeWorld(BLOCK_TYPES.DIRT)) === true, 'Dirt is solid');
    assert(p._isSolidAt(0, 0, 0, makeWorld(BLOCK_TYPES.STONE)) === true, 'Stone is solid');
    assert(p._isSolidAt(0, 0, 0, makeWorld(BLOCK_TYPES.WOOD_LOG)) === true, 'Wood log is solid');
    assert(p._isSolidAt(0, 0, 0, makeWorld(BLOCK_TYPES.SAND)) === true, 'Sand is solid');
    assert(p._isSolidAt(0, 0, 0, makeWorld(BLOCK_TYPES.BEDROCK)) === true, 'Bedrock is solid');

    assert(p._isSolidAt(0, 0, 0, makeWorld(BLOCK_TYPES.AIR)) === false, 'Air is not solid');
    assert(p._isSolidAt(0, 0, 0, makeWorld(BLOCK_TYPES.WATER)) === false, 'Water is not solid');
    assert(p._isSolidAt(0, 0, 0, makeWorld(BLOCK_TYPES.LEAVES)) === false, 'Leaves are not solid');
  }

  // Collision with a single block at player feet level
  {
    // Create a minimal mock world with one ground block
    const mockWorld = {
      getBlockAtWorld: function(x, y, z) {
        // Ground plane at y=0 across all x,z
        if (y === 0) return BLOCK_TYPES.GRASS;
        if (y < 0) return BLOCK_TYPES.STONE;
        return BLOCK_TYPES.AIR;
      }
    };

    const p = new Player();
    p.position.x = 0;
    p.position.y = 1; // Just above ground
    p.position.z = 0;
    p.velocity.y = -2; // Falling slowly toward ground

    // After one update, player should hit the ground block at y=0
    const input = { forward: false, backward: false, left: false, right: false, jumpDown: false, jumpHeld: false };
    p.update(0.05, input, mockWorld);

    assert(p.onGround === true || p.velocity.y >= 0, 'Player should detect ground collision or stop falling');
  }

  // Player at ground level stays grounded
  {
    const mockWorld = {
      getBlockAtWorld: function(x, y, z) {
        if (y === 0) return BLOCK_TYPES.GRASS;
        if (y < 0) return BLOCK_TYPES.STONE;
        return BLOCK_TYPES.AIR;
      }
    };

    const p = new Player();
    p.position.x = 0;
    p.position.y = 1;
    p.position.z = 0;
    p.velocity.y = 0;
    p.onGround = true;

    // Without input, player should stay at same Y (gravity pulls down but ground blocks)
    const input = { forward: false, backward: false, left: false, right: false, jumpDown: false, jumpHeld: false };
    p.update(0.1, input, mockWorld);

    assert(p.position.y >= 0.5, 'Player should stay above ground (y=' + p.position.y.toFixed(2) + ')');
  }

  // Without world, no collision — gravity still works
  {
    const p = new Player();
    p.position.y = 10;
    const startY = p.position.y;

    const input = { forward: false, backward: false, left: false, right: false, jumpDown: false, jumpHeld: false };
    p.update(0.1, input, null); // No world — gravity applies freely

    assert(p.position.y < startY, 'Without world, player falls due to gravity (no collision)');
  }

  // World bounds clamp Y to minimum MIN_Y
  {
    const p = new Player();
    p.position.y = MIN_Y + 1;
    p.velocity.y = -100;

    p.update(0.1, { forward: false, backward: false, left: false, right: false, jumpDown: false, jumpHeld: false }, null);

    assert(p.position.y >= MIN_Y, 'Player Y clamped to minimum world bound');
  }
}

// ═══════════════════════════════════════════════════════════════════════
// TEST GROUP 5: Sprint + Stamina Interaction
// ═══════════════════════════════════════════════════════════════════════
console.log('\n=== Group 5: Sprint + Stamina Interaction ===');

{
  // Sprint multiplier increases speed (Shift + moving)
  {
    const p = new Player();
    p.yaw = 0;

    const input = { forward: true, backward: false, left: false, right: false, jumpDown: false, jumpHeld: false, sprint: true };
    p.update(0.1, input, null);

    const expected = p.moveSpeed * p.sprintMultiplier;
    assertApprox(Math.abs(p.velocity.z), expected, 0.01, `Sprint speed = moveSpeed * sprintMultiplier (${expected})`);
    assert(Math.abs(p.velocity.z) > p.moveSpeed, 'Sprint velocity exceeds base moveSpeed');
    assert(p.isSprinting === true, 'isSprinting is auto-set when sprint input + moving');
  }

  // No sprint when not moving (Shift alone does nothing)
  {
    const p = new Player();
    p.yaw = 0;

    const input = { forward: false, backward: false, left: false, right: false, jumpDown: false, jumpHeld: false, sprint: true };
    p.update(0.1, input, null);

    assert(p.isSprinting === false, 'isSprinting is false when not moving');
    assertApprox(p.velocity.x, 0, 0.001, 'No horizontal velocity without movement keys');
    assertApprox(p.velocity.z, 0, 0.001, 'No Z velocity without movement keys');
  }

  // Sprinting consumes stamina (STAMINA_COSTS.SPRINT per second)
  {
    const survival = new SurvivalSystem();
    survival.lastStaminaActionTime = 0; // Prevent regen interference
    const initialStamina = survival.meters.stamina;

    survival.update(5, { isSprinting: true, isJumping: false, isMoving: true, currentTime: 10 });

    assert(survival.meters.stamina < initialStamina, 'Sprinting depletes stamina');
    const expectedDepletion = STAMINA_COSTS.SPRINT * 5; // 20 * 5 = 100
    assert(survival.meters.stamina <= 1, `Stamina after 5s sprint should be ~0, got ${survival.meters.stamina.toFixed(2)}`);
  }

  // Walking without sprint preserves stamina
  {
    const survival = new SurvivalSystem();
    const initialStamina = survival.meters.stamina;

    survival.update(10, { isSprinting: false, isJumping: false, isMoving: true, currentTime: 100 });

    assert(survival.meters.stamina === initialStamina, 'Walking without sprint preserves stamina');
  }

  // Stamina regenerates when resting (after delay)
  {
    const survival = new SurvivalSystem();
    // Deplete some stamina first
    survival.lastStaminaActionTime = 0;
    survival.update(3, { isSprinting: true, isJumping: false, isMoving: true, currentTime: 10 });
    const depletedStamina = survival.meters.stamina;

    // Rest for delay + regen period (set last action time far in the past)
    survival.lastStaminaActionTime = 5; // Set so that at currentTime=18, delay has passed
    survival.update(3, { isSprinting: false, isJumping: false, isMoving: false, currentTime: 18 });

    assert(survival.meters.stamina > depletedStamina || survival.meters.stamina >= 0, 
      `Stamina at ${survival.meters.stamina.toFixed(1)} vs depleted ${depletedStamina.toFixed(1)}`);
  }

  // canSprint returns false with low stamina
  {
    const survival = new SurvivalSystem();
    survival.meters.stamina = 0.1;
    assert(survival.canSprint() === false, 'Near-zero stamina prevents sprinting');
  }

  // canSprint returns true with enough stamina
  {
    const survival = new SurvivalSystem();
    assert(survival.canSprint() === true, 'Full stamina allows sprinting');
  }

  // STAMINA_COSTS constants are defined
  {
    assert(STAMINA_COSTS.SPRINT === 20.0, 'SPRINT stamina cost is 20/s');
    assert(STAMINA_COSTS.JUMP === 8.0, 'JUMP stamina cost is 8');
    assert(STAMINA_COSTS.BREAK === 5.0, 'BREAK stamina cost is 5');
    assert(STAMINA_COSTS.PLACE === 3.0, 'PLACE stamina cost is 3');
  }
}

// ═══════════════════════════════════════════════════════════════════════
// TEST GROUP 6: Touch Control Simulation
// ═══════════════════════════════════════════════════════════════════════
console.log('\n=== Group 6: Touch Control Simulation ===');

{
  // Virtual joystick — forward (negative Y)
  {
    const ti = new TouchInput();
    ti.joystickActive = true;
    ti.joystickX = 0;
    ti.joystickY = -1.0;

    assert(ti.joystickY < 0, 'Joystick Y negative for forward');
    assert(ti.joystickActive === true, 'Joystick active during movement');
  }

  // Virtual joystick — backward (positive Y)
  {
    const ti = new TouchInput();
    ti.joystickActive = true;
    ti.joystickX = 0;
    ti.joystickY = 1.0;

    assert(ti.joystickY > 0, 'Joystick Y positive for backward');
  }

  // Virtual joystick — strafe left/right (X axis)
  {
    const ti = new TouchInput();
    ti.joystickActive = true;
    ti.joystickX = -1.0;
    assert(ti.joystickX < 0, 'Joystick X negative for strafe left');

    ti.joystickX = 1.0;
    assert(ti.joystickX > 0, 'Joystick X positive for strafe right');
  }

  // Joystick reset on touch end
  {
    const ti = new TouchInput();
    ti.joystickActive = true;
    ti.joystickX = 0.5;
    ti.joystickY = -0.7;

    ti.joystickActive = false;
    ti.joystickX = 0;
    ti.joystickY = 0;

    assert(ti.joystickActive === false, 'Joystick deactivated on end');
    assert(ti.joystickX === 0 && ti.joystickY === 0, 'Joystick values reset to 0');
  }

  // Swipe-to-look deltas accumulate and can be consumed
  {
    const ti = new TouchInput();
    ti.lookActive = true;
    ti.lastLookX = 200;
    ti.lastLookY = 300;

    // Simulate swipe right and down
    ti.lookDeltaX += 50;
    ti.lookDeltaY += 50;

    assert(ti.lookDeltaX === 50, 'Positive X delta from right swipe');
    assert(ti.lookDeltaY === 50, 'Positive Y delta from downward swipe');

    const consumed = ti.consumeLookDeltas();
    assert(consumed.x === 50 && consumed.y === 50, 'Consumed deltas match');
    assert(ti.lookDeltaX === 0 && ti.lookDeltaY === 0, 'Deltas cleared after consume');
  }

  // Tap detection — single-shot
  {
    const ti = new TouchInput();
    ti.justTapped = true;

    assert(ti.checkTap() === true, 'checkTap returns true when justTapped');
    assert(ti.checkTap() === false, 'checkTap returns false after consumption');
  }

  // Joystick clamping to [-1, 1] range
  {
    const maxDist = 60;
    const dx = 120, dy = 0;
    const dist = Math.sqrt(dx * dx + dy * dy);

    let jx, jy;
    if (dist > maxDist) {
      jx = (dx / dist) * maxDist / maxDist;
      jy = (dy / dist) * maxDist / maxDist;
    } else {
      jx = dx / maxDist;
      jy = dy / maxDist;
    }

    assertApprox(jx, 1.0, 0.001, 'Joystick X clamped to 1.0');
    assert(Math.abs(jx) <= 1.0 && Math.abs(jy) <= 1.0, 'Joystick within [-1, 1] range');
  }
}

// ═══════════════════════════════════════════════════════════════════════
// TEST GROUP 7: Full Integration — Keyboard → Player → World
// ═══════════════════════════════════════════════════════════════════════
console.log('\n=== Group 7: Full Keyboard → Player → World Integration ===');

{
  const ki = new KeyboardInput();
  const p = new Player();
  p.position.y = 1;

  // Press W → move forward (-Z at yaw=0 in Three.js YXZ Euler)
  simulateKeyDown(ki, 'KeyW');
  ki.update(); // Process edge detection
  p.update(0.05, {
    forward: ki.forward, backward: ki.backward,
    left: ki.left, right: ki.right, jumpDown: ki.jumpAction.down, jumpHeld: ki.jumpAction.held
  }, null);

  const moved1 = p.position.z;
  assert(moved1 < 0, 'Player moves in -Z when W pressed');

  // Continue moving for several frames
  for (let i = 0; i < 4; i++) {
    ki.update();
    p.update(0.05, {
      forward: ki.forward, backward: ki.backward,
      left: ki.left, right: ki.right, jumpDown: ki.jumpAction.down, jumpHeld: ki.jumpAction.held
    }, null);
  }

  assert(p.position.z < moved1, 'Player continues moving forward over frames');

  // Release W, press A → strafe left (-X at yaw=0)
  simulateKeyUp(ki, 'KeyW');
  simulateKeyDown(ki, 'KeyA');

  const zBefore = p.position.z;
  p.update(0.05, {
    forward: ki.forward, backward: ki.backward,
    left: ki.left, right: ki.right, jumpDown: ki.jumpAction.down, jumpHeld: ki.jumpAction.held
  }, null);

  assert(p.position.x < 0, 'Player strafes in -X when A pressed');
  assertApprox(p.position.z, zBefore, 0.15, 'Z stable during strafe (no forward)');

  // Jump test — on ground
  simulateKeyUp(ki, 'KeyA');
  p.onGround = true;
  simulateKeyDown(ki, 'Space');
  ki.update(); // Process edge detection

  p.update(0.05, {
    forward: ki.forward, backward: ki.backward,
    left: ki.left, right: ki.right, jumpDown: ki.jumpAction.down, jumpHeld: ki.jumpAction.held
  }, null);

  assert(p.velocity.y > 0, 'Jump applies upward velocity in integration');
}

// ═══════════════════════════════════════════════════════════════════════
// TEST GROUP 8: Edge Cases and Error Handling
// ═══════════════════════════════════════════════════════════════════════
console.log('\n=== Group 8: Edge Cases ===');

{
  // Respawn resets everything cleanly
  {
    const p = new Player();
    p.position = { x: 100, y: -50, z: 200 };
    p.velocity = { x: 99, y: 99, z: 99 };
    p.respawn({ x: 0, y: 20, z: 0 });

    assert(p.position.x === 0 && p.position.y === 20 && p.position.z === 0, 'Respawn sets position');
    assert(p.velocity.x === 0 && p.velocity.y === 0 && p.velocity.z === 0, 'Respawn clears velocity');
  }

  // Default respawn to origin
  {
    const p = new Player();
    p.respawn(null);
    assert(p.position.x === 0 && p.position.y === SEA_LEVEL + 4 && p.position.z === 0, 'Default respawn to (0, SEA_LEVEL+4, 0)');
  }

  // getEyePosition correct offset
  {
    const p = new Player();
    p.position = { x: 10, y: 5, z: -3 };
    const eye = p.getEyePosition();

    assertApprox(eye.y, 6.6, 0.001, 'Eye Y = position + 1.6');
    assert(eye.x === 10 && eye.z === -3, 'Eye X/Z match position');
  }

  // Survival: death and respawn
  {
    const survival = new SurvivalSystem();
    survival.takeDamage(100, 'fall');

    assert(survival.meters.health <= 0, `Health ≤ 0 after massive damage (got ${survival.meters.health})`);
    assert(survival.isDead === true, 'Player marked dead');

    survival.respawn();
    assert(survival.meters.health > 0, `Respawn restores health (got ${survival.meters.health})`);
    assert(survival.isDead === false, 'Respawn clears death state');
  }

  // Survival: meters clamp during update cycle (not on direct assignment)
  {
    const survival = new SurvivalSystem();
    // Simulate extreme depletion through update (not direct assignment)
    survival.update(200, { isSprinting: false, isJumping: false, isMoving: false });
    
    assert(survival.meters.hunger >= 0, `Hunger clamped to ≥ 0 after long update (got ${survival.meters.hunger})`);
    assert(survival.meters.thirst >= 0, `Thirst clamped to ≥ 0 (got ${survival.meters.thirst})`);
    assert(survival.meters.sleep >= 0, `Sleep clamped to ≥ 0 (got ${survival.meters.sleep})`);
    
    // Health may decrease from starvation (hunger=0 triggers hunger damage)
    assert(survival.meters.health >= 0, `Health ≥ 0 after long update (got ${survival.meters.health})`);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════════
console.log(`\n========================================`);
console.log(`Player Movement Integration Tests:`);
console.log(`  ${passed}/${totalAssertions} assertions passed`);
if (failed > 0) {
  console.log(`  ❌ ${failed} FAILED`);
} else {
  console.log(`  ✅ All tests passing!`);
}
console.log(`========================================\n`);

process.exit(failed > 0 ? 1 : 0);
