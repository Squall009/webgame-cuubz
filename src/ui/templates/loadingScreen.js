/**
 * Cuubz — markup template (PR 26)
 *
 * `#loading-screen` — the seventh `.screen`. `#loading-progress` is the element every
 * `src/core/init/*` step widens as it completes.
 *
 * Verbatim from `index.html`, which this replaces. Mounted eagerly by
 * `src/ui/templates/index.js` before anything wires a listener — decision 53.
 * The indentation is load-bearing only in that it reproduces the original
 * document's whitespace text nodes exactly; nothing here may gain or lose a
 * text node without checking `test/e2e/saveLoad.js` first.
 */

export const LOADING_SCREEN_TEMPLATE = `  <!-- Loading Screen -->
  <div id="loading-screen" class="screen hidden">
    <div class="loading-content">
      <h2>Loading...</h2>
      <p id="loading-status">Generating world...</p>
      <div class="loading-bar"><div class="loading-fill" id="loading-progress"></div></div>
    </div>
  </div>`;
