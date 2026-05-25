/**
 * Cuubz — Cave Generator
 * 3D tube caves using noise thresholding with seamless chunk edges.
 * Includes: stalactites, stalagmites, torch placement for cave lighting.
 */

const NoiseGenerator = require('./noise');
const { BLOCK_TYPES, CHUNK_WIDTH, CHUNK_DEPTH, MIN_Y, MAX_Y } = require('./chunkData');

class CaveGenerator {
  constructor(seed) {
    this.noise = new NoiseGenerator(seed);
    
    // Cave parameters
    this.caveThreshold = 0.3;      // Noise value above which is cave space
    this.tunnelRadius = 2.5;       // Base tunnel radius
    this.largeCavernChance = 0.1;  // Chance of large cavern at a point
    this.largeCavernRadius = 6;    // Radius of large caverns
    
    // Stalactite/stalagmite parameters
    this.stalactiteChance = 0.04;   // Chance per ceiling air block
    this.stalagmiteChance = 0.03;   // Chance per floor air block
    this.maxFormationHeight = 4;    // Max height for stalactites/stalagmites
    
    // Torch placement parameters
    this.torchChance = 0.008;       // Chance per cave air block (sparse)
    this.torchMinSeparation = 5;    // Min blocks between torches in same column
  }

  /**
   * Apply caves to an existing chunk
   * Carves cave tunnels through solid blocks using 3D noise thresholding
   */
  applyCaves(chunk) {
    for (let lx = 0; lx < CHUNK_WIDTH; lx++) {
      for (let lz = 0; lz < CHUNK_DEPTH; lz++) {
        const wx = chunk.worldX + lx;
        const wz = chunk.worldZ + lz;
        
        for (let y = -30; y < 5; y++) { // Only carve underground caves
          const block = chunk.getBlock(lx, y, lz);
          
          // Don't carve bedrock or air that's already exposed to surface
          if (block === BLOCK_TYPES.BEDROCK || block === BLOCK_TYPES.AIR) continue;
          
          // 3D noise for cave detection
          const caveValue = this.noise.octaveNoise3(
            wx * 0.05, y * 0.08, wz * 0.05,
            3, 0.5
          );
          
          if (caveValue > this.caveThreshold) {
            chunk.setBlock(lx, y, lz, BLOCK_TYPES.AIR);
          }
        }
      }
    }
  }

  /**
   * Generate cave tunnel paths for a region
   * Returns array of tunnel center points for visualization/debugging
   */
  generateTunnelPaths(regionX, regionZ, regionSize) {
    const tunnels = [];
    
    // Start tunnel entry points at surface level
    const entries = [
      { x: regionX + Math.random() * regionSize, z: regionZ + Math.random() * regionSize },
      { x: regionX + Math.random() * regionSize, z: regionZ + Math.random() * regionSize },
    ];
    
    for (const entry of entries) {
      let x = entry.x;
      let z = entry.z;
      let y = 0; // Start near sea level and descend
      
      // Tunnel descends into the world
      const segments = Math.floor(regionSize / 4);
      
      for (let i = 0; i < segments; i++) {
        // Noise-guided tunnel direction
        const dirX = this.noise.perlin2(x * 0.1, z * 0.1);
        const dirZ = this.noise.perlin2(x * 0.1 + 100, z * 0.1 + 100);
        
        x += dirX * 2;
        z += dirZ * 2;
        y -= 0.5; // Descend gradually
        
        if (y < -30) break; // Don't go below bedrock zone
        
        tunnels.push({ x, y, z });
      }
    }
    
    return tunnels;
  }

  /**
   * Check if a cave is connected to other caves (connectivity check)
   * Uses flood-fill from cave entry point
   */
  isConnected(chunkX, chunkZ, grid) {
    const key = `${chunkX},${chunkZ}`;
    const chunk = grid.getChunk ? grid.getChunk(chunkX, chunkZ) : null;
    
    if (!chunk) return false;
    
    // Find first cave block and do flood fill
    for (let lx = 0; lx < CHUNK_WIDTH; lx++) {
      for (let lz = 0; lz < CHUNK_DEPTH; lz++) {
        for (let y = -30; y < 5; y++) {
          if (chunk.getBlock(lx, y, lz) === BLOCK_TYPES.AIR) {
            // Found cave space — check neighbors for connectivity
            return this._floodFill(chunkX, chunkZ, lx, y, lz, grid);
          }
        }
      }
    }
    
    return false;
  }

