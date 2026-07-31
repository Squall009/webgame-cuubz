/**
 * Cuubz — Chunk Manager
 *
 * The world's chunk coordinator: it owns the state, the lifecycle (`init` / `dispose`)
 * and the public surface. The method groups live in sibling files and are attached to
 * `ChunkManager.prototype` at the bottom of this file.
 *
 *   WorkerPool.js             the Web Worker pool class (a real module, 0 fields cross)
 *   ChunkConstants.js         CHUNK_W/CHUNK_D, DB_NAME/DB_VERSION, the two store names
 *   ChunkKeys.js              logical + storage keys, and the H-1 re-keying migration
 *   ChunkSchema.js            the DB_VERSION schema ladder and the single opener (H-2)
 *   ChunkStorage.js           the `chunks` store and the dirty-flush manager
 *   ChunkManifest.js          the `manifests` store, and world create/load
 *   RegionTracker.js          which chunks are resident, and the integrity gate
 *   ChunkGenerator.js         the terrain generation queue and the voxel region
 *   ChunkVoxelAccess.js       getVoxel / applyBlockChange against the memory cache
 *   ChunkMeshCoordinator.js   deciding what to mesh, and getting it meshed
 *   ChunkMeshLifecycle.js     geometry, materials, the scene graph and disposal
 *
 * ─── WHY PROTOTYPE MIXINS AND NOT COMPOSITION (decision 44) ─────────────────
 *
 * This was one 2,057-line class whose methods share TWELVE instance fields: `_db`,
 * `_dbReady`, `_manifest`, `_flushQueue`, `_flushing`, `_flushIntervalId`,
 * `memoryCache`, `worldName`, `worldSeed`, `stats`, `_disposed`, `clientMode`. Splitting
 * that into collaborating objects means rewriting every one of those references AND
 * every call site — internal and external — in the same change that moves 2,000 lines.
 * D-19 is what that costs: it was introduced the last time this file was reorganised,
 * and it took a checksum mismatch that looked like disk corruption to find.
 *
 * So the methods MOVED, verbatim, into plain objects, and `Object.assign` puts them back
 * on the prototype below. `this` is unchanged in every body. `chunkManager.flushDirty()`
 * still resolves. `ChunkManager.prototype._storeKey.call({worldName}, key)` — which
 * `test/e2e/saveLoad.js` does — still resolves. The seams are recorded in each file's
 * header as a count of how many `this.` fields cross them, because that count, not the
 * topic, is what says whether a seam is real.
 *
 * The two exceptions are real modules rather than mixins, because their seams are
 * genuinely zero-crossing: `ChunkSchema.js` (pure statics over `(db, tx, oldVersion,
 * newVersion)`) and `WorkerPool.js`.
 *
 * ─── WHAT DID NOT BECOME A FILE ─────────────────────────────────────────────
 *
 * There is no `ChunkCache.js`. `memoryCache` is read or written by seventeen methods
 * spread across every other file here; wrapping a `Map` in a module would have produced
 * ~15 lines that four files each hold a reference to, plus one more indirection between
 * the cache and everything that uses it.
 *
 * ─── EXPORT SURFACE: UNCHANGED ──────────────────────────────────────────────
 *
 * Every constant, the class, `WorkerPool` and both worker URLs are
 * still exported from THIS path, and every static the class used to carry
 * (`ChunkManager.key`, `.openDatabase`, `.SCHEMA_STEPS`, `._applySchemaUpgrade`, …) is
 * re-attached at the bottom.
 */

import { ChunkGeneratorMethods } from './ChunkGenerator.js';
import { ChunkKeyMigrationMethods, chunkKey, isWorldScopedStoreKey, parseChunkKey, worldKeyPrefix } from './ChunkKeys.js';
import { ChunkManifestMethods, mergeManifestEntries } from './ChunkManifest.js';
import { ChunkMeshCoordinatorMethods } from './ChunkMeshCoordinator.js';
import { ChunkMeshLifecycleMethods } from './ChunkMeshLifecycle.js';
import { ChunkStorageMethods } from './ChunkStorage.js';
import { ChunkVoxelAccessMethods } from './ChunkVoxelAccess.js';
import { RegionTrackerMethods } from './RegionTracker.js';
import { SCHEMA_STEPS, applySchemaUpgrade, ensureBaseSchema, ensureIndex, ensureStore, openDatabase } from './ChunkSchema.js';
import { WorkerPool } from './WorkerPool.js';
import { CHUNK_D, CHUNK_W, DB_NAME, DB_VERSION, STORE_CHUNKS, STORE_MANIFESTS } from './ChunkConstants.js';

