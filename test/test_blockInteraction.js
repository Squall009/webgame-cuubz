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

const { Crosshair } = require('../src/ui/hud/Crosshair.js');
const { BlockInteraction } = require('../src/game/systems/BlockInteractionSystem.js');

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

// ============================================================
// BlockInteraction helpers
//
// BlockInteraction no longer drives itself from a Crosshair. It takes
// { renderer, chunkManager, mouse, player, inventory }, raycasts through the
// renderer itself, and tracks progressive breaking in
// breakingBlock / breakProgress / breakStartTime.
// ============================================================

const { BLOCK_TYPES } = require('../src/engine/world/ChunkData.js');

/** A 16×16 chunk of air that records setBlock calls. */
function createMockChunk() {
  return {
    blocks: new Map(),
    _key(x, y, z) { return `${x},${y},${z}`; },
    getBlock(x, y, z) {
      const v = this.blocks.get(this._key(x, y, z));
      return v === undefined ? BLOCK_TYPES.AIR : v;
    },
    setBlock(x, y, z, type) { this.blocks.set(this._key(x, y, z), type); },
  };
}

function createMockChunkManager(chunk) {
  return {
    chunk: chunk || createMockChunk(),
    dirtied: [],
    getChunkData() { return this.chunk; },
    markChunkDirty(cx, cz) { this.dirtied.push({ cx, cz }); },
  };
}

/**
 * Renderer stub whose raycast always reports a hit on the given block, entered
 * through the given face. The point is nudged to the face so that
 * _getTargetBlock's "step half a normal inward then floor" lands on the block.
 */
function createTargetingRenderer(block, faceNormal) {
  const n = faceNormal || { x: 0, y: 1, z: 0 };
  return {
    scene: { add() {}, remove() {} },
    hit: block === null ? null : {
      point: {
        x: block.x + 0.5 + n.x * 0.5,
        y: block.y + 0.5 + n.y * 0.5,
        z: block.z + 0.5 + n.z * 0.5,
      },
      faceNormal: n,
    },
    raycast() { return this.hit; },
  };
}

function createMouse(state) {
  return Object.assign({
    leftClick: false, justClickedLeft: false, justClickedRight: false,
  }, state);
}

/** Build a BlockInteraction wired to stubs, with a solid block already placed. */
function makeInteraction(opts = {}) {
  const blockPos = opts.blockPos || { x: 4, y: 20, z: 4 };
  const blockType = opts.blockType === undefined ? BLOCK_TYPES.DIRT : opts.blockType;

  const chunk = createMockChunk();
  const lx = ((blockPos.x % 16) + 16) % 16;
  const lz = ((blockPos.z % 16) + 16) % 16;
  if (blockType !== BLOCK_TYPES.AIR) chunk.setBlock(lx, blockPos.y, lz, blockType);

  const chunkManager = createMockChunkManager(chunk);
  const renderer = createTargetingRenderer(blockPos, opts.faceNormal);
  const mouse = createMouse(opts.mouse);
  const player = { position: opts.playerPos || { x: 4.5, y: 20.5, z: 4.5 }, creativeMode: !!opts.creativeMode };

  const bi = new BlockInteraction({
    renderer, chunkManager, mouse, player,
    inventory: opts.inventory || null,
  });
  // The crack overlay needs a real WebGL/canvas stack; stub it out.
  bi._createCrackOverlay = () => {};
  bi._updateCrackOverlay = () => {};
  bi._removeCrackOverlay = () => {};

  return { bi, chunk, chunkManager, renderer, mouse, player, blockPos, lx, lz };
}

// ----------------------------------------------------------
// Group 7: BlockInteraction — constructor & defaults
// ----------------------------------------------------------
console.log('\nGroup 7: BlockInteraction constructor & defaults');

