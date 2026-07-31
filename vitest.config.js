/**
 * Cuubz — Vitest configuration (PR 31)
 *
 * This file replaces `test/run_tests.sh`. Read that history before changing anything
 * here, because four of these settings are load-bearing and one of them is the only
 * reason `npm test` is not silently vacuous.
 *
 * ─── WHY THIS IS A SEPARATE FILE FROM `vite.config.js` ──────────────────────
 *
 * Vitest prefers `vitest.config.js` over `vite.config.js` and does not merge them. That
 * is what we want: the build config carries `publicDir: false`, a `dist/` outDir and a
 * dev-server port, none of which a Node test run should inherit or accidentally depend
 * on. `vite.config.js` stays exactly what it is — the build's.
 *
 * ─── 1. `environment: 'node'`, NOT `'jsdom'` — decision 61 ──────────────────
 *
 * `refactor.md` §11 specifies `environment: 'jsdom'` globally. That is wrong for this
 * tree and it is not a style preference. `src/` contains **28 `typeof window` /
 * `typeof document` / `typeof performance` feature-detection guards** that are FALSE
 * under bare Node today (`BUGS.md` D-27, measured). jsdom flips every one of them to
 * true, so `Keyboard`, `Mouse` and `Touch` would start registering real listeners and
 * `PlayerListHUD` would start building DOM — a larger behaviour change than the runner
 * swap this PR exists to perform, arriving in the same commit and invisible in the
 * diff. The three files that need a DOM already build their own (`jsdom` directly, or
 * a `MockElement`), and they keep doing so. A future PR that wants jsdom can turn it on
 * per file with `// @vitest-environment jsdom` and own the fallout.
 *
 * ─── 2. `pool: 'forks'` + `fileParallelism: false` — MANDATORY ──────────────
 *
 * The legacy runner gave every file its own process, one at a time, and five files
 * depend on that: `integration/server.test.js`, `integration/multiplayerSync.test.js`,
 * `integration/maxPlayerAndDisconnect.test.js`, `integration/sessionDiscovery.test.js`
 * and `integration/multiplayerStress.test.js` bind real TCP sockets, and
 * `unit/meta/manifestGenerator.test.js` shells out to a CommonJS script. Worker threads
 * (Vitest's default) share one process, so two socket suites in flight collide.
 *
 * ─── 3. `exclude` must name `test/e2e/**` explicitly ────────────────────────
 *
 * `run_tests.sh` globbed `test/test_*.js` — FLAT and prefix-matched — which is the only
 * reason `test/e2e/` was ever invisible to `npm test`. A recursive suffix glob makes it
 * visible. `test/e2e/saveLoad.js` spawns a browser and takes seven minutes; it is not a
 * unit test and must never be picked up here.
 *
 * ─── 4. `setupFiles` is the non-vacuity guard ───────────────────────────────
 *
 * All 58 migrated files signal their verdict with `process.exit`, which inside a Vitest
 * worker kills the worker and is reported as a crash rather than a failure.
 * `test/setup.js` replaces it with a recorded throw, and `test/helpers/legacy.js`
 * turns that record into the test's verdict — including the case where an async body
 * was never awaited, which would otherwise be a green run that proves nothing. See
 * those two files.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // See note 3. Both halves matter: the include is a suffix glob so nothing that is
    // not a `.test.js` runs, and the exclude keeps the seven-minute browser harness out.
    include: ['test/**/*.test.js'],
    exclude: ['test/e2e/**', 'node_modules/**', 'dist/**'],

    // See note 1. Do not set this to 'jsdom'.
    environment: 'node',

    // See note 2. Neither of these is optional.
    pool: 'forks',
    fileParallelism: false,

    // See note 4.
    setupFiles: ['test/setup.js'],

    // The legacy runner captured each file's stdout and printed it only on failure.
    // This is that behaviour. `scripts/count-assertions.js` overrides it with
    // `--silent=false` because the per-file assertion totals are printed, not returned.
    silent: 'passed-only',

    // Five socket suites and one that shells out; the legacy runner had no timeout at
    // all beyond the process living. 60 s is well above the slowest observed file.
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
