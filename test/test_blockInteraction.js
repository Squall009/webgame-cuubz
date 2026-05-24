#!/usr/bin/env node
/**
 * Cuubz — Block Interaction Tests
 * Crosshair targeting + break/place mechanics.
 * 
 * Tests: Crosshair class, BlockInteraction class, integration scenarios.
 */

'use strict';

// ============================================================
// Mini Test Framework (same as test_framework.js)
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
// Load modules
// ============================================================

const Crosshair = require('../js/renderer/crosshair');
const BlockInteraction = require('../js/input/interaction');

// ============================================================
// Helper: Mock renderer with raycast capability
// ============================================================

function createMockRenderer() {
  return {
    scene: { add: () => {}, remove: () => {} },
    _raycastResults: [],
    raycast(maxDistance) {
      if (this._raycastResults.length === 0) return null;
      const hit = this._raycastResults.shift();
      return hit;
    }
  };
}

// ============================================================
// Helper: Mock player with inventory
// ============================================================

function createMockPlayer(position, inventory) {
  return {
    position: position || { x: 0, y: 20, z: 0 },
    inventory: inventory || { selectedSlot: 0 }
  };
}

// ============================================================
// Helper: Mock crosshair with controllable target
// ============================================================

function createMockCrosshair() {
  return {
    _targetBlock: null,
    getTargetBlock() { return this._targetBlock; },
    setTargetBlock(block) { this._targetBlock = block; },
    getPlacePosition() {
      if (!this._targetBlock) return null;
      const [nx, ny, nz] = this._targetBlock.faceNormal || [0, 0, 0];
      return {
        x: this._targetBlock.x + nx,
        y: this._targetBlock.y + ny,
        z: this._targetBlock.z + nz,
      };
    }
  };
}

// ============================================================
// Tests
// ============================================================

console.log('Block Interaction Tests');
console.log('=======================\n');

// ----------------------------------------------------------
// Group 1: Crosshair — Constructor & defaults
// ----------------------------------------------------------
console.log('\nGroup 1: Crosshair constructor & defaults');

{
  const renderer = createMockRenderer();
  const ch = new Crosshair(renderer);
  
  assertNotNull(ch, 'Crosshair instance created');
  assertEquals(ch.targetBlock, null, 'targetBlock starts null');
  assertEquals(ch.highlightMesh, null, 'highlightMesh starts null');
  assertEquals(ch.renderer, renderer, 'renderer reference set');
}

// ----------------------------------------------------------
// Group 2: Crosshair — getTargetBlock()
// ----------------------------------------------------------
console.log('\nGroup 2: Crosshair getTargetBlock()');

{
  const renderer = createMockRenderer();
  const ch = new Crosshair(renderer);
  
  // Initially null
  assertEquals(ch.getTargetBlock(), null, 'getTargetBlock returns null when no target');
  
  // Simulate setting target (as update() would)
  ch.targetBlock = { x: 5, y: 10, z: 3, faceNormal: [0, 1, 0] };
  
  const target = ch.getTargetBlock();
  assertNotNull(target, 'getTargetBlock returns object when set');
  assertEquals(target.x, 5, 'target x correct');
  assertEquals(target.y, 10, 'target y correct');
  assertEquals(target.z, 3, 'target z correct');
}

// ----------------------------------------------------------
// Group 3: Crosshair — getPlacePosition() from face normal
// ----------------------------------------------------------
console.log('\nGroup 3: Crosshair getPlacePosition()');