  /**
   * Flood fill from a cave position to check connectivity
   */
  _floodFill(chunkX, chunkZ, lx, y, lz, grid) {
    const visited = new Set();
    const queue = [{ cx: chunkX, cz: chunkZ, lx, y, lz }];
    let connectedChunks = 0;
    
    while (queue.length > 0 && connectedChunks < 4) {
      const pos = queue.shift();
      const visitKey = `${pos.cx},${pos.cz},${pos.lx},${pos.y},${pos.lz}`;
      
      if (visited.has(visitKey)) continue;
      visited.add(visitKey);
      
      const chunk = grid.getChunk ? grid.getChunk(pos.cx, pos.cz) : null;
      if (!chunk || chunk.getBlock(pos.lx, pos.y, pos.lz) !== BLOCK_TYPES.AIR) continue;
      
      connectedChunks++;
      
      // Check neighbors (including adjacent chunks)
      const neighbors = [
        { dx: 0, dy: 0, dz: 1 },
        { dx: 0, dy: 0, dz: -1 },
        { dx: 0, dy: 1, dz: 0 },
        { dx: 0, dy: -1, dz: 0 },
        { dx: 1, dy: 0, dz: 0 },
        { dx: -1, dy: 0, dz: 0 },
      ];
      
      for (const n of neighbors) {
        let nlx = pos.lx + n.dx;
        let nlz = pos.lz + n.dz;
        let ncx = pos.cx;
        let ncz = pos.cz;
        
        // Handle chunk boundary crossing
        if (nlx < 0) { nlx = CHUNK_WIDTH - 1; ncx--; }
        if (nlx >= CHUNK_WIDTH) { nlx = 0; ncx++; }
        if (nlz < 0) { nlz = CHUNK_DEPTH - 1; ncz--; }
        if (nlz >= CHUNK_DEPTH) { nlz = 0; ncz++; }
        
        queue.push({ cx: ncx, cz: ncz, lx: nlx, y: pos.y + n.dy, lz: nlz });
      }
    }
    
    return connectedChunks > 1; // Connected if reaches adjacent chunk
  }

  /**
   * Generate stalactites (hanging from cave ceiling) and stalagmites (rising from cave floor)
   * Called after cave generation is complete.
   * Uses deterministic noise for placement to ensure seamless chunk edges.
   */
  generateFormations(chunk) {
    this._generateStalactites(chunk);
    this._generateStalagmites(chunk);
  }

  /**
   * Generate stalactites — stone formations hanging from cave ceilings
   */
  _generateStalactites(chunk) {
    for (let lx = 0; lx < CHUNK_WIDTH; lx++) {
      for (let lz = 0; lz < CHUNK_DEPTH; lz++) {
        const wx = chunk.worldX + lx;
        const wz = chunk.worldZ + lz;

        // Scan from top down to find ceiling air blocks in caves
        for (let y = MAX_Y - 1; y > MIN_Y + 1; y--) {
          const currentBlock = chunk.getBlock(lx, y, lz);
          
          // Find solid block above with air below it (ceiling)
          if (currentBlock === BLOCK_TYPES.AIR) {
            const above = chunk.getBlock(lx, y + 1, lz);
            
            // Check if above is stone/cave ceiling material
            if (above !== BLOCK_TYPES.STONE && above !== BLOCK_TYPES.GRAVEL && 
                above !== BLOCK_TYPES.OBSIDIAN && above !== BLOCK_TYPES.BLACKSTONE) {
              continue;
            }

            // Deterministic stalactite placement based on world position
            const roll = this.noise.hash(wx + 300, wz + 300 + y);
            if (roll >= this.stalactiteChance) continue;

            // Generate stalactite height (1-4 blocks)
            const heightRoll = this.noise.hash(wx + 400, wz + 400 + y);
            const height = 1 + Math.floor(heightRoll * this.maxFormationHeight);

            // Place stalactite downward from ceiling
            for (let h = 1; h <= height; h++) {
              const targetY = y - h + 1;
              if (targetY < MIN_Y) break;
              
              // Don't overwrite existing non-air blocks
              if (chunk.getBlock(lx, targetY, lz) !== BLOCK_TYPES.AIR) break;
              
              chunk.setBlock(lx, targetY, lz, BLOCK_TYPES.STONE);
            }
          }
        }
      }
    }
  }