{
  const { bi, renderer, chunkManager, player } = makeInteraction();

  assert(bi.renderer === renderer, 'renderer reference set');
  assert(bi.chunkManager === chunkManager, 'chunkManager reference set');
  assert(bi.player === player, 'player reference set');
  assertEquals(bi.breakingBlock, null, 'breakingBlock starts null');
  assertEquals(bi.breakProgress, 0, 'breakProgress starts at 0');
  assertEquals(bi.breakStartTime, 0, 'breakStartTime starts at 0');
  assertEquals(bi.breakRange, 7, 'breakRange defaults to 7 blocks');
  assertEquals(bi.placeRange, 7, 'placeRange defaults to 7 blocks');
  assertEquals(bi.inventory, null, 'inventory is null when not supplied');
  assertEquals(bi.touch, null, 'touch input starts unset');
  assertEquals(bi._lastBroken, null, 'no block broken yet');
  assertEquals(bi._lastPlaced, null, 'no block placed yet');
  assertEquals(bi.selectedBlockType, BLOCK_TYPES.STONE, 'default place type is stone');

  // Unbreakable set is built from named block types, not literal ids
  assertTrue(bi.unbreakableBlocks.has(BLOCK_TYPES.BEDROCK), 'bedrock is unbreakable');
  assertTrue(bi.unbreakableBlocks.has(BLOCK_TYPES.WATER), 'water is unbreakable');
  assertTrue(bi.unbreakableBlocks.has(BLOCK_TYPES.LAVA), 'lava is unbreakable');
  assertFalse(bi.unbreakableBlocks.has(BLOCK_TYPES.DIRT), 'dirt is breakable');
}

// ----------------------------------------------------------
// Group 8: BlockInteraction — _getTargetBlock()
// ----------------------------------------------------------
console.log('\nGroup 8: BlockInteraction _getTargetBlock()');

{
  // Each face normal must resolve back to the same block
  const faces = [
    { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 },
    { x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 },
  ];
  for (const n of faces) {
    const { bi } = makeInteraction({ blockPos: { x: 4, y: 20, z: 4 }, faceNormal: n });
    const target = bi._getTargetBlock();
    assertNotNull(target, `face (${n.x},${n.y},${n.z}) produces a target`);
    assertEquals(target.blockPos.x, 4, `face (${n.x},${n.y},${n.z}) resolves X`);
    assertEquals(target.blockPos.y, 20, `face (${n.x},${n.y},${n.z}) resolves Y`);
    assertEquals(target.blockPos.z, 4, `face (${n.x},${n.y},${n.z}) resolves Z`);
  }

  // Chunk coordinates are derived by flooring, including negatives
  const neg = makeInteraction({ blockPos: { x: -3, y: 20, z: -20 }, playerPos: { x: -2.5, y: 20.5, z: -19.5 } });
  const negTarget = neg.bi._getTargetBlock();
  assertEquals(negTarget.chunkX, -1, 'Negative X floors to chunk -1');
  assertEquals(negTarget.chunkZ, -2, 'Negative Z floors to chunk -2');

  // No raycast hit → no target
  const miss = makeInteraction();
  miss.renderer.hit = null;
  assertEquals(miss.bi._getTargetBlock(), null, 'No raycast hit gives no target');
}

// ----------------------------------------------------------
// Group 9: BlockInteraction — _startBreak()
// ----------------------------------------------------------
console.log('\nGroup 9: BlockInteraction _startBreak()');