{
  const renderer = createMockRenderer();
  const ch = new Crosshair(renderer);
  
  // No target → null
  assertEquals(ch.getPlacePosition(), null, 'null when no target block');
  
  // Top face (faceNormal [0,1,0]) → place above
  ch.targetBlock = { x: 5, y: 10, z: 3, faceNormal: [0, 1, 0] };
  let pos = ch.getPlacePosition();
  assertEquals(pos.x, 5, 'place X same as target (top face)');
  assertEquals(pos.y, 11, 'place Y = target Y + 1 (top face)');
  assertEquals(pos.z, 3, 'place Z same as target (top face)');
  
  // Bottom face (faceNormal [0,-1,0]) → place below
  ch.targetBlock = { x: 5, y: 10, z: 3, faceNormal: [0, -1, 0] };
  pos = ch.getPlacePosition();
  assertEquals(pos.y, 9, 'place Y = target Y - 1 (bottom face)');
  
  // Right face (faceNormal [1,0,0]) → place right
  ch.targetBlock = { x: 5, y: 10, z: 3, faceNormal: [1, 0, 0] };
  pos = ch.getPlacePosition();
  assertEquals(pos.x, 6, 'place X = target X + 1 (right face)');
  
  // Left face (faceNormal [-1,0,0]) → place left
  ch.targetBlock = { x: 5, y: 10, z: 3, faceNormal: [-1, 0, 0] };
  pos = ch.getPlacePosition();
  assertEquals(pos.x, 4, 'place X = target X - 1 (left face)');
  
  // Front face (faceNormal [0,0,1]) → place front
  ch.targetBlock = { x: 5, y: 10, z: 3, faceNormal: [0, 0, 1] };
  pos = ch.getPlacePosition();
  assertEquals(pos.z, 4, 'place Z = target Z + 1 (front face)');
  
  // Back face (faceNormal [0,0,-1]) → place back
  ch.targetBlock = { x: 5, y: 10, z: 3, faceNormal: [0, 0, -1] };
  pos = ch.getPlacePosition();
  assertEquals(pos.z, 2, 'place Z = target Z - 1 (back face)');
}

// ----------------------------------------------------------
// Group 4: Crosshair — update() with raycast hit
// ----------------------------------------------------------
console.log('\nGroup 4: Crosshair update() with raycast');

{
  const renderer = createMockRenderer();
  renderer._raycastResults.push({
    object: 'mockMesh',
    point: { x: 5.3, y: 10.7, z: 3.2 },
    faceNormal: { x: 0, y: 1, z: 0 }
  });
  
  const ch = new Crosshair(renderer);
  ch.update(); // No THREE — highlight won't create, but targetBlock should be set
  
  assertNotNull(ch.targetBlock, 'targetBlock set after raycast hit');
  assertEquals(ch.targetBlock.x, 5, 'target x floored from hit point');
  assertEquals(ch.targetBlock.y, 10, 'target y floored from hit point');
  assertEquals(ch.targetBlock.z, 3, 'target z floored from hit point');
}

// ----------------------------------------------------------
// Group 5: Crosshair — update() with no raycast hit
// ----------------------------------------------------------
console.log('\nGroup 5: Crosshair update() with no raycast');

{
  const renderer = createMockRenderer();
  // No raycast results → returns null
  
  const ch = new Crosshair(renderer);
  ch.targetBlock = { x: 1, y: 2, z: 3, faceNormal: [0, 0, 0] }; // Pre-set target
  ch.update();
  
  assertEquals(ch.targetBlock, null, 'targetBlock cleared when no raycast hit');
}

// ----------------------------------------------------------
// Group 6: Crosshair — update() with missing renderer.raycast
// ----------------------------------------------------------
console.log('\nGroup 6: Crosshair update() edge cases');

{
  const ch = new Crosshair({}); // No raycast method
  
  ch.targetBlock = { x: 1, y: 2, z: 3, faceNormal: [0, 0, 0] };
  ch.update();
  
  // Should not crash — renderer.raycast is undefined, early return preserves target
  assertNotNull(ch.targetBlock, 'targetBlock preserved when renderer.raycast missing');
}

// ----------------------------------------------------------
// Group 7: BlockInteraction — Constructor & defaults
// ----------------------------------------------------------
console.log('\nGroup 7: BlockInteraction constructor & defaults');

