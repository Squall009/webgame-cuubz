# CUUBZ — World Generator Fix Sheet

**Files:** `worldGenerator.js` · `noise.js` · `biomeSystem.js` · `chunkMeshBuilder.js`

This document consolidates every diagnosed issue across the Cuubz terrain generation and chunk mesh pipeline. Issues are grouped by subsystem and ordered by impact. Each entry includes the root cause, affected code, and a concrete fix strategy. This sheet is intended to be fed directly to a code generation model as a complete repair specification.

---

## Master Issue Index

All 14 diagnosed issues ranked by severity across all source files.

| Priority | File | Issue | Effect |
|---|---|---|---|
| 🔴 CRITICAL | worldGenerator.js | String seed not hashed to integer | Every world is identical regardless of seed phrase |
| 🔴 CRITICAL | worldGenerator.js | No biome blending in density field | Hard cliff discontinuities at all biome borders |
| 🔴 CRITICAL | worldGenerator.js | River subtracts 28 from density | Rivers carve trenches from surface to bedrock |
| 🔴 CRITICAL | worldGenerator.js | No global sea level — water fill is per-column | Ocean/lake surfaces are stairstepped, not flat |
| 🔴 CRITICAL | worldGenerator.js | Ocean biome not forced below sea level in density | Ocean columns can sit above or below water arbitrarily |
| 🟠 HIGH | worldGenerator.js | Aquifer `y <= 32` clamp negates noise variation | Aquifer variation does nothing; always floods to y=32 |
| 🟠 HIGH | worldGenerator.js | No biome target height / scale pair | Ocean and mountain can share the same base elevation |
| 🟠 HIGH | worldGenerator.js | Surface pass does not check block above | Ores near surface get replaced with grass/sand |
| 🟠 HIGH | worldGenerator.js | Shoreline geometry not leveled to sea level | Cliffs appear at every land/water boundary |
| 🟠 HIGH | worldGenerator.js | Tree decoration writes out of chunk bounds | Leaf canopy silently corrupts adjacent chunk borders |
| 🟠 HIGH | worldGenerator.js | Single hash value drives both flower and tree | Flowers and trees overlap on the same block |
| 🟡 MEDIUM | worldGenerator.js | Cave threshold too aggressive (0.35) | Splotchy disconnected caves, poor ratio to solid rock |
| 🟡 MEDIUM | chunkMeshBuilder.js | Transparent vertex index not reset per chunk | Fluid blocks invisible in all chunks after the first |
| 🟡 MEDIUM | chunkMeshBuilder.js | `_buildSourceFluidFace` uses `posArr.length` for index | Fluid face indices corrupt when fluid code re-enabled |

---

## 01 — Seed Phrase Has No Effect

**File:** `worldGenerator.js` → `NoiseGenerator` constructor

### Root Cause

The `NoiseGenerator` receives a raw seed value, but two bugs kill its entropy:

- `seed || 1` in `_buildPermutation` coerces `0` and falsy values to `1` — seed 0 is indistinguishable from seed 1.
- String seed phrases passed as-is become `NaN` in JavaScript arithmetic. `NaN || 1` always produces `1`. Every string seed generates the identical world.
- The `hash()` function uses bitwise OR (`| 0`) which truncates floats and collapses nearby integer seeds.

### Fix Strategy

Add a static FNV-1a string hasher to `WorldGenerator`. Call it before constructing `NoiseGenerator`:

```js
static hashSeed(str) {
  // Coerce to string so numeric seeds also work
  const s = String(str);
  let h = 2166136261 >>> 0;  // FNV offset basis (32-bit unsigned)
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;  // FNV prime, keep unsigned
  }
  return h;  // Stable 32-bit integer, unique per string
}
```

Then in the `WorldGenerator` constructor:

```js
this.seed = typeof seed === 'string' ? WorldGenerator.hashSeed(seed) : (seed >>> 0);
this.noise = new NoiseGenerator(this.seed);
```

> **Also fix:** In `NoiseGenerator._buildPermutation`, replace `(seed || 1)` with `(seed === 0 ? 1 : seed)` so that seed `0` still works but is distinct from seed `1`.

---

