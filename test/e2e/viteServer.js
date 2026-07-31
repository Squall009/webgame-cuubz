'use strict';
/**
 * Vite dev server host for the e2e harness (PR 7).
 *
 * WHY THIS EXISTS
 * ---------------
 * PR 7's accept criterion is "`npm run dev` serves the existing script-tag site
 * unchanged". The only way to check that is to run the same assertions against
 * the Vite dev server that already run against `staticServer.js` — **189** of them as
 * of PR 17, and the two hosts must report the same number:
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
 *
 * D-83 — THE TWO HALVES THAT MAKE THAT ACTUALLY TRUE (PR 31)
 * ----------------------------------------------------------
 * `--strictPort` alone was not enough, twice over, and both halves are measured:
 *
 *   (a) THE STALE LISTENER IS NOW A PRE-FLIGHT ERROR. `assertPortFree()` runs before
 *       `vite` is spawned. If anything already answers on the port, this rejects with
 *       a message naming the port and saying the run would be meaningless. It does NOT
 *       reuse the server and it does NOT fall back to another port — an ephemeral port
 *       was considered and rejected for this harness, because a fixed port is what
 *       makes a leftover process *visible* instead of routed around. Without the
 *       pre-flight, `--strictPort` produces a "port in use" line inside a 60-second
 *       startup timeout, which reads as a flake rather than as the specific thing it is.
 *
 *   (b) THE CHILD IS KILLED AS A TREE, NOT AS A PROCESS. On Windows `spawn` runs with
 *       `shell: true` (a `.cmd` shim is not executable otherwise), so `proc` is
 *       `cmd.exe` → `vite.cmd` → `node`. `proc.kill()` reaps the shell and leaves the
 *       **node grandchild still LISTENING** — which is exactly how a run that died on
 *       "Target page, context or browser has been closed" left a `vite` on 3100.
 *       `taskkill /T /F` is what takes the tree. `close()` then waits for the port to
 *       actually go quiet and shouts if it does not, so a future regression in this is
 *       reported by the run that caused it rather than by the next run's odd numbers.
 */

const path = require('path');
const net = require('net');
const { spawn, execFileSync } = require('child_process');

const READY_RE = /Local:\s+(http:\/\/\S+?)\/?\s*$/m;
const STARTUP_TIMEOUT_MS = 60000;
const PORT_PROBE_TIMEOUT_MS = 2000;
const PORT_RELEASE_TIMEOUT_MS = 10000;

/** Resolves true if something accepts a TCP connection on `port` right now. */
function isPortListening(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: 'localhost' });
    let settled = false;
    const done = (listening) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(listening);
    };
    sock.setTimeout(PORT_PROBE_TIMEOUT_MS);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false)); // ECONNREFUSED — nothing is there
  });
}

/**
 * D-83 (a) — refuse to start on an occupied port. Loud, immediate, no fallback.
 *
 * Reusing whatever is already there is the failure mode this exists to prevent: it
 * serves the previous run's code and reports the current run's verdict.
 */
async function assertPortFree(port) {
  if (!(await isPortListening(port))) return;
  throw new Error(
    `PORT ${port} IS ALREADY LISTENING — refusing to start.\n` +
    `  A server is already answering on ${port}. This harness uses a FIXED port on ` +
    'purpose, so that leftover is almost certainly a `vite` orphaned by an earlier ' +
    'run (D-83).\n' +
    '  Reusing it would serve the browser THAT process\'s code while this run reports ' +
    'a verdict about the working tree — a green run that means nothing. Falling back ' +
    'to another port would hide the orphan instead of surfacing it, so neither is done ' +
    'here.\n' +
    `  Kill it first:  powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} ` +
    '-State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"\n' +
    `  or on POSIX:    lsof -ti tcp:${port} | xargs kill -9`
  );
}

/**
 * D-83 (b) — kill `proc` and everything it spawned.
 *
 * On Windows the shell wrapper is not the process holding the port; see the header.
 * On POSIX `shell` is false, so `proc` IS `vite` and a signal to it is enough.
 */
