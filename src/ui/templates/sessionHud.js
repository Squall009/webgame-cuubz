/**
 * Cuubz — markup template (PR 26)
 *
 * The two in-game multiplayer widgets `UIManager` captures into `sessionUI` and
 * `ConnectionHUD` / `PlayerListOverlay` drive.
 *
 * Verbatim from `index.html`, which this replaces. Mounted eagerly by
 * `src/ui/templates/index.js` before anything wires a listener — decision 53.
 * The indentation is load-bearing only in that it reproduces the original
 * document's whitespace text nodes exactly; nothing here may gain or lose a
 * text node without checking `test/e2e/saveLoad.js` first.
 */

export const SESSION_HUD_TEMPLATE = `  <!-- Connection Status HUD (in-game) -->
  <div id="connection-hud" class="connection-hud hidden">
    <span class="status-dot"></span>
    <span class="status-text">Connected</span>
  </div>

  <!-- Player List Overlay (in-game, top-left HUD) -->
  <div id="player-list-overlay" class="player-list-overlay hidden">
    <div class="player-list-header">Players (<span id="player-count">0</span>)</div>
    <div id="player-list-items"></div>
  </div>`;
