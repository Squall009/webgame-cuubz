/**
 * Cuubz — the pause menu's seven settings controls (PR 26, BUGS.md D-58)
 *
 * ─── WHY THIS IS ITS OWN FILE ───────────────────────────────────────────────
 *
 * These seven were inline in `PauseMenu.js`. Naming them and adding seven
 * `removeEventListener` calls pushed that file to 430 lines against §8.2's 400-line
 * accept criterion, and this is the same split `LobbyForms.js` was for `LobbyScreen.js`:
 * a coherent group of controls that shares one lifetime and one cleanup.
 *
 * ─── D-58 — THE SEVEN THAT LEAKED ───────────────────────────────────────────
 *
 * `setupPauseMenu` registered ten listeners and removed three. These are the other
 * seven: the two chunk-timer sliders, the four `#pause-perf-*` controls and the
 * time-of-day checkbox. Every one was an anonymous arrow — the exact shape PR 18 hit
 * with D-50, where `removeEventListener` has nothing to name — and every one closes over
 * `state`, a **per-session `GameState`**, on an element that outlives the session. So one
 * set survived per exit-to-menu, and with it that session's renderer, chunkManager,
 * skybox, meshes and chunk buffers, unreachable to the player and unreleasable to the GC.
 *
 * **Decision 56: session lifetime, complete cleanup.** Each handler is a named binding
 * and the returned function removes all seven. `PauseMenu`'s own cleanup calls it, and
 * `Bootstrap.js:132-141` calls that before each new session — which is what
 * `Bootstrap.js:134`'s comment always claimed.
 *
 * Two consequences of the leak that are worth keeping in view, because both were live:
 *
 *   - the chunks-per-tick handler calls `startFlushTimer` on `state.chunkManager`. A
 *     stale one is **disposed**, and `ChunkStorage.startFlushTimer` guarded only
 *     `_flushIntervalId` — so moving the slider scheduled a permanent `setInterval` on a
 *     dead manager. A `_disposed` guard was added there in the same PR.
 *   - the time-of-day handler sends `TIME_SYNC` over
 *     `state.session.client._gameSessionConn` carrying `state.skybox.timeOfDay`. Stale
 *     copies carry a stale skybox and a stale connection, so after N hosted sessions one
 *     toggle emitted N frames across N connections, N−1 of them wrong.
 *
 * `test/test_pauseMenuListeners.js` asserts the count returns to its starting value, per
 * element and per event type, across three setup/cleanup cycles.
 */

/**
 * Wire the seven, and return the function that unwires them.
 *
 * Each handler is registered only if its element (and, for the performance four,
 * `deps.perfSettings`) is present; each `if` in the cleanup mirrors that condition
 * exactly, which is why the handler bindings start as `null`.
 *
 * @param {import('../../core/GameState.js').GameState} state
 * @param {object} deps — `perfSettings` (live getter), `syncPerfSettingsUI()`,
 *   `rebuildAtlasAndMaterials(renderer, chunkManager)` and `log(...)`.
 * @returns {function():void} cleanup
 */