{
  const mockCrosshair = createMockCrosshair();
  const mockPlayer = createMockPlayer();
  const bi = new BlockInteraction(mockCrosshair, mockPlayer);
  
  assertNotNull(bi, 'BlockInteraction instance created');
  assertEquals(bi.crosshair, mockCrosshair, 'crosshair reference set');
  assertEquals(bi.player, mockPlayer, 'player reference set');
  assertEquals(bi.breakProgress, 0, 'breakProgress starts at 0');
  assertEquals(bi.breakTarget, null, 'breakTarget starts null');
  assertEquals(bi.breakDuration, 1.0, 'breakDuration defaults to 1.0s');
  assertEquals(bi.onBlockBreak, null, 'onBlockBreak callback starts null');
  assertEquals(bi.onBlockPlace, null, 'onBlockPlace callback starts null');
}

// ----------------------------------------------------------
// Group 8: BlockInteraction — _sameBlock()
// ----------------------------------------------------------
console.log('\nGroup 8: BlockInteraction _sameBlock()');

{
  const bi = new BlockInteraction(createMockCrosshair(), createMockPlayer());
  
  assertTrue(bi._sameBlock({x:1,y:2,z:3}, {x:1,y:2,z:3}), 'Same coords → true');
  assertFalse(bi._sameBlock({x:1,y:2,z:3}, {x:2,y:2,z:3}), 'Different X → false');
  assertFalse(bi._sameBlock({x:1,y:2,z:3}, {x:1,y:3,z:3}), 'Different Y → false');
  assertFalse(bi._sameBlock({x:1,y:2,z:3}, {x:1,y:2,z:4}), 'Different Z → false');
  assertTrue(bi._sameBlock({x:-5,y:-10,z:100}, {x:-5,y:-10,z:100}), 'Negative coords match');
}

// ----------------------------------------------------------
// Group 9: BlockInteraction — _isInsidePlayer()
// ----------------------------------------------------------
console.log('\nGroup 9: BlockInteraction _isInsidePlayer()');

{
  const mockPlayer = createMockPlayer({ x: 10, y: 20, z: 10 });
  const bi = new BlockInteraction(createMockCrosshair(), mockPlayer);
  
  // Player AABB: x=[9.6, 10.4], y=[20, 21.8], z=[9.6, 10.4]
  // (width=0.8 → half=0.5 from center; height=1.8 from feet)
  
  // Center of player block — inside
  assertTrue(bi._isInsidePlayer({x:10, y:20, z:10}), 'Feet position inside player');
  assertTrue(bi._isInsidePlayer({x:10, y:21, z:10}), 'Head position inside player');
  
  // Just outside X — not inside
  assertFalse(bi._isInsidePlayer({x:10.6, y:20, z:10}), 'X=10.6 outside player (halfWidth=0.5)');
  assertFalse(bi._isInsidePlayer({x:9.4, y:20, z:10}), 'X=9.4 outside player');
  
  // Just outside Z — not inside
  assertFalse(bi._isInsidePlayer({x:10, y:20, z:10.6}), 'Z=10.6 outside player');
  assertFalse(bi._isInsidePlayer({x:10, y:20, z:9.4}), 'Z=9.4 outside player');
  
  // Above head — not inside
  assertFalse(bi._isInsidePlayer({x:10, y:22, z:10}), 'Y=22 above player head (y+1.8=21.8)');
  
  // Below feet — not inside
  assertFalse(bi._isInsidePlayer({x:10, y:19, z:10}), 'Y=19 below player feet');
  
  // Boundary cases — exactly at edge (should be outside since < is strict for x/z)
  assertTrue(bi._isInsidePlayer({x:10.4, y:20, z:10}), 'X=10.4 inside (abs diff 0.4 < 0.5)');
  assertTrue(bi._isInsidePlayer({x:9.6, y:20, z:10}), 'X=9.6 inside (abs diff 0.4 < 0.5)');
  
  // No player → false
  const biNoPlayer = new BlockInteraction(createMockCrosshair(), null);
  assertFalse(biNoPlayer._isInsidePlayer({x:10, y:20, z:10}), 'null player → not inside');
}

// ----------------------------------------------------------
// Group 10: BlockInteraction — Break progress cycle
// ----------------------------------------------------------
console.log('\nGroup 10: BlockInteraction break progress');

