/**
 * Cuubz — Chunk Mesh Builder
 * Face-culled merged geometry per chunk (single draw call).
 * Uses TextureAtlas for proper UV mapping based on block type.
 */

// PR 33: `three` is no longer imported here. Every one of this file's 15 `THREE.`
// references was inside `buildThreeGeometry`, which now lives in `./ChunkMeshGeometry.js`.
import { BLOCK_TYPES } from '../world/BlockRegistry.js';
import { CHUNK_DEPTH, CHUNK_HEIGHT, CHUNK_WIDTH, MAX_Y, MIN_Y } from '../world/ChunkData.js';
// D-74: `HORIZONTAL_FACES` was imported here for `_buildSourceFluidFace`, which is gone.
// The EXPORT stays in FaceTable.js — `test/unit/engine/meshTables.test.js:130` asserts
// its shape, and that assertion is the thing keeping FACE_TABLE's order honest.
import { FACE_TABLE } from '../../game/data/FaceTable.js';
import {
  AIR_IDS,
  BLOCK_COLOR_MULTIPLIERS,
  CUTOUT_IDS,
  EMISSIVE_BLOCKS,
  SPECIAL_MESH_TYPES,
  TINTABLE_IDS,
  TRANSPARENT_IDS,
} from '../../game/data/BlockCategories.js';
// PR 33: `_addCrossbillboard` and `_addTopFace` live in their own file for the 400-line
// ceiling and are put back on the prototype at the bottom of this one. See that file's
// header for the field-crossing measurement that chose the seam (decision 44).
import { ChunkMeshBillboardMethods } from './ChunkMeshBillboards.js';
import { ChunkMeshGeometryMethods } from './ChunkMeshGeometry.js';

export class ChunkMeshBuilder {
  constructor() {
    // The face table and every id set below now come from `src/game/data/` — the SAME
    // module objects `ChunkMeshCoordinator` puts in the mesh worker's build message
    // (BUGS.md D-63). Main thread and worker no longer agree by coincidence; they read
    // one derivation of one registry. See src/game/data/BlockCategories.js.
    this.faceNormals = FACE_TABLE;

    this.cutoutIds = new Set(CUTOUT_IDS);
    this.transparentIds = new Set(TRANSPARENT_IDS);
    this.emissiveBlocks = new Map(EMISSIVE_BLOCKS);

    // Combined set for face culling (any block that isn't fully solid/opaque)
    this.nonSolidIds = new Set([...this.cutoutIds, ...this.transparentIds, ...AIR_IDS]);

    // Block types that receive humidity-based vertex color tinting
    this.tintableIds = new Set(TINTABLE_IDS);

    // Special mesh types: block ID → { type, height }
    // 'crossbillboard' = two vertical planes forming an X (grass)
    // 'topface' = single top face near the ground (flowers)
    this.specialMeshTypes = new Map(SPECIAL_MESH_TYPES);

    // Block color map: block ID → [r, g, b] for blocks with explicit color multipliers
    this.colorMap = new Map(BLOCK_COLOR_MULTIPLIERS);
  }

