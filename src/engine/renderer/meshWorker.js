/**
 * Cuubz — Mesh Builder Worker Script (with detailed error reporting)
 * No Three.js dependency — returns raw Float32Array/Uint16Array buffers via postMessage.
 *
 * ─── THIS FILE HOLDS NO BLOCK-ID TABLE, DELIBERATELY (BUGS.md D-63) ─────────
 *
 * It used to carry five: CUTOUT_IDS, TRANSPARENT_IDS, TINTABLE_IDS,
 * SPECIAL_MESH_TYPES and BLOCK_COLORS, all hand-written, all a copy of something
 * `ChunkMeshBuilder.js` derives from BLOCK_REGISTRY. Three had rotted:
 *
 *   - TINTABLE_IDS listed 115 commented YELLOW_POPLAR_LEAVES. 115 is `white_concrete`
 *     — the worker tinted white concrete green with the humidity gradient.
 *   - CUTOUT_IDS omitted 192, the real `yellow_poplar_leaves`, so the worker binned it
 *     as solid: faces behind it culled, wrong material bucket.
 *   - The block loop skipped `blockType === 12` as "CAVE_AIR". CAVE_AIR is 0 (an alias
 *     of AIR); 12 is `polished_granite`. The worker drew no geometry for it at all.
 *
 * Every one of those was invisible on the main-thread fallback path, so the bug's
 * presence depended on whether the browser spawned a worker.
 *
 * This file is a CLASSIC SCRIPT (decision 14) and cannot `import` — eslint.config.mjs
 * lints it with `sourceType: 'script'`, so an `import` here is a parse error. So the
 * tables arrive in the build message instead, derived from BLOCK_REGISTRY by
 * `src/game/data/BlockCategories.js` and assembled by
 * `ChunkMeshCoordinator._ensureMeshTablesCache`. `msg.tables` is REQUIRED: there is no
 * built-in default to fall back to, because a default is exactly the thing that goes
 * stale. Do not add one. Do not add an id literal to this file.
 */

var CHUNK_W = 16;
var CHUNK_D = 16;
var CHUNK_H = 256;

/** Turn an array of ids into an O(1) lookup object. */
function idSet(ids) {
  var out = {};
  if (ids) { for (var i = 0; i < ids.length; i++) out[ids[i]] = true; }
  return out;
}

/** Turn an array of [id, value] pairs into a lookup object. */
function idMap(pairs) {
  var out = {};
  if (pairs) { for (var i = 0; i < pairs.length; i++) out[pairs[i][0]] = pairs[i][1]; }
  return out;
}

// uvLookup: Array[256] where each entry is [topU,topV,botU,botV,sideU,sideV,size] or null
function getUV(blockType, faceName, uvLookup) {
  var defaultUV = [[0,0],[1,0],[1,1],[0,1]];
  
  if (!uvLookup || !uvLookup[blockType]) return defaultUV;
  var info = uvLookup[blockType];
  if (!info) return defaultUV;
  
  // Pick face UV from flat array: [topU,topV,botU,botV,sideU,sideV,size]
  var u, v, size;
  if (faceName === 'top') { u = info[0]; v = info[1]; }
  else if (faceName === 'bottom') { u = info[2]; v = info[3]; }
  else { u = info[4]; v = info[5]; } // front, back, right, left all use side
  size = info[6] || (1.0 / 6);
  
  var result = [];
  for (var i = 0; i < 4; i++) {
    result.push([u + defaultUV[i][0] * size, v + defaultUV[i][1] * size]);
  }
  return result;
}

/**
 * @param tables — the derived tables from the build message. See the file header:
 *   { faces, airIds, cutoutIds, transparentIds, tintableIds, specialMeshTypes, blockColors }
 */
