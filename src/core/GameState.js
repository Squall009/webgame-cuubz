/**
 * Cuubz — GameState (PR 12)
 *
 * ─── WHAT THIS IS FOR ───────────────────────────────────────────────────────
 *
 * `refactor.md` §1.6 is the constraint this file exists to remove. `startGame()` wraps
 * its whole body in `setTimeout(async () => { try { … } })`, and `renderLoop` was declared
 * *inside* that closure, reading two dozen of its locals — `renderer`, `chunkManager`,
 * `player`, `inventory`, `skybox`, `blockInteraction`, … — directly by name. A closure
 * local has no address: you cannot pass it, you cannot read it from another function, and
 * you cannot move the function that reads it into another file. Phase 3 moves `renderLoop`
 * to `src/engine/loop/RenderLoop.js` (§13), so every one of those reads had to become a
 * property of something first.
 *
 * That something is this object. One instance per session, created at the top of
 * `startGame()`'s body and handed to `renderLoop`, `updateDebugStats` and `setupPauseMenu`
 * as their only argument. **`renderLoop` now sits at `main.js`'s top level** — outside
 * `startGame` entirely — which is the PR 12 acceptance criterion made structural rather
 * than asserted: it *cannot* reference a `startGame` local, because none is in scope.
 *
 * ─── HOW IT RELATES TO THE `Game` INSTANCE ──────────────────────────────────
 *
 * `src/core/Game.js` (`CuubzGame`) is a Phase-0-era stub that owns exactly four things:
 * `running`, `paused`, `mode` and the `delta`/`lastTime` pair. Everything else that had
 * accumulated on it — `game.chunkManager`, `game.renderer`, `game.skybox`,
 * `game.frameCount`, `game.attackCooldown`, `game._shadowMissingCount`, `game._noPbrCount`
 * and nine more — was ad-hoc: assigned from `startGame` because there was nowhere else to
 * put it. Those move here. `refactor.md` §7 PR 12 calls that "fold the ad-hoc props in".
 *
 * The four lifecycle fields **do not move**. `Game.start()` / `stop()` / `setMode()` write
 * them and `setMode()` also pushes creative-mode physics onto the player, so copying them
 * here would create two sources of truth for "is the game running" — the exact failure this
 * whole phase is unpicking. Instead `state.game` holds the instance and `isRunning` /
 * `isPaused` / `mode` / `delta` are **getters that read through to it**. That satisfies the
 * §4.2 shape without duplicating state.
 *
 * **PR 17 update.** `state.game` is now the *same* `Game` that ran `init()` — the
 * Phase-0-era stub and the orchestrator §8.4 asks for are one class (decision 34), so
 * `game.state === state` and `state.game === game`. The getters stay exactly as they
 * were: `running` / `paused` / `mode` / `delta` are still owned by one object and read
 * from the other, and nothing here duplicates them.
 *
 * ─── THE FIELDS ARE DECLARED, NOT GROWN ─────────────────────────────────────
 *
 * Every property is listed in the constructor with its initial value, even the ones that
 * stay `null` in single-player. That is deliberate: an object whose shape is discovered by
 * reading assignment sites scattered over 1,800 lines is what `game.*` already was. Two
 * of the folded-in counters (`shadowMissingCount`, `noPbrCount`) were read through
 * `typeof game._x === 'undefined'` guards precisely because nothing declared them; the
 * guards are gone because the declaration is here. **Do not add a property by assigning to
 * it from `main.js`** — declare it here, so the render loop's dependencies stay countable.
 * (This is unrelated to the 28 cross-module `typeof` guards in `BUGS.md` D-27, which are
 * PR 33's and are untouched.)
 */