{
  const mockCrosshair = createMockCrosshair();
  const mockPlayer = createMockPlayer();
  const bi = new BlockInteraction(mockCrosshair, mockPlayer);
  
  // Override _isBreaking to simulate held left click
  bi._isBreaking = () => true;
  
  // Set a target block on crosshair
  mockCrosshair.setTargetBlock({ x: 5, y: 10, z: 3, faceNormal: [0, 1, 0] });
  
  let breakCalled = false;
  let brokenTarget = null;
  bi.onBlockBreak = (target) => {
    breakCalled = true;
    brokenTarget = target;
  };
  
  // Update at 60fps → dt = 1/60 ≈ 0.01667
  const dt = 1 / 60;
  
  // Frame 1: progress starts
  bi.update(dt);
  assert(bi.breakProgress > 0, 'breakProgress increases on first frame');
  assertEquals(bi.breakTarget.x, 5, 'breakTarget set to crosshair target');
  
  // Frame 30: halfway through (30 * 1/60 = 0.5s)
  for (let i = 0; i < 29; i++) bi.update(dt);
  assertApprox(bi.breakProgress, 0.5, 0.02, 'breakProgress ≈ 0.5 after 30 frames');
  assertFalse(breakCalled, 'Block not broken yet at 0.5s');
  
  // Frame 60: should trigger break (60 * 1/60 = 1.0s)
  for (let i = 0; i < 30; i++) bi.update(dt);
  assertTrue(breakCalled, 'Block broken after 1.0s');
  assertEquals(brokenTarget.x, 5, 'Broken target x correct');
  assertEquals(bi.breakProgress, 0, 'breakProgress reset after break');
  assertEquals(bi.breakTarget, null, 'breakTarget cleared after break');
}

// ----------------------------------------------------------
// Group 11: BlockInteraction — Break progress resets on target change
// ----------------------------------------------------------
console.log('\nGroup 11: BlockInteraction break target switch');

{
  const mockCrosshair = createMockCrosshair();
  const bi = new BlockInteraction(mockCrosshair, createMockPlayer());
  
  bi._isBreaking = () => true;
  
  // Start breaking block A
  mockCrosshair.setTargetBlock({ x: 5, y: 10, z: 3, faceNormal: [0, 1, 0] });
  bi.update(0.4); // 0.4s progress
  
  assertApprox(bi.breakProgress, 0.4, 0.01, 'Progress accumulates on block A');
  
  // Switch to block B mid-break
  mockCrosshair.setTargetBlock({ x: 6, y: 10, z: 3, faceNormal: [0, 1, 0] });
  bi.update(0.1);
  
  assertApprox(bi.breakProgress, 0.1, 0.01, 'Progress resets when target changes');
  assertEquals(bi.breakTarget.x, 6, 'breakTarget updated to block B');
}

// ----------------------------------------------------------
// Group 12: BlockInteraction — Break stops when not breaking
// ----------------------------------------------------------
console.log('\nGroup 12: BlockInteraction break release');

{
  const mockCrosshair = createMockCrosshair();
  const bi = new BlockInteraction(mockCrosshair, createMockPlayer());
  
  // First simulate breaking
  bi._isBreaking = () => true;
  mockCrosshair.setTargetBlock({ x: 5, y: 10, z: 3, faceNormal: [0, 1, 0] });
  bi.update(0.5);
  
  assertApprox(bi.breakProgress, 0.5, 0.01, 'Progress at 0.5s');
  
  // Release break (stop holding)
  bi._isBreaking = () => false;
  bi.update(0.1);
  
  assertEquals(bi.breakProgress, 0, 'Progress reset on release');
  assertEquals(bi.breakTarget, null, 'breakTarget cleared on release');
}

// ----------------------------------------------------------
// Group 13: BlockInteraction — Place block callback
// ----------------------------------------------------------
console.log('\nGroup 13: BlockInteraction place block');