function buildMeshData(blocks, neighbors, uvLookup, humidityMap, tables) {
  var FACES = tables.faces;
  var AIR_IDS = idSet(tables.airIds);
  var CUTOUT_IDS = idSet(tables.cutoutIds);
  var TRANSPARENT_IDS = idSet(tables.transparentIds);
  var TINTABLE_IDS = idSet(tables.tintableIds);
  var SPECIAL_MESH_TYPES = idMap(tables.specialMeshTypes);
  var BLOCK_COLORS = idMap(tables.blockColors);

  function isNonSolid(b) {
    return AIR_IDS[b] || CUTOUT_IDS[b] || TRANSPARENT_IDS[b] ? true : false;
  }

  var solidPos = [], solidNorm = [], solidUV = [], solidIdx = [], solidColor = [];
  var cutoutPos = [], cutoutNorm = [], cutoutUV = [], cutoutIdx = [], cutoutColor = [];
  var transPos = [], transNorm = [], transUV = [], transIdx = [], transColor = [];

  // Humidity-to-color gradient: dry (0) → yellow-green, moist (1) → lush green
  // Using smooth interpolation between [1.0, 0.85, 0.45] (dry) and [0.55, 1.0, 0.45] (moist)
  function humidityColor(h) {
    // Clamp 0..1
    if (h < 0) h = 0;
    if (h > 1) h = 1;
    var r = 1.0 - h * 0.45;  // 1.0 → 0.55
    var g = 0.85 - h * (-0.15); // 0.85 → 1.0
    var b = 0.45;  // constant
    return [r, g, b];
  }

  function getVertexColor(lx, y, lz, blockType) {
    // Only tint grass/leaf blocks; everything else gets neutral white
    if (!TINTABLE_IDS[blockType]) return [1.0, 1.0, 1.0];
    if (!humidityMap) return [1.0, 1.0, 1.0];
    var h = humidityMap[lx * 16 + lz];
    return humidityColor(h);
  }

  function addFace(posArr, normArr, uvArr, colorArr, idxArr, verts, normal, faceUVs, vertexColor, bx, by, bz) {
    var vCount = posArr.length / 3;
    for (var i = 0; i < 4; i++) {
      posArr.push(bx + verts[i][0], by + verts[i][1], bz + verts[i][2]);
      normArr.push(normal[0], normal[1], normal[2]);
      uvArr.push(faceUVs[i][0], faceUVs[i][1]);
      colorArr.push(vertexColor[0], vertexColor[1], vertexColor[2]);
    }
    idxArr.push(vCount, vCount+1, vCount+2);
    idxArr.push(vCount, vCount+2, vCount+3);
  }

  // Build a crossbillboard (two criss-cross 1×1 planes forming an X) for grass blocks.
  // Two vertical planes forming an X, centered at block center (0.5, 0, 0.5).
  // Each plane is a W×1 rectangle rotated 45° apart around Y axis.
  // Normals point straight up (0,1,0) so both planes receive equal sunlight.
  // Small depth offset along each plane's horizontal normal prevents z-fighting.
  function addCrossbillboard(x, y, z, blockType, uvLookup, posArr, normArr, uvArr, colorArr, idxArr, vColor, faceName) {
    faceName = faceName || 'side';
    // Get UV info — use specified face for crossbillboard planes
    var faceUVs = getUV(blockType, faceName, uvLookup);

    // Helper: emit a single-sided quad (material is already double-sided)
    var emitQuad = function(verts, normal) {
      var startIdx = posArr.length / 3;
      for (var i = 0; i < 4; i++) {
        posArr.push(x + verts[i][0], y + verts[i][1], z + verts[i][2]);
        normArr.push(normal[0], normal[1], normal[2]);
        uvArr.push(faceUVs[i][0], faceUVs[i][1]);
        colorArr.push(vColor[0], vColor[1], vColor[2]);
      }
      idxArr.push(startIdx, startIdx+1, startIdx+2, startIdx, startIdx+2, startIdx+3);
    };

    var c = Math.cos(Math.PI / 4); // 0.7071
    var s = Math.sin(Math.PI / 4); // 0.7071
    var hw = 0.4;  // half-width (0.8 total, fits within block when rotated)
    var off = 0.02; // depth offset along horizontal normal

    // Plane 1: diagonal / direction, horizontal normal (c, 0, s)
    // Vertices of a rectangle centered at (0.5, 0, 0.5), rotated 45°
    var ox1 = off * c, oz1 = off * s;
    emitQuad([
      [0.5 - hw*c + ox1, 0, 0.5 - hw*s + oz1],
      [0.5 + hw*c + ox1, 0, 0.5 + hw*s + oz1],
      [0.5 + hw*c + ox1, 1, 0.5 + hw*s + oz1],
      [0.5 - hw*c + ox1, 1, 0.5 - hw*s + oz1],
    ], [0, 1, 0]); // Normal points up for even lighting

    // Plane 2: diagonal \ direction, horizontal normal (-s, 0, c)
    var ox2 = -off * s, oz2 = -off * c;
    emitQuad([
      [0.5 + hw*s + ox2, 0, 0.5 - hw*c + oz2],
      [0.5 - hw*s + ox2, 0, 0.5 + hw*c + oz2],
      [0.5 - hw*s + ox2, 1, 0.5 + hw*c + oz2],
      [0.5 + hw*s + ox2, 1, 0.5 - hw*c + oz2],
    ], [0, 1, 0]); // Normal points up for even lighting
  }

  // Build a single 1×1 top face near the ground for flower blocks
  function addTopFace(x, y, z, blockType, uvLookup, posArr, normArr, uvArr, colorArr, idxArr, vColor) {
    var flowerY = 0.05; // Slightly above ground

    // Get UV info — use 'top' face for the flower
    var faceUVs = getUV(blockType, 'top', uvLookup);

    // Apply block color (e.g. red_flower → [1, 0.25, 0.25], yellow_flower → [1, 1, 0.25])
    var blockColor = BLOCK_COLORS[blockType];
    var finalColor = blockColor
      ? [vColor[0] * blockColor[0], vColor[1] * blockColor[1], vColor[2] * blockColor[2]]
      : vColor;

    var vi = posArr.length / 3;

    // Full 1×1 top face (+Y normal), counter-clockwise winding
    var verts = [
      [0, flowerY, 0], [1, flowerY, 0],
      [1, flowerY, 1], [0, flowerY, 1]
    ];
    var normal = [0, 1, 0];

    for (var i = 0; i < 4; i++) {
      posArr.push(x + verts[i][0], y + verts[i][1], z + verts[i][2]);
      normArr.push(normal[0], normal[1], normal[2]);
      uvArr.push(faceUVs[i][0], faceUVs[i][1]);
      colorArr.push(finalColor[0], finalColor[1], finalColor[2]);
    }
    idxArr.push(vi, vi+1, vi+2, vi, vi+2, vi+3);
  }

  for (var x = 0; x < CHUNK_W; x++) {
    for (var z = 0; z < CHUNK_D; z++) {
      for (var y = 0; y < CHUNK_H; y++) {
        var idx = x + (z * CHUNK_W) + (y * CHUNK_W * CHUNK_D);
        var blockType = blocks[idx];

        // AIR only. This line used to read `blockType === 0 || blockType === 12`, calling
        // 12 "CAVE_AIR"; CAVE_AIR is an alias of AIR (0) and 12 is polished_granite.
        if (AIR_IDS[blockType]) continue;

        var isCutout = CUTOUT_IDS[blockType] ? true : false;
        var isTransparent = TRANSPARENT_IDS[blockType] ? true : false;

        var posArr, normArr, uvArr, idxArr;
        if (isCutout) {
          posArr = cutoutPos; normArr = cutoutNorm; uvArr = cutoutUV; idxArr = cutoutIdx;
        } else if (isTransparent) {
          posArr = transPos; normArr = transNorm; uvArr = transUV; idxArr = transIdx;
        } else {
          posArr = solidPos; normArr = solidNorm; uvArr = solidUV; idxArr = solidIdx;
        }

        // Special mesh types: crossbillboard (grass X-shape) and topface (flowers)
        var meshInfo = SPECIAL_MESH_TYPES[blockType];
        if (meshInfo) {
          var colorArr = isCutout ? cutoutColor : (isTransparent ? transColor : solidColor);
          var vColor = getVertexColor(x, y, z, blockType);
          if (meshInfo.type === 'crossbillboard') {
            addCrossbillboard(x, y, z, blockType, uvLookup, posArr, normArr, uvArr, colorArr, idxArr, vColor);
          } else if (meshInfo.type === 'crossbillboard_stacked') {
            // Bottom layer uses 'bottom' face texture, top layer uses 'side'
            addCrossbillboard(x, y, z, blockType, uvLookup, posArr, normArr, uvArr, colorArr, idxArr, vColor, 'bottom');
            addCrossbillboard(x, y + 1, z, blockType, uvLookup, posArr, normArr, uvArr, colorArr, idxArr, vColor, 'side');
          } else if (meshInfo.type === 'topface') {
            addTopFace(x, y, z, blockType, uvLookup, posArr, normArr, uvArr, colorArr, idxArr, vColor);
          }
          continue; // Skip standard face loop
        }

        for (var f = 0; f < 6; f++) {
          var face = FACES[f];
          var nx = x + face.dir[0];
          var ny = y + face.dir[1];
          var nz = z + face.dir[2];
          
          // Get neighbor block — check all three axes for in-chunk bounds
          var nb;
          if (nx >= 0 && nx < CHUNK_W && ny >= 0 && ny < CHUNK_H && nz >= 0 && nz < CHUNK_D) {
            nb = blocks[nx + (nz * CHUNK_W) + (ny * CHUNK_W * CHUNK_D)];
          } else {
            // Out of chunk bounds — Y-direction defaults to AIR, X/Z use neighbor arrays
            if ((nx < 0 || nx >= CHUNK_W || nz < 0 || nz >= CHUNK_D)) {
              var na = null;
              if (face.dir[0] === 1 && face.dir[2] === 0) na = neighbors.positiveX;
              else if (face.dir[0] === -1 && face.dir[2] === 0) na = neighbors.negativeX;
              else if (face.dir[0] === 0 && face.dir[2] === 1) na = neighbors.positiveZ;
              else if (face.dir[0] === 0 && face.dir[2] === -1) na = neighbors.negativeZ;
              
              nb = 0; // AIR
              if (na && ny >= 0 && ny < CHUNK_H) {
                var lnx = ((nx % CHUNK_W) + CHUNK_W) % CHUNK_W;
                var lnz = ((nz % CHUNK_D) + CHUNK_D) % CHUNK_D;
                nb = na[lnx + (lnz * CHUNK_W) + (ny * CHUNK_W * CHUNK_D)];
              }
            } else {
              // Y out of bounds → AIR (top/bottom of world)
              nb = 0; // AIR (top/bottom of world)
            }
          }

          // Face culling — unified rules matching chunkMeshBuilder:
          // Solid block:   cull only when neighbor is also solid (not AIR/CAVE_AIR/cutout/transparent).
          // Cutout block:  cull only when neighbor is the EXACT same cutout type.
          // Transparent:   cull when neighbor is the EXACT same type OR when neighbor is SOLID.
          //   The solid block already draws its face toward the transparent neighbor,
          //   so drawing both would create overlapping geometry causing raycast interaction bugs.
          var nbIsNonSolid = isNonSolid(nb);
          if (isCutout || isTransparent) {
            if (nb === blockType) continue; // Same-type non-solid → cull
            // Cull transparent/cutout face toward solid block (solid draws its own face)
            if (!nbIsNonSolid) continue;
          } else {
            // Solid block
            if (!nbIsNonSolid) continue;    // Neighbor is solid → cull
          }

          // Face is visible — proceed to build geometry

          var faceUVs = getUV(blockType, face.name, uvLookup);
          var vColor = getVertexColor(x, y, z, blockType);
          addFace(posArr, normArr, uvArr, (isCutout ? cutoutColor : (isTransparent ? transColor : solidColor)), idxArr, face.vertices, face.dir, faceUVs, vColor, x, y, z);
        }
      }
    }
  }

  return {
    solid:   { pos: new Float32Array(solidPos), norm: new Float32Array(solidNorm), uv: new Float32Array(solidUV), idx: new Uint16Array(solidIdx), color: new Float32Array(solidColor) },
    cutout:  { pos: new Float32Array(cutoutPos), norm: new Float32Array(cutoutNorm), uv: new Float32Array(cutoutUV), idx: new Uint16Array(cutoutIdx), color: new Float32Array(cutoutColor) },
    trans:   { pos: new Float32Array(transPos), norm: new Float32Array(transNorm), uv: new Float32Array(transUV), idx: new Uint16Array(transIdx), color: new Float32Array(transColor) }
  };
}

