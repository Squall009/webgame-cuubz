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

### Phase 7: Testing & Validation

- [ ] **7.1** Visual comparison test — generate world with known seed, compare to VoxelGen output
- [ ] **7.2** Performance benchmark — single chunk <500ms, 32×32 grid <8s
- [ ] **7.3** Edge case testing — chunk boundaries seamless, negative coords work, water at ocean edges, bedrock consistency

### Post-overhaul: Cuubz-specific features (future)

- [ ] Consider adding more variety to Badlands feature density (currently only cacti)
- [ ] Tree spawning — currently handled by WorldGenerator._spawnTree() in inline fallback; needs worker integration

---

## Completed Compatibility Fixes (this session)

- **`b287569`** — Phase 1 Core Infrastructure committed & synced to server
- **`5303e1a`** — Block ID alignment: removed VOXELGEN_TO_CUUBZ map, renamed textures, added new block types
- **`81829fb`** — Compatibility fixes: aligned hardcoded IDs in chunkMeshBuilder.js, interaction.js; deleted dead code files (caveGenerator.js, oreGenerator.js)
- **`c4b0644`** — Rebuilt inventory.js _INLINE_BLOCK_PROPERTIES with VoxelGen-aligned block IDs
- **`7c98213`** — Cleaned up featurePlacer.js: fixed biome key lookup (spaces→no spaces), removed dead lava/corrupt biomes & placement methods
- **`18b6893`** — Completed inventory.js alignment: getDisplayName() + maxStack() use VoxelGen IDs, all hardcoded numeric references eliminated
- **`1c7b170`** — Implemented inline fallback for WorldGenerator + refactored workerGeneration.js to return data instead of postMessage. Workers now wrap the return value; main thread calls it directly when workers fail. Added detailed init logging.

---

## Implementation Order

1. ~~Phase 0~~ ✅ Block ID alignment + texture renaming complete
2. ~~Phase 1~~ ✅ Foundation complete (noise, workers, constants)
3. ~~Phase 2~~ ✅ Biomes done (selectBiome + sampleBiomeParams)
4. ~~Phase 3~~ ✅ Terrain pipeline in workers (mountains, plateaus, rivers)
5. ~~Phase 4~~ ✅ Caves + ores integrated into worker
6. ~~Phase 5~~ ✅ Multi-threaded integration wired up (chunkManager → workers)
7. ~~Block ID Alignment~~ ✅ All hardcoded IDs replaced with BLOCK_TYPES constants
8. **Now:** FeaturePlacer biome compatibility fix
9. **Next:** Visual testing & validation

### What still needs attention:
- **featurePlacer.js** — uses old biome names ('lava', 'corrupt') that don't exist in VoxelGen biomes anymore
- **Tree spawning** — currently only works via inline fallback; needs proper worker integration
- **Visual testing** — generate world with known seed, compare to expected output
