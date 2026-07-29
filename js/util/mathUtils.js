'use strict';

/**
 * Cuubz — Shared Math Utilities
 *
 * Canonical home for small pure math helpers that more than one subsystem needs.
 *
 * Created 2026-07-29 (refactor.md PR 3) to resolve two silent global collisions:
 *   - `smoothstep`      was declared in BOTH js/renderer/skybox.js and js/audio/ambient.js
 *   - `distanceBetween` was declared in BOTH js/entities/boss.js and js/multiplayer/playerSync.js
 *
 * Both pairs were behaviourally identical, so the collisions were harmless — but they
 * proved the pattern that DID break boss spawning, host inventory sync and mobile
 * perf tuning (refactor.md §2.1). Consuming files now re-export from here instead of
 * declaring their own copy.
 *
 * Loaded early in index.html (right after util/logger.js) so every consumer sees it.
 * Migrates to src/util/MathUtils.js in Phase 1.
 */

/**
 * Smoothstep interpolation — eases in and out between 0 and 1.
 * Input is clamped to [0, 1].
 * @param {number} t
 * @returns {number} Smoothed value in [0, 1]
 */
function smoothstep(t) {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
}

/**
 * Euclidean distance between two 3D positions.
 * @param {{x:number,y:number,z:number}} a
 * @param {{x:number,y:number,z:number}} b
 * @returns {number}
 */
function distanceBetween(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Squared Euclidean distance — use when only comparing distances (avoids sqrt).
 * @param {{x:number,y:number,z:number}} a
 * @param {{x:number,y:number,z:number}} b
 * @returns {number}
 */
function squaredDistanceBetween(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  return dx * dx + dy * dy + dz * dz;
}

/** Linear interpolation between a and b. */
function lerpValue(a, b, t) {
  return a + (b - a) * t;
}

/** Clamp v into [min, max]. */
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// Node.js exports
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { smoothstep, distanceBetween, squaredDistanceBetween, lerpValue, clamp };
}
