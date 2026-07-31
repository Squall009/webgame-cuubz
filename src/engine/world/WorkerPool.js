/**
 * Cuubz — Web Worker pool (PR 23)
 *
 * Split out of ChunkManager.js unchanged. A REAL MODULE, not a prototype mixin: it is
 * a self-contained class over its own `workers` / `idleWorkers` arrays and reads no
 * ChunkManager field at all. ZERO fields cross this boundary.
 *
 * Both of ChunkManager's pools are instances of this one class — the voxel generation
 * pool and the mesh builder pool differ only in the Blob they are spawned from and how
 * many workers they get. `ChunkManager.init` / `_initMeshWorkers` own that difference.
 *
 * `dispatch` is the voxel-generation protocol (`{type:'work'}` → `{type:'result'}`);
 * the mesh pool bypasses it and talks to `idleWorkers` directly from
 * ChunkMeshCoordinator.js, because mesh builds transfer buffers and need a queue rather
 * than a `setTimeout(0)` retry. That asymmetry predates the split and is unchanged.
 *
 * ChunkManager.js re-exports both symbols, so `import { WorkerPool } from './ChunkManager.js'`
 * still resolves.
 */

// ============================================================
// WORKER POOL (voxel generation)
// ============================================================
export class WorkerPool {
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

  dispatch(chunkX, chunkZ, seed, params) {
    const self = this;
    return new Promise((resolve, reject) => {
      let w = self.idleWorkers.pop();
      if (!w) {
        setTimeout(() => {
          self.dispatch(chunkX, chunkZ, seed, params).then(resolve).catch(reject);
        }, 0);
        return;
      }

      const handler = (e) => {
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

      const errorHandler = (e) => {
        w.removeEventListener('message', handler);
        w.removeEventListener('error', errorHandler);
        clearTimeout(timeoutId);
        self.idleWorkers.push(w);
        reject(new Error('[Worker] Chunk [' + chunkX + ',' + chunkZ + '] fatal: ' + e.message));
      };

      const timeoutId = setTimeout(() => {
        w.removeEventListener('message', handler);
        w.removeEventListener('error', errorHandler);
        self.idleWorkers.push(w);
        reject(new Error('[Worker] Chunk [' + chunkX + ',' + chunkZ + '] timeout after 10s'));
      }, 10000);

      w.addEventListener('message', handler);
      w.addEventListener('error', errorHandler);
      w.postMessage({ type: 'work', chunkX, chunkZ, seed, params });
    });
  }

  terminate() {
    this.workers.forEach(w => w.terminate());
    this.workers = [];
    this.idleWorkers = [];
  }
}

export async function createWorkerPool(workerScriptPath) {
  const response = await fetch(workerScriptPath);
  const source = await response.text();
  const blob = new Blob([source], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  const pool = new WorkerPool(navigator.hardwareConcurrency || 4, url);
  pool._blobUrl = url;
  return pool;
}
