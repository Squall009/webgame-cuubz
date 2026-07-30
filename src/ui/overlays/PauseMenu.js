/**
 * Cuubz — the pause menu (PR 18)
 *
 * `src/main.js:393–696` — `setupPauseMenu(state)`, verbatim except for the three edits
 * named below. `refactor.md` §8.5 and §13.
 *
 * ─── WHAT IT OWNS ───────────────────────────────────────────────────────────
 *
 * One `document` `keydown` listener (Escape → pause / resume), the resume and exit
 * buttons, the two chunk-timer sliders, the four performance controls and the
 * time-of-day checkbox. It returns its own cleanup function, and that function is the
 * **only** thing that removes this module's listeners — deliberately, because the
 * Escape handler has to keep working while the game is paused, which is exactly when a
 * session-wide teardown would otherwise run. It is therefore **not** registered with
 * `state.addTeardown` (D-50); `onExit` calls it directly.
 *
 * ─── THE THREE EDITS ────────────────────────────────────────────────────────
 *
 *   1. `sessionManager` was a `main.js` module `let`; it is `state.session` now — the
 *      same field the render loop reads (`GameState.js`). The old
 *      `typeof sessionManager !== 'undefined' && sessionManager` guard is a plain
 *      `if (state.session)`: the `typeof` half is meaningless on a property access
 *      (decision 29 — this is not the wider sweep, which is PR 33's).
 *   2. `perfSettings`, `syncPerfSettingsUI`, `rebuildAtlasAndMaterials`, `showScreen`,
 *      `_log` and the render loop were `main.js` top-level bindings. They arrive through
 *      `deps` — the same live-getter object the bootstrap hands `Game` (decision 27).
 *      `perfSettings` in particular **must** be read through the getter: it is `null`
 *      when this module is loaded and is assigned inside `Bootstrap.start()`.
 *   3. **D-54** — `onExit` now calls `state.game.stop()` first. See below.
 *
 * ─── D-54: `onExit` FLUSHES THE SESSION ─────────────────────────────────────
 *
 * `Game.stop()` had no call site anywhere in the tree. `onExit` set
 * `state.game.running = false` by hand, so exiting to the menu never saved the player,
 * never cleared the dropped items and — the leak — never cleared the 30 s save
 * interval `initHud` starts, one per session. `DEPLOY.md` §7's timing table already
 * says player state is flushed on `game.stop()`; this is what makes that true.
 *
 * It is wrapped in `try/catch` because everything after it is teardown: a throw in the
 * save path must not leave the renderer, the session and the HUD in the state a live
 * game leaves them in. That failure mode has happened before — D-14, where a call to a
 * method that did not exist skipped six cleanup steps and `showScreen('mainMenu')`, and
 * left the page blank.
 */

/**
 * Wire the pause menu for one session.
 *
 * Takes the GameState, not the `Game` — PR 12. Every reference below that used to read
 * `game.chunkManager` / `game.renderer` / `game.skybox` reads it off `state`, and the
 * four lifecycle flags go through `state.game`. That is what makes the Escape handler
 * able to see `state.inventoryOpen`, which is `BUGS.md` D-31.
 *
 * @param {import('../../core/GameState.js').GameState} state
 * @param {object} deps — `perfSettings` (getter), `syncPerfSettingsUI()`,
 *   `rebuildAtlasAndMaterials(renderer, chunkManager)`, `showScreen(name)`, `log(...)`
 *   and `stopRenderLoop()`.
 * @returns {function():void} cleanup — removes the listeners this call added.
 */
