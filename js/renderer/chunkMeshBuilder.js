/**
 * Cuubz — Chunk Mesh Builder
 * Face-culled merged geometry per chunk (single draw call).
 * Uses TextureAtlas for proper UV mapping based on block type.
 */

class ChunkMeshBuilder {
  constructor() {
    this.faceNormals = [
      { dir: [0, 1, 0],  vertices: [[0,1,1],[1,1,1],[1,1,0],[0,1,0]], uvCoords: [[0,0],[1,0],[1,1],[0,1]], name: 'top' },
      { dir: [0,-1, 0],  vertices: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]], uvCoords: [[0,1],[1,1],[1,0],[0,0]], name: 'bottom' },
      { dir: [0, 0, 1],  vertices: [[0,0,1],[1,0,1],[1,1,1],[0,1,1]], uvCoords: [[0,0],[1,0],[1,1],[0,1]], name: 'front' },
      { dir: [0, 0,-1],  vertices: [[1,0,0],[0,0,0],[0,1,0],[1,1,0]], uvCoords: [[0,0],[1,0],[1,1],[0,1]], name: 'back' },
      { dir: [1, 0, 0],  vertices: [[1,0,1],[1,0,0],[1,1,0],[1,1,1]], uvCoords: [[0,0],[1,0],[1,1],[0,1]], name: 'right' },
      { dir: [-1,0, 0],  vertices: [[0,0,0],[0,0,1],[0,1,1],[0,1,0]], uvCoords: [[0,0],[1,0],[1,1],[0,1]], name: 'left' },
    ];

    // Transparent block type IDs (for face culling) — matches BLOCK_PROPERTIES in chunkData.js
    this.transparentIds = new Set([0, 6, 8, 15, 17, 24, 26, 27, 28, 29]);
  }

  /**
   * Build merged geometry from chunk data (separate solid + transparent)
   * @param {Chunk} chunk - Chunk data structure
   * @param {TextureAtlas} atlas - Optional texture atlas for UV mapping
   * @returns {Object} Geometry data: positions, normals, uvs, indices, transparentPositions, etc.
   */
  buildMeshData(chunk, atlas) {
    // Solid geometry arrays
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    let vertexIndex = 0;

    // Transparent geometry arrays (for separate render pass with depth sorting)
    const transparentPositions = [];
    const transparentNormals = [];
    const transparentUvs = [];
    const transparentIndices = [];
    let transparentVertexIndex = 0;

    // Calculate chunk dimensions from block data
    const totalBlocks = chunk.blocks.length;
    const chunkHeight = CHUNK_HEIGHT; // Y: 0-95
    const chunkZ = CHUNK_DEPTH;
    const chunkX = CHUNK_WIDTH;

    for (let x = 0; x < chunkX; x++) {
      for (let z = 0; z < chunkZ; z++) {
        for (let y = MIN_Y; y < MAX_Y; y++) {
          const blockType = chunk.getBlock(x, y, z);

          if (blockType === 0) continue; // Skip air

          const isSelfTransparent = this.transparentIds.has(blockType);

          // Determine target arrays based on transparency
          let posArr, normArr, uvArr, idxArr;
          if (isSelfTransparent) {
            posArr = transparentPositions;
            normArr = transparentNormals;
            uvArr = transparentUvs;
            idxArr = transparentIndices;
          } else {
            posArr = positions;
            normArr = normals;
            uvArr = uvs;
            idxArr = indices;
          }

          // Check each face for exposure (face culling)
          for (const face of this.faceNormals) {
            const nx = x + face.dir[0];
            const ny = y + face.dir[1];
            const nz = z + face.dir[2];

            const neighborBlock = chunk.getBlock(nx, ny, nz);
            const isNeighborTransparent = this.transparentIds.has(neighborBlock);
            if (!isSelfTransparent && neighborBlock !== 0 && !isNeighborTransparent) {
              continue; // Face is hidden — skip it
            }

            // Get UV offset/scale from atlas using numeric block ID (dynamic, no hardcoded mapping)
            let uvU, uvV, uvSize;
            if (atlas && atlas.loaded) {
              const faceUV = atlas.getFaceUV(blockType, face.name);
              uvU = faceUV.u || 0;
              uvV = faceUV.v || 0;
              uvSize = faceUV.size || (1.0 / 16);
            } else {
              // Fallback: simple 0-1 UV per face
              uvU = 0;
              uvV = 0;
              uvSize = 1;
            }

            // Read the CURRENT vertex index for this face (live counter, not a snapshot)
            const currentVIdx = isSelfTransparent ? transparentVertexIndex : vertexIndex;

            // Add quad vertices with proper UVs
            for (let i = 0; i < 4; i++) {
              const vertex = face.vertices[i];
              posArr.push(x + vertex[0], y + vertex[1], z + vertex[2]);
              normArr.push(face.dir[0], face.dir[1], face.dir[2]);

              // Apply atlas UV mapping
              const localUV = face.uvCoords[i];
              uvArr.push(uvU + localUV[0] * uvSize, uvV + localUV[1] * uvSize);
            }

            // Add triangle indices using the live counter value for this face
            idxArr.push(currentVIdx, currentVIdx + 1, currentVIdx + 2);
            idxArr.push(currentVIdx, currentVIdx + 2, currentVIdx + 3);

            if (isSelfTransparent) {
              transparentVertexIndex += 4;
            } else {
              vertexIndex += 4;
            }
          }
        }
      }
    }

    // Return both solid and transparent geometry data
    const totalSolidFaces = indices.length / 6;
    const totalTransFaces = transparentIndices.length / 6;

    // Debug: count block types in this chunk
    const blockTypeCounts = {};
    for (let x = 0; x < CHUNK_WIDTH; x++) {
      for (let z = 0; z < CHUNK_DEPTH; z++) {
        for (let y = MIN_Y; y < MAX_Y; y++) {
          const bt = chunk.getBlock(x, y, z);
          if (bt !== 0) {
            blockTypeCounts[bt] = (blockTypeCounts[bt] || 0) + 1;
          }
        }
      }
    }

    console.log(`[MeshBuilder] Chunk ${chunk.chunkX},${chunk.chunkZ}: ${Object.keys(blockTypeCounts).length} block types, ` +
      `${totalSolidFaces} solid faces, ${totalTransFaces} transparent faces. Types:`, blockTypeCounts);

    return { 
      positions, normals, uvs, indices,
      transparentPositions, transparentNormals, transparentUvs, transparentIndices
    };
  }

  /**
   * Check if a block type is transparent (for face culling)
   */
  _isTransparent(blockType) {
    return this.transparentIds.has(blockType);
  }

  /**
   * Build Three.js BufferGeometry from mesh data.
   */
  buildThreeGeometry(meshData, chunk) {
    if (typeof THREE === 'undefined') return null;

    // Skip empty chunks (all air) — no geometry to build
    if (meshData.indices.length === 0 && (!meshData.transparentIndices || meshData.transparentIndices.length === 0)) {
      return null;
    }

    const result = {};

    // Build solid geometry from mesh data
    if (meshData.indices.length > 0) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(meshData.positions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(meshData.normals, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(meshData.uvs, 2));
      geometry.setIndex(meshData.indices);
      result.solidGeometry = geometry;
    }

    // Build transparent geometry (water, lava, leaves) separately
    if (meshData.transparentIndices && meshData.transparentIndices.length > 0) {
      const transGeometry = new THREE.BufferGeometry();
      transGeometry.setAttribute('position', new THREE.Float32BufferAttribute(meshData.transparentPositions, 3));
      transGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(meshData.transparentNormals, 3));
      transGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(meshData.transparentUvs, 2));
      transGeometry.setIndex(meshData.transparentIndices);
      result.transparentGeometry = transGeometry;
    }

    return result;
  }

  /**
   * Get face count estimate for a chunk
   */
  estimateFaceCount(chunk) {
    let faces = 0;

    for (let x = 0; x < CHUNK_WIDTH; x++) {
      for (let z = 0; z < CHUNK_DEPTH; z++) {
        for (let y = MIN_Y; y < MAX_Y; y++) {
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