// The constants moved to ChunkConstants.js so the files above can read them without
// importing THIS one — `src/` has no import cycles and must not gain one (D-28). They
// are re-exported under their original names so no importer has to change.
export { CHUNK_W, CHUNK_D, DB_NAME, DB_VERSION, STORE_CHUNKS, STORE_MANIFESTS };
// `createWorkerPool` was re-exported here too. D-75 deleted it — no call site, and it was
// missing `init()`'s cache-bust. See the note at the bottom of WorkerPool.js.
export { WorkerPool };

// ─── Worker source URLs (PR 9) ──────────────────────────────────────
//
// Both worker pools are built by fetching source text and wrapping it in a Blob
// (refactor.md §1.3). That is deliberately UNCHANGED here: the Blob indirection is
// what lets a worker that fails to spawn fall back to main-thread generation, and
// PR 9 is a mechanical conversion. What changed is where the source comes from.
//
// The two paths used to be hard-coded strings — `'js/world/workerGeneration.js'` and
// `'js/renderer/meshWorker.js?v=20260726-1'` — which break the instant the files move
// and which Vite cannot see. `?url` makes them build-time asset references: Vite
// resolves them in dev and emits a content-hashed copy into `dist/` on build, so the
// `?v=` cache-bust string (D-23) is no longer maintained by hand either.
//
// NEITHER worker is an ES module and neither becomes one here. `meshWorker.js` has no
// imports and gains nothing from being one; `workerGeneration.js` MUST stay a classic
// IIFE (decision 14, and eslint.config.mjs lints it with `sourceType: 'script'` so an
// `import` in it is a parse error). Both are spawned as classic workers from a Blob.
//
// D-57 — WHY `workerGeneration.js` IS IMPORTED TWICE:
//
//   `?url` yields a build-time asset reference and NOTHING ELSE. A `?url` import never
//   evaluates the module, so for as long as it was the only import of this file the
//   file's own `globalScope._voxelgenGenerateChunk = generateChunk` line never ran on
//   the main thread — and `generateChunk`'s no-worker-pool fallback below, which reads
//   exactly that global, could only ever throw
//   'No worker pool and no inline generation available'. The header used to claim the
//   file "is also evaluated on the main thread as the inline fallback (see
//   src/index.js)"; src/index.js has never contained anything of the kind.
//
//   The plain side-effect import on the next line is what makes that claim true. It is
//   safe precisely because the file is a classic IIFE with no imports and no exports:
//   evaluating it declares nothing at module scope, and its dual-mode tail
//   (`typeof globalScope.document !== 'undefined'`) is what picks the main-thread
//   branch and assigns the global. The `?url` import still emits the separate
//   content-hashed copy the Worker is spawned from — the two are different module ids
//   and neither affects the other.
import './workerGeneration.js';
import meshWorkerUrl from '../renderer/meshWorker.js?url';
import workerGenerationUrl from './workerGeneration.js?url';

export { meshWorkerUrl, workerGenerationUrl };

