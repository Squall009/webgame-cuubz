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

### Phase 6: Cleanup — Dead Code & Feature Placer

- [ ] **6.1** Delete `caveGenerator.js` and `oreGenerator.js` files from disk (removed from index.html but still exist as dead code)
- [ ] **6.2** Verify featurePlacer.js works with new block IDs (uses BLOCK_TYPES constants which are now updated — should be fine, verify visually)

### Phase 7: Testing & Validation

- [ ] **7.1** Visual comparison test — generate world with known seed, compare to VoxelGen output
- [ ] **7.2** Performance benchmark — single chunk <500ms, 32×32 grid <8s
- [ ] **7.3** Edge case testing — chunk boundaries seamless, negative coords work, water at ocean edges, bedrock consistency

### Post-overhaul: Cuubz-specific features (future)

- [ ] Add `badlands` biome to featurePlacer density map (currently has lava/corrupt but not badlands)
- [ ] Consider adding VoxelGen biomes (frozen_peaks) to featurePlacer density map
- [ ] Tree spawning — currently handled by WorldGenerator._spawnTree() in inline fallback; needs worker integration

---

## Implementation Order

1. ~~Phase 1~~ ✅ Foundation complete
2. ~~Phase 2~~ ✅ Biomes done
3. ~~Phase 3~~ ✅ Terrain pipeline in workers
4. ~~Phase 4~~ ✅ Caves + ores integrated
5. ~~Phase 5~~ ✅ Multi-threaded integration wired up
6. ~~Block ID Alignment~~ ✅ Translation removed, textures renamed
7. **Now:** Delete dead code files + verify feature placer
8. **Next:** Testing & visual validation