## 02 — Hard Cliff Edges at Biome Borders

**File:** `worldGenerator.js` → `_calculateDensity`

### Root Cause

Each column independently snaps to one biome and applies that biome's full density modifiers (`gravity *= 0.4` for mountains, `gravity *= 1.8` for plains). A column on the mountain side of a border and its immediate neighbor on the plains side have gravity multipliers 4.5x apart. The density field is discontinuous at every biome boundary, producing sheer cliff walls.

### Fix Strategy — Biome Influence Blending

Sample a 3x3 neighbourhood of biome influence points around each column. Weight each neighbour's density contribution by inverse distance, then sum. This smooths the transition zone to ~8–16 blocks:

```js
_calculateDensityBlended(wx, y, wz) {
  const RADIUS = 8;  // Blend over 8 block radius
  let totalWeight = 0, blendedDensity = 0;
  for (let ox = -1; ox <= 1; ox++) {
    for (let oz = -1; oz <= 1; oz++) {
      const sampleX = wx + ox * RADIUS;
      const sampleZ = wz + oz * RADIUS;
      const climate = this._sampleClimateAt(sampleX, sampleZ);
      const biome   = this.biomes.getBiome(...climate);
      const d = Math.sqrt(ox*ox + oz*oz) + 0.001;
      const w = 1.0 / d;
      blendedDensity += this._densityForBiome(wx, y, wz, climate, biome) * w;
      totalWeight += w;
    }
  }
  return blendedDensity / totalWeight;
}
```

> **Important:** Split `_calculateDensity` into `_densityForBiome` (takes explicit biome + climate params) and the blending wrapper above. The inner function must not re-sample climate — it uses the passed-in values.

---

## 03 — No Biome Target Height — Ocean and Mountains Share Elevation

**File:** `worldGenerator.js` → `_calculateDensity` + `BiomeSystem`

### Root Cause

The gravity term is centered on `y=32` for all biomes. Biome modifiers change the slope of the gravity curve but not its anchor point. Mountains and ocean floors can appear at the same raw Y level because neither has a target surface elevation — only a different gravitational pull rate.

### Fix Strategy

Add `baseHeight` and `heightScale` to every biome definition in `BiomeSystem`:

```js
OCEAN:     { ..., baseHeight: 18, heightScale: 0.3 },  // Ocean floor ~y18
PLAINS:    { ..., baseHeight: 36, heightScale: 0.5 },  // Flat ~y36
FOREST:    { ..., baseHeight: 38, heightScale: 0.7 },
DESERT:    { ..., baseHeight: 34, heightScale: 0.4 },
TUNDRA:    { ..., baseHeight: 36, heightScale: 0.6 },
MOUNTAINS: { ..., baseHeight: 55, heightScale: 2.0 },  // Peaks ~y55-80
LAVA:      { ..., baseHeight: 30, heightScale: 0.8 },
CORRUPT:   { ..., baseHeight: 32, heightScale: 0.9 },
```

Then replace the fixed gravity anchor in `_calculateDensity`:

```js
// OLD — fixed anchor
let heightDiff = y - 32;

// NEW — biome-relative anchor
let heightDiff = y - biome.baseHeight;
let gravity = heightDiff > 0
  ? Math.pow(heightDiff, 1.4) * (1.0 / biome.heightScale)
  : heightDiff * 1.0;
```

---

## 04 — Flat Water Surfaces — Stairstep Fix

**File:** `worldGenerator.js` → `generateChunk` + `_applySurfacePass`

### Root Cause

Water is placed per-column inside the density loop (`y <= aquiferLevel && y <= 32`). Each column's `aquiferLevel` varies with noise, so neighbouring columns have different water ceilings. The surface of any body of water is a noisy stairstepped contour, not a flat plane.

### Fix Strategy — Three-Step Water Resolution

#### Step 1: Establish SEA_LEVEL constant

```js
const SEA_LEVEL = 32;  // Single source of truth — used everywhere
```

#### Step 2: Force ocean columns below sea level in density function

In `_calculateDensity` (or `_densityForBiome` after the refactor), when the biome is ocean, clamp the density field so all blocks above `SEA_LEVEL - 1` are always negative (air or water):