{
  // Happy path
  const { bi, blockPos } = makeInteraction();
  bi._startBreak();
  assertNotNull(bi.breakingBlock, 'Breaking starts on a solid block');
  assertEquals(bi.breakingBlock.x, blockPos.x, 'breakingBlock records X');
  assertEquals(bi.breakingBlock.y, blockPos.y, 'breakingBlock records Y');
  assertEquals(bi.breakingBlock.z, blockPos.z, 'breakingBlock records Z');
  assertEquals(bi.breakingBlock.blockType, BLOCK_TYPES.DIRT, 'breakingBlock records the block type');
  assertTrue(bi.breakingBlock.hardness > 0, 'breakingBlock records a positive hardness');
  assertEquals(bi.breakProgress, 0, 'breakProgress starts at 0');

  // Air is not breakable
  const air = makeInteraction({ blockType: BLOCK_TYPES.AIR });
  air.bi._startBreak();
  assertEquals(air.bi.breakingBlock, null, 'Air cannot be broken');

  // Explicitly unbreakable blocks are refused
  const bedrock = makeInteraction({ blockType: BLOCK_TYPES.BEDROCK });
  bedrock.bi._startBreak();
  assertEquals(bedrock.bi.breakingBlock, null, 'Bedrock cannot be broken');

  // Out of reach
  const far = makeInteraction({ playerPos: { x: 50, y: 20, z: 50 } });
  far.bi._startBreak();
  assertEquals(far.bi.breakingBlock, null, 'Block beyond breakRange cannot be broken');

  // Missing chunk data
  const noChunk = makeInteraction();
  noChunk.chunkManager.getChunkData = () => null;
  noChunk.bi._startBreak();
  assertEquals(noChunk.bi.breakingBlock, null, 'Missing chunk data aborts the break');

  // onBreakStarted fires for the swing animation
  const swing = makeInteraction();
  let swung = false;
  swing.bi.onBreakStarted = () => { swung = true; };
  swing.bi._startBreak();
  assertTrue(swung, 'onBreakStarted fires when a break begins');
}

// ----------------------------------------------------------
// Group 10: BlockInteraction — break progress accumulates
// ----------------------------------------------------------
console.log('\nGroup 10: BlockInteraction break progress');

{
  const { bi } = makeInteraction();
  bi._startBreak();
  const hardness = bi.breakingBlock.hardness;

  bi._continueBreak(0.1);
  assertTrue(bi.breakProgress > 0, 'breakProgress advances with time');

  // Break time is hardness * 1.5 seconds at 1x tool speed
  const expected = (1 / (hardness * 1.5)) * 0.1;
  assertApprox(bi.breakProgress, expected, 0.0001, 'breakProgress matches hardness formula');

  // Harder blocks take longer than softer ones for the same delta
  const soft = makeInteraction({ blockType: BLOCK_TYPES.DIRT });
  soft.bi._startBreak();
  soft.bi._continueBreak(0.1);

  const hard = makeInteraction({ blockType: BLOCK_TYPES.STONE });
  hard.bi._startBreak();
  hard.bi._continueBreak(0.1);

  assertTrue(soft.bi.breakProgress > hard.bi.breakProgress,
    'Softer blocks accumulate progress faster than harder ones');
}

// ----------------------------------------------------------
// Group 11: BlockInteraction — retargeting cancels the in-flight break
// ----------------------------------------------------------
console.log('\nGroup 11: BlockInteraction break target switch');

{
  const ctx = makeInteraction({ blockPos: { x: 4, y: 20, z: 4 } });
  ctx.bi._startBreak();
  ctx.bi._continueBreak(0.05);
  assertTrue(ctx.bi.breakProgress > 0, 'Progress accumulated on the first block');

  // Point the raycast at a different block that is also solid
  ctx.chunk.setBlock(5, 20, 4, BLOCK_TYPES.DIRT);
  ctx.renderer.hit = {
    point: { x: 5.5, y: 21.0, z: 4.5 },
    faceNormal: { x: 0, y: 1, z: 0 },
  };
  ctx.bi._continueBreak(0.05);

  assertNotNull(ctx.bi.breakingBlock, 'A new break started on the new target');
  assertEquals(ctx.bi.breakingBlock.x, 5, 'Now breaking the newly targeted block');
  assertEquals(ctx.bi.breakProgress, 0, 'Progress resets when the target changes');
}

{
  // Losing the raycast entirely cancels the break
  const ctx = makeInteraction();
  ctx.bi._startBreak();
  ctx.bi._continueBreak(0.05);
  ctx.renderer.hit = null;
  ctx.bi._continueBreak(0.05);
  assertEquals(ctx.bi.breakingBlock, null, 'Losing the target cancels the break');
  assertEquals(ctx.bi.breakProgress, 0, 'Progress resets when the break is cancelled');
}

// ----------------------------------------------------------
// Group 12: BlockInteraction — _completeBreak()
// ----------------------------------------------------------
console.log('\nGroup 12: BlockInteraction break completion');

