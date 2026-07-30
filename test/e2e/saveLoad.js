#!/usr/bin/env node
/**
 * Cuubz — Save/Load Browser Harness (DEPLOY.md §7)
 *
 * Runs the 14-step manual save/load checklist in a real browser, without a human.
 * `npm run test:e2e`.
 *
 * WHY THIS EXISTS
 * ---------------
 * DEPLOY.md §7 is the parity baseline that Phase 1's "identical game, zero visual
 * change" claim rests on, and until this file it had never been run — §9 says so
 * explicitly ("the save/load checklist was written from the code paths, not from a
 * play session"). Storage is the one part of this codebase with no automated
 * coverage and unrecoverable failure modes. A gate that depends on a human
 * clicking around does not get run at every checkpoint.
 *
 * TWO HOSTS, SAME ASSERTIONS (PR 7)
 * ---------------------------------
 *     npm run test:e2e          # test/e2e/staticServer.js — the parity baseline
 *     npm run test:e2e:vite     # test/e2e/viteServer.js — `npm run dev`
 *
 * The second is how PR 7's "Vite serves the existing script-tag site unchanged" is
 * checked instead of asserted. Both must produce the same numbers; if they ever
 * diverge, the Vite dev pipeline changed the game and PR 7's premise is false.
 * `staticServer` stays the default — a gate that only runs on the thing it is
 * validating is not a gate.
 *
 * NOT part of `npm test` and NOT part of CI, deliberately. It needs a real browser
 * with a GPU stack; `ubuntu-latest` has no Edge, and downloading a Chromium plus
 * software-rasterising WebGL would add minutes to a 26 s CI run. The workflow
 * records this in a comment naming the PR that could add it, following PR 5's
 * idiom for `npm run build` / `npm run lint`. `test/run_tests.sh:46` globs
 * `test/test_*.js` — flat, non-recursive — so nothing under `test/e2e/` is visible
 * to the suite either. Do not name a file in here `test/test_e2e*.js`.
 *
 * HOW IT DRIVES THE GAME — storage inspection, not input simulation
 * ----------------------------------------------------------------
 * `page.evaluate` reads the storage constants (`BLOCK_TYPES`, `ChunkManager`,
 * `CHUNK_MAGIC`, …) through `window.__cuubz` — see `src/testBridge.js`.
 *
 * **This changed at PR 9 and the reason matters.** Until then these were top-level
 * `const`s in classic `<script>`s, which makes them global *lexical* bindings that
 * `page.evaluate` can name directly (refactor.md §2.4 — the same mechanism as PR 4
 * bug 1). In an ES module the identical `const` is module-scoped and completely
 * unreachable, so about a third of the assertions here — every `DEPLOY.md` §2 storage
 * invariant, the chunk-header decode, the H-1 regression test and PR 6d's `DB_VERSION`
 * increment — stopped being runnable the moment `index.html` became one module tag.
 * The bridge is one namespace object, assigned by the first module the bundle
 * evaluates. See `src/testBridge.js` for why PR 12 kept the file rather than deleting it,
 * and `BUGS.md` decision 21.
 *
 * IT CAN REACH LIVE GAME STATE AS OF PR 12. `window.__cuubz.state` is the running
 * `GameState` — `chunkManager`, `inventory`, `blockInteraction`, `player`, the `Game`
 * instance. Until PR 12 those were closure locals inside `startGame()`'s `setTimeout`
 * (refactor.md §1.6) and `page.evaluate` could not name them, which is why §7 steps 4 and
 * 6/7 were reported UNVERIFIED from PR 6b onward. The "place and break a block, then
 * reload" section near the end of the run is what that unblocked. **Pointer lock is still
 * out of reach** — that is a headless-browser limit, not a code-shape one — so the
 * harness exercises the write path below the raycast, and says so where it does it.
 *
 * The design consequence, unchanged: every persistence assertion here reads IndexedDB and
 * localStorage directly instead of simulating a player. That is why H-1 was provable
 * with no pointer lock and no mouse-look at all, and why steps 8-9 are now the
 * regression test for its fix — see [H-1] below.
 *
 * DEFECT-ASSERTING BLOCKS: NONE REMAIN. PR 6b shipped three (D-14, D-15, H-1) whose
 * assertions described the bug rather than the requirement, on the rule that a run
 * goes red if a new failure appears OR if a known failure stops reproducing. All
 * three have been fixed and their blocks rewritten into real assertions — D-14 in
 * PR 6b, D-15 and H-1 in PR 6c. If a future PR needs the pattern again, head the
 * block `ASSERTING A KNOWN DEFECT` and write the replacement assertion beside it.
 *
 * ONE BLOCK IS NOT A CHECKLIST STEP. The PR 6d schema-upgrade block near the end
 * proves something DEPLOY.md §7 never asked for because it was forbidden: that
 * incrementing DB_VERSION over a populated version-2 database preserves every chunk
 * and manifest. It runs against a throwaway probe database, not `cuubz-worlds`, for
 * the reason given where it sits.
 *
 * WHAT IT CANNOT VERIFY — see the UNVERIFIED summary it prints at the end.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// PR 9: this harness decodes browser-written chunk bytes with the production codec,
// which is an ES module now. The hook lets this CommonJS file require() it. See its
// header; PR 31 removes both.
require('../helpers/esmRequire');

const ROOT = path.join(__dirname, '..', '..');
const ARTIFACTS = path.join(__dirname, 'artifacts');
const HEADED = process.argv.includes('--headed');

// Which server hosts the run: `static` (default, the parity baseline) or `vite`
// (PR 7's `npm run dev`). See where it is used in main().
const HOST = (process.argv.find(a => a.startsWith('--server=')) || '--server=static').split('=')[1];

// SwiftShader software WebGL. Verified to produce a working WebGL2 context under
// headless Edge: glRenderer reports "ANGLE (Google, Vulkan 1.3.0 (SwiftShader
// Device (Subzero)), SwiftShader driver)". --enable-unsafe-swiftshader is required
// as of Chromium 130+; without it the context is refused in headless.
const CHROME_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'];

// Fixed seeds. #world-seed (index.html:154) pins terrain generation, which is what
// makes "the bytes are identical after a reload" a legitimate assertion rather
// than a coin flip. Two DIFFERENT seeds, so the two worlds' chunk "0,0" cannot be
// byte-equal by accident — which is what lets steps 8-9 tell "world A kept its own
// terrain" apart from "both worlds happen to look the same". Pre-6c it was what made
// H-1's overwrite visible in the bytes; post-6c it is what makes the fix provable.
const SEED_A = '424242';
const SEED_B = '999111';

// Chunks flush on a 5 s dirty timer (js/main.js:2359,4491 → chunkmanager.js:597-600)
// and player state saves on Escape (js/main.js:3864-3884). DEPLOY.md §7's timing
// rules: wait out the flush and press Escape BEFORE reading storage, or you measure
// a half-written world and call it a regression.
const FLUSH_WAIT_MS = 7000;
const GEN_TIMEOUT_MS = 180000;

let passCount = 0;
let failCount = 0;
const failures = [];
const unverified = [];

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

/**
 * Short digest of a base64 chunk payload, for assertion messages.
 *
 * The byte comparisons below are exact — they compare the full base64 strings —
 * but chunk "0,0" is ~24 KB, and assertEquals interpolates both sides into its
 * message. Printing digests keeps a passing run readable instead of dumping 48 KB
 * of base64 per comparison.
 */
function digest(b64) {
  return require('crypto').createHash('sha256').update(b64 || '', 'utf8').digest('hex').slice(0, 16);
}

// ── Console-error accounting ──────────────────────────────────
//
// "Zero console errors on a clean load" is only a meaningful assertion if nothing
// is quietly excluded from it. Exactly TWO exclusions exist, both environmental
// rather than game defects, and both are printed when they fire. The count is
// asserted below so this list cannot grow silently.
const NOISE_RULES = [
  {
    id: 'favicon-404',
    why: 'Chromium requests /favicon.ico unprompted and the repo has none. ' +
         'staticServer.js already excludes it from `missing` for the same reason.',
    match: e => /\/favicon\.ico$/.test(e.url || ''),
  },
  {
    id: 'relay-unreachable',
    why: 'The harness serves the repo locally with no relay running, so the ' +
         'WebSocket to cuubz-relay.thehomelabguy.com:8765 cannot connect. ' +
         'A missing relay is this environment, not a defect. Only tolerated ' +
         'outside the load and world-entry phases, which must be clean.',
    match: e => /cuubz-relay\.thehomelabguy\.com/.test(e.text || ''),
  },
];

function isNoise(entry) {
  return NOISE_RULES.some(r => r.match(entry));
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(ARTIFACTS, `${name}.png`) });
}

// ── Storage reader, run inside the page ───────────────────────
//
// Opens `cuubz-worlds` with NO version argument, which reads the current version
// without triggering `onupgradeneeded`. `onupgradeneeded` firing here is reported as
// an error rather than tolerated: a reader that upgrades the database it is
// inspecting is measuring its own side effects.
//
// Before PR 6d this was load-bearing for a second reason — the upgrade handler
// deleted every object store before recreating it (H-2), so a harness that named an
// explicit version and got the number wrong would have destroyed the data it was
// there to read. That is no longer true (§2.1 is a procedure now, and the PR 6d block
// near the end of this file drives a real 2 → 3 increment), but the no-version read is
// still the right shape for a reader.
//
// It is safe only because the database already exists by the time this runs. Opening
// a NON-existent database with no version is H-3 itself: it creates a store-less v1.
// Production has exactly one opener now, `ChunkManager.openDatabase()`, and it always
// names DB_VERSION. This is a test reader, not a second production opener.
const readStorage = (page, worldId) => page.evaluate(async (wid) => {
  const out = { upgradeFired: false };
  const db = await new Promise((res, rej) => {
    const req = indexedDB.open('cuubz-worlds');
    req.onupgradeneeded = () => { out.upgradeFired = true; };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });

  out.dbName = db.name;
  out.dbVersion = db.version;
  out.stores = Array.from(db.objectStoreNames).sort();

  const tx = db.transaction(['chunks', 'manifests'], 'readonly');
  const chunks = tx.objectStore('chunks');
  const manifests = tx.objectStore('manifests');
  const get = (store, key) => new Promise(r => { const q = store.get(key); q.onsuccess = () => r(q.result); });
  const all = (store) => new Promise(r => { const q = store.getAllKeys(); q.onsuccess = () => r(q.result); });

  out.chunkKeyPath = chunks.keyPath;
  out.manifestKeyPath = manifests.keyPath;
  out.chunkIndexNames = Array.from(chunks.indexNames);
  const idx = chunks.index('worldName');
  out.indexKeyPath = idx.keyPath;
  out.indexUnique = idx.unique;
  out.indexMultiEntry = idx.multiEntry;

  out.chunkKeys = await all(chunks);
  out.chunkCount = out.chunkKeys.length;
  out.manifestKeys = await all(manifests);

  // PR 6c: the chunks store's primary key is `${worldName}:${cx},${cz}`, so the store
  // can be partitioned by world — which is the whole point, and the thing the H-1
  // assertions below measure. `unscopedChunkCount` is the migration's own invariant:
  // once it has run, no bare `cx,cz` key remains anywhere in the store.
  out.storeKey00 = `${wid}:0,0`;
  out.worldChunkCount = out.chunkKeys.filter(k => String(k).indexOf(`${wid}:`) === 0).length;
  out.unscopedChunkCount = out.chunkKeys.filter(k => String(k).indexOf(':') === -1).length;

  // Read the pre-6c key too. It must always be absent: a bare key means either the
  // migration did not run or a write site was missed.
  out.legacyRec00 = (await get(chunks, '0,0')) !== undefined;

  const rec = await get(chunks, out.storeKey00);
  if (rec) {
    out.rec = { chunkKey: rec.chunkKey, worldName: rec.worldName, savedAt: rec.savedAt, byteLength: rec.data.byteLength };
    // Base64 rather than a number array: chunk 0,0 is ~32 KB and this crosses the
    // CDP boundary on every snapshot.
    const u8 = new Uint8Array(rec.data);
    let s = '';
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    out.recBytes = btoa(s);
    out.recStoredChecksum = new DataView(rec.data).getUint32(16, true);
  } else {
    out.rec = null;
  }

  const man = await get(manifests, wid);
  if (man) {
    const entry = (man.generatedChunks || []).find(e => (e.key || e) === '0,0');
    out.manifest = {
      worldName: man.worldName,
      seed: man.seed,
      spawnPoint: man.spawnPoint,
      generatedCount: (man.generatedChunks || []).length,
      lists00: entry !== undefined,
      checksum00: entry ? entry.checksum : null,
    };
  } else {
    out.manifest = null;
  }

  out.localStorageKeys = Object.keys(localStorage).sort();
  db.close();
  return out;
}, worldId);