function killTree(proc) {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // Already gone, or taskkill refused — fall through to the signal below.
      try { proc.kill(); } catch { /* gone */ }
    }
    return;
  }
  try { proc.kill(); } catch { /* gone */ }
}

/**
 * Start `vite` on `root`. Resolves to { proc, url, missing, trackResponses, close }.
 *
 * `port` is fixed rather than ephemeral: Vite's `--port` plus `--strictPort` is
 * what makes a stale server an error, and Vite has no "port 0" mode.
 */
async function start(root, port = 3100) {
  // D-83 (a). Before the spawn, and before anything else can go wrong.
  await assertPortFree(port);

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
      killTree(proc); // D-83 (b) — the shell wrapper is not what holds the port
      reject(new Error(`${why}\n--- vite output ---\n${output.trim() || '(none)'}`));
    };

    const timer = setTimeout(() => fail(`vite did not report a URL within ${STARTUP_TIMEOUT_MS} ms`), STARTUP_TIMEOUT_MS);

    const onData = (chunk) => {
      output += chunk;
      // Vite colourises its banner; strip ANSI before matching.
      // D-87: the escape below was a LITERAL 0x1B byte in the source until PR 33 — invisible
      // in an editor, in `Read`, and in `git diff`, so the line read as a broken ANSI strip
      // that could not possibly work, and every reviewer had to rediscover that it did.
      // `\x1b` is the same pattern spelled in printable characters; verified by matching
      // both spellings over a corpus of real vite banners and near-misses.
      const clean = output.replace(/\x1b\[[0-9;]*m/g, '');
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
          /**
           * Stop the server. D-83 (b): kills the TREE, then proves the port is free.
           *
           * The old version sent one signal to `proc` and resolved on its `exit`. On
           * Windows `proc` is `cmd.exe` wrapping `vite.cmd` wrapping `node`, so that
           * resolved while the node grandchild was still bound to the port — a
           * "successful" teardown that leaves the next run testing stale code.
           */
          close: async () => {
            if (proc.exitCode === null && proc.signalCode === null) {
              const exited = new Promise((done) => {
                let settled = false;
                let hard = null; // declared first: `killTree` blocks on execFileSync
                const finish = () => {
                  if (settled) return;
                  settled = true;
                  if (hard) clearTimeout(hard);
                  done();
                };
                proc.once('exit', finish);
                killTree(proc);
                // Backstop: if the tree kill did not produce an `exit` here (a
                // detached grandchild, a taskkill that was refused), do not hang.
                hard = setTimeout(() => {
                  try { proc.kill('SIGKILL'); } catch { /* gone */ }
                  finish();
                }, 5000);
              });
              await exited;
            }

            // The signal that actually matters is not "the process object says exited",
            // it is "nothing answers on the port any more". Poll for it, and shout
            // rather than pass quietly if it never happens: a leftover listener here is
            // what makes the NEXT run a lie, and the run that caused it is the one that
            // should say so.
            const deadline = Date.now() + PORT_RELEASE_TIMEOUT_MS;
            while (Date.now() < deadline) {
              if (!(await isPortListening(port))) return;
              await new Promise(r => setTimeout(r, 250));
            }
            console.error(
              `  ⚠️  D-83 — port ${port} is STILL LISTENING ${PORT_RELEASE_TIMEOUT_MS} ms after the ` +
              'vite process tree was killed. Something survived teardown; the next run of this ' +
              'harness will refuse to start until it is gone (see assertPortFree in this file).'
            );
          },
        });
      }
    };

    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', (err) => fail(`vite failed to spawn: ${err.message}`));
    proc.on('exit', (code) => fail(`vite exited with code ${code} before reporting a URL`));
  });
}

// `start` is what `saveLoad.js` uses and its shape is unchanged. The other three are
// exported for `test/e2e/multiplayer.js` (D-48), which spawns a relay child on a fixed
// port and needs exactly the two D-83 halves this file already implements: the
// pre-flight "refuse to start on an occupied port" check, and the Windows process-TREE
// kill. Writing a second copy of either is how the two drift apart — the tree kill in
// particular is three lines that are wrong in an invisible way if you get them wrong.
module.exports = { start, assertPortFree, isPortListening, killTree };
