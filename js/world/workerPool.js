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
    return new Promise((resolve) => {
      const w = this.idleWorkers.pop();
      if (!w) {
        // Queue and retry on next tick (shouldn't happen — pool >= pending tasks).
        setTimeout(() => {
          this.dispatch(chunkX, chunkZ, seed, params).then(resolve);
        }, 0);
        return;
      }

      const handler = (e) => {
        w.removeEventListener('message', handler);
        this.idleWorkers.push(w);
        resolve(e.data);
      };
      w.addEventListener('message', handler);

      // Send work payload. Note: params.baseChunkX/baseChunkZ must be set by caller.
      w.postMessage({ type: 'work', chunkX, chunkZ, seed, params });
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
