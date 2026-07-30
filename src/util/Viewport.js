'use strict';

/**
 * Cuubz — Viewport Helpers
 *
 * Canonical mobile-viewport detection.
 *
 * Created 2026-07-29 (refactor.md PR 3) to resolve a LIVE global collision:
 *
 *   js/renderer/performanceOptimizer.js:54  function isMobileViewport(screenWidth)  // width < 768
 *   js/multiplayer/playerListHUD.js:63      function isMobileViewport()             // width <= 600
 *
 * playerListHUD.js loads later (index.html:576 vs :544), so its zero-arg, 600px
 * version silently won. performanceOptimizer.js:400 was passing a screen width that
 * was ignored, and mobile performance tuning was being applied at 600px instead of
 * its intended 768px. See refactor.md §2.1.
 *
 * ─── Deviation from refactor.md PR 3 ────────────────────────────────────────
 * The plan said "pick one threshold and document it". On inspection the two
 * thresholds are NOT an accident of duplication — they answer different questions:
 *
 *   768px — "is this device weak enough to need reduced draw distance / effects?"
 *   600px — "is this screen narrow enough that the player list must collapse?"
 *
 * Collapsing them to one number would silently change either perf tuning or the HUD
 * layout with no gameplay justification. So this module provides ONE implementation
 * with TWO named, documented breakpoints. The collision is gone; both behaviours are
 * preserved byte-for-byte.
 *
 * Note the comparison is `<=` against an INCLUSIVE max width, so:
 *   MOBILE_MAX_WIDTH_PERF = 767  is exactly the old `width < 768`
 *   MOBILE_MAX_WIDTH_HUD  = 600  is exactly the old `width <= 600`
 *
 * Migrates to src/util/Viewport.js in Phase 1.
 */

/** Widest viewport still treated as mobile for PERFORMANCE tuning (was `< 768`). */
export const MOBILE_MAX_WIDTH_PERF = 767;

/** Widest viewport still treated as mobile for the PLAYER LIST HUD (was `<= 600`). */
export const MOBILE_MAX_WIDTH_HUD = 600;

/**
 * Is the viewport mobile-sized?
 *
 * @param {number} [screenWidth] - Explicit width. Omit to read window.innerWidth.
 *                                 Returns false if neither is available (Node/tests).
 * @param {number} [maxWidth=MOBILE_MAX_WIDTH_PERF] - Inclusive max mobile width.
 * @returns {boolean}
 */
export function isMobileViewport(screenWidth, maxWidth = MOBILE_MAX_WIDTH_PERF) {
  let width = screenWidth;

  if (width === undefined || width === null) {
    width = (typeof window !== 'undefined' && window.innerWidth) ? window.innerWidth : null;
  }

  // No viewport to measure (Node, headless tests) — not mobile.
  if (width === null || typeof width !== 'number' || Number.isNaN(width)) return false;

  return width <= maxWidth;
}
