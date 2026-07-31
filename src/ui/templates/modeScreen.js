/**
 * Cuubz — markup template (PR 26)
 *
 * `#mode-screen` — survival / creative / back. Wired by `UIManager.initNavigation`.
 *
 * Verbatim from `index.html`, which this replaces. Mounted eagerly by
 * `src/ui/templates/index.js` before anything wires a listener — decision 53.
 * The indentation is load-bearing only in that it reproduces the original
 * document's whitespace text nodes exactly; nothing here may gain or lose a
 * text node without checking `test/e2e/saveLoad.js` first.
 */

export const MODE_SCREEN_TEMPLATE = `  <!-- Mode Selection Screen -->
  <div id="mode-screen" class="screen hidden">
    <h2>Game Mode</h2>
    <div class="menu-buttons">
      <button id="btn-survival" class="menu-btn primary">Survival</button>
      <button id="btn-creative" class="menu-btn">Creative</button>
      <button id="btn-back-mode" class="menu-btn secondary">Back</button>
    </div>
  </div>`;
