# Cuubz — Full Generation Overhaul (VoxelGen Import)

> **Source of Truth:** `voxelgen.html` (attached side project with proven terrain/cave/biome generation).
> **Goal:** Rip and replace all generation systems — noise, biomes, terrain height, caves, ores, rivers, block placement, AND add multi-threaded Web Worker chunk generation.

---

## Completed ✅

### Phase 1: Core Infrastructure (Foundation) ✅

- [x] **1.1** Update Constants in `chunkData.js` — CHUNK_HEIGHT=256, SEA_LEVEL=64
- [x] **1.2** Rewrite `noise.js` — VoxelGen noise system (mulberry32, hashString, createPerlin, fbm2, applySpline, createSharedPerlin)
- [x] **1.3** Create `js/world/workerGeneration.js` — Full generation pipeline in Web Worker
- [x] **1.4** Create `js/world/workerPool.js` — Multi-threaded worker pool manager

### Phase 2: Biome System Rewrite ✅

- [x] **2.1** Rewrite `biomeSystem.js` — VoxelGen biomes (selectBiome + sampleBiomeParams with domain warping, Gaussian blending, spline continentalness)
- [x] **2.2** Update BIOME_NAMES in `worldManager.js` to match 10 new biomes

### Phase 3: Terrain Generation Rewrite ✅

- [x] **3.1** Rewrite `worldGenerator.js` — Thin wrapper dispatching to workers (full terrain pipeline lives in workerGeneration.js)
- [x] Mountain factor, plateau/peak/ridge components, river carving all implemented in worker

### Phase 4: Cave & Ore Integration ✅

- [x] **4.1** Remove `caveGenerator.js` from index.html — caves now integrated into worker generateChunk() (dual Perlin threshold)
- [x] **4.2** Remove `oreGenerator.js` from index.html — ores now via placeOres() in worker

### Phase 5: Multi-threaded Integration ✅

- [x] **5.1** Update `chunkManager.js` — _buildChunk() awaits async worker results
- [x] **5.2** Create Generation Config Object — genParams consolidated in WorldGenerator
- [x] **5.3** Update `main.js` — Worker init on startup, SEA_LEVEL=64 everywhere

### Phase 6: Cleanup & Compatibility ✅ (partial)

- [x] **6.1** Update Script Load Order in `index.html` — add workerGeneration/workerPool, remove caveGenerator/oreGenerator
- [x] **6.2** Delete dead code files from disk (`caveGenerator.js`, `oreGenerator.js`) — committed `81829fb`
- [x] **6.3** Update Chunk Binary Codec — already handles Uint16 height + larger chunks via RLE
- [x] **6.4** IndexedDB/Persistence — no changes needed (binary encoding/decoding is chunk-size agnostic)

### Phase 0: Block ID Alignment ✅ (NEW)

- [x] Remove VOXELGEN_TO_CUUBZ translation map entirely from workerGeneration.js and chunkData.js
- [x] Rename all textures to match VoxelGen block IDs directly (e.g., `1_0-grass→4_0-grass`, `3_0-stone→2_0-stone`)
- [x] Update BLOCK_TYPES: terrain blocks use VoxelGen IDs 0-19, Cuubz decorations at 32+
- [x] Add missing VoxelGen textures: snow_stone(14), red_sand(17), clay(19)
- [x] Rename `corrupt_stone→terracotta` to match VoxelGen naming
- [x] Update biome sub-blocks: BADLANDS uses TERRACOTTA, DESERT uses CLAY, FROZEN_PEAKS uses SNOW_STONE
- [x] Update textureAtlas.js _getBaseNames() fallback map + scan range (0→50)
- [x] Update manifest.json with all renamed textures

---

## Remaining ⚠️

### Phase 8: Initial World Loading System 🔴 PRIORITY

**Goal:** Generate full world area, persist it completely, THEN start rendering. Player sees stable terrain immediately.

#### 8.1 Bulk Voxel Generation (First-Time World Creation)
- [ ] Implement `generateInitialWorld(seed, size=128)` — dispatches ALL chunks in a 128×128 grid to worker pool
  - Workers generate voxels for entire area with no geometry building yet
  - Progress tracking: `chunksGenerated / totalChunks` → drives loading screen progress bar
