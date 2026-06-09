/**
 * Cuubz — Worker Pool (VoxelGen Overhaul)
 * Dispatches chunk generation across N Web Workers via Blob URL.
 */

class WorkerPool {
  /**
   * @param {number} count - Number of workers (default: hardwareConcurrency).
   * @param {string} workerUrl - Blob URL pointing to workerGeneration.js content.
   */
  constructor(count, workerUrl) {
    this.workers = [];
    this.idleWorkers = [];

    const numWorkers = Math.max(2, count || (navigator.hardwareConcurrency || 4));
    for (let i = 0; i < numWorkers; i++) {
      const w = new Worker(workerUrl);
      this.workers.push(w);
      this.idleWorkers.push(w);
    }
  }

  /**
   * Dispatch a chunk generation task. Returns a Promise that resolves with the worker result.
   */
  dispatch(chunkX, chunkZ, seed, params) {
    var self = this;
    return new Promise(function (resolve, reject) {
      var w = self.idleWorkers.pop();
      if (!w) {
        // Queue and retry on next tick (shouldn't happen — pool >= pending tasks).
        setTimeout(function () {
          self.dispatch(chunkX, chunkZ, seed, params).then(resolve).catch(reject);
        }, 0);
        return;
      }

      var handler = function (e) {
        w.removeEventListener('message', handler);
        w.removeEventListener('error', errorHandler);
        clearTimeout(timeoutId);
        self.idleWorkers.push(w);

        if (e.data && e.data.type === 'error') {
          reject(new Error('[Worker] Chunk [' + chunkX + ',' + chunkZ + '] error: ' + (e.data.error || 'unknown')));
        } else {
          resolve(e.data);
        }
      };

      var errorHandler = function (e) {
        w.removeEventListener('message', handler);
        w.removeEventListener('error', errorHandler);
        clearTimeout(timeoutId);
        self.idleWorkers.push(w);
        reject(new Error('[Worker] Chunk [' + chunkX + ',' + chunkZ + '] fatal: ' + e.message));
      };

      // Safety timeout — generation should never take >10s per chunk.
      var timeoutId = setTimeout(function () {
        w.removeEventListener('message', handler);
        w.removeEventListener('error', errorHandler);
        self.idleWorkers.push(w);
        reject(new Error('[Worker] Chunk [' + chunkX + ',' + chunkZ + '] timeout after 10s'));
      }, 10000);

      w.addEventListener('message', handler);
      w.addEventListener('error', errorHandler);

      // Send work payload. Note: params.baseChunkX/baseChunkZ must be set by caller.
      w.postMessage({ type: 'work', chunkX: chunkX, chunkZ: chunkZ, seed: seed, params: params });
    });
  }

  /** Terminate all workers and clean up. */
  terminate() {
    this.workers.forEach(w => w.terminate());
    this.workers = [];
    this.idleWorkers = [];
  }
}

/**
 * Create a WorkerPool from the workerGeneration.js file content.
 * Uses fetch + Blob URL so no separate file serve is needed for workers.
 */
async function createWorkerPool(workerScriptPath = 'js/world/workerGeneration.js') {
  const response = await fetch(workerScriptPath);
  const source = await response.text();
  const blob = new Blob([source], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);

  const pool = new WorkerPool(navigator.hardwareConcurrency || 4, url);
  // Store the blob URL so we can revoke it later.
  pool._blobUrl = url;
  return pool;
}

/**
 * Alternative: inline worker source (for environments where fetch fails).
 */
function createWorkerPoolInline(workerSource) {
  const blob = new Blob([workerSource], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  const pool = new WorkerPool(navigator.hardwareConcurrency || 4, url);
  pool._blobUrl = url;
  return pool;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WorkerPool, createWorkerPool, createWorkerPoolInline };
}
