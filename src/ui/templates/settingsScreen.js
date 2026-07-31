/**
 * Cuubz — markup template (PR 26)
 *
 * `#settings-screen` — volume, music volume, the controls hint and the four
 * performance controls. `#perf-render-distance` must stay a `<select>` carrying a
 * `value="2"` option: `test/e2e/saveLoad.js` drives it with `selectOption('2')`.
 *
 * `#music-volume` and `#music-volume-value` are read from nowhere in `src/` — PR 34.
 *
 * Verbatim from `index.html`, which this replaces. Mounted eagerly by
 * `src/ui/templates/index.js` before anything wires a listener — decision 53.
 * The indentation is load-bearing only in that it reproduces the original
 * document's whitespace text nodes exactly; nothing here may gain or lose a
 * text node without checking `test/e2e/saveLoad.js` first.
 */

export const SETTINGS_SCREEN_TEMPLATE = `  <!-- Settings Screen -->
  <div id="settings-screen" class="screen hidden">
    <h2>Settings</h2>
    <div class="settings-group">
      <label for="volume-slider">Volume:</label>
      <input type="range" id="volume-slider" min="0" max="100" value="50">
      <span id="volume-value">50%</span>
    </div>
    <div class="settings-group">
      <label for="music-volume">Music Volume:</label>
      <input type="range" id="music-volume" min="0" max="100" value="30">
      <span id="music-volume-value">30%</span>
    </div>
    <div class="settings-group controls-hint">
      <h4>Controls</h4>
      <p><strong>Desktop:</strong> WASD move, Space jump, Shift sprint, E interact, Mouse look/click</p>
      <p><strong>Mobile:</strong> Left joystick move, Right swipe look, Tap break/place</p>
    </div>

    <!-- Performance Settings -->
    <div class="settings-group performance-section">
      <h4>Performance</h4>

      <label for="perf-render-distance">Render Distance:</label>
      <select id="perf-render-distance">
        <option value="2">2 (Minimum)</option>
        <option value="3">3</option>
        <option value="4">4</option>
        <option value="5">5</option>
        <option value="6">6 (Recommended)</option>
        <option value="8">8</option>
        <option value="10">10</option>
        <option value="12">12 (Maximum)</option>
      </select>

      <label for="perf-shadows">Shadows:</label>
      <select id="perf-shadows">
        <option value="off">Off</option>
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
      </select>

      <label for="perf-texture-res">Texture Resolution:</label>
      <select id="perf-texture-res">
        <option value="low">Low (32×32)</option>
        <option value="medium">Medium (64×64)</option>
        <option value="high">High (128×128)</option>
      </select>

      <label class="checkbox-label">
        <input type="checkbox" id="perf-advanced-shading" checked>
        Advanced Shading (Normal + Specular Maps)
      </label>
    </div>

    <div class="menu-buttons">
      <button id="btn-back-settings" class="menu-btn secondary">Back</button>
    </div>
  </div>`;