- [ ] Each generated chunk immediately writes to IndexedDB with checksum verification
- [ ] After ALL chunks are persisted → manifest updated with complete chunk list
- [ ] Only THEN proceed to Phase 2 (mesh building)

#### 8.2 Bulk Mesh Building (Post-Voxel Persistence)
- [ ] Dispatch cached voxel buffers from IndexedDB to mesh worker queue for geometry creation
  - Progress tracking: `chunksMeshed / totalChunks` → second progress bar phase
- [ ] Build 8×8 grid around spawn point first (renderDistance=4), then expand outward
- [ ] Loading screen shows "Building chunk meshes..." during this phase

#### 8.3 World Reload from Cache
- [ ] On world load: check manifest for existing chunks → skip generation entirely if complete
- [ ] Progress bar phases:
  - Phase 1: "Loading world data..." (IndexedDB reads)
  - Phase 2: "Building meshes..." (runtime geometry creation)
- [ ] Player enters game only after initial 8×8 grid is fully rendered

### Phase 9: Loading Screen UI 🔴 PRIORITY

**Goal:** Dedicated loading screen with progress feedback during world initialization.

#### 9.1 Loading Screen Component
- [ ] Create `js/ui/loadingScreen.js` — full-screen overlay with:
  - Game logo/branding centered
  - Progress bar with percentage counter
  - Phase labels: "Generating terrain..." / "Building meshes..." / "Loading world data..."
  - Estimated time remaining (optional)
- [ ] Hide loading screen only when initial render area is fully built and player can spawn

#### 9.2 Integration Points
- [ ] Hook into `main.js` init sequence — show before texture atlas build, hide after chunk meshes ready
- [ ] Progress updates from worker pool dispatch counts + IndexedDB write completions
- [ ] Fallback timeout: if loading takes >30s, allow early entry with partial world (stream remaining chunks)

### Phase 10: Chunk Streaming & Load/Unload System 🟡 HIGH PRIORITY

**Current problem:** Too many chunks accumulate because queue backlog + single-threaded mesh building
causes the system to never catch up when player moves around. Chunks unload but rebuild creates more work.

#### 10.1 Fixed Render Distance (Stability First)
- [ ] Hard cap render distance at **8×8 grid** (renderDistance=4) until performance is stable
- [ ] Remove dynamic render distance adjustment during initial stabilization phase
- [ ] Log: `[ChunkManager] Active chunks: X / Max: 64` for monitoring

#### 10.2 Aggressive Unloading with Priority Queue
- [ ] Implement unload priority system:
  - **Immediate unload:** Chunks outside renderDistance+buffer radius
  - **Delayed unload:** Chunks in buffer zone (keep for smooth transitions)
  - **Never unload:** Spawn area chunks (always keep loaded)
- [ ] Unload happens BEFORE queueing new chunks — never allow queue to grow beyond capacity
- [ ] Max concurrent builds: `renderDistance² × 2` (current + incoming ring only)

#### 10.3 Queue Backlog Prevention
- [ ] `_processQueue()` caps batch size based on available frames:
  - If queue depth > threshold → reduce chunksPerTick to let renderer catch up
  - If queue empty and player stationary → increase chunksPerTick for faster streaming
- [ ] Frame budget tracking: if mesh building takes >16ms per chunk, auto-throttle next batch

### Phase 7: Testing & Validation

- [ ] **7.1** Visual comparison test — generate world with known seed, compare to VoxelGen output
- [ ] **7.2** Performance benchmark — single chunk <500ms, initial 128×128 gen <60s total
- [ ] **7.3** Edge case testing — chunk boundaries seamless, negative coords work, water at ocean edges, bedrock consistency

### Post-overhaul: Cuubz-specific features (future)

- [ ] Consider adding more variety to Badlands feature density (currently only cacti)
- [ ] Tree spawning — currently handled by WorldGenerator._spawnTree() in inline fallback; needs worker integration

---

## Future Optimizations 🟢 LOW PRIORITY (After Stability Achieved)

### Worker-based Mesh Building ⭐

