#!/usr/bin/env node
/**
 * Cuubz — Two-Context Multiplayer Browser Harness (BUGS.md D-48)
 *
 * `npm run test:e2e:mp`. A THIRD harness entry point, deliberately separate from
 * `test/e2e/saveLoad.js`.
 *
 * WHY IT IS A SEPARATE FILE AND NOT MORE ASSERTIONS IN saveLoad.js
 * ---------------------------------------------------------------
 * `npm run test:e2e` and `npm run test:e2e:vite` run the SAME file against two hosts and
 * must report the same number of assertions; that equality is PR 7's whole gate, and it
 * is checked by a human reading two numbers. Folding a relay child process and a second
 * browser context into that file would make both numbers move for a reason that has
 * nothing to do with the host under test, and would make a red multiplayer run look like
 * a red save/load run. So: same style, same launcher, same assert shape, own file, own
 * script, own numbers.
 *
 * WHAT IT PROVES THAT NOTHING ELSE DOES
 * -------------------------------------
 * No automated test in this repo had ever driven a multiplayer path in a browser.
 * `saveLoad.js` is single-context and never clicks `#btn-host` or `#btn-join`, so the
 * relay handshake, `HOST_CREATED` / `JOIN_ACCEPTED` arriving over a real socket, and
 * `startGame()` running on a joining client were unexercised by any assertion. That gap
 * is what let **D-43** — a player-visible rejoin defect — survive five green e2e runs and
 * four PRs. `test/unit/multiplayer/sessionRecord.test.js` covers the session layer's
 * LOGIC under Vitest; what was missing is the wiring, and wiring is only observable when
 * two real browsers talk to a real relay.
 *
 * THE TWO ASSERTIONS THIS FILE EXISTS FOR
 * ---------------------------------------
 *   1. The guest's `chunkManager.worldSeed` equals the seed the HOST typed. One equality,
 *      and it is only true if all of this held: the `?relayUrl=` override routed both
 *      sockets to the relay child; `HOST` created a session carrying the seed;
 *      `SESSION_LIST` carried it back to the guest; `LobbyScreen._joinSession` built the
 *      temporary world from `session.seed` rather than from its `Math.random()` fallback;
 *      `joinSession(id, {mode, name, seed})` recorded it; `JOIN_ACCEPTED` came back over a
 *      real socket; and `startGame()` ran to completion on a joining client.
 *   2. The guest's `cuubz_last_session` record carries the HOST's mode. That is D-43's
 *      regression test, in a browser, for the first time. The host deliberately hosts in
 *      **creative**, because `'survival'` is the fallback D-43 hard-coded — asserting
 *      against a survival session would pass with the bug still in.
 *
 * NOT IN CI, AND THAT IS DELIBERATE
 * ---------------------------------
 * `.github/workflows/ci.yml` runs on `ubuntu-latest`, which has no Edge. This harness
 * needs a real browser with a GPU stack (SwiftShader) plus a relay child, exactly like
 * `saveLoad.js`, and for the same reason it is invisible to `npm test`: `vitest.config.js`
 * excludes `test/e2e`, and nothing in here is named `*.test.js`. Do not add it to
 * `ci.yml`.
 *
 * PORTS: 8765 FOR THE RELAY, 3100 FOR `--server=vite`. BOTH FIXED.
 * ---------------------------------------------------------------
 * A stale listener on a fixed port has made a green run a lie eight times in this
 * project, so both are pre-flight-checked with `viteServer.assertPortFree` and the run
 * refuses to start rather than reusing whatever is already there. An ephemeral port would
 * hide an orphan instead of surfacing it. `server/index.js:220` already warns that a
 * crash can leave 8765 held; that warning is the reason for the check, not an excuse to
 * skip it. Teardown kills the relay as a process TREE (`viteServer.killTree`) and then
 * waits for the port to actually go quiet.
 *
 * The relay is gated on its own `[RELAY] Listening on port N` line (`server/index.js:191`)
 * and never on a sleep.
 *
 * IT IS NOT SCRAPED. `test/unit/ui/pageLoad.test.js:50` reads the raw text of
 * `test/e2e/saveLoad.js` — that path only — and asserts every `#id` token in it exists in
 * the assembled DOM. This file is not scraped, so an illustrative id in a comment here is
 * harmless. It is still avoided, because the habit is what keeps that test green.
 *
 * CommonJS, like `saveLoad.js` and for the same reason: `eslint.config.mjs:201` lints
 * `test/e2e/` as `sourceType: 'commonjs'`, and this is a standalone `node` program that
 * spawns a browser and a server, not a Vitest file.
 */

'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const { assertPortFree, isPortListening, killTree } = require('./viteServer');

const ROOT = path.join(__dirname, '..', '..');
// A SUBDIRECTORY of artifacts/, not artifacts/ itself. `saveLoad.js:531-532` deletes
// EVERY `.png` directly inside `artifacts/` at the start of its run and then asserts it
// wrote exactly six — so sharing the directory means `npm run test:e2e` silently destroys
// this harness's evidence, and any png of ours that survived would break its count. A
// directory entry is not a `.png`, so nesting satisfies both. Found by PR 31's
// adversarial pass.
const ARTIFACTS = path.join(__dirname, 'artifacts', 'mp');
const HEADED = process.argv.includes('--headed');

// Which server hosts the two pages: `static` (default, the parity baseline — the BUILT
// site, same as `npm run test:e2e`) or `vite` (`npm run dev`).
const HOST = (process.argv.find(a => a.startsWith('--server=')) || '--server=static').split('=')[1];

// Identical to saveLoad.js. SwiftShader software WebGL; --enable-unsafe-swiftshader is
// required as of Chromium 130+ or the context is refused in headless.
const CHROME_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'];

