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

    // New storage system (IndexedDB + binary codec)
    this.chunkStore = options.chunkStore || null;       // ChunkStore instance
    this.dirtyFlush = options.dirtyFlush || null;        // DirtyFlushManager instance

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
   * Uses IndexedDB for saved chunks (async), falls back to generator.
   */
  async _buildChunk(cx, cz) {
    const key = `${cx},${cz}`;

    let chunkData = null;
    let fromStorage = false;

    // Try loading from IndexedDB first (new storage system)
    if (this.chunkStore) {
      try {
        // Check both manifest AND actual storage presence.
        // Manifest may list chunks that were never flushed to disk.
        const isGenerated = await this.chunkStore.isChunkGenerated(key);
        const hasBinary   = await this.chunkStore.hasChunk(key);

        if (isGenerated && !hasBinary) {
          console.warn(`[ChunkManager] Chunk ${key} in manifest but missing from storage — removing stale entry`);
          try { await this.chunkStore.removeGeneratedChunk(key); } catch (_) {}
        }

        if (hasBinary) {
          const binaryData = await this.chunkStore.loadChunk(key);
          if (binaryData) {
            chunkData = ChunkBinaryCodec.decode(binaryData);
            fromStorage = true;
            console.log(`[ChunkManager] Loaded chunk ${key} from IndexedDB (${binaryData.byteLength} bytes)`);

            // Sanity check: detect flat/corrupt terrain by checking height variation
            let minHeight = Infinity, maxHeight = -Infinity;
            let surfaceCount = 0;
            for (let x = 0; x < 16; x++) {
              for (let z = 0; z < 16; z++) {
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

            if (heightRange < 3) {
              // Silently remove corrupt data and regenerate — no log on corruption cleanup.
              try { await this.chunkStore.removeGeneratedChunk(key); } catch (_) {}
              chunkData = null;
              fromStorage = false;
            } else {
              console.log(`[ChunkManager] LOADED ${key} from IndexedDB (${binaryData.byteLength} bytes, height range ${heightRange})`);
            }
          }
        }
      } catch (e) {
        // Silently remove corrupt chunk data from storage/manifest.
        try { await this.chunkStore.removeGeneratedChunk(key); } catch (_) {}
      }
    }

    // Generate if not in storage or was flat/corrupt
    if (!chunkData && this.generatorFn) {
      console.log(`[ChunkManager] Generating chunk ${key} (not in IndexedDB)`);
      chunkData = this.generatorFn(cx, cz);

      // Add to manifest as generated
      if (this.chunkStore) {
        try {
          await this.chunkStore.addGeneratedChunk(key);
        } catch (e) {
          // Silently ignore manifest errors.
        }
      }

      // Mark as dirty for persistence on next flush
      if (this.dirtyFlush) {
        this.dirtyFlush.markDirty(key, chunkData);
      }
    }

    // Skip chunks that failed to load and couldn't be regenerated
    if (!chunkData) return;

    // Build geometry using ChunkMeshBuilder
    try {
      const meshBuilder = new ChunkMeshBuilder();
      
      // Create cross-chunk neighbor lookup for proper fluid slope blending at boundaries
      const neighborLookup = (nx, ny, nz) => {
        const nChunkX = Math.floor(nx / 16);
        const nChunkZ = Math.floor(nz / 16);
        const nKey = `${nChunkX},${nChunkZ}`;
        const nEntry = this.loadedChunks.get(nKey);
        if (nEntry && nEntry.data) {
          const nlx = ((nx % 16) + 16) % 16;
          const nlz = ((nz % 16) + 16) % 16;
          return nEntry.data.getBlock(nlx, ny, nlz);
        }
        // Chunk not loaded - return air (safe default for face culling)
        return BLOCK_TYPES.AIR || 0;
      };
      
      const waterLevelLookup = (nx, ny, nz) => {
        const nChunkX = Math.floor(nx / 16);
        const nChunkZ = Math.floor(nz / 16);
        const nKey = `${nChunkX},${nChunkZ}`;
        const nEntry = this.loadedChunks.get(nKey);
        if (nEntry && nEntry.data && typeof nEntry.data.getWaterLevel === 'function') {
          const nlx = ((nx % 16) + 16) % 16;
          const nlz = ((nz % 16) + 16) % 16;
          return nEntry.data.getWaterLevel(nlx, ny, nlz);
        }
        return 0;
      };
      
      const meshData = meshBuilder.buildMeshData(chunkData, this.textureAtlas, neighborLookup, waterLevelLookup);

      // Skip truly empty chunks — check solid + cutout + transparent geometry
      if (meshData.indices.length === 0 &&
          (!meshData.cutoutIndices || meshData.cutoutIndices.length === 0) &&
          (!meshData.transparentIndices || meshData.transparentIndices.length === 0)) {
// Skipped empty chunk — no log
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
      let cutoutMesh = null;
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

      if (geoResult.cutoutGeometry) {
        // Cutout material for leaves, flowers, torches (alpha test with MSAA)
        const cutoutMaterial = new THREE.MeshLambertMaterial({
          map: texMap,
          color: 0xffffff,
          transparent: true,
          alphaToCoverage: true,  // Uses texture alpha for coverage testing — crisp edges
          depthWrite: true,        // Write depth so cutouts occlude properly
          fog: true,
          side: THREE.DoubleSide
        });

        cutoutMesh = new THREE.Mesh(geoResult.cutoutGeometry, cutoutMaterial);
        cutoutMesh.position.set(cx * 16, 0, cz * 16);

        // Store block data on cutout mesh for hover raycasting
        cutoutMesh.userData.chunkKey = key;
        cutoutMesh.userData.blockIdToName = this.textureAtlas ? this.textureAtlas.idToName : {};
        cutoutMesh.userData.chunkData = chunkData;
      }

      if (geoResult.transparentGeometry) {
        // Transparent material for fluids, ice, toxic slime (opacity blending)
        const transMaterial = new THREE.MeshLambertMaterial({
          map: texMap,
          color: 0xffffff,
          transparent: true,
          opacity: 0.6,
          depthWrite: false,
          fog: true,
          side: THREE.DoubleSide
        });

        transMesh = new THREE.Mesh(geoResult.transparentGeometry, transMaterial);
        transMesh.position.set(cx * 16, 0, cz * 16);
        transMesh.userData.chunkKey = key;
        transMesh.userData.blockIdToName = this.textureAtlas ? this.textureAtlas.idToName : {};
        transMesh.userData.chunkData = chunkData;
      }

      // Add meshes to renderer's chunk group
      if (this.renderer.chunkGroup) {
        if (solidMesh) this.renderer.chunkGroup.add(solidMesh);
        if (geoResult.cutoutGeometry && cutoutMesh) this.renderer.chunkGroup.add(cutoutMesh);
        if (transMesh) this.renderer.chunkGroup.add(transMesh);
      }

      const faceCount = geoResult.solidGeometry ? geoResult.solidGeometry.index.count / 3 : 0;
      const transFaceCount = geoResult.transparentGeometry ? geoResult.transparentGeometry.index.count / 3 : 0;
// Chunk mesh built — no log on success

      this.loadedChunks.set(key, { data: chunkData, mesh: solidMesh, transMesh, cutoutMesh, built: !!(solidMesh || transMesh || cutoutMesh), dirty: !fromStorage });

      // Rebuild adjacent loaded chunks — they may have built with stale neighbor=air data,
      // causing incorrect face culling at transparent block boundaries (e.g. water edges).
      const neighbors = [
        [cx - 1, cz], [cx + 1, cz], [cx, cz - 1], [cx, cz + 1]
      ];
      for (const [ncx, ncz] of neighbors) {
        const nKey = `${ncx},${ncz}`;
        const nEntry = this.loadedChunks.get(nKey);
        if (nEntry && nEntry.data && (nEntry.mesh || nEntry.transMesh || nEntry.cutoutMesh)) {
// Rebuilding adjacent chunk — no log
          this.rebuildChunkMesh(ncx, ncz);
        }
      }

      // Queue newly generated chunks for saving (new system)
      if (!fromStorage && this.dirtyFlush) {
        this.dirtyFlush.markDirty(key, chunkData);
      }
    } catch (err) {
      // Silently skip failed chunks — they'll regenerate next frame.
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

      // Remove cutout mesh from scene graph
      if (entry.cutoutMesh) {
        if (this.renderer.chunkGroup) {
          this.renderer.chunkGroup.remove(entry.cutoutMesh);
        }

        if (entry.cutoutMesh.geometry) entry.cutoutMesh.geometry.dispose();
        if (entry.cutoutMesh.material) entry.cutoutMesh.material.dispose();
      }

      // Remove transparent mesh from scene graph
      if (entry.transMesh) {
        if (this.renderer.chunkGroup) {
          this.renderer.chunkGroup.remove(entry.transMesh);
        }

        if (entry.transMesh.geometry) entry.transMesh.geometry.dispose();
        if (entry.transMesh.material) entry.transMesh.material.dispose();
      }

// Chunk unloaded — no log
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

// Neighbors linked — no log
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
    if (entry.cutoutMesh) {
      if (this.renderer.chunkGroup) {
        this.renderer.chunkGroup.remove(entry.cutoutMesh);
      }
      if (entry.cutoutMesh.geometry) entry.cutoutMesh.geometry.dispose();
      if (entry.cutoutMesh.material) entry.cutoutMesh.material.dispose();
    }

    // Rebuild geometry with cross-chunk lookups
    const meshBuilder = new ChunkMeshBuilder();

    // Create cross-chunk neighbor lookup for proper face culling at boundaries
    const rebuildNeighborLookup = (nx, ny, nz) => {
      const nChunkX = Math.floor(nx / 16);
      const nChunkZ = Math.floor(nz / 16);
      const nKey = `${nChunkX},${nChunkZ}`;
      const nEntry = this.loadedChunks.get(nKey);
      if (nEntry && nEntry.data) {
        const nlx = ((nx % 16) + 16) % 16;
        const nlz = ((nz % 16) + 16) % 16;
        return nEntry.data.getBlock(nlx, ny, nlz);
      }
      return BLOCK_TYPES.AIR || 0;
    };

    const rebuildWaterLevelLookup = (nx, ny, nz) => {
      const nChunkX = Math.floor(nx / 16);
      const nChunkZ = Math.floor(nz / 16);
      const nKey = `${nChunkX},${nChunkZ}`;
      const nEntry = this.loadedChunks.get(nKey);
      if (nEntry && nEntry.data && typeof nEntry.data.getWaterLevel === 'function') {
        const nlx = ((nx % 16) + 16) % 16;
        const nlz = ((nz % 16) + 16) % 16;
        return nEntry.data.getWaterLevel(nlx, ny, nlz);
      }
      return 0;
    };

    const meshData = meshBuilder.buildMeshData(entry.data, this.textureAtlas, rebuildNeighborLookup, rebuildWaterLevelLookup);

    if (meshData.indices.length === 0 && (!meshData.cutoutIndices || meshData.cutoutIndices.length === 0) && (!meshData.transparentIndices || meshData.transparentIndices.length === 0)) {
      entry.mesh = null;
      entry.cutoutMesh = null;
      entry.transMesh = null;
      return;
    }

    const geoResult = meshBuilder.buildThreeGeometry(meshData, entry.data);
    if (!geoResult) {
      entry.mesh = null;
      entry.cutoutMesh = null;
      entry.transMesh = null;
      return;
    }

    let solidMesh = null;
    let cutoutMesh = null;
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

    if (geoResult.cutoutGeometry) {
      const cutoutMaterial = new THREE.MeshLambertMaterial({
        map: texMap,
        color: 0xffffff,
        transparent: true,
        alphaToCoverage: true,
        depthWrite: true,
        fog: true,
        side: THREE.DoubleSide
      });
      cutoutMesh = new THREE.Mesh(geoResult.cutoutGeometry, cutoutMaterial);
      cutoutMesh.position.set(cx * 16, 0, cz * 16);
      cutoutMesh.userData.chunkKey = key;
      cutoutMesh.userData.blockIdToName = this.textureAtlas ? this.textureAtlas.idToName : {};
      cutoutMesh.userData.chunkData = entry.data;
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
      if (cutoutMesh) this.renderer.chunkGroup.add(cutoutMesh);
      if (transMesh) this.renderer.chunkGroup.add(transMesh);
    }

    const faceCount = geoResult.solidGeometry ? geoResult.solidGeometry.index.count / 3 : 0;
    const cutoutFaceCount = geoResult.cutoutGeometry ? geoResult.cutoutGeometry.index.count / 3 : 0;
    const transFaceCount = geoResult.transparentGeometry ? geoResult.transparentGeometry.index.count / 3 : 0;
// Chunk mesh rebuilt — no log on success

    entry.mesh = solidMesh;
    entry.cutoutMesh = cutoutMesh;
    entry.transMesh = transMesh;
    entry.built = !!(solidMesh || cutoutMesh || transMesh);
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
      // Queue for IndexedDB flush (new system)
      if (this.dirtyFlush) {
        this.dirtyFlush.markDirty(key, entry.data);
      }
    }
  }

  /**
   * Apply a block change from a remote player (multiplayer delta).
   * Applies the change to the in-memory chunk data, marks dirty, and rebuilds meshes.
   * @param {number} x - World X coordinate
   * @param {number} y - World Y coordinate
   * @param {number} z - World Z coordinate
   * @param {number} blockType - New block type (0 = AIR)
   * @param {Object} [options] — Optional configuration
   * @param {boolean} [options.persist=true] — Mark chunk dirty for IndexedDB flush (false for joiner clients)
   */
  applyBlockChange(x, y, z, blockType, options = {}) {
    const cx = Math.floor(x / 16);
    const cz = Math.floor(z / 16);

    // Get or request chunk data
    let chunkData = this.getChunkData(cx, cz);
    if (!chunkData) {
      // Chunk not loaded yet — silently ignore, it will load on next frame.
      // Request the chunk to be generated/loaded (don't await)
      this._requestChunk(cx, cz);
      return;
    }

    // Apply block change
    chunkData.setBlock(x, y, z, blockType);

    // Mark dirty for IndexedDB flush only if persist is true (host mode)
    if (options.persist !== false) {
      this.markChunkDirty(cx, cz);
    }

    // Rebuild mesh
    this.rebuildChunkMesh(cx, cz);

// Remote block change applied — no log
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
