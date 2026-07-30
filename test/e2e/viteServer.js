'use strict';
/**
 * Vite dev server host for the e2e harness (PR 7).
 *
 * WHY THIS EXISTS
 * ---------------
 * PR 7's accept criterion is "`npm run dev` serves the existing script-tag site
 * unchanged". The only way to check that is to run the same 149 assertions against
 * the Vite dev server that already run against `staticServer.js`:
 *
 *     npm run test:e2e          # staticServer — the parity baseline
 *     npm run test:e2e:vite     # this file    — must produce the same numbers
 *
 * `staticServer.js` stays the default and stays the baseline. A harness that only
 * ran against the thing it is validating would not be a gate — see the comment at
 * the top of `staticServer.js`, written in PR 6b for exactly this moment.
 *
 * INTERFACE: identical to `staticServer.start()` — `{ url, missing, close }` —
 * plus `trackResponses(page)`.
 *
 * WHY `missing` IS COLLECTED FROM THE BROWSER HERE
 * ------------------------------------------------
 * `staticServer` counts its own 404s, which a child-process dev server cannot do.
 * The equivalent signal from this side is Playwright's `response` event: any
 * page-initiated request that comes back >= 400. The harness's
 * `server.missing.length === 0` assertion therefore keeps its meaning in both
 * modes rather than going vacuously true in one of them.
 *
 * (Chromium's unprompted `/favicon.ico` request does not surface as a page
 * `response` event at all, so it needs no exclusion rule here. `staticServer`
 * excludes it explicitly because it sees it server-side.)
 *
 * WHY A FIXED PORT WITH `--strictPort`
 * ------------------------------------
 * A dev server left running by an earlier run will happily answer on the same
 * port while the new `vite` fails to bind — and the run then tests STALE CODE and
 * passes. That happened during PR 7's development. `--strictPort` makes the new
 * server fail instead of yielding, and the failure is turned into a rejection
 * below rather than a hang, so a stale server is a red run and not a silent lie.
 */

const path = require('path');
const { spawn } = require('child_process');

const READY_RE = /Local:\s+(http:\/\/\S+?)\/?\s*$/m;
const STARTUP_TIMEOUT_MS = 60000;

/**
 * Start `vite` on `root`. Resolves to { proc, url, missing, trackResponses, close }.
 *
 * `port` is fixed rather than ephemeral: Vite's `--port` plus `--strictPort` is
 * what makes a stale server an error, and Vite has no "port 0" mode.
 */
function start(root, port = 3100) {
  const missing = [];

  // `vite` is a devDependency, so its shim is in node_modules/.bin. Invoking that
  // directly rather than through `npx` avoids npx's registry lookup and gives a
  // process we can actually kill on Windows.
  const bin = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite');
  const proc = spawn(bin, ['--port', String(port), '--strictPort'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32', // .cmd shims are not executable without a shell
  });

  let output = '';
  let settled = false;

  return new Promise((resolve, reject) => {
    const fail = (why) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { proc.kill(); } catch { /* already gone */ }
      reject(new Error(`${why}\n--- vite output ---\n${output.trim() || '(none)'}`));
    };

    const timer = setTimeout(() => fail(`vite did not report a URL within ${STARTUP_TIMEOUT_MS} ms`), STARTUP_TIMEOUT_MS);

    const onData = (chunk) => {
      output += chunk;
      // Vite colourises its banner; strip ANSI before matching.
      const clean = output.replace(/\[[0-9;]*m/g, '');
      const m = READY_RE.exec(clean);
      if (m && !settled) {
        settled = true;
        clearTimeout(timer);
        resolve({
          proc,
          url: m[1].replace(/\/$/, ''),
          missing,
          /** Wire the browser-side 404 collector. Called once, after page creation. */
          trackResponses(page) {
            page.on('response', (res) => {
              if (res.status() < 400) return;
              try {
                missing.push(new URL(res.url()).pathname);
              } catch {
                missing.push(res.url());
              }
            });
          },
          close: () => new Promise((done) => {
            if (proc.exitCode !== null || proc.signalCode !== null) return done();
            proc.once('exit', () => done());
            proc.kill();
            // A shell-wrapped .cmd on Windows can outlive a SIGTERM to the shell.
            setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* gone */ } done(); }, 5000);
          }),
        });
      }
    };

    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', (err) => fail(`vite failed to spawn: ${err.message}`));
    proc.on('exit', (code) => fail(`vite exited with code ${code} before reporting a URL`));
  });
}

module.exports = { start };