// `server/index.js:22` reads MATCHMAKING_PORT from the environment. 8765 is its own
// default and the port every document in the repo names, so the harness uses it rather
// than inventing a second number for a human to be confused by.
const RELAY_PORT = 8765;

// What the host types into the lobby form. The seed is the whole point of assertion 1:
// it must arrive at the guest's chunk manager unchanged. `server/matchmaking.js:130`
// rejects a HOST whose `worldSeed` is not a truthy NUMBER, and
// `createEntity.parseSeed` is what turns this string into one.
const SEED_MP = '777333';
const SESSION_NAME = 'Cuubz MP Harness';
const HOST_WORLD_NAME = 'MP Host World';
const HOST_CHAR_NAME = 'MP Host';
const GUEST_CHAR_NAME = 'MP Guest';

// CREATIVE, not survival. `normaliseSessionRecord` (src/util/StorageHelper.js:63) falls
// back to `'survival'` and D-43's bug hard-coded the same string, so a survival session
// makes assertion 2 pass with the defect present. The mode must differ from the fallback
// or the assertion proves nothing.
const HOST_MODE = 'creative';

// Max players. Set to 3 rather than left at the default 4 so that "the slider's input
// listener ran" is observable at all — a value that is already the default cannot show
// that anything happened.
const HOST_MAX_PLAYERS = '3';

const GEN_TIMEOUT_MS = 180000;
const RELAY_START_TIMEOUT_MS = 20000;
const PORT_RELEASE_TIMEOUT_MS = 10000;

let passCount = 0;
let failCount = 0;
const failures = [];
const unverified = [];

// ── Teardown that cannot be skipped (D-83) ────────────────────
//
// The same shape as saveLoad.js's, with a third handle. Module-scoped, idempotent, and
// every stop individually guarded, because a teardown that throws must not skip the
// teardown after it. There is one extra thing to lose here and it is the worst one: a
// relay child still holding 8765 makes the NEXT run refuse to start.
let hostServer = null;
let browserHandle = null;
let relayHandle = null;
let tornDown = false;

async function teardown() {
  if (tornDown) return;
  tornDown = true;
  if (browserHandle) {
    try {
      await browserHandle.close();
    } catch (err) {
      console.error(`  ⚠️  browser teardown failed (continuing): ${err.message}`);
    }
    browserHandle = null;
  }
  if (hostServer) {
    try {
      await hostServer.close();
    } catch (err) {
      console.error(`  ⚠️  host server teardown failed (continuing): ${err.message}`);
    }
    hostServer = null;
  }
  if (relayHandle) {
    try {
      await relayHandle.close();
    } catch (err) {
      console.error(`  ⚠️  relay teardown failed: ${err.message}`);
    }
    relayHandle = null;
  }
}

function assert(condition, message) {
  if (condition) {
    passCount++;
    console.log(`  ✅ ${message}`);
  } else {
    failCount++;
    failures.push(message);
    console.log(`  ❌ ${message}`);
  }
}

function assertEquals(actual, expected, message) {
  assert(actual === expected, `${message}: expected ${expected}, got ${actual}`);
}

function note(what, whatWouldVerifyIt) {
  unverified.push({ what, whatWouldVerifyIt });
  console.log(`  ⚠️  UNVERIFIED — ${what}`);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function shot(page, name) {
  try {
    await page.screenshot({ path: path.join(ARTIFACTS, `${name}.png`) });
  } catch {
    // The page may already be gone on a failure path; a missing screenshot must not
    // replace the real error with a screenshot error.
  }
}

// ── Console-error accounting ──────────────────────────────────
//
// ONE exclusion, not saveLoad.js's two. Its second rule tolerates the relay being
// unreachable, because it serves the repo with no relay running. This harness runs a
// relay ON PURPOSE, so an unreachable relay here is the failure under test and must never
// be excluded. The count is asserted below so the list cannot grow silently.
const NOISE_RULES = [
  {
    id: 'favicon-404',
    why: 'Chromium requests /favicon.ico unprompted and the repo has none. ' +
         'staticServer.js already excludes it from `missing` for the same reason.',
    match: e => /\/favicon\.ico/.test(e.url || '') || /favicon\.ico/.test(e.text || ''),
  },
];

function isNoise(entry) {
  return NOISE_RULES.some(r => r.match(entry));
}

/**
 * `page.fill` that PROVES the value took — D-62, the same guard `saveLoad.js` uses and
 * for the same measured reason.
 *
 * `#host-world-seed` is pre-filled with a random uint32 every time the inline world form
 * is opened (`LobbyForms.js` → `createEntity.randomSeed`). A blank field is an explicit
 * error since PR 33 landed **D-62**'s cure, but the prefill is not blank — so a fill that
 * lands on nothing, races the prefill, or is reverted still produces a plausible numeric
 * seed rather than an error, and the run
 * carries on hosting a world this harness did not choose — which would turn assertion 1
 * into "two clients agree on a number", true of any number at all. Stopping here is the
 * only way that stays visible.
 *
 * `waitForFunction`, never `waitForSelector` with an attribute predicate: a selector wait
 * requires the element to be VISIBLE, so it burns its full timeout on anything hidden and
 * then fails for the wrong reason.
 */
async function fillChecked(page, selector, value) {
  await page.fill(selector, value);
  try {
    await page.waitForFunction(
      ([sel, want]) => {
        const el = document.querySelector(sel);
        return !!el && el.value === want;
      },
      [selector, value],
      { timeout: 5000 }
    );
  } catch {
    let got;
    try {
      got = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        return el ? el.value : '<no such element>';
      }, selector);
    } catch (readErr) {
      got = `<unreadable: ${readErr.message}>`;
    }
    throw new Error(
      `D-62 — page.fill('${selector}', '${value}') DID NOT TAKE: the field reads ` +
      `${JSON.stringify(got)}. For the seed field specifically that means the session is ` +
      'hosted on a seed this harness did not choose, and the guest agreeing with it would ' +
      'prove nothing. Stopping here on purpose.'
    );
  }
}

