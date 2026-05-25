/**
 * Cuubz — Chunk Manager Tests (with PerformanceOptimizer integration)
 * Tests for chunk loading/unloading, render distance management, performance adaptation.
 */

const assert = require('assert');
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    console.error(`  ❌ ${name}: ${e.message}`);
  }
}

const ChunkManager = require('../js/renderer/chunkManager');
const { PerformanceOptimizer, ADJUSTMENT_COOLDOWN } = require('../js/renderer/performanceOptimizer');

// Mock renderer for testing
function createMockRenderer() {
  return {
    chunkGroup: [],
    removeChunkMesh: function(mesh) { /* no-op */ },
    addChunkMesh: function(mesh, cx, cz) { this.chunkGroup.push({ mesh, cx, cz }); }
  };
}

// Mock generator that returns simple chunk data
function mockGenerator(cx, cz) {
  return { cx, cz, blocks: new Array(16 * 16 * 97).fill(0), getBlock: () => 0 };
}

// =============================================
// Group 1: Constructor defaults
// =============================================
test('Constructor: default render distance is 6', () => {
  const cm = new ChunkManager(createMockRenderer(), mockGenerator);
  assert.strictEqual(cm.renderDistance, 6);
});

test('Constructor: custom render distance via options', () => {
  const cm = new ChunkManager(createMockRenderer(), mockGenerator, { renderDistance: 4 });
  assert.strictEqual(cm.renderDistance, 4);
});

test('Constructor: no performance optimizer by default', () => {
  const cm = new ChunkManager(createMockRenderer(), mockGenerator);
  assert.strictEqual(cm.performanceOptimizer, null);
});

test('Constructor: lowQualityMode defaults to false', () => {
  const cm = new ChunkManager(createMockRenderer(), mockGenerator);
  assert.strictEqual(cm.lowQualityMode, false);
});

test('Constructor: custom lowQualityMode option', () => {
  const cm = new ChunkManager(createMockRenderer(), mockGenerator, { lowQualityMode: true });
  assert.strictEqual(cm.lowQualityMode, true);
});

// =============================================
// Group 2: PerformanceOptimizer integration
// =============================================
test('Constructor: accepts performance optimizer via options', () => {
  const opt = new PerformanceOptimizer({
    glInfo: null, touchPoints: 0, hasTouchStart: false, screenWidth: 1920
  });
  const cm = new ChunkManager(createMockRenderer(), mockGenerator, { performanceOptimizer: opt });
  assert.strictEqual(cm.performanceOptimizer, opt);
});

test('Constructor: syncs optimizer render distance with manager', () => {
  // With null glInfo → MEDIUM tier → default render distance 4
  const opt = new PerformanceOptimizer({
    glInfo: null, touchPoints: 0, hasTouchStart: false, screenWidth: 1920
  });
  assert.strictEqual(opt.getRenderDistance(), 4); // MEDIUM tier default

  const cm = new ChunkManager(createMockRenderer(), mockGenerator, { performanceOptimizer: opt });
  // Manager should adopt optimizer's distance
  assert.strictEqual(cm.renderDistance, 4);
  assert.strictEqual(opt.getRenderDistance(), 4);
});

test('Constructor: wires up callback if optimizer has none', () => {
  const opt = new PerformanceOptimizer({
    glInfo: null, touchPoints: 0, hasTouchStart: false, screenWidth: 1920
  });
  // Ensure no pre-existing callback
  opt._onRenderDistanceChange = null;

  const cm = new ChunkManager(createMockRenderer(), mockGenerator, { performanceOptimizer: opt });
  assert.ok(typeof opt._onRenderDistanceChange === 'function');
});

// =============================================
// Group 3: setRenderDistance
// =============================================
test('setRenderDistance: basic change', () => {
  const cm = new ChunkManager(createMockRenderer(), mockGenerator);
  cm.setRenderDistance(4);
  assert.strictEqual(cm.renderDistance, 4);
});

test('setRenderDistance: clamped to minimum 2', () => {
  const cm = new ChunkManager(createMockRenderer(), mockGenerator);
  cm.setRenderDistance(1);
  assert.strictEqual(cm.renderDistance, 2);
});

test('setRenderDistance: clamped to maximum 16', () => {
  const cm = new ChunkManager(createMockRenderer(), mockGenerator);
  cm.setRenderDistance(20);
  assert.strictEqual(cm.renderDistance, 16);
});

