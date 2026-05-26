/**
 * Cuubz — Performance Optimizer
 * Device capability detection, FPS monitoring, dynamic render distance adjustment.
 * Ensures minimum 30fps target by adapting to device capabilities.
 */

// --- Constants ---

const DEVICE_TIERS = {
  HIGH: 'high',      // Desktop / modern mobile — full features
  MEDIUM: 'medium',  // Mid-range mobile — reduced render distance
  LOW: 'low'         // Low-end device — minimal geometry, lowest render distance
};

const RENDER_DISTANCE_BY_TIER = {
  [DEVICE_TIERS.HIGH]: 6,   // Default 6-chunk radius
  [DEVICE_TIERS.MEDIUM]: 4, // Reduced for mid-range
  [DEVICE_TIERS.LOW]: 3     // Minimal for low-end
};

const FPS_TARGETS = {
  DESKTOP: 60,
  MOBILE: 30,
  MINIMUM: 20 // Absolute floor — if below this, aggressive reduction
};

const ADJUSTMENT_INTERVAL = 2000; // Check FPS every 2 seconds
const ADJUSTMENT_STEP = 1;        // Render distance change per adjustment
const ADJUSTMENT_COOLDOWN = 5000; // Minimum time between adjustments

// --- Pure Utility Functions (testable without browser) ---

/**
 * Detect if running on a touch device.
 * @param {Object} options - Optional overrides for testing
 * @returns {boolean}
 */
function isTouchDevice(options = {}) {
  const maxTouchPoints = options.maxTouchPoints !== undefined
    ? options.maxTouchPoints
    : (typeof navigator !== 'undefined' ? navigator.maxTouchPoints : 0);
  const hasTouchStart = options.hasTouchStart !== undefined
    ? options.hasTouchStart
    : (typeof window !== 'undefined' ? 'ontouchstart' in window : false);

  return maxTouchPoints > 0 || hasTouchStart;
}

/**
 * Detect if running on a mobile viewport.
 * @param {number} screenWidth - Screen width for testing overrides
 * @returns {boolean}
 */
function isMobileViewport(screenWidth) {
  const width = screenWidth !== undefined ? screenWidth : (typeof window !== 'undefined' ? window.innerWidth : 1920);
  return width < 768;
}

/**
 * Estimate device GPU tier from WebGL renderer info.
 * @param {Object} glInfo - Simulated WebGL context info for testing
 *   { renderer: string, maxTextureSize: number, maxViewportDims: number }
 * @returns {string} DEVICE_TIERS.HIGH | MEDIUM | LOW
 */
function estimateDeviceTier(glInfo) {
  if (!glInfo) {
    // Try to get real WebGL info
    if (typeof document !== 'undefined' && typeof THREE !== 'undefined') {
      try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (gl) {
          const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
          if (debugInfo) {
            glInfo = {
              renderer: gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL),
              maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
              maxViewportDims: gl.getParameter(gl.MAX_VIEWPORT_DIMS)[0]
            };
          }
        }
      } catch (e) {
        // WebGL not available — default to medium
        return DEVICE_TIERS.MEDIUM;
      }
    }
    // No WebGL info available at all
    return DEVICE_TIERS.MEDIUM;
  }

  const renderer = glInfo.renderer.toLowerCase();
  const maxTextureSize = glInfo.maxTextureSize || 0;
  const maxViewportDims = glInfo.maxViewportDims || 0;

  // Low-end indicators
  if (maxTextureSize < 4096 || maxViewportDims[0] < 2048) {
    return DEVICE_TIERS.LOW;
  }

  // Known low-end GPU patterns
  const lowEndPatterns = [
    'adreno (tm) 3', 'adreno (tm) 4', 'adreno (tm) 5',
    'powervr', 'power vr', 'mali-t7', 'mali-t8', 'mali-g51', 'mali-g52',
    'intel hd graphics 4', 'intel hd graphics 5',
    'vivo', 'mtk-', 'mediatek'
  ];

  for (const pattern of lowEndPatterns) {
    if (renderer.includes(pattern)) {
      return DEVICE_TIERS.LOW;
    }
  }

  // Known high-end GPU patterns
  const highEndPatterns = [
    'geforce', 'radeon rx', 'radeon pro', 'nvidia',
    'adreno (tm) 6', 'adreno (tm) 7',
    'apple m', 'apple a1',
    'mali-g7', 'mali-g78'
  ];

  for (const pattern of highEndPatterns) {
    if (renderer.includes(pattern)) {
      return DEVICE_TIERS.HIGH;
    }
  }

  // Default: assume medium capability
  return DEVICE_TIERS.MEDIUM;
}