  /**
   * Generate stalagmites — stone formations rising from cave floors
   */
  _generateStalagmites(chunk) {
    for (let lx = 0; lx < CHUNK_WIDTH; lx++) {
      for (let lz = 0; lz < CHUNK_DEPTH; lz++) {
        const wx = chunk.worldX + lx;
        const wz = chunk.worldZ + lz;

        // Scan from bottom up to find floor air blocks in caves
        for (let y = MIN_Y + 1; y < MAX_Y - 1; y++) {
          const currentBlock = chunk.getBlock(lx, y, lz);
          
          // Find solid block below with air above it (floor)
          if (currentBlock === BLOCK_TYPES.AIR) {
            const below = chunk.getBlock(lx, y - 1, lz);
            
            // Check if below is stone/cave floor material
            if (below !== BLOCK_TYPES.STONE && below !== BLOCK_TYPES.GRAVEL &&
                below !== BLOCK_TYPES.OBSIDIAN && below !== BLOCK_TYPES.BLACKSTONE) {
              continue;
            }

            // Deterministic stalagmite placement based on world position
            const roll = this.noise.hash(wx + 500, wz + 500 + y);
            if (roll >= this.stalagmiteChance) continue;

            // Generate stalagmite height (1-4 blocks)
            const heightRoll = this.noise.hash(wx + 600, wz + 600 + y);
            const height = 1 + Math.floor(heightRoll * this.maxFormationHeight);

            // Place stalagmite upward from floor
            for (let h = 1; h <= height; h++) {
              const targetY = y + h - 1;
              if (targetY >= MAX_Y) break;
              
              // Don't overwrite existing non-air blocks
              if (chunk.getBlock(lx, targetY, lz) !== BLOCK_TYPES.AIR) break;
              
              chunk.setBlock(lx, targetY, lz, BLOCK_TYPES.STONE);
            }
          }
        }
      }
    }
  }

  /**
   * Place torches in caves for ambient lighting
   * Torches are placed on walls, ceilings, and floors of cave spaces.
   * Uses min-separation to avoid clustering.
   */
  placeTorchesInCaves(chunk) {
    // Track torch positions to enforce minimum separation
    const torchPositions = new Set();

    for (let lx = 0; lx < CHUNK_WIDTH; lx++) {
      for (let lz = 0; lz < CHUNK_DEPTH; lz++) {
        const wx = chunk.worldX + lx;
        const wz = chunk.worldZ + lz;

        // Scan underground region only
        for (let y = MIN_Y + 1; y < 5; y++) {
          const currentBlock = chunk.getBlock(lx, y, lz);
          
          // Only consider cave air spaces
          if (currentBlock !== BLOCK_TYPES.AIR) continue;

          // Check if this is a cave space (surrounded by solid blocks)
          if (!this._isCaveSpace(chunk, lx, y, lz)) continue;

          // Enforce minimum separation between torches
          const posKey = `${lx},${y},${lz}`;
          if (this._isTooCloseToTorch(torchPositions, lx, y, lz)) continue;

          // Deterministic torch placement
          const roll = this.noise.hash(wx + 700, wz + 700 + y * 13);
          if (roll >= this.torchChance) continue;

          // Find a valid surface to attach the torch
          const torchPos = this._findTorchSurface(chunk, lx, y, lz);
          if (!torchPos) continue;

          // Place torch
          chunk.setBlock(torchPos.x, torchPos.y, torchPos.z, BLOCK_TYPES.CAVE_TORCH);
          torchPositions.add(`${torchPos.x},${torchPos.y},${torchPos.z}`);
        }
      }
    }
  }