{
  const mockCrosshair = createMockCrosshair();
  const mockPlayer = createMockPlayer({ x: 5, y: 20, z: 5 }, { selectedSlot: 3 });
  const bi = new BlockInteraction(mockCrosshair, mockPlayer);
  
  // Override _isPlacing to simulate right click
  let placeTriggered = false;
  bi._isPlacing = () => placeTriggered ? false : (placeTriggered = true, true);
  
  let placedPos = null;
  let placedSlot = null;
  bi.onBlockPlace = (pos, slot) => {
    placedPos = pos;
    placedSlot = slot;
  };
  
  // Target a block at player's feet level — placing on top face
  mockCrosshair.setTargetBlock({ x: 5, y: 20, z: 3, faceNormal: [0, 1, 0] });
  bi.update(1 / 60);
  
  assertNotNull(placedPos, 'onBlockPlace callback triggered');
  assertEquals(placedPos.x, 5, 'Place X from face normal');
  assertEquals(placedPos.y, 21, 'Place Y above target block');
  assertEquals(placedSlot, 3, 'Selected slot passed to callback');
  
  // Place action consumed — second update won't place again
  placedPos = null;
  bi.update(1 / 60);
  assertEquals(placedPos, null, 'Place not repeated (action consumed)');
}

// ----------------------------------------------------------
// Group 14: BlockInteraction — Place blocked by player collision
// ----------------------------------------------------------
console.log('\nGroup 14: BlockInteraction place inside player blocked');

{
  const mockCrosshair = createMockCrosshair();
  const mockPlayer = createMockPlayer({ x: 5, y: 20, z: 5 });
  const bi = new BlockInteraction(mockCrosshair, mockPlayer);
  
  let placeCount = 0;
  bi.onBlockPlace = () => { placeCount++; };
  bi._isPlacing = () => true;
  
  // Target block whose face normal would place inside player body
  // Player at (5, 20, 5), width ~0.8, height 1.8
  // If target is (5, 21, 5) with faceNormal [0,-1,0], place pos = (5, 20, 5) — inside player
  mockCrosshair.setTargetBlock({ x: 5, y: 21, z: 5, faceNormal: [0, -1, 0] });
  bi.update(1 / 60);
  
  assertEquals(placeCount, 0, 'Place blocked — position inside player AABB');
}

// ----------------------------------------------------------
// Group 15: BlockInteraction — No crosshair → update safe
// ----------------------------------------------------------
console.log('\nGroup 15: BlockInteraction no crosshair safety');

{
  const bi = new BlockInteraction(null, createMockPlayer());
  
  // Should not crash
  bi.update(1 / 60);
  assertTrue(true, 'update() with null crosshair does not crash');
}

// ----------------------------------------------------------
// Group 16: BlockInteraction — Break duration configurable
// ----------------------------------------------------------
console.log('\nGroup 16: BlockInteraction break duration config');

{
  const mockCrosshair = createMockCrosshair();
  const bi = new BlockInteraction(mockCrosshair, createMockPlayer());
  
  bi._isBreaking = () => true;
  mockCrosshair.setTargetBlock({ x: 5, y: 10, z: 3, faceNormal: [0, 1, 0] });
  
  // Set faster break duration (0.5s instead of 1.0s)
  bi.breakDuration = 0.5;
  
  let broken = false;
  bi.onBlockBreak = () => { broken = true; };
  
  // Update for 0.4s — not enough
  bi.update(0.4);
  assertFalse(broken, 'Not broken at 0.4s with 0.5s duration');
  
  // Update for another 0.2s → total 0.6s ≥ 0.5s
  bi.update(0.2);
  assertTrue(broken, 'Broken at 0.6s with 0.5s duration');
}

// ----------------------------------------------------------
// Group 17: Integration — Full break/place pipeline
// ----------------------------------------------------------
console.log('\nGroup 17: Integration — full break + place pipeline');