```js
if (biome.id === 'ocean') {
  // Force air/water above sea level in ocean columns
  if (y >= SEA_LEVEL) return -99;
  // Gently pull ocean floor down to baseHeight
  density -= (SEA_LEVEL - y) * 0.5;
}
```

#### Step 3: Replace per-column water fill with a flood-fill post-pass

After the main density loop completes, remove all per-column water placement from inside the loop. Instead, run a second pass over the entire chunk:

```js
_fillWater(chunk, SEA_LEVEL) {
  for (let x = 0; x < 16; x++) {
    for (let z = 0; z < 16; z++) {
      for (let y = SEA_LEVEL; y >= 1; y--) {
        const b = chunk.getBlock(x, y, z);
        if (b === BLOCK_TYPES.AIR) {
          // Only fill if open to sky (no solid cap above)
          chunk.setBlock(x, y, z, BLOCK_TYPES.WATER);
        } else {
          break;  // Hit solid ground — stop filling downward
        }
      }
    }
  }
}
```

Call `_fillWater(chunk, SEA_LEVEL)` after Phase 10 (carvers) but before the surface pass. This guarantees every air column at or below sea level gets filled to exactly `SEA_LEVEL` with a perfectly flat top surface, regardless of what the density field did.

#### Step 4: Level the shoreline in _applySurfacePass

After placing surface blocks, detect columns where the solid surface is within ±2 of `SEA_LEVEL` and nudge them to sit flush with the waterline:

```js
// After placing biome surface blocks:
if (Math.abs(y - SEA_LEVEL) <= 2) {
  // Force the land to meet water gracefully
  chunk.setBlock(lx, SEA_LEVEL - 1, lz, biome.surface[1]);  // Submerged edge
  // The flood-fill pass will already have placed water at SEA_LEVEL
}
```

---

## 05 — Rivers Carve Trenches to Bedrock

**File:** `worldGenerator.js` → `_calculateDensity`

### Root Cause

The river carving inside `_calculateDensity` subtracts up to `28` from the density scalar. Since the entire density range is roughly ±50, this carves through the full terrain column — stone, caves, aquifers and all — producing a sheer trench from the surface to bedrock rather than a shallow surface channel.

### Fix Strategy — River as Post-Process 2D Pass

Remove the river density subtraction from `_calculateDensity` entirely. Replace it with a dedicated `_applyRivers` pass that runs after terrain generation but before the flood-fill:

```js
_applyRivers(chunk, climateCache) {
  const SEA_LEVEL = 32;
  for (let x = 0; x < 16; x++) {
    for (let z = 0; z < 16; z++) {
      const wx = chunk.worldX + x, wz = chunk.worldZ + z;
      const river = Math.abs(
        this.noise.perlin2(wx * this.freq.river, wz * this.freq.river)
      );
      if (river > 0.06) continue;  // Not a river column

      const strength = 1.0 - (river / 0.06);  // 1.0 at centre, 0 at edge
      const carveDepth = Math.round(strength * 3);  // Max 3 blocks deep

      // Find actual surface Y for this column
      let surfaceY = 0;
      for (let y = 94; y > 0; y--) {
        if (chunk.getBlock(x, y, z) !== BLOCK_TYPES.AIR) { surfaceY = y; break; }
      }

      // Carve from surface down by carveDepth
      for (let d = 0; d <= carveDepth; d++) {
        const ty = surfaceY - d;
        if (ty > 0) chunk.setBlock(x, ty, z, BLOCK_TYPES.AIR);
      }
      // Water fills up to SEA_LEVEL automatically via flood-fill pass
    }
  }
}
```

> **Call order:** `density loop → carvers → _applyRivers → _fillWater → _applySurfacePass → decorations`

---

## 06 — Aquifer Clamp Negates Noise Variation

**File:** `worldGenerator.js` → `generateChunk`

### Root Cause

```js
if (y <= aquiferLevel && y <= 32) chunk.setBlock(x, y, z, biome.fluid);
```

The condition `y <= 32` is always the binding constraint because `aquiferLevel` can never exceed `47` (32 + 15). The noise-driven `aquiferLevel` variable is therefore dead code — every aquifer fills to exactly `y = 32` regardless of noise.

