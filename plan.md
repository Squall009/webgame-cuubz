# Chunk Lifecycle Overhaul Implementation Plan

> **Status:** Planning phase. No code changes yet.
> **Based on:** User requirements for simplified chunk lifecycle, consolidated architecture, and decoupled voxel/mesh systems.

## Executive Summary

The current chunk system is fragmented across 7+ files with overlapping responsibilities: multiple dirty-marking paths (`markDirty` vs `markNewlyGenerated`), lazy getters in flush manager, adjacent-chunk rebuild storms after every mesh build, worker generation returning dead data (biomeNames/surfaceMap), and an unused water-levels array bloating storage. This plan consolidates everything into a single authoritative `chunkmanager.js`, decouples voxel persistence from mesh rendering, eliminates the delta-tracking concept in favor of simple dirty/changed flags, and introduces aggressive pre-generation with a 32×32 region range so mesh building never needs to wait for data.

## Architecture Overview (Target State)

```
┌─────────────────────────────────────────────────────────────────────┐
│                         PLAYER MOVES                                │
└──────────┬──────────────────────────────────────────┬───────────────┘
           │                                          │
           ▼                                          ▼
   ┌──────────────────┐                        ┌──────────────────┐
   │  REGION CHECK     │                        │  RENDER CHECK    │
   │  (32×32, tick)    │                        │  (8×8, every     │
   │                  │                        │   frame)          │
   │ • Not in manifest│                        │                   │
   │   → worker queue │                        │ • changed===true? │
   │ • In manifest,   │                        │   → mesh rebuild  │
   │   not in memory  │                        │ • Out of range?   │
   │   → load from IDB│                        │   → unload mesh   │
   └────────┬─────────┘                        └────────┬──────────┘
            │                                           │
            ▼                                           ▼
   ┌──────────────────┐                        ┌──────────────────┐
   │  VOXEL WORKERS    │                        │  MESH WORKERS     │
   │  (generation)     │                        │  (geometry build) │
   │ • Terrain pass    │                        │ • Block→face      │
   │ • Returns blocks  │                        │ • No IDB access   │
   └────────┬─────────┘                        └────────┬──────────┘
            │                                           │
            ▼                                           ▼
   ┌──────────────────┐                        ┌──────────────────┐
   │  CHUNK.dirty=true │                        │  THREE.Mesh      │
   │  → DirtyFlush     │                        │  (scene graph)   │
   │  (every 5s)       │                        │                  │
   │ • RLE encode full │                        │                  │
   │ • saveChunk+verify│                        │                  │
   │ • manifest update │                        │                  │
   └──────────────────┘                        └──────────────────┘

Memory Cache (32×32 chunks in RAM)
  ├─ ChunkManager owns all reads/writes to IndexedDB
  └─ MeshBuilder reads from memory cache only — never touches storage
```

## What Already Exists ✅

| Component | File | Status | Notes |
|-----------|------|--------|-------|
| Block types/constants | `js/world/chunkData.js` | Good | Keep as-is. Global reference for BLOCK_TYPES, CHUNK_HEIGHT etc. |
| ChunkManager (orchestrator) | `js/renderer/chunkManager.js` | Partially good | Mesh loading/unloading works. Dirty logic is tangled with mesh building. |
| ChunkStore (IndexedDB) | `js/world/chunkStore.js` | Good | Binary format, manifest tracking, batch ops all work. Keep persistence layer intact. |
| DirtyFlushManager | `js/world/dirtyFlushManager.js` | Overcomplicated | Two mark paths, lazy getters, pendingManifest Set. Needs simplification to single dirty flag path. |
| WorldGenerator (worker dispatch) | `js/world/worldGenerator.js` + `createWorkerPool()` | Good | Worker pool pattern works well. Returns too much data (biomeNames, surfaceMap). |
| Worker generation code | `js/world/workerGeneration.js` | Good core | Terrain/cave/ore logic is solid. Strip biomeNames/surfaceMap from return value. |
| ChunkGrid | `js/world/chunkGrid.js` | Stale | Not actively used by main game loop — ChunkManager handles this. Will be merged. |
| Mesh builder | `js/renderer/meshBuilder.js` | Good | Runs on main thread currently. Needs worker pool migration (like voxel workers). |
| Feature placer | `js/world/featurePlacer.js` | Dead code | Not needed. Will be stripped entirely. Eventually moves into worker generation pass. |