{
  const mockCrosshair = createMockCrosshair();
  const mockPlayer = createMockPlayer({ x: 5, y: 20, z: 5 }, { selectedSlot: 1 });
  const bi = new BlockInteraction(mockCrosshair, mockPlayer);
  
  const events = []; // Log of all interaction events
  
  bi.onBlockBreak = (target) => events.push({ type: 'break', target });
  bi.onBlockPlace = (pos, slot) => events.push({ type: 'place', pos, slot });
  
  // Phase 1: Target and break a block
  mockCrosshair.setTargetBlock({ x: 5, y: 10, z: 3, faceNormal: [0, 1, 0] });
  bi._isBreaking = () => true;
  bi._isPlacing = () => false;
  
  bi.update(1.0); // Full break duration
  assertEquals(events.length, 1, 'One event after break');
  assertEquals(events[0].type, 'break', 'First event is break');
  assertEquals(events[0].target.x, 5, 'Break target correct');
  
  // Phase 2: Place a block on the face
  bi._isBreaking = () => false;
  let placeOnce = true;
  bi._isPlacing = () => placeOnce ? (placeOnce = false, true) : false;
  
  mockCrosshair.setTargetBlock({ x: 5, y: 9, z: 3, faceNormal: [0, 1, 0] }); // Place on top of y=9 → y=10
  bi.update(1 / 60);
  
  assertEquals(events.length, 2, 'Two events after break + place');
  assertEquals(events[1].type, 'place', 'Second event is place');
  assertEquals(events[1].pos.y, 10, 'Placed at y=10 (above target y=9)');
  assertEquals(events[1].slot, 1, 'Slot from player inventory');
}

// ----------------------------------------------------------
// Group 18: Crosshair — update() hit point edge cases
// ----------------------------------------------------------
console.log('\nGroup 18: Crosshair raycast edge cases');

{
  // Test: Hit exactly on block boundary → floor should pick correct block
  const renderer = createMockRenderer();
  renderer._raycastResults.push({
    object: 'mockMesh',
    point: { x: 5.0, y: 10.0, z: 3.0 }, // Exactly on corner
    faceNormal: { x: -1, y: 0, z: 0 }   // Hit from right side → block at (4, 10, 3)
  });
  
  const ch = new Crosshair(renderer);
  ch.update();
  
  assertNotNull(ch.targetBlock, 'Hit on exact corner gives a target');
  // With faceNormal [-1,0,0], the offset subtracts -0.01 from x → 5.0 - (-0.01) = 5.01 → floor = 5
  // Wait: bx = Math.floor(5.0 - (-1 * 0.01)) = Math.floor(5.01) = 5
  // The face normal offset pushes slightly INTO the block to avoid floating point edge issues
  assertEquals(ch.targetBlock.x, 5, 'Corner hit X floored correctly');
  assertEquals(ch.targetBlock.y, 10, 'Corner hit Y floored correctly');
  assertEquals(ch.targetBlock.z, 3, 'Corner hit Z floored correctly');
}

// ----------------------------------------------------------
// Group 19: BlockInteraction — _updateBreakUI and _consumePlaceAction don't crash
// ----------------------------------------------------------
console.log('\nGroup 19: BlockInteraction stub methods safe');

{
  const bi = new BlockInteraction(createMockCrosshair(), createMockPlayer());
  
  // These are stubs — should not throw
  bi._updateBreakUI();
  assertTrue(true, '_updateBreakUI() does not crash (stub)');
  
  bi._consumePlaceAction();
  assertTrue(true, '_consumePlaceAction() does not crash (stub)');
}

// ----------------------------------------------------------
// Group 20: BlockInteraction — break with no onBlockBreak callback
// ----------------------------------------------------------
console.log('\nGroup 20: BlockInteraction callbacks optional');

{
  const mockCrosshair = createMockCrosshair();
  const bi = new BlockInteraction(mockCrosshair, createMockPlayer());
  
  bi._isBreaking = () => true;
  mockCrosshair.setTargetBlock({ x: 5, y: 10, z: 3, faceNormal: [0, 1, 0] });
  
  // No onBlockBreak set — should not crash when break triggers
  bi.update(1.0);
  assertTrue(true, 'Break with null callback does not crash');
}

// ============================================================
// Results
// ============================================================

console.log('\n=======================');
console.log(`Results: ${passCount} passed, ${failCount} failed`);

if (failCount > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
} else {
  console.log('🎉 All block interaction tests passing!');
  process.exit(0);
}
