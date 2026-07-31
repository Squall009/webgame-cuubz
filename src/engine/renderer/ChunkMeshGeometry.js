/**
 * Cuubz — ChunkMeshBuilder's THREE conversion and face estimate (PR 33)
 *
 * The second of the two cuts that brought `ChunkMeshBuilder.js` under the 400-line
 * ceiling. See `ChunkMeshBillboards.js` for the field-crossing table that chose both
 * seams; these two methods are the file's only ZERO-crossing group — neither reads a
 * single instance field — and `buildThreeGeometry` held every one of the file's 15
 * `THREE.` references, so after the move `ChunkMeshBuilder.js` does not import `three`
 * at all. That is the seam being real rather than convenient.
 *
 * They stay prototype methods rather than becoming free functions because both are
 * called as `chunkMeshBuilder.buildThreeGeometry(…)` / `.estimateFaceCount(…)` from
 * outside, and decision 44's rule is that a split moves bodies VERBATIM and keeps every
 * existing call site byte-identical. **One exception, stated rather than left to be
 * found:** `buildThreeGeometry` lost a `typeof THREE === 'undefined'` early return, which
 * was constant-false here because THREE is a static import — that is **D-27**, swept in
 * the same commit. Re-attached by
 * `Object.assign(ChunkMeshBuilder.prototype, …)` at the bottom of that file, behind the
 * load-time collision guard.
 */

import * as THREE from 'three';
// `estimateFaceCount` walks the chunk itself, so it needs the same dimension constants
// and the air ids `buildMeshData` uses. `no-undef` — not acorn — is what catches these
// going missing after a move; acorn parses an unbound identifier perfectly happily.
import { BLOCK_TYPES } from '../world/BlockRegistry.js';
import { CHUNK_DEPTH, CHUNK_WIDTH, MAX_Y, MIN_Y } from '../world/ChunkData.js';

export const ChunkMeshGeometryMethods = {
  /**
   * Build Three.js BufferGeometry from mesh data.
   */
  buildThreeGeometry(meshData, chunk) {
    // D-27: `if (typeof THREE === 'undefined') return null;` removed — constant-false.
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
      if (meshData.colors && meshData.colors.length > 0) {
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(meshData.colors, 3));
      }
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
      if (meshData.cutoutColors && meshData.cutoutColors.length > 0) {
        cutoutGeometry.setAttribute('color', new THREE.Float32BufferAttribute(meshData.cutoutColors, 3));
      }
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
      if (meshData.transparentColors && meshData.transparentColors.length > 0) {
        transGeometry.setAttribute('color', new THREE.Float32BufferAttribute(meshData.transparentColors, 3));
      }
      transGeometry.setIndex(meshData.transparentIndices);
      transGeometry.computeBoundingSphere(); // Required for raycasting
      result.transparentGeometry = transGeometry;
    }

    return result;
  },

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
  },
};
