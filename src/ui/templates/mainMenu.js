/**
 * Cuubz — markup template (PR 26)
 *
 * `#main-menu` — the only one of the seven `.screen`s that does **not** carry
 * `.hidden`, so it is what the page shows the moment the templates mount.
 *
 * Verbatim from `index.html`, which this replaces. Mounted eagerly by
 * `src/ui/templates/index.js` before anything wires a listener — decision 53.
 * The indentation is load-bearing only in that it reproduces the original
 * document's whitespace text nodes exactly; nothing here may gain or lose a
 * text node without checking `test/e2e/saveLoad.js` first.
 */

export const MAIN_MENU_TEMPLATE = `  <!-- Main Menu Screen -->
  <div id="main-menu" class="screen">
    <h1 class="game-title">CUUBZ</h1>
    <p class="game-subtitle">Voxel Survival</p>
    <div class="menu-buttons">
      <button id="btn-play-solo" class="menu-btn primary">Play Solo</button>
      <button id="btn-host" class="menu-btn">Host Multiplayer</button>
      <button id="btn-join" class="menu-btn">Join Multiplayer</button>
      <button id="btn-settings" class="menu-btn secondary">Settings</button>
    </div>
  </div>`;
