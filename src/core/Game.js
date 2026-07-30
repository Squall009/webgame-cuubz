/**
 * Cuubz — `Game` (PR 17)
 *
 * ─── WHAT THIS IS ───────────────────────────────────────────────────────────
 *
 * `refactor.md` §8.4: *`startGame()` → `src/core/Game.js`*. `startGame` was
 * `src/main.js:321–2214` — **1,894 lines, 58% of the file** — and it is `init(mode)`
 * below plus the nine modules under `./init/`.
 *
 * ─── DECISION 34: THIS CLASS ABSORBED THE PHASE-0 ONE ────────────────────────
 *
 * §8.4 says *"`core/Game.js` is a rewrite; `js/game.js` (280 lines, stub) is absorbed or
 * deleted"*, and `PR16_HANDOFF.md` §4.4 asked which. **Absorbed.** The Phase-0 class
 * owned `running` / `paused` / `mode` / `lastTime` / `delta`, `player`, a `BlockPalette`
 * and `start` / `stop` / `setMode` / `isCreative` / `isSurvival` / `canPlaceBlock`; every
 * one of those is still here, unchanged, because the render loop, the pause menu and
 * `test_creativeMode.js` all read them. Deleting it was never an option and running two
 * `Game`s side by side is what `startGame` was already doing — `new CuubzGame()` at step
 * 8, with a `GameState` beside it.
 *
 * So `state.game === game` and `game.state === state`. `GameState`'s `isRunning` /
 * `isPaused` / `mode` / `delta` getters still read through to the fields here; nothing
 * is duplicated.
 *
 * **`Game.update()` is deleted.** It was the Phase-0 stub's own `requestAnimationFrame`
 * loop, with every system call commented out, and **nothing has ever called it**. Leaving
 * it on the class that now runs the real init is how a second rAF loop gets started by
 * accident — `PR16_HANDOFF.md` §4.4 flagged exactly that. `BUGS.md` **D-53**.
 *
 * ─── THE FIFTEEN STEPS ──────────────────────────────────────────────────────
 *
 * `init()` calls them in the order `main.js`'s banners had, which is the order the code
 * ran in and **is the authority** (`BUGS.md` D-36). Three couplings are load-bearing and
 * each is restated in the file that owns it:
 *
 *   • the texture atlases (4) exist before anything draws an item icon;
 *   • the spawn search (8) reads `chunkManager.memoryCache`, so it cannot move above 7;
 *   • the mob system (9) is constructed before the inventory and handed it at 13 — the
 *     `inventory: null` in its deps is that, not an oversight.
 *
 * ─── THE INIT-ONLY LOCALS ───────────────────────────────────────────────────
 *
 * Decision 23: the fifteen steps shared ~160 locals PR 12 deliberately did not hoist, and
 * PR 17 is where they move. The rule is `GameState` for anything that outlives the init
 * or that the render loop reads; a **declared** field here for the init-only ones
 * (`container`, `loadingStatus`, `loadingProgress`, `isJoiningClient`, `requestedMode`);
 * and a plain local for anything one step uses. They are declared in the constructor for
 * the same reason `GameState`'s are — an object whose shape is discovered by reading
 * assignment sites is what `game.*` already was.
 */

import { GameState } from './GameState.js';
import { BlockPalette } from './BlockPalette.js';
import { CuubzLogger } from '../util/Logger.js';

import { initScene } from './init/initScene.js';                   // steps 1–5
import { initSkybox } from './init/initSkybox.js';                 // step 6
import { initWorld } from './init/initWorld.js';                   // step 7
import { initPlayer } from './init/initPlayer.js';                 // step 8
import { initMobs } from './init/initMobs.js';                     // steps 9–10
import { initPlayerSync } from './init/initPlayerSync.js';         // step 11a
import { initChunkStreaming } from './init/initChunkStreaming.js'; // step 11b
import { initInventory } from './init/initInventory.js';           // steps 12–13
import { initHud } from './init/initHud.js';                       // step 14