## Gaps to Close ❌

### 1. Too many files, too much overlap
Seven files share responsibility for chunk lifecycle. ChunkManager calls DirtyFlush which calls ChunkStore while WorldGenerator manages workers that generate data ChunkManager then loads from IDB. No single file owns the flow end-to-end.

### 2. Two dirty-marking paths with different semantics
`markDirty()` vs `markNewlyGenerated()` — both do the same thing plus one adds to a pending manifest Set. Lazy getters add complexity for no benefit when we're just flushing every 5 seconds anyway.

### 3. Adjacent chunk rebuild storm
Every time `_buildChunk()` finishes, it rebuilds all 4 neighboring chunks because they may have built with stale neighbor=air data. With N chunks loading, this creates O(N×4) redundant mesh builds.

### 4. Water levels array — unused baggage
`Uint8Array[65536]` for water levels exists in every chunk but nothing uses it. Bloats memory (2× the blocks array), storage encoding, and decode paths.

### 5. Worker returns dead data
`biomeNames` and `surfaceMap` are returned by workers but consumed by nothing after generation. Wasted serialization/transfer overhead per chunk.

### 6. No pre-generation buffer
Chunks are generated on-demand when player reaches them. With generation happening in the same flow as mesh building, there's no separation between "data exists" and "mesh is ready."

## Implementation Plan

---

### Phase 1: Cleanup — Remove Dead Code (Priority: HIGH)

**Estimated effort:** ~200 lines removed across multiple files

#### 1.1 Strip water levels from Chunk class
**File:** `js/world/chunkData.js`

Remove `this.waterLevels`, `_localIndex()` water level paths, `getWaterLevel()`, `setWaterLevel()`, `isWaterSource()`. Remove WATER_LEVEL constants. Remove from serialize/deserialize.

```javascript
// BEFORE (chunkData.js constructor):
constructor(chunkX, chunkZ) {
  this.blocks = new Uint8Array(CHUNK_WIDTH * CHUNK_DEPTH * CHUNK_HEIGHT);
  this.waterLevels = new Uint8Array(CHUNK_WIDTH * CHUNK_DEPTH * CHUNK_HEIGHT);
  this.neighbors = {...};
}

// AFTER:
constructor(chunkX, chunkZ) {
  this.blocks = new Uint8Array(CHUNK_WIDTH * CHUNK_DEPTH * CHUNK_HEIGHT);
  this.dirty = false;
  this.changed = false;
  // No waterLevels. No neighbors (handled by ChunkManager).
}
```

Remove `WATER_LEVEL_SOURCE`, `WATER_LEVEL_FLOWING_MIN/MAX` constants. Remove water level logic from `setBlock()`.

#### 1.2 Strip biomeNames and surfaceMap from worker return value
**File:** `js/world/workerGeneration.js`

In `generateChunk()` return, remove `biomeNames` and `surfaceMap`. Worker only returns `{ cx, cz, chunkBytes }`:

```javascript
// BEFORE:
return { cx: result.cx, cz: result.cz, chunkBytes: result.chunkBytes, biomeNames: ..., surfaceMap: ... };

// AFTER (worker postMessage):
self.postMessage({ type: 'result', cx: result.cx, cz: result.cz, chunkBytes: result.chunkBytes.buffer }, [result.chunkBytes.buffer]);
```

Remove `biomeNames` array allocation and population from generation code. Remove `surfaceMap` Int32Array.

#### 1.3 Strip water level encoding/decoding from binary codec
**File:** `js/world/chunkBinaryCodec.js`

- Remove `_hasNonZeroWater()`, `_rleEncode8()`
- Remove `CHUNK_FLAG_HAS_WATER_LEVELS` flag and all references to it
- Remove water levels section from `encode()` (no more water runs in binary)
- Remove water levels decoding from `decode()`
- Update header layout (can shrink since no water data follows block data)

#### 1.4 Delete featurePlacer.js entirely
**File:** `js/world/featurePlacer.js` → **DELETE**

Search for all references to `featurePlacer`, `FeaturePlacer`, and any imports/requires. Remove them. Feature placement will eventually be added back inside the worker generation pass as a single terrain+features pass.

#### 1.5 Update mesh builder to remove water level lookup
**File:** `js/renderer/meshBuilder.js` (or wherever mesh building lives)

Remove `waterLevelLookup` parameter from `buildMeshData()`. Remove all water level rendering paths. Fluid blocks render as flat solid faces for now — sloped rendering comes later.

