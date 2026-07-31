/**
 * Cuubz — ChunkMeshBuilder's two billboard emitters (PR 33)
 *
 * Split out of `src/engine/renderer/ChunkMeshBuilder.js` for the 400-line ceiling, and
 * for no other reason. **D-74** deleted 253 lines of unreachable fluid code from that
 * file (759 → 500) but 500 is still 100 over, so one more cut was owed.
 *
 * ─── WHY THIS SEAM (decision 44) ────────────────────────────────────────────
 *
 * The cut is chosen by field-crossing count, measured over every method in the file:
 *
 *   constructor          8 fields (it writes them all)
 *   buildMeshData        8 fields  — the main loop; cannot leave
 *   _addCrossbillboard   0 fields  ← here
 *   _addTopFace          1 field   ← here (`this.colorMap`)
 *   buildThreeGeometry   0 fields
 *   estimateFaceCount    0 fields
 *   _isTransparent       1 field
 *
 * These two are the largest group with the fewest crossings — 119 lines for ONE field
 * reference. They are also a real unit: both emit a non-cube mesh for a `meshType`
 * block (grass X-planes, flower top-faces), both are called only from
 * `buildMeshData`'s `specialMeshTypes` branch, and both take every array they write to
 * as a parameter.
 *
 * ─── PROTOTYPE MIXIN, NOT A MODULE OF FUNCTIONS ─────────────────────────────
 *
 * Decision 44: a class whose instance fields are shared across the cut is split with
 * `Object.assign(Class.prototype, …)`, bodies moved VERBATIM. `_addTopFace` reads
 * `this.colorMap` and `buildMeshData` calls `this._addCrossbillboard`/`this._addTopFace`,
 * so both halves must keep seeing one `this`. `ChunkManager.js` and
 * `InventorySystem.js` are the worked examples; `ChunkMeshBuilder.js` carries the same
 * load-time collision guard, which throws if this file and the class body ever define
 * the same method name.
 *
 * **The bodies moved verbatim EXCEPT for one edit, stated here rather than left to be
 * found:** both replaced the hard-coded `(1.0 / 16)` missing-atlas UV fallback with
 * `atlas.uvTileSize(...)`, which is **D-74**'s fix — the worker answered the same
 * question with `1.0 / 6` and drew a missing-atlas face at 2.7× its tile footprint. That
 * is the only behaviour change in this file, and `test/unit/engine/meshTables.test.js`
 * section 7 is the net under it: it calls `_addCrossbillboard` directly and asserts all
 * three split files carry no `1.0 / 16` literal.
 */

