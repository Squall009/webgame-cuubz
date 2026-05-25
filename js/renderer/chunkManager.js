/**
 * Cuubz — Chunk Manager
 * Load/unload chunks based on player position radius. Async building to avoid frame drops.
 * Integrates with PerformanceOptimizer for mobile-adaptive render distance and low-quality mode.
 */

class ChunkManager {
  constructor(renderer, generatorFn, options = {}) {
    this.renderer = renderer;
    this.generatorFn = generatorFn;

    // Configurable render distance (default: 6 chunks radius)
    // If performance optimizer is provided, use its recommended distance instead of hardcoded default
    if (options.performanceOptimizer) {
      this.renderDistance = options.performanceOptimizer.getRenderDistance();
    } else {
      this.renderDistance = options.renderDistance || 6;
    }

    // Loaded chunk meshes
    this.loadedChunks = new Map(); // "cx,cz" → { mesh, data }

    // Build queue for async chunk building
    this.buildQueue = [];
    this.building = false;

    // Last player position (for dirty checking)
    this.lastPlayerX = 0;
    this.lastPlayerZ = 0;

    // Performance optimizer integration
    this.performanceOptimizer = options.performanceOptimizer || null;

    // Low-quality mode: skip some face details for distant chunks
    this.lowQualityMode = options.lowQualityMode !== undefined ? options.lowQualityMode : false;

    // Callbacks
    this._onRenderDistanceChange = options.onRenderDistanceChange || null;

    // Disposed flag — prevents new work and clearTimeout leaks
    this._disposed = false;
    
    // Store setTimeout ID for cleanup on dispose
    this._buildTimeoutId = null;

    // Wire up performance optimizer callbacks if present
    if (this.performanceOptimizer) {
      const self = this;
      this.performanceOptimizer.setRenderDistance(this.renderDistance);

      // If optimizer wasn't constructed with a callback, set one now
      if (!this.performanceOptimizer._onRenderDistanceChange) {
        this.performanceOptimizer._onRenderDistanceChange = function(distance) {
          self.setRenderDistance(distance);
        };
      }
    }
  }

  /**
   * Update chunk loading based on player position.
   * Also checks performance optimizer for dynamic adjustments.
   */
  update(playerX, playerZ, currentTime) {
    // Check performance-based render distance adjustment
    if (this.performanceOptimizer && currentTime !== undefined) {
      this.performanceOptimizer.checkAndAdjust(currentTime);
      // Sync current lowQualityMode from optimizer
      this.lowQualityMode = this.performanceOptimizer.getLowQualityMode();
    }

    if (Math.abs(playerX - this.lastPlayerX) < 16 &&
        Math.abs(playerZ - this.lastPlayerZ) < 16) {
      return; // Player hasn't moved far enough to need update
    }

    this.lastPlayerX = playerX;
    this.lastPlayerZ = playerZ;

    const playerChunkX = Math.floor(playerX / 16);
    const playerChunkZ = Math.floor(playerZ / 16);

    // Determine which chunks should be loaded
    const neededChunks = new Set();

    for (let dx = -this.renderDistance; dx <= this.renderDistance; dx++) {
      for (let dz = -this.renderDistance; dz <= this.renderDistance; dz++) {
        const cx = playerChunkX + dx;
        const cz = playerChunkZ + dz;
        neededChunks.add(`${cx},${cz}`);
      }
    }

    // Unload distant chunks
    for (const [key] of this.loadedChunks) {
      if (!neededChunks.has(key)) {
        this._unloadChunk(key);
      }
    }

    // Queue new chunks for building
    for (const key of neededChunks) {
      if (!this.loadedChunks.has(key)) {
        const [cx, cz] = key.split(',').map(Number);
        this._queueBuild(cx, cz);
      }
    }
  }

  /**
   * Queue a chunk for async building
   */
  _queueBuild(cx, cz) {
    if (this._disposed) return; // Prevent new work after dispose

    this.buildQueue.push({ cx, cz });

    if (!this.building) {
      this._processQueue();
    }
  }

  /**
   * Process build queue asynchronously (one chunk per frame to avoid stutter)
   */
  _processQueue() {
    if (this._disposed) return; // Stop processing after dispose

    if (this.buildQueue.length === 0) {
      this.building = false;
      return;
    }

    this.building = true;

    // Build one chunk per frame
    const { cx, cz } = this.buildQueue.shift();
    this._buildChunk(cx, cz);

    // Continue next frame — store timeout ID for cleanup on dispose
    this._buildTimeoutId = setTimeout(() => this._processQueue(), 0);
  }

  /**
   * Build a single chunk's mesh
   */
  _buildChunk(cx, cz) {
    const key = `${cx},${cz}`;

    if (this.generatorFn) {
      const chunkData = this.generatorFn(cx, cz);

      // TODO: Use ChunkMeshBuilder to build geometry
      // const meshBuilder = new ChunkMeshBuilder();
      // const meshData = meshBuilder.buildMeshData(chunkData);
      // const geometry = meshBuilder.buildThreeGeometry(meshData);

      // For now, just track that the chunk is loaded
      this.loadedChunks.set(key, { data: chunkData, built: true });
    }
  }

  /**
   * Unload a chunk and dispose of its resources
   */
  _unloadChunk(key) {
    const entry = this.loadedChunks.get(key);

    if (entry && entry.mesh) {
      this.renderer.removeChunkMesh(entry.mesh);
    }

    this.loadedChunks.delete(key);
  }

  /**
   * Set render distance.
   * If performanceOptimizer is attached, also syncs to it.
   */
  setRenderDistance(distance) {
    const old = this.renderDistance;
    this.renderDistance = Math.max(2, Math.min(16, distance));

    if (this.performanceOptimizer) {
      this.performanceOptimizer.setRenderDistance(this.renderDistance);
    }

    if (this._onRenderDistanceChange && this.renderDistance !== old) {
      this._onRenderDistanceChange(this.renderDistance);
    }
  }

  /**
   * Get loaded chunk count
   */
  getLoadedCount() {
    return this.loadedChunks.size;
  }

  /**
   * Get performance state summary for debugging/HUD integration.
   * @returns {Object} Performance metrics or null if no optimizer attached
   */
  getPerformanceState() {
    if (!this.performanceOptimizer) return null;
    return this.performanceOptimizer.getState();
  }

  /**
   * Dispose of resources.
   */
  dispose() {
    if (this._disposed) return;
    this._disposed = true;

    // Cancel pending build timeout to prevent setTimeout leak
    if (this._buildTimeoutId !== null) {
      clearTimeout(this._buildTimeoutId);
      this._buildTimeoutId = null;
    }

    this.buildQueue = [];
    this.building = false;

    for (const [key] of this.loadedChunks) {
      this._unloadChunk(key);
    }

    if (this.performanceOptimizer) {
      this.performanceOptimizer.dispose();
      this.performanceOptimizer = null;
    }

    this._onRenderDistanceChange = null;
  }
}

module.exports = ChunkManager;
