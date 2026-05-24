/**
 * Cuubz — Touch Controls Unit Tests
 * Tests TouchInput, KeyboardInput, MouseInput in Node.js context.
 * All input classes skip browser event binding when window is undefined.
 */

const TouchInput = require('../js/input/touch');
const KeyboardInput = require('../js/input/keyboard');
const MouseInput = require('../js/input/mouse');

let pass = 0;
let fail = 0;
let total = 0;

function assert(condition, message) {
  total++;
  if (condition) {
    pass++;
  } else {
    fail++;
    console.error(`  ❌ FAIL: ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  assert(actual === expected, `${message} — expected ${expected}, got ${actual}`);
}

function assertApprox(actual, expected, tolerance, message) {
  assert(Math.abs(actual - expected) < tolerance, `${message} — expected ~${expected}, got ${actual}`);
}

// ============================
// TouchInput Tests
// ============================
console.log('\n=== TouchInput: Constructor & Initial State ===');

{
  const touch = new TouchInput();
  
  assertEqual(touch.joystickActive, false, 'joystickActive starts false');
  assertEqual(touch.joystickX, 0, 'joystickX starts at 0');
  assertEqual(touch.joystickY, 0, 'joystickY starts at 0');
  assertEqual(touch.lookActive, false, 'lookActive starts false');
  assertEqual(touch.lookDeltaX, 0, 'lookDeltaX starts at 0');
  assertEqual(touch.lookDeltaY, 0, 'lookDeltaY starts at 0');
  assertEqual(touch.justTapped, false, 'justTapped starts false');
  
  // No browser event binding in Node.js context
  assert(typeof touch._bindEvents === 'function', '_bindEvents method exists');
}

console.log('\n=== TouchInput: Joystick Logic ===');

{
  const touch = new TouchInput();
  
  // Simulate joystick start
  const mockEvent = { 
    touches: [{ clientX: 100, clientY: 200 }],
    preventDefault: () => {}
  };
  touch._onJoystickStart(mockEvent);
  
  assertEqual(touch.joystickActive, true, 'joystick active after start');
  assertEqual(touch._joystickOriginX, 100, 'joystick origin X captured');
  assertEqual(touch._joystickOriginY, 200, 'joystick origin Y captured');
  
  // Simulate joystick move — within radius (30px offset)
  const moveEvent = { 
    touches: [{ clientX: 130, clientY: 200 }],
    preventDefault: () => {}
  };
  touch._onJoystickMove(moveEvent);
  
  assertApprox(touch.joystickX, 0.5, 0.01, 'joystickX = 30/60 = 0.5');
  assertEqual(touch.joystickY, 0, 'joystickY stays 0 (no vertical movement)');
  
  // Simulate joystick move — at max radius (60px offset)
  const maxEvent = { 
    touches: [{ clientX: 160, clientY: 200 }],
    preventDefault: () => {}
  };
  touch._onJoystickMove(maxEvent);
  
  assertApprox(touch.joystickX, 1.0, 0.01, 'joystickX = 1.0 at max radius');
  
  // Simulate joystick move — beyond max radius (90px offset)
  const overEvent = { 
    touches: [{ clientX: 190, clientY: 200 }],
    preventDefault: () => {}
  };
  touch._onJoystickMove(overEvent);
  
  assertApprox(touch.joystickX, 1.0, 0.01, 'joystickX clamped to 1.0 beyond max radius');
  
  // Diagonal movement — 45 degrees within radius (~42px diagonal)
  const diagEvent = { 
    touches: [{ clientX: 142, clientY: 242 }],
    preventDefault: () => {}
  };
  touch._onJoystickMove(diagEvent);
  
  assertApprox(touch.joystickX, 0.7, 0.05, 'joystickX diagonal ~0.7');
  assertApprox(touch.joystickY, 0.7, 0.05, 'joystickY diagonal ~0.7');
  
  // Joystick end — resets state
  touch._onJoystickEnd(mockEvent);
  
  assertEqual(touch.joystickActive, false, 'joystick inactive after end');
  assertEqual(touch.joystickX, 0, 'joystickX reset to 0');
  assertEqual(touch.joystickY, 0, 'joystickY reset to 0');
}

console.log('\n=== TouchInput: Joystick Edge Cases ===');

{
  const touch = new TouchInput();
  
  // Move without starting should be no-op
  const moveEvent = { 
    touches: [{ clientX: 150, clientY: 250 }],
    preventDefault: () => {}
  };
  touch._onJoystickMove(moveEvent);
  
  assertEqual(touch.joystickX, 0, 'joystickX stays 0 without start');
  assertEqual(touch.joystickY, 0, 'joystickY stays 0 without start');
  
  // Negative direction (left and up) — diagonal at ~85px exceeds maxDist=60, so normalized to unit vector
  const mockStart = { 
    touches: [{ clientX: 200, clientY: 300 }],
    preventDefault: () => {}
  };
  touch._onJoystickStart(mockStart);
  
  const negEvent = { 
    touches: [{ clientX: 140, clientY: 240 }], // dx=-60, dy=-60 -> dist~84.9 > 60, normalized
    preventDefault: () => {}
  };
  touch._onJoystickMove(negEvent);
  
  // Diagonal beyond maxDist: normalized to unit vector (-1/sqrt(2), -1/sqrt(2)) ~ (-0.707, -0.707)
  assertApprox(touch.joystickX, -0.707, 0.01, 'joystickX normalized diagonal ~ -0.707');
  assertApprox(touch.joystickY, -0.707, 0.01, 'joystickY normalized diagonal ~ -0.707');
  
  // Pure vertical movement (within maxDist)
  const vertEvent = { 
    touches: [{ clientX: 200, clientY: 250 }], // dx=0, dy=-50
    preventDefault: () => {}
  };
  touch._onJoystickMove(vertEvent);
  
  assertEqual(touch.joystickX, 0, 'joystickX stays 0 for pure vertical');
  assertApprox(touch.joystickY, -0.833, 0.01, 'joystickY = -50/60 ~ -0.833');
}

console.log('\n=== TouchInput: Swipe-to-Look Logic ===');

{
  const touch = new TouchInput();
  
  // Start look
  const startEvent = { 
    touches: [{ clientX: 400, clientY: 300 }],
    preventDefault: () => {}
  };
  touch._onLookStart(startEvent);
  
  assertEqual(touch.lookActive, true, 'look active after start');
  assertEqual(touch.lastLookX, 400, 'lastLookX captured');
  assertEqual(touch.lastLookY, 300, 'lastLookY captured');
  
  // Swipe right (50px)
  const swipeRight = { 
    touches: [{ clientX: 450, clientY: 300 }],
    preventDefault: () => {}
  };
  touch._onLookMove(swipeRight);
  
  assertEqual(touch.lookDeltaX, 50, 'lookDeltaX = 50 (swiped right)');
  assertEqual(touch.lookDeltaY, 0, 'lookDeltaY stays 0');
  
  // Swipe down (30px)
  const swipeDown = { 
    touches: [{ clientX: 450, clientY: 330 }],
    preventDefault: () => {}
  };
  touch._onLookMove(swipeDown);
  
  assertEqual(touch.lookDeltaX, 50, 'lookDeltaX accumulates');
  assertEqual(touch.lookDeltaY, 30, 'lookDeltaY = 30 (swiped down)');
  
  // Consume look deltas
  const deltas = touch.consumeLookDeltas();
  
  assertEqual(deltas.x, 50, 'consumed deltaX = 50');
  assertEqual(deltas.y, 30, 'consumed deltaY = 30');
  assertEqual(touch.lookDeltaX, 0, 'lookDeltaX cleared after consume');
  assertEqual(touch.lookDeltaY, 0, 'lookDeltaY cleared after consume');
  
  // End look — sets tap flag (short press)
  touch._onLookEnd(startEvent);
  
  assertEqual(touch.lookActive, false, 'look inactive after end');
  assertEqual(touch.justTapped, true, 'justTapped set on quick end');
}

console.log('\n=== TouchInput: Tap Detection ===');

{
  const touch = new TouchInput();
  
  // Start look
  const startEvent = { 
    touches: [{ clientX: 400, clientY: 300 }],
    preventDefault: () => {}
  };
  touch._onLookStart(startEvent);
  
  // Immediate end (tap)
  touch._onLookEnd(startEvent);
  
  assertEqual(touch.justTapped, true, 'justTapped after quick release');
  
  // Check tap — returns true and clears flag
  const tapped = touch.checkTap();
  
  assertEqual(tapped, true, 'checkTap returns true');
  assertEqual(touch.justTapped, false, 'checkTap clears justTapped');
  
  // Second checkTap should return false (already consumed)
  const tapped2 = touch.checkTap();
  
  assertEqual(tapped2, false, 'second checkTap returns false');
}

console.log('\n=== TouchInput: Tap vs Long Press ===');

{
  const touch = new TouchInput();
  
  // Start look and simulate long press (tapTimeout fires after 200ms)
  const startEvent = { 
    touches: [{ clientX: 400, clientY: 300 }],
    preventDefault: () => {}
  };
  touch._onLookStart(startEvent);
  
  // Simulate the tapTimeout callback (long press detection)
  if (touch.tapTimeout) {
    clearTimeout(touch.tapTimeout);
  }
  // Manually trigger long-press behavior
  touch.justTapped = false;
  
  // Now end — but it was a long press, so justTapped should be overridden
  touch._onLookEnd(startEvent);
  
  // _onLookEnd sets justTapped = true regardless of timeout
  // This is the current implementation behavior (tap on any release)
  assertEqual(touch.justTapped, true, 'justTapped set on end even after long press');
}

console.log('\n=== TouchInput: consumeLookDeltas returns object ===');

{
  const touch = new TouchInput();
  
  // Manually set deltas to test return structure
  touch.lookDeltaX = 10;
  touch.lookDeltaY = -5;
  
  const result = touch.consumeLookDeltas();
  
  assert(typeof result === 'object', 'consumeLookDeltas returns object');
  assertEqual(result.x, 10, 'result.x = 10');
  assertEqual(result.y, -5, 'result.y = -5');
  assert('x' in result, 'result has x property');
  assert('y' in result, 'result has y property');
}

console.log('\n=== TouchInput: update() method ===');

{
  const touch = new TouchInput();
  
  // update() should not clear look deltas (they accumulate)
  touch.lookDeltaX = 25;
  touch.lookDeltaY = -10;
  
  touch.update();
  
  assertEqual(touch.lookDeltaX, 25, 'update does not clear lookDeltaX');
  assertEqual(touch.lookDeltaY, -10, 'update does not clear lookDeltaY');
}

// ============================
// KeyboardInput Tests
// ============================
console.log('\n=== KeyboardInput: Constructor & Initial State ===');

{
  const kb = new KeyboardInput();
  
  assertEqual(kb.forward, false, 'forward starts false');
  assertEqual(kb.backward, false, 'backward starts false');
  assertEqual(kb.left, false, 'left starts false');
  assertEqual(kb.right, false, 'right starts false');
  assertEqual(kb.jump, false, 'jump starts false');
  assertEqual(kb.sprint, false, 'sprint starts false');
  assertEqual(kb.interact, false, 'interact starts false');
  assert(Object.keys(kb.keys).length === 0, 'keys map starts empty');
  assert(Object.keys(kb.justPressed).length === 0, 'justPressed starts empty');
}

console.log('\n=== KeyboardInput: Key Down Mapping ===');

{
  const kb = new KeyboardInput();
  
  // W key
  kb._onKeyDown({ code: 'KeyW' });
  assertEqual(kb.forward, true, 'W sets forward=true');
  assertEqual(kb.keys['KeyW'], true, 'keys[KeyW] = true');
  assertEqual(kb.justPressed['KeyW'], true, 'justPressed[KeyW] = true');
  
  // A key
  kb._onKeyDown({ code: 'KeyA' });
  assertEqual(kb.left, true, 'A sets left=true');
  
  // S key
  kb._onKeyDown({ code: 'KeyS' });
  assertEqual(kb.backward, true, 'S sets backward=true');
  
  // D key
  kb._onKeyDown({ code: 'KeyD' });
  assertEqual(kb.right, true, 'D sets right=true');
  
  // Space — needs preventDefault mock
  kb._onKeyDown({ code: 'Space', preventDefault: () => {} });
  assertEqual(kb.jump, true, 'Space sets jump=true');
  
  // Shift
  kb._onKeyDown({ code: 'ShiftLeft' });
  assertEqual(kb.sprint, true, 'ShiftLeft sets sprint=true');
  
  kb._onKeyDown({ code: 'ShiftRight' });
  assertEqual(kb.sprint, true, 'ShiftRight also sets sprint=true');
  
  // E key
  kb._onKeyDown({ code: 'KeyE' });
  assertEqual(kb.interact, true, 'E sets interact=true');
}

console.log('\n=== KeyboardInput: Key Up Mapping ===');

{
  const kb = new KeyboardInput();
  
  kb._onKeyDown({ code: 'KeyW' });
  assertEqual(kb.forward, true, 'W pressed -> forward=true');
  
  kb._onKeyUp({ code: 'KeyW' });
  assertEqual(kb.forward, false, 'W released -> forward=false');
  assertEqual(kb.keys['KeyW'], false, 'keys[KeyW] = false on release');
}

console.log('\n=== KeyboardInput: Multiple Keys Held ===');

{
  const kb = new KeyboardInput();
  
  kb._onKeyDown({ code: 'KeyW' });
  kb._onKeyDown({ code: 'KeyD' });
  kb._onKeyDown({ code: 'Space', preventDefault: () => {} });
  
  assertEqual(kb.forward, true, 'forward still true');
  assertEqual(kb.right, true, 'right still true');
  assertEqual(kb.jump, true, 'jump still true');
  
  // Release one key
  kb._onKeyUp({ code: 'KeyD' });
  
  assertEqual(kb.forward, true, 'forward unaffected by D release');
  assertEqual(kb.right, false, 'right=false after D release');
  assertEqual(kb.jump, true, 'jump unaffected');
}

console.log('\n=== KeyboardInput: update() clears justPressed ===');

{
  const kb = new KeyboardInput();
  
  kb._onKeyDown({ code: 'KeyW' });
  assertEqual(kb.justPressed['KeyW'], true, 'justPressed set on keydown');
  
  kb.update();
  assert(Object.keys(kb.justPressed).length === 0, 'justPressed cleared after update');
}

console.log('\n=== KeyboardInput: isJustPressed() ===');

{
  const kb = new KeyboardInput();
  
  kb._onKeyDown({ code: 'KeyE' });
  
  assertEqual(kb.isJustPressed('KeyE'), true, 'isJustPressed(KeyE) = true');
  assertEqual(kb.isJustPressed('KeyW'), false, 'isJustPressed(KeyW) = false (not pressed)');
  
  kb.update();
  
  assertEqual(kb.isJustPressed('KeyE'), false, 'isJustPressed cleared after update');
}

console.log('\n=== KeyboardInput: Unknown Keys ===');

{
  const kb = new KeyboardInput();
  
  kb._onKeyDown({ code: 'KeyQ' });
  
  assertEqual(kb.keys['KeyQ'], true, 'unknown key tracked in keys map');
  assertEqual(kb.forward, false, 'forward unaffected by unknown key');
  assertEqual(kb.backward, false, 'backward unaffected by unknown key');
  
  kb._onKeyUp({ code: 'KeyQ' });
  assertEqual(kb.keys['KeyQ'], false, 'unknown key cleared on release');
}

// ============================
// MouseInput Tests
// ============================
console.log('\n=== MouseInput: Constructor & Initial State ===');

{
  const mockCanvas = {}; // No requestPointerLock in Node.js
  const mouse = new MouseInput(mockCanvas);
  
  assertEqual(mouse.leftClick, false, 'leftClick starts false');
  assertEqual(mouse.rightClick, false, 'rightClick starts false');
  assertEqual(mouse.scrollDelta, 0, 'scrollDelta starts at 0');
  assertEqual(mouse.justClickedLeft, false, 'justClickedLeft starts false');
  assertEqual(mouse.justClickedRight, false, 'justClickedRight starts false');
  assertEqual(mouse.locked, false, 'locked starts false');
}

console.log('\n=== MouseInput: Left Click ===');

{
  const mockCanvas = {};
  const mouse = new MouseInput(mockCanvas);
  
  // Left click down (button 0)
  mouse._onMouseDown({ button: 0 });
  assertEqual(mouse.leftClick, true, 'leftClick=true on mousedown button 0');
  assertEqual(mouse.justClickedLeft, true, 'justClickedLeft=true on mousedown');
  
  // Left click up
  mouse._onMouseUp({ button: 0 });
  assertEqual(mouse.leftClick, false, 'leftClick=false on mouseup button 0');
}

console.log('\n=== MouseInput: Right Click ===');

{
  const mockCanvas = {};
  const mouse = new MouseInput(mockCanvas);
  
  // Right click down (button 2)
  mouse._onMouseDown({ button: 2 });
  assertEqual(mouse.rightClick, true, 'rightClick=true on mousedown button 2');
  assertEqual(mouse.justClickedRight, true, 'justClickedRight=true on mousedown');
  
  // Right click up
  mouse._onMouseUp({ button: 2 });
  assertEqual(mouse.rightClick, false, 'rightClick=false on mouseup button 2');
}

console.log('\n=== MouseInput: Scroll Wheel ===');

{
  const mockCanvas = {};
  const mouse = new MouseInput(mockCanvas);
  
  // Scroll down (positive deltaY)
  mouse._onWheel({ deltaY: 100 });
  assertEqual(mouse.scrollDelta, 1, 'scrollDelta=1 for positive deltaY');
  
  // Scroll up (negative deltaY)
  mouse._onWheel({ deltaY: -50 });
  assertEqual(mouse.scrollDelta, 0, 'scrollDelta=0 after scrolling back up');
  
  // Multiple scrolls
  mouse._onWheel({ deltaY: 100 });
  mouse._onWheel({ deltaY: 200 });
  assertEqual(mouse.scrollDelta, 2, 'scrollDelta accumulates = 2');
}

console.log('\n=== MouseInput: update() clears just-clicked flags ===');

{
  const mockCanvas = {};
  const mouse = new MouseInput(mockCanvas);
  
  mouse._onMouseDown({ button: 0 });
  assertEqual(mouse.justClickedLeft, true, 'justClickedLeft set on click');
  
  mouse.update();
  assertEqual(mouse.justClickedLeft, false, 'justClickedLeft cleared after update');
}

console.log('\n=== MouseInput: requestPointerLock / exitPointerLock ===');

{
  const mockCanvas = {};
  const mouse = new MouseInput(mockCanvas);
  
  // Should not throw when requestPointerLock is not a function
  try {
    mouse.requestPointerLock();
    assert(true, 'requestPointerLock does not throw without browser API');
  } catch (e) {
    assert(false, `requestPointerLock threw: ${e.message}`);
  }
  
  // exitPointerLock should not throw
  try {
    mouse.exitPointerLock();
    assert(true, 'exitPointerLock does not throw in Node.js context');
  } catch (e) {
    assert(false, `exitPointerLock threw: ${e.message}`);
  }
}

console.log('\n=== MouseInput: Unknown button ===');

{
  const mockCanvas = {};
  const mouse = new MouseInput(mockCanvas);
  
  // Middle click (button 1) — should not set any flags
  mouse._onMouseDown({ button: 1 });
  assertEqual(mouse.leftClick, false, 'leftClick unaffected by middle click');
  assertEqual(mouse.rightClick, false, 'rightClick unaffected by middle click');
  
  // Button 4+ (back/forward buttons)
  mouse._onMouseDown({ button: 4 });
  assertEqual(mouse.leftClick, false, 'leftClick unaffected by button 4');
}

// ============================
// Integration: Touch + Keyboard Equivalence
// ============================
console.log('\n=== Integration: Touch <-> Keyboard Movement Equivalence ===');

{
  const touch = new TouchInput();
  const kb = new KeyboardInput();
  
  // Forward movement equivalence
  // Keyboard: W key
  kb._onKeyDown({ code: 'KeyW' });
  assertEqual(kb.forward, true, 'Keyboard forward=true');
  
  // Touch: joystick pushed up (negative Y)
  const startEvent = { 
    touches: [{ clientX: 100, clientY: 200 }],
    preventDefault: () => {}
  };
  touch._onJoystickStart(startEvent);
  
  const moveUp = { 
    touches: [{ clientX: 100, clientY: 140 }], // dy = -60 (full up)
    preventDefault: () => {}
  };
  touch._onJoystickMove(moveUp);
  
  assertApprox(touch.joystickY, -1.0, 0.01, 'Touch joystick Y ~ -1.0 (forward)');
  
  // Both represent forward movement — joystickY maps to forward direction
  const kbForward = kb.forward ? 1 : 0;
  const touchForward = Math.round(Math.abs(touch.joystickY));
  assertEqual(kbForward, touchForward, 'Both input methods map to forward=1');
}

console.log('\n=== Integration: Touch Tap <-> Mouse Click Equivalence ===');

{
  const touch = new TouchInput();
  const mockCanvas = {};
  const mouse = new MouseInput(mockCanvas);
  
  // Mouse left click
  mouse._onMouseDown({ button: 0 });
  assertEqual(mouse.justClickedLeft, true, 'Mouse justClickedLeft=true');
  
  // Touch tap (look zone quick release)
  const startEvent = { 
    touches: [{ clientX: 400, clientY: 300 }],
    preventDefault: () => {}
  };
  touch._onLookStart(startEvent);
  touch._onLookEnd(startEvent);
  
  assertEqual(touch.justTapped, true, 'Touch justTapped=true');
  
  // Both represent a click action
  const mouseClick = mouse.justClickedLeft ? 1 : 0;
  const touchTap = touch.justTapped ? 1 : 0;
  assertEqual(mouseClick, touchTap, 'Both input methods produce a click signal');
}

// ============================
// Summary
// ============================
console.log(`\n===================================`);
console.log(`  Results: ${pass}/${total} passed, ${fail} failed`);
console.log(`===================================`);

process.exit(fail > 0 ? 1 : 0);