  /**
   * Check if a position is inside a cave space (air surrounded by solid blocks)
   */
  _isCaveSpace(chunk, lx, y, lz) {
    const checks = [
      // Above
      chunk.getBlock(lx, y + 1, lz),
      // Below
      chunk.getBlock(lx, y - 1, lz),
      // Left
      lx > 0 ? chunk.getBlock(lx - 1, y, lz) : BLOCK_TYPES.AIR,
      // Right
      lx < 15 ? chunk.getBlock(lx + 1, y, lz) : BLOCK_TYPES.AIR,
      // Front
      lz > 0 ? chunk.getBlock(lx, y, lz - 1) : BLOCK_TYPES.AIR,
      // Back
      lz < 15 ? chunk.getBlock(lx, y, lz + 1) : BLOCK_TYPES.AIR,
    ];

    // Need at least 3 solid neighbors to be "inside" a cave (not open surface)
    let solidCount = 0;
    for (const block of checks) {
      if (block !== BLOCK_TYPES.AIR && block !== BLOCK_TYPES.WATER) solidCount++;
    }
    return solidCount >= 3;
  }

  /**
   * Check if position is too close to existing torches
   */
  _isTooCloseToTorch(torchPositions, lx, y, lz) {
    for (const pos of torchPositions) {
      const [tx, ty, tz] = pos.split(',').map(Number);
      const dist = Math.abs(lx - tx) + Math.abs(y - ty) + Math.abs(lz - tz);
      if (dist <= this.torchMinSeparation) return true;
    }
    return false;
  }

  /**
   * Find a valid surface adjacent to an air position for torch placement.
   * Checks ceiling, floor, then walls in priority order.
   */
  _findTorchSurface(chunk, lx, y, lz) {
    const directions = [
      // Ceiling (torch on top of block above)
      { dx: 0, dy: 1, dz: 0 },
      // Floor (torch on top of block below)
      { dx: 0, dy: -1, dz: 0 },
      // Walls
      { dx: -1, dy: 0, dz: 0 },
      { dx: 1, dy: 0, dz: 0 },
      { dx: 0, dy: 0, dz: -1 },
      { dx: 0, dy: 0, dz: 1 },
    ];

    for (const dir of directions) {
      const nx = lx + dir.dx;
      const ny = y + dir.dy;
      const nz = lz + dir.dz;

      // Check bounds
      if (nx < 0 || nx >= 16 || nz < 0 || nz >= 16 || ny < MIN_Y || ny >= MAX_Y) continue;

      const neighborBlock = chunk.getBlock(nx, ny, nz);
      
      // Need a solid surface to attach to
      if (neighborBlock === BLOCK_TYPES.AIR || neighborBlock === BLOCK_TYPES.WATER) continue;

      // For ceiling: place torch on the block below (in the air space)
      if (dir.dy === 1) {
        return { x: lx, y: y, z: lz };
      }
      // For floor: place torch on top of the floor block
      if (dir.dy === -1) {
        // Torch goes in the air space above the floor block
        return { x: lx, y: y, z: lz };
      }
      // For walls: place torch on the wall face
      return { x: nx, y: ny, z: nz };
    }

    return null; // No valid surface found
  }

  /**
   * Count formations in a chunk (debug/stats utility)
   */
  countFormations(chunk) {
    let stalactites = 0;
    let stalagmites = 0;
    let torches = 0;

    for (let lx = 0; lx < CHUNK_WIDTH; lx++) {
      for (let lz = 0; lz < CHUNK_DEPTH; lz++) {
        for (let y = MIN_Y + 1; y < MAX_Y - 1; y++) {
          const block = chunk.getBlock(lx, y, lz);
          
          if (block === BLOCK_TYPES.CAVE_TORCH) {
            torches++;
            continue;
          }

          // Detect stalactite: stone block hanging from ceiling (stone above, air below)
          if (block === BLOCK_TYPES.STONE) {
            const above = chunk.getBlock(lx, y + 1, lz);
            const below = chunk.getBlock(lx, y - 1, lz);
            if (above !== BLOCK_TYPES.AIR && below === BLOCK_TYPES.AIR) {
              stalactites++;
              continue;
            }
            // Detect stalagmite: stone block rising from floor (stone below, air above)
            if (below !== BLOCK_TYPES.AIR && above === BLOCK_TYPES.AIR) {
              stalagmites++;
            }
          }
        }
      }
    }

    return { stalactites, stalagmites, torches };
  }
}

module.exports = CaveGenerator;
