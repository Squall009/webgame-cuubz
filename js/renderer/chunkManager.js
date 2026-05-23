/**
 * Cuubz — Chunk Manager
 * Load/unload chunks based on player position radius. Async building to avoid frame drops.
 */

class ChunkManager {
  constructor(renderer, generatorFn) {
    this.renderer = renderer;
    this.generatorFn = generatorFn;
    
    // Configurable render distance (default: 6 chunks radius)
    this.renderDistance = 6;
    
    // Loaded chunk meshes
    this.loadedChunks = new Map(); // "cx,cz" → { mesh, data }
    
    // Build queue for async chunk building
    this.buildQueue = [];
    this.building = false;
    
    // Last player position (for dirty checking)
    this.lastPlayerX = 0;
    this.lastPlayerZ = 0;
  }

  /**
   * Update chunk loading based on player position
   */
  update(playerX, playerZ) {
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
    this.buildQueue.push({ cx, cz });
    
    if (!this.building) {
      this._processQueue();
    }
  }

  /**
   * Process build queue asynchronously (one chunk per frame to avoid stutter)
   */
  _processQueue() {
    if (this.buildQueue.length === 0) {
      this.building = false;
      return;
    }
    
    this.building = true;
    
    // Build one chunk per frame
    const { cx, cz } = this.buildQueue.shift();
    this._buildChunk(cx, cz);
    
    // Continue next frame
    setTimeout(() => this._processQueue(), 0);
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
   * Set render distance
   */
  setRenderDistance(distance) {
    this.renderDistance = Math.max(2, Math.min(16, distance));
  }

  /**
   * Get loaded chunk count
   */
  getLoadedCount() {
    return this.loadedChunks.size;
  }
}

module.exports = ChunkManager;