---

### Phase 2: Write New ChunkManager.js (Priority: CRITICAL)

**File:** Create `js/chunkmanager.js`
**Estimated effort:** ~800-1000 lines, replaces 6 existing files

This is the single authoritative file for everything chunk-related except mesh building and block constants. It contains:

#### 2.1 New Chunk class (replaces chunkData.js Chunk)

```javascript
class Chunk {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.blocks = new Uint8Array(CHUNK_W * CHUNK_H * CHUNK_D); // 65536
    this.dirty   = false;  // Player modified → needs flush to IndexedDB (every 5s)
    this.changed = false;  // Block changed since last frame → needs mesh rebuild now
  }

  getBlock(lx, ly, lz) {
    if (ly < 0 || ly >= CHUNK_H) return BLOCK_TYPES.AIR;
    if (lx < 0 || lx >= CHUNK_W || lz < 0 || lz >= CHUNK_D) return -1; // out of bounds → caller handles neighbor lookup
    return this.blocks[this._idx(lx, ly, lz)];
  }

  setBlock(lx, ly, lz, type) {
    if (lx < 0 || lx >= CHUNK_W || lz < 0 || lz >= CHUNK_D || ly < 0 || ly >= CHUNK_H) return;
    const idx = this._idx(lx, ly, lz);
    if (this.blocks[idx] !== type) {
      this.blocks[idx] = type;
      this.dirty = true;
      this.changed = true;
    }
  }

  _idx(x, y, z) {
    return x + (z * CHUNK_W) + (y * CHUNK_W * CHUNK_D);
  }
}
```

**Key design decisions:**
- `getBlock()` returns `-1` for out-of-bounds instead of querying neighbors. Neighbor lookup is handled by ChunkManager's voxel query method that knows which chunk to ask.
- No water levels, no neighbor references on the chunk itself.
- Both flags set in `setBlock()` — one for persistence (dirty), one for rendering (changed).

#### 2.2 Worker Pool (merged from worldGenerator.js + workerGeneration.js)

```javascript
class ChunkManager {
  // ... constructor properties:
  this.workerPool = null;      // Web Worker pool for terrain generation
  this.worldSeed = '';         // World seed string
  this.genParams = {...};      // Generation parameters (scales, thresholds, etc.)
}

async initWorkers(workerScriptPath) {
  // Fetch workerGeneration.js → Blob URL → spawn N workers
  // Each worker receives: generateChunk(cx, cz, seed, params) messages
  // Returns: { cx, cz, chunkBytes } only
}

async requestGenerate(cx, cz) {
  // Dispatch to idle worker, return Promise<Uint8Array> (raw blocks data)
  // Inline fallback if workers unavailable
}
```

The generation code from `workerGeneration.js` gets inlined as a blob script string or kept as a separate file that the ChunkManager fetches. Worker pool pattern stays identical — it works well.

#### 2.3 IndexedDB Store (merged from chunkStore.js)

Keep the same IndexedDB schema and operations. Inline these methods into ChunkManager:

```javascript
// Same DB_NAME, CHUNKS_STORE, MANIFESTS_STORE constants
async saveChunk(key, binaryData)      // put to chunks store
async loadChunk(key)                  // get from chunks store → ArrayBuffer | null
async hasChunk(key)                   // count > 0
async deleteChunk(key)                // remove from store
async loadManifest()                  // world metadata + generatedChunks[]
async saveManifest(manifest)          // upsert manifest
async addVerifiedChunk(key, checksum) // add to generatedChunks with checksum
async isChunkGenerated(key)           // check manifest list
```

No functional changes here — just consolidation.

#### 2.4 Dirty Flush Manager (merged from dirtyFlushManager.js)

Simplified to a single path:

