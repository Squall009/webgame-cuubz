/**
 * Cuubz — Terrain generation queue and the voxel residency region (PR 23)
 *
 * Split out of ChunkManager.js. A PROTOTYPE MIXIN: every method below is the byte-identical
 * body it had as a class member and `this` is still the ChunkManager instance, so no call
 * site — internal or external — changed.
 *
 * FIELDS TOUCHED: 16, of which 12 are SHARED — `_disposed`, `workerPool`, `worldSeed`,
 * `genParams`, `memoryCache`, `_flushQueue`, `stats`, `clientMode`, `renderDistance`,
 * `_voxelRegionRadius`, `lastPlayerX`, `lastPlayerZ` — and FOUR it OWNS OUTRIGHT, which
 * nothing outside this file touches: `_genQueue`, `_generating`, `_genProcessing`,
 * `onChunkGenerated`. Four privately-owned fields is the highest of any group in the
 * split, which is what made this the seam to cut when ChunkManager.js was still ~290
 * lines over the 400-line ceiling after the named cuts.
 *
 * `_updateVoxelRegion` is here rather than in ChunkMeshCoordinator.js because what it
 * decides is which chunks EXIST, not which are drawn: it queues generation for the
 * missing ones and evicts the distant ones. It reads `_voxelRegionRadius`, which
 * `ChunkManager.setRenderDistance` recomputes — before PR 23 it did not, and the voxel
 * region stayed at its startup size for the whole session (D-66, fixed before the split
 * precisely so it would not become a cross-file bug).
 *
 * THE INLINE FALLBACK IN `generateChunk` NOW WORKS. It reads
 * `window._voxelgenGenerateChunk`, which is assigned by `workerGeneration.js`'s
 * main-thread branch — and until D-57 was fixed that file was imported `?url` only, so
 * it never evaluated on the main thread and the global was never assigned. The plain
 * side-effect import that fixes it lives in ChunkManager.js. Reading `window.x` is fine
 * here; the ASSIGNMENT is in `workerGeneration.js`, which is a classic script and not
 * covered by decision 21's one-window-writer rule.
 */

import { CHUNK_W, CHUNK_D } from './ChunkConstants.js';
import { CHUNK_HEIGHT, Chunk } from './ChunkData.js';
import { chunkKey, parseChunkKey } from './ChunkKeys.js';

