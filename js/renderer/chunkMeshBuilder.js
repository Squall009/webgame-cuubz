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

    // Block type IDs that use cutout rendering (alpha test) — leaves, flowers, torches
    // These have binary alpha textures and should discard transparent pixels instead of blending.
    this.cutoutIds = new Set([
      BLOCK_TYPES.LEAVES,        // 33
      BLOCK_TYPES.RED_FLOWER,    // 42
      BLOCK_TYPES.YELLOW_FLOWER, // 43
      BLOCK_TYPES.CAVE_TORCH     // 44
    ]);

    // Block type IDs that use blended transparency — fluids + ice (partial alpha, opacity blend)
    this.transparentIds = new Set([
      BLOCK_TYPES.WATER,         // 7
      BLOCK_TYPES.ICE,           // 18
      BLOCK_TYPES.TOXIC_SLIME    // 37
    ]);

    // Combined set for face culling (any block that isn't fully solid/opaque)
    // Includes cutout blocks + transparent blocks + AIR + CAVE_AIR (both air-like types are non-solid)
    this.nonSolidIds = new Set([...this.cutoutIds, ...this.transparentIds, BLOCK_TYPES.AIR, BLOCK_TYPES.CAVE_AIR]);
  }

  /**
   * Build merged geometry from chunk data (separate solid + transparent)
   */
  buildMeshData(chunk, atlas, neighborLookup = null) {
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

    // Cutout geometry arrays — alpha-tested rendering (leaves, flowers, torches)
    const cutoutPositions = [];
    const cutoutNormals = [];
    const cutoutUvs = [];
    const cutoutIndices = [];
    let cutoutVertexIndex = 0;

    // Calculate chunk dimensions from block data
    const totalBlocks = chunk.blocks.length;
    const chunkHeight = CHUNK_HEIGHT; // Y: 0-255 (VoxelGen overhaul)
    const chunkZ = CHUNK_DEPTH;
    const chunkX = CHUNK_WIDTH;

    for (let x = 0; x < chunkX; x++) {
      for (let z = 0; z < chunkZ; z++) {
        for (let y = MIN_Y; y < MAX_Y; y++) {
          const blockType = chunk.getBlock(x, y, z);

          if (blockType === BLOCK_TYPES.AIR || blockType === BLOCK_TYPES.CAVE_AIR) continue; // Skip both air types

          const isCutout = this.cutoutIds.has(blockType);
          const isSelfTransparent = this.transparentIds.has(blockType);

          // Determine target arrays based on material type: solid / cutout / transparent
          let posArr, normArr, uvArr, idxArr;
          if (isCutout) {
            posArr = cutoutPositions;
            normArr = cutoutNormals;
            uvArr = cutoutUvs;
            idxArr = cutoutIndices;
          } else if (isSelfTransparent) {
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

          // DISABLED: fluid block / water level logic (tied to WaterFlowSystem)
          // All water/ice/lava/toxic_slime now use standard transparent face culling below.
          /*
          const hasWaterLevels = typeof chunk.getWaterLevel === 'function';
          const fluidBlockType = (blockType === BLOCK_TYPES.WATER || blockType === BLOCK_TYPES.LAVA);
          const waterLevel = hasWaterLevels && fluidBlockType ? chunk.getWaterLevel(x, y, z) : 0;
          const isSourceFluid = (waterLevel >= 8); // Level 8 = source (ocean/lake - flat surface)

          if (fluidBlockType && hasWaterLevels && !isSourceFluid) {
            this._buildFlowingFluidFace(x, y, z, blockType, waterLevel, chunk, atlas, posArr, normArr, uvArr, idxArr, neighborLookup, waterLevelLookup);
          } else if (fluidBlockType && hasWaterLevels && isSourceFluid) {
            this._buildSourceFluidFace(x, y, z, blockType, chunk, atlas, posArr, normArr, uvArr, idxArr, neighborLookup);
          } */

          // Standard solid/transparent/cutout block rendering — all blocks use this path now
            // Check each face for exposure (face culling)
            for (const face of this.faceNormals) {
              const nx = x + face.dir[0];
              const ny = y + face.dir[1];
              const nz = z + face.dir[2];

              let neighborBlock;
              if (nx >= 0 && nx < chunkX && ny >= MIN_Y && ny < MAX_Y && nz >= 0 && nz < chunkZ) {
                // Neighbor is within this chunk — fast local lookup
                neighborBlock = chunk.getBlock(nx, ny, nz);
              } else {
                // Neighbor is outside chunk bounds — use cross-chunk lookup or default to air
                if (neighborLookup) {
                  const worldX = chunk.cx * 16 + x;
                  const worldZ = chunk.cz * 16 + z;
                  neighborBlock = neighborLookup(worldX + face.dir[0], ny, worldZ + face.dir[2]);
                } else {
                  // No cross-chunk data available — draw the face to be safe
                  neighborBlock = BLOCK_TYPES.AIR;
                }
              }

              const isNeighborTransparent = this.nonSolidIds.has(neighborBlock);
              // Culling logic:
              // - Solid block: cull if neighbor is also solid (not air, not cutout, not transparent).
              // - Cutout block: cull only if neighbor is the SAME cutout block type.
              //   (leaves need to show through each other's alpha gaps)
              // - Transparent block: cull if neighbor is the SAME type OR if neighbor is SOLID.
              //   The solid block already draws its face toward the transparent neighbor,
              //   so drawing the transparent face too would create overlapping geometry at
              //   the exact same world position. Three.js raycast would hit whichever mesh
              //   was processed last, often the transparent mesh, causing block interaction bugs.
              if (isCutout || isSelfTransparent) {
                if (neighborBlock === blockType) {
                  continue; // Same-type non-solid blocks next to each other: cull face
                }
                // Cull transparent/cutout face when neighbor is a solid (opaque) block.
                // The solid block will draw its face toward us, so no overlap.
                if (neighborBlock !== BLOCK_TYPES.AIR && !isNeighborTransparent) {
                  continue; // Transparent/cutout face toward solid: cull (solid draws its own face)
                }
              } else { // Current block is solid
                if (neighborBlock !== BLOCK_TYPES.AIR && !isNeighborTransparent) {
                  continue; // Solid block next to solid block: cull face
                }
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
              let currentVIdx;
              if (isCutout) {
                currentVIdx = cutoutVertexIndex;
              } else if (isSelfTransparent) {
                currentVIdx = transparentVertexIndex;
              } else {
                currentVIdx = vertexIndex;
              }

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

              if (isCutout) {
                cutoutVertexIndex += 4;
              } else if (isSelfTransparent) {
                transparentVertexIndex += 4;
              } else {
                vertexIndex += 4;
              }

              // Sanity check: catch index drift early during development
              const targetArr = isCutout ? cutoutPositions : (isSelfTransparent ? transparentPositions : positions);
              if ((currentVIdx + 4) * 3 !== targetArr.length) {
                console.warn('[ChunkMeshBuilder] Vertex index drift detected!', {
                  currentVIdx, expected: targetArr.length / 3, isCutout, isSelfTransparent,
                  blockType, x, y, z
                });
              }
            }
        }
      }
    }

    // Return all three geometry streams
    const totalSolidFaces = indices.length / 6;
    const totalCutoutFaces = cutoutIndices.length / 6;
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
      `${totalSolidFaces} solid faces, ${totalCutoutFaces} cutout faces, ${totalTransFaces} transparent faces. Types:`, blockTypeCounts);

    return {
      positions, normals, uvs, indices,
      cutoutPositions, cutoutNormals, cutoutUvs, cutoutIndices,
      transparentPositions, transparentNormals, transparentUvs, transparentIndices
    };
  }

  /**
   /**
    * Render source (level-8) fluid as a flat surface.
    * Only renders top face + side faces at the edges of connected fluid bodies.
    */
   _buildSourceFluidFace(x, y, z, blockType, chunk, atlas, posArr, normArr, uvArr, idxArr, neighborLookup = null) {
     const getUV = (faceName) => {
       if (atlas && atlas.loaded) {
         const f = atlas.getFaceUV(blockType, faceName);
         return { u: f.u || 0, v: f.v || 0, size: f.size || (1.0 / 16) };
       }
       return { u: 0, v: 0, size: 1 };
     };

     // Start vertex index from current array length — each block appends to shared arrays
     let vIdx = posArr.length / 3;
     const addQuad = (verts, normal, faceName) => {
       const uvInfo = getUV(faceName);
       for (let i = 0; i < 4; i++) {
         posArr.push(x + verts[i][0], y + verts[i][1], z + verts[i][2]);
         normArr.push(normal[0], normal[1], normal[2]);
         const uvCoords = this.faceNormals.find(f => f.name === faceName)?.uvCoords || [[0,0],[1,0],[1,1],[0,1]];
         uvArr.push(uvInfo.u + uvCoords[i][0] * uvInfo.size, uvInfo.v + uvCoords[i][1] * uvInfo.size);
       }
       idxArr.push(vIdx, vIdx+1, vIdx+2, vIdx, vIdx+2, vIdx+3);
       vIdx += 4;
     };

     // Helper to query neighbor blocks (cross-chunk aware)
     const queryBlock = (nx, ny, nz) => {
       if (nx >= 0 && nx < 16 && nz >= 0 && nz < 16 && ny >= MIN_Y && ny < MAX_Y) {
         return chunk.getBlock(nx, ny, nz);
       }
       // Out of local chunk bounds — use cross-chunk lookup or default to air
       if (neighborLookup) {
         const worldX = chunk.chunkX * 16 + x;
         const worldZ = chunk.chunkZ * 16 + z;
         return neighborLookup(worldX + nx - x, ny, worldZ + nz - z);
       }
       return BLOCK_TYPES.AIR || 0;
     };

     // TOP face: only if air above (visible surface) — do NOT draw when another water block is on top
     {
       const above = queryBlock(x, y + 1, z);
       if (above === BLOCK_TYPES.AIR || above === 0) {
         addQuad([[0,1,1],[1,1,1],[1,1,0],[0,1,0]], [0, 1, 0], 'top');
       }
     }

     // SIDE faces: only if neighbor is NOT the same fluid type (edge of body)
     const sides = [
       { dir: [0, 0, 1], faceName: 'front', verts: [[0,0,1],[1,0,1],[1,1,1],[0,1,1]], normal: [0, 0, 1] },
       { dir: [0, 0,-1], faceName: 'back',  verts: [[1,0,0],[0,0,0],[0,1,0],[1,1,0]], normal: [0, 0,-1] },
       { dir: [1, 0, 0], faceName: 'right', verts: [[1,0,1],[1,0,0],[1,1,0],[1,1,1]], normal: [1, 0, 0] },
       { dir: [-1,0, 0], faceName: 'left',  verts: [[0,0,0],[0,0,1],[0,1,1],[0,1,0]], normal: [-1,0, 0] },
     ];

     for (const side of sides) {
       const nx = x + side.dir[0];
       const nz = z + side.dir[2];
       const neighborBlock = queryBlock(nx, y, nz);
       // Only render if neighbor is NOT the same fluid type — this creates the "edge" effect
       if (neighborBlock !== blockType) {
         addQuad(side.verts, side.normal, side.faceName);
       }
     }
   }

   /**
    * Render flowing fluid with sloped geometry based on water level and neighbors.
    * Level 1-7: partial height creates slope effect against terrain.
    * Top always at full height (y+1), sides blend down to neighbor levels or ground.
    * UVs are interpolated vertically so texture scales proportionally with height.
    */
   _buildFlowingFluidFace(x, y, z, blockType, waterLevel, chunk, atlas, posArr, normArr, uvArr, idxArr, neighborLookup = null, waterLevelLookup = null) {
     const getUV = (faceName) => {
       if (atlas && atlas.loaded) {
         const f = atlas.getFaceUV(blockType, faceName);
         return { u: f.u || 0, v: f.v || 0, size: f.size || (1.0 / 16) };
       }
       return { u: 0, v: 0, size: 1 };
     };

     // Start vertex index from current array length — each block appends to shared arrays
     let vIdx = posArr.length / 3;

     // Add a single triangle with per-vertex UVs for proper interpolation on slopes
     const addTriUV = (v0, uv0, v1, uv1, v2, uv2, normal) => {
       posArr.push(x + v0[0], y + v0[1], z + v0[2]);
       normArr.push(normal[0], normal[1], normal[2]);
       uvArr.push(uv0[0], uv0[1]);

       posArr.push(x + v1[0], y + v1[1], z + v1[2]);
       normArr.push(normal[0], normal[1], normal[2]);
       uvArr.push(uv1[0], uv1[1]);

       posArr.push(x + v2[0], y + v2[1], z + v2[2]);
       normArr.push(normal[0], normal[1], normal[2]);
       uvArr.push(uv2[0], uv2[1]);

       idxArr.push(vIdx, vIdx+1, vIdx+2);
       vIdx += 3;
     };

     // Add a quad split into two triangles with per-vertex UVs for slopes
     const addQuadUV = (v0, uv0, v1, uv1, v2, uv2, v3, uv3, normal) => {
       addTriUV(v0, uv0, v1, uv1, v2, uv2, normal);
       addTriUV(v0, uv0, v2, uv2, v3, uv3, normal);
     };

     // Helper: get effective fluid level for a neighbor (cross-chunk aware)
     const getNeighborLevel = (nx, ny, nz) => {
       // Try local chunk first
       if (nx >= 0 && nx < 16 && nz >= 0 && nz < 16 && ny >= MIN_Y && ny < MAX_Y) {
         const nb = chunk.getBlock(nx, ny, nz);
         if ((nb === BLOCK_TYPES.WATER || nb === BLOCK_TYPES.LAVA) && typeof chunk.getWaterLevel === 'function') {
           return Math.max(1, chunk.getWaterLevel(nx, ny, nz));
         }
       }
       // Try cross-chunk lookup
       if (waterLevelLookup) {
         const worldX = chunk.chunkX * 16 + x;
         const worldZ = chunk.chunkZ * 16 + z;
         return Math.max(0, waterLevelLookup(worldX + nx - x, ny, worldZ + nz - z));
       }
       return 0; // Not fluid or lookup unavailable
     };

     // Helper: query neighbor block (cross-chunk aware)
     const queryBlock = (nx, ny, nz) => {
       if (nx >= 0 && nx < 16 && nz >= 0 && nz < 16 && ny >= MIN_Y && ny < MAX_Y) {
         return chunk.getBlock(nx, ny, nz);
       }
       if (neighborLookup) {
         const worldX = chunk.chunkX * 16 + x;
         const worldZ = chunk.chunkZ * 16 + z;
         return neighborLookup(worldX + nx - x, ny, worldZ + nz - z);
       }
       return BLOCK_TYPES.AIR || 0;
     };

     // Convert water level (1-7) to height fraction
     const thisHeight = Math.max(0.125, waterLevel / 8);

     // Base UV info for side faces
     const sideUVInfo = getUV('front'); // Use 'front' as default for all sides
     const topUVInfo = getUV('top');

     // TOP face: always at full block height — only if air above (visible surface)
     {
       const above = queryBlock(x, y + 1, z);
       if (above === BLOCK_TYPES.AIR || above === 0) {
         addQuadUV(
           [0, 1, 1], [topUVInfo.u, topUVInfo.v],
           [1, 1, 1], [topUVInfo.u + topUVInfo.size, topUVInfo.v],
           [1, 1, 0], [topUVInfo.u + topUVInfo.size, topUVInfo.v + topUVInfo.size],
           [0, 1, 0], [topUVInfo.u, topUVInfo.v + topUVInfo.size],
           [0, 1, 0]
         );
       }
     }

     // SIDE faces: sloped based on neighbor fluid levels vs this level
     const sides = [
       { dir: [0, 0, 1], faceName: 'front', axis: 'z', sign: 1 },
       { dir: [0, 0,-1], faceName: 'back',  axis: 'z', sign: -1 },
       { dir: [1, 0, 0], faceName: 'right', axis: 'x', sign: 1 },
       { dir: [-1,0, 0], faceName: 'left',  axis: 'x', sign: -1 },
     ];

     for (const side of sides) {
       const nx = x + side.dir[0];
       const nz = z + side.dir[2];
       const neighborBlock = queryBlock(nx, y, nz);

       // Skip if solid block next to us — don't render into terrain
       if (neighborBlock !== BLOCK_TYPES.AIR && !this.nonSolidIds.has(neighborBlock)) {
         continue;
       }

       const neighborLevel = getNeighborLevel(nx, y, nz);

       if (neighborLevel === 0) {
         // Neighbor is air/solid: render side face from bottom to this water height
         const h = thisHeight;
         const uvH = sideUVInfo.v + h * sideUVInfo.size; // UV scales with height
        
         let v0, uv0, v1, uv1, v2, uv2, v3, uv3;
         if (side.axis === 'z' && side.sign > 0) {
           v0=[0,0,1]; uv0=[sideUVInfo.u, sideUVInfo.v];
           v1=[1,0,1]; uv1=[sideUVInfo.u + sideUVInfo.size, sideUVInfo.v];
           v2=[1,h,1]; uv2=[sideUVInfo.u + sideUVInfo.size, uvH];
           v3=[0,h,1]; uv3=[sideUVInfo.u, uvH];
         } else if (side.axis === 'z' && side.sign < 0) {
           v0=[1,0,0]; uv0=[sideUVInfo.u + sideUVInfo.size, sideUVInfo.v];
           v1=[0,0,0]; uv1=[sideUVInfo.u, sideUVInfo.v];
           v2=[0,h,0]; uv2=[sideUVInfo.u, uvH];
           v3=[1,h,0]; uv3=[sideUVInfo.u + sideUVInfo.size, uvH];
         } else if (side.axis === 'x' && side.sign > 0) {
           v0=[1,0,1]; uv0=[sideUVInfo.u, sideUVInfo.v];
           v1=[1,0,0]; uv1=[sideUVInfo.u + sideUVInfo.size, sideUVInfo.v];
           v2=[1,h,0]; uv2=[sideUVInfo.u + sideUVInfo.size, uvH];
           v3=[1,h,1]; uv3=[sideUVInfo.u, uvH];
         } else {
           v0=[0,0,0]; uv0=[sideUVInfo.u + sideUVInfo.size, sideUVInfo.v];
           v1=[0,0,1]; uv1=[sideUVInfo.u, sideUVInfo.v];
           v2=[0,h,1]; uv2=[sideUVInfo.u, uvH];
           v3=[0,h,0]; uv3=[sideUVInfo.u + sideUVInfo.size, uvH];
         }
         addQuadUV(v0,uv0,v1,uv1,v2,uv2,v3,uv3, side.dir);

       } else if (neighborLevel < waterLevel) {
         // Neighbor has lower level: render sloped face from neighbor height to this height
         const nHeight = Math.max(0.125, neighborLevel / 8);
         const h = thisHeight;
        
         let v0, uv0, v1, uv1, v2, uv2, v3, uv3;
         if (side.axis === 'z' && side.sign > 0) {
           v0=[0,nHeight,1]; uv0=[sideUVInfo.u, sideUVInfo.v + nHeight * sideUVInfo.size];
           v1=[1,nHeight,1]; uv1=[sideUVInfo.u + sideUVInfo.size, sideUVInfo.v + nHeight * sideUVInfo.size];
           v2=[1,h,1];     uv2=[sideUVInfo.u + sideUVInfo.size, sideUVInfo.v + h * sideUVInfo.size];
           v3=[0,h,1];     uv3=[sideUVInfo.u, sideUVInfo.v + h * sideUVInfo.size];
         } else if (side.axis === 'z' && side.sign < 0) {
           v0=[1,nHeight,0]; uv0=[sideUVInfo.u + sideUVInfo.size, sideUVInfo.v + nHeight * sideUVInfo.size];
           v1=[0,nHeight,0]; uv1=[sideUVInfo.u, sideUVInfo.v + nHeight * sideUVInfo.size];
           v2=[0,h,0];     uv2=[sideUVInfo.u, sideUVInfo.v + h * sideUVInfo.size];
           v3=[1,h,0];     uv3=[sideUVInfo.u + sideUVInfo.size, sideUVInfo.v + h * sideUVInfo.size];
         } else if (side.axis === 'x' && side.sign > 0) {
           v0=[1,nHeight,1]; uv0=[sideUVInfo.u, sideUVInfo.v + nHeight * sideUVInfo.size];
           v1=[1,nHeight,0]; uv1=[sideUVInfo.u + sideUVInfo.size, sideUVInfo.v + nHeight * sideUVInfo.size];
           v2=[1,h,0];     uv2=[sideUVInfo.u + sideUVInfo.size, sideUVInfo.v + h * sideUVInfo.size];
           v3=[1,h,1];     uv3=[sideUVInfo.u, sideUVInfo.v + h * sideUVInfo.size];
         } else {
           v0=[0,nHeight,0]; uv0=[sideUVInfo.u + sideUVInfo.size, sideUVInfo.v + nHeight * sideUVInfo.size];
           v1=[0,nHeight,1]; uv1=[sideUVInfo.u, sideUVInfo.v + nHeight * sideUVInfo.size];
           v2=[0,h,1];     uv2=[sideUVInfo.u, sideUVInfo.v + h * sideUVInfo.size];
           v3=[0,h,0];     uv3=[sideUVInfo.u + sideUVInfo.size, sideUVInfo.v + h * sideUVInfo.size];
         }
         addQuadUV(v0,uv0,v1,uv1,v2,uv2,v3,uv3, side.dir);
       }
       // If neighbor level >= this level: don't render (neighbor covers us)
     }

     // BOTTOM face: only if there's air below (waterfall edge / exposed bottom)
     {
       const below = queryBlock(x, y - 1, z);
       if (below === BLOCK_TYPES.AIR || this.nonSolidIds.has(below)) {
         addQuadUV(
           [0,0,0], [sideUVInfo.u, sideUVInfo.v],
           [1,0,0], [sideUVInfo.u + sideUVInfo.size, sideUVInfo.v],
           [1,0,1], [sideUVInfo.u + sideUVInfo.size, sideUVInfo.v + sideUVInfo.size],
           [0,0,1], [sideUVInfo.u, sideUVInfo.v + sideUVInfo.size],
           [0,-1, 0]
         );
       }
     }
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
    if (meshData.indices.length === 0 && (!meshData.cutoutIndices || meshData.cutoutIndices.length === 0) && (!meshData.transparentIndices || meshData.transparentIndices.length === 0)) {
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
      geometry.computeBoundingSphere(); // Required for raycasting
      result.solidGeometry = geometry;
    }

    // Build cutout geometry (leaves, flowers, torches) — alpha-tested rendering
    if (meshData.cutoutIndices && meshData.cutoutIndices.length > 0) {
      const cutoutGeometry = new THREE.BufferGeometry();
      cutoutGeometry.setAttribute('position', new THREE.Float32BufferAttribute(meshData.cutoutPositions, 3));
      cutoutGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(meshData.cutoutNormals, 3));
      cutoutGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(meshData.cutoutUvs, 2));
      cutoutGeometry.setIndex(meshData.cutoutIndices);
      cutoutGeometry.computeBoundingSphere(); // Required for raycasting
      result.cutoutGeometry = cutoutGeometry;
    }

    // Build transparent geometry (water, ice, toxic slime) — opacity blending
    if (meshData.transparentIndices && meshData.transparentIndices.length > 0) {
      const transGeometry = new THREE.BufferGeometry();
      transGeometry.setAttribute('position', new THREE.Float32BufferAttribute(meshData.transparentPositions, 3));
      transGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(meshData.transparentNormals, 3));
      transGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(meshData.transparentUvs, 2));
      transGeometry.setIndex(meshData.transparentIndices);
      transGeometry.computeBoundingSphere(); // Required for raycasting
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
          if (blockType === BLOCK_TYPES.AIR || blockType === BLOCK_TYPES.CAVE_AIR) continue;

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