```javascript
// Properties on ChunkManager:
this._flushQueue = new Set();    // Keys of chunks marked dirty, awaiting flush
this._flushIntervalId = null;    // setInterval handle

startFlushTimer(intervalMs = 5000) {
  this._flushIntervalId = setInterval(() => this.flushDirty(), intervalMs);
}

// Called by setBlock() when a block changes:
queueForFlush(key) {
  this._flushQueue.add(key);
}

async flushDirty() {
  if (this._flushQueue.size === 0) return;
  const keys = [...this._flushQueue];
  this._flushQueue.clear();

  for (const key of keys) {
    const chunk = this.memoryCache.get(key);
    if (!chunk || !chunk.dirty) continue; // Stale reference or already clean

    try {
      const binaryData = ChunkBinaryCodec.encode(chunk);
      const expectedChecksum = ChunkBinaryCodec.computeChecksum(binaryData);

      await this.saveChunk(key, binaryData);
      const readBack = await this.loadChunk(key);
      if (!readBack) continue; // Retry next cycle

      if (ChunkBinaryCodec.computeChecksum(readBack) !== expectedChecksum) {
        console.warn(`Flush verify failed for ${key}`);
        chunk.dirty = true;     // Keep dirty for retry
        this._flushQueue.add(key);
        continue;
      }

      // Success: writeback verified
      await this.addVerifiedChunk(key, expectedChecksum);
      chunk.dirty = false;

    } catch (err) {
      console.warn(`Flush error for ${key}:`, err.message);
    }
  }
}
```

**Single path:** `chunk.dirty === true` → encode full in-memory blocks → save → verify → clear dirty. No delta concept, no lazy getters, no pendingManifest set. The manifest is updated with checksum on success regardless of whether it's a new chunk or update — `addVerifiedChunk()` handles both cases (insert if missing, update checksum if exists).

#### 2.5 Memory Cache

```javascript
this.memoryCache = new Map();   // key "cx,cz" → Chunk instance
// Holds up to ~32×32 chunks in memory (~65K bytes × 1024 ≈ 67MB for blocks only)
```

This is the single source of truth for loaded chunk data. Mesh builder reads from here. Flush writes encode from here. No other component touches IndexedDB directly.

#### 2.6 Voxel Query (neighbor-aware block lookup)

```javascript
// Mesh builder calls this to look up any voxel, including cross-chunk boundaries:
getVoxel(wx, wy, wz) {
  const cx = Math.floor(wx / CHUNK_W);
  const cz = Math.floor(wz / CHUNK_D);
  const chunk = this.memoryCache.get(`${cx},${cz}`);
  if (!chunk) return BLOCK_TYPES.AIR; // Chunk not loaded → treat as air (safe default for face culling)
  const lx = ((wx % CHUNK_W) + CHUNK_W) % CHUNK_W;
  const lz = ((wz % CHUNK_D) + CHUNK_D) % CHUNK_D;
  return chunk.getBlock(lx, wy, lz);
}
```

This replaces the neighbor-lookup callbacks that mesh builder currently builds inline. Single authoritative method.

#### 2.7 Region Tracking (32×32 pre-generation range)

Called on every tick (~500ms via `setInterval`) and chunk boundary crossing:

```javascript
checkRegion(playerX, playerZ) {
  const pcx = Math.floor(playerX / CHUNK_W);
  const pcz = Math.floor(playerZ / CHUNK_D);
  const radius = this.regionRadius; // 16 → 32×32 area

  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      const cx = pcx + dx;
      const cz = pcz + dz;
      const key = `${cx},${cz}`;

      // Already in memory? Skip.
      if (this.memoryCache.has(key)) continue;

      this._ensureChunkInRegion(cx, cz);
    }
  }

  // Unload chunks far outside region to bound memory:
  for (const [key, chunk] of this.memoryCache) {
    const [kx, kz] = key.split(',').map(Number);
    if (Math.abs(kx - pcx) > radius + 2 || Math.abs(kz - pcz) > radius + 2) {
      // Flush dirty before unloading:
      if (chunk.dirty) this._flushQueue.add(key);
      this.memoryCache.delete(key);
    }
  }
}

async _ensureChunkInRegion(cx, cz) {
  const key = `${cx},${cz}`;
  if (this.memoryCache.has(key)) return;

  // Check manifest: does this chunk exist in persistent storage?
  const existsInManifest = await this.isChunkGenerated(key);

  if (!existsInManifest) {
    // Queue for worker generation → returns raw blocks → creates Chunk → marks dirty
    this._queueGeneration(cx, cz);
  } else {
    // Load from IndexedDB into memory cache:
    const binaryData = await this.loadChunk(key);
    if (binaryData) {
      const chunk = ChunkBinaryCodec.decode(binaryData);
      this.memoryCache.set(key, chunk);
    }
  }
}
```

**Critical point:** This runs asynchronously and does NOT block the game loop. It fires `async` operations that complete in the background. By the time the player approaches a chunk boundary, the data is already loaded into memory.

#### 2.8 Render Range Integration (8×8 mesh range)

