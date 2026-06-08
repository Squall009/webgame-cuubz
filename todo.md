# Cuubz — Full Generation Overhaul (VoxelGen Import)

> **Status:** Draft — awaiting review before implementation.
> **Source of Truth:** `voxelgen.html` (attached side project with proven terrain/cave/biome generation).
> **Goal:** Rip and replace all generation systems — noise, biomes, terrain height, caves, ores, rivers, block placement, AND add multi-threaded Web Worker chunk generation.

---

## What VoxelGen Does Right (Summary)

### Noise Infrastructure
- **Mulberry32 PRNG** — fast seeded RNG for deterministic content
- **HashString** — FNV-style string→uint32 hash for seed input
- **Perlin noise factory** (`createPerlin`) — creates independent 2D/3D Perlin instances with their own permutation tables (no shared state)
- **9 independent Perlin instances** per world: `cont`, `eros`, `temp`, `hum`, `det`, `c1`, `c2`, `river`, `jitter` — each seeded differently via XOR offsets
- **FBM2** — multi-octave 2D fractal Brownian motion (normalized output)
- **Spline interpolation** — maps raw noise through control-point curves for continentalness shaping

### Climate & Biome System
- **Domain warping** — jitter noise displaces sample coordinates for organic biome boundaries (WARP=120px scale)
- **Gaussian-weighted blending** — 3×3 grid sampling around each column, exponential falloff (`exp(-dist² × 0.6)`) for seamless transitions
- **Per-sample jitter** — low-amplitude FBM added to temp/hum/cont at fine scale prevents hard edges and ice splotches
- **Two-tier continentalness** — continent-scale + detail-scale noise, each through spline independently, then blended (preserves full range vs pre-spline averaging)
- **10 biomes**: Deep Ocean, Ocean, Beach, Plains, Forest, Badlands, Tundra, Desert, Mountains, Frozen Peaks
  - Each has: `baseY`, `amplitude`, `surfaceBlock`, `subBlock`, color, name
- **Biome selection** — continent-first waterfall logic with temp/hum/erosion refinement

### Terrain Height Generation
- **Mountain factor** — smooth 0→1 based on continentalness + erosion (no binary biome check)
- **Mountain height components**: base elevation from continent, plateau FBM for flat tops, cubic peak boost, absolute-value ridge noise
- **Smooth lerp** between biome height and mountain height using effectiveFactor scaled by biome elevation ratio
- **Non-mountain terrain**: `baseY + detail × amplitude × peakBoost` — simple and effective

### River System
- Warped Perlin river paths with jitter for natural meandering
- Elevation-aware depth scaling (cosine factor)
- Gaussian smooth falloff at edges

### Block Placement (per column, top-down)
1. **Bedrock** at y=0, random scatter up to y=3 (probability decreases with height)
2. **Stone** below surface - 3
3. **Sub-block layer** (dir/sand/etc.) for 3 blocks before surface — mountains use stone sub-block
4. **Surface block** — biome-specific with altitude snow logic:
   - High altitude (>130): mixed snow/grass/stone based on noise
   - Cold mountain terrain: layered snow transition at different elevations
5. **Water fill** above surface up to SEA_LEVEL (ice in cold biomes)