// Debug logging — set CuubzLogger.DEBUG = true in console to enable
export var _gameLog;
if (typeof CuubzLogger !== 'undefined') { _gameLog = CuubzLogger.log; } else { _gameLog = function() {}; }

// ============================================================
// Mode Constants
// ============================================================

export const MODES = {
  SURVIVAL: 'survival',
  CREATIVE: 'creative',
};

// `BlockPalette` moved to its own file in PR 17 (the 400-line ceiling), and is
// re-exported so `require('../src/core/Game.js').BlockPalette` keeps resolving.
export { BlockPalette };

// ============================================================
// Main Game Class
// ============================================================

export class Game {
  /**
   * @param {object} [deps] — live accessors for the things `init()` needs from the
   *   bootstrap: `ui`, `characterManager`, `worldManager`, `perfSettings`,
   *   `sessionManager`, `log`, plus the four session hooks (`onSessionStart`,
   *   `setupPauseMenu`, `startRenderLoop`, `cancelRenderLoop`). Every manager is read
   *   through a **getter** because all of them are `null` when the menu is built —
   *   decision 27. Defaults to `{}` so `new Game()` still works for the unit tests.
   */
  constructor(deps = {}) {
    this.deps = deps;

    // ── Lifecycle (the Phase-0 class's four, unchanged) ───────────────────
    this.running = false;
    this.paused = false;
    this.mode = MODES.SURVIVAL; // Default to survival mode
    this.lastTime = 0;
    this.delta = 0;

    // Player reference (set at step 8)
    this.player = null;

    // Block palette for creative mode
    this.blockPalette = new BlockPalette();

    // Callback system
    this.onModeChange = null;

    // ── The session's state ───────────────────────────────────────────────
    this.state = new GameState();
    this.state.game = this;

    // ── Init-only scratch, declared rather than grown ─────────────────────
    /** @type {HTMLElement} `#game-container`; step 1 empties it and the renderer fills it. */
    this.container = null;
    /** @type {HTMLElement} `#loading-status` — every step writes its caption here. */
    this.loadingStatus = null;
    /** @type {HTMLElement} `#loading-progress` — the bar, widened step by step. */
    this.loadingProgress = null;
    /** The mode `init()` was asked for, before `setMode()` has run. */
    this.requestedMode = null;
    /** In a session, not hosting it. Step 7 computes it; step 8 reads it. */
    this.isJoiningClient = false;
    /** Session teardown, installed by `init()`; run by `stop()`. */
    this._onStop = null;
  }

  // ============================================================
  // Init — the fifteen steps
  // ============================================================