// ── Menu navigation ───────────────────────────────────────────
// Every selector below is an id or data attribute that exists in index.html today;
// PR 26 slims index.html and owns keeping these alive.

async function createCharacter(page, name) {
  await page.click('#btn-play-solo');
  await page.waitForSelector('#character-screen:not(.hidden)');
  await page.click('#btn-create-char');
  await page.waitForSelector('#create-char-modal:not(.hidden)');
  await page.fill('#char-name', name);
  await page.click('#btn-save-char');
  await page.waitForSelector('.char-slot[data-char-id]');
}

async function createWorld(page, name, seed) {
  const before = await page.$$eval('.world-slot[data-world-id]', els => els.map(e => e.dataset.worldId));
  await page.click('#btn-create-world');
  await page.waitForSelector('#create-world-modal:not(.hidden)');
  await page.fill('#world-name', name);
  await page.fill('#world-seed', seed);
  await page.click('#btn-save-world');
  await page.waitForFunction(
    n => document.querySelectorAll('.world-slot[data-world-id]').length === n,
    before.length + 1
  );
  const after = await page.$$eval('.world-slot[data-world-id]', els => els.map(e => e.dataset.worldId));
  return after.find(id => !before.includes(id));
}

/** Menu → character → world → mode → in-game, then flush + Escape per §7's timing rules. */
async function enterWorld(page, worldId, mode) {
  await page.click('#btn-play-solo');
  await page.waitForSelector('#character-screen:not(.hidden)');
  await page.click('.char-slot[data-char-id]');
  await page.waitForSelector('#world-screen:not(.hidden)');
  await page.click(`.world-slot[data-world-id="${worldId}"]`);
  await page.waitForSelector('#mode-screen:not(.hidden)');
  await page.click(`#btn-${mode}`);
  // #hud loses .hidden at js/main.js:3901, inside the setTimeout that starts the
  // render loop — the only DOM-observable "the game is actually running" signal.
  await page.waitForSelector('#hud:not(.hidden)', { timeout: GEN_TIMEOUT_MS });
}

/**
 * Poll the chunks store until it stops growing.
 *
 * `checkRegion(0,0)` pre-generates a 33×33 region (chunkmanager.js, regionRadius 16)
 * and the HUD comes up long before that finishes. Without this, a snapshot taken a
 * fixed number of seconds after the HUD appears catches a partly-generated world,
 * and comparing two such snapshots produces a false "chunks appeared after a
 * reload" failure that has nothing to do with persistence. Waiting for quiescence
 * is what lets the round-trip assertions below compare exact counts instead of
 * being weakened to inequalities.
 */
async function waitForQuiesce(page, label) {
  const count = () => page.evaluate(async () => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('cuubz-worlds');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    const store = db.transaction(['chunks'], 'readonly').objectStore('chunks');
    const n = await new Promise(r => { const q = store.count(); q.onsuccess = () => r(q.result); });
    db.close();
    return n;
  });

  let stable = 0;
  let last = -1;
  const deadline = Date.now() + GEN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(2500); // > the 5 s flush timer's granularity over three reads
    const n = await count();
    stable = n === last ? stable + 1 : 0;
    last = n;
    if (stable >= 3) {
      console.log(`  ℹ  ${label}: chunk generation quiesced at ${n} records`);
      return n;
    }
  }
  assert(false, `${label}: chunk generation quiesced within ${GEN_TIMEOUT_MS / 1000}s (stuck at ${last})`);
  return last;
}

async function settleAndPause(page, label) {
  await waitForQuiesce(page, label);
  await sleep(FLUSH_WAIT_MS);
  await page.keyboard.press('Escape');
  await page.waitForSelector('#pause-menu:not(.hidden)', { timeout: 15000 });
  await sleep(1500); // let the Escape-triggered save transaction commit
}

// ══════════════════════════════════════════════════════════════