/**
 * Wait until the element with `id` no longer carries the `hidden` class.
 *
 * `waitForSelector('… :not(.hidden)')` waits for VISIBLE, so on anything that is still
 * hidden it burns its full 30 s timeout and then fails for the wrong reason. Every
 * visibility wait in this file goes through `waitForFunction` and `classList.contains`
 * for that reason.
 */
function waitUnhidden(page, id, timeout = 30000) {
  return page.waitForFunction(
    (elId) => {
      const el = document.getElementById(elId);
      return !!el && !el.classList.contains('hidden');
    },
    id,
    { timeout }
  );
}

// ── The relay child ───────────────────────────────────────────

/**
 * Start `server/index.js` on `port` and resolve once it has SAID it is listening.
 *
 * Gated on `[RELAY] Listening on port N` (`server/index.js:191`), never on a sleep: a
 * sleep that is long enough on this machine is a race on a slower one, and a race here
 * presents as "the browser could not reach the relay", which reads like a game defect.
 *
 * The port is pre-flight-checked first. A leftover relay would answer every socket this
 * run opens while the new child failed to bind, and the whole run would pass against
 * another process's sessions.
 */
async function startRelay(port) {
  await assertPortFree(port);

  const entry = path.join(ROOT, 'server', 'index.js');
  const proc = spawn(process.execPath, [entry], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, MATCHMAKING_PORT: String(port) },
  });

  const log = [];
  let settled = false;
  const READY_RE = new RegExp(`\\[RELAY\\] Listening on port ${port}\\b`);

  const handle = await new Promise((resolve, reject) => {
    const fail = (why) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      killTree(proc);
      reject(new Error(`${why}\n--- relay output ---\n${log.join('').trim() || '(none)'}`));
    };

    const timer = setTimeout(
      () => fail(`the relay did not announce "[RELAY] Listening on port ${port}" within ${RELAY_START_TIMEOUT_MS} ms`),
      RELAY_START_TIMEOUT_MS
    );

    const onData = (chunk) => {
      log.push(String(chunk));
      if (!settled && READY_RE.test(log.join(''))) {
        settled = true;
        clearTimeout(timer);
        resolve({
          proc,
          port,
          /** Everything the relay has printed so far. Asserted against, not just dumped. */
          output: () => log.join(''),
          /**
           * SIGTERM first — `server/index.js:253` has a graceful handler that disposes
           * every session and exits 0 — then the process TREE as a backstop, then wait
           * for the port to actually go quiet.
           *
           * On Windows `proc.kill('SIGTERM')` does not deliver a signal a handler can
           * see; it terminates the process. That is acceptable (the child owns nothing
           * that outlives it) and it is why the tree kill and the port poll are both
           * still here rather than being trusted away.
           */
          close: async () => {
            if (proc.exitCode === null && proc.signalCode === null) {
              const exited = new Promise((done) => proc.once('exit', () => done(true)));
              try { proc.kill('SIGTERM'); } catch { /* already gone */ }
              const graceful = await Promise.race([exited, sleep(4000).then(() => false)]);
              if (!graceful) {
                killTree(proc);
                await Promise.race([exited, sleep(4000).then(() => false)]);
              }
            }
            const deadline = Date.now() + PORT_RELEASE_TIMEOUT_MS;
            while (Date.now() < deadline) {
              if (!(await isPortListening(port))) return;
              await sleep(250);
            }
            console.error(
              `  ⚠️  D-83 — port ${port} is STILL LISTENING ${PORT_RELEASE_TIMEOUT_MS} ms after the ` +
              'relay process tree was killed. The next run of this harness will refuse to start ' +
              'until it is gone.'
            );
          },
        });
      }
    };

    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', err => fail(`the relay failed to spawn: ${err.message}`));
    proc.on('exit', code => fail(`the relay exited with code ${code} before announcing a port`));
  });

  return handle;
}

/** GET a JSON endpoint off the relay's own HTTP server (`server/index.js:52-74`). */
function relayGet(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: urlPath, timeout: 5000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error(`${urlPath} did not return JSON: ${body.slice(0, 200)}`));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error(`${urlPath} timed out`)));
    req.on('error', reject);
  });
}

/**
 * Poll `/sessions` until the named session reports `want` players.
 *
 * This is the only signal from OUTSIDE both browsers that the game-session sockets — the
 * `/session/:id` path, not matchmaking — actually carried a JOIN from each client.
 * `initPlayer.js:158` is what sends it, two init steps after the matchmaking handshake,
 * so it lands strictly later than `#hud` and cannot be waited on with a selector.
 */
async function waitForPlayers(port, sessionId, want, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const list = await relayGet(port, '/sessions');
    const entry = (list || []).find(s => s.sessionId === sessionId);
    last = entry ? entry.players : null;
    if (last === want) return last;
    await sleep(500);
  }
  return last;
}

// ══════════════════════════════════════════════════════════════