export const ChunkGeneratorMethods = {
  /** Generate a single chunk via worker pool. Returns Promise<Chunk>. */
  async generateChunk(cx, cz) {
    if (this._disposed) return null;

    // baseChunkX/baseChunkZ are only used by the worker to compute relative grid coords in its response.
    // They don't affect generation — just set them so the subtraction doesn't produce NaN on first call.
    const genParams = Object.assign({}, this.genParams, { baseChunkX: 0, baseChunkZ: 0 });

    try {
      let result;
      if (this.workerPool) {
        result = await this.workerPool.dispatch(cx, cz, this.worldSeed, genParams);
      } else {
        // Inline fallback
        const genFn = typeof window !== 'undefined' ? window._voxelgenGenerateChunk : null;
        if (!genFn) throw new Error('No worker pool and no inline generation available');
        result = genFn(cx, cz, this.worldSeed, genParams);
      }

      // Reconstruct Chunk from worker result.
      const chunk = new Chunk(cx, cz);

      // Convert worker output (X-major: x*4096 + y*16 + z) to Chunk layout (Y-major: x + z*16 + y*256).
      const workerData = new Uint8Array(result.chunkBytes);
      for (let lx = 0; lx < CHUNK_W; lx++) {
        for (let lz = 0; lz < CHUNK_D; lz++) {
          for (let y = 0; y < CHUNK_HEIGHT; y++) {
            chunk.blocks[lx + (lz * CHUNK_W) + (y * CHUNK_W * CHUNK_D)] = workerData[(lx << 12) + (y << 4) + lz];
          }
        }
      }

      // Store humidity map for vertex color tinting (256 floats, one per column)
      if (result.humidityMap) {
        chunk.humidityMap = new Float32Array(result.humidityMap);
      } else {
        console.warn('[ChunkManager] No humidityMap from worker for chunk', cx, cz);
      }

      this.stats.chunksGenerated++;
      if (this.onChunkGenerated) this.onChunkGenerated(cx, cz);

      return chunk;
    } catch (e) {
      console.error('[ChunkManager] Generation error for', cx, cz, ':', e.message);
      throw e;
    }
  },

  /** Generate full world (128×128 chunks). */
  async generateFullWorld(size = 64) {
    // D-75: `const total = (size * 2) ** 2;` and `let completed = 0;` stood here. Neither
    // was ever read, and nothing incremented `completed` — the remains of a progress
    // callback that this method does not have. Both deleted; there is no progress reporting
    // to preserve, and inventing one would be a feature.
    for (let cx = -size; cx < size; cx++) {
      for (let cz = -size; cz < size; cz++) {
        this._genQueue.push({ cx, cz });
      }
    }

    // Process queue in batches
    await this._processGenQueue();

    // Immediately flush all generated chunks to disk — don't wait for the
    // 5s flush timer. This ensures the initial world data is persisted
    // quickly, reducing perceived save time on mobile / low-power devices.
    if (this._flushQueue.size > 0) {
      await this.flushDirty();
    }
  },

  /** Add chunk to generation queue. Returns Promise when done. */
  _queueGeneration(cx, cz) {
    const key = chunkKey(cx, cz);
    if (this.memoryCache.has(key) || this._generating.has(key)) return null;
    // Check if already queued
    if (this._genQueue.some(item => item.cx === cx && item.cz === cz)) return null;

    this._genQueue.push({ cx, cz });

    // Guard: only one drain loop runs at a time. Multiple callers just push items.
    if (!this._genProcessing) {
      this._genProcessing = true;
      const promise = this._processGenQueue();
      promise.then(() => { this._genProcessing = false; }).catch(() => { this._genProcessing = false; });
      return promise;
    }

    return null; // Already draining — caller's item will be picked up by existing drain.
  },

  /** Process generation queue asynchronously — drains all pending items. */
  async _processGenQueue() {
    if (this._disposed) return;

    // Loop until queue is empty or disposed
    while (this._genQueue.length > 0 && !this._disposed) {
      const batchSize = Math.min(this.workerPool ? this.workerPool.workers.length : 4, this._genQueue.length);
      // console.log(`[ChunkManager] _processGenQueue: batch ${batchSize} of remaining ${this._genQueue.length}`);
      
      // Mark items as generating and remove from queue BEFORE dispatching
        const promises = [];

        for (let i = 0; i < batchSize; i++) {
          const item = this._genQueue.shift();
          const key = chunkKey(item.cx, item.cz);
          if (this.memoryCache.has(key)) continue; // Already loaded while processing
          this._generating.add(key);

          promises.push(
            this.generateChunk(item.cx, item.cz)
              .then(chunk => {
                chunk.dirty = true; // Mark for flush
                this.memoryCache.set(key, chunk);
                this._flushQueue.add(key);
              })
              .catch(e => console.error('[ChunkManager] Queue gen error:', key, e.message))
              .finally(() => this._generating.delete(key))
          );
        }

        // Await THIS batch before starting the next — workers are busy processing
        await Promise.all(promises);
      }
  },

  /**
   * Maintain a voxel region around player — mirrors render chunk logic.
   * Loads/generates chunks within _voxelRegionRadius, unloads far-away chunks.
   * Called every few frames from updateRenderChunks with current player position.
   */
  _updateVoxelRegion(pcx, pcz) {
    if (this._disposed) return;

    // Client mode: never generate chunks — only receive from host via CHUNK_DATA
    if (this.clientMode) {
      // Still unload chunks far outside render range to bound memory
      const rd = this.renderDistance;
      const unloadRadius = rd + 2;
      for (const [key] of this.memoryCache) {
        const { cx: ucx, cz: ucz } = parseChunkKey(key);
        if (Math.abs(ucx - pcx) > unloadRadius || Math.abs(ucz - pcz) > unloadRadius) {
          this.memoryCache.delete(key);
        }
      }
      return;
    }

    const radius = this._voxelRegionRadius;
    const unloadRadius = radius + 2;

    // Collect keys that should be in memory but aren't yet
    const missing = [];
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const cx = pcx + dx;
        const cz = pcz + dz;
        const key = chunkKey(cx, cz);
        if (!this.memoryCache.has(key)) {
          missing.push({ key, cx, cz });
        }
      }
    }

    // Batch-load all missing chunks — single manifest check + single IDB transaction
    // Fire off asynchronously without blocking the frame loop
    if (missing.length > 0) {
      this._batchEnsureChunks(missing).catch(e => {
        console.warn('[ChunkManager] Voxel batch load error:', e.message);
      });
    }

    // Unload chunks far outside voxel region to bound memory
    let unloaded = 0;
    for (const [key] of this.memoryCache) {
      const { cx: ucx, cz: ucz } = parseChunkKey(key);
      if (Math.abs(ucx - pcx) > unloadRadius || Math.abs(ucz - pcz) > unloadRadius) {
        // Flush dirty before unloading
        const chunk = this.memoryCache.get(key);
        if (chunk && chunk.dirty) this._flushQueue.add(key);
        this.memoryCache.delete(key);
        unloaded++;
      }
    }
    if (unloaded > 0) {
      // console.log(`[Cuubz] _updateVoxelRegion: unloaded ${unloaded} distant chunks`);
    }

    // Update last known position for other systems that need it
    this.lastPlayerX = pcx * CHUNK_W;
    this.lastPlayerZ = pcz * CHUNK_D;
  },
};
