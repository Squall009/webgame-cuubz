/**
 * Cuubz — markup template (PR 26)
 *
 * `#debug-stats` — the four counters `src/ui/hud/DebugStats.js` writes each frame.
 *
 * Verbatim from `index.html`, which this replaces. Mounted eagerly by
 * `src/ui/templates/index.js` before anything wires a listener — decision 53.
 * The indentation is load-bearing only in that it reproduces the original
 * document's whitespace text nodes exactly; nothing here may gain or lose a
 * text node without checking `test/e2e/saveLoad.js` first.
 */

export const DEBUG_STATS_TEMPLATE = `  <!-- Debug Stats Overlay (top-left, always visible in-game) -->
  <div id="debug-stats" class="hidden">
    <div id="stats-fps"></div>
    <div id="stats-chunks"></div>
    <div id="stats-dirty"></div>
    <div id="stats-manifest"></div>
  </div>`;