// ============================================================
// CHUNK MANAGER (monolith)
// ============================================================
export class ChunkManager {
  /**
   * @param {Object} options
   * @param {THREE.Scene|THREE.Group} options.renderer - Renderer instance with chunkGroup property
   * @param {string} options.worldName - World ID for IndexedDB namespace
   * @param {string} options.worldSeed - World seed string
   * @param {Object} options.genParams - Generation parameters (scales, thresholds, etc.)
   * @param {string} [options.workerScriptPath] - Worker generation source URL (defaults to the ?url import above)
   * @param {number} [options.renderDistance=4] - Render radius in chunks (8×8 area)
   * @param {number} [options.regionRadius=16] - Pre-generation radius in chunks (32×32 area)
   * @param {*} [options.textureAtlas=null] - Texture atlas instance for UV mapping
   * @param {Function} [options.onChunkGenerated=null] - Callback when a chunk finishes generation
   */
  constructor(options = {}) {
    this.renderer = options.renderer || null;
    this.worldName = options.worldName || 'default';
    this.worldSeed = String(options.worldSeed || '');
    // Defaults match voxelgen.html slider values exactly — do not change without verifying terrain look.
    this.genParams = Object.assign({
      continentScale: 4000, contScale: 400, tempScale: 2000, humScale: 2000, erosScale: 280,
      detailScale: 40, octaves: 5, persistence: 0.5, lacunarity: 2.0,
      caveScale: 50, caveThresh: 0.10, riverScale: 1000, riverDensity: 0.30, riverDepth: 20
    }, options.genParams || {});

    this.workerScriptPath = options.workerScriptPath || workerGenerationUrl;
    this.renderDistance   = Math.max(2, Math.min(16, options.renderDistance ?? 4));
    this.regionRadius     = Math.max(this.renderDistance + 2, Math.min(32, options.regionRadius ?? 16));

    // Client mode: no local chunk generation, no IndexedDB persistence, only receive
    // chunks from the host.
    // D-75: this assignment appeared TWICE, back to back, with two wordings of the same
    // comment. Identical right-hand sides, so the second was a no-op; deleted.
    this.clientMode = !!options.clientMode;

    // Texture atlas for UV mapping during mesh build
    this.textureAtlas = options.textureAtlas || null;

    // Callbacks
    this.onChunkGenerated = options.onChunkGenerated || null;

    // ─── Worker Pool (voxel generation) ──────────────────────────
    this.workerPool = null;
    this._blobUrl = null;

    // ─── Mesh Builder Worker Pool ────────────────────────────────
    this.meshWorkerPool = null;
    this._meshBlobUrl = null;
    this._pendingMeshBuilds = new Map(); // key → Promise for in-flight mesh builds

    // ─── IndexedDB ───────────────────────────────────────────────
    this._db = null;
    this._dbReady = null;

    // ─── Manifest (world metadata) ──────────────────────────────
    this._manifest = null;

    // ─── Memory Cache (32×32 region in RAM) ─────────────────────
    this.memoryCache = new Map(); // key "cx,cz" → Chunk instance

    // ─── Loaded Meshes (8×8 render range) ────────────────────────
    this.loadedMeshes = new Map(); // key → { solid, cutout, transparent } THREE.Mesh objects
    this._rebuilding = new Set();  // keys currently in mesh build pipeline

    // ─── Dirty Flush Manager ────────────────────────────────────
    this._flushQueue = new Set();      // keys of chunks marked dirty, awaiting flush
    this._flushIntervalId = null;
    this._flushing = false;            // prevent concurrent flush cycles

    // ─── Region Check Timer ─────────────────────────────────────
    this._regionCheckTimerId = null;
    this.lastPlayerX = -32;
    this.lastPlayerZ = -32;

    // ─── Generation Queue (async) ────────────────────────────────
    this._genQueue = [];               // [{cx, cz}] pending generation dispatches
    this._generating = new Set();      // keys currently being generated by workers
    this._genProcessing = false;       // prevent concurrent queue processing

    // ─── Render chunk state ──────────────────────────────────────
    this._renderFrameCount = 0;        // Throttle voxel unload to every N frames
    // Derived from renderDistance — `setRenderDistance` recomputes it with this exact
    // expression (D-66). `this.regionRadius` above is `Math.min(32, options.regionRadius ?? 16)`
    // already floored at `renderDistance + 2`, so this is value-identical to computing it
    // from `options.regionRadius` directly, and it is the form `setRenderDistance` can reuse.
    this._voxelRegionRadius = Math.max(this.renderDistance + 2, Math.min(32, this.regionRadius));

    // ─── Mesh worker queue (dispatch coalescing) ────────────────
    this._meshBuildQueue = [];         // pending mesh builds waiting for a free worker
    this._uvLookupCache = this._meshTablesCache = null; // precomputed UV lookup + registry-derived block tables for the mesh worker (D-63)

    // ─── Stats ──────────────────────────────────────────────────
    this.stats = {
      chunksGenerated: 0,
      chunksLoadedFromDisk: 0,
      chunksFlushed: 0,
      meshesBuilt: 0,
    };

    // ─── Disposed flag ──────────────────────────────────────────
    this._disposed = false;
  }

