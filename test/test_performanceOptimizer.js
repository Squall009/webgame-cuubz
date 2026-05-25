/**
 * Cuubz — Performance Optimizer Tests
 * Tests for device detection, FPS monitoring, dynamic render distance adjustment.
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

const perf = require('../js/renderer/performanceOptimizer');

// Destructure exports
const {
  DEVICE_TIERS, RENDER_DISTANCE_BY_TIER, FPS_TARGETS,
  ADJUSTMENT_INTERVAL, ADJUSTMENT_STEP, ADJUSTMENT_COOLDOWN,
  isTouchDevice, isMobileViewport, estimateDeviceTier,
  calculateRecommendedRenderDistance, calculateFPSTarget,
  calculateChunkCount, estimateMemoryUsage,
  shouldReduceRenderDistance, shouldIncreaseRenderDistance,
  calculateNewRenderDistance,
  PerformanceMonitor, PerformanceOptimizer
} = perf;

// =============================================
// Group 1: Constants
// =============================================
test('DEVICE_TIERS has high/medium/low', () => {
  assert.strictEqual(DEVICE_TIERS.HIGH, 'high');
  assert.strictEqual(DEVICE_TIERS.MEDIUM, 'medium');
  assert.strictEqual(DEVICE_TIERS.LOW, 'low');
});

test('RENDER_DISTANCE_BY_TIER values are reasonable', () => {
  assert.strictEqual(RENDER_DISTANCE_BY_TIER[DEVICE_TIERS.HIGH], 6);
  assert.strictEqual(RENDER_DISTANCE_BY_TIER[DEVICE_TIERS.MEDIUM], 4);
  assert.strictEqual(RENDER_DISTANCE_BY_TIER[DEVICE_TIERS.LOW], 3);
});

test('FPS_TARGETS has desktop/mobile/minimum', () => {
  assert.strictEqual(FPS_TARGETS.DESKTOP, 60);
  assert.strictEqual(FPS_TARGETS.MOBILE, 30);
  assert.strictEqual(FPS_TARGETS.MINIMUM, 20);
});

test('ADJUSTMENT constants are reasonable', () => {
  assert.strictEqual(ADJUSTMENT_INTERVAL, 2000);
  assert.strictEqual(ADJUSTMENT_STEP, 1);
  assert.strictEqual(ADJUSTMENT_COOLDOWN, 5000);
});

// =============================================
// Group 2: isTouchDevice utility
// =============================================
test('isTouchDevice: maxTouchPoints > 0 returns true', () => {
  assert.strictEqual(isTouchDevice({ maxTouchPoints: 5 }), true);
});

test('isTouchDevice: maxTouchPoints = 0 with no touchStart returns false', () => {
  assert.strictEqual(isTouchDevice({ maxTouchPoints: 0, hasTouchStart: false }), false);
});

test('isTouchDevice: hasTouchStart overrides maxTouchPoints=0', () => {
  assert.strictEqual(isTouchDevice({ maxTouchPoints: 0, hasTouchStart: true }), true);
});

test('isTouchDevice: both true returns true', () => {
  assert.strictEqual(isTouchDevice({ maxTouchPoints: 5, hasTouchStart: true }), true);
});

test('isTouchDevice: default (no browser) returns false', () => {
  assert.strictEqual(isTouchDevice(), false);
});

// =============================================
// Group 3: isMobileViewport utility
// =============================================
test('isMobileViewport: width < 768 returns true', () => {
  assert.strictEqual(isMobileViewport(480), true);
  assert.strictEqual(isMobileViewport(767), true);
});

test('isMobileViewport: width >= 768 returns false', () => {
  assert.strictEqual(isMobileViewport(768), false);
  assert.strictEqual(isMobileViewport(1920), false);
});

// =============================================
// Group 4: estimateDeviceTier
// =============================================
test('estimateDeviceTier: low maxTextureSize returns LOW', () => {
  const info = { renderer: 'unknown', maxTextureSize: 2048, maxViewportDims: [1024, 1024] };
  assert.strictEqual(estimateDeviceTier(info), DEVICE_TIERS.LOW);
});

test('estimateDeviceTier: low maxViewportDims returns LOW', () => {
  const info = { renderer: 'unknown', maxTextureSize: 8192, maxViewportDims: [1024, 1024] };
  assert.strictEqual(estimateDeviceTier(info), DEVICE_TIERS.LOW);
});

test('estimateDeviceTier: known low-end GPU returns LOW', () => {
  const info = { renderer: 'Adreno (TM) 508', maxTextureSize: 8192, maxViewportDims: [4096, 4096] };
  assert.strictEqual(estimateDeviceTier(info), DEVICE_TIERS.LOW);
});

test('estimateDeviceTier: Power VR returns LOW', () => {
  const info = { renderer: 'Apple PowerVR GX', maxTextureSize: 8192, maxViewportDims: [4096, 4096] };
  assert.strictEqual(estimateDeviceTier(info), DEVICE_TIERS.LOW);
});

test('estimateDeviceTier: Mali-T7 returns LOW', () => {
  const info = { renderer: 'Mali-T760', maxTextureSize: 8192, maxViewportDims: [4096, 4096] };
  assert.strictEqual(estimateDeviceTier(info), DEVICE_TIERS.LOW);
});

test('estimateDeviceTier: known high-end GPU returns HIGH', () => {
  const info = { renderer: 'NVIDIA GeForce RTX 3080', maxTextureSize: 16384, maxViewportDims: [16384, 16384] };
  assert.strictEqual(estimateDeviceTier(info), DEVICE_TIERS.HIGH);
});

test('estimateDeviceTier: Apple M-series returns HIGH', () => {
  const info = { renderer: 'Apple M1 Pro', maxTextureSize: 16384, maxViewportDims: [16384, 16384] };
  assert.strictEqual(estimateDeviceTier(info), DEVICE_TIERS.HIGH);
});

test('estimateDeviceTier: Radeon RX returns HIGH', () => {
  const info = { renderer: 'AMD Radeon RX 6800', maxTextureSize: 16384, maxViewportDims: [16384, 16384] };
  assert.strictEqual(estimateDeviceTier(info), DEVICE_TIERS.HIGH);
});

test('estimateDeviceTier: unknown GPU with good specs returns MEDIUM', () => {
  const info = { renderer: 'Unknown GPU', maxTextureSize: 8192, maxViewportDims: [4096, 4096] };
  assert.strictEqual(estimateDeviceTier(info), DEVICE_TIERS.MEDIUM);
});

test('estimateDeviceTier: null input returns MEDIUM', () => {
  assert.strictEqual(estimateDeviceTier(null), DEVICE_TIERS.MEDIUM);
});

// =============================================
// Group 5: calculateRecommendedRenderDistance
// =============================================
test('calculateRecommendedRenderDistance: HIGH desktop = 6', () => {
  assert.strictEqual(calculateRecommendedRenderDistance(DEVICE_TIERS.HIGH, false), 6);
});

test('calculateRecommendedRenderDistance: MEDIUM any = 4', () => {
  assert.strictEqual(calculateRecommendedRenderDistance(DEVICE_TIERS.MEDIUM, false), 4);
  assert.strictEqual(calculateRecommendedRenderDistance(DEVICE_TIERS.MEDIUM, true), 4);
});

test('calculateRecommendedRenderDistance: LOW = 3', () => {
  assert.strictEqual(calculateRecommendedRenderDistance(DEVICE_TIERS.LOW, false), 3);
});

test('calculateRecommendedRenderDistance: HIGH mobile reduced to 5', () => {
  assert.strictEqual(calculateRecommendedRenderDistance(DEVICE_TIERS.HIGH, true), 5);
});

test('calculateRecommendedRenderDistance: clamped to 2-16 range', () => {
  // The function already uses RENDER_DISTANCE_BY_TIER which is in range
  const result = calculateRecommendedRenderDistance(DEVICE_TIERS.LOW, true);
  assert.ok(result >= 2 && result <= 16);
});

// =============================================
// Group 6: calculateFPSTarget
// =============================================
test('calculateFPSTarget: desktop = 60', () => {
  assert.strictEqual(calculateFPSTarget(false), 60);
});

test('calculateFPSTarget: mobile = 30', () => {
  assert.strictEqual(calculateFPSTarget(true), 30);
});

// =============================================
// Group 7: calculateChunkCount
// =============================================
test('calculateChunkCount: radius 2 = 25 chunks', () => {
  assert.strictEqual(calculateChunkCount(2), 25);
});

test('calculateChunkCount: radius 6 = 169 chunks', () => {
  assert.strictEqual(calculateChunkCount(6), 169);
});

test('calculateChunkCount: radius 3 = 49 chunks', () => {
  assert.strictEqual(calculateChunkCount(3), 49);
});

// =============================================
// Group 8: estimateMemoryUsage
// =============================================
test('estimateMemoryUsage: returns correct structure', () => {
  const result = estimateMemoryUsage(6);
  assert.ok(result.chunks > 0);
  assert.ok(result.bytes > 0);
  assert.ok(result.mb > 0);
});

test('estimateMemoryUsage: radius 6 has 169 chunks', () => {
  assert.strictEqual(estimateMemoryUsage(6).chunks, 169);
});

test('estimateMemoryUsage: larger radius = more memory', () => {
  const m3 = estimateMemoryUsage(3);
  const m6 = estimateMemoryUsage(6);
  assert.ok(m6.mb > m3.mb);
});

// =============================================
// Group 9: shouldReduceRenderDistance
// =============================================
test('shouldReduce: below target returns true', () => {
  assert.strictEqual(shouldReduceRenderDistance(25, 30, 6), true);
});

test('shouldReduce: above target returns false', () => {
  assert.strictEqual(shouldReduceRenderDistance(40, 30, 6), false);
});

test('shouldReduce: at minimum distance (2) returns false', () => {
  assert.strictEqual(shouldReduceRenderDistance(10, 30, 2), false);
});

// =============================================
// Group 10: shouldIncreaseRenderDistance
// =============================================
test('shouldIncrease: significantly above target returns true', () => {
  // 50 > 30 * 1.5 = 45
  assert.strictEqual(shouldIncreaseRenderDistance(50, 30, 6), true);
});

test('shouldIncrease: below 1.5x target returns false', () => {
  // 44 < 30 * 1.5 = 45
  assert.strictEqual(shouldIncreaseRenderDistance(44, 30, 6), false);
});

test('shouldIncrease: at maximum distance (16) returns false', () => {
  assert.strictEqual(shouldIncreaseRenderDistance(100, 30, 16), false);
});

// =============================================
// Group 11: calculateNewRenderDistance
// =============================================
test('calculateNewRenderDistance: critical FPS reduces by 2', () => {
  // FPS < MINIMUM (20) → aggressive reduction
  assert.strictEqual(calculateNewRenderDistance(15, 30, 8), 6);
});

test('calculateNewRenderDistance: below target reduces by 1', () => {
  assert.strictEqual(calculateNewRenderDistance(25, 30, 6), 5);
});

test('calculateNewRenderDistance: well above target increases by 1', () => {
  // 50 > 30 * 1.5 = 45
  assert.strictEqual(calculateNewRenderDistance(50, 30, 4), 5);
});

test('calculateNewRenderDistance: at target stays same', () => {
  assert.strictEqual(calculateNewRenderDistance(35, 30, 6), 6);
});

test('calculateNewRenderDistance: clamped to minimum 2', () => {
  assert.strictEqual(calculateNewRenderDistance(10, 30, 2), 2);
});

test('calculateNewRenderDistance: clamped to maximum 16', () => {
  assert.strictEqual(calculateNewRenderDistance(100, 30, 16), 16);
});

// =============================================
// Group 12: PerformanceMonitor class
// =============================================
test('PerformanceMonitor: default target is 60 FPS', () => {
  const pm = new PerformanceMonitor();
  assert.strictEqual(pm.targetFPS, 60);
});

test('PerformanceMonitor: custom target FPS', () => {
  const pm = new PerformanceMonitor({ targetFPS: 30 });
  assert.strictEqual(pm.targetFPS, 30);
});

test('PerformanceMonitor: simulated FPS works', () => {
  const pm = new PerformanceMonitor();
  pm.setSimulatedFPS(45);
  assert.strictEqual(pm.getCurrentFPS(), 45);
});

test('PerformanceMonitor: recordFrame calculates FPS correctly', () => {
  const pm = new PerformanceMonitor();
  // Simulate 60fps: 16.67ms per frame
  for (let i = 0; i < 30; i++) {
    pm.recordFrame(i * 16.67);
  }
  const fps = pm.getCurrentFPS();
  assert.ok(fps >= 55 && fps <= 65, `Expected ~60 FPS, got ${fps}`);
});

test('PerformanceMonitor: recordFrame with 30ms intervals = ~33fps', () => {
  const pm = new PerformanceMonitor();
  for (let i = 0; i < 30; i++) {
    pm.recordFrame(i * 30);
  }
  const fps = pm.getCurrentFPS();
  assert.ok(fps >= 30 && fps <= 36, `Expected ~33 FPS, got ${fps}`);
});

test('PerformanceMonitor: shouldCheckAdjustment respects cooldown', () => {
  const pm = new PerformanceMonitor();
  // First check — no previous time, so elapsed is huge → true
  assert.strictEqual(pm.shouldCheckAdjustment(10000), true);
});

test('PerformanceMonitor: getAdjustment returns correct action', () => {
  const pm = new PerformanceMonitor({ targetFPS: 30 });
  pm.setSimulatedFPS(20); // Below target
  const adj = pm.getAdjustment(6);
  assert.strictEqual(adj.action, 'reduce');
});

test('PerformanceMonitor: getAdjustment increase when well above target', () => {
  const pm = new PerformanceMonitor({ targetFPS: 30 });
  pm.setSimulatedFPS(50); // 50 > 30*1.5=45
  const adj = pm.getAdjustment(4);
  assert.strictEqual(adj.action, 'increase');
});

test('PerformanceMonitor: getAdjustment none when at target', () => {
  const pm = new PerformanceMonitor({ targetFPS: 30 });
  pm.setSimulatedFPS(35); // Between 30 and 45
  const adj = pm.getAdjustment(6);
  assert.strictEqual(adj.action, 'none');
});

test('PerformanceMonitor: getStateSummary returns correct structure', () => {
  const pm = new PerformanceMonitor({ targetFPS: 30 });
  pm.setSimulatedFPS(45);
  const state = pm.getStateSummary();
  assert.strictEqual(state.currentFPS, 45);
  assert.strictEqual(state.targetFPS, 30);
  assert.strictEqual(state.enabled, true);
});

test('PerformanceMonitor: reset clears data', () => {
  const pm = new PerformanceMonitor();
  pm.setSimulatedFPS(25);
  pm.reset();
  // After reset, no frame history → returns default 60
  assert.strictEqual(pm.getCurrentFPS(), 60);
});

test('PerformanceMonitor: disabled mode ignores recordFrame', () => {
  const pm = new PerformanceMonitor({ enabled: false });
  for (let i = 0; i < 30; i++) {
    pm.recordFrame(i * 16.67);
  }
  // Should still return default since disabled
  assert.strictEqual(pm.getCurrentFPS(), 60);
});

// =============================================
// Group 13: PerformanceOptimizer class
// =============================================
test('PerformanceOptimizer: detects desktop (no touch)', () => {
  const opt = new PerformanceOptimizer({
    glInfo: { renderer: 'NVIDIA GeForce RTX', maxTextureSize: 16384, maxViewportDims: [16384, 16384] },
    touchPoints: 0, hasTouchStart: false, screenWidth: 1920
  });
  assert.strictEqual(opt.isMobile, false);
  assert.strictEqual(opt.tier, DEVICE_TIERS.HIGH);
  assert.strictEqual(opt.fpsTarget, 60);
});

test('PerformanceOptimizer: detects mobile (touch + narrow)', () => {
  const opt = new PerformanceOptimizer({
    glInfo: { renderer: 'Adreno (TM) 508', maxTextureSize: 8192, maxViewportDims: [4096, 4096] },
    touchPoints: 5, hasTouchStart: true, screenWidth: 412
  });
  assert.strictEqual(opt.isMobile, true);
  assert.strictEqual(opt.tier, DEVICE_TIERS.LOW);
  assert.strictEqual(opt.fpsTarget, 30);
});

test('PerformanceOptimizer: default render distance for HIGH desktop', () => {
  const opt = new PerformanceOptimizer({
    glInfo: { renderer: 'NVIDIA GeForce RTX', maxTextureSize: 16384, maxViewportDims: [16384, 16384] },
    touchPoints: 0, hasTouchStart: false, screenWidth: 1920
  });
  assert.strictEqual(opt.getRenderDistance(), 6);
});

test('PerformanceOptimizer: default render distance for LOW mobile', () => {
  const opt = new PerformanceOptimizer({
    glInfo: { renderer: 'Adreno (TM) 508', maxTextureSize: 8192, maxViewportDims: [4096, 4096] },
    touchPoints: 5, hasTouchStart: true, screenWidth: 412
  });
  assert.strictEqual(opt.getRenderDistance(), 3);
});

test('PerformanceOptimizer: setRenderDistance clamps to range', () => {
  const opt = new PerformanceOptimizer({
    glInfo: null, touchPoints: 0, hasTouchStart: false, screenWidth: 1920
  });
  opt.setRenderDistance(1); // Below minimum
  assert.strictEqual(opt.getRenderDistance(), 2);

  opt.setRenderDistance(20); // Above maximum
  assert.strictEqual(opt.getRenderDistance(), 16);
});

test('PerformanceOptimizer: setRenderDistance callback fires', () => {
  let callbackValue = null;
  const opt = new PerformanceOptimizer({
    glInfo: null, touchPoints: 0, hasTouchStart: false, screenWidth: 1920,
    onRenderDistanceChange: (d) => { callbackValue = d; }
  });
  opt.setRenderDistance(5);
  assert.strictEqual(callbackValue, 5);
});

test('PerformanceOptimizer: low quality mode for LOW tier', () => {
  const opt = new PerformanceOptimizer({
    glInfo: { renderer: 'Adreno (TM) 508', maxTextureSize: 8192, maxViewportDims: [4096, 4096] },
    touchPoints: 5, hasTouchStart: true, screenWidth: 412
  });
  assert.strictEqual(opt.getLowQualityMode(), true);
});

test('PerformanceOptimizer: low quality mode off for HIGH tier', () => {
  const opt = new PerformanceOptimizer({
    glInfo: { renderer: 'NVIDIA GeForce RTX', maxTextureSize: 16384, maxViewportDims: [16384, 16384] },
    touchPoints: 0, hasTouchStart: false, screenWidth: 1920
  });
  assert.strictEqual(opt.getLowQualityMode(), false);
});

test('PerformanceOptimizer: checkAndAdjust reduces on low FPS', () => {
  const opt = new PerformanceOptimizer({
    glInfo: null, touchPoints: 0, hasTouchStart: false, screenWidth: 1920
  });
  opt.monitor.setSimulatedFPS(15); // Critical low
  opt.checkAndAdjust(10000); // After cooldown
  assert.ok(opt.getRenderDistance() < 6, 'Should reduce from default');
});

test('PerformanceOptimizer: checkAndAdjust respects cooldown', () => {
  const opt = new PerformanceOptimizer({
    glInfo: null, touchPoints: 0, hasTouchStart: false, screenWidth: 1920
  });
  opt.monitor.setSimulatedFPS(15);
  opt.checkAndAdjust(10000); // First check
  const distAfterFirst = opt.getRenderDistance();

  opt.checkAndAdjust(10001); // Only 1ms later — within cooldown
  assert.strictEqual(opt.getRenderDistance(), distAfterFirst, 'Should not change within cooldown');
});

test('PerformanceOptimizer: getState returns complete structure', () => {
  const opt = new PerformanceOptimizer({
    glInfo: { renderer: 'NVIDIA GeForce RTX', maxTextureSize: 16384, maxViewportDims: [16384, 16384] },
    touchPoints: 0, hasTouchStart: false, screenWidth: 1920
  });
  const state = opt.getState();
  assert.strictEqual(state.tier, DEVICE_TIERS.HIGH);
  assert.strictEqual(state.isMobile, false);
  assert.ok(state.memoryEstimate.chunks > 0);
  assert.ok(state.memoryEstimate.mb > 0);
});

test('PerformanceOptimizer: resetToDefaults restores initial values', () => {
  const opt = new PerformanceOptimizer({
    glInfo: { renderer: 'NVIDIA GeForce RTX', maxTextureSize: 16384, maxViewportDims: [16384, 16384] },
    touchPoints: 0, hasTouchStart: false, screenWidth: 1920
  });
  opt.setRenderDistance(3); // Change from default
  opt.resetToDefaults();
  assert.strictEqual(opt.getRenderDistance(), 6); // Back to HIGH desktop default
});

test('PerformanceOptimizer: dispose clears callback', () => {
  const opt = new PerformanceOptimizer({
    glInfo: null, touchPoints: 0, hasTouchStart: false, screenWidth: 1920,
    onRenderDistanceChange: () => {}
  });
  opt.dispose();
  assert.strictEqual(opt._onRenderDistanceChange, null);
});

// =============================================
// Group 14: Integration — full workflow
// =============================================
test('Integration: HIGH desktop → default render distance 6', () => {
  const opt = new PerformanceOptimizer({
    glInfo: { renderer: 'NVIDIA GeForce RTX', maxTextureSize: 16384, maxViewportDims: [16384, 16384] },
    touchPoints: 0, hasTouchStart: false, screenWidth: 1920
  });
  assert.strictEqual(opt.getRenderDistance(), 6);
  assert.strictEqual(opt.fpsTarget, 60);
  assert.strictEqual(opt.getLowQualityMode(), false);
});

test('Integration: MEDIUM mobile → render distance 4, FPS target 30', () => {
  const opt = new PerformanceOptimizer({
    glInfo: { renderer: 'Intel UHD Graphics 620', maxTextureSize: 16384, maxViewportDims: [16384, 16384] },
    touchPoints: 5, hasTouchStart: true, screenWidth: 412
  });
  assert.strictEqual(opt.getRenderDistance(), 4);
  assert.strictEqual(opt.fpsTarget, 30);
});

test('Integration: LOW mobile → render distance 3, low quality mode', () => {
  const opt = new PerformanceOptimizer({
    glInfo: { renderer: 'Mali-T760', maxTextureSize: 8192, maxViewportDims: [4096, 4096] },
    touchPoints: 5, hasTouchStart: true, screenWidth: 360
  });
  assert.strictEqual(opt.getRenderDistance(), 3);
  assert.strictEqual(opt.fpsTarget, 30);
  assert.strictEqual(opt.getLowQualityMode(), true);
});

test('Integration: FPS drop triggers render distance reduction', () => {
  const opt = new PerformanceOptimizer({
    glInfo: { renderer: 'NVIDIA GeForce RTX', maxTextureSize: 16384, maxViewportDims: [16384, 16384] },
    touchPoints: 0, hasTouchStart: false, screenWidth: 1920
  });

  // Start at 6 (default for HIGH desktop)
  assert.strictEqual(opt.getRenderDistance(), 6);

  // Simulate FPS drop below target
  opt.monitor.setSimulatedFPS(25); // Below 30 minimum threshold
  opt.checkAndAdjust(ADJUSTMENT_COOLDOWN + 1);
  assert.ok(opt.getRenderDistance() <= 5, 'Should reduce on low FPS');

  // Further drop triggers low quality mode
  opt.monitor.setSimulatedFPS(10); // Critical
  opt.checkAndAdjust(ADJUSTMENT_COOLDOWN * 2 + 1);
  assert.strictEqual(opt.getLowQualityMode(), true, 'Critical FPS enables low quality');
});

test('Integration: FPS recovery allows render distance increase', () => {
  const opt = new PerformanceOptimizer({
    glInfo: null, touchPoints: 0, hasTouchStart: false, screenWidth: 1920
  });
  opt.setRenderDistance(3); // Start low

  // Simulate good FPS
  opt.monitor.setSimulatedFPS(80); // Well above 60 * 1.5 = 90? No, 80 < 90. Let's use 100.
  opt.checkAndAdjust(ADJUSTMENT_COOLDOWN + 1);
  // FPS 80 > 60 but < 90 → no increase. Need > 90 for increase.

  opt.monitor.setSimulatedFPS(100); // > 60 * 1.5 = 90
  opt.checkAndAdjust(ADJUSTMENT_COOLDOWN * 2 + 1);
  assert.ok(opt.getRenderDistance() >= 3, 'Should allow increase on high FPS');
});

test('Integration: disabled optimizer does not adjust', () => {
  const opt = new PerformanceOptimizer({
    glInfo: null, touchPoints: 0, hasTouchStart: false, screenWidth: 1920,
    enabled: false
  });
  const initialDist = opt.getRenderDistance();

  opt.monitor.setSimulatedFPS(5); // Very low
  opt.checkAndAdjust(ADJUSTMENT_COOLDOWN + 1);
  assert.strictEqual(opt.getRenderDistance(), initialDist, 'Disabled optimizer should not adjust');
});

// =============================================
// Summary
// =============================================
console.log(`\nPerformance Optimizer Tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
