/**
 * Cuubz - Water Flow System
 *
 * Simulates water flow from source blocks (ocean, rivers, player-placed)
 * with a tick cycle, updating only chunks local to the player for performance.
 * 
 * Uses Minecraft-style water levels: 8 = source (full height), 1-7 = flowing (decreasing).
 * Source water creates flat surfaces; flowing water creates slopes based on level differences.
 */

class WaterFlowSystem {
  constructor(worldManager, chunkManager) {
    this.worldManager = worldManager;
    this.chunkManager = chunkManager;
    this.flowQueue = []; // Blocks that need to be updated for flow
    this.processedThisWorldGen = new Set(); // Prevent infinite loops during initial queue
    this.flowInterval = null;
    this.flowTickRate = 500; // Milliseconds per flow tick
    this.flowRadiusChunks = 2; // How many chunks around the player to simulate
    this.maxQueueSize = 1000; // Prevent OOM from runaway propagation
    
    // Flow decay: each horizontal step reduces water level by 1
    this.horizontalDecay = 1;
    // Vertical flow doesn't decay (water falls at full strength)
    this.verticalDecay = 0;

    // Transparent block IDs for checking fluid/non-fluid neighbors
    this.transparentIds = new Set([0, 6, 8, 15, 17, 24, 26, 27, 28, 29]);
  }

  /**
   * Start the water flow simulation.
   */
  start() {
    if (this.flowInterval) return;
    this.flowInterval = setInterval(() => this._flowTick(), this.flowTickRate);
    console.log(`[WaterFlowSystem] Started with tick rate: ${this.flowTickRate}ms`);
  }

  /**
   * Stop the water flow simulation.
   */
  stop() {
    if (!this.flowInterval) return;
    clearInterval(this.flowInterval);
    this.flowInterval = null;
    console.log('[WaterFlowSystem] Stopped.');
  }

  /**
   * Add a block to the flow queue for processing.
   * @param {number} x - World X
   * @param {number} y - World Y
   * @param {number} z - World Z
   */
  queueBlockForFlow(x, y, z) {
    if (this.flowQueue.length >= this.maxQueueSize) return; // Prevent runaway
    const id = `${x},${y},${z}`;
    // Avoid duplicate entries in queue
    for (const item of this.flowQueue) {
      if (item.x === x && item.y === y && item.z === z) return;
    }
    this.flowQueue.push({ x, y, z });
  }

  /**
   * Initialize water levels for all existing fluid blocks in a chunk.
   * Called during world generation to set source vs flowing levels.
   */
  initializeChunkWaterLevels(chunkX, chunkZ) {
    const chunkKey = `${chunkX},${chunkZ}`;
    const chunkEntry = this.chunkManager.loadedChunks.get(chunkKey);
    if (!chunkEntry || !chunkEntry.data) return;

    const chunk = chunkEntry.data;
    let initialized = 0;

    for (let lx = 0; lx < 16; lx++) {
      for (let lz = 0; lz < 16; lz++) {
        for (let ly = MIN_Y; ly < MAX_Y; ly++) {
          const blockType = chunk.getBlock(lx, ly, lz);
          if ((blockType === BLOCK_TYPES.WATER || blockType === BLOCK_TYPES.LAVA)) {
            // Check if this is a "source" water:
            // - Ocean/lake water (at or below sea level in ocean biome)
            // - Water with solid support above it (pool)
            const wx = chunkX * 16 + lx;
            const wz = chunkZ * 16 + lz;
            
            if (this._isSourceWater(wx, ly, wz)) {
              chunk.setWaterLevel(lx, ly, lz, WATER_LEVEL_SOURCE);
            } else {
              // Default flowing level for non-source water
              const level = Math.max(WATER_LEVEL_FLOWING_MIN, WATER_LEVEL_SOURCE - 1);
              chunk.setWaterLevel(lx, ly, lz, level);
            }
            
            initialized++;
          }
        }
      }
    }

    if (initialized > 0) {
      console.log(`[WaterFlowSystem] Initialized ${initialized} fluid blocks in chunk ${chunkX},${chunkZ}`);
    }
  }

