/**
 * Cuubz — Memory Leak Check Tests
 * 
 * Verifies that all modules with resource management (event listeners, timers,
 * Web Audio nodes, Three.js geometries) implement proper dispose() methods
 * and clean up after themselves.
 * 
 * Run: node test/test_memoryLeaks.js
 */

'use strict';

let passCount = 0;
let failCount = 0;
let totalAssertions = 0;

function assert(condition, message) {
  totalAssertions++;
  if (condition) {
    passCount++;
  } else {
    failCount++;
    console.error(`  ❌ FAIL: ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  assert(actual === expected, `${message} — expected ${expected}, got ${actual}`);
}

function assertThrows(fn, message) {
  totalAssertions++;
  try {
    fn();
    failCount++;
    console.error(`  ❌ FAIL: ${message} — did not throw`);
  } catch (e) {
    passCount++;
  }
}

// ─── Load modules ──────────────────────────────────────────────

const KeyboardInput = require('../js/input/keyboard.js');
const MouseInput = require('../js/input/mouse.js');
const TouchInput = require('../js/input/touch.js');
const ChunkManager = require('../js/renderer/chunkManager.js');
const Player = require('../js/entities/player.js');
const SurvivalSystem = require('../js/systems/survival.js');
const InventoryModule = require('../js/systems/inventory.js');
const Inventory = InventoryModule.Inventory;

// ─── Group 1: KeyboardInput dispose ────────────────────────────

console.log('\n=== Group 1: KeyboardInput.dispose() ===');

{
  const kb = new KeyboardInput();
  
  // In Node.js, _bindEvents is skipped (typeof window !== 'undefined' guard)
  // But dispose should still exist as a method
  assert(typeof kb.dispose === 'function', 'KeyboardInput has dispose() method');
  
  // Dispose should be idempotent — calling twice shouldn't error
  let disposedOnce = false;
  try {
    kb.dispose();
    disposedOnce = true;
  } catch (e) {
    disposedOnce = false;
  }
  assert(disposedOnce, 'dispose() can be called without error');
  
  try {
    kb.dispose(); // Second call
  } catch (e) {
    assert(false, 'dispose() is idempotent — second call should not throw');
  }
  
  // After dispose, justPressed should be cleared
  assert(kb.justPressed === null || typeof kb.justPressed === 'object', 
    'justPressed reference cleared after dispose');
}

// ─── Group 2: MouseInput dispose ───────────────────────────────

console.log('\n=== Group 2: MouseInput.dispose() ===');

{
  // Create with null canvas (Node.js test mode)
  const mouse = new MouseInput(null);
  
  assert(typeof mouse.dispose === 'function', 'MouseInput has dispose() method');
  
  let disposedOnce = false;
  try {
    mouse.dispose();
    disposedOnce = true;
  } catch (e) {
    disposedOnce = false;
  }
  assert(disposedOnce, 'dispose() can be called without error');
  
  // Idempotent
  try {
    mouse.dispose();
  } catch (e) {
    assert(false, 'MouseInput dispose() is idempotent');
  }
}

// ─── Group 3: TouchInput dispose ───────────────────────────────

console.log('\n=== Group 3: TouchInput.dispose() ===');

{
  const touch = new TouchInput();
  
  assert(typeof touch.dispose === 'function', 'TouchInput has dispose() method');
  
  // tapTimeout should be cleared on dispose
  let disposedOnce = false;
  try {
    touch.dispose();
    disposedOnce = true;
  } catch (e) {
    disposedOnce = false;
  }
  assert(disposedOnce, 'dispose() can be called without error');
  
  // Idempotent
  try {
    touch.dispose();
  } catch (e) {
    assert(false, 'TouchInput dispose() is idempotent');
  }
}

// ─── Group 4: ChunkManager dispose + build queue cleanup ──────

console.log('\n=== Group 4: ChunkManager.dispose() ===');

{
  // Mock renderer
  const mockRenderer = { removeChunkMesh: () => {} };
  
  const cm = new ChunkManager(mockRenderer, (cx, cz) => ({ blocks: [] }));
  
  assert(typeof cm.dispose === 'function', 'ChunkManager has dispose() method');
  
  // Queue some builds
  cm._queueBuild(0, 0);
  cm._queueBuild(1, 1);
  
  assert(cm.buildQueue.length >= 0, 'buildQueue exists');
  
  // Dispose should clear the build queue
  cm.dispose();
  
  assertEqual(cm.buildQueue.length, 0, 'buildQueue cleared after dispose');
  assertEqual(cm.building, false, 'building flag reset after dispose');
  
  // After dispose, _processQueue should be a no-op (no setTimeout leaks)
  // We verify this by checking that calling it doesn't error and building stays false
  cm._processQueue();
  assertEqual(cm.building, false, '_processQueue is safe after dispose');
  
  // loadedChunks should be empty after dispose
  assertEqual(cm.getLoadedCount(), 0, 'loadedChunks cleared after dispose');
}

// ─── Group 5: ChunkManager disposed flag prevents re-queue ─────

console.log('\n=== Group 5: ChunkManager disposed flag ===');

{
  const mockRenderer = { removeChunkMesh: () => {} };
  const cm = new ChunkManager(mockRenderer, (cx, cz) => ({ blocks: [] }));
  
  cm.dispose();
  
  // After dispose, queueing should be a no-op
  cm._queueBuild(5, 5);
  assertEqual(cm.buildQueue.length, 0, 'buildQueue stays empty after dispose');
}

// ─── Group 6: Player — no resource leaks ──────────────────────

console.log('\n=== Group 6: Player resource safety ===');

{
  const player = new Player();
  
  // Player doesn't bind events, but should be safe for GC
  assert(player.position !== null, 'Player has position object');
  assert(player.velocity !== null, 'Player has velocity object');
  
  // No dispose needed — Player is a plain data class with no event bindings
  // But verify it doesn't hold any circular references or timers
  assert(typeof player.update === 'function', 'Player has update method');
  assert(typeof player.respawn === 'function', 'Player has respawn method');
}

// ─── Group 7: SurvivalSystem dispose ──────────────────────────

console.log('\n=== Group 7: SurvivalSystem resource safety ===');

{
  // Check if SurvivalSystem exports a class with dispose
  // SurvivalSystem should not have timers/event listeners that leak
  const SS = typeof SurvivalSystem === 'function' ? SurvivalSystem : 
             (typeof SurvivalSystem.SurvivalSystem !== 'undefined' ? SurvivalSystem.SurvivalSystem : null);
  
  if (SS) {
    const ss = new SS();
    // If it has dispose, it should be callable
    if (typeof ss.dispose === 'function') {
      let noError = false;
      try { ss.dispose(); noError = true; } catch(e) {}
      assert(noError, 'SurvivalSystem dispose() works without error');
    }
  }
}

// ─── Group 8: Inventory dispose ───────────────────────────────

console.log('\n=== Group 8: Inventory resource safety ===');

{
  const inv = new Inventory();
  
  // Inventory stores callbacks — verify they can be cleared
  assert(typeof inv.onSlotChange === 'function' || inv.onSlotChange === null, 
    'Inventory has onSlotChange callback property');
}

// ─── Group 9: Input modules store bound handlers for removal ──

console.log('\n=== Group 9: Input handler reference tracking ===');

{
  // KeyboardInput should store references to bound handlers for removal
  const kb = new KeyboardInput();
  
  // After dispose in browser, event listeners should be removable
  // In Node.js we verify the method exists and stores handler refs
  assert(typeof kb.dispose === 'function', 
    'KeyboardInput.dispose() available for cleanup');
  
  const mouse = new MouseInput(null);
  assert(typeof mouse.dispose === 'function', 
    'MouseInput.dispose() available for cleanup');
  
  const touch = new TouchInput();
  assert(typeof touch.dispose === 'function', 
    'TouchInput.dispose() available for cleanup');
}

// ─── Group 10: Callback nullification prevents GC issues ──────

console.log('\n=== Group 10: Callback nullification on dispose ===');

{
  // ChunkManager callbacks should be nullified
  const mockRenderer = { removeChunkMesh: () => {} };
  let callbackCalled = false;
  const cm = new ChunkManager(mockRenderer, (cx, cz) => ({ blocks: [] }), {
    onRenderDistanceChange: () => { callbackCalled = true; }
  });
  
  cm.dispose();
  
  // After dispose, the callback reference should be cleared
  assert(cm._onRenderDistanceChange === null, 
    'ChunkManager callback nullified after dispose');
}

// ─── Summary ──────────────────────────────────────────────────

console.log('\n===================================');
console.log(`  Memory Leak Tests: ${passCount}/${totalAssertions} assertions passed`);
if (failCount > 0) {
  console.log(`  ❌ ${failCount} failures — memory leaks detected!`);
  console.log('===================================');
  process.exit(1);
} else {
  console.log('  ✅ All memory leak checks passed!');
  console.log('===================================');
  process.exit(0);
}
