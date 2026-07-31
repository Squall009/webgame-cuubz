/**
 * Cuubz — Mesh build pipeline: what gets drawn, and how the geometry is produced (PR 23)
 *
 * Split out of ChunkManager.js. A PROTOTYPE MIXIN: every method below is the byte-identical
 * body it had as a class member and `this` is still the ChunkManager instance, so no call
 * site — internal or external — changed.
 *
 * FIELDS TOUCHED: 11, of which 7 are SHARED — `_disposed`, `renderDistance`,
 * `memoryCache`, `loadedMeshes`, `meshWorkerPool`, `textureAtlas`, `_rebuilding` — and
 * FOUR it OWNS OUTRIGHT: `_pendingMeshBuilds`, `_meshBuildQueue`, `_uvLookupCache`,
 * `_renderFrameCount`.
 *
 * The half that CONSUMES a finished build — turning buffers into THREE.Mesh objects,
 * adding them to the scene graph and disposing the old ones — is ChunkMeshLifecycle.js.
 * The cut is at the `_onMeshBuilt` call: everything here is "decide what to build and
 * get it built", everything there is "own the resulting GPU resources". They share only
 * `loadedMeshes` and `_rebuilding`, which is the smallest overlap available inside a
 * 456-line pipeline that had to be cut somewhere to fit the 400-line ceiling.
 *
 * `_dispatchMeshBuild` deliberately bypasses `WorkerPool.dispatch` and reaches into
 * `meshWorkerPool.idleWorkers` itself: mesh builds transfer buffers and need a real
 * queue, not `dispatch`'s `setTimeout(0)` retry. That asymmetry predates the split.
 */

import { CHUNK_W, CHUNK_D } from './ChunkConstants.js';
import { CHUNK_HEIGHT, Chunk } from './ChunkData.js';
import { BLOCK_TYPES } from './BlockRegistry.js';
import { ChunkMeshBuilder } from '../renderer/ChunkMeshBuilder.js';
import { chunkKey, parseChunkKey } from './ChunkKeys.js';
import { FACE_TABLE } from '../../game/data/FaceTable.js';
import { buildMeshTables } from '../../game/data/BlockCategories.js';