  /**
   * Check if a water block should be considered a source.
   */
  _isSourceWater(wx, wy, wz) {
    // Water at sea level or below with multiple adjacent water blocks is likely ocean/lake (source)
    if (wy <= SEA_LEVEL) {
      let adjacentWater = 0;
      const neighbors = [
        [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]
      ];
      
      for (const [dx, dy, dz] of neighbors) {
        const nx = wx + dx;
        const nz = wz + dz;
        const chunkX = Math.floor(nx / 16);
        const chunkZ = Math.floor(nz / 16);
        const chunkKey = `${chunkX},${chunkZ}`;
        const entry = this.chunkManager.loadedChunks.get(chunkKey);
        if (entry && entry.data) {
          const lx = ((nx % 16) + 16) % 16;
          const lz = ((nz % 16) + 16) % 16;
          const nb = entry.data.getBlock(lx, wy, lz);
          if (nb === BLOCK_TYPES.WATER) adjacentWater++;
        }
      }
      
      // If surrounded by water on multiple sides, it's a source body
      return adjacentWater >= 2;
    }
    
    // Water above sea level that has air above it and solid below is likely river/placed (source)
    if (wy > SEA_LEVEL) {
      const chunkX = Math.floor(wx / 16);
      const chunkZ = Math.floor(wz / 16);
      const chunkKey = `${chunkX},${chunkZ}`;
      const entry = this.chunkManager.loadedChunks.get(chunkKey);
      if (entry && entry.data) {
        const lx = ((wx % 16) + 16) % 16;
        const lz = ((wz % 16) + 16) % 16;
        const below = entry.data.getBlock(lx, wy - 1, lz);
        // Water with solid ground below and air above is a source (placed/river)
        if (below !== BLOCK_TYPES.AIR && !this.transparentIds.has(below)) {
          return true;
        }
      }
    }
    
    return false;
  }

  /**
   * Process one water flow tick.
   */
  _flowTick() {
    if (!this.worldManager.player || !this.chunkManager.loadedChunks.size) return;

    const playerChunkX = Math.floor(this.worldManager.player.position.x / 16);
    const playerChunkZ = Math.floor(this.worldManager.player.position.z / 16);

    const processedThisTick = new Set();
    const changes = []; // Track blocks that changed for mesh rebuilds
    const newFlowQueue = [];

    while (this.flowQueue.length > 0) {
      const { x, y, z } = this.flowQueue.shift();

      const chunkX = Math.floor(x / 16);
      const chunkZ = Math.floor(z / 16);

      // Skip if outside the active flow radius
      if (
        Math.abs(chunkX - playerChunkX) > this.flowRadiusChunks ||
        Math.abs(chunkZ - playerChunkZ) > this.flowRadiusChunks
      ) {
        newFlowQueue.push({ x, y, z });
        continue;
      }

      const chunkKey = `${chunkX},${chunkZ}`;
      const chunkEntry = this.chunkManager.loadedChunks.get(chunkKey);
      if (!chunkEntry || !chunkEntry.data) continue;

      const localX = ((x % 16) + 16) % 16;
      const localY = y;
      const localZ = ((z % 16) + 16) % 16;

      const currentBlock = chunkEntry.data.getBlock(localX, localY, localZ);

      // Only process fluid blocks
      if (currentBlock !== BLOCK_TYPES.WATER && currentBlock !== BLOCK_TYPES.LAVA) continue;

      const blockId = `${x},${y},${z}`;
      if (processedThisTick.has(blockId)) continue;
      processedThisTick.add(blockId);

      // Get current water level
      const currentLevel = chunkEntry.data.getWaterLevel(localX, localY, localZ);
      
      // Source blocks don't flow — they stay at level 8 forever
      if (currentLevel >= WATER_LEVEL_SOURCE) {
        this._tryFlowFromSource(x, y, z, chunkEntry.data, currentBlock, changes);
        continue;
      }

      // Flowing water logic: try to flow down and horizontally
      this._tryFlowFromFlowing(x, y, z, chunkEntry.data, currentLevel, currentBlock, changes);
    }

    // Rebuild meshes for all changed chunks
    const chunksToRebuild = new Set();
    for (const change of changes) {
      const cx = Math.floor(change.x / 16);
      const cz = Math.floor(change.z / 16);
      const key = `${cx},${cz}`;
      if (!chunksToRebuild.has(key)) {
        chunksToRebuild.add(key);
        this.chunkManager.rebuildChunkMesh(cx, cz);
      }
    }

    // Keep queue manageable
    this.flowQueue = newFlowQueue.slice(0, this.maxQueueSize - this.flowQueue.length);
  }

