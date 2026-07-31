/**
 * Cuubz — markup template (PR 26)
 *
 * `#pause-menu` — Escape. Two chunk-timer sliders, the four performance controls, the
 * day/night checkbox, resume and exit-to-menu.
 *
 * **Do not add a text node to the `#pause-pause-time` label.**
 * `test/e2e/saveLoad.js` asserts
 * `getElementById('pause-pause-time').closest('label').textContent.trim()` is exactly
 * `Day/Night Cycle`. The HTML comment inside it contributes nothing to `textContent`;
 * any other text does.
 *
 * Verbatim from `index.html`, which this replaces. Mounted eagerly by
 * `src/ui/templates/index.js` before anything wires a listener — decision 53.
 * The indentation is load-bearing only in that it reproduces the original
 * document's whitespace text nodes exactly; nothing here may gain or lose a
 * text node without checking `test/e2e/saveLoad.js` first.
 */

export const PAUSE_MENU_TEMPLATE = `  <!-- Pause Menu (Escape key) -->
  <div id="pause-menu" class="overlay hidden">
    <h2>Paused</h2>
    <div class="settings-group">
      <label for="setting-tick-interval">Chunk Tick Interval (ms): <span id="tick-val">500</span></label>
      <input type="range" id="setting-tick-interval" min="100" max="2000" step="50" value="500">

      <label for="setting-chunks-per-tick">Chunks Per Tick: <span id="chunks-val">3</span></label>
      <input type="range" id="setting-chunks-per-tick" min="1" max="10" step="1" value="3">

    </div>

    <!-- Performance Settings (Pause Menu) -->
    <div class="settings-group performance-section">
      <h4>Performance</h4>

      <label for="pause-perf-render-distance">Render Distance:</label>
      <select id="pause-perf-render-distance">
        <option value="2">2 (Minimum)</option>
        <option value="3">3</option>
        <option value="4">4</option>
        <option value="5">5</option>
        <option value="6">6 (Recommended)</option>
        <option value="8">8</option>
        <option value="10">10</option>
        <option value="12">12 (Maximum)</option>
      </select>

      <label for="pause-perf-shadows">Shadows:</label>
      <select id="pause-perf-shadows">
        <option value="off">Off</option>
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
      </select>

      <label for="pause-perf-texture-res">Texture Resolution:</label>
      <select id="pause-perf-texture-res">
        <option value="low">Low (32×32)</option>
        <option value="medium">Medium (64×64)</option>
        <option value="high">High (128×128)</option>
      </select>

      <label class="checkbox-label">
        <input type="checkbox" id="pause-perf-advanced-shading" checked>
        Advanced Shading
      </label>

      <label class="checkbox-label">
        <!-- Label, not logic: main.js:4693 sets checked = !skybox.timePaused, so
             CHECKED means the cycle is RUNNING. The old label read "Pause Time of
             Day", which made ticking it un-pause time. Relabelled rather than
             inverted so no existing player's default behaviour changes. -->
        <input type="checkbox" id="pause-pause-time" checked>
        Day/Night Cycle
      </label>
    </div>

    <button id="btn-resume-game" class="menu-btn primary">Resume</button>
    <button id="btn-exit-menu" class="menu-btn secondary">Exit to Menu</button>
  </div>`;