{
  const { bi, chunk, chunkManager, lx, lz, blockPos } = makeInteraction();
  let dropped = null;
  bi.onBlockBroken = (dropType, pos) => { dropped = { dropType, pos }; };

  bi._startBreak();
  bi._continueBreak(10); // far more than enough to finish

  assertEquals(chunk.getBlock(lx, blockPos.y, lz), BLOCK_TYPES.AIR, 'Broken block becomes air');
  assertEquals(bi.breakingBlock, null, 'breakingBlock clears after completion');
  assertEquals(bi.breakProgress, 0, 'breakProgress resets after completion');
  assertTrue(chunkManager.dirtied.length > 0, 'Chunk is marked dirty for saving');
  assertNotNull(bi._lastBroken, 'Broken block recorded for multiplayer sync');
  assertEquals(bi._lastBroken.x, blockPos.x, 'Sync record has the right X');

  assertNotNull(dropped, 'onBlockBroken fires with a drop');
  assertEquals(dropped.dropType, BLOCK_TYPES.DIRT, 'Dirt drops itself');
  assertEquals(dropped.pos.y, blockPos.y, 'Drop spawns at the block position');
}

// ----------------------------------------------------------
// Group 13: BlockInteraction — _getDropType() delegates to the registry
// ----------------------------------------------------------
console.log('\nGroup 13: BlockInteraction drop resolution');

{
  const { bi } = makeInteraction();

  // Grass drops dirt; most blocks drop themselves. These used to be resolved from
  // a stale id-keyed table, which broke when the blocks were renumbered.
  assertEquals(bi._getDropType(BLOCK_TYPES.GRASS), BLOCK_TYPES.DIRT, 'Grass drops dirt');
  assertEquals(bi._getDropType(BLOCK_TYPES.STONE), BLOCK_TYPES.STONE, 'Stone drops itself');
  assertEquals(bi._getDropType(BLOCK_TYPES.ANDESITE), BLOCK_TYPES.ANDESITE, 'Andesite drops itself');
  assertEquals(bi._getDropType(BLOCK_TYPES.DEEPSLATE), BLOCK_TYPES.DEEPSLATE, 'Deepslate drops itself');
  assertEquals(bi._getDropType(BLOCK_TYPES.COAL_ORE), 'coal', 'Coal ore drops the coal item');
  assertEquals(bi._getDropType(BLOCK_TYPES.BEDROCK), null, 'Bedrock drops nothing');
  assertEquals(bi._getDropType(BLOCK_TYPES.AIR), null, 'Air drops nothing');
}

// ----------------------------------------------------------
// Group 14: BlockInteraction — placing blocks
// ----------------------------------------------------------
console.log('\nGroup 14: BlockInteraction place block');

{
  // Place on the top face → the new block goes one above the target
  const { bi, chunk, chunkManager } = makeInteraction({
    blockPos: { x: 4, y: 20, z: 4 },
    faceNormal: { x: 0, y: 1, z: 0 },
    playerPos: { x: 4.5, y: 23.5, z: 4.5 },
  });
  bi.setSelectedBlockType(BLOCK_TYPES.STONE);
  bi._tryPlaceBlock();

  assertEquals(chunk.getBlock(4, 21, 4), BLOCK_TYPES.STONE, 'Block placed on the targeted face');
  assertNotNull(bi._lastPlaced, 'Placement recorded for multiplayer sync');
  assertEquals(bi._lastPlaced.blockType, BLOCK_TYPES.STONE, 'Sync record has the placed type');
  assertTrue(chunkManager.dirtied.length > 0, 'Chunk marked dirty after placing');
}

{
  // Cannot overwrite an existing solid block
  const ctx = makeInteraction({ faceNormal: { x: 0, y: 1, z: 0 }, playerPos: { x: 4.5, y: 23.5, z: 4.5 } });
  ctx.chunk.setBlock(4, 21, 4, BLOCK_TYPES.DIRT);
  ctx.bi._tryPlaceBlock();
  assertEquals(ctx.chunk.getBlock(4, 21, 4), BLOCK_TYPES.DIRT, 'Existing block is not overwritten');
  assertEquals(ctx.bi._lastPlaced, null, 'No sync record when placement is refused');
}