  /**
   * Start a session. Returns when the render loop has been started, or early if there
   * is no character or no world selected.
   *
   * **Nothing awaits this.** The menu handlers and the auto-rejoin path both call it and
   * move on, exactly as they did when a `setTimeout` wrapper made it return immediately.
   * The `try/catch` around the body is therefore load-bearing rather than decorative:
   * without it a throw in here is an unhandled rejection instead of the loading-screen
   * error message.
   *
   * @param {string} mode — `'survival'` | `'creative'`
   */
  async init(mode) {
    const deps = this.deps;
    const log = deps.log || _gameLog;
    this.requestedMode = mode;
    log(`[Cuubz] Starting game in ${mode} mode...`);

    const selected = deps.characterManager ? deps.characterManager.getSelectedCharacter() : null;
    if (!selected) {
      console.warn('[Cuubz] No character selected!');
      deps.ui.show('characterScreen');
      return;
    }

    log(`[Cuubz] Playing as: ${selected.name} (${selected.color})`);

    // Show loading screen
    deps.ui.show('loadingScreen');
    this.loadingStatus = document.getElementById('loading-status');
    this.loadingProgress = document.getElementById('loading-progress');

    // Get selected world
    const currentWorld = deps.worldManager ? deps.worldManager.getSelectedWorld() : null;
    if (!currentWorld) {
      console.warn('[Cuubz] No world selected!');
      deps.ui.show('worldScreen');
      return;
    }

    this.loadingStatus.textContent = 'Initializing renderer...';
    if (this.loadingProgress) this.loadingProgress.style.width = '10%';

    // The 200 ms is real behaviour — it is what gives the loading screen a paint before
    // the WebGL context is created. PR 13 established that; it is not scaffolding.
    await new Promise((resolve) => setTimeout(resolve, 200));

    try {
      this.state.currentWorld = currentWorld;
      this.state.currentCharacter = selected;
      // The bootstrap takes its handle on the session here — the same point at which
      // `main.js` used to do `gameState = new GameState()`.
      if (deps.onSessionStart) deps.onSessionStart(this);

      await initScene(this);          // 1 screens  2 renderer  3 input  4 atlases  5 PBR
      initSkybox(this);               // 6
      await initWorld(this);          // 7
      await initPlayer(this);         // 8
      initMobs(this);                 // 9 mobs   10 first-person hand
      initPlayerSync(this);           // 11a
      initChunkStreaming(this);       // 11b
      initInventory(this);            // 12 block interaction   13 inventory + systems
      initHud(this);                  // 14
      await this._startRenderLoop();  // 15

      log('[Cuubz] Game started successfully in ' + mode + ' mode');
    } catch (err) {
      console.error('[Cuubz] Game init failed:', err);
      this.loadingStatus.textContent = 'Error: ' + err.message;
      log('[Cuubz] Game init error:', err.stack);
    }
  }

  /** Step 15 — the collision shim, the second sleep, and the loop itself. */
  async _startRenderLoop() {
    const state = this.state;
    const deps = this.deps;
    const chunkManager = state.chunkManager;

    // Create a simple world-like object for collision detection.
    state.chunkWorld = {
      getBlockAtWorld: function(bx, by, bz) {
        return chunkManager.getVoxel(Math.floor(bx), Math.floor(by), Math.floor(bz));
      }
    };

    // The 500 ms that lets the last of the init settle before the render loop starts
    // taking the frame budget. Behaviour, like the 200 ms above (PR 13).
    await new Promise((resolve) => setTimeout(resolve, 500));

    this.start(this.requestedMode);
    // Show HUD (contains hotbar) when game starts
    const hud = document.getElementById('hud');
    if (hud) hud.classList.remove('hidden');

    // Cancel any old render loop from a previous session before starting fresh.
    if (deps.cancelRenderLoop) deps.cancelRenderLoop();

    // ─── Wire up Pause Menu & Settings ────────────
    if (deps.setupPauseMenu) deps.setupPauseMenu(state);

    this.lastTime = performance.now();
    if (deps.startRenderLoop) deps.startRenderLoop(state);

    // The e2e harness drives block placement through this handle — it is the reason
    // test/e2e/saveLoad.js can assert a *player edit* round-trips, rather than only
    // generated terrain. It arrives through `deps` rather than as an import because
    // `src/testBridge.js` assigns `window.__cuubz` at module top level, and
    // `test_creativeMode.js` / `test_crafting.js` `require` this file in **Node**.
    if (deps.publishGameState) deps.publishGameState(state);
  }

  /**
   * Persist the selected character's inventory, equipment and spawn point.
   *
   * Called every 30 s, on Escape, and from `stop()` — `DEPLOY.md` §7. It re-reads the
   * selected character rather than using `state.currentCharacter`, exactly as the
   * `startGame` closure did.
   */
  savePlayerState() {
    const state = this.state;
    const deps = this.deps;
    const selected = deps.characterManager ? deps.characterManager.getSelectedCharacter() : null;
    if (!selected) return;

    // Save inventory
    const serialized = state.inventory.serialize();
    selected.inventory = serialized.slots;
    selected.equipment = serialized.equipment;

    // Save spawn point
    selected.spawnPoints = selected.spawnPoints || {};
    selected.spawnPoints[state.currentWorld.id] = {
      x: state.player.position.x,
      y: state.player.position.y,
      z: state.player.position.z,
    };

    // D-37: was `characterManager.persistence.saveCharacter(...)`. `state.persistence` is
    // the same object and is set at step 8; reading it here is what keeps that field honest.
    if (!state.persistence) return;
    state.persistence.saveCharacter(selected);
    (deps.log || _gameLog)('[Cuubz] Saved player state');
  }

