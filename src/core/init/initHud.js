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
 * **These listeners are added on every `startGame()` and nothing removes them** —
 * `BUGS.md` **D-50**, owned by PR 18. The stale ones are inert because they guard on a
 * `Game` whose `running` is `false`, but they accumulate one set per session.
 */

/**
 * @param {import('../Game.js').Game} game
 */
export function initHud(game) {
  const state = game.state;

  // ─── Keyboard Shortcuts ────────────────────────
  document.addEventListener('keydown', function gameKeyHandler(e) {
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
  });

  // Scroll wheel for hotbar cycling
  document.addEventListener('wheel', function gameWheelHandler(e) {
    if (game.paused || !game.running) return;
    if (state.inventoryOpen) return; // Don't cycle when inventory is open
    state.inventory.cycleSelection(e.deltaY > 0 ? 1 : -1);
    state.updateHotbarUI();
  });

  // ─── Periodic Save (every 30 seconds) ──────────
  state.saveIntervalId = setInterval(() => {
    if (!game.paused && game.running) {
      game.savePlayerState();
    }
  }, 30000);

  // Save when pausing (Escape key)
  document.addEventListener('keydown', function saveOnPause(e) {
    if (e.key === 'Escape' && !game.paused) {
      game.savePlayerState();
    }
  });

  // Start game loop
  game.loadingStatus.textContent = 'Almost ready...';
  if (game.loadingProgress) game.loadingProgress.style.width = '100%';
}