Called every frame:

```javascript
updateRenderChunks(playerX, playerZ) {
  const pcx = Math.floor(playerX / CHUNK_W);
  const pcz = Math.floor(playerZ / CHUNK_D);
  const rd = this.renderDistance; // 4 → 8×8 area (or whatever PerformanceOptimizer sets)

  const needed = new Set();
  for (let dx = -rd; dx <= rd; dx++) {
    for (let dz = -rd; dz <= rd; dz++) {
      needed.add(`${pcx + dx},${pcz + dz}`);
    }
  }

  // Unload out-of-range meshes:
  for (const [key] of this.meshTracker) {
    if (!needed.has(key)) {
      this._unloadMesh(key);
    }
  }

  // Build/rebuild in-range meshes:
  for (const key of needed) {
    const chunk = this.memoryCache.get(key);
    if (!chunk) continue; // Not loaded yet — region check will load it soon

    if (chunk.changed && !this._rebuilding.has(key)) {
      // Queue for mesh builder workers, immediately clear the flag:
      this._queueMeshBuild(cx, cz, chunk.blocks);
      chunk.changed = false;
      this._rebuilding.add(key);
    }

    if (!this.meshTracker.has(key) && !this._rebuilding.has(key)) {
      // Not loaded and not rebuilding — queue initial build:
      this._queueMeshBuild(cx, cz, chunk.blocks);
      this._rebuilding.add(key);
    }
  }
}
```

**Key behavior:** `changed` flag is checked → mesh rebuild queued → flag cleared IMMEDIATELY. If more block changes happen before the worker finishes, `changed` flips true again on next frame → another rebuild queued with fresher data. The last build always wins.

#### 2.9 Mesh Builder Worker Integration

ChunkManager dispatches to mesh builder workers (separate file):

```javascript
_queueMeshBuild(cx, cz, blocksData) {
  // Post to mesh worker pool:
  this.meshWorkerPool.postMessage({
    type: 'build',
    cx, cz,
    blocks: blocksData.buffer,  // Transfer raw ArrayBuffer
    neighborFn: null            // Workers use getVoxel() callback or pre-fetched neighbor data
  }, [blocksData.buffer]);
}

// Worker returns geometry buffers → main thread creates THREE.Mesh:
onMeshResult({ cx, cz, solidGeo, cutoutGeo, transparentGeo }) {
  const key = `${cx},${cz}`;
  this._rebuilding.delete(key);

  // Dispose old meshes for this chunk if they exist
  this._disposeOldMeshes(key);

  // Create new THREE.Mesh objects from geometry buffers
  // Add to renderer.chunkGroup scene graph
}
```

The neighbor lookup for face culling at boundaries is handled by pre-fetching adjacent chunk data before dispatching:

```javascript
// Before sending to mesh worker, gather neighbor blocks:
const neighbors = {
  positiveX: this.memoryCache.get(`${cx+1},${cz}`)?.blocks ?? null,
  negativeX: this.memoryCache.get(`${cx-1},${cz}`)?.blocks ?? null,
  positiveZ: this.memoryCache.get(`${cx},${cz+1}`)?.blocks ?? null,
  negativeZ: this.memoryCache.get(`${cx},${cz-1}`)?.blocks ?? null,
};

this.meshWorkerPool.postMessage({ type: 'build', cx, cz, blocks: ..., neighbors }, [transferables]);
```

Since the 32×32 region check ensures all neighboring chunks are in memory before the player reaches them, neighbor data is always available. No rebuild storms needed.

#### 2.10 New World Generation (full 128×128)

```javascript
async generateFullWorld(size = 64) { // ±size → 128×128 total
  const queue = [];
  for (let cx = -size; cx < size; cx++) {
    for (let cz = -size; cz < size; cz++) {
      queue.push({ cx, cz });
    }
  }

  // Dispatch to workers in batches:
  const batchPromises = [];
  for (const item of queue) {
    batchPromises.push(this.requestGenerate(item.cx, item.cz));
    // Workers auto-queue — no need to throttle since pool manages concurrency
  }

  // Each result creates a Chunk → marks dirty → queues for flush:
  for await (const result of this._workerResultStream) {
    const chunk = new Chunk(result.cx, result.cz);
    chunk.blocks.set(new Uint8Array(result.chunkBytes));
    chunk.dirty = true; // Full write on first save
    this.memoryCache.set(`${result.cx},${result.cz}`, chunk);
    this._flushQueue.add(`${result.cx},${result.cz}`);
  }
}
```