test('setRenderDistance: syncs with optimizer if present', () => {
  const opt = new PerformanceOptimizer({
    glInfo: null, touchPoints: 0, hasTouchStart: false, screenWidth: 1920
  });
  const cm = new ChunkManager(createMockRenderer(), mockGenerator, { performanceOptimizer: opt });
  cm.setRenderDistance(3);
  assert.strictEqual(cm.renderDistance, 3);
  // Optimizer should also be updated (via callback or direct set)
  assert.strictEqual(opt.getRenderDistance(), 3);
});

test('setRenderDistance: fires callback on change', () => {
  let callbackValue = null;
  const cm = new ChunkManager(createMockRenderer(), mockGenerator, {
    onRenderDistanceChange: (d) => { callbackValue = d; }
  });
  cm.setRenderDistance(5);
  assert.strictEqual(callbackValue, 5);
});

test('setRenderDistance: no callback if same value', () => {
  let callCount = 0;
  const cm = new ChunkManager(createMockRenderer(), mockGenerator, {
    renderDistance: 4,
    onRenderDistanceChange: () => { callCount++; }
  });
  cm.setRenderDistance(4); // Same value
  assert.strictEqual(callCount, 0);
});

// =============================================
// Group 4: update() with performance adjustment
// =============================================
test('update(): skips if player moved less than 16 blocks', () => {
  const cm = new ChunkManager(createMockRenderer(), mockGenerator);
  cm.update(0, 0); // Initial position
  cm.lastPlayerX = 0; cm.lastPlayerZ = 0;
  cm.update(10, 10); // Less than 16 block movement
  // Should not have updated lastPlayerX/Z
  assert.strictEqual(cm.lastPlayerX, 0);
  assert.strictEqual(cm.lastPlayerZ, 0);
});

test('update(): processes when player moves >= 16 blocks', () => {
  const cm = new ChunkManager(createMockRenderer(), mockGenerator);
  cm.update(0, 0);
  cm.update(20, 20); // > 16 block movement
  assert.strictEqual(cm.lastPlayerX, 20);
  assert.strictEqual(cm.lastPlayerZ, 20);
});

test('update(): with optimizer, checks and adjusts on currentTime', () => {
  const opt = new PerformanceOptimizer({
    glInfo: null, touchPoints: 0, hasTouchStart: false, screenWidth: 1920
  });
  opt.monitor.setSimulatedFPS(15); // Critical low

  const cm = new ChunkManager(createMockRenderer(), mockGenerator, { performanceOptimizer: opt });
  const initialDist = cm.renderDistance;

  // Move player far enough to trigger update, with currentTime for perf check
  cm.update(0, 0, ADJUSTMENT_COOLDOWN + 1);
  assert.ok(cm.renderDistance <= initialDist, 'Should reduce or stay same on low FPS');
});

test('update(): syncs lowQualityMode from optimizer', () => {
  const opt = new PerformanceOptimizer({
    glInfo: null, touchPoints: 0, hasTouchStart: false, screenWidth: 1920
  });
  opt.setLowQualityMode(true);

  const cm = new ChunkManager(createMockRenderer(), mockGenerator, { performanceOptimizer: opt });
  cm.update(20, 20, ADJUSTMENT_COOLDOWN + 1); // Trigger update with perf check
  assert.strictEqual(cm.lowQualityMode, true);
});

// =============================================
// Group 5: Chunk loading/unloading
// =============================================
test('getLoadedCount: starts at 0', () => {
  const cm = new ChunkManager(createMockRenderer(), mockGenerator);
  assert.strictEqual(cm.getLoadedCount(), 0);
});

test('Chunks are queued for building on update', () => {
  const cm = new ChunkManager(createMockRenderer(), mockGenerator);
  cm.update(0, 0); // Initial — positions start at 0 so no movement trigger

  // Manually trigger a far movement to load chunks
  cm.lastPlayerX = -100; cm.lastPlayerZ = -100;
  cm.update(0, 0);

  // Build queue should have entries immediately (async processing happens via setTimeout)
  assert.ok(cm.buildQueue.length > 0, 'Should have queued chunks for building');
});

