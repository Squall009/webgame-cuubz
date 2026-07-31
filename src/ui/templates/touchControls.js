/**
 * Cuubz — markup template (PR 26)
 *
 * `#touch-controls` — the virtual joystick, the look zone and the five action
 * buttons. `Bootstrap.detectMobile()` is what removes `.hidden`.
 *
 * Verbatim from `index.html`, which this replaces. Mounted eagerly by
 * `src/ui/templates/index.js` before anything wires a listener — decision 53.
 * The indentation is load-bearing only in that it reproduces the original
 * document's whitespace text nodes exactly; nothing here may gain or lose a
 * text node without checking `test/e2e/saveLoad.js` first.
 */

export const TOUCH_CONTROLS_TEMPLATE = `  <!-- Mobile Touch Controls -->
  <div id="touch-controls" class="hidden">
    <!-- Left Virtual Joystick -->
    <div id="joystick-zone">
      <div id="joystick-base"></div>
      <div id="joystick-thumb"></div>
    </div>
    <!-- Right side: swipe-to-look zone (handled by touch.js) -->
    <div id="look-zone"></div>
    <!-- Action buttons for mobile -->
    <div id="mobile-actions">
      <button id="btn-jump-mobile" class="action-btn">⬆</button>
      <button id="btn-break-mobile" class="action-btn action-break">⛏</button>
      <button id="btn-place-mobile" class="action-btn action-place">🧱</button>
      <button id="btn-inventory-mobile" class="action-btn action-inv">🎒</button>
      <button id="btn-crafting-mobile" class="action-btn action-craft">🔨</button>
    </div>
  </div>`;