{
  // Out of range
  const ctx = makeInteraction({ playerPos: { x: 60, y: 20, z: 60 } });
  ctx.bi._tryPlaceBlock();
  assertEquals(ctx.bi._lastPlaced, null, 'Cannot place beyond placeRange');
}

{
  // No face normal → nothing to place against
  const ctx = makeInteraction();
  ctx.renderer.hit = { point: { x: 4.5, y: 20.5, z: 4.5 }, faceNormal: null };
  ctx.bi._tryPlaceBlock();
  assertEquals(ctx.bi._lastPlaced, null, 'No face normal means no placement');
}

// ----------------------------------------------------------
// Group 15: BlockInteraction — cannot place inside the player
// ----------------------------------------------------------
console.log('\nGroup 15: BlockInteraction place inside player blocked');

{
  // Player stands at (4, 20, 4); target the block below so the placement
  // position lands in the player's own feet voxel.
  const ctx = makeInteraction({
    blockPos: { x: 4, y: 19, z: 4 },
    faceNormal: { x: 0, y: 1, z: 0 },
    playerPos: { x: 4.5, y: 20.5, z: 4.5 },
  });
  ctx.bi._tryPlaceBlock();
  assertEquals(ctx.chunk.getBlock(4, 20, 4), BLOCK_TYPES.AIR, 'Cannot place into the player feet voxel');
  assertEquals(ctx.bi._lastPlaced, null, 'Blocked placement records nothing');
}

{
  // Head voxel is blocked too
  const ctx = makeInteraction({
    blockPos: { x: 4, y: 20, z: 4 },
    faceNormal: { x: 0, y: 1, z: 0 },
    playerPos: { x: 4.5, y: 20.5, z: 4.5 },
  });
  ctx.bi._tryPlaceBlock();
  assertEquals(ctx.chunk.getBlock(4, 21, 4), BLOCK_TYPES.AIR, 'Cannot place into the player head voxel');
}

// ----------------------------------------------------------
// Group 16: BlockInteraction — inventory integration
// ----------------------------------------------------------
console.log('\nGroup 16: BlockInteraction inventory integration');

{
  // The selected hotbar item overrides selectedBlockType, and is consumed
  let consumed = 0;
  const inventory = {
    getSelectedItem: () => ({ typeId: BLOCK_TYPES.SAND, count: 5 }),
    consumeSelectedBlock: () => { consumed++; return true; },
    getToolInfo: () => null,
  };
  const ctx = makeInteraction({
    faceNormal: { x: 0, y: 1, z: 0 },
    playerPos: { x: 4.5, y: 23.5, z: 4.5 },
    inventory,
  });
  ctx.bi._tryPlaceBlock();
  assertEquals(ctx.chunk.getBlock(4, 21, 4), BLOCK_TYPES.SAND, 'Selected hotbar item is placed');
  assertEquals(consumed, 1, 'Placing consumes one item from the inventory');
}

{
  // An empty hotbar slot blocks placement
  const inventory = {
    getSelectedItem: () => ({ typeId: BLOCK_TYPES.SAND, count: 0 }),
    consumeSelectedBlock: () => false,
    getToolInfo: () => null,
  };
  const ctx = makeInteraction({
    faceNormal: { x: 0, y: 1, z: 0 },
    playerPos: { x: 4.5, y: 23.5, z: 4.5 },
    inventory,
  });
  ctx.bi._tryPlaceBlock();
  assertEquals(ctx.chunk.getBlock(4, 21, 4), BLOCK_TYPES.AIR, 'Nothing placed when the slot is empty');
}