### Fix

With the flood-fill water pass in place (Fix 04), aquifer logic can be simplified or removed entirely. If underground pockets of fluid are still desired as a distinct feature, remove the `y <= 32` clamp and let `aquiferLevel` drive the ceiling independently:

```js
// Aquifer: only in cave voids, below a noise-driven ceiling, not in ocean
if (biome.id !== 'ocean' && y <= aquiferLevel && y <= 28) {
  chunk.setBlock(x, y, z, biome.fluid);
}
```

---

## 07 — Surface Pass Grass-Over-Ores + Flower/Tree Overlap

**File:** `worldGenerator.js` → `_applySurfacePass` + `_placeDecor`

### Root Cause A — Grass Over Ores

`_applySurfacePass` checks `if (block === BLOCK_TYPES.STONE || (block >= 18 && block <= 21))` to find the surface, but does not verify that the block above is air. A stone block with another solid block above it still triggers the surface replacement. Ore veins near the surface get replaced with grass.

### Fix A

```js
// Replace the surface-detection condition with:
const above = chunk.getBlock(lx, y + 1, lz);
const isExposed = above === BLOCK_TYPES.AIR || this.nonFluidSolidIds.has(above) === false;
if (!found && isExposed && (block === BLOCK_TYPES.STONE || isOre(block))) {
  // Apply surface blocks...
```

### Root Cause B — Flowers and Trees on Same Block

`_placeDecor` tests flower placement at `r < 0.02` and tree placement at `r < 0.03` using the same hash value `r`. Any column where `r < 0.02` satisfies both conditions simultaneously, placing a flower then overwriting it with a tree trunk — or vice versa.

### Fix B

Use separate hash values for each decoration type, and add a check that the target block is air before placing anything:

```js
_placeDecor(chunk, x, y, z, biome) {
  if (y >= 94) return;
  if (chunk.getBlock(x, y, z) !== BLOCK_TYPES.AIR) return;  // Space check

  const rTree   = this.noise.hash(chunk.worldX + x + 1000, chunk.worldZ + z);
  const rFlower = this.noise.hash(chunk.worldX + x + 2000, chunk.worldZ + z);

  if (biome.id === 'forest' && rTree < 0.03)  { this._spawnTree(chunk, x, y, z); return; }
  if (biome.id === 'plains' && rTree < 0.008) { this._spawnTree(chunk, x, y, z); return; }
  if (biome.id === 'desert' && rTree < 0.03)  { this._spawnCactus(chunk, x, y, z); return; }
  if (biome.id === 'plains' && rFlower < 0.04) {
    chunk.setBlock(x, y, z, BLOCK_TYPES.RED_FLOWER);
  }
}
```

---

## 08 — Tree Canopy Writes Out of Chunk Bounds

**File:** `worldGenerator.js` → `_spawnTree`

### Root Cause

`_spawnTree` places leaves at `x+ox, z+oz` where `ox` and `oz` range ±2. When a tree spawns near a chunk edge (`x=0`, `x=15`, `z=0`, `z=15`) the leaf coordinates fall outside 0–15. `chunk.setBlock` either silently discards these writes or corrupts adjacent chunk memory depending on implementation.

### Fix

Clamp all decoration writes to chunk-local bounds. For cross-chunk features (large trees), use a deferred decoration list that the chunk manager resolves after both chunks are loaded:

```js
_spawnTree(chunk, x, y, z) {
  // Trunk — always within bounds if x,z are valid
  for (let i = 0; i < 5; i++) chunk.setBlock(x, y+i, z, BLOCK_TYPES.WOOD_LOG);
  // Canopy — clamp to chunk bounds
  for (let ox = -2; ox <= 2; ox++) {
    for (let oz = -2; oz <= 2; oz++) {
      if (Math.abs(ox) + Math.abs(oz) >= 4) continue;
      const lx = x + ox, lz = z + oz;
      if (lx < 0 || lx > 15 || lz < 0 || lz > 15) continue;  // Skip OOB
      chunk.setBlock(lx, y+4, lz, BLOCK_TYPES.LEAVES);
    }
  }
}
```