// ── Worker message handler (with detailed error reporting) ────────────────────────
self.onmessage = function (e) {
  var msg = e.data;
  try {
    if (msg.type === 'build') {
      // Validate inputs
      if (!msg.blocks || !msg.neighbors) {
        throw new Error('Missing blocks or neighbors in message');
      }
      // Required, and deliberately not defaulted — see the file header. A missing
      // table must be a loud error, not a silently-wrong mesh.
      if (!msg.tables || !msg.tables.faces) {
        throw new Error('Missing derived block tables in message (see BlockCategories.buildMeshTables)');
      }

      var blocks = new Uint8Array(msg.blocks);
      var neighbors = {};
      for (var dir in msg.neighbors) {
        neighbors[dir] = msg.neighbors[dir] ? new Uint8Array(msg.neighbors[dir]) : null;
      }

      // Build mesh data
      var humidityMap = msg.humidityMap ? new Float32Array(msg.humidityMap) : null;
      if (!humidityMap && !msg.humidityMap) {
        console.warn('[MeshWorker] No humidityMap for chunk', msg.cx, msg.cz);
      }
      var result = buildMeshData(blocks, neighbors, msg.uvLookup || null, humidityMap, msg.tables);

      // Send result with transferable buffers
      self.postMessage({
        type: 'result',
        cx: msg.cx,
        cz: msg.cz,
        solid: { pos: result.solid.pos.buffer, norm: result.solid.norm.buffer, uv: result.solid.uv.buffer, idx: result.solid.idx.buffer, color: result.solid.color.buffer },
        cutout: { pos: result.cutout.pos.buffer, norm: result.cutout.norm.buffer, uv: result.cutout.uv.buffer, idx: result.cutout.idx.buffer, color: result.cutout.color.buffer },
        trans:  { pos: result.trans.pos.buffer, norm: result.trans.norm.buffer, uv: result.trans.uv.buffer, idx: result.trans.idx.buffer, color: result.trans.color.buffer }
      }, [
        result.solid.pos.buffer, result.solid.norm.buffer, result.solid.uv.buffer, result.solid.idx.buffer, result.solid.color.buffer,
        result.cutout.pos.buffer, result.cutout.norm.buffer, result.cutout.uv.buffer, result.cutout.idx.buffer, result.cutout.color.buffer,
        result.trans.pos.buffer, result.trans.norm.buffer, result.trans.uv.buffer, result.trans.idx.buffer, result.trans.color.buffer
      ]);
    }
  } catch (err) {
    // Send detailed error info back to main thread for debugging
    self.postMessage({ 
      type: 'error', 
      cx: msg ? msg.cx : '?',
      cz: msg ? msg.cz : '?',
      error: err.message,
      stack: err.stack || '',
      filename: e.filename,
      lineno: e.lineno
    });
  }
};

self.onerror = function (e) {
  self.postMessage({ 
    type: 'error', 
    cx: '?', cz: '?',
    error: e.message + ' at ' + (e.filename || '?') + ':' + (e.lineno || '?'),
    stack: '',
    filename: e.filename,
    lineno: e.lineno
  });
  return true; // Prevent default error handling
};
