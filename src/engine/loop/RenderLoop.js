/**
 * Cuubz — the render loop (PR 18)
 *
 * `src/main.js:363–846` — `renderLoop(state)`, the `_renderRafId` `let` it wrote, and
 * the two `gameDeps` hooks (`startRenderLoop` / `cancelRenderLoop`) that drove it.
 * `refactor.md` §8.5 and §13.
 *
 * ─── WHAT THIS CLASS OWNS ───────────────────────────────────────────────────
 *
 * The frame's envelope, and nothing in its middle:
 *
 *   • the rAF handle — a field here rather than a `main.js` module `let`, which is what
 *     makes `stop()` something the pause menu can call rather than a closure that has to
 *     be handed down through `gameDeps`;
 *   • the two early-outs (`!running` → return, `paused` → draw and return);
 *   • the delta and the attack-cooldown decay (`_beginFrame`);
 *   • the debug overlay and `state.frameCount++`.
 *
 * Everything between the cooldown decay and the overlay is `SystemRunner`'s six steps,
 * in the order `main.js` ran them. See `SystemRunner.js` for the order and the four
 * couplings that make it load-bearing.
 *
 * ─── `_beginFrame` IS A SPLIT, NOT A CHANGE ─────────────────────────────────
 *
 * main.js:397–405 ran inline in the loop body. It is a private method purely so
 * `_frame` stays readable at a glance; it is called from exactly one place, at exactly
 * the point the two statements used to sit.
 */

import { runSystems } from './SystemRunner.js';
import { updateDebugStats } from '../../ui/hud/DebugStats.js';

export class RenderLoop {
  constructor() {
    /** @type {?number} The live `requestAnimationFrame` handle — `main.js`'s `_renderRafId`. */
    this._rafId = null;
  }

  /**
   * Schedule the first frame. `Game._startRenderLoop()` calls this through
   * `deps.startRenderLoop`, after its 500 ms settle sleep.
   * @param {import('../../core/GameState.js').GameState} state
   */
  start(state) {
    this._rafId = requestAnimationFrame(() => this._frame(state));
  }

  /**
   * Cancel the pending frame. Called before a new session starts and from the pause
   * menu's exit handler.
   */
  stop() {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  /**
   * One frame.
   * @param {import('../../core/GameState.js').GameState} state
   */
  _frame(state) {
    // Always schedule the next frame first, so a throw below cannot stop the loop.
    this._rafId = requestAnimationFrame(() => this._frame(state));
    if (!state.game.running) return;

    // When paused, just render the scene (don't update game logic)
    if (state.game.paused) {
      state.renderer.render();
      return;
    }

    this._beginFrame(state);
    runSystems(state);

    // ─── Debug Stats Overlay Update ──────────────
    updateDebugStats(state);

    // BUGS.md D-34 — this increment did not exist. `frameCount` was set to 0 once in
    // startGame() and never touched again, so every `frameCount % N === 0` throttle
    // above was permanently true and every `frameCount < 10` rate limit never expired.
    // Counting at the END of the frame rather than the start keeps frame 0 doing a full
    // pass of all six throttled paths, which is what they did before this line existed —
    // the first hotbar render, the first TIME_SYNC and the first sendMove still happen
    // immediately rather than 5, 30 and 3 frames in.
    state.frameCount++;
  }

  /**
   * main.js:397–405 — the clamped delta and the attack-cooldown decay, in that order.
   * @param {import('../../core/GameState.js').GameState} state
   */
  _beginFrame(state) {
    const now = performance.now();
    state.game.delta = Math.min((now - state.game.lastTime) / 1000, 0.1);
    state.game.lastTime = now;

    // Decay attack cooldown
    if (state.attackCooldown > 0) {
      state.attackCooldown -= state.game.delta;
      if (state.attackCooldown < 0) state.attackCooldown = 0;
    }
  }
}
