/**
 * Cuubz — Mesh Builder Worker Script (with detailed error reporting)
 * No Three.js dependency — returns raw Float32Array/Uint16Array buffers via postMessage.
 */

// Block types (must match chunkData.js)
var BLOCK_TYPES = {
  AIR: 0, BEDROCK: 1, STONE: 2, DIRT: 3, GRASS: 4, SAND: 5, GRAVEL: 6,
  WATER: 7, COAL_ORE: 8, IRON_ORE: 9, GOLD_ORE: 10, DIAMOND_ORE: 11,
  CAVE_AIR: 12, SNOW: 13, SNOW_STONE: 14, LAVA: 15, TERRACOTTA: 16,
  RED_SAND: 17, ICE: 18, CLAY: 19, WOOD_LOG: 32, LEAVES: 33, PLANKS: 34,
  OBSIDIAN: 35, BLACKSTONE: 36, TOXIC_SLIME: 37, CORRUPT_CRYSTAL: 38,
  BED: 39, APPLE: 40, QUEST_KEY: 41, RED_FLOWER: 42, YELLOW_FLOWER: 43,
  CAVE_TORCH: 44, GLOWSTONE: 45
};

var CHUNK_W = 16;
var CHUNK_D = 16;
var CHUNK_H = 256;

// Block categories (must match chunkMeshBuilder.js)
var CUTOUT_IDS = {33: true, 42: true, 43: true, 44: true}; // LEAVES, RED_FLOWER, YELLOW_FLOWER, CAVE_TORCH
var TRANSPARENT_IDS = {7: true, 18: true, 37: true}; // WATER, ICE, TOXIC_SLIME

function isNonSolid(b) {
  return b === 0 || b === 12 || CUTOUT_IDS[b] || TRANSPARENT_IDS[b];
}

// Face definitions — use var + simple arrays to avoid const issues with structured-clone
var FACES = [
  // dir, verts[4][3], uvCoords[4][2], name
  {d:[0,1,0], v:[[0,1,1],[1,1,1],[1,1,0],[0,1,0]], u:[[0,0],[1,0],[1,1],[0,1]], n:'top'},
  {d:[0,-1,0], v:[[0,0,0],[1,0,0],[1,0,1],[0,0,1]], u:[[0,1],[1,1],[1,0],[0,0]], n:'bottom'},
  {d:[0,0,1], v:[[0,0,1],[1,0,1],[1,1,1],[0,1,1]], u:[[0,0],[1,0],[1,1],[0,1]], n:'front'},
  {d:[0,0,-1],v:[[1,0,0],[0,0,0],[0,1,0],[1,1,0]], u:[[0,0],[1,0],[1,1],[0,1]], n:'back'},
  {d:[1,0,0], v:[[1,0,1],[1,0,0],[1,1,0],[1,1,1]], u:[[0,0],[1,0],[1,1],[0,1]], n:'right'},
  {d:[-1,0,0],v:[[0,0,0],[0,0,1],[0,1,1],[0,1,0]], u:[[0,0],[1,0],[1,1],[0,1]], n:'left'}
];

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