async function main() {
  const startedAt = Date.now();
  console.log('Cuubz Multiplayer Browser Harness — BUGS.md D-48');
  console.log('================================================\n');

  // ── Preconditions ───────────────────────────────────────────
  console.log('[Preconditions]');
  assert(fs.existsSync(path.join(ROOT, 'server', 'index.js')), 'server/index.js exists (the relay this run drives)');
  assert(fs.existsSync(path.join(__dirname, 'staticServer.js')), 'test/e2e/staticServer.js exists');
  assertEquals(NOISE_RULES.length, 1,
    'Exactly ONE console-error exclusion exists — saveLoad.js tolerates an unreachable relay ' +
    'and this harness must not, because a running relay is the thing under test');

  let chromium = null;
  try {
    ({ chromium } = require('playwright-core'));
    assert(true, 'playwright-core resolves (devDependency, no browser download)');
  } catch (err) {
    assert(false, `playwright-core resolves (${err.message}) — run npm install`);
  }
  if (!chromium) return finish(startedAt);

  let gitBefore = null;
  try {
    gitBefore = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
    assert(true, 'git status readable (needed for the clean-tree check at the end)');
  } catch (err) {
    assert(false, `git status readable (${err.message})`);
  }

  fs.mkdirSync(ARTIFACTS, { recursive: true });
  for (const f of fs.readdirSync(ARTIFACTS)) {
    if (f.startsWith('mp-') && f.endsWith('.png')) fs.unlinkSync(path.join(ARTIFACTS, f));
  }

  // ── The relay child ─────────────────────────────────────────
  console.log('\n[Relay child — server/index.js]');
  let relay = null;
  try {
    relay = await startRelay(RELAY_PORT);
    relayHandle = relay; // D-83 — registered before anything else can throw
    assert(true, `Relay announced "[RELAY] Listening on port ${RELAY_PORT}" (gated on the log line, not a sleep)`);
  } catch (err) {
    assert(false, `Relay child started on ${RELAY_PORT}: ${err.message}`);
    return finish(startedAt);
  }

  try {
    const health = await relayGet(RELAY_PORT, '/health');
    assertEquals(health.status, 'ok', 'The relay answers GET /health over HTTP');
    assertEquals(health.activeSessions, 0, 'The relay starts with zero active sessions — this run created everything it asserts on');
  } catch (err) {
    assert(false, `The relay answers GET /health over HTTP (${err.message})`);
  }

  // ── The page host ───────────────────────────────────────────
  console.log('\n[Page host]');
  let server = null;
  try {
    if (HOST === 'vite') {
      server = await require('./viteServer').start(path.resolve(ROOT), 3100);
    } else {
      server = await require('./staticServer').start(path.resolve(ROOT), 0);
    }
    hostServer = server; // D-83
    assert(true, `Host server started (${HOST})`);
  } catch (err) {
    assert(false, `Host server started (${HOST}): ${err.message}`);
    return finish(startedAt);
  }
  console.log(`  ℹ  serving ${ROOT} at ${server.url} via ${HOST}`);

  // THE WHOLE INTEGRATION IS THIS QUERY PARAMETER. `src/multiplayer/RelayUrl.js:29-33`
  // reads `?relayUrl=` before any other branch, so both contexts talk to the child above
  // instead of cuubz-relay.thehomelabguy.com. `RelayUrl.js:15` has claimed since PR 16
  // that `test/e2e/saveLoad.js` points it at a local relay; it never has, and this file
  // is the first thing in the repo that actually does.
  const PAGE_URL = `${server.url}/index.html?relayUrl=${encodeURIComponent(`ws://127.0.0.1:${RELAY_PORT}`)}`;

  let browser = null;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: !HEADED, args: CHROME_ARGS });
    browserHandle = browser; // D-83 — registered before newContext/newPage can throw
    assert(true, 'Launched Edge via channel:msedge (playwright-core ships no browsers)');
  } catch (err) {
    assert(false, `Launched Edge via channel:msedge (${err.message})`);
    return finish(startedAt);
  }

  // TWO CONTEXTS, ONE BROWSER. Storage (localStorage + IndexedDB) lives on the
  // BrowserContext, so two contexts are two independent players with independent
  // characters, worlds and rejoin records — which is exactly what "host and guest" means
  // and what a second page in one context would NOT give.
  const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const guestCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  const consoleErrors = { host: [], guest: [] };
  const pageErrors = { host: [], guest: [] };
  const dialogs = { host: [], guest: [] };

  const wire = (page, who) => {
    page.on('console', m => {
      if (m.type() === 'error') consoleErrors[who].push({ text: m.text(), url: m.location().url });
    });
    page.on('pageerror', e => pageErrors[who].push({ text: e.message, url: '' }));
    // `LobbyScreen._joinSession` alert()s and RETURNS when no character is selected.
    // Playwright auto-dismisses dialogs, so without this the join would fail silently and
    // every later wait would time out for an unexplained reason. Recorded and asserted.
    page.on('dialog', d => { dialogs[who].push(d.message()); d.dismiss().catch(() => {}); });
    if (server.trackResponses) server.trackResponses(page);
  };
  wire(host, 'host');
  wire(guest, 'guest');

  const drain = (list) => { const c = list.slice(); list.length = 0; return c; };
  const realErrors = who => drain(consoleErrors[who]).filter(e => !isNoise(e));

  try {
    // ═══ Both contexts load, pointed at the relay child ═══════
    console.log('\n[Both contexts load with ?relayUrl= pointed at the relay child]');
    await Promise.all([
      host.goto(PAGE_URL, { waitUntil: 'load' }),
      guest.goto(PAGE_URL, { waitUntil: 'load' }),
    ]);
    await Promise.all([
      host.waitForSelector('#main-menu:not(.hidden)', { timeout: 30000 }),
      guest.waitForSelector('#main-menu:not(.hidden)', { timeout: 30000 }),
    ]);
    await sleep(2000); // deferred init: auto-rejoin probe, atlas build, relay connect

    const hostLoadPageErrors = drain(pageErrors.host);
    const guestLoadPageErrors = drain(pageErrors.guest);
    const hostLoadReal = realErrors('host');
    const guestLoadReal = realErrors('guest');
    assertEquals(hostLoadPageErrors.length, 0,
      `Host context loads with no uncaught exceptions${hostLoadPageErrors.length ? ' — ' + hostLoadPageErrors.map(e => e.text).join(' | ') : ''}`);
    assertEquals(guestLoadPageErrors.length, 0,
      `Guest context loads with no uncaught exceptions${guestLoadPageErrors.length ? ' — ' + guestLoadPageErrors.map(e => e.text).join(' | ') : ''}`);
    assertEquals(hostLoadReal.length, 0,
      `Host context logs no console errors on load${hostLoadReal.length ? ' — ' + hostLoadReal.map(e => e.text.slice(0, 140)).join(' | ') : ''}`);
    assertEquals(guestLoadReal.length, 0,
      `Guest context logs no console errors on load${guestLoadReal.length ? ' — ' + guestLoadReal.map(e => e.text.slice(0, 140)).join(' | ') : ''}`);

    // The relay's own log is the assertion that `?relayUrl=` was honoured. Two browser
    // contexts opened two matchmaking sockets; if the override had been ignored, both
    // would have gone to the public relay and this count would be zero.
    const connects = (relay.output().match(/\[MATCHMAKING\] Client connected/g) || []).length;
    assertEquals(connects, 2,
      'BOTH contexts opened a matchmaking socket to THIS relay — `?relayUrl=` is honoured ' +
      `(src/multiplayer/RelayUrl.js:29-33). Relay logged ${connects} client connections`);

    // And the browser's own side of the same fact.
    await host.click('#btn-host');
    await waitUnhidden(host, 'lobby-screen');
    assert(true, '#btn-host opens the multiplayer lobby');
    await host.waitForFunction(
      () => (document.getElementById('connection-status') || {}).className === 'connection-status connected',
      { timeout: 15000 }
    );
    assert(true, 'The lobby reports "connected" — the matchmaking WebSocket is open from the page\'s side too');

    // ═══ HOST — the click path, in order ══════════════════════
    console.log('\n[Host — #btn-host → #tab-host → form → #btn-start-hosting]');
    await host.click('#tab-host');
    await waitUnhidden(host, 'host-panel');
    assert(true, '#tab-host reveals #host-panel');

    await fillChecked(host, '#host-session-name', SESSION_NAME);

    // The host has no characters and no worlds — a virgin context — so both inline
    // create forms are exercised for real rather than skipped.
    await host.click('#btn-host-create-char');
    await waitUnhidden(host, 'host-create-char-form');
    await fillChecked(host, '#host-char-name', HOST_CHAR_NAME);
    await host.click('#btn-host-save-char');
    await host.waitForFunction(
      () => document.getElementById('host-create-char-form').classList.contains('hidden'),
      { timeout: 10000 }
    );
    const hostCharValue = await host.inputValue('#host-character-select');
    assert(!!hostCharValue,
      `The host panel's inline character form selected the character it created (#host-character-select = ${hostCharValue})`);

    await host.click('#btn-host-create-world');
    await waitUnhidden(host, 'host-create-world-form');
    await fillChecked(host, '#host-world-name', HOST_WORLD_NAME);
    await fillChecked(host, '#host-world-seed', SEED_MP);
    await host.click('#btn-host-save-world');
    await host.waitForFunction(
      () => document.getElementById('host-create-world-form').classList.contains('hidden'),
      { timeout: 10000 }
    );
    const hostWorldValue = await host.inputValue('#host-world-select');
    assert(!!hostWorldValue,
      `The host panel's inline world form selected the world it created (#host-world-select = ${hostWorldValue})`);
    const hostWorldSeed = await host.evaluate((id) => {
      const opt = Array.from(document.getElementById('host-world-select').options).find(o => o.value === id);
      return opt ? opt.textContent : null;
    }, hostWorldValue);
    assert(/00777333/.test(hostWorldSeed || ''),
      `The created world carries the seed the harness typed — the dropdown reads ${JSON.stringify(hostWorldSeed)} ` +
      '(WorldManager.formatSeed pads to 8 digits). Without this, a silently ineffective seed fill would ' +
      'make everything downstream agree on a number nobody chose');

    await host.selectOption('#host-mode-select', HOST_MODE);
    assertEquals(await host.inputValue('#host-mode-select'), HOST_MODE,
      `The session is hosted in ${HOST_MODE.toUpperCase()} mode — deliberately NOT survival, which is the ` +
      'fallback D-43 hard-coded and would make the guest-mode assertion below vacuous');

    // A range input: `page.fill` refuses these, so the value is set and the `input` event
    // dispatched the way the browser would. `#host-max-players-value` is repainted by the
    // listener in LobbyForms.initHostForm, so the label is the observable proof it ran.
    await host.evaluate((v) => {
      const el = document.getElementById('host-max-players');
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, HOST_MAX_PLAYERS);
    assertEquals(await host.textContent('#host-max-players-value'), HOST_MAX_PLAYERS,
      'The max-players slider repaints its label (the input listener in LobbyForms.initHostForm ran)');

    await shot(host, 'mp-01-host-form');

    await host.click('#btn-start-hosting');

    // Either the game starts or the form reports why it did not. Waiting only for #hud
    // would turn a validation refusal into a 180-second timeout with no explanation.
    await host.waitForFunction(
      () => {
        const hud = document.getElementById('hud');
        const err = document.getElementById('host-error');
        return (hud && !hud.classList.contains('hidden')) || (err && !err.classList.contains('hidden'));
      },
      { timeout: GEN_TIMEOUT_MS }
    );
    const hostErrText = await host.evaluate(() => {
      const err = document.getElementById('host-error');
      return err && !err.classList.contains('hidden') ? err.textContent : null;
    });
    assertEquals(hostErrText, null,
      `#host-error stayed hidden — the host form validated${hostErrText ? ` (it says: ${hostErrText})` : ''}`);
    await waitUnhidden(host, 'hud', GEN_TIMEOUT_MS);
    assert(true, '#btn-start-hosting starts the game — the host reaches #hud (terrain generated)');
    await shot(host, 'mp-02-host-ingame');

    const hostSeedInGame = await host.evaluate(() => window.__cuubz.state.chunkManager.worldSeed);
    assertEquals(hostSeedInGame, SEED_MP,
      "The HOST's running chunk manager carries the seed that was typed (ChunkManager stringifies it)");

    // ═══ The relay agrees, from outside both browsers ═════════
    console.log('\n[The relay, read over HTTP — outside both browsers]');
    const sessions = await relayGet(RELAY_PORT, '/sessions');
    assertEquals(Array.isArray(sessions) && sessions.length, 1,
      `The relay holds exactly one session after #btn-start-hosting (it holds ${Array.isArray(sessions) ? sessions.length : 'a non-array'})`);
    const relaySession = (sessions || [])[0] || {};
    assertEquals(relaySession.name, SESSION_NAME, 'The relay recorded the session NAME the host typed');
    assertEquals(relaySession.seed, Number(SEED_MP),
      'The relay recorded the session SEED as a NUMBER — server/matchmaking.js:130 rejects a HOST whose ' +
      'worldSeed is not one, so this also proves createEntity.parseSeed produced a number rather than a string');
    assertEquals(relaySession.mode, HOST_MODE, 'The relay recorded the session MODE the host chose');
    assert(!!relaySession.sessionId, `The relay assigned a session id (${relaySession.sessionId})`);

    // ── The host's own rejoin record, written by HOST_CREATED ──
    const hostRecord = await host.evaluate(() => JSON.parse(localStorage.getItem('cuubz_last_session') || 'null'));
    assert(hostRecord !== null,
      "The host wrote a 'cuubz_last_session' record — HOST_CREATED arrived over a real socket and " +
      'SessionManager.saveSessionRecord() ran (src/multiplayer/SessionManager.js:167)');
    if (hostRecord) {
      assertEquals(hostRecord.sessionId, relaySession.sessionId,
        "The host's record names the session id the RELAY assigned, so it came back over the socket rather than being invented locally");
      assertEquals(hostRecord.isHost, true, "The host's record says isHost");
      assertEquals(hostRecord.mode, HOST_MODE, "The host's record carries the mode it hosted in");
      assertEquals(String(hostRecord.seed), SEED_MP, "The host's record carries the world's seed");
      assertEquals(hostRecord.name, SESSION_NAME, "The host's record carries the session name");
    }

    // ═══ GUEST — the click path ═══════════════════════════════
    console.log('\n[Guest — #btn-join → create a character → refresh → click the session]');
    await guest.click('#btn-join');
    await waitUnhidden(guest, 'lobby-screen');
    assert(true, '#btn-join opens the multiplayer lobby');

    // THE GUEST MUST HAVE ITS OWN CHARACTER FIRST. `LobbyScreen._joinSession` reads
    // `#browse-character-select`, and on an empty value it alert()s and RETURNS —
    // Playwright would dismiss the alert and the join would vanish without a trace.
    const emptyBefore = await guest.inputValue('#browse-character-select');
    assert(emptyBefore === '',
      'A virgin guest context has no character, so the browse dropdown carries no id ' +
      `(${JSON.stringify(emptyBefore)}) — a join clicked now would be refused by an alert()`);
    await guest.click('#btn-browse-create-char');
    await waitUnhidden(guest, 'browse-create-char-form');
    await fillChecked(guest, '#browse-char-name', GUEST_CHAR_NAME);
    await guest.click('#btn-browse-save-char');
    await guest.waitForFunction(
      () => document.getElementById('browse-create-char-form').classList.contains('hidden'),
      { timeout: 10000 }
    );
    const guestCharValue = await guest.inputValue('#browse-character-select');
    assert(!!guestCharValue,
      `The browse panel's inline character form selected the character it created (#browse-character-select = ${guestCharValue})`);

    await guest.click('#btn-refresh-sessions');
    await guest.waitForSelector('#session-list .session-item', { timeout: 20000 });
    const items = await guest.$$eval('#session-list .session-item', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
    assertEquals(items.length, 1,
      `#btn-refresh-sessions rendered exactly one session from SESSION_LIST (${items.length} rendered)`);
    assert((items[0] || '').indexOf(SESSION_NAME) !== -1,
      `The rendered session names the host's session — the browse round trip carried it (${JSON.stringify(items[0])})`);
    assert((items[0] || '').indexOf(SEED_MP) !== -1,
      "The rendered session shows the host's seed, so the guest has it BEFORE it clicks (this is what " +
      'LobbyScreen._joinSession reads instead of its Math.random() fallback)');
    await shot(guest, 'mp-03-guest-session-list');

    await guest.click('#session-list .session-item');
    await waitUnhidden(guest, 'hud', GEN_TIMEOUT_MS);
    assert(true,
      'Clicking the session starts the game on the GUEST — startGame() ran to completion on a joining ' +
      'client, which no assertion in this repo had ever driven');
    await shot(guest, 'mp-04-guest-ingame');

    assertEquals(dialogs.guest.length, 0,
      `No alert() interrupted the guest${dialogs.guest.length ? ' — ' + dialogs.guest.join(' | ') : ''}`);

    // ═══ D-48 ASSERTION 1 — the seed crossed the wire ═════════
    //
    // ONE equality, and it is the reason this file exists. See the header for the full
    // list of things that must have held for it to be true. It is non-vacuous by
    // construction: `LobbyScreen._joinSession` has a `Math.random()` fallback for the
    // seed one line above the join, and reverting to it turns this red.
    console.log('\n[D-48 assertion 1 — the guest generates the HOST\'s world]');
    const guestState = await guest.evaluate(() => {
      const s = window.__cuubz.state;
      if (!s) return { present: false };
      return {
        present: true,
        worldSeed: s.chunkManager.worldSeed,
        clientMode: s.chunkManager.clientMode,
        worldId: s.currentWorld ? s.currentWorld.id : null,
        currentSessionId: s.session ? s.session.currentSessionId : null,
        hostingSessionId: s.session ? s.session.hostingSessionId : null,
        gameMode: s.session ? s.session._gameMode : null,
      };
    });
    assertEquals(guestState.present, true, 'window.__cuubz.state is live on the guest (src/testBridge.js:128)');
    assertEquals(guestState.worldSeed, SEED_MP,
      "D-48 — the GUEST's chunk manager carries the seed the HOST typed. This single equality is the relay " +
      'handshake, JOIN_ACCEPTED over a real socket, mode/name/seed surviving the message, the temp world ' +
      "built from the session seed rather than LobbyScreen's Math.random() fallback, and startGame() on a " +
      'joining client — all of it, at once');
    assertEquals(guestState.worldSeed, hostSeedInGame,
      'D-48 — host and guest are generating the SAME world, stated the other way round');
    assertEquals(guestState.clientMode, true,
      'The guest runs its chunk manager in CLIENT mode — no local generation, no IndexedDB (initWorld.js:48)');
    assertEquals(guestState.hostingSessionId, null, 'The guest is not the host');
    assertEquals(guestState.currentSessionId, relaySession.sessionId,
      "The guest's live session id is the one the RELAY assigned to the host's session");
    assert(String(guestState.worldId || '').indexOf('temp_') === 0,
      `The guest is playing a TEMPORARY world, never persisted and never consuming a world slot (${guestState.worldId})`);
    // NOT "the key is absent": `Persistence.js:55-56` seeds `cuubz:slotMap` with `{}` the
    // first time the manager initialises, on every profile, world or no world. The
    // property that actually distinguishes a temp world from a real one is that it
    // occupies no SLOT — swap `_joinSession`'s `wm.worlds.push(tempWorld)` for a
    // `createWorld` call and this count becomes 1.
    const guestSlots = await guest.evaluate(() => JSON.parse(localStorage.getItem('cuubz:slotMap') || '{}'));
    assertEquals(Object.keys(guestSlots).length, 0,
      "The guest's temp world consumed none of the three world slots — it is pushed onto " +
      `worldManager.worlds directly and never persisted (slotMap holds ${JSON.stringify(guestSlots)})`);

    // ═══ D-48 ASSERTION 2 — D-43, in a browser, at last ═══════
    //
    // The guest's rejoin record must carry the HOST's mode. Before PR 16 the winning
    // `beforeunload` handler hard-coded `'survival'` for a joiner, so refreshing while
    // joined to a creative session rejoined into survival. Every existing test of this is
    // a unit test of `StorageHelper`/`SessionManager` in isolation; this is the first one
    // that goes through two browsers and a socket.
    //
    // NEVER change the string 'cuubz_last_session' — refactor.md §1.5, §14.
    console.log('\n[D-48 assertion 2 — D-43: the guest\'s rejoin record carries the HOST\'s mode]');
    const guestRecord = await guest.evaluate(() => JSON.parse(localStorage.getItem('cuubz_last_session') || 'null'));
    assert(guestRecord !== null,
      "The guest wrote a 'cuubz_last_session' record — JOIN_ACCEPTED arrived over a real socket " +
      '(src/multiplayer/SessionManager.js:180)');
    if (guestRecord) {
      assertEquals(guestRecord.mode, HOST_MODE,
        `D-43 — the guest's rejoin record carries the HOST's mode (${HOST_MODE}), not the hard-coded ` +
        "'survival' that made a refresh drop a creative joiner into survival. This is the regression test, " +
        'in a browser, for the first time');
      assertEquals(guestRecord.isHost, false, "D-43 — the guest's record says it is not the host");
      assertEquals(guestRecord.sessionId, relaySession.sessionId,
        "D-43 — the guest's record names the relay's session id");
      assertEquals(String(guestRecord.seed), SEED_MP,
        "D-43 — the guest's record carries the HOST's seed, so a rejoin can rebuild the same temp world " +
        '(before PR 16 a joiner\'s record had no seed at all)');
      assertEquals(guestRecord.name, SESSION_NAME,
        "D-43 — the guest's record carries the session name, which JOIN_ACCEPTED does not carry: it can " +
        'only have come from what the player clicked');
    }
    assertEquals(guestState.gameMode, HOST_MODE,
      'The live SessionManager on the guest holds the host\'s mode, which is where the record read it from');

    // ═══ Both game-session sockets carried a JOIN ═════════════
    //
    // Matchmaking is a different socket from the game session. Everything above proves
    // the matchmaking half; this proves `/session/:id` — `initPlayer.js:158` sends JOIN
    // from each client two init steps after the handshake.
    console.log('\n[Both clients joined the /session/:id relay, not just matchmaking]');
    const players = await waitForPlayers(RELAY_PORT, relaySession.sessionId, 2, 30000);
    assertEquals(players, 2,
      'The relay counts TWO players in the game session — host and guest each opened a /session/:id socket ' +
      'and sent JOIN (src/core/init/initPlayer.js:158)');

    // ═══ Nothing threw along the way ══════════════════════════
    console.log('\n[Error accounting across the whole multiplayer path]');
    const hostMpErrors = drain(pageErrors.host);
    const guestMpErrors = drain(pageErrors.guest);
    assertEquals(hostMpErrors.length, 0,
      `Hosting raised no uncaught exceptions${hostMpErrors.length ? ' — ' + hostMpErrors.map(e => e.text).join(' | ') : ''}`);
    assertEquals(guestMpErrors.length, 0,
      `Joining raised no uncaught exceptions${guestMpErrors.length ? ' — ' + guestMpErrors.map(e => e.text).join(' | ') : ''}`);
    const hostMpConsole = realErrors('host');
    const guestMpConsole = realErrors('guest');
    assertEquals(hostMpConsole.length, 0,
      `Hosting logs no console errors${hostMpConsole.length ? ' — ' + hostMpConsole.map(e => e.text.slice(0, 140)).join(' | ') : ''}`);
    assertEquals(guestMpConsole.length, 0,
      `Joining logs no console errors${guestMpConsole.length ? ' — ' + guestMpConsole.map(e => e.text.slice(0, 140)).join(' | ') : ''}`);
    assertEquals(dialogs.host.length, 0,
      `No alert() interrupted the host${dialogs.host.length ? ' — ' + dialogs.host.join(' | ') : ''}`);
    assertEquals(server.missing.length, 0,
      `Neither context fetched a missing asset${server.missing.length ? ' — ' + server.missing.join(', ') : ''}`);

    note(
      'The guest RECEIVING streamed chunks from the host, and any block edit crossing between them',
      'A wait on the guest\'s chunkManager.memoryCache filling from CHUNK_DATA, plus a host-side ' +
      'setBlock asserted on the guest. Both are reachable through window.__cuubz.state now that this ' +
      'file establishes the two-context setup; they were left out of the first version because two ' +
      'solid assertions are worth more than twenty shallow ones, and the seed equality above is what ' +
      'D-48 was opened for.'
    );
    note(
      'Rejoin after a page reload — the record this run proves is CORRECT is never USED here',
      'A guest reload followed by #btn-rejoin-session, asserting the rebuilt world keeps the host\'s ' +
      'seed and mode. That exercises AutoRejoin/SessionRejoin, which is a third click path and its own ' +
      'failure surface.'
    );

    // ═══ The run left the tree alone ══════════════════════════
    console.log('\n[The harness leaves the working tree unchanged]');
    const gitAfter = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
    assert(gitAfter === gitBefore,
      'git status --porcelain is byte-identical before and after the run (artifacts/ is gitignored)' +
      (gitAfter === gitBefore ? '' : `\n     before:\n${gitBefore}\n     after:\n${gitAfter}`));

    const shots = fs.readdirSync(ARTIFACTS).filter(f => f.startsWith('mp-') && f.endsWith('.png'));
    assertEquals(shots.length, 4, `Four screenshots written to test/e2e/artifacts/ (${shots.join(', ')})`);
    assert(shots.every(f => fs.statSync(path.join(ARTIFACTS, f)).size > 1024), 'Every screenshot is non-trivially sized');
  } catch (err) {
    assert(false, `Harness ran to completion (${err.message})`);
    console.error(err.stack);
    await shot(host, 'mp-98-host-failure');
    await shot(guest, 'mp-99-guest-failure');
    // A failure part-way through leaves the click path unexplained unless the page state
    // is printed. This is the "which step died and what did the page look like" report.
    for (const [who, page] of [['host', host], ['guest', guest]]) {
      try {
        const state = await page.evaluate(() => {
          const vis = id => {
            const el = document.getElementById(id);
            return el ? (el.classList.contains('hidden') ? 'hidden' : 'VISIBLE') : 'absent';
          };
          return {
            screens: ['main-menu', 'lobby-screen', 'loading-screen', 'hud'].map(id => `${id}=${vis(id)}`).join(' '),
            panels: ['browse-panel', 'host-panel', 'host-error'].map(id => `${id}=${vis(id)}`).join(' '),
            hostError: (document.getElementById('host-error') || {}).textContent || '',
            sessionItems: document.querySelectorAll('#session-list .session-item').length,
            loading: (document.getElementById('loading-status') || {}).textContent || '',
          };
        });
        console.error(`  ℹ  ${who} page state: ${state.screens} | ${state.panels} | ` +
          `sessionItems=${state.sessionItems} | loading="${state.loading}" | hostError="${state.hostError}"`);
      } catch (readErr) {
        console.error(`  ℹ  ${who} page state unreadable: ${readErr.message}`);
      }
    }
    console.error(`  ℹ  relay tail:\n${relay.output().split('\n').slice(-25).join('\n')}`);
  } finally {
    await teardown();
  }

  await finish(startedAt);
}

async function finish(startedAt) {
  // D-83 — every early `return finish()` above reaches this, so no exit path can leave a
  // relay child holding 8765 or a vite child holding 3100.
  await teardown();

  const secs = startedAt ? ((Date.now() - startedAt) / 1000).toFixed(1) : '?';
  console.log('\n================================================');
  console.log(`Results: ${passCount} passed, ${failCount} failed  (${secs}s wall clock)`);

  if (unverified.length > 0) {
    console.log(`\n⚠️  ${unverified.length} multiplayer behaviours NOT verified by this harness:`);
    unverified.forEach((u, i) => {
      console.log(`\n  ${i + 1}. ${u.what}`);
      console.log(`     → would be verified by: ${u.whatWouldVerifyIt}`);
    });
  }

  if (failCount > 0) {
    console.log('\nFailures:');
    failures.forEach(f => console.log(`  - ${f}`));
    process.exit(1);
  }
  console.log('\n🎉 D-48 multiplayer harness passing!');
  console.log('   Two browser contexts, one relay child, one socket each. The two assertions');
  console.log('   this file was opened for are the guest\'s worldSeed matching the host\'s and');
  console.log('   the guest\'s cuubz_last_session carrying the host\'s MODE — D-43\'s regression');
  console.log('   test in a browser. Neither can pass by accident: the seed is typed by this');
  console.log('   harness and the mode is creative, which is not the fallback.');
  process.exit(0);
}

main().catch(async err => {
  console.error(`\nHarness crashed outside the assertion scope: ${err.stack}`);
  await teardown();
  process.exit(1);
});