export function setupPauseMenu(state, deps) {
  const pauseMenu = document.getElementById('pause-menu');
  const resumeBtn = document.getElementById('btn-resume-game');
  const debugStats = document.getElementById('debug-stats');

  // Settings sliders
  const tickSlider = document.getElementById('setting-tick-interval');
  const chunksSlider = document.getElementById('setting-chunks-per-tick');
  const distanceSlider = document.getElementById('setting-render-distance');

  // Value displays
  const tickVal = document.getElementById('tick-val');
  const chunksVal = document.getElementById('chunks-val');
  const distanceVal = document.getElementById('distance-val');

  if (!pauseMenu || !resumeBtn) return function() {};

  // Show debug stats overlay when game starts
  if (debugStats) {
    debugStats.classList.remove('hidden');
  }

  // ── Escape key handler ──
  const onPause = function(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      const isPaused = !pauseMenu.classList.contains('hidden');

      if (!isPaused) {
        // D-31 — CLOSED IN PR 12. This block existed and never ran: it read
        // `typeof inventoryOpen !== 'undefined' && inventoryOpen` for a `let` declared
        // inside startGame()'s setTimeout closure, which was never in scope in this
        // function, so the guard was permanently false and pressing Escape with the
        // inventory open left the crafting screen sitting on top of the pause menu.
        // `inventoryOpen` is a field on the GameState now and this handler is holding
        // it. No `typeof` guard and no `window` global: `state` is a parameter, so if it
        // were ever wrong this would throw rather than go quiet.
        if (state.inventoryOpen) {
          state.inventoryOpen = false;
          const craftingScreenEl = document.getElementById('crafting-screen');
          if (craftingScreenEl) craftingScreenEl.classList.add('hidden');
        }

        // Pause game
        state.game.paused = true;
        pauseMenu.classList.remove('hidden');
        // Hide hotbar when paused
        const hotbarContainer = document.getElementById('hotbar-container');
        if (hotbarContainer) hotbarContainer.classList.add('hidden');
        document.exitPointerLock();
        // Stop all timers while paused
        if (state.chunkManager) {
          state.chunkManager.stopRegionCheck();
          state.chunkManager.stopFlushTimer();
        }
      } else {
        // Resume game
        resumeGame();
      }
    }
  };

  function resumeGame() {
    state.game.paused = false;
    pauseMenu.classList.add('hidden');
    // Show hotbar when resuming
    const hotbarContainer = document.getElementById('hotbar-container');
    if (hotbarContainer) hotbarContainer.classList.remove('hidden');
    state.renderer.domElement.requestPointerLock();
    // Restart all timers on resume
    if (state.chunkManager) {
      state.chunkManager.startRegionCheck(500);
      state.chunkManager.startFlushTimer(5000);
    }
  }

  // Assigned to the returned function below. `onExit` tears down the very listeners
  // that reached it — `main.js` did this through a module `let` (`_cleanupPauseMenu`);
  // the binding is local now and the self-teardown is unchanged.
  let cleanup;

  const onExit = function() {
    // ── D-54 — flush and stop the session (see the header) ──
    // First, and guarded: everything below is teardown and must run even if the save
    // path throws. `stop()` saves the player, clears the dropped items, clears the 30 s
    // save interval and drains `state.teardowns` (D-50).
    try {
      state.game.stop();
    } catch (e) {
      console.warn('[Cuubz] game.stop() threw during exit-to-menu:', e && e.message);
    }

    // Stop the game loop
    state.game.running = false;
    state.game.paused = false;

    // Cancel render loop animation frame
    deps.stopRenderLoop();

    // Stop chunk manager timers and dispose resources
    if (state.chunkManager) {
      state.chunkManager.dispose();
    }

    // Exit pointer lock
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }

    // Hide in-game HUD overlays
    const hud = document.getElementById('hud');
    if (hud) hud.classList.add('hidden');
    const pauseMenuEl = document.getElementById('pause-menu');
    if (pauseMenuEl) pauseMenuEl.classList.add('hidden');
    const debugStatsEl = document.getElementById('debug-stats');
    if (debugStatsEl) debugStatsEl.classList.add('hidden');
    const craftingScreenEl = document.getElementById('crafting-screen');
    if (craftingScreenEl) craftingScreenEl.classList.add('hidden');
    const touchControlsEl = document.getElementById('touch-controls');
    if (touchControlsEl) touchControlsEl.classList.add('hidden');
    const crosshairEl = document.getElementById('crosshair');
    if (crosshairEl) crosshairEl.classList.add('hidden');
    const flyIndicatorEl = document.getElementById('fly-mode-indicator');
    if (flyIndicatorEl) flyIndicatorEl.classList.add('hidden');
    const connectionHudEl = document.getElementById('connection-hud');
    if (connectionHudEl) connectionHudEl.classList.add('hidden');
    const playerListOverlayEl = document.getElementById('player-list-overlay');
    if (playerListOverlayEl) playerListOverlayEl.classList.add('hidden');
    const armorIndicatorEl = document.getElementById('armor-indicator');
    if (armorIndicatorEl) armorIndicatorEl.classList.add('hidden');

    // Clean up Three.js renderer
    if (state.renderer) {
      const container = document.getElementById('game-container');
      if (container) container.innerHTML = '';
      if (state.renderer.renderer) {
        state.renderer.renderer.dispose();
      }
    }

    // ── Clean up multiplayer session ──
    if (state.session) {
      state.session.leaveSession();
    }

    // ── Clean up chunk streamer ──
    if (state.chunkStreamer) {
      state.chunkStreamer.stop();
      state.chunkStreamer.dispose();
      state.chunkStreamer = null;
    }

    // ── Clean up player sync ──
    // clearAll() disposes every remote-player mesh and clears the map
    // (playerSync.js:523-531) — that is the whole teardown. There was a
    // game.playerSync.reset() call here; PlayerSyncManager has no reset()
    // (it belongs to PingTracker, playerSync.js:103), so this threw on EVERY
    // exit — including solo, since playerSync is created whenever
    // sessionManager.client exists — skipping the six cleanup steps below and
    // showScreen('mainMenu'), which left the page blank. DEPLOY.md D-14.
    if (state.playerSync) {
      state.playerSync.clearAll();
      state.playerSync = null;
    }

    // ── Clean up player list HUD ──
    if (state.playerListHUD) {
      state.playerListHUD.destroy();
      state.playerListHUD = null;
    }

    // ── Clean up block interaction ──
    if (state.blockInteraction) {
      state.blockInteraction.dispose();
      state.blockInteraction = null;
    }

    // ── Clean up first-person hand ──
    if (state.firstPersonHand) {
      state.firstPersonHand.dispose();
      state.firstPersonHand = null;
    }

    // ── Clean up dropped items ──
    if (state.droppedItems) {
      state.droppedItems.clear();
      state.droppedItems = null;
    }

    // ── Clean up mob integration ──
    if (state.mobIntegration) {
      state.mobIntegration.destroy();
      state.mobIntegration = null;
    }

    // Clean up event listeners from this session
    if (typeof cleanup === 'function') {
      cleanup();
    }

    // Show main menu
    deps.showScreen('mainMenu');
    deps.log('[Cuubz] Exited to main menu');
  };

  const exitBtn = document.getElementById('btn-exit-menu');

  document.addEventListener('keydown', onPause);
  resumeBtn.addEventListener('click', resumeGame);
  if (exitBtn) exitBtn.addEventListener('click', onExit);

  // Settings: Region Check Interval (was Chunk Tick Interval)
  if (tickSlider && tickVal) {
    tickSlider.value = 500; // Default region check interval
    tickVal.textContent = tickSlider.value;
    tickSlider.addEventListener('input', () => {
      const val = parseInt(tickSlider.value);
      tickVal.textContent = val;
      if (state.chunkManager) {
        state.chunkManager.stopRegionCheck();
        state.chunkManager.startRegionCheck(val);
      }
    });
  }

  // Settings: Chunks Per Tick → now controls flush interval
  if (chunksSlider && chunksVal) {
    chunksSlider.value = 5; // Default flush interval in seconds
    chunksVal.textContent = chunksSlider.value + 's';
    chunksSlider.addEventListener('input', () => {
      const val = parseInt(chunksSlider.value);
      chunksVal.textContent = val + 's';
      if (state.chunkManager) {
        state.chunkManager.stopFlushTimer();
        state.chunkManager.startFlushTimer(val * 1000);
      }
    });
  }

  // ─── Pause Menu Performance Settings ─────────────────────
  // Sync UI with current settings on pause
  if (deps.perfSettings) deps.syncPerfSettingsUI();

  const pausePerfRenderDist = document.getElementById('pause-perf-render-distance');
  const pausePerfShadows = document.getElementById('pause-perf-shadows');
  const pausePerfTextureRes = document.getElementById('pause-perf-texture-res');
  const pausePerfAdvShading = document.getElementById('pause-perf-advanced-shading');

  if (pausePerfRenderDist && deps.perfSettings) {
    pausePerfRenderDist.addEventListener('change', () => {
      const val = parseInt(pausePerfRenderDist.value, 10);
      deps.perfSettings.set('renderDistance', val);
      deps.syncPerfSettingsUI();
      if (state.chunkManager) {
        state.chunkManager.setRenderDistance(val);
      }
    });
  }

  if (pausePerfShadows && deps.perfSettings) {
    pausePerfShadows.addEventListener('change', () => {
      const val = pausePerfShadows.value;
      deps.perfSettings.set('shadowQuality', val);
      deps.syncPerfSettingsUI();
      if (state.renderer) {
        state.renderer.setShadowQuality(val);
      }
    });
  }

  if (pausePerfTextureRes && deps.perfSettings) {
    pausePerfTextureRes.addEventListener('change', async () => {
      const val = pausePerfTextureRes.value;
      deps.perfSettings.set('textureResolution', val);
      deps.syncPerfSettingsUI();
      await deps.rebuildAtlasAndMaterials(state.renderer, state.chunkManager);
    });
  }

  if (pausePerfAdvShading && deps.perfSettings) {
    pausePerfAdvShading.addEventListener('change', async () => {
      const val = pausePerfAdvShading.checked;
      deps.perfSettings.set('advancedShading', val);
      deps.syncPerfSettingsUI();
      await deps.rebuildAtlasAndMaterials(state.renderer, state.chunkManager);
    });
  }

  // Pause Time of Day checkbox
  const pauseTimeCheckbox = document.getElementById('pause-pause-time');
  if (pauseTimeCheckbox && state.skybox) {
    pauseTimeCheckbox.checked = !state.skybox.timePaused; // checked = time running
    pauseTimeCheckbox.addEventListener('change', () => {
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
    });
  }

  // Return cleanup function so listeners can be removed on exit or re-init
  cleanup = function cleanupPauseMenu() {
    document.removeEventListener('keydown', onPause);
    resumeBtn.removeEventListener('click', resumeGame);
    if (exitBtn) exitBtn.removeEventListener('click', onExit);
  };
  return cleanup;
}