  /**
   * Build merged geometry from chunk data (separate solid + transparent)
   */
  buildMeshData(chunk, atlas, neighborLookup = null) {
    // Solid geometry arrays
    const positions = [];
    const normals = [];
    const uvs = [];
    const colors = [];
    const indices = [];
    let vertexIndex = 0;

    // Transparent geometry arrays (for separate render pass with depth sorting)
    const transparentPositions = [];
    const transparentNormals = [];
    const transparentUvs = [];
    const transparentColors = [];
    const transparentIndices = [];
    let transparentVertexIndex = 0;

    // Cutout geometry arrays — alpha-tested rendering (leaves, flowers, torches)
    const cutoutPositions = [];
    const cutoutNormals = [];
    const cutoutUvs = [];
    const cutoutColors = [];
    const cutoutIndices = [];
    let cutoutVertexIndex = 0;

    // Humidity-to-color gradient: dry (0) → yellow-green, moist (1) → lush green
    const humidityColor = (h) => {
      if (h < 0) h = 0;
      if (h > 1) h = 1;
      const r = 1.0 - h * 0.45;  // 1.0 → 0.55
      const g = 0.85 + h * 0.15; // 0.85 → 1.0
      const b = 0.45;
      return [r, g, b];
    };

    const getVertexColor = (lx, lz, blockType) => {
      if (!this.tintableIds.has(blockType)) return [1.0, 1.0, 1.0];
      if (!chunk.humidityMap) return [1.0, 1.0, 1.0];
      const h = chunk.humidityMap[lx * 16 + lz];
      return humidityColor(h);
    };

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

          // D-74: a 13-line commented-out fluid dispatch stood here, calling
          // `_buildFlowingFluidFace` / `_buildSourceFluidFace` behind a `WaterFlowSystem`
          // that does not exist in the tree. It was the ONLY call site of either method,
          // so both were unreachable; PR 33 deleted the comment and all 253 lines of the
          // two methods. Water, ice, lava and toxic slime go through the standard
          // transparent face culling below and always did.

          // Special mesh types: crossbillboard (grass X-shape) and topface (flowers)
          const meshInfo = this.specialMeshTypes.get(blockType);
          if (meshInfo) {
            const colorArr = isCutout ? cutoutColors : (isSelfTransparent ? transparentColors : colors);
            const vColor = getVertexColor(x, z, blockType);
            if (meshInfo.type === 'crossbillboard') {
              this._addCrossbillboard(x, y, z, blockType, atlas, posArr, normArr, uvArr, colorArr, idxArr, vColor, 'side');
            } else if (meshInfo.type === 'crossbillboard_stacked') {
              // Bottom layer uses 'bottom' face texture, top layer uses 'side'
              this._addCrossbillboard(x, y, z, blockType, atlas, posArr, normArr, uvArr, colorArr, idxArr, vColor, 'bottom');
              this._addCrossbillboard(x, y + 1, z, blockType, atlas, posArr, normArr, uvArr, colorArr, idxArr, vColor, 'side');
            } else if (meshInfo.type === 'topface') {
              this._addTopFace(x, y, z, blockType, atlas, posArr, normArr, uvArr, colorArr, idxArr, vColor);
            }
            continue; // Skip standard face loop
          }

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
                uvSize = faceUV.size || atlas.uvTileSize();
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

              // Add quad vertices with proper UVs and vertex colors
              const vColor = getVertexColor(x, z, blockType);
              for (let i = 0; i < 4; i++) {
                const vertex = face.vertices[i];
                posArr.push(x + vertex[0], y + vertex[1], z + vertex[2]);
                normArr.push(face.dir[0], face.dir[1], face.dir[2]);

                // Apply atlas UV mapping
                const localUV = face.uvCoords[i];
                uvArr.push(uvU + localUV[0] * uvSize, uvV + localUV[1] * uvSize);

                // Vertex color (humidity-based tint for grass/leaves)
                const colorArr = isCutout ? cutoutColors : (isSelfTransparent ? transparentColors : colors);
                colorArr.push(vColor[0], vColor[1], vColor[2]);
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
      positions, normals, uvs, colors, indices,
      cutoutPositions, cutoutNormals, cutoutUvs, cutoutColors, cutoutIndices,
      transparentPositions, transparentNormals, transparentUvs, transparentColors, transparentIndices
    };
  }

  /**
   * Check if a block type is transparent (for face culling)
   */
  _isTransparent(blockType) {
    return this.transparentIds.has(blockType);
  }
}

// ============================================================
// PROTOTYPE MIXINS — the method groups, put back on the class
// ============================================================
//
// Decision 44, and the same idiom as `ChunkManager.js` and `InventorySystem.js`. The
// guard throws at MODULE LOAD if a mixin and the class body ever define the same method
// name: a silent overwrite is the one failure mode a mixin split has that a single class
// does not, and it is the shared-global-scope collision class that refactor.md §2 and
// `test/unit/meta/globalCollisions.test.js` exist for. `Object.assign` copies own
// enumerable properties, which is exactly what an object literal's methods are.
const MIXINS = [
  ['ChunkMeshBillboards', ChunkMeshBillboardMethods],
  ['ChunkMeshGeometry', ChunkMeshGeometryMethods],
];

{
  const seen = new Map();
  for (const [file, methods] of MIXINS) {
    for (const name of Object.keys(methods)) {
      const prior = seen.get(name) ||
        (Object.prototype.hasOwnProperty.call(ChunkMeshBuilder.prototype, name) ? 'the class body' : null);
      if (prior) {
        throw new Error(`[ChunkMeshBuilder] Mixin collision: '${name}' is defined by both ` +
          `${prior} and ${file}.js. Two files cannot own the same method.`);
      }
      seen.set(name, file + '.js');
    }
  }
}

Object.assign(ChunkMeshBuilder.prototype, ...MIXINS.map(([, methods]) => methods));
