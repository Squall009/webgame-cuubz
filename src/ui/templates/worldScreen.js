/**
 * Cuubz — markup template (PR 26)
 *
 * `#world-screen`. `#world-slots` is filled by `src/ui/screens/WorldScreen.js`, and
 * the e2e suite selects `.world-slot[data-world-id] [data-action="delete"]`.
 *
 * Verbatim from `index.html`, which this replaces. Mounted eagerly by
 * `src/ui/templates/index.js` before anything wires a listener — decision 53.
 * The indentation is load-bearing only in that it reproduces the original
 * document's whitespace text nodes exactly; nothing here may gain or lose a
 * text node without checking `test/e2e/saveLoad.js` first.
 */

export const WORLD_SCREEN_TEMPLATE = `  <!-- World Selection Screen -->
  <div id="world-screen" class="screen hidden">
    <h2>Select World</h2>
    <p id="world-slot-info" class="slot-info"></p>
    <div id="world-slots"></div>
    <div class="menu-buttons">
      <button id="btn-create-world" class="menu-btn primary">Create New World</button>
      <button id="btn-back-world" class="menu-btn secondary">Back</button>
    </div>
  </div>`;
