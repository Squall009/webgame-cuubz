/**
 * Cuubz — SettingsScreen (PR 15)
 *
 * `refactor.md` §8.2: "settings wiring". The four performance controls on the main-menu
 * settings screen, the volume slider, and `syncPerfSettingsUI`.
 *
 * ─── WHY `syncUI()` TOUCHES THE PAUSE MENU TOO ──────────────────────────────
 *
 * There are **two** copies of every performance control in `index.html` — `#perf-*` on the
 * settings screen and `#pause-perf-*` in the pause menu — backed by one
 * `PerformanceSettings` object. `syncPerfSettingsUI` has always written both sets, because
 * changing render distance from the pause menu has to leave the settings screen showing
 * the new value and vice versa. That is why this method reaches outside its own screen,
 * and it is deliberate rather than an oversight: splitting it would give the two copies
 * two ways to drift.
 *
 * `setupPauseMenu` (still in `main.js`, PR 19's) calls it through a delegate. **PR 19 owns
 * the pause-menu half**; when it lands, the natural shape is one `PerformanceControls`
 * component mounted twice, and this method becomes its `sync()`.
 */

export class SettingsScreen {
  /**
   * @param {import('../UIManager.js').UIManager} ui
   */
  constructor(ui) {
    this.ui = ui;
    this.deps = ui.deps;
  }

  /** Wire this screen's controls. Called once, from `UIManager.initNavigation`. */
  init() {
    const perfSettings = this.deps.perfSettings;

    const renderDist = document.getElementById('perf-render-distance');
    const shadows = document.getElementById('perf-shadows');
    const textureRes = document.getElementById('perf-texture-res');
    const advShading = document.getElementById('perf-advanced-shading');

    // The `&& perfSettings` guards are load-order, not paranoia: `init()` runs from
    // `initMenuNavigation`, which `main.js` calls after `perfSettings` is constructed —
    // but a `PerformanceSettings` constructor that threw would otherwise take the whole
    // menu with it. Unchanged from `main.js`.
    if (renderDist && perfSettings) {
      renderDist.addEventListener('change', () => {
        const val = parseInt(renderDist.value, 10);
        perfSettings.set('renderDistance', val);
        this.syncUI();
        const state = this.deps.gameState;
        if (state && state.chunkManager) {
          state.chunkManager.setRenderDistance(val);
        }
      });
    }

    if (shadows && perfSettings) {
      shadows.addEventListener('change', () => {
        const val = shadows.value;
        perfSettings.set('shadowQuality', val);
        this.syncUI();
        const state = this.deps.gameState;
        if (state && state.renderer) {
          state.renderer.setShadowQuality(val);
        }
      });
    }

    if (textureRes && perfSettings) {
      textureRes.addEventListener('change', async () => {
        perfSettings.set('textureResolution', textureRes.value);
        this.syncUI();
        const state = this.deps.gameState;
        if (state && state.renderer && state.chunkManager) {
          await this.deps.rebuildAtlasAndMaterials(state.renderer, state.chunkManager);
        }
      });
    }

    if (advShading && perfSettings) {
      advShading.addEventListener('change', async () => {
        perfSettings.set('advancedShading', advShading.checked);
        this.syncUI();
        const state = this.deps.gameState;
        if (state && state.renderer && state.chunkManager) {
          await this.deps.rebuildAtlasAndMaterials(state.renderer, state.chunkManager);
        }
      });
    }

    // Volume slider — display only. Nothing consumes the value: the entire audio
    // subsystem is 1,791 lines that are never instantiated (BUGS.md **D-25**, PR 20).
    const volumeSlider = document.getElementById('volume-slider');
    const volumeValue = document.getElementById('volume-value');
    if (volumeSlider && volumeValue) {
      volumeSlider.addEventListener('input', () => {
        volumeValue.textContent = volumeSlider.value + '%';
      });
    }
  }

  /** Push the current settings into both copies of the controls. See the header. */
  syncUI() {
    const perfSettings = this.deps.perfSettings;
    if (!perfSettings) return;
    const s = perfSettings.get();

    const menuRenderDist = document.getElementById('perf-render-distance');
    const menuShadows = document.getElementById('perf-shadows');
    const menuTextureRes = document.getElementById('perf-texture-res');
    const menuAdvShading = document.getElementById('perf-advanced-shading');

    if (menuRenderDist) menuRenderDist.value = String(s.renderDistance);
    if (menuShadows) menuShadows.value = s.shadowQuality;
    if (menuTextureRes) menuTextureRes.value = s.textureResolution;
    if (menuAdvShading) menuAdvShading.checked = s.advancedShading;

    const pauseRenderDist = document.getElementById('pause-perf-render-distance');
    const pauseShadows = document.getElementById('pause-perf-shadows');
    const pauseTextureRes = document.getElementById('pause-perf-texture-res');
    const pauseAdvShading = document.getElementById('pause-perf-advanced-shading');

    if (pauseRenderDist) pauseRenderDist.value = String(s.renderDistance);
    if (pauseShadows) pauseShadows.value = s.shadowQuality;
    if (pauseTextureRes) pauseTextureRes.value = s.textureResolution;
    if (pauseAdvShading) pauseAdvShading.checked = s.advancedShading;
  }
}