  /**
   * Try to flow from a source block. Source water flows at full level (8) downward,
   * and decrements by 1 for each horizontal step.
   */
  _tryFlowFromSource(x, y, z, chunk, fluidType, changes) {
    // Flow DOWN: place full-level water below if air
    if (y > MIN_Y) {
      const localX = ((x % 16) + 16) % 16;
      const localZ = ((z % 16) + 16) % 16;
      const blockBelow = chunk.getBlock(localX, y - 1, localZ);
      
      if (blockBelow === BLOCK_TYPES.AIR) {
        chunk.setBlock(localX, y - 1, localZ, fluidType);
        chunk.setWaterLevel(localX, y - 1, localZ, WATER_LEVEL_SOURCE); // Falls at full strength
        changes.push({ x, y: y - 1, z });
        this.queueBlockForFlow(x, y - 1, z);
        return; // Don't also flow horizontally from source — vertical takes priority
      }
    }

    // Flow HORIZONTALLY: each step decrements level by 1
    const neighbors = [
      { dx: 1, dz: 0 }, { dx: -1, dz: 0 },
      { dx: 0, dz: 1 }, { dx: 0, dz: -1 }
    ];

    for (const { dx, dz } of neighbors) {
      const nx = x + dx;
      const nz = z + dz;

      const nChunkX = Math.floor(nx / 16);
      const nChunkZ = Math.floor(nz / 16);
      const nChunkKey = `${nChunkX},${nChunkZ}`;
      const nEntry = this.chunkManager.loadedChunks.get(nChunkKey);

      if (nEntry && nEntry.data) {
        const nlx = ((nx % 16) + 16) % 16;
        const nlz = ((nz % 16) + 16) % 16;

        const neighborBlock = nEntry.data.getBlock(nlx, y, nlz);
        
        if (neighborBlock === BLOCK_TYPES.AIR) {
          // Flow horizontally with decremented level
          const newLevel = WATER_LEVEL_SOURCE - this.horizontalDecay;
          nEntry.data.setBlock(nlx, y, nlz, fluidType);
          nEntry.data.setWaterLevel(nlx, y, nlz, newLevel);
          changes.push({ x: nx, y, z: nz });
          this.queueBlockForFlow(nx, y, nz);
        } else if (neighborBlock === fluidType) {
          // Neighbor is same fluid type — check if we can increase its level
          const neighborLevel = nEntry.data.getWaterLevel(nlx, y, nlz);
          if (WATER_LEVEL_SOURCE > neighborLevel) {
            nEntry.data.setWaterLevel(nlx, y, nlz, WATER_LEVEL_SOURCE);
            changes.push({ x: nx, y, z: nz });
          }
        }
      }
    }
  }