/**
 * Calculate recommended render distance based on device tier and mobile status.
 * @param {string} tier - DEVICE_TIERS value
 * @param {boolean} isMobile
 * @returns {number} Render distance in chunks (radius)
 */
function calculateRecommendedRenderDistance(tier, isMobile) {
  let distance = RENDER_DISTANCE_BY_TIER[tier] || RENDER_DISTANCE_BY_TIER[DEVICE_TIERS.MEDIUM];

  if (isMobile && tier === DEVICE_TIERS.HIGH) {
    // Even high-end mobile gets slightly reduced distance
    distance = Math.max(RENDER_DISTANCE_BY_TIER[DEVICE_TIERS.MEDIUM], distance - 1);
  }

  return Math.max(2, Math.min(16, distance));
}

/**
 * Calculate FPS target based on device type.
 * @param {boolean} isMobile
 * @returns {number} Target FPS
 */
function calculateFPSTarget(isMobile) {
  return isMobile ? FPS_TARGETS.MOBILE : FPS_TARGETS.DESKTOP;
}

/**
 * Calculate the number of chunks in a render radius (for estimation).
 * @param {number} radius - Render distance in chunks
 * @returns {number} Total chunks in the spherical-ish area
 */
function calculateChunkCount(radius) {
  // Approximate: sphere surface within radius
  // Actual is a diamond shape on XZ plane times Y layers
  return (2 * radius + 1) ** 2;
}

/**
 * Estimate memory usage for chunks at given render distance.
 * Each chunk ~16×16×96 blocks, with mesh data overhead.
 * @param {number} radius - Render distance
 * @returns {Object} Estimated memory: { chunks: number, bytes: number, mb: number }
 */
function estimateMemoryUsage(radius) {
  const chunkCount = calculateChunkCount(radius);
  // Block array: 16*16*96 * 2 bytes (Uint16) ≈ 49KB per chunk
  // Mesh geometry: ~50-200KB depending on terrain complexity
  // Total per chunk estimate: ~250KB average
  const bytesPerChunk = 256 * 1024;
  const totalBytes = chunkCount * bytesPerChunk;

  return {
    chunks: chunkCount,
    bytes: totalBytes,
    mb: Math.round(totalBytes / (1024 * 1024) * 100) / 100
  };
}

/**
 * Determine if current FPS warrants reducing render distance.
 * @param {number} currentFPS - Current measured FPS
 * @param {number} targetFPS - Target FPS threshold
 * @param {number} currentRenderDistance - Current render distance
 * @returns {boolean} true if should reduce
 */
function shouldReduceRenderDistance(currentFPS, targetFPS, currentRenderDistance) {
  if (currentRenderDistance <= 2) return false; // Already at minimum
  return currentFPS < targetFPS;
}

/**
 * Determine if current FPS allows increasing render distance.
 * @param {number} currentFPS - Current measured FPS
 * @param {number} targetFPS - Target FPS threshold
 * @param {number} currentRenderDistance - Current render distance
 * @returns {boolean} true if should increase
 */
function shouldIncreaseRenderDistance(currentFPS, targetFPS, currentRenderDistance) {
  if (currentRenderDistance >= 16) return false; // Already at maximum
  // Only increase if significantly above target (headroom check)
  return currentFPS > targetFPS * 1.5;
}

/**
 * Calculate the new render distance after an adjustment step.
 * @param {number} fps - Current FPS
 * @param {number} targetFPS - Target FPS
 * @param {number} currentDistance - Current render distance
 * @returns {number} New render distance (may be same as current)
 */
function calculateNewRenderDistance(fps, targetFPS, currentDistance) {
  if (fps < FPS_TARGETS.MINIMUM) {
    // Aggressive reduction when critically low
    return Math.max(2, currentDistance - ADJUSTMENT_STEP * 2);
  } else if (shouldReduceRenderDistance(fps, targetFPS, currentDistance)) {
    return Math.max(2, currentDistance - ADJUSTMENT_STEP);
  } else if (shouldIncreaseRenderDistance(fps, targetFPS, currentDistance)) {
    return Math.min(16, currentDistance + ADJUSTMENT_STEP);
  }
  return currentDistance; // No change needed
}

// --- PerformanceMonitor Class ---

/**
 * Monitors FPS and provides adjustment recommendations.
 * Works in both browser and Node.js (simulation mode).
 */