export class GameState {
  constructor() {
    // ── Lifecycle owner ───────────────────────────────────────────────────
    // The CuubzGame instance. Holds running/paused/mode/delta/lastTime and nothing
    // else; see the header for why those four did not move here. PR 17 absorbs it.
    this.game = null;

    // ── Renderer and visual systems ───────────────────────────────────────
    this.renderer = null;
    this.textureAtlas = null;
    this.itemAtlas = null;
    this.skybox = null;
    this.biomeEffects = null;
    this.firstPersonHand = null;
    // PR 18 — the eye-level camera position for the current frame. `ViewStep` assigns a
    // **fresh** `THREE.Vector3` here every frame (it was a `const` in the old one-function
    // loop, main.js:494) and `WorldStep` reads it for `biomeEffects.setCameraPosition`
    // (main.js:717). Declared, not grown — see the header.
    this.camPos = null;

    // ── Input ─────────────────────────────────────────────────────────────
    this.keyboard = null;
    this.mouse = null;
    this.touch = null;
    this.canvas = null;
    this.sensitivity = 0.002;

    // ── World and player ──────────────────────────────────────────────────
    this.chunkManager = null;
    this.player = null;
    // Minimal `getBlockAtWorld` shim the Player and mob systems use for collision.
    this.chunkWorld = null;
    this.spawnHeight = 0;
    this.worldName = null;
    this.currentWorld = null;
    this.currentCharacter = null;
    // The storage backend (`PersistenceManager`) the character and world managers were
    // constructed with. `savePlayerState()` writes the periodic character save through
    // this handle. It was `undefined` for the whole of PR 12 and PR 13 — BUGS.md **D-37**,
    // closed in PR 14 when the `storage` / `persistence` field-name split went away with
    // the duplicate managers.
    this.persistence = null;

    // ── Gameplay systems ──────────────────────────────────────────────────
    this.inventory = null;
    this.crafting = null;
    this.blockInteraction = null;
    this.droppedItems = null;
    // PR 17 — was a `main.js` top-level `let` that `startGame()` assigned and the render
    // loop, the mob attack path and the pause menu's exit handler all read by name.
    this.mobIntegration = null;

    // ── Multiplayer ───────────────────────────────────────────────────────
    // PR 18 — the live `SessionManager`. The render loop read a `main.js` module `let`
    // called `sessionManager` at nine points (main.js:443, 444, 603, 625–627, 639, 642,
    // 647); those are `state.session` now. `Game.init()` sets it once, at the top, from
    // `deps.sessionManager` — it is always assigned before a session starts and never
    // reassigned during one. Declared, not grown — see the header.
    this.session = null;
    this.playerSync = null;
    this.playerListHUD = null;
    this.chunkStreamer = null;
    // PR 17 — was a `startGame()` local. Nothing outside step 13 reads it today; it is
    // declared here rather than left on the `Game` instance because it owns a live
    // `setInterval` (`startPeriodicSync`) that a teardown will have to find. See D-50.
    this.inventorySync = null;

    // ── UI state and the two UI callbacks the render loop drives ──────────
    //
    // `inventoryOpen` is the D-31 variable. It was a `let` inside `startGame`'s closure,
    // which is why the Escape handler's `typeof inventoryOpen !== 'undefined'` guard was
    // permanently false and Escape never closed the inventory. It lives here now and the
    // handler reads it through `state`.
    this.inventoryOpen = false;
    this.toggleInventoryScreen = null;
    this.updateHotbarUI = null;
    // PR 17 — the inventory/crafting DOM moved to `src/ui/hud/Hotbar.js`,
    // `src/ui/overlays/InventoryScreen.js` and `src/ui/overlays/InventoryDrag.js`. Those
    // three call each other (a slot change repaints the grid, a craft repaints the
    // hotbar) and they used to be sibling closures inside `startGame`. They reach each
    // other through these fields now, which is the same thing the two above already did
    // for the render loop — and it keeps the wiring countable instead of implicit.
    this.renderItemIcon = null;
    this.renderInventoryCraftingUI = null;

    // ── The periodic save (PR 17) ─────────────────────────────────────────
    // `setInterval` id for the 30 s character save. `Game.stop()` clears it; it is a
    // field rather than a closure local because the teardown and the setup now live in
    // different files. DEPLOY.md §7 has the timing table.
    this.saveIntervalId = null;

    // ── Per-frame counters, folded in from `game.*` ───────────────────────
    //
    // `frameCount` was assigned 0 and never incremented (BUGS.md D-34), so every
    // `frameCount % N === 0` throttle in the render loop was permanently true. The
    // render loop increments it now.
    this.frameCount = 0;
    this.attackCooldown = 0;
    this.shadowMissingCount = 0;
    this.noPbrCount = 0;

    // ── Session teardown (PR 18) ──────────────────────────────────────────
    //
    // `BUGS.md` **D-50**: eight listeners were added on every `startGame()` and nothing
    // removed them, so a player who exited to the menu and started again carried a
    // second set closing over the *previous* `GameState`. They were inert — each guards
    // on a `Game` whose `running` is false, or on an `inventoryOpen` that stays false —
    // but they accumulated one set per session, along with the 30 s save interval.
    //
    // Every `addEventListener` an init step makes for the session pushes its remover
    // here through `addTeardown()`, and `Game.stop()` drains it through
    // `runTeardowns()` — i.e. on exit-to-menu, which is exactly when the session ends.
    // The pause menu's own `keydown` is **not** in here: it has to keep working while
    // the game is paused, and `setupPauseMenu`'s returned cleanup already owns it.
    //
    // Declared, not grown — see the header.
    /** @type {Array<function():void>} */
    this.teardowns = [];

    // ── §4.2 shape ────────────────────────────────────────────────────────
    // `stats` is written by `updateDebugStats`; `systems` is the registry PR 20's
    // `System` base class and PR 18's `SystemRunner` populate. Empty until then.
    this.stats = { fps: 0, activeChunks: 0, dirtyCount: 0 };
    this.systems = new Map();
  }

  /**
   * Register one session-scoped teardown — in practice a `removeEventListener` call
   * bound to the **same function reference** that was added. D-50.
   * @param {function():void} fn
   */
  addTeardown(fn) {
    if (typeof fn === 'function') this.teardowns.push(fn);
  }

  /**
   * Run every registered teardown and empty the list. Called by `Game.stop()` and
   * nowhere else. `splice(0)` empties first, so a throw in one remover cannot leave
   * the rest queued for a second `stop()`, and a teardown that registers another is
   * not lost.
   */
  runTeardowns() {
    for (const fn of this.teardowns.splice(0)) {
      try {
        fn();
      } catch (e) {
        console.warn('[GameState] teardown failed:', e && e.message);
      }
    }
  }

  /** `'survival'` | `'creative'` — owned by the `Game` instance, read through. */
  get mode() {
    return this.game ? this.game.mode : 'survival';
  }

  get isRunning() {
    return !!(this.game && this.game.running);
  }

  get isPaused() {
    return !!(this.game && this.game.paused);
  }

  /** Seconds since the previous frame, clamped by the render loop. */
  get delta() {
    return this.game ? this.game.delta : 0;
  }
}