  // ============================================================
  // Lifecycle — unchanged from the Phase-0 class
  // ============================================================

  /**
   * Start the game loop in the specified mode.
   * @param {string} mode — 'survival' or 'creative'
   */
  start(mode) {
    if (mode) {
      this.setMode(mode);
    }
    this.running = true;
    this.lastTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    _gameLog(`[Game] Started in ${this.mode} mode`);
  }

  /**
   * Stop the game loop.
   *
   * `main.js` wrapped this with `game.stop = function() { savePlayerState();
   * droppedItems.clear(); clearInterval(saveIntervalId); origStop(); }` at step 14 — a
   * monkey-patch, because the teardown lived in a closure the class could not see. It is
   * a branch on session state now, and it runs **before** `running` goes false, exactly
   * as the wrapper did. `game.stop()` is what flushes player state (`DEPLOY.md` §7).
   */
  stop() {
    const state = this.state;
    if (state.inventory && state.player) this.savePlayerState();
    if (state.droppedItems) state.droppedItems.clear();
    if (state.saveIntervalId !== null) {
      clearInterval(state.saveIntervalId);
      state.saveIntervalId = null;
    }
    if (this._onStop) this._onStop();
    this.running = false;
    _gameLog('[Game] Stopped');
  }

  /**
   * Set the game mode, applying physics changes to the player.
   * @param {string} mode — 'survival' or 'creative'
   */
  setMode(mode) {
    if (mode === this.mode) return; // No change

    const oldMode = this.mode;

    if (mode !== MODES.SURVIVAL && mode !== MODES.CREATIVE) {
      console.warn(`[Game] Invalid mode: ${mode}. Keeping current mode: ${this.mode}`);
      return;
    }

    this.mode = mode;

    // Apply mode-specific changes to player
    if (this.player && typeof this.player.setCreativeMode === 'function') {
      this.player.setCreativeMode(this.isCreative());
    }

    // Fire callback
    if (this.onModeChange) {
      this.onModeChange(this.mode, oldMode);
    }

    _gameLog(`[Game] Mode changed: ${oldMode} → ${this.mode}`);
  }

  /**
   * Check if game is in creative mode.
   * @returns {boolean}
   */
  isCreative() {
    return this.mode === MODES.CREATIVE;
  }

  /**
   * Check if game is in survival mode.
   * @returns {boolean}
   */
  isSurvival() {
    return this.mode === MODES.SURVIVAL;
  }

  /**
   * Check if a block can be placed in the current mode.
   * In creative mode: always true (unlimited blocks).
   * In survival mode: depends on inventory having the block.
   *
   * @param {number} blockId — Block type ID to place
   * @param {object} inventory — Current inventory (survival only)
   * @returns {boolean} Whether the block can be placed
   */
  canPlaceBlock(blockId, inventory) {
    if (this.isCreative()) {
      return true; // Unlimited blocks in creative mode
    }

    // Survival mode: check inventory
    if (!inventory) return false;
    if (typeof inventory.hasItem === 'function') {
      return inventory.hasItem(blockId);
    }

    // Fallback: manual slot check
    for (const slot of inventory.slots || []) {
      if (slot && slot.typeId === blockId && slot.count > 0) {
        return true;
      }
    }
    return false;
  }
}

// Attach constants to class for static access
Game.MODES = MODES;
Game.BlockPalette = BlockPalette;