---

### Phase 3: Migrate MeshBuilder to Worker Pool (Priority: HIGH)

**File:** `js/renderer/meshbuilder.js` → rewrite with worker pool pattern

#### 3.1 Create mesh builder worker script

Mirror the voxel generation worker pattern — fetch blob URL, spawn N workers:

```javascript
// meshBuilder.js (main thread):
class MeshBuilderManager {
  constructor(workerScriptPath) {
    this.workers = [];
    // Spawn pool from blob of meshWorker.js content
  }

  requestBuild(cx, cz, blocks, neighbors) {
    // Dispatch to idle worker → returns Promise<{solidGeo, cutoutGeo, transparentGeo}>
  }
}

// meshWorker.js (worker thread — inline as string or separate file):
self.onmessage = async (e) => {
  const { cx, cz, blocks: blockBuffer, neighbors } = e.data;
  const blocks = new Uint8Array(blockBuffer);

  // Run ChunkMeshBuilder logic here (ported from main-thread code):
  const meshData = buildMeshData(blocks, neighbors);
  const geometryBuffers = buildGeometryBuffers(meshData);

  self.postMessage({ cx, cz, solidGeo: ..., cutoutGeo: ..., transparentGeo: ... }, [transferables]);
};
```

#### 3.2 Port ChunkMeshBuilder to worker-compatible code

The mesh building logic (face culling, UV mapping, geometry assembly) is pure computation on block data — no DOM/THREE.js dependency in the worker. The worker returns raw buffer geometries that main thread wraps in `THREE.BufferGeometry`.

#### 3.3 Wire ChunkManager → MeshBuilderManager connection

ChunkManager calls `meshBuilder.requestBuild()` and handles the result by creating THREE.Mesh objects on the main thread. No bidirectional coupling — ChunkManager pushes work, MeshBuilder returns geometry.

---

### Phase 4: Update main.js Integration (Priority: HIGH)

**File:** `js/main.js`

Replace all old system initialization with new single-point integration:

```javascript
// OLD (multiple systems):
const chunkStore = new ChunkStore(worldName);
const dirtyFlush = new DirtyFlushManager(chunkStore, {...});
dirtyFlush.start();
const chunkManager = new ChunkManager(renderer, worldGen.generateChunk.bind(worldGen), {
  textureAtlas, renderDistance, chunkStore, dirtyFlush
});

// NEW (single system):
const chunkManager = new ChunkManager({
  renderer,
  worldName: currentWorld.id,
  worldSeed: currentWorld.seed,
  genParams: {...},
  workerScriptPath: 'js/world/workerGeneration.js',
  meshWorkerScriptPath: 'js/renderer/meshWorker.js',
  renderDistance: 8,
  regionRadius: 16,    // 32×32 pre-generation range
  textureAtlas,
});

await chunkManager.initWorkers();
chunkManager.startFlushTimer(5000);
chunkManager.startRegionCheck(500); // tick interval

// New world → generate full world:
if (isNewWorld) {
  await chunkManager.generateFullWorld(64); // ±64 = 128×128 chunks
} else {
  // Existing world → load manifest, let region check handle loading
  await chunkManager.loadExistingWorld();
}

// Every frame:
chunkManager.updateRenderChunks(playerX, playerZ);
```

Remove all references to old systems (ChunkStore, DirtyFlushManager, WorldGenerator, ChunkGrid).

---

### Phase 5: Delete Obsolete Files (Priority: MEDIUM)

After verifying main.js works with the new system:

| File | Action |
|------|--------|
| `js/world/chunkData.js` | Keep only BLOCK_TYPES, BLOCK_PROPERTIES, constants. Remove Chunk class. Rename to `js/world/blockTypes.js`? |
| `js/renderer/chunkManager.js` | **DELETE** — replaced by `js/chunkmanager.js` |
| `js/world/chunkStore.js` | **DELETE** — merged into chunkmanager.js |
| `js/world/dirtyFlushManager.js` | **DELETE** — merged into chunkmanager.js |
| `js/world/workerGeneration.js` | Keep as worker blob source OR inline into chunkmanager.js. **DELETE if inlined.** |
| `js/world/worldGenerator.js` | **DELETE** — merged into chunkmanager.js |
| `js/world/chunkGrid.js` | **DELETE** — not used, functionality absorbed |
| `js/world/featurePlacer.js` | **DELETE** — dead code |