### Cave Generation
- Dual 3D Perlin threshold: `abs(c1) < thresh && abs(c2) < thresh` — creates elongated tunnels
- Wall jitter from separate noise instance for organic cave walls
- Depth fade (no caves at surface), surface fade (caves don't break through)
- Lava pockets below y=12

### Ore Generation
- Random attempt-based: iterate ore definitions, random positions with vein spread
- Each ore has min/max Y range, chance, and vein size
- Only replaces STONE blocks

### Multi-threaded Workers
- **WorkerPool** class — dispatches chunk jobs to N Web Workers (hardwareConcurrency)
- Blob URL workers — no separate file needed, self-contained generation code
- Transferable ArrayBuffers for zero-copy data transfer back to main thread
- Full-blaze dispatch: all chunks sent at once, workers pull from idle queue

---

## Current Cuubz Generation (What Gets Replaced)

| System | Current File | VoxelGen Replacement |
|--------|-------------|---------------------|
| Noise | `noise.js` — single Perlin instance with LCG shuffle | Multiple independent Perlin instances via factory + mulberry32 |
| Biomes | `biomeSystem.js` — 8 biomes, simple getBiome() | 10 biomes, domain-warped climate sampling, Gaussian blending, spline continentalness |
| Terrain | `worldGenerator.js` — density-based with gravity formula | Height-based: biome blend + mountain factor + river carving |
| Caves | `caveGenerator.js` — stalactites/stalagmites/torches | Dual Perlin threshold caves integrated in generateChunk() |
| Ores | `oreGenerator.js` — cluster-based vein placement | Random attempt-based ore veins with per-ore definitions |
| Features | `featurePlacer.js` — hash-based decoration placement | (Keep for now, adapt to new surface heights) |

---

## Key Differences to Address

| Aspect | Cuubz Current | VoxelGen | Decision |
|--------|--------------|----------|----------|
| CHUNK_HEIGHT | 96 | 256 | **Change to 256** — matches VoxelGen, gives room for tall mountains |
| SEA_LEVEL | 32 | 64 | **Change to 64** — biome baseY values calibrated for this |
| BLOCK_TYPES | 30 types (includes game-specific: BLACKSTONE, CORRUPT_STONE, TOXIC_SLIME, etc.) | 20 types | **Merge**: use VoxelGen block IDs + add Cuubz-specific blocks after ID 19 |
| Y=0 bedrock | Solid layer | Random scatter y≤3 | Adopt VoxelGen approach (more natural) |
| Ore system | Cluster noise-based | Random attempt veins | Replace with VoxelGen system |
| Cave system | Worm technique + formations | Dual Perlin threshold + jitter | Replace entirely — VoxelGen caves are superior |
| Mountain gen | Biome-specific gravity reduction | Mountain factor (smooth 0→1) | Replace — much more natural terrain |

---

## Implementation Plan

### Phase 1: Core Infrastructure (Foundation)

#### 1.1 Update Constants in `chunkData.js`
- Change `CHUNK_HEIGHT = 96` → `CHUNK_HEIGHT = 256`
- Change `SEA_LEVEL = 32` → `SEA_LEVEL = 64`
- Update `MIN_Y`, `MAX_Y` accordingly
- Merge BLOCK_TYPES: add VoxelGen blocks (SNOW_STONE=14, TERRACOTTA=16, RED_SAND=17, ICE=18, CLAY=19) — these already partially exist. Reconcile IDs. Add CAVE_AIR block type. Keep all Cuubz-specific types (BLACKSTONE, CORRUPT_STONE, etc.) at higher IDs.
- Update BLOCK_PROPERTIES for new blocks

#### 1.2 Rewrite `noise.js` — VoxelGen Noise System
Replace the entire NoiseGenerator class with:
- **`mulberry32(seed)`** — PRNG function (lines 506-514)
- **`hashString(str)`** — FNV hash for string seeds (lines 516-520)
- **`createPerlin(seed)`** — factory returning `{noise2, noise3}` with independent perm table (lines 522-551)
- **`fbm2(perlin, x, y, octaves, persistence, lacunarity)`** — multi-octave FBM (lines 553-557)
- **`applySpline(val, points)`** — spline interpolation (lines 559-568)
- **`createSharedPerlin(seed)`** — creates all 9 named instances at once (lines 703-712)
- Keep `hash()` and `createPRNG()` equivalents from current code for feature placement

Export as functions, not class. Each generation pass creates its own perlin set.

#### 1.3 Create `js/world/workerGeneration.js` — Web Worker Code
Extract the worker source blob (lines 500-928 of voxelgen) into a separate JS file:
- Contains ALL generation logic that runs in workers
- Uses Blob URL pattern: main thread creates worker from this file's content
- Exports `generateChunk(chunkX, chunkZ, seed, params)` function
- Receives work via postMessage, returns result with transferable buffers

#### 1.4 Create `js/world/workerPool.js` — Worker Pool Manager
Port the WorkerPool class (lines 934-974):
- Constructor takes worker count + blob URL
- `dispatch(chunkX, chunkZ, seed, params)` → Promise
- `terminate()` cleanup
- Uses navigator.hardwareConcurrency for optimal count

---

### Phase 2: Biome System Rewrite

#### 2.1 Rewrite `biomeSystem.js` — VoxelGen Biomes
Replace entire class with:
- **BLOCK constant** matching VoxelGen (lines 570-573)
- **BIOME definitions** (lines 576-586): all 10 biomes with baseY, amplitude, surfaceBlock, subBlock, color, name
- **CONT_SPLINE** control points (line 589)
- **`selectBiome(cont, eros, temp, hum)`** — biome selection waterfall (lines 591-617)
- **`sampleBiomeParams(perlinSet, wx, wz, params)`** — Gaussian-blended climate sampling with domain warping (lines 619-672)

Remove: old getBiome(), blendBiomeHeights(), smoothstep()

#### 2.2 Update Biome Names in `worldManager.js`
Update BIOME_NAMES array to match new biome set (Deep Ocean, Ocean, Beach, Plains, Forest, Badlands, Tundra, Desert, Mountains, Frozen Peaks)

---

### Phase 3: Terrain Generation Rewrite

#### 3.1 Rewrite `worldGenerator.js` — VoxelGen Terrain Pipeline
Replace generateChunk() with the VoxelGen pipeline (lines 714-920):

**For each column (x, z):**
1. Call `sampleBiomeParams()` → blended baseY, amplitude, dominant biome
2. Calculate mountain factor from continentalness + erosion blend (lines 731-760)
3. If mountainFactor > 0.01: compute mountain height with plateau/peak/ridge components (lines 766-801)
4. Else: simple `baseY + detail × amplitude × peakBoost`
5. Apply river carving (lines 803-821)
6. Store surfaceMap[lx*16+lz]

**For each column, fill blocks top-down:**
7. Bedrock at y=0, scatter up to y=3
8. Stone below surface-3
9. Sub-block layer for 3 blocks before surface (biome-specific)
10. Surface block with snow/altitude logic (lines 838-867)
11. Water fill above surface to SEA_LEVEL with ice in cold biomes

**Cave pass (separate loop):**
12. Dual Perlin threshold caves with wall jitter, depth/surface fade (lines 880-907)

**Ore pass:**
13. Random attempt ore placement (call placeOres from worker code)

Remove: ALL old density-based methods (_densityForBiome, _calculateDensityBlended, _sampleClimate, _fillWater, _applyCarvers, etc.)

---

### Phase 4: Cave & Ore Integration

#### 4.1 Remove `caveGenerator.js`
Entire file deleted — cave generation is now integrated into generateChunk() in the worker code (dual Perlin threshold approach).

The old stalactites/stalagmites/torches can be added back later as a post-process pass if desired.

#### 4.2 Remove `oreGenerator.js`
Entire file deleted — ore generation is now integrated into generateChunk() via placeOres() function (lines 674-695).

VoxelGen ore definitions: COAL (y=5-120), IRON (y=5-85), GOLD (y=5-42), DIAMOND (y=5-24) with vein sizes.

---

### Phase 5: Multi-threaded Integration

#### 5.1 Update `chunkManager.js` — Worker-Based Generation
Modify `_buildChunk()` to:
1. Check if chunk exists in store → return cached
2. If not, dispatch to worker pool via `workerPool.dispatch(cx, cz, seed, params)`
3. On result: reconstruct Chunk from Uint8Array buffer + biomeMap
4. Save to IndexedDB via dirtyFlushManager

#### 5.2 Create Generation Config Object
Consolidate all generation parameters into a single config object (matching VoxelGen's `params`):
```javascript
const genParams = {
  continentScale: 4000, contScale: 400, tempScale: 2000, humScale: 2000, erosScale: 280,
  detailScale: 40, octaves: 5, persistence: 0.5, lacunarity: 2.0,
  caveThresh: 0.10, caveScale: 50,
  riverScale: 1000, riverDensity: 30, riverDepth: 20,
};
```

#### 5.3 Update `game.js` / `main.js` — Worker Initialization
On game start, create worker pool with hardwareConcurrency workers.
Pass genParams to all dispatched chunks.

---

### Phase 6: Cleanup & Compatibility

#### 6.1 Update Script Load Order in `index.html`
New order:
```
noise.js          (rewritten VoxelGen noise)
chunkData.js      (updated constants + merged BLOCK_TYPES)
biomeSystem.js    (rewritten VoxelGen biomes)
workerGeneration.js (NEW - worker-side generation code)
workerPool.js     (NEW - worker pool manager)
worldGenerator.js (rewritten - thin wrapper that dispatches to workers)
featurePlacer.js  (kept, adapted for new heights)
chunkGrid.js      (unchanged)
... rest unchanged ...
```

Remove: `caveGenerator.js`, `oreGenerator.js` from load order

#### 6.2 Update Feature Placer for New Heights
Adjust surface-finding logic in featurePlacer.js to work with CHUNK_HEIGHT=256 and SEA_LEVEL=64. The feature densities may need recalibration since biomes have changed (Badlands, Frozen Peaks are new; Lava, Corrupt removed from VoxelGen set).

Decision: Keep Cuubz-specific biomes (Lava, Corrupt) as custom additions to the biome system alongside VoxelGen's 10. This preserves game content while using proven terrain algorithms.

#### 6.3 Update Chunk Binary Codec
`chunkBinaryCodec.js` may need update for new CHUNK_HEIGHT=256 and additional block types. Verify encoding/decoding handles the larger chunk volume (16×256×16 = 65,536 blocks vs previous 24,576).

#### 6.4 Update IndexedDB Schema / Persistence
Chunks are now much larger (256 height). Verify:
- `persistence.js` handles larger chunk data
- `chunkStore.js` encoding/decoding works with new dimensions
- `dirtyFlushManager.js` flush timing is appropriate for async worker results

#### 6.5 Update Renderer for New World Bounds
- `voxelRenderer.js`: camera frustum, render distance calculations
- `chunkMeshBuilder.js`: mesh generation handles taller chunks
- `performanceOptimizer.js`: chunk culling with new height range

---

### Phase 7: Testing & Validation

#### 7.1 Visual Comparison Test
Generate a world with known seed ("minecraft" or numeric), compare terrain features to VoxelGen output:
- Same biome distribution at given coordinates
- Same cave networks
- Same ore placements
- Mountains rise correctly, oceans have proper depth

#### 7.2 Performance Benchmark
Measure chunk generation time:
- Single chunk in worker (target: <500ms)
- Full 32×32 grid with all workers (target: <8s as VoxelGen achieves)
- Compare to current synchronous generation time

#### 7.3 Edge Case Testing
- Chunk boundary seamlessness (biomes blend across chunks, caves connect)
- Negative chunk coordinates work correctly
- Water fill at ocean boundaries
- Bedrock layer consistency
- Ore placement doesn't break surface blocks

---

## Files Modified/Deleted/Created Summary

### Created (New Files)
| File | Purpose |
|------|---------|
| `js/world/workerGeneration.js` | Worker-side generation code (from VoxelGen blob) |
| `js/world/workerPool.js` | Multi-threaded worker pool manager |

### Rewritten (Same Path, New Content)
| File | What Changes |
|------|-------------|
| `js/world/noise.js` | Class → function exports: mulberry32, hashString, createPerlin, fbm2, applySpline, createSharedPerlin |
| `js/world/biomeSystem.js` | 8 biomes + getBiome() → 10 biomes + selectBiome() + sampleBiomeParams() with domain warping |
| `js/world/worldGenerator.js` | Density-based pipeline → height-based pipeline dispatching to workers |
| `js/world/chunkData.js` | CHUNK_HEIGHT→256, SEA_LEVEL→64, merged BLOCK_TYPES |

### Deleted (Removed Files)
| File | Reason |
|------|--------|
| `js/world/caveGenerator.js` | Cave gen now integrated into worker generateChunk() |
| `js/world/oreGenerator.js` | Ore gen now integrated into worker generateChunk() |

### Modified (Minor Changes)
| File | What Changes |
|------|-------------|
| `index.html` | Script load order: add 2 new, remove 2 old |
| `js/entities/worldManager.js` | BIOME_NAMES array updated |
| `js/world/featurePlacer.js` | Height range adaptation for CHUNK_HEIGHT=256 |
| `js/renderer/chunkManager.js` | _buildChunk() uses worker pool dispatch |
| `js/world/chunkBinaryCodec.js` | Handle larger chunk volume |

---

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| CHUNK_HEIGHT change breaks existing saved worlds | Add migration: detect old 96-height chunks, regenerate on load |
| Worker Blob URL blocked by CSP | Add worker-src to Content-Security-Policy or use separate file fallback |
| Biome IDs change breaks biome-dependent game logic (quests, crafting) | Map old biome names to new ones in featurePlacer and questSystem |
| Performance regression from 256-height chunks in mesh building | LOD/culling already handles this; mesh builder only generates visible faces |
| IndexedDB quota exceeded with larger chunks | RLE compression in chunkBinaryCodec should handle it (already implemented) |

---

## Implementation Order

1. **Phase 1** (constants + noise + worker infra) — Foundation, no visual change yet
2. **Phase 2** (biomes) — Biome definitions and selection logic
3. **Phase 3** (terrain generation in workers) — Core terrain pipeline
4. **Phase 4** (caves + ores integrated) — Underground features complete
5. **Phase 5** (multi-threaded integration) — Wire up worker pool to chunkManager
6. **Phase 6** (cleanup) — Remove old files, update load order, fix compat issues
7. **Phase 7** (testing) — Visual comparison + performance benchmark

**Estimated effort:** Phases 1-3 are the heavy lifting (~40% each). Phases 4-7 are wiring and cleanup.