**Principle:** Cache ONLY voxel data (not geometry). Geometry is cheap at runtime when multithreaded.
Storage priority: world manifest, quest progress, voxels, item storage, players, player inventory.

**Problem:** Chunk geometry creation runs on main thread during chunk streaming. Blocks render loop.

**Solution:** Move mesh building to Web Workers alongside voxel generation:
- Pipeline pattern: worker receives voxel buffer → builds mesh arrays (face culling, UVs, normals)
  → returns geometry data via transferable buffers
- Main thread only wraps BufferGeometry and attaches to scene (microseconds)
- NO pre-built geometry caching — voxels are the single source of truth

**Expected gain:** Dramatically smoother chunk streaming when walking/teleporting.
Runtime mesh building from cached voxels is fast enough with workers. Saves massive storage space.

### IndexedDB Persistence: Bulletproof Writeback Verification 🔒

**Current issue:** Chunk load checks both manifest AND IndexedDB, regenerates if they disagree.
This defeats the purpose of persistence — chunks should only regenerate on true corruption.

**Target lifecycle (per chunk):**
1. **First generation:** Generate → write to IndexedDB → VERIFY readback matches → add to manifest
   (If write or verify fails → retry up to 3x → mark as corrupt if still failing)
2. **Block changes:** Mark dirty → queue voxel delta → write update → VERIFY → dispatch mesh worker → remove from dirty
3. **Reload from cache:** Check manifest entry exists → load from IndexedDB → validate height range (not flat/corrupt) → build mesh
4. **Regeneration ONLY on true corruption:** Flat terrain, missing data after retries, or readback mismatch

**Required fixes:**
- Implement actual writeback verification in DirtyFlushManager (write → read back → compare MD5/checksum)
- Remove aggressive regeneration on manifest/IndexedDB disagreement — use retry logic instead
- Add chunk-level checksum to IndexedDB entry for instant corruption detection

---

## Completed Compatibility Fixes (this session)

- **`b287569`** — Phase 1 Core Infrastructure committed & synced to server
- **`5303e1a`** — Block ID alignment: removed VOXELGEN_TO_CUUBZ map, renamed textures, added new block types
- **`81829fb`** — Compatibility fixes: aligned hardcoded IDs in chunkMeshBuilder.js, interaction.js; deleted dead code files (caveGenerator.js, oreGenerator.js)
- **`c4b0644`** — Rebuilt inventory.js _INLINE_BLOCK_PROPERTIES with VoxelGen-aligned block IDs
- **`7c98213`** — Cleaned up featurePlacer.js: fixed biome key lookup (spaces→no spaces), removed dead lava/corrupt biomes & placement methods
- **`18b6893`** — Completed inventory.js alignment: getDisplayName() + maxStack() use VoxelGen IDs, all hardcoded numeric references eliminated
- **`1c7b170`** — Implemented inline fallback for WorldGenerator + refactored workerGeneration.js to return data instead of postMessage. Workers now wrap the return value; main thread calls it directly when workers fail. Added detailed init logging.
- **`f2ef2f0`** — Fixed worker onmessage guard (`postMessage && !document`) + error handling in dispatch (try/catch, 10s timeout, proper reject paths)
- **`74d0875`** — Prevented infinite chunk regeneration loop with `_pendingBuilds` Set tracking

---

## Implementation Order (Priority Queue)

### 🔴 Immediate Priority — Stability Foundation
1. ~~Phase 0~~ ✅ Block ID alignment + texture renaming complete
2. ~~Phase 1-6~~ ✅ Core generation overhaul complete  
3. **Phase 8:** Initial world loading system (bulk voxel gen → IndexedDB → mesh build)
4. **Phase 9:** Loading screen UI with progress feedback
5. **Phase 10:** Chunk streaming fixes + 8×8 render distance cap

### 🟡 Medium Priority — Persistence Hardening
6. Bulletproof IndexedDB writeback verification in DirtyFlushManager
7. Remove aggressive regeneration logic from `_buildChunk()`
8. Add chunk-level checksums for instant corruption detection

### 🟢 Future — Performance Optimization  
9. Worker-based mesh building pipeline (after streaming is stable)
10. Dynamic render distance adjustment based on performance metrics
11. Visual testing & validation against VoxelGen reference output
