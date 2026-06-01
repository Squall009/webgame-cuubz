/**
 * Cuubz — Chunk Manager
 * Load/unload chunks based on player position radius. Async building to avoid frame drops.
 * Integrates with PerformanceOptimizer for mobile-adaptive render distance and low-quality mode.
 * Uses TextureAtlas for proper block textures.
 */

class ChunkManager {
  constructor(renderer, generatorFn, options = {}) {
    this.renderer = renderer;
    this.generatorFn = generatorFn;
    this.textureAtlas = options.textureAtlas || null;
    this.persistence = options.persistence || null; // PersistenceManager for localStorage

    // Cave generation seed (for consistent cave placement across sessions)
    this._caveSeed = options.caveSeed || 42;

    // Configurable render distance (default: 6 chunks radius)
    if (options.performanceOptimizer) {
      this.renderDistance = options.performanceOptimizer.getRenderDistance();
    } else {
      this.renderDistance = options.renderDistance || 4;
    }

    // Loaded chunk meshes
    this.loadedChunks = new Map(); // "cx,cz" → { mesh, data, dirty }

    // Build queue for async chunk building
    this.buildQueue = [];
    this.building = false;

    // Force initial chunk load on startup (start far away so first update triggers)
    this.lastPlayerX = -32;
    this.lastPlayerZ = -32;

    // World ID for persistence lookups
    this.worldId = options.worldId || null;

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

      if (!this.performanceOptimizer._onRenderDistanceChange) {
        this.performanceOptimizer._onRenderDistanceChange = function(distance) {
          self.setRenderDistance(distance);
        };
      }
    }
  }

  /**
   * Update chunk loading based on player position.
   */
  update(playerX, playerZ, currentTime) {
    // Check performance-based render distance adjustment
    if (this.performanceOptimizer && currentTime !== undefined) {
      this.performanceOptimizer.checkAndAdjust(currentTime);
      this.lowQualityMode = this.performanceOptimizer.getLowQualityMode();
    }

    // Only rebuild when player crosses chunk boundary
    const playerChunkX = Math.floor(playerX / 16);
    const playerChunkZ = Math.floor(playerZ / 16);
    const lastChunkX = Math.floor(this.lastPlayerX / 16);
    const lastChunkZ = Math.floor(this.lastPlayerZ / 16);

    if (playerChunkX === lastChunkX && playerChunkZ === lastChunkZ) {
      return; // Still in same chunk — no update needed
    }

    this.lastPlayerX = playerX;
    this.lastPlayerZ = playerZ;

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
    if (this._disposed) return;

    this.buildQueue.push({ cx, cz });

    if (!this.building) {
      this._processQueue();
    }
  }

  /**
   * Process build queue asynchronously (one chunk per frame to avoid stutter)
   */
  _processQueue() {
    if (this._disposed) return;

    if (this.buildQueue.length === 0) {
      this.building = false;
      return;
    }

    this.building = true;

    // Batch build up to 3 chunks per frame to reduce stutter
    const batchSize = Math.min(3, this.buildQueue.length);
    for (let i = 0; i < batchSize; i++) {
      const { cx, cz } = this.buildQueue.shift();
      this._buildChunk(cx, cz);
    }

    // Continue next frame — store timeout ID for cleanup on dispose
    this._buildTimeoutId = setTimeout(() => this._processQueue(), 16);
  }

  /**
   * Build a single chunk's mesh with texture atlas support.
   * Checks localStorage for saved data first, falls back to generator.
   */
  _buildChunk(cx, cz) {
    const key = `${cx},${cz}`;

    let chunkData = null;
    let fromStorage = false;

    // Try loading from localStorage first
    if (this.persistence && this.worldId) {
      try {
        chunkData = this.persistence.loadChunkSync(this.worldId, cx, cz);
        if (chunkData) {
          fromStorage = true;
          _log(`[ChunkManager] Loaded chunk ${key} from localStorage`);
        }
      } catch (e) {
        console.warn(`[ChunkManager] Failed to load chunk ${key} from storage:`, e.message);
      }
    }

    // Check loaded chunks for flat/corrupt terrain
    if (chunkData) {
      // Sanity check: detect flat/corrupt terrain by checking height variation
      let minHeight = Infinity, maxHeight = -Infinity;
      let surfaceCount = 0;
      for (let x = 0; x < 16; x++) {
        for (let z = 0; z < 16; z++) {
          // Scan from top down to find the highest non-air block in this column
          for (let y = MAX_Y; y >= MIN_Y; y--) {
            if (chunkData.getBlock(x, y, z) !== 0) {
              if (y < minHeight) minHeight = y;
              if (y > maxHeight) maxHeight = y;
              surfaceCount++;
              break;
            }
          }
        }
      }

      const heightRange = maxHeight - minHeight;
      console.log(`[ChunkManager] Chunk ${key} from storage: ${surfaceCount} non-air blocks, height range ${minHeight}-${maxHeight} (range=${heightRange})`);

      // If terrain is suspiciously flat (less than 3 block height variation), regenerate
      if (heightRange < 3) {
        console.warn(`[ChunkManager] Chunk ${key} appears FLAT (range=${heightRange}), regenerating...`);
        chunkData = null; // Force regeneration below
      } else {
        console.log(`[ChunkManager] Chunk ${key} has valid terrain variation (${heightRange} blocks)`);
      }
    }

    // Generate if not in storage or was flat/corrupt
    if (!chunkData && this.generatorFn) {
      chunkData = this.generatorFn(cx, cz);

      // Apply cave generation (separate from terrain to avoid double-carving with different seeds)
      if (typeof CaveGenerator !== 'undefined') {
        const caveGen = new CaveGenerator(this._caveSeed || 42);
        caveGen.applyCaves(chunkData);
      }

      console.log(`[ChunkManager] Generated NEW chunk ${key} (not from storage)`);
    }

    // Skip chunks that failed to load and couldn't be regenerated
    if (!chunkData) return;

    // Build geometry using ChunkMeshBuilder
    try {
      const meshBuilder = new ChunkMeshBuilder();
      const meshData = meshBuilder.buildMeshData(chunkData, this.textureAtlas);

      // Skip empty chunks (all air)
      if (meshData.indices.length === 0) {
        _log(`[ChunkManager] Skipped empty chunk ${key}`);
        this.loadedChunks.set(key, { data: chunkData, mesh: null, built: true });
        return;
      }

      const geoResult = meshBuilder.buildThreeGeometry(meshData, chunkData);
      if (!geoResult) {
        _log(`[ChunkManager] Skipping empty chunk ${key}`);
        this.loadedChunks.set(key, { data: chunkData, mesh: null, built: false });
        return;
      }

      let solidMesh = null;
      let transMesh = null;

      // Create materials with texture atlas map if available
      const texMap = this.textureAtlas ? this.textureAtlas.getTexture() : null;
      const solidMaterial = new THREE.MeshLambertMaterial({
        map: texMap,
        color: 0xffffff,
        fog: true
      });

      if (geoResult.solidGeometry) {
        solidMesh = new THREE.Mesh(geoResult.solidGeometry, solidMaterial);
        solidMesh.position.set(cx * 16, 0, cz * 16);

        // Store chunk key and block data on mesh for hover raycasting
        solidMesh.userData.chunkKey = key;
        solidMesh.userData.blockIdToName = this.textureAtlas ? this.textureAtlas.idToName : {};
        solidMesh.userData.chunkData = chunkData;
      }

      if (geoResult.transparentGeometry) {
        const transMaterial = new THREE.MeshLambertMaterial({
          map: texMap,
          color: 0xffffff,
          transparent: true,
          opacity: 0.6,
          depthWrite: false,
          fog: true
        });

        transMesh = new THREE.Mesh(geoResult.transparentGeometry, transMaterial);
        transMesh.position.set(cx * 16, 0, cz * 16);

        // Store block data on transparent mesh for hover raycasting
        transMesh.userData.chunkKey = key;
        transMesh.userData.blockIdToName = this.textureAtlas ? this.textureAtlas.idToName : {};
        transMesh.userData.chunkData = chunkData;
      }

      // Add meshes to renderer's chunk group
      if (this.renderer.chunkGroup) {
        if (solidMesh) this.renderer.chunkGroup.add(solidMesh);
        if (transMesh) this.renderer.chunkGroup.add(transMesh);
      }

      const faceCount = geoResult.solidGeometry ? geoResult.solidGeometry.index.count / 3 : 0;
      const transFaceCount = geoResult.transparentGeometry ? geoResult.transparentGeometry.index.count / 3 : 0;
      _log(`[ChunkManager] Built chunk ${key}: ${faceCount} solid + ${transFaceCount} transparent faces`);

      this.loadedChunks.set(key, { data: chunkData, mesh: solidMesh, transMesh, built: !!(solidMesh || transMesh), dirty: !fromStorage });

      // Queue newly generated chunks for saving
      if (!fromStorage && this.persistence && this.worldId) {
        this.persistence.queueChunk(this.worldId, cx, cz, chunkData);
      }
    } catch (err) {
      console.error(`[ChunkManager] Failed to build chunk ${key}:`, err);
      this.loadedChunks.set(key, { data: chunkData, mesh: null, built: false });
    }
  }

  /**
   * Unload a chunk and dispose of its resources
   */
  _unloadChunk(key) {
    const entry = this.loadedChunks.get(key);

    if (entry) {
      // Remove solid mesh from scene graph
      if (entry.mesh) {
        if (this.renderer.chunkGroup) {
          this.renderer.chunkGroup.remove(entry.mesh);
        }

        // Dispose geometry and material to free GPU memory
        if (entry.mesh.geometry) entry.mesh.geometry.dispose();
        if (entry.mesh.material) entry.mesh.material.dispose();
      }

      // Remove transparent mesh from scene graph
      if (entry.transMesh) {
        if (this.renderer.chunkGroup) {
          this.renderer.chunkGroup.remove(entry.transMesh);
        }

        if (entry.transMesh.geometry) entry.transMesh.geometry.dispose();
        if (entry.transMesh.material) entry.transMesh.material.dispose();
      }

      _log(`[ChunkManager] Unloaded chunk ${key}`);
    }

    this.loadedChunks.delete(key);
  }

  /**
   * Set render distance.
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
   * Link neighbor references between all loaded chunks.
   * This is critical for correct face culling at chunk boundaries.
   * Call this after initial chunk loading, before building meshes.
   */
  linkNeighbors() {
    const dirs = [
      ['positiveX', 1, 0],
      ['negativeX', -1, 0],
      ['positiveZ', 0, 1],
      ['negativeZ', 0, -1],
    ];

    for (const [key, entry] of this.loadedChunks) {
      if (!entry.data) continue;
      const [cx, cz] = key.split(',').map(Number);

      for (const [dir, dx, dz] of dirs) {
        const neighborKey = `${cx + dx},${cz + dz}`;
        const neighborEntry = this.loadedChunks.get(neighborKey);
        if (neighborEntry && neighborEntry.data) {
          entry.data.neighbors[dir] = neighborEntry.data;
        } else {
          entry.data.neighbors[dir] = null;
        }
      }
    }

    console.log(`[ChunkManager] Linked neighbors for ${this.loadedChunks.size} chunks`);
  }

  /**
   * Rebuild mesh data for a specific chunk (after neighbor links change).
   */
  rebuildChunkMesh(cx, cz) {
    const key = `${cx},${cz}`;
    const entry = this.loadedChunks.get(key);
    if (!entry || !entry.data) return;

    // Dispose old meshes
    if (entry.mesh) {
      if (this.renderer.chunkGroup) {
        this.renderer.chunkGroup.remove(entry.mesh);
      }
      if (entry.mesh.geometry) entry.mesh.geometry.dispose();
      if (entry.mesh.material) entry.mesh.material.dispose();
    }
    if (entry.transMesh) {
      if (this.renderer.chunkGroup) {
        this.renderer.chunkGroup.remove(entry.transMesh);
      }
      if (entry.transMesh.geometry) entry.transMesh.geometry.dispose();
      if (entry.transMesh.material) entry.transMesh.material.dispose();
    }

    // Rebuild geometry
    const meshBuilder = new ChunkMeshBuilder();
    const meshData = meshBuilder.buildMeshData(entry.data, this.textureAtlas);

    if (meshData.indices.length === 0 && (!meshData.transparentIndices || meshData.transparentIndices.length === 0)) {
      entry.mesh = null;
      entry.transMesh = null;
      return;
    }

    const geoResult = meshBuilder.buildThreeGeometry(meshData, entry.data);
    if (!geoResult) {
      entry.mesh = null;
      entry.transMesh = null;
      return;
    }

    let solidMesh = null;
    let transMesh = null;

    // Create materials with texture atlas map if available
    const texMap = this.textureAtlas ? this.textureAtlas.getTexture() : null;
    const solidMaterial = new THREE.MeshLambertMaterial({
      map: texMap,
      color: 0xffffff,
      fog: true
    });

    if (geoResult.solidGeometry) {
      solidMesh = new THREE.Mesh(geoResult.solidGeometry, solidMaterial);
      solidMesh.position.set(cx * 16, 0, cz * 16);
      solidMesh.userData.chunkKey = key;
      solidMesh.userData.blockIdToName = this.textureAtlas ? this.textureAtlas.idToName : {};
      solidMesh.userData.chunkData = entry.data;
    }

    if (geoResult.transparentGeometry) {
      const transMaterial = new THREE.MeshLambertMaterial({
        map: texMap,
        color: 0xffffff,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
        fog: true
      });
      transMesh = new THREE.Mesh(geoResult.transparentGeometry, transMaterial);
      transMesh.position.set(cx * 16, 0, cz * 16);
      transMesh.userData.chunkKey = key;
      transMesh.userData.blockIdToName = this.textureAtlas ? this.textureAtlas.idToName : {};
      transMesh.userData.chunkData = entry.data;
    }

    if (this.renderer.chunkGroup) {
      if (solidMesh) this.renderer.chunkGroup.add(solidMesh);
      if (transMesh) this.renderer.chunkGroup.add(transMesh);
    }

    const faceCount = geoResult.solidGeometry ? geoResult.solidGeometry.index.count / 3 : 0;
    const transFaceCount = geoResult.transparentGeometry ? geoResult.transparentGeometry.index.count / 3 : 0;
    _log(`[ChunkManager] Rebuilt chunk ${key}: ${faceCount} solid + ${transFaceCount} transparent faces`);

    entry.mesh = solidMesh;
    entry.transMesh = transMesh;
    entry.built = !!(solidMesh || transMesh);
  }

  /**
   * Get loaded chunk count
   */
  getLoadedCount() {
    return this.loadedChunks.size;
  }

  /**
   * Mark a chunk as dirty (modified) for auto-save.
   * Call this after block break/place operations.
   */
  markChunkDirty(cx, cz) {
    const key = `${cx},${cz}`;
    const entry = this.loadedChunks.get(key);
    if (entry && entry.data) {
      entry.dirty = true;
      // Queue for saving
      if (this.persistence && this.worldId) {
        this.persistence.queueChunk(this.worldId, cx, cz, entry.data);
      }
    }
  }

  /**
   * Get the chunk data for a loaded chunk.
   */
  getChunkData(cx, cz) {
    const key = `${cx},${cz}`;
    const entry = this.loadedChunks.get(key);
    return entry ? entry.data : null;
  }

  /**
   * Get performance state summary for debugging/HUD integration.
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ChunkManager;
}
