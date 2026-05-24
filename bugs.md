# Cuubz — Bug Tracker

> Living bug tracker maintained by autonomous builder. Zero open bugs required before phase advancement.

| Bug # | Title | Status | Found During | Phase |
|-------|-------|--------|--------------|-------|
| 1 | Collision slide direction error | FIXED | Player movement integration tests | Phase 1 |
| 2 | FeaturePlacer placement outside chunk bounds | FIXED | Chunk loading tests | Phase 1 |
| 3 | Cave generator seam mismatch at chunk edges | FIXED | World generation integration | Phase 1 |

---

## Bug #1: Collision slide direction error
- **Found:** 2026-05-24 during task "Player movement integration tests"
- **Status:** FIXED
- **Description:** Player AABB collision was sliding in wrong direction when hitting block face from certain angles. Expected: slide along wall. Actual: player stuck or pushed backward.
- **Reproduction Steps:** Move diagonally toward a wall at ~45° angle with AABB collision enabled.
- **Root Cause:** Collision resolution used axis-aligned push without considering movement direction vector.
- **Fix Applied:** Rewrote `_resolveCollision` to project movement onto free axis based on penetration depth comparison.
- **Verified:** 2026-05-24 — test_playerMovementIntegration.js passes (106 assertions)

## Bug #2: FeaturePlacer placement outside chunk bounds
- **Found:** 2026-05-24 during task "Chunk loading tests"
- **Status:** FIXED
- **Description:** FeaturePlacer placed trees/cacti that extended beyond the current chunk boundary, causing blocks to be written into neighboring chunks' data. This created orphan blocks and visual artifacts at chunk edges.
- **Reproduction Steps:** Generate world with seed 42, place trees near chunk edge (x=15 or z=15).
- **Root Cause:** FeaturePlacer checked only the base position against chunk bounds, not the full footprint of the feature being placed.
- **Fix Applied:** Added footprint validation in `_canPlaceFeature` that checks all blocks a feature would occupy against chunk boundaries.
- **Verified:** 2026-05-24 — test_chunkLoading.js passes (51 assertions)

## Bug #3: Cave generator seam mismatch at chunk edges
- **Found:** 2026-05-24 during task "World generation integration"
- **Status:** FIXED
- **Description:** Caves did not continue seamlessly across chunk boundaries. Walking from one chunk to the next showed cave tunnels abruptly ending or appearing mid-air.
- **Reproduction Steps:** Generate adjacent chunks with same seed, compare boundary faces at shared edge.
- **Root Cause:** 3D noise thresholding used independent random seeds per chunk instead of continuous world-space coordinates for the noise function.
- **Fix Applied:** Changed cave generator to use world-space coordinates (chunkX * 16 + localX) as input to the 3D noise function, ensuring deterministic continuity across chunk boundaries.
- **Verified:** 2026-05-24 — test_worldGenerationIntegration.js passes (36 assertions including seam tests)

---

## Template for New Bugs

```markdown
## Bug #N: [Title]
- **Found:** [date] during task "[task name]"
- **Status:** OPEN / FIXING / FIXED
- **Description:** What happens vs expected
- **Reproduction Steps:** Exact steps to trigger
- **Root Cause:** (when known)
- **Fix Applied:** (when fixed)
- **Verified:** [date] — test passes
```
