/**
 * Cuubz — Chunk Grid System
 * Global coordinate → chunk coordinate conversion, loading/unloading.
 */

// Use globals from chunkData.js: CHUNK_WIDTH, CHUNK_DEPTH

class ChunkGrid {
  constructor() {
    // Map of "chunkX,chunkZ" → Chunk object
    this.loadedChunks = new Map();
    
    // Load/unload thresholds (in chunks)
    this.loadRadius = 6;   // Load chunks within this radius
    this.unloadRadius = 8; // Unload chunks beyond this radius
    
    // Player positions tracking (for multiplayer: ALL player positions)
    this.playerPositions = [];
  }

  /**
   * Convert world coordinates to chunk coordinates
   */
  static worldToChunk(wx, wz) {
    const cx = Math.floor(wx / CHUNK_WIDTH);
    const cz = Math.floor(wz / CHUNK_DEPTH);
    return { cx, cz };
  }

  /**
   * Chunk key for map lookup
   */
  static chunkKey(cx, cz) {
    return `${cx},${cz}`;
  }

  /**
   * Get or generate a chunk at the given coordinates
   * @param {number} cx - Chunk X
   * @param {number} cz - Chunk Z
   * @param {Function} generatorFn - Function to generate new chunk data
   */
  getChunk(cx, cz, generatorFn) {
    const key = ChunkGrid.chunkKey(cx, cz);
    
    if (this.loadedChunks.has(key)) {
      return this.loadedChunks.get(key);
    }
    
    // Generate new chunk
    if (generatorFn) {
      const chunk = generatorFn(cx, cz);
      this.loadedChunks.set(key, chunk);
      
      // Update neighbor references
      this._updateNeighbors(chunk, cx, cz);
      
      return chunk;
    }
    
    return null;
  }

  /**
   * Update neighbor references for a chunk
   */
  _updateNeighbors(chunk, cx, cz) {
    const dirs = [
      ['positiveX', cx + 1, cz],
      ['negativeX', cx - 1, cz],
      ['positiveZ', cx, cz + 1],
      ['negativeZ', cx, cz - 1],
    ];

    for (const [dir, nx, nz] of dirs) {
      const neighbor = this.loadedChunks.get(ChunkGrid.chunkKey(nx, nz));
      chunk.neighbors[dir] = neighbor;
      
      // Update reverse reference if neighbor exists
      if (neighbor) {
        const reverseDir = dir.replace('positive', 'negative').replace('negative', 'positive');
        if (!reverseDir.includes('X') && !reverseDir.includes('Z')) continue;
        // Actually, let's be more precise:
        const revMap = { positiveX: 'negativeX', negativeX: 'positiveX', positiveZ: 'negativeZ', negativeZ: 'positiveZ' };
        neighbor.neighbors[revMap[dir]] = chunk;
      }
    }
  }

  /**
   * Add a player position to track
   */
  addPlayerPosition(x, z) {
    this.playerPositions.push({ x, z });
  }

  /**
   * Remove a player position
   */
  removePlayerPosition(index) {
    this.playerPositions.splice(index, 1);
  }

  /**
   * Update chunk loading based on ALL player positions
   * Returns list of newly loaded chunks
   */
  updateChunks(generatorFn) {
    const newChunks = [];
    
    if (this.playerPositions.length === 0) return newChunks;
    
    // Calculate the bounding box of all players
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    
    for (const pos of this.playerPositions) {
      minX = Math.min(minX, pos.x);
      minZ = Math.min(minZ, pos.z);
      maxX = Math.max(maxX, pos.x);
      maxZ = Math.max(maxZ, pos.z);
    }
    
    // Convert to chunk coordinates with load radius
    const { cx: pMinX, cz: pMinZ } = ChunkGrid.worldToChunk(minX, minZ);
    const { cx: pMaxX, cz: pMaxZ } = ChunkGrid.worldToChunk(maxX, maxZ);
    
    const loadCX = pMinX - this.loadRadius;
    const loadCZ = pMinZ - this.loadRadius;
    const unloadCX = pMaxX + this.loadRadius + 1;
    const unloadCZ = pMaxZ + this.loadRadius + 1;
    
    // Load chunks in range
    for (let cx = loadCX; cx <= unloadCX; cx++) {
      for (let cz = loadCZ; cz <= unloadCZ; cz++) {
        const key = ChunkGrid.chunkKey(cx, cz);
        if (!this.loadedChunks.has(key)) {
          const chunk = generatorFn ? generatorFn(cx, cz) : null;
          if (chunk) {
            this.loadedChunks.set(key, chunk);
            this._updateNeighbors(chunk, cx, cz);
            newChunks.push(chunk);
          }
        }
      }
    }
    
    // Unload distant chunks
    const unloadCX2 = pMinX - this.unloadRadius;
    const unloadCZ2 = pMinZ - this.unloadRadius;
    const unloadCX3 = pMaxX + this.unloadRadius + 1;
    const unloadCZ3 = pMaxZ + this.unloadRadius + 1;
    
    for (const [key, chunk] of this.loadedChunks) {
      if (chunk.chunkX < unloadCX2 || chunk.chunkX > unloadCX3 ||
          chunk.chunkZ < unloadCZ2 || chunk.chunkZ > unloadCZ3) {
        // Save dirty chunks before unloading
        if (chunk.dirty) {
          // TODO: Queue for persistence save
        }
        this.loadedChunks.delete(key);
      }
    }
    
    return newChunks;
  }

  /**
   * Get all dirty chunks that need saving
   */
  getDirtyChunks() {
    const dirty = [];
    for (const chunk of this.loadedChunks.values()) {
      if (chunk.dirty) dirty.push(chunk);
    }
    return dirty;
  }

  /**
   * Get chunk count
   */
  getChunkCount() {
    return this.loadedChunks.size;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ChunkGrid;

}