/**
 * Cuubz — Vitest setup: make `process.exit` survivable (PR 31)
 *
 * Every one of the 58 migrated test files signals its verdict the way a standalone
 * Node script does — `process.exit(0)` or `process.exit(1)` at the end of the run.
 * Inside a Vitest worker that call **kills the worker**, and Vitest reports the file as
 * a crash rather than as a failure: no assertion output, no file name in the summary,
 * and with `pool: 'forks'` it can take the rest of the batch with it.
 *
 * Rewriting all 58 verdict blocks was the alternative. It was rejected because it means
 * hand-editing the one part of every file that decides pass from fail — the highest-risk
 * edit in the migration, 58 times, to remove a call that this file can neutralise once.
 *
 * ─── FIRST EXIT WINS, AND THAT IS THE WHOLE DESIGN ──────────────────────────
 *
 * Several files wrap their body in `runTests().catch(err => { …; process.exit(1); })`.
 * If `process.exit(0)` merely threw, that success throw would be caught by the file's
 * own catch handler, which would then call `process.exit(1)` and turn a passing suite
 * red. So the code is **recorded** as well as thrown, and only the first recording
 * counts. A suite that declares success and is then re-signalled by its own error path
 * still passes; a suite that fails first still fails.
 *
 * `test/helpers/legacy.js` reads the record and is what turns it into the verdict.
 */
'use strict';

let exitCode = null;

/** Called by `legacy()` before each suite body. */
export function resetExitSignal() {
  exitCode = null;
}

/** `null` when the suite never signalled — see `legacy()` for why that is a failure. */
export function getExitSignal() {
  return exitCode;
}

const realExit = process.exit.bind(process);

process.exit = function cuubzTestExit(code) {
  const n = Number(code) || 0;
  if (exitCode === null) exitCode = n;
  const err = new Error(
    `process.exit(${n}) inside a Vitest worker — recorded as the suite verdict by test/helpers/legacy.js`
  );
  err.__cuubzExit = n;
  throw err;
};

// Kept so nothing reads this file as "process.exit is gone". Nothing calls it; if a
// future harness genuinely needs to end the worker, this is the handle.
export const realProcessExit = realExit;