{
  // Creative mode places without consuming
  let consumed = 0;
  const inventory = {
    getSelectedItem: () => ({ typeId: BLOCK_TYPES.SAND, count: 1 }),
    consumeSelectedBlock: () => { consumed++; return true; },
    getToolInfo: () => null,
  };
  const ctx = makeInteraction({
    faceNormal: { x: 0, y: 1, z: 0 },
    playerPos: { x: 4.5, y: 23.5, z: 4.5 },
    inventory, creativeMode: true,
  });
  ctx.bi._tryPlaceBlock();
  assertEquals(ctx.chunk.getBlock(4, 21, 4), BLOCK_TYPES.SAND, 'Creative mode still places the block');
  assertEquals(consumed, 0, 'Creative mode does not consume inventory');
}

{
  // A matching tool speeds up mining
  const toolInv = {
    getSelectedItem: () => null,
    consumeSelectedBlock: () => true,
    getToolInfo: () => ({ toolType: 'shovel', miningSpeed: 4.0 }),
  };
  const withTool = makeInteraction({ blockType: BLOCK_TYPES.GRASS, inventory: toolInv });
  withTool.bi._startBreak();
  withTool.bi._continueBreak(0.05);

  const bareHands = makeInteraction({ blockType: BLOCK_TYPES.GRASS });
  bareHands.bi._startBreak();
  bareHands.bi._continueBreak(0.05);

  assertTrue(withTool.bi.breakProgress > bareHands.bi.breakProgress,
    'The correct tool mines faster than bare hands');
}

// ----------------------------------------------------------
// Group 17: BlockInteraction — update() drives break and place
// ----------------------------------------------------------
console.log('\nGroup 17: Integration — update() pipeline');

{
  // Holding left click starts and continues a break
  const ctx = makeInteraction({ mouse: { leftClick: true } });
  ctx.bi.update(0.05);
  assertNotNull(ctx.bi.breakingBlock, 'Holding left click starts a break');
  const first = ctx.bi.breakProgress;
  ctx.bi.update(0.05);
  assertTrue(ctx.bi.breakProgress > first, 'Continuing to hold advances the break');

  // Releasing cancels
  ctx.mouse.leftClick = false;
  ctx.bi.update(0.05);
  assertEquals(ctx.bi.breakingBlock, null, 'Releasing the button cancels the break');
}

{
  // Right click places
  const ctx = makeInteraction({
    faceNormal: { x: 0, y: 1, z: 0 },
    playerPos: { x: 4.5, y: 23.5, z: 4.5 },
    mouse: { justClickedRight: true },
  });
  ctx.bi.update(0.05);
  assertNotNull(ctx.bi._lastPlaced, 'Right click places a block');
}

{
  // A mob attack this frame suppresses breaking
  const ctx = makeInteraction({ mouse: { leftClick: true } });
  ctx.bi.update(0.05);
  assertNotNull(ctx.bi.breakingBlock, 'Break in flight before the attack');
  ctx.bi._attackOverride = true;
  ctx.bi.update(0.05);
  assertEquals(ctx.bi.breakingBlock, null, 'Mob attack cancels the in-flight break');
  assertFalse(ctx.bi._attackOverride, 'Attack override is consumed after one frame');
}

{
  // Touch input drives the same paths as the mouse
  const ctx = makeInteraction();
  ctx.bi.touch = { breakHeld: true, breakJustPressed: true, placePressed: false };
  ctx.bi.update(0.05);
  assertNotNull(ctx.bi.breakingBlock, 'Touch break-held starts a break');
}

{
  // update() with no renderer is a safe no-op
  const bare = new BlockInteraction({ renderer: null, chunkManager: null, mouse: null, player: null });
  bare.update(0.05);
  assertEquals(bare.breakingBlock, null, 'update without a renderer does nothing');
}

// ----------------------------------------------------------
// Group 18: BlockInteraction — setSelectedBlockType and dispose
// ----------------------------------------------------------
console.log('\nGroup 18: BlockInteraction selection and disposal');

{
  const { bi } = makeInteraction();
  bi.setSelectedBlockType(BLOCK_TYPES.SAND);
  assertEquals(bi.selectedBlockType, BLOCK_TYPES.SAND, 'setSelectedBlockType updates the selection');

  // dispose is safe even with a break in flight, and twice over
  bi._startBreak();
  bi.dispose();
  bi.dispose();
  assert(true, 'dispose is safe to call repeatedly');
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