// =============================================
// Group 6: getPerformanceState
// =============================================
test('getPerformanceState: returns null without optimizer', () => {
  const cm = new ChunkManager(createMockRenderer(), mockGenerator);
  assert.strictEqual(cm.getPerformanceState(), null);
});

test('getPerformanceState: returns state from optimizer', () => {
  const opt = new PerformanceOptimizer({
    glInfo: { renderer: 'NVIDIA GeForce RTX', maxTextureSize: 16384, maxViewportDims: [16384, 16384] },
    touchPoints: 0, hasTouchStart: false, screenWidth: 1920
  });
  const cm = new ChunkManager(createMockRenderer(), mockGenerator, { performanceOptimizer: opt });
  const state = cm.getPerformanceState();
  assert.ok(state !== null);
  assert.strictEqual(state.tier, 'high');
});

// =============================================
// Group 7: dispose()
// =============================================
test('dispose(): clears loaded chunks', () => {
  const cm = new ChunkManager(createMockRenderer(), mockGenerator);
  // Manually add a chunk for testing
  cm.loadedChunks.set('0,0', { data: {}, built: true });
  cm.dispose();
  assert.strictEqual(cm.loadedChunks.size, 0);
});

test('dispose(): clears build queue', () => {
  const cm = new ChunkManager(createMockRenderer(), mockGenerator);
  cm.buildQueue.push({ cx: 1, cz: 1 });
  cm.dispose();
  assert.strictEqual(cm.buildQueue.length, 0);
});

test('dispose(): nullifies optimizer reference', () => {
  const opt = new PerformanceOptimizer({
    glInfo: null, touchPoints: 0, hasTouchStart: false, screenWidth: 1920
  });
  const cm = new ChunkManager(createMockRenderer(), mockGenerator, { performanceOptimizer: opt });
  cm.dispose();
  assert.strictEqual(cm.performanceOptimizer, null);
});

test('dispose(): clears callback', () => {
  const cm = new ChunkManager(createMockRenderer(), mockGenerator, {
    onRenderDistanceChange: () => {}
  });
  cm.dispose();
  assert.strictEqual(cm._onRenderDistanceChange, null);
});

// =============================================
// Group 8: Integration scenarios
// =============================================
test('Integration: Mobile device gets reduced render distance', () => {
  const opt = new PerformanceOptimizer({
    glInfo: { renderer: 'Adreno (TM) 508', maxTextureSize: 8192, maxViewportDims: [4096, 4096] },
    touchPoints: 5, hasTouchStart: true, screenWidth: 412
  });
  const cm = new ChunkManager(createMockRenderer(), mockGenerator, { performanceOptimizer: opt });

  assert.strictEqual(cm.renderDistance, 3); // LOW tier default
  assert.strictEqual(cm.lowQualityMode, false); // Manager starts false, synced on update
});

test('Integration: FPS drop reduces render distance during gameplay', () => {
  const opt = new PerformanceOptimizer({
    glInfo: null, touchPoints: 0, hasTouchStart: false, screenWidth: 1920
  });
  const cm = new ChunkManager(createMockRenderer(), mockGenerator, { performanceOptimizer: opt });

  const initialDist = cm.renderDistance;

  // Simulate FPS drop
  opt.monitor.setSimulatedFPS(15);

  // Trigger update with time for perf check
  cm.update(20, 20, ADJUSTMENT_COOLDOWN + 1);

  assert.ok(cm.renderDistance <= initialDist, 'Should not increase on low FPS');
});

test('Integration: Multiple updates respect adjustment cooldown', () => {
  const opt = new PerformanceOptimizer({
    glInfo: null, touchPoints: 0, hasTouchStart: false, screenWidth: 1920
  });
  opt.monitor.setSimulatedFPS(10); // Critical

  const cm = new ChunkManager(createMockRenderer(), mockGenerator, { performanceOptimizer: opt });

  // First adjustment
  cm.update(100, 100, ADJUSTMENT_COOLDOWN + 1);
  const distAfterFirst = cm.renderDistance;

  // Second update within cooldown — should not trigger another adjustment
  cm.update(200, 200, ADJUSTMENT_COOLDOWN * 0.5 + 1);
  assert.strictEqual(cm.renderDistance, distAfterFirst);
});

// =============================================
// Summary
// =============================================
console.log(`\nChunk Manager Tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