function buildMeshData(blocks, neighbors, uvLookup) {
  var solidPos = [], solidNorm = [], solidUV = [], solidIdx = [];
  var cutoutPos = [], cutoutNorm = [], cutoutUV = [], cutoutIdx = [];
  var transPos = [], transNorm = [], transUV = [], transIdx = [];

  function addFace(posArr, normArr, uvArr, idxArr, verts, normal, faceUVs, bx, by, bz) {
    var vCount = posArr.length / 3;
    for (var i = 0; i < 4; i++) {
      posArr.push(bx + verts[i][0], by + verts[i][1], bz + verts[i][2]);
      normArr.push(normal[0], normal[1], normal[2]);
      uvArr.push(faceUVs[i][0], faceUVs[i][1]);
    }
    idxArr.push(vCount, vCount+1, vCount+2);
    idxArr.push(vCount, vCount+2, vCount+3);
  }

  for (var x = 0; x < CHUNK_W; x++) {
    for (var z = 0; z < CHUNK_D; z++) {
      for (var y = 0; y < CHUNK_H; y++) {
        var idx = x + (z * CHUNK_W) + (y * CHUNK_W * CHUNK_D);
        var blockType = blocks[idx];

        if (blockType === 0 || blockType === 12) continue; // AIR or CAVE_AIR

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

        for (var f = 0; f < 6; f++) {
          var face = FACES[f];
          var nx = x + face.d[0];
          var ny = y + face.d[1];
          var nz = z + face.d[2];
          
          // Get neighbor block — check all three axes for in-chunk bounds
          var nb;
          if (nx >= 0 && nx < CHUNK_W && ny >= 0 && ny < CHUNK_H && nz >= 0 && nz < CHUNK_D) {
            nb = blocks[nx + (nz * CHUNK_W) + (ny * CHUNK_W * CHUNK_D)];
          } else {
            // Out of chunk bounds — Y-direction defaults to AIR, X/Z use neighbor arrays
            if ((nx < 0 || nx >= CHUNK_W || nz < 0 || nz >= CHUNK_D)) {
              var na = null;
              if (face.d[0] === 1 && face.d[2] === 0) na = neighbors.positiveX;
              else if (face.d[0] === -1 && face.d[2] === 0) na = neighbors.negativeX;
              else if (face.d[0] === 0 && face.d[2] === 1) na = neighbors.positiveZ;
              else if (face.d[0] === 0 && face.d[2] === -1) na = neighbors.negativeZ;
              
              nb = BLOCK_TYPES.AIR;
              if (na && ny >= 0 && ny < CHUNK_H) {
                var lnx = ((nx % CHUNK_W) + CHUNK_W) % CHUNK_W;
                var lnz = ((nz % CHUNK_D) + CHUNK_D) % CHUNK_D;
                nb = na[lnx + (lnz * CHUNK_W) + (ny * CHUNK_W * CHUNK_D)];
              }
            } else {
              // Y out of bounds → AIR (top/bottom of world)
              nb = BLOCK_TYPES.AIR;
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

          var faceUVs = getUV(blockType, face.n, uvLookup);
          addFace(posArr, normArr, uvArr, idxArr, face.v, face.d, faceUVs, x, y, z);
        }
      }
    }
  }

  return {
    solid:   { pos: new Float32Array(solidPos), norm: new Float32Array(solidNorm), uv: new Float32Array(solidUV), idx: new Uint16Array(solidIdx) },
    cutout:  { pos: new Float32Array(cutoutPos), norm: new Float32Array(cutoutNorm), uv: new Float32Array(cutoutUV), idx: new Uint16Array(cutoutIdx) },
    trans:   { pos: new Float32Array(transPos), norm: new Float32Array(transNorm), uv: new Float32Array(transUV), idx: new Uint16Array(transIdx) }
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
      
      var blocks = new Uint8Array(msg.blocks);
      var neighbors = {};
      for (var dir in msg.neighbors) {
        neighbors[dir] = msg.neighbors[dir] ? new Uint8Array(msg.neighbors[dir]) : null;
      }

      // Build mesh data
      var result = buildMeshData(blocks, neighbors, msg.uvLookup || null);

      // Send result with transferable buffers
      self.postMessage({
        type: 'result',
        cx: msg.cx,
        cz: msg.cz,
        solid: { pos: result.solid.pos.buffer, norm: result.solid.norm.buffer, uv: result.solid.uv.buffer, idx: result.solid.idx.buffer },
        cutout: { pos: result.cutout.pos.buffer, norm: result.cutout.norm.buffer, uv: result.cutout.uv.buffer, idx: result.cutout.idx.buffer },
        trans:  { pos: result.trans.pos.buffer, norm: result.trans.norm.buffer, uv: result.trans.uv.buffer, idx: result.trans.idx.buffer }
      }, [
        result.solid.pos.buffer, result.solid.norm.buffer, result.solid.uv.buffer, result.solid.idx.buffer,
        result.cutout.pos.buffer, result.cutout.norm.buffer, result.cutout.uv.buffer, result.cutout.idx.buffer,
        result.trans.pos.buffer, result.trans.norm.buffer, result.trans.uv.buffer, result.trans.idx.buffer
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
