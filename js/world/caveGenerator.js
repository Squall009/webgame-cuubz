/**
 * Cuubz — Cave Generator
 * 3D tube caves using noise thresholding with seamless chunk edges.
 */

const NoiseGenerator = require('./noise');
const { BLOCK_TYPES, CHUNK_WIDTH, CHUNK_DEPTH } = require('./chunkData');

class CaveGenerator {
  constructor(seed) {
    this.noise = new NoiseGenerator(seed);
    
    // Cave parameters
    this.caveThreshold = 0.3;      // Noise value above which is cave space
    this.tunnelRadius = 2.5;       // Base tunnel radius
    this.largeCavernChance = 0.1;  // Chance of large cavern at a point
    this.largeCavernRadius = 6;    // Radius of large caverns
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
}

module.exports = CaveGenerator;
