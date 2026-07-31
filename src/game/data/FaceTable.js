/**
 * Cuubz — the cube face table (PR 23)
 *
 * `refactor.md` §9 asks for the face table to be deduplicated between
 * `src/engine/renderer/meshWorker.js` (`FACES`) and
 * `src/engine/renderer/ChunkMeshBuilder.js` (`this.faceNormals`). This is that file.
 *
 * ─── THE TABLE HAD **NOT** DRIFTED ──────────────────────────────────────────
 *
 * Before anything moved, all 144 elements of the two tables — 6 faces × (3 direction
 * components + 4×3 vertex components + 4×2 UV components) — were compared with
 * `Object.is`. Zero differences, including the deliberately inverted `bottom` UV
 * winding (`[[0,1],[1,1],[1,0],[0,0]]`, which every other face writes as
 * `[[0,0],[1,0],[1,1],[0,1]]`). Only the key NAMES differed (`d/v/u/n` in the worker,
 * `dir/vertices/uvCoords/name` on the main thread). The canonical names below are the
 * main thread's; the worker now receives this table in its build message rather than
 * carrying a second copy under short keys.
 *
 * The tables that HAD drifted are the sibling id tables in the same two files, and
 * they are `BUGS.md` D-63. They live in `./BlockCategories.js`, derived from
 * `BLOCK_REGISTRY`, because a hand-written id table is the thing that rots — a vertex
 * triple is not.
 *
 * ─── WORKER-SAFE ────────────────────────────────────────────────────────────
 *
 * No `three`, no DOM, no imports at all. `meshWorker.js` is a classic script
 * (decision 14) and cannot `import` this file directly — but a structured clone of
 * these plain arrays crosses `postMessage` unchanged, which is how it gets there.
 * Anything not clonable (a THREE.Vector3, a class instance) would silently break that
 * path, so keep this file to arrays, numbers and strings.
 */

/** Deep-freeze so no consumer can mutate the shared table in place. */
function deepFreeze(value) {
  if (Array.isArray(value)) value.forEach(deepFreeze);
  else if (value && typeof value === 'object') Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

/**
 * The six cube faces, in the order both mesh builders have always walked them.
 *
 * Each entry:
 *   dir      — outward face normal, also the neighbour offset used for face culling
 *   vertices — 4 corners in counter-clockwise winding, block-local (0..1)
 *   uvCoords — 4 matching UV corners, unit-square; scaled by the atlas tile size
 *   name     — the atlas face key (`getFaceUV(blockId, name)`)
 */
export const FACE_TABLE = deepFreeze([
  { dir: [0, 1, 0],  vertices: [[0,1,1],[1,1,1],[1,1,0],[0,1,0]], uvCoords: [[0,0],[1,0],[1,1],[0,1]], name: 'top' },
  { dir: [0,-1, 0],  vertices: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]], uvCoords: [[0,1],[1,1],[1,0],[0,0]], name: 'bottom' },
  { dir: [0, 0, 1],  vertices: [[0,0,1],[1,0,1],[1,1,1],[0,1,1]], uvCoords: [[0,0],[1,0],[1,1],[0,1]], name: 'front' },
  { dir: [0, 0,-1],  vertices: [[1,0,0],[0,0,0],[0,1,0],[1,1,0]], uvCoords: [[0,0],[1,0],[1,1],[0,1]], name: 'back' },
  { dir: [1, 0, 0],  vertices: [[1,0,1],[1,0,0],[1,1,0],[1,1,1]], uvCoords: [[0,0],[1,0],[1,1],[0,1]], name: 'right' },
  { dir: [-1,0, 0],  vertices: [[0,0,0],[0,0,1],[0,1,1],[0,1,0]], uvCoords: [[0,0],[1,0],[1,1],[0,1]], name: 'left' },
]);

/**
 * The four vertical faces, in the shape `ChunkMeshBuilder._buildSourceFluidFace`'s
 * local `sides` table used to spell out by hand — `refactor.md` §9's second half.
 * Derived, so it cannot disagree with FACE_TABLE: the filter drops `top`/`bottom` and
 * leaves front, back, right, left in their original order, and `normal` is `dir`
 * because that is what the hand-written table set it to on every row.
 */
export const HORIZONTAL_FACES = deepFreeze(
  FACE_TABLE.filter((f) => f.dir[1] === 0).map((f) => ({
    dir: f.dir,
    faceName: f.name,
    verts: f.vertices,
    normal: f.dir,
  }))
);
