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

  // Scroll wheel for hotbar cycling
  const gameWheelHandler = function(e) {
    if (game.paused || !game.running) return;
    if (state.inventoryOpen) return; // Don't cycle when inventory is open
    state.inventory.cycleSelection(e.deltaY > 0 ? 1 : -1);
    state.updateHotbarUI();
  };
  document.addEventListener('wheel', gameWheelHandler);
  state.addTeardown(() => document.removeEventListener('wheel', gameWheelHandler));

  // ─── Periodic Save (every 30 seconds) ──────────
  state.saveIntervalId = setInterval(() => {
    if (!game.paused && game.running) {
      game.savePlayerState();
    }
  }, 30000);

  // Save when pausing (Escape key)
  const saveOnPause = function(e) {
    if (e.key === 'Escape' && !game.paused) {
      game.savePlayerState();
    }
  };
  document.addEventListener('keydown', saveOnPause);
  state.addTeardown(() => document.removeEventListener('keydown', saveOnPause));

  // Start game loop
  game.loadingStatus.textContent = 'Almost ready...';
  if (game.loadingProgress) game.loadingProgress.style.width = '100%';
}