class PerformanceMonitor {
  constructor(options = {}) {
    this.targetFPS = options.targetFPS || FPS_TARGETS.DESKTOP;
    this.minFPS = options.minFPS || FPS_TARGETS.MINIMUM;

    // FPS tracking
    this._frameTimes = [];
    this._maxFrameHistory = 120; // ~2 seconds at 60fps
    this._lastFrameTime = 0;
    this._currentFPS = 60; // Default optimistic value

    // Adjustment state
    this._lastAdjustmentTime = 0;
    this._enabled = options.enabled !== false;
  }

  /**
   * Record a frame timestamp for FPS calculation.
   * Call once per render frame.
   * @param {number} timestamp - Performance.now() value or simulation time
   */
  recordFrame(timestamp) {
    if (!this._enabled) return;

    if (this._lastFrameTime > 0) {
      const delta = timestamp - this._lastFrameTime;
      if (delta > 0 && delta < 1000) { // Sanity check: frame time < 1s
        this._frameTimes.push(delta);
        if (this._frameTimes.length > this._maxFrameHistory) {
          this._frameTimes.shift();
        }
      }
    }

    this._lastFrameTime = timestamp;
  }

  /**
   * Get current FPS estimate from recent frame times.
   * @returns {number} Current FPS (0 if no frames recorded)
   */
  getCurrentFPS() {
    if (this._frameTimes.length < 2) return this._currentFPS;

    // Average frame time → FPS
    const avgFrameTime = this._frameTimes.reduce((a, b) => a + b, 0) / this._frameTimes.length;
    this._currentFPS = Math.round(1000 / avgFrameTime);
    return this._currentFPS;
  }

  /**
   * Simulate FPS for testing (Node.js mode).
   * @param {number} fps - Simulated FPS value
   */
  setSimulatedFPS(fps) {
    this._currentFPS = fps;
    // Fill frame times to match simulated FPS
    const frameTime = 1000 / fps;
    this._frameTimes = [];
    for (let i = 0; i < 60; i++) {
      this._frameTimes.push(frameTime);
    }
  }

  /**
   * Check if render distance adjustment is due.
   * @param {number} currentTime - Current timestamp in ms
   * @returns {boolean} true if cooldown has expired
   */
  shouldCheckAdjustment(currentTime) {
    const elapsed = currentTime - this._lastAdjustmentTime;
    return elapsed >= ADJUSTMENT_COOLDOWN;
  }

  /**
   * Get render distance adjustment recommendation.
   * @param {number} currentRenderDistance - Current render distance
   * @returns {Object} { action: 'reduce' | 'increase' | 'none', newDistance: number, fps: number }
   */
  getAdjustment(currentRenderDistance) {
    const fps = this.getCurrentFPS();
    const newDistance = calculateNewRenderDistance(fps, this.targetFPS, currentRenderDistance);

    let action = 'none';
    if (newDistance < currentRenderDistance) {
      action = 'reduce';
    } else if (newDistance > currentRenderDistance) {
      action = 'increase';
    }

    return { action, newDistance, fps };
  }

  /**
   * Get performance state summary for debugging/HUD.
   * @returns {Object} Current performance metrics
   */
  getStateSummary() {
    const fps = this.getCurrentFPS();
    return {
      currentFPS: fps,
      targetFPS: this.targetFPS,
      frameHistoryLength: this._frameTimes.length,
      enabled: this._enabled
    };
  }

  /**
   * Reset all tracking data.
   */
  reset() {
    this._frameTimes = [];
    this._lastFrameTime = 0;
    this._currentFPS = 60;
    this._lastAdjustmentTime = 0;
  }
}

// --- PerformanceOptimizer Class ---

/**
 * Main performance optimization controller.
 * Combines device detection, FPS monitoring, and dynamic adjustment.
 */
class PerformanceOptimizer {
  constructor(options = {}) {
    // Device detection (can be overridden for testing)
    this._glInfo = options.glInfo || null;
    this._touchPoints = options.touchPoints !== undefined ? options.touchPoints : null;
    this._hasTouchStart = options.hasTouchStart !== undefined ? options.hasTouchStart : null;
    this._screenWidth = options.screenWidth !== undefined ? options.screenWidth : null;

    // Detect device capabilities
    this._detectDevice();

    // Performance monitoring
    this.monitor = new PerformanceMonitor({
      targetFPS: this.fpsTarget,
      enabled: options.enabled !== false
    });

    // Render distance control
    this._renderDistance = calculateRecommendedRenderDistance(this.tier, this.isMobile);
    this._lowQualityMode = this.tier === DEVICE_TIERS.LOW;
    this._onRenderDistanceChange = options.onRenderDistanceChange || null;

    // Adjustment tracking
    this._lastCheckTime = 0;
    this._initialDistanceSet = false;
  }