---

### Phase 6: Update Tests (Priority: MEDIUM)

| Test file | Action |
|-----------|--------|
| `test/test_chunkData.js` | Rewrite for new Chunk class (no water levels, no neighbors) |
| `test/test_chunkStore.js` | Move tests inline or to chunkmanager test suite |
| `test/test_dirtyFlushManager.js` | Test as part of ChunkManager flush integration |
| `test/test_worldGenerator.js` | Update for simplified return value (blocks only) |
| `test/test_workerGeneration.js` | Verify worker returns only {cx, cz, chunkBytes} |
| New: `test/test_chunkmanager_integration.js` | End-to-end test: generate → flush → load → mesh build cycle |

---

## Execution Order & Estimated Effort

```
Phase 1: Cleanup dead code          ~300 lines removed    ~30 min
      ↓
Phase 2: Write new ChunkManager     ~900-1000 lines       ~60 min
      ↓
Phase 3: Migrate MeshBuilder to workers  ~400 lines        ~45 min
      ↓
Phase 4: Update main.js integration          ~80 lines changed   ~20 min
      ↓
Phase 5: Delete obsolete files                  (rm commands)       ~5 min
      ↓
Phase 6: Update tests                            ~300 lines         ~30 min
```

**Total:** 6 phases = ~3 hours / ~1700 net new or changed lines across the project.

## Files Modified by This Plan

| File | Phase | Change Type | Lines Affected |
|------|-------|-------------|----------------|
| `js/chunkmanager.js` | 2 | CREATE (new) | ~900-1000 |
| `js/world/chunkData.js` | 1,5 | MODIFY → slim down to constants only | -100 lines |
| `js/world/workerGeneration.js` | 1,2 | MODIFY → strip return values; then DELETE or inline | -200 lines |
| `js/renderer/meshbuilder.js` | 3 | REWRITE (worker pool) | ~400 lines |
| `js/main.js` | 4 | MODIFY (integration points) | ~80 changed |
| `js/world/chunkStore.js` | 5 | DELETE | -470 lines |
| `js/renderer/chunkManager.js` | 5 | DELETE | -781 lines |
| `js/world/dirtyFlushManager.js` | 5 | DELETE | -342 lines |
| `js/world/worldGenerator.js` | 5 | DELETE | ~-200 lines |
| `js/world/chunkGrid.js` | 5 | DELETE | -189 lines |
| `js/world/featurePlacer.js` | 1 | DELETE | entire file |
| `js/world/chunkBinaryCodec.js` | 1 | MODIFY (strip water levels) | -40 lines |

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Breaking existing game functionality during migration | HIGH | Implement Phase 2+3 first as parallel system, verify in browser before deleting old files. Keep git commits per phase for easy rollback. |
| Worker pool for mesh building adds latency on initial load | MEDIUM | Pre-generation (32×32 region) ensures chunks are in memory well before render distance. Mesh workers process queued builds every frame — no batching delay. |
| 32×32 memory cache uses ~67MB for blocks alone | LOW | Only active chunks stay loaded. Unload happens at `regionRadius + 2`. Modern browsers handle this easily. Mobile fallback: reduce regionRadius dynamically via PerformanceOptimizer. |
| Losing neighbor data during mesh worker transfer | MEDIUM | Pre-fetch all 4 neighbor block arrays before dispatching to mesh worker. Worker receives complete boundary context in single message. |
| Full 128×128 generation blocks UI on new world creation | HIGH | Dispatch workers asynchronously — don't await completion. Let the player see a loading screen while chunks generate and flush in background. Region check handles progressive loading for existing worlds. |

## Notes on Current Implementation vs Spec

- **Binary codec (v2)** is well-designed — RLE compression, FNV-1a checksums, compact header. Keep the encode/decode logic intact; only strip water level sections.
- **Worker pool pattern** from worldGenerator.js works correctly and handles worker lifecycle. Reuse this exact pattern for mesh workers.
- **IndexedDB schema** (`cuubz-worlds` v1) is stable — no migration needed since we're not changing the storage format, only removing water level data from what gets encoded. Existing chunks without water levels will decode fine (they'll just have a zero-filled array that's discarded).
- **PerformanceOptimizer integration** for dynamic render distance stays intact — ChunkManager still exposes `setRenderDistance()` and receives callbacks.
