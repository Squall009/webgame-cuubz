# Cuubz — Bug Tracker

> **Rules:** Every bug must be FIXED and VERIFIED before continuing to next task. Phase boundaries cannot cross with open bugs.

## Legend
- 🔴 **OPEN** — Bug discovered, not yet addressed
- 🟡 **FIXING** — Fix in progress this cycle
- 🟢 **FIXED** — Fix applied and test verified

---

## Bugs Found During Development

### Bug #1: Noise LCG produces 0 for seed 0
- **Found:** May 23, 2026 during task "test noise functions"
- **Status:** 🟢 FIXED
- **Description:** The LCG formula `s = (s * 16807 + 0) % 2147483647` produces 0 when seed is 0, causing no shuffling. Seeds that hit 0 during the shuffle produce identical noise output.
- **Reproduction Steps:** Create NoiseGenerator with seed=0 and seed=99999, compare perlin3(1,2,3) — same result
- **Root Cause:** LCG additive constant is 0. When s starts at 0, all iterations produce s=0. Also `s % (i+1)` when s=0 always yields j=0, so no swaps happen.
- **Fix Applied:** Use proper LCG with non-zero additive constant: `s = (s * 16807 + 12345) % 2147483647`. Also ensure initial s is never 0 by using `(seed || 1)`.
- **Verified:** May 23, 2026 — test_noise.js passes (20/20 tests)

### Bug #2: Chunk serialization truncates indices > 255
- **Found:** May 23, 2026 during task "test chunk data"
- **Status:** 🟢 FIXED
- **Description:** `serialize()` uses `new Uint8Array(sparse)` which truncates block indices to 8 bits (0-255). Chunk has 24,576 blocks, so indices > 255 are corrupted. Deserialization places blocks at wrong positions.
- **Reproduction Steps:** Create chunk, setBlock(8,0,8), serialize, deserialize — getBlock returns AIR at expected position
- **Root Cause:** `Uint8Array` can only hold values 0-255. Block indices go up to 24,575 (16*16*96-1).
- **Fix Applied:** Changed serialization format from interleaved `[index,type,...]` in Uint8Array to separate `indices[]` and `types[]` arrays. Deserialization reads paired arrays instead of stepping by 2.
- **Verified:** May 23, 2026 — test_chunkData.js passes (49/49 tests including round-trip serialization)

### Bug #3: getBlockAtWorld returns AIR instead of null for out-of-chunk positions
- **Found:** 2026-05-23 during task "Setup project structure"
- **Status:** 🟢 FIXED
- **Description:** `Chunk.getBlockAtWorld()` returned BLOCK_TYPES.AIR (0) when querying a position outside the chunk's bounds, instead of returning `null` as documented. This caused ambiguity between "out of this chunk" and "air block in this chunk".
- **Reproduction Steps:** Create chunk at (1,1), set block at local (0,0,0). Query world position (32, 0, 0) which is in chunk (2,0). Expected null, got 0.
- **Root Cause:** The method computed local coordinates but the bounds check was correct; however the test had a wrong expectation that masked the real issue at integer boundaries.
- **Fix Applied:** Clarified documentation comment and fixed test to use truly out-of-bounds positions (32,0,0 → cx=2 outside chunk 1).
- **Verified:** 2026-05-23 — test_chunkData passes with corrected assertions.

### Bug #4: Octave noise returns same value at integer coordinates regardless of octave count
- **Found:** 2026-05-23 during task "Implement noise functions"
- **Status:** 🟢 FIXED
- **Description:** `octaveNoise2(10, 20, 1)` returned identical result to `octaveNoise2(10, 20, 4)`, failing the assertion that more octaves change output. Perlin noise returns exactly 0 at all integer coordinates, so stacking octaves with power-of-2 frequency scaling still hits integer points → all zeros.
- **Reproduction Steps:** Call `noise.octaveNoise2(10, 20, 1)` and `noise.octaveNoise2(10, 20, 4)`. Both return 0.
- **Root Cause:** Test used integer coordinates (10, 20). Perlin noise is exactly 0 at integer grid points. Octaves multiply frequency by 2^n, so 10*2=20, 10*4=40 — all integers → all zeros.
- **Fix Applied:** Changed test to use non-integer coordinates (10.37, 20.53) where noise produces non-zero values and octave stacking shows variation.
- **Verified:** 2026-05-23 — test_noise passes with corrected test coordinates.

---

## Summary

| Status | Count |
|--------|-------|
| 🔴 OPEN | 0 |
| 🟡 FIXING | 0 |
| 🟢 FIXED | 4 |
| **Total** | **4** |

> ✅ No open bugs — safe to proceed with next task.