  /**
   * Detect device capabilities (mobile, tier, FPS target).
   */
  _detectDevice() {
    const touchOptions = {};
    if (this._touchPoints !== null) touchOptions.maxTouchPoints = this._touchPoints;
    if (this._hasTouchStart !== null) touchOptions.hasTouchStart = this._hasTouchStart;

    this.isTouchDevice = isTouchDevice(touchOptions);
    this.isMobile = isMobileViewport(this._screenWidth) || this.isTouchDevice;
    this.tier = estimateDeviceTier(this._glInfo);
    this.fpsTarget = calculateFPSTarget(this.isMobile);
  }

  /**
   * Get current recommended render distance.
   * @returns {number}
   */
  getRenderDistance() {
    return this._renderDistance;
  }

  /**
   * Set render distance manually (e.g., from user settings).
   * @param {number} distance
   */
  setRenderDistance(distance) {
    const old = this._renderDistance;
    this._renderDistance = Math.max(2, Math.min(16, distance));

    if (this._renderDistance !== old && this._onRenderDistanceChange) {
      this._onRenderDistanceChange(this._renderDistance);
    }
  }

  /**
   * Get whether low-quality geometry mode is enabled.
   * @returns {boolean}
   */
  getLowQualityMode() {
    return this._lowQualityMode;
  }

  /**
   * Set low-quality mode manually.
   * @param {boolean} enabled
   */
  setLowQualityMode(enabled) {
    this._lowQualityMode = !!enabled;
  }

  /**
   * Check and adjust render distance based on current FPS.
   * Call periodically (e.g., every frame or via setInterval).
   * @param {number} currentTime - Current timestamp in ms
   */
  checkAndAdjust(currentTime) {
    if (!this.monitor._enabled) return;

    if (!this.monitor.shouldCheckAdjustment(currentTime)) return;

    const adjustment = this.monitor.getAdjustment(this._renderDistance);

    if (adjustment.action !== 'none') {
      this._lastCheckTime = currentTime;
      const old = this._renderDistance;
      this._renderDistance = adjustment.newDistance;

      // Auto-enable low quality on sustained low FPS
      if (adjustment.fps < FPS_TARGETS.MINIMUM) {
        this._lowQualityMode = true;
      } else if (adjustment.fps > this.fpsTarget * 2) {
        // Re-enable quality if performance is good
        this._lowQualityMode = this.tier === DEVICE_TIERS.LOW;
      }

      if (this._renderDistance !== old && this._onRenderDistanceChange) {
        this._onRenderDistanceChange(this._renderDistance);
      }
    }
  }

  /**
   * Get full performance state for debugging/HUD.
   * @returns {Object}
   */
  getState() {
    return {
      tier: this.tier,
      isMobile: this.isMobile,
      isTouchDevice: this.isTouchDevice,
      fpsTarget: this.fpsTarget,
      renderDistance: this._renderDistance,
      lowQualityMode: this._lowQualityMode,
      monitor: this.monitor.getStateSummary(),
      memoryEstimate: estimateMemoryUsage(this._renderDistance)
    };
  }

  /**
   * Reset to default settings based on device detection.
   */
  resetToDefaults() {
    const distance = calculateRecommendedRenderDistance(this.tier, this.isMobile);
    this._renderDistance = distance;
    this._lowQualityMode = this.tier === DEVICE_TIERS.LOW;
    this.monitor.reset();

    if (this._onRenderDistanceChange) {
      this._onRenderDistanceChange(this._renderDistance);
    }
  }

  /**
   * Dispose of resources.
   */
  dispose() {
    this._onRenderDistanceChange = null;
    this.monitor.reset();
  }
}

// --- Module Exports ---

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    // Constants
    DEVICE_TIERS,
    RENDER_DISTANCE_BY_TIER,
    FPS_TARGETS,
    ADJUSTMENT_INTERVAL,
    ADJUSTMENT_STEP,
    ADJUSTMENT_COOLDOWN,

    // Pure utility functions
    isTouchDevice,
    isMobileViewport,
    estimateDeviceTier,
    calculateRecommendedRenderDistance,
    calculateFPSTarget,
    calculateChunkCount,
    estimateMemoryUsage,
    shouldReduceRenderDistance,
    shouldIncreaseRenderDistance,
    calculateNewRenderDistance,

    // Classes
    PerformanceMonitor,
    PerformanceOptimizer
  };

}