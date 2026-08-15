/**
 * Cuubz — `Game.init()` step 14 (PR 17)
 *
 * Keyboard shortcuts (hotbar numbers, `E`), the scroll-wheel hotbar cycle, the 30 s
 * periodic save and the save-on-Escape.
 *
 * **The save cadence is documented behaviour**, not an implementation detail:
 * `DEPLOY.md` §7's timing table says player state saves every 30 s, on Escape and on
 * `game.stop()`. All three are wired here or in `Game.stop()`.
 *
 * **D-50 — CLOSED IN PR 18.** These three listeners used to be added on every
 * `startGame()` with nothing removing them, so they accumulated one set per session
 * (inert, because each guards on a `Game` whose `running` is `false`, but accumulating).
 * Each is a named `const` now and each registers its own `removeEventListener` through
 * `state.addTeardown()`, which `Game.stop()` drains on exit-to-menu. The 30 s interval
 * below was already cleared by `Game.stop()` — and D-54 is what gives `stop()` a caller.
 */

/**
 * @param {import('../Game.js').Game} game
 */
export function initHud(game) {
  const state = game.state;

  // ─── Keyboard Shortcuts ────────────────────────
  const gameKeyHandler = function(e) {
    if (game.paused || !game.running) return;

    // Number keys 1-9 for hotbar selection
    if (e.key >= '1' && e.key <= '9') {
      e.preventDefault();
      state.inventory.selectByNumber(parseInt(e.key));
      state.updateHotbarUI();
    }

    // E for inventory + crafting screen
    if (e.key === 'e' || e.key === 'E') {
      e.preventDefault();
      state.toggleInventoryScreen();
    }
  };
  document.addEventListener('keydown', gameKeyHandler);
  state.addTeardown(() => document.removeEventListener('keydown', gameKeyHandler));

  // ─── D-55: the scroll-wheel hotbar cycle is NOT registered here ───────────
  //
  // A `document`-level `wheel` listener used to live here and call
  // `state.inventory.cycleSelection()`. `Mouse.js`'s canvas `wheel` handler accumulates
  // `scrollDelta`, which `WorldStep.js` consumes with a second `cycleSelection()` — and a
  // wheel event over the canvas bubbles to `document`, so **both fired and the hotbar
  // advanced two slots per notch**. Neither was a no-op: only the loop path clears
  // `scrollDelta`.
  //
  // PR 20 kept the loop path and deleted this one. `Mouse.scrollDelta` is the input
  // abstraction and `WorldStep.js` is where §9 (formerly PR 22) wants per-frame logic;
  // a raw `document` listener in an init step is neither. The one thing this listener had
  // that the loop path lacked — `if (state.inventoryOpen) return;`, without which
  // scrolling with the inventory open cycled the hotbar behind it — moved to
  // `WorldStep.js` with the rest.
  //
  // The teardown registration went with the listener. See `src/engine/loop/steps/WorldStep.js`.

  // ─── Periodic Save (every 30 seconds) ──────────
  //
  // Quest state rides the same timer (§5.1). It is a *separate* call rather than a line
  // inside `savePlayerState` because the two write different objects to different keys
  // with different owners — see `src/core/saveWorldState.js`.
  state.saveIntervalId = setInterval(() => {
    if (!game.paused && game.running) {
      game.savePlayerState();
      game.saveWorldState();
    }
  }, 30000);

  // Save when pausing (Escape key)
  const saveOnPause = function(e) {
    if (e.key === 'Escape' && !game.paused) {
      game.savePlayerState();
      game.saveWorldState();
    }
  };
  document.addEventListener('keydown', saveOnPause);
  state.addTeardown(() => document.removeEventListener('keydown', saveOnPause));

  // Start game loop
  game.loadingStatus.textContent = 'Almost ready...';
  if (game.loadingProgress) game.loadingProgress.style.width = '100%';
}