  // ============================================================
  // INITIALIZATION
  // ============================================================

  /** Initialize worker pools. Must be called before generateChunk or update(). */
  async init() {
    if (this._disposed) return;

    // Client mode: skip voxel generation workers, but keep mesh workers for rendering received chunks
    if (this.clientMode) {
      console.log('[ChunkManager] Client mode: skipping voxel workers, keeping mesh workers');
    } else {
      try {
        const response = await fetch(this.workerScriptPath + (this.workerScriptPath.includes('?') ? '&' : '?') + 'v=' + Date.now());
        const source = await response.text();
        const blob = new Blob([source], { type: 'application/javascript' });
        this._blobUrl = URL.createObjectURL(blob);
        this.workerPool = new WorkerPool(navigator.hardwareConcurrency || 4, this._blobUrl);
      } catch (e) {
        console.warn('[ChunkManager] Worker pool init failed:', e.message);
      }
    }

    // Initialize mesh builder workers (needed for both host and client)
    await this._initMeshWorkers();

    // Open IndexedDB lazily on first access
  }

  /** Initialize mesh builder worker pool. */
  async _initMeshWorkers() {
    try {
      const response = await fetch(meshWorkerUrl);
      const source = await response.text();
      const blob = new Blob([source], { type: 'application/javascript' });
      this._meshBlobUrl = URL.createObjectURL(blob);
      // Use half the cores for mesh building (generation is more compute-heavy)
      const meshCount = Math.max(2, Math.floor((navigator.hardwareConcurrency || 4) / 2));
      this.meshWorkerPool = new WorkerPool(meshCount, this._meshBlobUrl);
    } catch (e) {
      console.warn('[ChunkManager] Mesh worker pool init failed — will build on main thread:', e.message);
      // Fallback: mesh building happens on main thread via _buildMeshInline()
    }
  }

  // ============================================================
  // RENDER DISTANCE (performance optimizer integration)
  // ============================================================

  /**
   * Change the render (mesh) distance, and with it the voxel region radius derived
   * from it.
   *
   * D-66: this used to set `renderDistance` and then fire
   * `this.onRenderDistanceChange` — a field the constructor never initialised and
   * that nothing in `src/` ever assigned, so the branch was dead in every build. The
   * one module that did assign such a callback assigned it to *itself*
   * (`PerformanceOptimizer.js`), and PR 20 deleted it. A callback nothing can set is
   * D-42's shape — a wiring point that is not one — so it is gone rather than wired.
   *
   * What it did NOT do was recompute `_voxelRegionRadius`, which the constructor
   * derives from `renderDistance` with the expression repeated below. `_updateVoxelRegion`
   * reads that field every few frames, so raising or lowering the slider left the voxel
   * region — the thing that decides which chunks are resident and generated — pinned to
   * whatever the render distance happened to be at startup for the rest of the session.
   * The floor is `renderDistance + 2` deliberately: the voxel region must always extend
   * at least one chunk past the meshes, or the outermost meshes get built against
   * unloaded neighbours.
   */
  setRenderDistance(distance) {
    this.renderDistance = Math.max(2, Math.min(16, distance));
    this._voxelRegionRadius = Math.max(this.renderDistance + 2, Math.min(32, this.regionRadius));
  }

  // ============================================================
  // DISPOSAL / CLEANUP
  // ============================================================

