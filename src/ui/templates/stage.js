/**
 * Cuubz — markup template (PR 26)
 *
 * The canvas-level layer: `#game-container`, the crosshair, the day/night readout,
 * the block target highlight and the two debug overlays. Six top-level elements that
 * sit under every screen and are never routed by `UIManager.show()`.
 *
 * Verbatim from `index.html`, which this replaces. Mounted eagerly by
 * `src/ui/templates/index.js` before anything wires a listener — decision 53.
 * The indentation is load-bearing only in that it reproduces the original
 * document's whitespace text nodes exactly; nothing here may gain or lose a
 * text node without checking `test/e2e/saveLoad.js` first.
 */

export const STAGE_TEMPLATE = `  <!-- Game Canvas Container -->
  <div id="game-container"></div>

  <!-- Crosshair Overlay -->
  <div id="crosshair">+</div>

  <!-- Day/Night Indicator HUD -->
  <div id="day-night-indicator" data-phase="day" data-is-night="false">☀️ 12:00 Noon</div>

  <!-- Block Target Highlight (wireframe overlay) -->
  <canvas id="target-highlight" width="1" height="1"></canvas>

  <!-- Debug: Texture Atlas Overlay (top-right corner) -->
  <div id="atlas-overlay" class="hidden">
    <div id="atlas-label">Texture Atlas</div>
    <canvas id="atlas-canvas" width="512" height="512"></canvas>
  </div>

  <!-- Debug: Block Hover Tooltip -->
  <div id="block-tooltip" class="hidden">
    <span id="tooltip-block-id"></span>
    <span id="tooltip-block-name"></span>
  </div>`;
