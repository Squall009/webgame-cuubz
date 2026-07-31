/**
 * Cuubz — the legacy-suite wrapper (PR 31)
 *
 * Every migrated test file has the same shape:
 *
 *     it('noise', () => legacy(() => {
 *     …the file's original body, verbatim and un-reindented…
 *     }));
 *
 * ─── WHY THE BODIES ARE VERBATIM — decision 60 ──────────────────────────────
 *
 * The 58 files carry ~24,000 lines and each one embeds its own `assert` helpers and its
 * own report format. Rewriting them into `describe`/`expect` would have been 24,000
 * lines of hand-edit in the PR whose deliverable is a *runner swap*, with no gate that
 * could tell a faithful rewrite from a weakened one. So the bodies move unchanged and
 * un-indented — re-indentation alone would silently alter every multi-line template
 * literal in the suite — and this function converts the script-shaped verdict
 * (`process.exit`) into a Vitest-shaped one.
 *
 * ─── THE NON-VACUITY GUARD IS THE POINT OF THIS FILE ────────────────────────
 *
 * Ten of the files wrap their body in an async IIFE or a `runTests().catch(…)` tail. If
 * the migration forgets an `await`, the wrapper returns before a single assertion has
 * run and the file reports **green having proved nothing** — the exact failure mode this
 * project has logged five times under other names. So a suite that finishes without ever
 * calling `process.exit` is a FAILURE here, not a pass. Every migrated file ends with an
 * exit in both branches, so "no verdict" can only mean the body was not awaited.
 *
 * Do not "fix" a `legacy suite finished without signalling` failure by deleting this
 * check. It is telling you the file's async tail is not awaited.
 */
'use strict';

import { resetExitSignal, getExitSignal } from '../setup.js';

/**
 * @param {() => (void|Promise<void>)} body the original file body
 */
export async function legacy(body) {
  resetExitSignal();

  let crash = null;
  try {
    await body();
  } catch (e) {
    crash = e;
  }

  const code = getExitSignal();

  if (code === null) {
    // The body threw something that was not an exit signal, and never reached a verdict.
    if (crash) throw crash;
    throw new Error(
      'legacy suite finished without signalling a verdict — process.exit was never ' +
        'called. An async body is almost certainly not being awaited; see test/helpers/legacy.js.'
    );
  }

  if (code !== 0) {
    throw new Error(
      `legacy suite failed: process.exit(${code}). The failing assertions are in this ` +
        "file's console output above."
    );
  }
}