  dispose() {
    if (this._disposed) return;
    this._disposed = true;

    // Stop timers
    this.stopFlushTimer();
    this.stopRegionCheck();

    // Terminate workers
    if (this.workerPool) {
      this.workerPool.terminate();
      this.workerPool = null;
    }
    if (this.meshWorkerPool) {
      this.meshWorkerPool.terminate();
      this.meshWorkerPool = null;
    }
    if (this._blobUrl) URL.revokeObjectURL(this._blobUrl);
    if (this._meshBlobUrl) URL.revokeObjectURL(this._meshBlobUrl);

    // Dispose all meshes
    for (const [key] of this.loadedMeshes) {
      this._unloadMesh(key);
    }
    this.loadedMeshes.clear();
    this.memoryCache.clear();
    this._flushQueue.clear();
    this._rebuilding.clear();
    this._pendingMeshBuilds.clear();

    // Close IndexedDB
    if (this._db) {
      this._db.close();
      this._db = null;
      this._dbReady = null;
    }
  }
}

// ============================================================
// PROTOTYPE MIXINS — the method groups, put back on the class
// ============================================================
//
// Order is irrelevant: no two of these objects define the same method name, and the
// guard below throws at module load if that ever stops being true. A silent overwrite
// is the one failure mode a mixin split has that a single class does not — two files
// defining `_unloadMesh` would leave whichever assigned last, with no error, which is
// the shared-global-scope collision class refactor.md §2 and test_globalCollisions.js
// exist for. `Object.assign` copies own enumerable properties: an object literal's
// methods are exactly that.
const MIXINS = [
  ['ChunkKeys', ChunkKeyMigrationMethods],
  ['ChunkStorage', ChunkStorageMethods],
  ['ChunkManifest', ChunkManifestMethods],
  ['RegionTracker', RegionTrackerMethods],
  ['ChunkGenerator', ChunkGeneratorMethods],
  ['ChunkVoxelAccess', ChunkVoxelAccessMethods],
  ['ChunkMeshCoordinator', ChunkMeshCoordinatorMethods],
  ['ChunkMeshLifecycle', ChunkMeshLifecycleMethods],
];

{
  const seen = new Map();
  for (const [file, methods] of MIXINS) {
    for (const name of Object.keys(methods)) {
      const prior = seen.get(name) ||
        (Object.prototype.hasOwnProperty.call(ChunkManager.prototype, name) ? 'the class body' : null);
      if (prior) {
        throw new Error(`[ChunkManager] Mixin collision: '${name}' is defined by both ` +
          `${prior} and ${file}.js. Two files cannot own the same method.`);
      }
      seen.set(name, file + '.js');
    }
  }
}

Object.assign(ChunkManager.prototype, ...MIXINS.map(([, methods]) => methods));

// ============================================================
// STATICS — re-attached under the names the rest of the codebase uses
// ============================================================
//
// These stopped being class members when they moved to modules that touch no instance
// field, but they are part of this class's published surface: `src/testBridge.js`
// exposes the class itself, and `test/unit/engine/chunkStorage.test.js`, `test/e2e/saveLoad.js` and
// `src/engine/world/Persistence.js` reach for these names on it. Re-attaching costs
// eleven lines and keeps every one of those call sites byte-identical.
//
// `SCHEMA_STEPS` is assigned by REFERENCE, deliberately: `applySchemaUpgrade` reads the
// binding inside ChunkSchema.js, and the tests register a synthetic v3 step by mutating
// `ChunkManager.SCHEMA_STEPS[3]`. Same object, so the mutation is visible to the ladder.
ChunkManager.key = chunkKey;
ChunkManager.parseKey = parseChunkKey;
ChunkManager.worldKeyPrefix = worldKeyPrefix;
ChunkManager.isWorldScopedStoreKey = isWorldScopedStoreKey;
ChunkManager._mergeManifestEntries = mergeManifestEntries;
ChunkManager._ensureStore = ensureStore;
ChunkManager._ensureIndex = ensureIndex;
ChunkManager._ensureBaseSchema = ensureBaseSchema;
ChunkManager._applySchemaUpgrade = applySchemaUpgrade;
ChunkManager.openDatabase = openDatabase;
ChunkManager.SCHEMA_STEPS = SCHEMA_STEPS;
