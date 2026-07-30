/**
 * Cuubz — the `System` base class (PR 20)
 *
 * `refactor.md` §4.2's shape, and nothing beyond it: a `static priority`, `init(game)`,
 * `update(dt)` and `dispose()`. §9 PR 20's plan is "convert systems one at a time;
 * `SystemRunner` drops its special cases" — this file is the target of that conversion,
 * not the conversion itself.
 *
 * ─── WHY NOTHING IS CONVERTED IN THE SAME COMMIT ────────────────────────────
 *
 * The per-frame signatures in this codebase do **not** converge on `update(dt)`. Measured
 * across every live per-frame call site the six step files in `src/engine/loop/steps/`
 * make:
 *
 *   already `update(dt)`   `BlockInteractionSystem.update(delta)`      (:89)
 *                          `FirstPersonHand.update(delta)`            (:168)
 *                          `PlayerSync.update(deltaTime)`             (:466)
 *
 *   extra arguments        `SkyRenderer.update(dt, playerPos)`        (:702)
 *                          `BiomeEffects.update(dt, skyColor, fog)`   (:175)
 *                          `DroppedItemsSystem.update(dt, pos, inv)`  (:50)
 *                          `mobIntegration.update(dt, world, pos, dist, getBiomeFn)` (:93)
 *                          `Player.update(dt, inputState, world)`     (:93)
 *
 *   no `update` at all     `ChunkManager`, `ChunkStreamer`, `PlayerListHUD`
 *
 * Three of eleven match. The other five each take state the class does not hold — the
 * player position, the skybox's blended colour, the inventory, the block-access facade —
 * so making them `update(dt)` means giving each one a `game` reference and rewiring where
 * it reads that state from, which is a behaviour change per class and not a rename. The
 * three with no `update` at all are driven by explicit calls whose *ordering* is the
 * subject of `SystemRunner.js`'s header.
 *
 * So the class is introduced now and adopted incrementally — one class per PR, with that
 * PR's tests — rather than by a sweep that would touch eleven files and the frame order
 * in one commit. Nothing extends it yet; that is the intended state.
 */

export class System {
  /** Lower runs earlier. */
  static priority = 100;

  /**
   * @param {object} game - the `Game` instance this system belongs to.
   */
  init(game) { this.game = game; }

  /**
   * One frame.
   * @param {number} dt - seconds since the previous frame.
   */
  update(dt) {}

  /** Release listeners, GPU resources and timers. Must be idempotent. */
  dispose() {}
}