async function main() {
  console.log('Cuubz Save/Load Browser Harness — DEPLOY.md §7');
  console.log('==============================================\n');

  // ── Preconditions ───────────────────────────────────────────
  console.log('[Preconditions]');
  assert(fs.existsSync(path.join(ROOT, 'index.html')), 'index.html exists at the repo root');
  assert(fs.existsSync(path.join(__dirname, 'staticServer.js')), 'test/e2e/staticServer.js exists');
  assertEquals(NOISE_RULES.length, 2,
    'Exactly two console-error exclusions exist (adding a third must be a deliberate edit here)');

  let chromium = null;
  try {
    ({ chromium } = require('playwright-core'));
    assert(true, 'playwright-core resolves (devDependency, no browser download)');
  } catch (err) {
    assert(false, `playwright-core resolves (${err.message}) — run npm install`);
  }
  if (!chromium) return finish();

  // Snapshot the tree so §7 step 14 can assert the run changed nothing tracked.
  let gitBefore = null;
  try {
    gitBefore = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
    assert(true, 'git status readable (needed for the step-14 clean-tree check)');
  } catch (err) {
    assert(false, `git status readable (${err.message})`);
  }

  // Clear last run's screenshots. They are a self-comparison baseline, so a stale PNG
  // from a run of different code is worse than no PNG — and PR 6c renamed one of them
  // (05-world-alpha-contaminated → -intact), which would otherwise leave seven files
  // against the count asserted at the end.
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  for (const f of fs.readdirSync(ARTIFACTS)) {
    if (f.endsWith('.png')) fs.unlinkSync(path.join(ARTIFACTS, f));
  }

  // ── Which server hosts the run ──────────────────────────────
  //
  // `staticServer` is the default and the parity baseline: dependency-free, serves
  // the working tree with no build step, and behaves identically before and after
  // PR 7. `--server=vite` runs the SAME assertions against `npm run dev`, which is
  // how PR 7's "serves the existing script-tag site unchanged" is checked rather
  // than asserted. Both must produce the same numbers.
  let server = null;
  try {
    if (HOST === 'vite') {
      server = await require('./viteServer').start(path.resolve(ROOT), 3100);
    } else {
      server = await require('./staticServer').start(path.resolve(ROOT), 0);
    }
    assert(true, `Host server started (${HOST})`);
  } catch (err) {
    assert(false, `Host server started (${HOST}): ${err.message}`);
    return finish();
  }
  console.log(`  ℹ  serving ${ROOT} at ${server.url} via ${HOST}`);

  let browser = null;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: !HEADED, args: CHROME_ARGS });
    assert(true, 'Launched Edge via channel:msedge (playwright-core ships no browsers)');
  } catch (err) {
    assert(false, `Launched Edge via channel:msedge (${err.message})`);
    await server.close();
    return finish();
  }

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  // Storage lives on the BrowserContext, so it survives page.reload() and
  // page.goto() but not a new context — which is exactly the isolation this needs:
  // every run starts from a virgin profile with no worlds and no characters.
  const consoleErrors = [];
  const pageErrors = [];
  // PR 9 accept criterion: "chunk generation and meshing both still run in workers".
  // Both pools are built from fetched source text wrapped in a Blob (refactor.md §1.3)
  // inside a try/catch that falls back to main-thread generation and only `console.warn`s.
  // So a broken worker URL — the exact thing PR 9's move of js/ → src/ could break, and
  // the thing Vite's dev-server transform could break differently from its build output —
  // produces a game that still generates terrain, still passes every storage assertion,
  // and is silently single-threaded. That is a green run telling a lie, so the warning is
  // collected and asserted rather than left to a human reading DevTools → Threads.
  const workerWarnings = [];
  page.on('console', m => {
    if (m.type() === 'error') consoleErrors.push({ text: m.text(), url: m.location().url });
    if (/\[ChunkManager\].*[Ww]orker pool init failed/.test(m.text())) workerWarnings.push(m.text());
  });
  page.on('pageerror', e => pageErrors.push({ text: e.message, url: '' }));

  // The Vite host cannot count its own 404s (it is a child process), so it collects
  // them from this side instead. Without this the `server.missing` assertion below
  // would go vacuously true in vite mode, which is weakening an assertion to make a
  // run pass.
  if (server.trackResponses) server.trackResponses(page);

  const drain = (list) => { const c = list.slice(); list.length = 0; return c; };

  try {
    // ═══ §7 step 1 — clean load ═══════════════════════════════
    console.log('\n[§7 step 1 — clean page load]');
    await page.goto(`${server.url}/index.html`, { waitUntil: 'load' });
    await page.waitForSelector('#main-menu:not(.hidden)', { timeout: 30000 });
    await sleep(2000); // let deferred init (auto-rejoin probe, atlas build) finish
    await shot(page, '01-main-menu');

    const loadPageErrors = drain(pageErrors);
    const loadConsole = drain(consoleErrors);
    const loadNoise = loadConsole.filter(isNoise);
    const loadReal = loadConsole.filter(e => !isNoise(e));
    loadNoise.forEach(e => console.log(`  ℹ  suppressed (documented noise): ${e.text.slice(0, 90)}`));

    assertEquals(loadPageErrors.length, 0,
      `Clean load raises no uncaught exceptions${loadPageErrors.length ? ' — ' + loadPageErrors.map(e => e.text).join(' | ') : ''}`);
    assertEquals(loadReal.length, 0,
      `Clean load logs no console errors${loadReal.length ? ' — ' + loadReal.map(e => e.text.slice(0, 120)).join(' | ') : ''}`);
    assertEquals(server.missing.length, 0,
      `Clean load fetches no missing assets${server.missing.length ? ' — ' + server.missing.join(', ') : ''}`);
    assert(await page.isVisible('#main-menu'), 'Main menu renders');

    // ═══ WebGL + Three.js ═════════════════════════════════════
    console.log('\n[WebGL context and Three.js]');
    const gfx = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
      const { THREE } = window.__cuubz || {};
      return {
        hasContext: !!gl,
        version: gl ? gl.getParameter(gl.VERSION) : null,
        renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null,
        bridgePresent: typeof window.__cuubz === 'object' && window.__cuubz !== null,
        threeType: typeof THREE,
        revision: THREE ? THREE.REVISION : null,
      };
    });
    assert(gfx.hasContext, `A WebGL context is available (${gfx.version})`);
    assert(/SwiftShader|ANGLE/.test(gfx.renderer || ''), `glRenderer is a real rasteriser (${gfx.renderer})`);
    // PR 9: the module graph is what loads THREE now, so there is no <script onerror>
    // and no window.__THREE_LOAD_FAILED flag to check. `window.__cuubz` existing is the
    // replacement signal and a strictly stronger one — src/testBridge.js is the first
    // module evaluated, so the object cannot be there unless the whole bundle parsed,
    // resolved `three` and ran. The old flag only proved one <script> tag fetched.
    assertEquals(gfx.bridgePresent, true, 'window.__cuubz exists — the module bundle loaded and evaluated (src/testBridge.js)');
    assertEquals(gfx.threeType, 'object', 'THREE is loaded');
    // refactor.md §1.2 — three is pinned at r134 and PR 8 must keep it there.
    assertEquals(gfx.revision, '134', 'THREE.REVISION is r134');

    // ═══ DEPLOY.md §2 invariants, read from the running page ══
    // Not from source text: these are the values the browser actually holds.
    // Reachable because top-level `const` in a classic <script> is a lexical
    // binding in global scope — refactor.md §2.4.
    console.log('\n[DEPLOY.md §2.1 — IndexedDB constants]');
    const inv = await page.evaluate(() => {
      // PR 9: these were top-level `const`s in classic <script>s, i.e. global lexical
      // bindings (refactor.md §2.4). They are module-scoped now and unreachable from
      // here, so they come through the one sanctioned bridge — src/testBridge.js.
      // The `typeof … !== 'undefined'` guards below still do their job: a symbol the
      // bridge forgot destructures to `undefined` and the assertion says which one.
      const {
        DB_NAME, DB_VERSION, STORE_CHUNKS, STORE_MANIFESTS, CHUNK_W, CHUNK_D,
        ChunkManager, CHUNK_MAGIC, CHUNK_VERSION, LEGACY_LAYOUT_MAX, HEADER_SIZE,
        CHUNK_HEIGHT, MAX_WORLD_SLOTS, BLOCK_REGISTRY,
      } = window.__cuubz || {};
      return {
      dbName: typeof DB_NAME !== 'undefined' ? DB_NAME : null,
      dbVersion: typeof DB_VERSION !== 'undefined' ? DB_VERSION : null,
      storeChunks: typeof STORE_CHUNKS !== 'undefined' ? STORE_CHUNKS : null,
      storeManifests: typeof STORE_MANIFESTS !== 'undefined' ? STORE_MANIFESTS : null,
      chunkW: typeof CHUNK_W !== 'undefined' ? CHUNK_W : null,
      chunkD: typeof CHUNK_D !== 'undefined' ? CHUNK_D : null,
      chunkKeyFormat: typeof ChunkManager !== 'undefined' ? ChunkManager.key(-3, 7) : null,
      // PR 6c — the LOGICAL key above is unchanged; the STORE key is world-scoped.
      // Called on a stub rather than a real instance: only `worldName` is involved.
      storeKeyFormat: typeof ChunkManager !== 'undefined'
        ? ChunkManager.prototype._storeKey.call({ worldName: 'world-xyz' }, '-3,7') : null,
      worldKeyPrefix: typeof ChunkManager !== 'undefined' ? ChunkManager.worldKeyPrefix('world-xyz') : null,
      scopedRecognised: typeof ChunkManager !== 'undefined' ? ChunkManager.isWorldScopedStoreKey('w:0,0') : null,
      bareRecognised: typeof ChunkManager !== 'undefined' ? ChunkManager.isWorldScopedStoreKey('0,0') : null,
      magic: typeof CHUNK_MAGIC !== 'undefined' ? CHUNK_MAGIC : null,
      codecVersion: typeof CHUNK_VERSION !== 'undefined' ? CHUNK_VERSION : null,
      legacyMax: typeof LEGACY_LAYOUT_MAX !== 'undefined' ? LEGACY_LAYOUT_MAX : null,
      headerSize: typeof HEADER_SIZE !== 'undefined' ? HEADER_SIZE : null,
      chunkHeight: typeof CHUNK_HEIGHT !== 'undefined' ? CHUNK_HEIGHT : null,
      maxSlots: typeof MAX_WORLD_SLOTS !== 'undefined' ? MAX_WORLD_SLOTS : null,
      blockRegistryLength: typeof BLOCK_REGISTRY !== 'undefined' ? BLOCK_REGISTRY.length : null,
      };
    });
    assertEquals(inv.dbName, 'cuubz-worlds', 'DB_NAME (chunkmanager.js:20)');
    assertEquals(inv.dbVersion, 2, 'DB_VERSION (chunkmanager.js:21) — H-2: incrementing this destroys every saved world');
    assertEquals(inv.storeChunks, 'chunks', 'STORE_CHUNKS (chunkmanager.js:23)');
    assertEquals(inv.storeManifests, 'manifests', 'STORE_MANIFESTS (chunkmanager.js:24)');
    assertEquals(inv.chunkW, 16, 'CHUNK_W (chunkmanager.js:18)');
    assertEquals(inv.chunkD, 16, 'CHUNK_D (chunkmanager.js:19)');
    assertEquals(inv.chunkKeyFormat, '-3,7', 'Logical chunk key format `${cx},${cz}` (ChunkManager.key) — unchanged by PR 6c');
    assertEquals(inv.storeKeyFormat, 'world-xyz:-3,7',
      'Chunk STORE key format `${worldName}:${cx},${cz}` (PR 6c, H-1) — this is the chunks store primary key');
    assertEquals(inv.worldKeyPrefix, 'world-xyz:', 'ChunkManager.worldKeyPrefix — the range a world\'s chunks occupy');
    assertEquals(inv.scopedRecognised, true, 'isWorldScopedStoreKey recognises a migrated key');
    assertEquals(inv.bareRecognised, false, 'isWorldScopedStoreKey recognises a pre-migration bare key');

    console.log('\n[DEPLOY.md §2.2 — chunk binary format constants]');
    assertEquals(inv.magic, 0x43555542, 'CHUNK_MAGIC 0x43555542 "CUUB" (chunkBinaryCodec.js:28)');
    assertEquals(inv.codecVersion, 3, 'CHUNK_VERSION 3 (chunkBinaryCodec.js:29)');
    assertEquals(inv.legacyMax, 2, 'LEGACY_LAYOUT_MAX 2 (chunkBinaryCodec.js:30)');
    assertEquals(inv.headerSize, 20, 'HEADER_SIZE 20 (chunkBinaryCodec.js:30)');
    assertEquals(inv.chunkHeight, 256, 'CHUNK_HEIGHT 256 (chunkData.js) — must match the codec');
    // PR 4 moved a new block to id 192 rather than renumber 32 existing ones,
    // precisely because ids are baked into every saved chunk (DEPLOY.md §2.2).
    assertEquals(inv.blockRegistryLength, 193, 'BLOCK_REGISTRY holds 193 blocks (renumbering reinterprets every saved chunk)');

    console.log('\n[DEPLOY.md §2.3 — localStorage key space]');
    const lsKeys = await page.evaluate(() => {
      const { PersistenceManager } = window.__cuubz;
      const p = new PersistenceManager();
      return { char: p._charKey(), slotMap: p._slotMapKey(), conf0: p._worldConfKey(0), conf2: p._worldConfKey(2) };
    });
    assertEquals(lsKeys.char, 'cuubz:characters', "'cuubz:characters' (persistence.js:20)");
    assertEquals(lsKeys.slotMap, 'cuubz:slotMap', "'cuubz:slotMap' (persistence.js:24)");
    assertEquals(lsKeys.conf0, 'cuubz:worldSlot:0:conf', "'cuubz:worldSlot:{N}:conf' for N=0 (persistence.js:28)");
    assertEquals(lsKeys.conf2, 'cuubz:worldSlot:2:conf', "'cuubz:worldSlot:{N}:conf' for N=2 — MAX_WORLD_SLOTS-1");
    assertEquals(inv.maxSlots, 3, 'MAX_WORLD_SLOTS 3 (persistence.js:10) — part of the key space');
    // 'cuubz:settings' and 'cuubz_last_session' are literals, not exported constants.
    // They are asserted where they are written: settings below, and the last-session
    // key by the "no undocumented key appeared" check.

    // ═══ §7 steps 2-3 — character, world, enter survival ══════
    console.log('\n[§7 steps 2-3 — create character, create world in slot 0, enter survival]');
    await createCharacter(page, 'E2E Harness');
    const chars = await page.evaluate(() => JSON.parse(localStorage.getItem('cuubz:characters') || 'null'));
    assert(Array.isArray(chars), "localStorage['cuubz:characters'] is a JSON array");
    assertEquals(chars.length, 1, 'Exactly one character was created');
    assertEquals(chars[0].name, 'E2E Harness', 'The created character round-trips its name through localStorage');

    await page.click('.char-slot[data-char-id]');
    await page.waitForSelector('#world-screen:not(.hidden)');
    const worldA = await createWorld(page, 'Alpha', SEED_A);
    const slotMap = await page.evaluate(() => JSON.parse(localStorage.getItem('cuubz:slotMap') || 'null'));
    assertEquals(slotMap[worldA], 0, `localStorage['cuubz:slotMap'] maps the new world id to slot 0`);
    assert(
      await page.evaluate(() => localStorage.getItem('cuubz:worldSlot:0:conf') !== null),
      "localStorage['cuubz:worldSlot:0:conf'] was written"
    );

    await page.click(`.world-slot[data-world-id="${worldA}"]`);
    await page.waitForSelector('#mode-screen:not(.hidden)');
    await page.click('#btn-survival');
    await page.waitForSelector('#hud:not(.hidden)', { timeout: GEN_TIMEOUT_MS });
    assert(true, 'Survival world loads and the HUD comes up (terrain generated)');
    await shot(page, '02-world-alpha-ingame');

    const entryPageErrors = drain(pageErrors);
    const entryReal = drain(consoleErrors).filter(e => !isNoise(e));
    assertEquals(entryPageErrors.length, 0,
      `Entering a world raises no uncaught exceptions${entryPageErrors.length ? ' — ' + entryPageErrors.map(e => e.text).join(' | ') : ''}`);
    assertEquals(entryReal.length, 0,
      `Entering a world logs no console errors${entryReal.length ? ' — ' + entryReal.map(e => e.text.slice(0, 120)).join(' | ') : ''}`);

    // PR 9 — both worker pools spawned. See the collector above for why this is an
    // assertion and not a note: the fallback is silent and terrain still appears.
    assertEquals(workerWarnings.length, 0,
      `Both worker pools initialised — terrain generation and meshing are off the main thread` +
      `${workerWarnings.length ? ' — ' + workerWarnings.join(' | ') : ''}`);
    const workerCounts = await page.evaluate(() => ({
      // The Blob URLs the pools were built from are the only observable trace of a
      // live worker from page scope; the pools themselves are closure locals inside
      // startGame() (refactor.md §1.6) until PR 12 hoists them.
      hardwareConcurrency: navigator.hardwareConcurrency || 0,
    }));
    assert(workerCounts.hardwareConcurrency > 0,
      `navigator.hardwareConcurrency is readable (${workerCounts.hardwareConcurrency}) — worker pool sizes derive from it`);

    await settleAndPause(page, 'world A first entry');
    await shot(page, '03-pause-menu');
    assert(await page.isVisible('#pause-menu'), '§7 step 5 — Escape opens the pause menu');

    // ═══ §7 step 10 — the live schema, read without upgrading ══
    console.log('\n[§7 step 10 — live IndexedDB schema (no upgrade triggered)]');
    const snapA1 = await readStorage(page, worldA);
    assertEquals(snapA1.upgradeFired, false,
      'Reading the schema did NOT fire onupgradeneeded (H-2: the handler deletes every object store)');
    assertEquals(snapA1.dbName, 'cuubz-worlds', 'Live database name');
    assertEquals(snapA1.dbVersion, 2, 'Live database version is 2 — DEPLOY.md §7 step 10 says STOP if it is not');
    assertEquals(snapA1.stores.join(','), 'chunks,manifests', 'Live object stores');
    assertEquals(snapA1.chunkKeyPath, 'chunkKey', "'chunks' keyPath");
    assertEquals(snapA1.manifestKeyPath, 'worldName', "'manifests' keyPath");
    assertEquals(snapA1.chunkIndexNames.join(','), 'worldName', "'chunks' declares exactly one index");
    assertEquals(snapA1.indexKeyPath, 'worldName', "The 'worldName' index keys off the worldName field");
    assertEquals(snapA1.indexUnique, false, "The 'worldName' index is non-unique (chunkmanager.js:274)");
    assert(snapA1.chunkCount > 0, `Chunks were persisted (${snapA1.chunkCount} records)`);
    assertEquals(snapA1.manifestKeys.length, 1, 'Exactly one manifest exists, keyed by the world id');
    assertEquals(snapA1.manifestKeys[0], worldA, "The manifest primary key is the world's id (main.js:2329)");
    assertEquals(snapA1.manifest.seed, SEED_A, '#world-seed pinned the manifest seed — terrain is deterministic');

    // ═══ §7 step 10 (bytes) — real stored chunk, decoded ══════
    // The header is asserted from the bytes the browser actually wrote, then the
    // whole record is decoded in Node with the production codec. That crossing —
    // browser-written bytes, Node-side decode with js/world/chunkBinaryCodec.js —
    // is the assertion that protects the on-disk format through Phase 1's module
    // conversion, where the codec is one of the files that moves.
    console.log('\n[DEPLOY.md §2.2 — header decoded from real stored bytes]');
    assert(snapA1.rec !== null, 'Chunk record "0,0" exists in the chunks store');
    const bufA1 = Buffer.from(snapA1.recBytes, 'base64');
    assertEquals(bufA1.length, snapA1.rec.byteLength, 'The stored ArrayBuffer survived the transfer intact');
    assert(bufA1.length > 20, `Stored chunk is header + data (${bufA1.length} bytes)`);

    const view = new DataView(bufA1.buffer, bufA1.byteOffset, bufA1.length);
    assertEquals(view.getUint32(0, true), 0x43555542, 'Stored magic at offset 0 is 0x43555542 "CUUB"');
    assertEquals(view.getUint8(4), 3, 'Stored format version at offset 4 is 3 (v3 Y-major)');
    assertEquals(view.getInt16(5, true), 0, 'Stored chunkX at offset 5 matches the "0,0" key');
    assertEquals(view.getInt16(7, true), 0, 'Stored chunkZ at offset 7 matches the "0,0" key');
    assertEquals(view.getUint16(9, true), 256, 'Stored chunk height at offset 9 is 256');
    assertEquals(view.getUint8(11), 0, 'Stored flags at offset 11 are 0 (the dirty bit is never persisted)');
    const runCount = view.getUint32(12, true);
    assert(runCount > 0, `Stored block-run count at offset 12 is non-zero (${runCount} runs)`);
    const usedBytes = 20 + runCount * 4; // each run is [blockID: Uint16, count: Uint16]

    // [D-15] FIXED in PR 6c. This block asserted the defect until PR 6c inverted it —
    // see the PR 6b write-up in refactor.md §5 for why asserting a defect is a gate
    // rather than an allowlist, and D-14 for the same lifecycle one PR earlier.
    //
    // The bug: chunkBinaryCodec.js sized the buffer as
    //     HEADER_SIZE + blockRuns.length * 4
    // while `blockRuns` is a FLAT Uint16Array of [id, count, id, count, …]. The run
    // count is blockRuns.length / 2, so the payload is blockRuns.length * 2 bytes.
    // Every stored chunk was allocated exactly double what was written and carried a
    // zero tail the same size as its real payload — measured here at 24,156 bytes
    // allocated / 12,088 used, ≈14 MB of zeroes per world.
    //
    // The assertion the fix makes true: the stored length is exactly the header plus
    // the runs the header says are there. There is no slack left to hide a
    // miscalculation in, which is why this is an equality and not a bound — the unit
    // test that missed D-15 for the life of the codec used `< actual * 1.5`.
    assertEquals(bufA1.length, usedBytes,
      `D-15 FIXED — the stored chunk is exactly its header plus its payload: ${bufA1.length} bytes for ` +
      `${runCount} runs (20 + ${runCount} × 4), zero padding. Pre-6c this was ${usedBytes * 2 - 20} bytes, ` +
      `half of it zeroes — ~${Math.round((usedBytes - 20) * snapA1.chunkCount / 1048576)} MB reclaimed across ` +
      `this world's ${snapA1.chunkCount} chunks`);
    assertEquals(bufA1.length % 4, 0, 'D-15 FIXED — the stored length is a whole number of 4-byte runs past the header');

    const { ChunkBinaryCodec } = require('../../src/engine/world/ChunkBinaryCodec.js');
    assertEquals(
      ChunkBinaryCodec.computeChecksum(new Uint8Array(bufA1.buffer, bufA1.byteOffset + 20, bufA1.length - 20)),
      view.getUint32(16, true),
      'FNV-1a checksum at offset 16 verifies against the payload the browser wrote'
    );
    let decoded = null;
    try {
      decoded = ChunkBinaryCodec.decode(bufA1.buffer.slice(bufA1.byteOffset, bufA1.byteOffset + bufA1.length));
      assert(true, 'Browser-written bytes decode with the production codec under Node');
    } catch (err) {
      assert(false, `Browser-written bytes decode with the production codec under Node (${err.message})`);
    }
    if (decoded) {
      assertEquals(decoded.blocks.length, 16 * 16 * 256, 'Decoded chunk holds 16 × 16 × 256 blocks');
      const maxId = decoded.blocks.reduce((m, b) => (b > m ? b : m), 0);
      assert(maxId > 0 && maxId < 193, `Decoded block ids are inside BLOCK_REGISTRY's range (max ${maxId})`);
    }
    // The manifest records the same checksum the header carries (chunkmanager.js:649),
    // so this must hold for a healthy world. H-1 breaks it — asserted below.
    assertEquals(snapA1.manifest.checksum00, snapA1.recStoredChecksum,
      "World A's manifest checksum for \"0,0\" matches the bytes stored under that key");

    // ═══ §7 step 6 — reload and re-enter (load-bearing) ═══════
    console.log('\n[§7 step 6 — reload the page, re-enter the same world]');
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#main-menu:not(.hidden)', { timeout: 30000 });
    await sleep(1500);
    const reloadReal = drain(consoleErrors).filter(e => !isNoise(e));
    drain(pageErrors);
    assertEquals(reloadReal.length, 0,
      `Reload with a saved world logs no console errors${reloadReal.length ? ' — ' + reloadReal.map(e => e.text.slice(0, 120)).join(' | ') : ''}`);

    const charsAfterReload = await page.evaluate(() => JSON.parse(localStorage.getItem('cuubz:characters') || '[]'));
    assertEquals(charsAfterReload.length, 1, 'The character survived the reload');

    await enterWorld(page, worldA, 'survival');
    await settleAndPause(page, 'world A after reload');
    const snapA2 = await readStorage(page, worldA);

    assert(snapA2.recBytes === snapA1.recBytes,
      'Chunk "0,0" is byte-for-byte identical after reload and re-entry — terrain was LOADED, not regenerated ' +
      `(${digest(snapA1.recBytes)} → ${digest(snapA2.recBytes)}, ${snapA1.rec.byteLength} bytes)`);
    assertEquals(snapA2.rec.savedAt, snapA1.rec.savedAt,
      'Chunk "0,0" savedAt is unchanged — the record was never rewritten');
    assertEquals(snapA2.chunkCount, snapA1.chunkCount, 'The stored chunk count is unchanged');
    assertEquals(snapA2.manifest.generatedCount, snapA1.manifest.generatedCount, 'The manifest chunk list is unchanged');
    assertEquals(snapA2.manifest.checksum00, snapA1.manifest.checksum00, 'The manifest checksum for "0,0" is unchanged');
    assertEquals(JSON.stringify(snapA2.manifest.spawnPoint), JSON.stringify(snapA1.manifest.spawnPoint),
      'The per-world spawn point survived the round trip');

    // §7 step 4/6 for PLACED and BROKEN blocks used to be reported UNVERIFIED here.
    // **PR 12 closed it** — see the "place and break a block, then reload" section near
    // the end of this run, which drives the real `setBlock` + `markChunkDirty` +
    // `flushDirty` path through `window.__cuubz.state`. It sits at the end rather than
    // here because every byte-identity assertion above ("chunk 0,0 is unchanged after a
    // reload") is only meaningful while the terrain is untouched; editing a block at this
    // point in the run would make those comparisons compare an edit to itself.
    note(
      '§7 step 4/6 driven from the MOUSE — the raycast, the 7-block range check, the ' +
      'AIR/CAVE_AIR guard and inventory.consumeSelectedBlock() all sit above the write ' +
      'path this harness now exercises',
      'Pointer lock. A headless driver cannot be granted it, so BlockInteraction.update() ' +
      'never resolves a target. The persistence half — an edited voxel surviving a reload — ' +
      'is asserted for real as of PR 12; only the input half is still manual.'
    );

    // ═══ §7 step 7 — quit to menu, re-enter, no reload ════════
    //
    // A stricter test than step 6, and the reason the checklist lists both: a
    // reload throws the whole JS context away, so step 6 can pass while teardown
    // leaks. This path keeps the context and exercises onExit — which is where
    // D-14 lived: `game.playerSync.reset()` does not exist on PlayerSyncManager,
    // so this used to throw partway through, skip showScreen('mainMenu'), and
    // leave every screen hidden. Fixed in this PR, so the step is now runnable
    // and asserted for real rather than reported UNVERIFIED.
    console.log('\n[§7 step 7 — quit to menu, re-enter without reloading]');
    drain(consoleErrors); drain(pageErrors);
    await page.click('#btn-exit-menu');
    await page.waitForSelector('#main-menu:not(.hidden)', { timeout: 30000 });
    assert(true, 'Exit to Menu returns to the main menu (D-14 regression guard)');

    const exitPageErrors = drain(pageErrors);
    assertEquals(exitPageErrors.length, 0,
      `Exit to Menu raises no uncaught exceptions${exitPageErrors.length ? ' — ' + exitPageErrors.map(e => e.text).join(' | ') : ''}`);
    // onExit hides every in-game overlay before returning to the menu (main.js:4515-4535).
    // A leftover visible overlay means teardown stopped early, which is exactly how D-14
    // presented.
    const strayOverlays = await page.evaluate(() => ['hud', 'pause-menu', 'debug-stats', 'crosshair']
      .filter(id => { const el = document.getElementById(id); return el && !el.classList.contains('hidden'); }));
    assertEquals(strayOverlays.length, 0,
      `Exit to Menu hides every in-game overlay${strayOverlays.length ? ' — still visible: ' + strayOverlays.join(', ') : ''}`);

    await enterWorld(page, worldA, 'survival');
    await settleAndPause(page, 'world A after quit-to-menu');
    const snapA2b = await readStorage(page, worldA);

    assert(snapA2b.recBytes === snapA1.recBytes,
      'Chunk "0,0" is byte-for-byte identical after quit-to-menu and re-entry — no reload involved ' +
      `(${digest(snapA1.recBytes)} → ${digest(snapA2b.recBytes)})`);
    assertEquals(snapA2b.rec.savedAt, snapA1.rec.savedAt,
      'Chunk "0,0" savedAt is unchanged across the quit-to-menu round trip');
    assertEquals(snapA2b.chunkCount, snapA1.chunkCount, 'The stored chunk count is unchanged across quit-to-menu');
    assertEquals(snapA2b.manifest.generatedCount, snapA1.manifest.generatedCount,
      'The manifest chunk list is unchanged across quit-to-menu');

    // ── The pause menu's day/night checkbox ──
    // main.js:4693 sets `checked = !game.skybox.timePaused`, so CHECKED means the
    // cycle is RUNNING. The control used to be labelled "Pause Time of Day", which
    // made ticking it un-pause time; PR 6b relabelled it rather than inverting the
    // logic, so no existing player's default changed. This guards the label against
    // drifting back out of step with the semantics. Asserting the actual
    // skybox.timePaused value needs PR 12-13 — `game` is a closure local.
    const dayNight = await page.evaluate(() => {
      const box = document.getElementById('pause-pause-time');
      return box ? { checked: box.checked, label: box.closest('label').textContent.trim() } : null;
    });
    assert(dayNight !== null, '#pause-pause-time exists in the pause menu');
    assertEquals(dayNight.label, 'Day/Night Cycle',
      'The day/night checkbox is labelled for what checked MEANS (checked = cycle running, main.js:4693)');
    assertEquals(dayNight.checked, true, 'It is checked on entry, i.e. the day/night cycle runs by default');

    // ═══ §7 step 11 — settings persist ════════════════════════
    console.log('\n[§7 step 11 — a graphics setting persists across a reload]');
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#main-menu:not(.hidden)', { timeout: 30000 });
    drain(consoleErrors); drain(pageErrors);
    await page.click('#btn-settings');
    await page.waitForSelector('#settings-screen:not(.hidden)');
    const rdBefore = await page.inputValue('#perf-render-distance');
    await page.selectOption('#perf-render-distance', '2');
    await sleep(800);
    const settingsWritten = await page.evaluate(() => localStorage.getItem('cuubz:settings'));
    assert(settingsWritten !== null, "Changing a setting writes localStorage['cuubz:settings']");
    assertEquals(JSON.parse(settingsWritten || '{}').renderDistance, 2,
      "localStorage['cuubz:settings'] reflects the change (performanceSettings.js:34,52)");
    assert(rdBefore !== '2', `The setting actually changed (was ${rdBefore}, now 2)`);

    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#main-menu:not(.hidden)', { timeout: 30000 });
    await page.click('#btn-settings');
    await page.waitForSelector('#settings-screen:not(.hidden)');
    assertEquals(await page.evaluate(() => localStorage.getItem('cuubz:settings')), settingsWritten,
      "localStorage['cuubz:settings'] is unchanged by the reload");
    assertEquals(await page.inputValue('#perf-render-distance'), '2',
      'The settings UI reads the persisted value back after a reload');
    await page.click('#btn-back-settings');

    // ═══ §7 steps 8-9 — H-1 ══════════════════════════════════
    //
    // [H-1] This is the section the whole harness was designed around, and as of
    // PR 6c it is the acceptance test for the fix rather than a record of the bug.
    //
    // PR 6b asserted the DEFECT here: world B generating chunk "0,0" overwrote world
    // A's record, because the chunks store's primary key was coordinate-only. One
    // visit to a second world destroyed 1,073 of world A's 1,184 saved chunks, and
    // re-entering A served B's spawn chunk byte for byte. All of it provable from
    // storage alone — no pointer lock, no block placement, which is why this harness
    // could observe a bug it could never have played its way into.
    //
    // PR 6c scoped the store key to `${worldName}:${cx},${cz}` and migrated existing
    // records at DB_VERSION 2. So the block is inverted, per the lifecycle D-14
    // demonstrated inside PR 6b: asserted defect → fixed → real regression test.
    // Every assertion below is now the property the fix establishes, and the two
    // load-bearing ones are that world A's bytes are UNCHANGED by B's visit and that
    // the store holds the SUM of both worlds rather than their overlap.
    console.log('\n[§7 steps 8-9 — H-1 two-world test — the fix, asserted]');
    await page.click('#btn-play-solo');
    await page.waitForSelector('#character-screen:not(.hidden)');
    await page.click('.char-slot[data-char-id]');
    await page.waitForSelector('#world-screen:not(.hidden)');
    const worldB = await createWorld(page, 'Beta', SEED_B);
    assert(worldB !== undefined && worldB !== worldA, 'A second world was created with a different id');
    const slotMap2 = await page.evaluate(() => JSON.parse(localStorage.getItem('cuubz:slotMap') || '{}'));
    assertEquals(slotMap2[worldB], 1, 'The second world took slot 1');

    await page.click(`.world-slot[data-world-id="${worldB}"]`);
    await page.waitForSelector('#mode-screen:not(.hidden)');
    await page.click('#btn-survival');
    await page.waitForSelector('#hud:not(.hidden)', { timeout: GEN_TIMEOUT_MS });
    await settleAndPause(page, 'world B first entry');
    await shot(page, '04-world-beta-ingame');

    const snapB = await readStorage(page, worldB);
    const snapAafterB = await readStorage(page, worldA);
    assertEquals(snapB.manifest.seed, SEED_B, 'World B generated from its own distinct seed');
    assertEquals(snapB.manifestKeys.length, 2, 'Manifests ARE per-world — both worlds have one (keyPath: worldName)');

    // ── Each world owns its own record at the same coordinates ──
    assertEquals(snapB.rec.worldName, worldB, 'H-1 FIXED — world B\'s chunk "0,0" record belongs to world B');
    assertEquals(snapB.rec.chunkKey, `${worldB}:0,0`, 'H-1 FIXED — it is stored under B\'s world-scoped key');
    assert(snapAafterB.rec !== null, 'H-1 FIXED — world A\'s chunk "0,0" record still EXISTS after visiting world B');
    assertEquals(snapAafterB.rec.chunkKey, `${worldA}:0,0`, 'H-1 FIXED — under A\'s own world-scoped key');
    assertEquals(snapAafterB.rec.worldName, worldA, 'H-1 FIXED — and it still belongs to world A');

    // ── The load-bearing inversion: B's visit did not touch A's bytes ──
    assert(snapAafterB.recBytes === snapA1.recBytes,
      'H-1 FIXED — world A\'s spawn chunk is byte-for-byte what it was before world B existed. This is the ' +
      `assertion PR 6b could not make: it used to read as B's bytes. (${digest(snapA1.recBytes)} → ${digest(snapAafterB.recBytes)})`);
    assertEquals(snapAafterB.rec.savedAt, snapA1.rec.savedAt,
      'H-1 FIXED — world A\'s record was never rewritten by world B\'s visit (savedAt unchanged)');
    assert(snapB.recBytes !== snapA1.recBytes,
      'H-1 FIXED — the two worlds hold DIFFERENT terrain at the same coordinates, i.e. two records rather than ' +
      `one shared one (A ${digest(snapA1.recBytes)} vs B ${digest(snapB.recBytes)}, distinct seeds)`);

    // ── The manifest and the bytes agree again ──
    assertEquals(snapAafterB.manifest.lists00, true, 'H-1 FIXED — world A\'s manifest still lists "0,0" as generated');
    assertEquals(snapAafterB.manifest.checksum00, snapAafterB.recStoredChecksum,
      `H-1 FIXED — world A's manifest checksum for "0,0" (${snapAafterB.manifest.checksum00}) matches the bytes ` +
      'stored under A\'s key. PR 6b measured 3799605976 recorded against 1653333176 stored; the divergence is gone.');

    // ── The store holds the SUM, not the overlap ──
    //
    // This is the same arithmetic PR 6b used to quantify the damage, run the other
    // way round. It reported "world-scoped keys would have left 2,393 records; the
    // store holds 1,320" — 1,073 of world A's 1,184 chunks destroyed. The store must
    // now hold both worlds in full.
    assertEquals(snapAafterB.worldChunkCount, snapA1.worldChunkCount,
      `H-1 FIXED — world A still owns every one of its ${snapA1.worldChunkCount} saved chunks after a full visit ` +
      'to world B. Pre-6c this dropped by 1,073.');
    assert(snapB.worldChunkCount > 0, `H-1 FIXED — world B owns its own ${snapB.worldChunkCount} chunk records`);
    assertEquals(snapB.chunkCount, snapAafterB.worldChunkCount + snapB.worldChunkCount,
      `H-1 FIXED — the store holds the SUM of both worlds and nothing else: ${snapAafterB.worldChunkCount} (A) + ` +
      `${snapB.worldChunkCount} (B) = ${snapB.chunkCount} records. Pre-6c the two worlds shared one keyspace and ` +
      'the total was the union of their coordinates, not the sum of their chunks.');
    assert(snapB.chunkCount > snapA1.chunkCount,
      `H-1 FIXED — the store GREW when world B was generated (${snapA1.chunkCount} → ${snapB.chunkCount}) rather ` +
      'than staying flat while B overwrote A');
    assertEquals(snapB.unscopedChunkCount, 0, 'H-1 FIXED — no record anywhere in the store has an unscoped key');
    assertEquals(snapB.legacyRec00, false, 'H-1 FIXED — nothing is stored under the bare pre-6c key "0,0"');

    console.log('\n[§7 step 9 — return to world A — the fix, asserted]');
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#main-menu:not(.hidden)', { timeout: 30000 });
    await sleep(1500);

    // ── Seed a PRE-MIGRATION record, then let the game open the database ──
    //
    // The migration is the half of H-1 that cannot be tested by playing forward: every
    // record this run has written is already world-scoped, so nothing here needs
    // migrating. This writes a record the way pre-6c code did — a bare `${cx},${cz}`
    // primary key with a `worldName` field beside it — and the world entry below is
    // what runs `_migrateToWorldScopedKeys` against it, from `_openDB`, at
    // DB_VERSION 2 with no upgrade handler involved (H-2).
    //
    // (99,99) is outside the 33×33 pre-generated region, so the record is never read
    // or regenerated during the run; only the migration touches it.
    const seeded = await page.evaluate(async (wid) => {
      const db = await new Promise((res, rej) => {
        const req = indexedDB.open('cuubz-worlds');
        req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
      });
      const { ChunkBinaryCodec, Chunk } = window.__cuubz;
      const data = ChunkBinaryCodec.encode(new Chunk(99, 99));
      const tx = db.transaction(['chunks'], 'readwrite');
      // Exactly the pre-6c write shape: chunkKey is the LOGICAL key.
      tx.objectStore('chunks').put({ chunkKey: '99,99', worldName: wid, data, savedAt: 12345 });
      await new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
      const check = db.transaction(['chunks'], 'readonly').objectStore('chunks');
      const before = await new Promise(r => { const q = check.get('99,99'); q.onsuccess = () => r(q.result); });
      db.close();
      return { written: before !== undefined, byteLength: before ? before.data.byteLength : 0, checksum: before ? new DataView(before.data).getUint32(16, true) : null };
    }, worldA);
    assert(seeded.written, `A pre-migration record was seeded under the bare key "99,99" (${seeded.byteLength} bytes)`);

    drain(consoleErrors); drain(pageErrors);
    await enterWorld(page, worldA, 'survival');
    await settleAndPause(page, 'world A re-entry after B');
    await shot(page, '05-world-alpha-intact');
    const snapA3 = await readStorage(page, worldA);

    assert(snapA3.recBytes === snapA1.recBytes,
      'H-1 step 9 FIXED — re-entering world A serves world A\'s OWN spawn chunk, byte for byte. This is the ' +
      `assertion the whole PR exists for. (${digest(snapA1.recBytes)} → ${digest(snapA3.recBytes)})`);
    assert(snapA3.recBytes !== snapB.recBytes,
      'H-1 step 9 FIXED — and it is not world B\'s chunk: the player is standing in their own world ' +
      `(A ${digest(snapA3.recBytes)} ≠ B ${digest(snapB.recBytes)})`);
    assertEquals(snapA3.rec.worldName, worldA,
      'H-1 step 9 FIXED — the record loaded while playing world A identifies itself as world A\'s');
    assertEquals(snapA3.rec.savedAt, snapA1.rec.savedAt,
      'H-1 step 9 FIXED — three round trips and two worlds later, world A\'s spawn chunk has never been rewritten');

    // ── The migration ran, against the record seeded above ──
    console.log('\n[PR 6c — the H-1 migration, against a DB seeded with pre-migration keys]');
    const migrated = await page.evaluate(async (wid) => {
      const db = await new Promise((res, rej) => {
        const req = indexedDB.open('cuubz-worlds');
        req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
      });
      const store = db.transaction(['chunks'], 'readonly').objectStore('chunks');
      const get = k => new Promise(r => { const q = store.get(k); q.onsuccess = () => r(q.result); });
      const oldRow = await get('99,99');
      const newRow = await get(`${wid}:99,99`);
      db.close();
      return {
        oldRowGone: oldRow === undefined,
        newRow: newRow ? {
          chunkKey: newRow.chunkKey, worldName: newRow.worldName, savedAt: newRow.savedAt,
          byteLength: newRow.data.byteLength, checksum: new DataView(newRow.data).getUint32(16, true),
        } : null,
      };
    }, worldA);

    assert(migrated.newRow !== null, `The seeded record was re-keyed to "${worldA}:99,99" by the migration`);
    assertEquals(migrated.oldRowGone, true, 'The bare "99,99" row is gone — re-keyed, not copied');
    if (migrated.newRow) {
      assertEquals(migrated.newRow.chunkKey, `${worldA}:99,99`, 'The record\'s own chunkKey field was rewritten to match its new primary key');
      assertEquals(migrated.newRow.worldName, worldA, 'The record migrated under ITS OWN worldName');
      assertEquals(migrated.newRow.byteLength, seeded.byteLength, 'The migrated payload is the same length');
      assertEquals(migrated.newRow.checksum, seeded.checksum, 'The migrated payload is byte-identical — the migration moves records, it does not re-encode them');
      assertEquals(migrated.newRow.savedAt, 12345, 'savedAt is preserved, so a migrated chunk does not look freshly written');
    }
    assertEquals(snapA3.unscopedChunkCount, 0,
      'After the migration no record anywhere in the store has an unscoped key — including the one seeded as bare');
    assertEquals(snapA3.worldChunkCount, snapA1.worldChunkCount + 1,
      `World A owns its ${snapA1.worldChunkCount} chunks plus the migrated record, and lost none of them`);

    // ═══ PR 6d — H-2: a DB_VERSION increment is survivable ═════
    //
    // The accept criterion, run against real IndexedDB rather than the stub in
    // test/test_chunkStorage.js: seed a version-2 database with real chunk and
    // manifest records, then increment the version through the shipped upgrade
    // handler and prove every record is still there, byte for byte.
    //
    // It runs against a SEPARATE database name. `cuubz-worlds` is the live one this
    // whole run has been asserting against, and a test that drives an upgrade over
    // it would be betting the other ~140 assertions on the thing under test. The
    // ladder is name-agnostic — `ChunkManager._applySchemaUpgrade` receives the
    // database, not the name — so the proof is unaffected and the blast radius is a
    // database that is deleted three lines later.
    //
    // Version 3 has no step in shipped code (by design: rule 2 makes an unregistered
    // version throw), so the test registers one that creates a real object store.
    // "The upgrade did nothing" would prove nothing.
    console.log('\n[PR 6d — H-2: increment DB_VERSION over a seeded v2 database]');
    const upgradeResult = await page.evaluate(async () => {
      const { ChunkManager, ChunkBinaryCodec, Chunk, BLOCK_TYPES } = window.__cuubz;
      const NAME = 'cuubz-h2-upgrade-probe';
      const out = { errors: [] };
      const del = () => new Promise((res) => {
        const r = indexedDB.deleteDatabase(NAME);
        r.onsuccess = r.onerror = r.onblocked = () => res();
      });
      // A leftover from an interrupted previous run would make this meaningless.
      await del();

      const openWith = (version, upgradeStep) => new Promise((res, rej) => {
        const req = indexedDB.open(NAME, version);
        req.onupgradeneeded = (e) => {
          try {
            if (upgradeStep) ChunkManager.SCHEMA_STEPS[version] = upgradeStep;
            out.applied = ChunkManager._applySchemaUpgrade(
              e.target.result, e.target.transaction, e.oldVersion, e.newVersion
            );
          } finally {
            if (upgradeStep) delete ChunkManager.SCHEMA_STEPS[version];
          }
        };
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });

      try {
        // ── Seed: a version-2 database built by the shipped handler, holding real
        //    encoded chunks and a real manifest.
        let db = await openWith(2, null);
        out.seedVersion = db.version;
        out.seedStores = Array.from(db.objectStoreNames).sort();

        // Each probe chunk gets DIFFERENT blocks in it, and that is not decoration.
        // An empty `new Chunk(cx, cz)` RLE-encodes to the same 28 bytes whatever its
        // coordinates are, so three empty chunks share one checksum and "the
        // checksums match after the upgrade" would be satisfied by any three records
        // at all. Distinct contents make the per-record byte comparison below
        // actually discriminate between records.
        const chunks = [
          { cx: 0, cz: 0, world: 'probe-world-A', fill: 1 },
          { cx: -3, cz: 7, world: 'probe-world-A', fill: 5 },
          { cx: 12, cz: -8, world: 'probe-world-B', fill: 11 },
        ].map(({ cx, cz, world, fill }) => ({
          chunkKey: `${world}:${cx},${cz}`,
          worldName: world,
          data: ChunkBinaryCodec.encode((() => {
            const c = new Chunk(cx, cz);
            for (let x = 0; x < fill; x++) {
              for (let z = 0; z < fill; z++) c.setBlock(x, 64, z, BLOCK_TYPES.STONE);
            }
            return c;
          })()),
          savedAt: 1700000000000 + cx,
        }));
        const manifest = {
          worldName: 'probe-world-A', seed: '424242',
          generatedChunks: chunks.filter(c => c.worldName === 'probe-world-A')
            .map(c => ({ key: c.chunkKey.split(':')[1], checksum: new DataView(c.data).getUint32(16, true) })),
        };

        let tx = db.transaction(['chunks', 'manifests'], 'readwrite');
        chunks.forEach(c => tx.objectStore('chunks').put(c));
        tx.objectStore('manifests').put(manifest);
        await new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });

        const readAll = async (database) => {
          const t = database.transaction(['chunks', 'manifests'], 'readonly');
          // Both requests are issued before either is awaited. A transaction commits
          // once its request queue drains, and awaiting between two `getAll`s is
          // exactly how you get a TransactionInactiveError on the second one.
          const grab = (store) => new Promise((res) => {
            const q = t.objectStore(store).getAll();
            q.onsuccess = () => res(q.result || []);
          });
          const pending = [grab('chunks'), grab('manifests')];
          const [c, m] = await Promise.all(pending);
          return {
            chunks: c.map(r => ({
              chunkKey: r.chunkKey, worldName: r.worldName, savedAt: r.savedAt,
              byteLength: r.data.byteLength, checksum: new DataView(r.data).getUint32(16, true),
            })).sort((a, b) => a.chunkKey.localeCompare(b.chunkKey)),
            manifests: m.map(r => ({ worldName: r.worldName, seed: r.seed, generatedChunks: r.generatedChunks })),
          };
        };

        out.before = await readAll(db);
        db.close();

        // ── The increment. 2 → 3, through the shipped ladder.
        db = await openWith(3, (d) => ChunkManager._ensureStore(d, 'probeStore', { keyPath: 'id' }));
        out.afterVersion = db.version;
        out.afterStores = Array.from(db.objectStoreNames).sort();
        out.after = await readAll(db);
        db.close();
      } catch (err) {
        out.errors.push(String(err && err.message ? err.message : err));
      } finally {
        await del();
      }
      return out;
    });

    assertEquals(upgradeResult.errors.length, 0,
      `The 2 → 3 upgrade completed without throwing${upgradeResult.errors.length ? ' — ' + upgradeResult.errors.join(' | ') : ''}`);
    assertEquals(upgradeResult.seedVersion, 2, 'The seeded probe database was created at version 2 by the shipped upgrade handler');
    assertEquals((upgradeResult.seedStores || []).join(','), 'chunks,manifests',
      'The shipped handler creates exactly the two DEPLOY.md §2.1 stores on a fresh database');
    assertEquals((upgradeResult.before && upgradeResult.before.chunks.length) || 0, 3, 'Three chunk records were seeded');
    assertEquals(new Set((upgradeResult.before || { chunks: [] }).chunks.map(c => c.checksum)).size, 3,
      'The three seeded chunks carry three DIFFERENT checksums — so the byte comparison below discriminates ' +
      'between records rather than being satisfied by any three all-air chunks');
    assertEquals(upgradeResult.afterVersion, 3, 'H-2 FIXED — DB_VERSION was incremented to 3 against a pre-existing v2 database');
    assertEquals((upgradeResult.applied || []).join(','), '3', 'Only the step for version 3 ran');
    assertEquals((upgradeResult.afterStores || []).join(','), 'chunks,manifests,probeStore',
      'H-2 FIXED — the new store was added ALONGSIDE the existing two, which is a real schema change, not a no-op');
    assertEquals(
      JSON.stringify(upgradeResult.after && upgradeResult.after.chunks),
      JSON.stringify(upgradeResult.before && upgradeResult.before.chunks),
      'H-2 FIXED — every chunk record survives the increment byte for byte: same keys, same worldNames, same lengths, ' +
      'same header checksums, same savedAt. Pre-6d the handler deleted every object store here and this was 3 → 0.');
    assertEquals(
      JSON.stringify(upgradeResult.after && upgradeResult.after.manifests),
      JSON.stringify(upgradeResult.before && upgradeResult.before.manifests),
      'H-2 FIXED — the manifest survives the increment, checksums included, so the load-time integrity check keeps its baseline');

    // The live database must be exactly where the rest of the run left it.
    const snapAfterProbe = await readStorage(page, worldA);
    assertEquals(snapAfterProbe.dbVersion, 2, 'The real cuubz-worlds database is still at version 2 — the probe touched a different database');
    assertEquals(snapAfterProbe.chunkCount, snapA3.chunkCount, 'The real database holds the same number of chunk records as before the probe');

    // ═══ §7 steps 4 + 6/7 — PLAYER EDITS round-trip (PR 12) ════
    //
    // These two steps were reported UNVERIFIED from PR 6b until now, and the reason was
    // not pointer lock. It was that the running `chunkManager` was a closure local inside
    // `startGame()`'s `setTimeout` body (refactor.md §1.6), so `page.evaluate` could not
    // name it and the harness had no way to modify a block at all. **PR 12 hoisted it onto
    // `GameState` and published that as `window.__cuubz.state`, and this block is what
    // that bought.**
    //
    // WHAT THIS DRIVES, EXACTLY. Not synthetic writes: the two calls below are the two
    // `BlockInteraction._doPlace()` makes once its raycast has succeeded
    // (`BlockInteractionSystem.js:447-444`) — `chunkData.setBlock(lx, y, lz, type)` then
    // `chunkManager.markChunkDirty(cx, cz)` — and `flushDirty()` is the method the 5 s
    // dirty timer calls. So everything from the voxel write to the IndexedDB record to the
    // manifest checksum is production code.
    //
    // WHAT IT STILL DOES NOT COVER, and it is worth being exact about: the raycast, the
    // range check, the AIR/CAVE_AIR guard and `inventory.consumeSelectedBlock()` all sit
    // ABOVE these calls in `_doPlace`, and pointer lock is what a headless driver cannot
    // grant. So this proves **an edited voxel survives a reload**, which is what §7 steps
    // 4 and 6/7 ask; it does not prove that clicking the mouse produces the edit. That
    // half stays manual and is noted below.
    //
    // THE BREAK IS THE STRONGER HALF. Placing a distinctive block proves an edit was
    // written. *Breaking* a generated block proves the world was LOADED rather than
    // regenerated: this world has a fixed seed, so if re-entry regenerated the terrain the
    // broken block would be back. AIR at that coordinate after a full page reload can only
    // come from storage.
    console.log('\n[§7 steps 4 + 6/7 — place and break a block, then reload]');

    const bridged = await page.evaluate(() => {
      const s = window.__cuubz.state;
      return s ? { present: true, hasChunkManager: !!s.chunkManager, hasInventory: !!s.inventory,
        hasBlockInteraction: !!s.blockInteraction, hasPlayer: !!s.player, hasGame: !!s.game } : { present: false };
    });
    assertEquals(bridged.present, true,
      'PR 12 — window.__cuubz.state is the live GameState; the harness can reach running game state at all');
    assertEquals(bridged.hasChunkManager && bridged.hasInventory && bridged.hasBlockInteraction &&
      bridged.hasPlayer && bridged.hasGame, true,
      'PR 12 — chunkManager, inventory, blockInteraction, player and the Game instance are all reachable ' +
      '(they were closure locals until this PR — refactor.md §1.6)');

    // Chunk (0,0), local column x=8 z=8. `EDIT_PLACE_Y` is above any terrain this
    // generator produces and below CHUNK_HEIGHT, so it is guaranteed AIR.
    const EDIT_PLACE_Y = 200;
    const edit = await page.evaluate((placeY) => {
      const s = window.__cuubz.state;
      const cm = s.chunkManager;
      const BT = window.__cuubz.BLOCK_TYPES;
      const cd = cm.getChunkData(0, 0);
      if (!cd) return { error: 'chunk (0,0) is not in memory' };

      const placeType = BT.GLOWSTONE !== undefined ? BT.GLOWSTONE : BT.STONE;

      // ── Place: the two calls BlockInteraction._doPlace() makes after its raycast.
      const placeBefore = cd.getBlock(8, placeY, 8);
      const placeChanged = cd.setBlock(8, placeY, 8, placeType);
      cm.markChunkDirty(0, 0);

      // ── Break: scan down for the highest solid block in the same column and remove it.
      let breakY = -1, brokenType = -1;
      for (let y = placeY - 1; y > 0; y--) {
        const b = cd.getBlock(8, y, 8);
        if (b !== BT.AIR && b !== BT.CAVE_AIR && b !== BT.WATER) { breakY = y; brokenType = b; break; }
      }
      let breakChanged = false;
      if (breakY >= 0) {
        breakChanged = cd.setBlock(8, breakY, 8, BT.AIR);
        cm.markChunkDirty(0, 0);
      }

      return {
        placeType, placeBefore, placeChanged, breakY, brokenType, breakChanged,
        dirty: cd.dirty,
        // Read back through the same public accessor the game uses.
        placeInMemory: cm.getVoxel(8, placeY, 8),
        breakInMemory: breakY >= 0 ? cm.getVoxel(8, breakY, 8) : null,
        airId: BT.AIR,
      };
    }, EDIT_PLACE_Y);

    assert(!edit.error, `Chunk (0,0) is resident in memory for the edit${edit.error ? ' — ' + edit.error : ''}`);
    assertEquals(edit.placeBefore, edit.airId, `(8, ${EDIT_PLACE_Y}, 8) was AIR before the placement`);
    assertEquals(edit.placeChanged, true, 'setBlock reports the placement actually changed a voxel');
    assert(edit.breakY > 0, `A generated solid block was found to break in column (8, *, 8) — at y=${edit.breakY}, type ${edit.brokenType}`);
    assertEquals(edit.breakChanged, true, 'setBlock reports the break actually changed a voxel');
    assertEquals(edit.placeInMemory, edit.placeType, 'The placed block reads back through chunkManager.getVoxel in memory');
    assertEquals(edit.breakInMemory, edit.airId, 'The broken block reads back as AIR through chunkManager.getVoxel in memory');
    assertEquals(edit.dirty, true, 'The chunk is marked dirty, so the 5 s flush timer would pick it up');

    // Flush through the production path rather than waiting on the timer. The game is
    // paused at this point in the run and `resumeGame()` is what restarts the interval
    // (main.js setupPauseMenu), so waiting would be waiting on a stopped timer.
    // `flushDirty()` is the exact method `startFlushTimer(5000)` calls.
    await page.evaluate(async () => { await window.__cuubz.state.chunkManager.flushDirty(); });
    await sleep(1500); // let the batched write transaction commit

    const snapEdited = await readStorage(page, worldA);
    assert(snapEdited.recBytes !== snapA1.recBytes,
      'Chunk "0,0" bytes CHANGED on disk after the edit — the flush wrote the player\'s modification ' +
      `(${digest(snapA1.recBytes)} → ${digest(snapEdited.recBytes)})`);
    assertEquals(snapEdited.manifest.checksum00, snapEdited.recStoredChecksum,
      'The manifest checksum was rewritten in the same transaction as the edited chunk (D-19 regression guard)');

    // ── Reload: new JS context, empty memory cache. Anything that reads back now came
    //    off disk.
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#main-menu:not(.hidden)', { timeout: 30000 });
    await sleep(1500);
    drain(consoleErrors); drain(pageErrors);
    await enterWorld(page, worldA, 'survival');
    await waitForQuiesce(page, 'world A after the block edit');

    const afterReload = await page.evaluate((args) => {
      const cm = window.__cuubz.state.chunkManager;
      return {
        placed: cm.getVoxel(8, args.placeY, 8),
        broken: cm.getVoxel(8, args.breakY, 8),
      };
    }, { placeY: EDIT_PLACE_Y, breakY: edit.breakY });

    assertEquals(afterReload.placed, edit.placeType,
      `§7 step 4/6 — the PLACED block is still at (8, ${EDIT_PLACE_Y}, 8) after a full page reload and re-entry ` +
      '(type ' + edit.placeType + '). This assertion has been waiting since PR 6b');
    assertEquals(afterReload.broken, edit.airId,
      `§7 step 4/6 — the BROKEN block at (8, ${edit.breakY}, 8) is still AIR after the reload. The seed is fixed, ` +
      `so a regenerated world would have block ${edit.brokenType} here — AIR proves the chunk was loaded from storage`);

    await settleAndPause(page, 'world A after the edit round trip');

    // Exit cleanly one last time, so the final screenshot is the menu the player
    // is actually returned to rather than a mid-session frame.
    console.log('\n[Teardown — exit to menu]');
    drain(consoleErrors); drain(pageErrors);
    await page.click('#btn-exit-menu');
    await page.waitForSelector('#main-menu:not(.hidden)', { timeout: 30000 });
    await shot(page, '06-exit-to-menu');
    const teardownErrors = drain(pageErrors);
    assertEquals(teardownErrors.length, 0,
      `The second Exit to Menu of the run is also clean${teardownErrors.length ? ' — ' + teardownErrors.map(e => e.text).join(' | ') : ''}`);

    // ═══ PR 14 — the DESTRUCTIVE half of the CRUD surface ═════
    //
    // Everything above this line exercises create → enter → reload → re-enter. Nothing in
    // the 166 assertions that preceded PR 14 ever called `deleteWorld`, `deleteCharacter`
    // or `updateCharacter` — which is exactly where PR 14's risk was, because
    // `BrowserWorldManager.deleteWorld` held the only copy of the **D-18 + H-3 chunk
    // cleanup** and PR 14 moved it into `PersistenceManager.deleteWorld()`. Reading the
    // two implementations side by side would not have proved the move. This does.
    //
    // Ordering matters. World B is deleted, world A is not, and world A's records are
    // snapshotted immediately before and after. A key range one character wrong would take
    // A's chunks with B's, and that pair of snapshots is what catches it.
    console.log('\n[PR 14 — updateCharacter, deleteCharacter, deleteWorld]');
    drain(consoleErrors); drain(pageErrors);

    const snapBbeforeDelete = await readStorage(page, worldB);
    const snapAbeforeDelete = await readStorage(page, worldA);
    assert(snapBbeforeDelete.worldChunkCount > 0,
      `PR 14 baseline — world B owns ${snapBbeforeDelete.worldChunkCount} chunk records before the delete`);
    assert(snapBbeforeDelete.manifestKeys.includes(worldB),
      'PR 14 baseline — world B has a manifest record before the delete');

    // ── updateCharacter: rename through the edit modal ─────────────────────
    await page.click('#btn-play-solo');
    await page.waitForSelector('#character-screen:not(.hidden)');
    const charIdBefore = await page.$eval('.char-slot[data-char-id]', el => el.dataset.charId);
    await page.click('.char-slot[data-char-id] [data-action="edit"]');
    await page.waitForSelector('#create-char-modal:not(.hidden)');
    await page.fill('#char-name', 'E2E Renamed');
    await page.click('#btn-save-char');
    // Not waitForSelector('#create-char-modal.hidden') — that waits for VISIBLE, and a
    // .hidden modal never becomes visible, so it burns the full timeout and fails green.
    await page.waitForFunction(() =>
      document.getElementById('create-char-modal').classList.contains('hidden'));

    const afterRename = await page.evaluate(() => JSON.parse(localStorage.getItem('cuubz:characters') || '[]'));
    assertEquals(afterRename.length, 1, 'updateCharacter did not create a second character');
    assertEquals(afterRename[0].name, 'E2E Renamed',
      "updateCharacter — the new name round-trips through localStorage['cuubz:characters']");
    assertEquals(afterRename[0].id, charIdBefore,
      'updateCharacter — the id is unchanged, so this was an update and not a create-and-replace');

    // ── deleteCharacter: create a second character, then remove it ─────────
    await page.click('#btn-create-char');
    await page.waitForSelector('#create-char-modal:not(.hidden)');
    await page.fill('#char-name', 'Doomed');
    await page.click('#btn-save-char');
    await page.waitForFunction(() => document.querySelectorAll('.char-slot[data-char-id]').length === 2);
    const doomedId = await page.evaluate(() =>
      (JSON.parse(localStorage.getItem('cuubz:characters') || '[]').find(c => c.name === 'Doomed') || {}).id);
    assert(!!doomedId, 'A second character was created for the delete path');

    await page.click(`.char-slot[data-char-id="${doomedId}"] [data-action="delete"]`);
    await page.waitForSelector('#delete-char-modal:not(.hidden)');
    await page.click('#btn-confirm-delete-char');
    await page.waitForFunction(() => document.querySelectorAll('.char-slot[data-char-id]').length === 1);

    const afterCharDelete = await page.evaluate(() => JSON.parse(localStorage.getItem('cuubz:characters') || '[]'));
    assertEquals(afterCharDelete.length, 1,
      "deleteCharacter — localStorage['cuubz:characters'] holds one character again");
    assertEquals(afterCharDelete[0].id, charIdBefore,
      'deleteCharacter — it removed the character that was asked for, not the other one');

    // ── deleteWorld: the D-18 / H-3 chunk cleanup, measured ───────────────
    await page.click(`.char-slot[data-char-id="${charIdBefore}"]`);
    await page.waitForSelector('#world-screen:not(.hidden)');
    await page.click(`.world-slot[data-world-id="${worldB}"] [data-action="delete"]`);
    await page.waitForSelector('#delete-char-modal:not(.hidden)');
    await page.click('#btn-confirm-delete-char');
    await page.waitForFunction(
      id => document.querySelector(`.world-slot[data-world-id="${id}"]`) === null, worldB);
    await sleep(1500); // the IndexedDB delete transaction is not awaited by the click handler

    const snapBafterDelete = await readStorage(page, worldB);
    assertEquals(snapBafterDelete.worldChunkCount, 0,
      `D-18 — deleting world B removed all ${snapBbeforeDelete.worldChunkCount} of its chunk records from ` +
      'IndexedDB. This is the fix PR 14 moved out of main.js into PersistenceManager.deleteWorld()');
    assertEquals(snapBafterDelete.manifestKeys.includes(worldB), false,
      "D-18 — world B's manifest record was deleted in the same transaction as its chunks");

    const snapAafterDelete = await readStorage(page, worldA);
    assertEquals(snapAafterDelete.worldChunkCount, snapAbeforeDelete.worldChunkCount,
      `World A still owns every one of its ${snapAbeforeDelete.worldChunkCount} chunk records — the key range ` +
      "took B's and only B's");
    assertEquals(snapAafterDelete.recBytes, snapAbeforeDelete.recBytes,
      'World A\'s chunk "0,0" is byte-identical across the deletion of world B');
    assertEquals(snapAafterDelete.chunkCount, snapAafterDelete.worldChunkCount,
      "The chunks store now holds exactly world A's records — nothing of B's was left orphaned");

    const lsAfterDelete = await page.evaluate(() => ({
      slotMap: JSON.parse(localStorage.getItem('cuubz:slotMap') || '{}'),
      conf1: localStorage.getItem('cuubz:worldSlot:1:conf'),
      conf0: localStorage.getItem('cuubz:worldSlot:0:conf'),
    }));
    assertEquals(lsAfterDelete.slotMap[worldB], undefined,
      "deleteWorld — world B's entry is gone from localStorage['cuubz:slotMap']");
    assertEquals(lsAfterDelete.conf1, null,
      "deleteWorld — 'cuubz:worldSlot:1:conf' was cleared (world B held slot 1)");
    assert(lsAfterDelete.conf0 !== null && lsAfterDelete.conf0.indexOf(worldA) !== -1,
      "deleteWorld — world A's slot-0 config is untouched");

    const deletePathErrors = drain(pageErrors);
    assertEquals(deletePathErrors.length, 0,
      `The delete path raised no page errors${deletePathErrors.length ? ' — ' + deletePathErrors.map(e => e.text).join(' | ') : ''}`);

    // Back to the main menu, so the tree-clean check below runs from where it always has.
    await page.click('#btn-back-world');
    await page.waitForSelector('#character-screen:not(.hidden)');
    await page.click('#btn-back-char');
    await page.waitForSelector('#main-menu:not(.hidden)');

    note(
      '§7 steps 12-13 — multiplayer host/guest persistence, and the browser half of the ' +
      'session layer generally (BUGS.md D-48, owned by PR 31)',
      'Needs a running relay (server/index.js on 8765 as a child process) and two browser ' +
      'contexts. Nothing in this file clicks #btn-host or #btn-join, so the relay handshake, ' +
      'JOIN_ACCEPTED arriving over a real socket and startGame() on a joining client are all ' +
      'unexercised — which is what let D-43 sit under five green runs. The way in is the ' +
      '?relayUrl= query parameter getRelayUrl already honours; PR 16 added assertions for it ' +
      'in test/test_relayUrl.js precisely so a harness can rely on it. PR 16 covered the ' +
      "session layer's LOGIC instead — test/test_sessionRecord.js drives the real " +
      'SessionManager and StorageHelper with 51 assertions inside npm test, so a D-43 ' +
      'regression goes red on every push rather than at a phase gate. What is left here is ' +
      'two-context orchestration, which is a harness change, not a source one.'
    );

    // ═══ §7 step 14 — the run left the tree alone ═════════════
    console.log('\n[§7 step 14 — the harness leaves the working tree unchanged]');
    const gitAfter = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
    assert(gitAfter === gitBefore,
      'git status --porcelain is byte-identical before and after the run (artifacts/ is gitignored)' +
      (gitAfter === gitBefore ? '' : `\n     before:\n${gitBefore}\n     after:\n${gitAfter}`));

    // ═══ Screenshot artifacts ════════════════════════════════
    //
    // SwiftShader does not render identically to a GPU, so a baseline captured here
    // is comparable ONLY to another SwiftShader run on the same Chromium. These
    // images are a self-consistent regression gate for PR 9's "zero visual change"
    // claim; they are NOT evidence that the game looks correct.
    console.log('\n[Screenshot artifacts]');
    const shots = fs.readdirSync(ARTIFACTS).filter(f => f.endsWith('.png'));
    assertEquals(shots.length, 6, `Six screenshots written to test/e2e/artifacts/ (${shots.join(', ')})`);
    assert(shots.every(f => fs.statSync(path.join(ARTIFACTS, f)).size > 1024), 'Every screenshot is non-trivially sized');
  } catch (err) {
    assert(false, `Harness ran to completion (${err.message})`);
    try { await shot(page, '99-failure'); } catch { /* the page may already be gone */ }
  } finally {
    await browser.close();
    await server.close();
  }

  finish();
}

function finish() {
  console.log('\n==============================================');
  console.log(`Results: ${passCount} passed, ${failCount} failed`);

  if (unverified.length > 0) {
    console.log(`\n⚠️  ${unverified.length} checklist items NOT verified by this harness:`);
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
  console.log('\n🎉 DEPLOY.md §7 save/load harness passing!');
  console.log('   No block in here asserts a known defect any more. PR 6b introduced three');
  console.log('   (D-14, D-15, H-1) under the rule that a run goes red when a known failure');
  console.log('   STOPS reproducing, so fixing one forces its block to be rewritten into the');
  console.log('   assertion the fix makes true. D-14 went that way inside PR 6b; D-15 and H-1');
  console.log('   went that way in PR 6c, and steps 8-9 are now the H-1 regression test.');
  console.log('   If a future PR needs the pattern again, see refactor.md §5 PR 6b.');
  process.exit(0);
}

main().catch(err => {
  console.error(`\nHarness crashed outside the assertion scope: ${err.stack}`);
  process.exit(1);
});