---

## 09 — Cave System — Splotchy and Disconnected

**File:** `worldGenerator.js` → `_sampleCaves`

### Root Cause

The cave algorithm subtracts two noise values and thresholds at `0.35`. This is a high bar that creates isolated pockets rather than connected tunnel networks. Caves also have no depth gating — they generate from `y=0` to `y=95` at equal probability, and can punch through ocean floors and aquifers.

### Fix Strategy

Use the "cave worm" technique: sample two independent 3D noise fields and threshold both near zero. This creates elongated tunnel-like voids that are much more connected:

```js
_sampleCaves(wx, y, wz, biome) {
  // No caves in top 10 blocks (preserves surface)
  // No caves below y=2 (preserve bedrock layer)
  if (y > 85 || y < 2) return false;

  // Primary tunnel noise — low frequency for large caves
  const n1 = this.noise.perlin3(
    wx * this.freq.caveL, y * this.freq.caveL, wz * this.freq.caveL
  );
  // Secondary noise — higher frequency for cave detail
  const n2 = this.noise.perlin3(
    wx * this.freq.caveH + 100, y * this.freq.caveH, wz * this.freq.caveH + 100
  );

  // Tunnel when both noise values are near zero simultaneously
  const caveDensity = n1 * n1 + n2 * n2;
  const threshold = 0.04;  // Smaller = narrower tunnels

  // No caves in ocean columns near sea level
  if (y <= 35 && biome.id === 'ocean') return false;

  return caveDensity < threshold;
}
```

---

## 10 — ChunkMeshBuilder — Transparent Blocks Invisible After First Chunk

**File:** `chunkMeshBuilder.js` → `buildMeshData`

### Root Cause

The vertex index counters (`vertexIndex`, `transparentVertexIndex`, `cutoutVertexIndex`) are declared with `let` inside `buildMeshData` — which appears correct. However, because the geometry arrays (`transparentPositions` etc.) are fresh local arrays starting at index 0 for each chunk, any path that increments these counters outside the local scope causes indices to mismatch. Verify that no `this.transparentVertexIndex` assignment exists anywhere in the class.

Additionally, in `_buildSourceFluidFace` the index is computed as:

```js
const vi = posArr.length / 3 - 4;
```

This calculates the index relative to the total array length, which is wrong when `posArr` already contains geometry from earlier in the same build. If the array has 60 vertices before this quad is added, `vi = 60 - 4 = 56`, but the quad starts at vertex 60. The indices point to the wrong quad.

### Fix A — Verify no instance-level counter

Confirm that `buildMeshData` declares all three counters as local `let` variables and that no constructor or other method sets `this.transparentVertexIndex`. If found, remove the instance assignment and rely solely on the local variable.

### Fix B — `_buildSourceFluidFace` index calculation

Pass the vertex counter into the fluid face builders as a parameter and return the updated value, mirroring the pattern in `buildMeshData`:

```js
// Pass current counter in, return updated counter out
let vi = currentTransparentVertexIndex;
// ... push 4 vertices ...
idxArr.push(vi, vi+1, vi+2, vi, vi+2, vi+3);
currentTransparentVertexIndex += 4;
```

---

## 11 — Recommended Generation Pass Order

**File:** `worldGenerator.js` → `generateChunk`

After all fixes are applied, `generateChunk` should follow this exact sequence to avoid ordering bugs:

| Phase | Pass | Description |
|---|---|---|
| Phase 1–9 | Density + cave + ore loop | Sets STONE, BEDROCK, ores — no water yet |
| Phase 10 | `_applyCarvers` | Sphere carvers into solid terrain only |
| Phase 11 | `_applyRivers` | 2D surface channel carving — creates river beds |
| Phase 12 | `_fillWater(SEA_LEVEL)` | Flood-fill all open air at `y <= SEA_LEVEL` with WATER |
| Phase 13 | `_applySurfacePass` | Grass/sand/snow surface — includes shoreline leveling |
| Phase 14 | `_placeDecor` (via surfacePass) | Trees, flowers, cactus — after surface is settled |

---

*Cuubz World Generator Fix Sheet · 14 Issues · 4 Source Files*