export function setupPauseMenuSettings(state, deps) {
  const tickSlider = document.getElementById('setting-tick-interval');
  const chunksSlider = document.getElementById('setting-chunks-per-tick');
  const tickVal = document.getElementById('tick-val');
  const chunksVal = document.getElementById('chunks-val');

  let onTickInput = null, onChunksInput = null, onPauseTimeChange = null;
  let onRenderDistChange = null, onShadowsChange = null;
  let onTextureResChange = null, onAdvShadingChange = null;

  // Settings: Region Check Interval (was Chunk Tick Interval)
  if (tickSlider && tickVal) {
    tickSlider.value = 500; // Default region check interval
    tickVal.textContent = tickSlider.value;
    onTickInput = function() {
      const val = parseInt(tickSlider.value);
      tickVal.textContent = val;
      if (state.chunkManager) {
        state.chunkManager.stopRegionCheck();
        state.chunkManager.startRegionCheck(val);
      }
    };
    tickSlider.addEventListener('input', onTickInput);
  }

  // Settings: Chunks Per Tick → now controls flush interval
  if (chunksSlider && chunksVal) {
    chunksSlider.value = 5; // Default flush interval in seconds
    chunksVal.textContent = chunksSlider.value + 's';
    onChunksInput = function() {
      const val = parseInt(chunksSlider.value);
      chunksVal.textContent = val + 's';
      if (state.chunkManager) {
        state.chunkManager.stopFlushTimer();
        state.chunkManager.startFlushTimer(val * 1000);
      }
    };
    chunksSlider.addEventListener('input', onChunksInput);
  }

  // ─── Performance settings ─────────────────────
  // Sync UI with current settings on pause
  if (deps.perfSettings) deps.syncPerfSettingsUI();

  const pausePerfRenderDist = document.getElementById('pause-perf-render-distance');
  const pausePerfShadows = document.getElementById('pause-perf-shadows');
  const pausePerfTextureRes = document.getElementById('pause-perf-texture-res');
  const pausePerfAdvShading = document.getElementById('pause-perf-advanced-shading');

  if (pausePerfRenderDist && deps.perfSettings) {
    onRenderDistChange = function() {
      const val = parseInt(pausePerfRenderDist.value, 10);
      deps.perfSettings.set('renderDistance', val);
      deps.syncPerfSettingsUI();
      if (state.chunkManager) {
        state.chunkManager.setRenderDistance(val);
      }
    };
    pausePerfRenderDist.addEventListener('change', onRenderDistChange);
  }

  if (pausePerfShadows && deps.perfSettings) {
    onShadowsChange = function() {
      const val = pausePerfShadows.value;
      deps.perfSettings.set('shadowQuality', val);
      deps.syncPerfSettingsUI();
      if (state.renderer) {
        state.renderer.setShadowQuality(val);
      }
    };
    pausePerfShadows.addEventListener('change', onShadowsChange);
  }

  if (pausePerfTextureRes && deps.perfSettings) {
    onTextureResChange = async function() {
      const val = pausePerfTextureRes.value;
      deps.perfSettings.set('textureResolution', val);
      deps.syncPerfSettingsUI();
      await deps.rebuildAtlasAndMaterials(state.renderer, state.chunkManager);
    };
    pausePerfTextureRes.addEventListener('change', onTextureResChange);
  }

  if (pausePerfAdvShading && deps.perfSettings) {
    onAdvShadingChange = async function() {
      const val = pausePerfAdvShading.checked;
      deps.perfSettings.set('advancedShading', val);
      deps.syncPerfSettingsUI();
      await deps.rebuildAtlasAndMaterials(state.renderer, state.chunkManager);
    };
    pausePerfAdvShading.addEventListener('change', onAdvShadingChange);
  }

  // Pause Time of Day checkbox
  const pauseTimeCheckbox = document.getElementById('pause-pause-time');
  if (pauseTimeCheckbox && state.skybox) {
    pauseTimeCheckbox.checked = !state.skybox.timePaused; // checked = time running
    onPauseTimeChange = function() {
      state.skybox.timePaused = !pauseTimeCheckbox.checked;
      deps.log(`[Cuubz] Time of day ${state.skybox.timePaused ? 'PAUSED' : 'RESUMED'}`);
      // Immediately broadcast time change to clients.
      // Use hostingSessionId as the guard — the host is the authority on time,
      // and time sync is independent of chunk streaming.
      if (state.session && state.session.hostingSessionId &&
          state.session.client && state.session.client._gameSessionConn) {
        state.session.client._gameSessionConn.send({
          type: 'TIME_SYNC',
          timeOfDay: state.skybox.timeOfDay,
          timePaused: state.skybox.timePaused,
        });
        deps.log(`[Cuubz] TIME_SYNC sent: timePaused=${state.skybox.timePaused}`);
      }
    };
    pauseTimeCheckbox.addEventListener('change', onPauseTimeChange);
  }

  // Every `addEventListener` above has a line here. Add an eighth control and you add a
  // line here too — `test/test_pauseMenuListeners.js` counts them and goes red otherwise.
  return function cleanupPauseMenuSettings() {
    if (onTickInput) tickSlider.removeEventListener('input', onTickInput);
    if (onChunksInput) chunksSlider.removeEventListener('input', onChunksInput);
    if (onRenderDistChange) pausePerfRenderDist.removeEventListener('change', onRenderDistChange);
    if (onShadowsChange) pausePerfShadows.removeEventListener('change', onShadowsChange);
    if (onTextureResChange) pausePerfTextureRes.removeEventListener('change', onTextureResChange);
    if (onAdvShadingChange) pausePerfAdvShading.removeEventListener('change', onAdvShadingChange);
    if (onPauseTimeChange) pauseTimeCheckbox.removeEventListener('change', onPauseTimeChange);
  };
}
