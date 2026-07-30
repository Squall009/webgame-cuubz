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
 * §4.2 shape without duplicating state. **PR 17 rewrites `Game.js` and absorbs this
 * object**; at that point the getters become fields and `state.game` goes away.
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
    this.persistence = null;

    // ── Gameplay systems ──────────────────────────────────────────────────
    this.inventory = null;
    this.crafting = null;
    this.blockInteraction = null;
    this.droppedItems = null;

    // ── Multiplayer ───────────────────────────────────────────────────────
    this.playerSync = null;
    this.playerListHUD = null;
    this.chunkStreamer = null;

    // ── UI state and the two UI callbacks the render loop drives ──────────
    //
    // `inventoryOpen` is the D-31 variable. It was a `let` inside `startGame`'s closure,
    // which is why the Escape handler's `typeof inventoryOpen !== 'undefined'` guard was
    // permanently false and Escape never closed the inventory. It lives here now and the
    // handler reads it through `state`.
    this.inventoryOpen = false;
    this.toggleInventoryScreen = null;
    this.updateHotbarUI = null;

    // ── Per-frame counters, folded in from `game.*` ───────────────────────
    //
    // `frameCount` was assigned 0 and never incremented (BUGS.md D-34), so every
    // `frameCount % N === 0` throttle in the render loop was permanently true. The
    // render loop increments it now.
    this.frameCount = 0;
    this.attackCooldown = 0;
    this.shadowMissingCount = 0;
    this.noPbrCount = 0;

    // ── §4.2 shape ────────────────────────────────────────────────────────
    // `stats` is written by `updateDebugStats`; `systems` is the registry PR 20's
    // `System` base class and PR 18's `SystemRunner` populate. Empty until then.
    this.stats = { fps: 0, activeChunks: 0, dirtyCount: 0 };
    this.systems = new Map();
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
