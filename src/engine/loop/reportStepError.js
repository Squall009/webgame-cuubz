/**
 * Cuubz — what a render-loop step does with an exception (`BUGS.md` D-89)
 *
 * ─── THE DEFECT, AND WHY IT WAS NINE PLACES RATHER THAN ONE ─────────────────
 *
 * D-89 names `WorldStep.js:219-221`: the mob update is wrapped in a `try/catch` that
 * only logs while `state.frameCount < 10`, so **after the tenth frame a throw is
 * completely silent** and mobs simply stop updating for the rest of the session. The row
 * is about that one site because that is where D-77 had just put a renderer, but the
 * idiom had been copied to nine — `CombatStep` once, `QuestStep` six times as S1 through
 * S8 added systems, `WorldStep` twice. Fixing one and leaving eight would have moved the
 * defect rather than closed it.
 *
 * ─── THE THROTTLE IS RIGHT; THE CLIFF IS NOT ────────────────────────────────
 *
 * A per-frame `console.warn` at 60 fps is a per-frame `console.warn`, and that is a real
 * reason for the guard to exist — the row says so. What is wrong is that the guard has no
 * other setting than *off*. So this is a **one-shot latch**, which is the shape D-89's
 * own status field prescribes: report freely during warm-up, report the **first** failure
 * after it once, say plainly that further ones are suppressed, and then go quiet.
 *
 * The result is that a subsystem which dies at frame 400 leaves exactly one line in the
 * console instead of nothing at all, which is the whole difference between "mobs stopped
 * moving and I have no idea why" and a stack trace to read.
 *
 * ─── STATE LIVES ON `GameState`, NOT IN THIS MODULE ─────────────────────────
 *
 * A module-level `Set` would be shared across every game a page loads — start a world,
 * quit to the menu, start another, and the second session inherits the first's latches
 * and reports nothing. The latch is per-session because the loop is.
 */

/**
 * Frames during which a step's exception is reported on every occurrence.
 *
 * The original literal, now stated once. Ten frames is a sixth of a second: long enough
 * to cover the first-execution failures the guard was written for (an undefined field, a
 * missing dependency, a subsystem constructed in the wrong order) and short enough that
 * a persistent per-frame throw cannot fill the console.
 */
export const STEP_ERROR_WARMUP_FRAMES = 10;

/**
 * Report an exception a render-loop step swallowed.
 *
 * @param {object} state — the `GameState`; read for `frameCount`, written for the latch
 * @param {string} label — what failed, e.g. `'Mob update'`. Also the latch key, so two
 *   steps with the same label share one latch — keep them distinct.
 * @param {Error|*} err
 * @returns {boolean} whether anything was logged. For tests, and for a caller that wants
 *   to do something else on the first real failure.
 */
export function reportStepError(state, label, err) {
  const message = (err && err.message) || String(err);

  const frame = state && Number.isFinite(state.frameCount) ? state.frameCount : 0;
  if (frame < STEP_ERROR_WARMUP_FRAMES) {
    console.warn(`[Cuubz] ${label} error:`, message);
    return true;
  }

  // No state to latch against — a bare object in a test, say. Report rather than
  // suppress: silence is the failure mode this whole module exists to remove.
  if (!state) {
    console.warn(`[Cuubz] ${label} error:`, message);
    return true;
  }

  if (!state._stepErrorLatched) state._stepErrorLatched = new Set();
  if (state._stepErrorLatched.has(label)) return false;
  state._stepErrorLatched.add(label);

  // The error object, not just its message: this is the one line anyone will ever get
  // about this failure, so it carries the stack.
  console.error(
    `[Cuubz] ${label} error at frame ${frame} — further occurrences suppressed for this session:`,
    err
  );
  return true;
}