  /**
   * Try to flow from a flowing water block. Flowing water can spread further but with decreasing levels.
   */
  _tryFlowFromFlowing(x, y, z, chunk, currentLevel, fluidType, changes) {
    // Flow DOWN: maintains level (or becomes source if falling into air)
    if (y > MIN_Y && currentLevel >= WATER_LEVEL_SOURCE - 1) {
      const localX = ((x % 16) + 16) % 16;
      const localZ = ((z % 16) + 16) % 16;
      const blockBelow = chunk.getBlock(localX, y - 1, localZ);
      
      if (blockBelow === BLOCK_TYPES.AIR) {
        chunk.setBlock(localX, y - 1, localZ, fluidType);
        chunk.setWaterLevel(localX, y - 1, localZ, Math.max(WATER_LEVEL_FLOWING_MIN, currentLevel));
        changes.push({ x, y: y - 1, z });
        this.queueBlockForFlow(x, y - 1, z);
        return;
      }
    }

    // Flow HORIZONTALLY only if level > 1 (level 1 water doesn't spread further)
    if (currentLevel <= WATER_LEVEL_FLOWING_MIN) return;

    const neighbors = [
      { dx: 1, dz: 0 }, { dx: -1, dz: 0 },
      { dx: 0, dz: 1 }, { dx: 0, dz: -1 }
    ];

    for (const { dx, dz } of neighbors) {
      const nx = x + dx;
      const nz = z + dz;

      const nChunkX = Math.floor(nx / 16);
      const nChunkZ = Math.floor(nz / 16);
      const nChunkKey = `${nChunkX},${nChunkZ}`;
      const nEntry = this.chunkManager.loadedChunks.get(nChunkKey);

      if (nEntry && nEntry.data) {
        const nlx = ((nx % 16) + 16) % 16;
        const nlz = ((nz % 16) + 16) % 16;

        const neighborBlock = nEntry.data.getBlock(nlx, y, nlz);
        
        if (neighborBlock === BLOCK_TYPES.AIR) {
          const newLevel = Math.max(WATER_LEVEL_FLOWING_MIN, currentLevel - this.horizontalDecay);
          nEntry.data.setBlock(nlx, y, nlz, fluidType);
          nEntry.data.setWaterLevel(nlx, y, nlz, newLevel);
          changes.push({ x: nx, y, z: nz });
          this.queueBlockForFlow(nx, y, nz);
        } else if (neighborBlock === fluidType) {
          const neighborLevel = nEntry.data.getWaterLevel(nlx, y, nlz);
          const targetLevel = Math.max(neighborLevel, currentLevel - this.horizontalDecay);
          if (targetLevel > neighborLevel) {
            nEntry.data.setWaterLevel(nlx, y, nlz, targetLevel);
            changes.push({ x: nx, y, z: nz });
          }
        }
      }
    }
  }

  /**
   * Queue all fluid blocks in a chunk for flow processing.
   */
  queueChunkFluids(chunkX, chunkZ) {
    const chunkKey = `${chunkX},${chunkZ}`;
    const entry = this.chunkManager.loadedChunks.get(chunkKey);
    if (!entry || !entry.data) return;

    const chunk = entry.data;
    for (let lx = 0; lx < 16; lx++) {
      for (let lz = 0; lz < 16; lz++) {
        for (let ly = MIN_Y; ly < MAX_Y; ly++) {
          const bt = chunk.getBlock(lx, ly, lz);
          if ((bt === BLOCK_TYPES.WATER || bt === BLOCK_TYPES.LAVA)) {
            const wx = chunkX * 16 + lx;
            const wz = chunkZ * 16 + lz;
            
            // Initialize level if not set (default to source)
            if (chunk.getWaterLevel(lx, ly, lz) < WATER_LEVEL_FLOWING_MIN) {
              chunk.setWaterLevel(lx, ly, lz, WATER_LEVEL_SOURCE);
            }
            
            this.queueBlockForFlow(wx, ly, wz);
          }
        }
      }
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = WaterFlowSystem;
}
