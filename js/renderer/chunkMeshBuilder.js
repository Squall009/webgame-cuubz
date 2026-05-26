/**
 * Cuubz — Chunk Mesh Builder
 * Face-culled merged geometry per chunk (single draw call).
 */

class ChunkMeshBuilder {
  constructor() {
    this.faceNormals = [
      { dir: [0, 1, 0],  vertices: [[0,1,1],[1,1,1],[1,1,0],[0,1,0]], name: 'top' },     // +Y
      { dir: [0,-1, 0],  vertices: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]], name: 'bottom' },  // -Y
      { dir: [0, 0, 1],  vertices: [[0,0,1],[1,0,1],[1,1,1],[0,1,1]], name: 'front' },   // +Z
      { dir: [0, 0,-1],  vertices: [[1,0,0],[0,0,0],[0,1,0],[1,1,0]], name: 'back' },    // -Z
      { dir: [1, 0, 0],  vertices: [[1,0,1],[1,0,0],[1,1,0],[1,1,1]], name: 'right' },   // +X
      { dir: [-1,0, 0],  vertices: [[0,0,0],[0,0,1],[0,1,1],[0,1,0]], name: 'left' },    // -X
    ];
    
    // UV coordinates for texture atlas (4x4 grid, each tex = 0.25)
    this.uvMap = {};
  }

  /**
   * Build merged geometry from chunk data
   * @param {Chunk} chunk - Chunk data structure
   * @returns {Object} Geometry data: positions, normals, uvs, indices
   */
  buildMeshData(chunk) {
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    
    let vertexIndex = 0;
    
    for (let x = 0; x < chunk.blocks.length / (16 * 96); x++) {
      for (let z = 0; z < 16; z++) {
        for (let y = -32; y <= 64; y++) {
          const blockType = chunk.getBlock(x, y, z);
          
          if (blockType === 0) continue; // Skip air
          
          // Check each face for exposure
          for (const face of this.faceNormals) {
            const nx = x + face.dir[0];
            const ny = y + face.dir[1];
            const nz = z + face.dir[2];
            
            const neighborBlock = chunk.getBlock(nx, ny, nz);
            const isTransparent = this._isTransparent(neighborBlock);
            const isSelfTransparent = this._isTransparent(blockType);
            
            // Render face if neighbor is air/transparent (or self is transparent)
            if (isTransparent || isSelfTransparent) {
              // Add quad vertices
              for (const vertex of face.vertices) {
                positions.push(x + vertex[0], y + vertex[1], z + vertex[2]);
                normals.push(face.dir[0], face.dir[1], face.dir[2]);
                
                // UV coordinates (simple 0-1 mapping per face for now)
                const u = vertex[0];
                const v = vertex[1];
                uvs.push(u, 1 - v);
              }
              
              // Add triangle indices
              indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);
              indices.push(vertexIndex, vertexIndex + 2, vertexIndex + 3);
              
              vertexIndex += 4;
            }
          }
        }
      }
    }
    
    return { positions, normals, uvs, indices };
  }

  /**
   * Check if a block type is transparent (for face culling)
   */
  _isTransparent(blockType) {
    // Block types that are transparent: air, water, leaves, lava, toxic slime, flowers, torches
    const transparentTypes = [0, 6, 8, 15, 17, 27, 28, 29]; // AIR, WATER, LEAVES, LAVA, TOXIC_SLIME, RED_FLOWER, YELLOW_FLOWER, CAVE_TORCH
    return transparentTypes.includes(blockType);
  }

  /**
   * Build Three.js BufferGeometry from mesh data
   */
  buildThreeGeometry(meshData) {
    if (typeof THREE === 'undefined') return null;
    
    const geometry = new THREE.BufferGeometry();
    
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(meshData.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(meshData.normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(meshData.uvs, 2));
    
    if (meshData.indices.length > 0) {
      geometry.setIndex(meshData.indices);
    }
    
    return geometry;
  }

  /**
   * Get face count estimate for a chunk
   */
  estimateFaceCount(chunk) {
    let faces = 0;
    const total = chunk.blocks.length / (16 * 96);
    
    for (let x = 0; x < total; x++) {
      for (let z = 0; z < 16; z++) {
        for (let y = -32; y <= 64; y++) {
          const blockType = chunk.getBlock(x, y, z);
          if (blockType === 0) continue;
          
          // Count exposed faces (simplified — doesn't check neighbors)
          faces += 6;
        }
      }
    }
    
    return faces;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ChunkMeshBuilder;

}