export const ChunkMeshCoordinatorMethods = {
  // ============================================================
  // RENDER RANGE (8×8 mesh building coordination)
  // ============================================================

  /** Update render chunks based on player position. Called every frame. */
  updateRenderChunks(playerX, playerZ) {
    if (this._disposed) return;

    const pcx = Math.floor(playerX / CHUNK_W);
    const pcz = Math.floor(playerZ / CHUNK_D);
    const rd = this.renderDistance;

    // --- Voxel region: maintain a 32×32 area of voxel data around player ---
    // Throttled to every 5 frames — called every frame but only acts periodically.
    this._renderFrameCount++;
    if (this._renderFrameCount >= 5) {
      this._renderFrameCount = 0;
      this._updateVoxelRegion(pcx, pcz);
    }

    // --- Render range: build/unload meshes for 8×8 area around player ---
    const needed = new Set();
    for (let dx = -rd; dx <= rd; dx++) {
      for (let dz = -rd; dz <= rd; dz++) {
        needed.add(chunkKey(pcx + dx, pcz + dz));
      }
    }

    // Unload out-of-range meshes
    for (const [key] of this.loadedMeshes) {
      if (!needed.has(key)) {
        this._unloadMesh(key);
      }
    }

    // Build/rebuild in-range meshes
    for (const key of needed) {
      const chunk = this.memoryCache.get(key);
      if (!chunk) continue; // Not loaded yet — region check will load it soon

      if (chunk.changed && !this._rebuilding.has(key)) {
        // Queue for mesh rebuild, immediately clear the flag
        this._queueMeshBuild(parseChunkKey(key).cx, parseChunkKey(key).cz, chunk);
        chunk.changed = false;
      } else if (!this.loadedMeshes.has(key) && !this._rebuilding.has(key)) {
        // Not loaded and not rebuilding — queue initial build
        this._queueMeshBuild(parseChunkKey(key).cx, parseChunkKey(key).cz, chunk);
      }
    }
  },

  /** Queue a mesh build for a chunk. */
  _queueMeshBuild(cx, cz, chunk) {
    const key = chunkKey(cx, cz);
    if (this._rebuilding.has(key)) return; // Already in pipeline
    this._rebuilding.add(key);

    // Gather neighbor block arrays for face culling at boundaries.
    // If a real neighbor isn't loaded, fall back to virtual neighbor edge strips
    // (sent by the host in multiplayer for correct water face culling).
    const neighbors = {
      positiveX: this.memoryCache.get(chunkKey(cx + 1, cz))?.blocks
        ?? this._virtualNeighborFromEdge(chunk, 'positiveX'),
      negativeX: this.memoryCache.get(chunkKey(cx - 1, cz))?.blocks
        ?? this._virtualNeighborFromEdge(chunk, 'negativeX'),
      positiveZ: this.memoryCache.get(chunkKey(cx, cz + 1))?.blocks
        ?? this._virtualNeighborFromEdge(chunk, 'positiveZ'),
      negativeZ: this.memoryCache.get(chunkKey(cx, cz - 1))?.blocks
        ?? this._virtualNeighborFromEdge(chunk, 'negativeZ'),
    };

    if (this.meshWorkerPool) {
      // Dispatch to mesh worker pool — UV lookup and neighbor transfers are
      // optimized inside _dispatchMeshBuild (cached UVs, sliced + transferred buffers)
      const promise = this._dispatchMeshBuild(cx, cz, chunk.blocks, neighbors, chunk.humidityMap);
      this._pendingMeshBuilds.set(key, promise);
      promise.then(geoResult => {
        this._onMeshBuilt(key, cx, cz, geoResult);
      }).catch(e => {
        console.warn('[ChunkManager] Mesh build error for', key, ':', e.message);
        this._rebuilding.delete(key);
      });
    } else {
      // Fallback: inline mesh build on main thread
      try {
        const geoResult = this._buildMeshInline(cx, cz, chunk.blocks, neighbors, chunk.humidityMap);
        this._onMeshBuilt(key, cx, cz, geoResult);
      } catch (e) {
        console.warn('[ChunkManager] Inline mesh build error for', key, ':', e.message);
        this._rebuilding.delete(key);
      }
    }
  },

  /** Ensure UV lookup cache is built — computed once from texture atlas, not per-chunk. */
  _ensureUVLookupCache() {
    if (this._uvLookupCache) return;
    if (!this.textureAtlas || !this.textureAtlas.loaded) {
      this._uvLookupCache = null;
      return;
    }
    // Flat array: index = blockType, value = [topU, topV, botU, botV, sideU, sideV, size]
    const cache = new Array(256);
    for (let bid = 0; bid < 256; bid++) {
      try {
        const topF = this.textureAtlas.getFaceUV(bid, 'top');
        const botF = this.textureAtlas.getFaceUV(bid, 'bottom');
        const sideF = this.textureAtlas.getFaceUV(bid, 'front');
        cache[bid] = [
          topF.u || 0, topF.v || 0,
          botF.u || 0, botF.v || 0,
          sideF.u || 0, sideF.v || 0,
          (topF.size || botF.size || sideF.size) || (1.0 / 6)
        ];
      } catch(e) {
        cache[bid] = [0, 0, 0, 0, 0, 0, 1.0/6];
      }
    }
    this._uvLookupCache = cache;
  },

  /**
   * Ensure the derived block tables the mesh worker needs are built (BUGS.md D-63).
   *
   * `meshWorker.js` is a classic script and cannot import BLOCK_REGISTRY, so it used to
   * carry five hand-written copies of tables `ChunkMeshBuilder` derives — three of them
   * stale, including one that tinted white concrete green and one that rendered yellow
   * poplar leaves as an opaque cube. Sending the derived tables in the build message
   * means the worker holds no block-id literal at all, so the main thread and the worker
   * agree BY CONSTRUCTION rather than by two people editing two lists in step.
   *
   * Derived once per session and reused; the message payload is the same object every
   * build (structured-cloned on postMessage, so the worker cannot mutate ours).
   */
  _ensureMeshTablesCache() {
    if (this._meshTablesCache) return;
    this._meshTablesCache = buildMeshTables(FACE_TABLE);
  },

  /**
   * Return a worker to the idle pool, or dispatch queued work if any.
   * This avoids setTimeout(0) polling when all workers are busy — the
   * next queued task is dispatched immediately on the same microtask.
   */
  _returnWorkerOrProcessQueue(w) {
    if (this._meshBuildQueue.length > 0) {
      const next = this._meshBuildQueue.shift();
      this._doMeshBuild(w, next.cx, next.cz, next.blocks, next.neighbors, next.humidityMap,
                        this._uvLookupCache, next.resolve, next.reject);
    } else {
      this.meshWorkerPool.idleWorkers.push(w);
    }
  },

  /**
   * Dispatch mesh build to worker.
   * Returns Promise<geometry>.
   *
   * PERFORMANCE:
   *   - UV lookup table is cached once, not rebuilt per chunk (256×3 = 768
   *     atlas lookups saved per mesh build).
   *   - Neighbor arrays use TypedArray.slice() instead of Array.from().
   *     slice() is a native operation ~100x faster than JS-level iteration
   *     over 4 × 65,536 elements.
   *   - Humidity map uses Float32Array.slice() instead of Array.from().
   *   - All buffers are transferred (zero-copy) to avoid structured clone
   *     duplication on postMessage.
   *   - When all workers are busy, tasks are queued and dispatched on the
   *     same microtask when a worker frees up — no setTimeout(0) polling.
   */
  _dispatchMeshBuild(cx, cz, blocks, neighbors, humidityMap) {
    return new Promise((resolve, reject) => {
      // Use cached UV lookup table — built once
      this._ensureUVLookupCache();
      const uvLookup = this._uvLookupCache;

      // Find an idle worker or queue for later
      const idleWorkers = this.meshWorkerPool.idleWorkers;
      let w = idleWorkers.pop();
      if (!w) {
        this._meshBuildQueue.push({ cx, cz, blocks, neighbors, humidityMap, resolve, reject });
        return;
      }

      this._doMeshBuild(w, cx, cz, blocks, neighbors, humidityMap, uvLookup, resolve, reject);
    });
  },

  /** Internal: send work to a specific worker with optimized data transfer. */
  _doMeshBuild(w, cx, cz, blocks, neighbors, humidityMap, uvLookup, resolve, reject) {
    // Here rather than in _dispatchMeshBuild: _returnWorkerOrProcessQueue calls this
    // method directly when it drains the queue, so this is the one chokepoint every
    // build passes through.
    this._ensureMeshTablesCache();

    const handler = (e) => {
      w.removeEventListener('message', handler);
      w.removeEventListener('error', errorHandler);
      clearTimeout(timeoutId);
      this._returnWorkerOrProcessQueue(w);
      if (e.data && e.data.type === 'error') {
        reject(new Error(e.data.error || 'Mesh build failed'));
      } else {
        resolve(e.data);
      }
    };

    const errorHandler = (e) => {
      w.removeEventListener('message', handler);
      w.removeEventListener('error', errorHandler);
      clearTimeout(timeoutId);
      this._returnWorkerOrProcessQueue(w);
      reject(new Error('Mesh worker error: ' + e.message));
    };

    const timeoutId = setTimeout(() => {
      w.removeEventListener('message', handler);
      w.removeEventListener('error', errorHandler);
      this._returnWorkerOrProcessQueue(w);
      reject(new Error(`Mesh build timeout for chunk [${cx},${cz}]`));
    }, 5000);

    w.addEventListener('message', handler);
    w.addEventListener('error', errorHandler);

    // Efficient data transfer
    //   - TypedArray.slice() is a native copy (~100x faster than Array.from())
    //   - All buffers are transferred (zero-copy to worker)
    const blocksCopy = new Uint8Array(blocks);
    const transferList = [blocksCopy.buffer];

    // Slice neighbor Uint8Arrays — native, avoids JS iteration over 4×65K elements
    const neighborBuffers = {};
    for (const dir of ['positiveX', 'negativeX', 'positiveZ', 'negativeZ']) {
      if (neighbors[dir]) {
        const slice = neighbors[dir].slice();
        neighborBuffers[dir] = slice.buffer;
        transferList.push(slice.buffer);
      } else {
        neighborBuffers[dir] = null;
      }
    }

    // Slice humidity map Float32Array
    let humidityBuffer = null;
    if (humidityMap) {
      const slice = humidityMap.slice();
      humidityBuffer = slice.buffer;
      transferList.push(slice.buffer);
    }

    w.postMessage({
      type: 'build',
      cx, cz,
      blocks: blocksCopy.buffer,
      neighbors: neighborBuffers,
      uvLookup: uvLookup,
      humidityMap: humidityBuffer,
      tables: this._meshTablesCache
    }, transferList);
  },

  /**
   * Create a full-sized virtual neighbor chunk array from a 1-deep edge strip.
   * Used in multiplayer when the real neighbor hasn't been received yet.
   * The edge strip is 16 × 256 = 4096 bytes; the virtual array is 16 × 16 × 256 = 65536 bytes
   * with the boundary column populated and the rest filled with AIR (0).
   * Returns null if no edge data is available.
   */
  _virtualNeighborFromEdge(chunk, dir) {
    const edge = chunk.neighborEdges?.[dir];
    if (!edge) return null;

    const full = new Uint8Array(16 * 16 * 256); // all zeros = AIR

    if (dir === 'positiveX' || dir === 'negativeX') {
      // Edge strip is 16(z) × 256(y), stored as strip[z * 256 + y]
      // Virtual chunk index: x + z*16 + y*256
      const edgeX = dir === 'positiveX' ? 0 : 15;
      for (let z = 0; z < 16; z++) {
        for (let y = 0; y < 256; y++) {
          full[edgeX + z * 16 + y * 256] = edge[z * 256 + y];
        }
      }
    } else {
      // Edge strip is 16(x) × 256(y), stored as strip[x * 256 + y]
      // Virtual chunk index: x + z*16 + y*256
      const edgeZ = dir === 'positiveZ' ? 0 : 15;
      for (let x = 0; x < 16; x++) {
        for (let y = 0; y < 256; y++) {
          full[x + edgeZ * 16 + y * 256] = edge[x * 256 + y];
        }
      }
    }

    return full;
  },

  /** Inline mesh build fallback (main thread). */
  _buildMeshInline(cx, cz, blocks, neighbors, humidityMap) {
    // Create a temporary chunk-like object for the mesh builder
    const tempChunk = new Chunk(cx, cz);
    tempChunk.blocks.set(blocks);
    tempChunk.humidityMap = humidityMap;

    // Build neighbor lookup function from neighbor arrays
    const neighborLookup = (wx, wy, wz) => {
      const ncx = Math.floor(wx / CHUNK_W);
      const ncz = Math.floor(wz / CHUNK_D);
      let neighborArray = null;

      if (ncx === cx + 1 && ncz === cz) neighborArray = neighbors.positiveX;
      else if (ncx === cx - 1 && ncz === cz) neighborArray = neighbors.negativeX;
      else if (ncx === cx && ncz === cz + 1) neighborArray = neighbors.positiveZ;
      else if (ncx === cx && ncz === cz - 1) neighborArray = neighbors.negativeZ;

      if (!neighborArray) return BLOCK_TYPES.AIR;

      const nlx = ((wx % CHUNK_W) + CHUNK_W) % CHUNK_W;
      const nlz = ((wz % CHUNK_D) + CHUNK_D) % CHUNK_D;
      if (wy < 0 || wy >= CHUNK_HEIGHT) return BLOCK_TYPES.AIR;
      return neighborArray[nlx + (nlz * CHUNK_W) + (wy * CHUNK_W * CHUNK_D)];
    };

    const meshBuilder = new ChunkMeshBuilder();
    const meshData = meshBuilder.buildMeshData(tempChunk, this.textureAtlas, neighborLookup);
    return meshBuilder.buildThreeGeometry(meshData, tempChunk);
  },
};