export const ChunkMeshBillboardMethods = {
  /**
   * Build a crossbillboard (two vertical 1×1 planes forming an X) for grass blocks.
   * Two planes, each double-sided, crossing at the block center.
   * Each plane is full cube-face size (1×1 units).
   * @param {number} x - Block X
   * @param {number} y - Block Y
   * @param {number} z - Block Z
   * @param {number} blockType - Block ID for texture lookup
   * @param {object} atlas - Texture atlas
   * @param {array} posArr - Position array
   * @param {array} normArr - Normal array
   * @param {array} uvArr - UV array
   * @param {array} colorArr - Color array
   * @param {array} idxArr - Index array
   * @param {array} vColor - Vertex color [r, g, b]
   */
  _addCrossbillboard(x, y, z, blockType, atlas, posArr, normArr, uvArr, colorArr, idxArr, vColor, faceName = 'side') {
    // Get UV info — use specified face (default 'side') for crossbillboard planes
    let uvU = 0, uvV = 0, uvSize = 1;
    if (atlas && atlas.loaded) {
      const faceUV = atlas.getFaceUV(blockType, faceName);
      uvU = faceUV.u || 0;
      uvV = faceUV.v || 0;
      uvSize = faceUV.size || atlas.uvTileSize();
    }

    const quadUVs = [[0, 0], [1, 0], [1, 1], [0, 1]];

    // Helper: emit a single-sided quad (material is already double-sided)
    const emitQuad = (verts, normal) => {
      const startIdx = posArr.length / 3;
      for (let i = 0; i < 4; i++) {
        posArr.push(x + verts[i][0], y + verts[i][1], z + verts[i][2]);
        normArr.push(normal[0], normal[1], normal[2]);
        uvArr.push(uvU + quadUVs[i][0] * uvSize, uvV + quadUVs[i][1] * uvSize);
        colorArr.push(vColor[0], vColor[1], vColor[2]);
      }
      idxArr.push(startIdx, startIdx + 1, startIdx + 2, startIdx, startIdx + 2, startIdx + 3);
    };

    // Two vertical planes forming an X (criss-cross), centered at block center (0.5, 0.5, 0.5).
    // Each plane is a W×1 rectangle rotated 45° apart around Y axis.
    // Normals point straight up (0,1,0) so both planes receive equal sunlight.
    // Small depth offset along each plane's horizontal normal prevents z-fighting.
    const c = Math.cos(Math.PI / 4); // 0.7071
    const s = Math.sin(Math.PI / 4); // 0.7071
    const hw = 0.4;  // half-width (0.8 total, fits within block when rotated)
    const off = 0.02; // depth offset along horizontal normal

    // Plane 1: diagonal / direction, horizontal normal (c, 0, s)
    // Vertices of a rectangle centered at (0.5, 0, 0.5), rotated 45°
    const ox1 = off * c, oz1 = off * s;
    emitQuad([
      [0.5 - hw*c + ox1, 0, 0.5 - hw*s + oz1],
      [0.5 + hw*c + ox1, 0, 0.5 + hw*s + oz1],
      [0.5 + hw*c + ox1, 1, 0.5 + hw*s + oz1],
      [0.5 - hw*c + ox1, 1, 0.5 - hw*s + oz1],
    ], [0, 1, 0]); // Normal points up for even lighting

    // Plane 2: diagonal \ direction, horizontal normal (-s, 0, c)
    const ox2 = -off * s, oz2 = -off * c;
    emitQuad([
      [0.5 + hw*s + ox2, 0, 0.5 - hw*c + oz2],
      [0.5 - hw*s + ox2, 0, 0.5 + hw*c + oz2],
      [0.5 - hw*s + ox2, 1, 0.5 + hw*c + oz2],
      [0.5 + hw*s + ox2, 1, 0.5 - hw*c + oz2],
    ], [0, 1, 0]); // Normal points up for even lighting
  },

  /**
   * Build a single top face near the ground for flower blocks.
   * @param {number} x - Block X
   * @param {number} y - Block Y
   * @param {number} z - Block Z
   * @param {number} blockType - Block ID for texture lookup
   * @param {object} atlas - Texture atlas
   * @param {array} posArr - Position array
   * @param {array} normArr - Normal array
   * @param {array} uvArr - UV array
   * @param {array} colorArr - Color array
   * @param {array} idxArr - Index array
   * @param {array} vColor - Vertex color [r, g, b]
   */
  _addTopFace(x, y, z, blockType, atlas, posArr, normArr, uvArr, colorArr, idxArr, vColor) {
    const flowerY = 0.05; // Slightly above ground

    // Get UV info — use 'top' face for the flower
    let uvU = 0, uvV = 0, uvSize = 1;
    if (atlas && atlas.loaded) {
      const faceUV = atlas.getFaceUV(blockType, 'top');
      uvU = faceUV.u || 0;
      uvV = faceUV.v || 0;
      uvSize = faceUV.size || atlas.uvTileSize();
    }

    // Apply block color (e.g. red_flower → [1, 0.25, 0.25], yellow_flower → [1, 1, 0.25])
    const blockColor = this.colorMap.get(blockType);
    const finalColor = blockColor
      ? [vColor[0] * blockColor[0], vColor[1] * blockColor[1], vColor[2] * blockColor[2]]
      : vColor;

    const vi = posArr.length / 3;
    const quadUVs = [[0, 0], [1, 0], [1, 1], [0, 1]];

    // Full 1×1 top face (+Y normal), counter-clockwise winding
    const verts = [
      [0, flowerY, 0], [1, flowerY, 0],
      [1, flowerY, 1], [0, flowerY, 1]
    ];
    const normal = [0, 1, 0];

    for (let i = 0; i < 4; i++) {
      posArr.push(x + verts[i][0], y + verts[i][1], z + verts[i][2]);
      normArr.push(normal[0], normal[1], normal[2]);
      uvArr.push(uvU + quadUVs[i][0] * uvSize, uvV + quadUVs[i][1] * uvSize);
      colorArr.push(finalColor[0], finalColor[1], finalColor[2]);
    }
    idxArr.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
  },
};
