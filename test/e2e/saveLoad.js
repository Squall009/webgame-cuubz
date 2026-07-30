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
 * `page.evaluate` can reach every one of the 368 top-level lexical symbols
 * (`BLOCK_TYPES`, `ChunkManager`, `CHUNK_MAGIC`, …) even though they are not
 * `window` properties — same mechanism as PR 4 bug 1 and refactor.md §2.4.
 *
 * It cannot reach live game state. Only four things are on `window`
 * (`CuubzGame`, `CuubzBlockPalette`, `MobIntegration`, `CuubzLogger`) and all four
 * are classes, not instances. The running `renderer` / `chunkManager` / `player` /
 * `inventory` are among the ~184 closure locals inside `startGame()`'s `setTimeout`
 * (refactor.md §1.6). So this harness can click and type, but it cannot say
 * "place block 2 at (14,68,-3)" or read the player's position. That unblocks at
 * Phase 2 (PR 12–13), when those locals are hoisted onto an explicit `Game`.
 *
 * The design consequence: every persistence assertion here reads IndexedDB and
 * localStorage directly instead of simulating a player. That is why H-1 is provable
 * with no pointer lock and no mouse-look at all — see [H-1] below.
 *
 * WHAT IT CANNOT VERIFY — see the UNVERIFIED summary it prints at the end.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const ARTIFACTS = path.join(__dirname, 'artifacts');
const HEADED = process.argv.includes('--headed');

// SwiftShader software WebGL. Verified to produce a working WebGL2 context under
// headless Edge: glRenderer reports "ANGLE (Google, Vulkan 1.3.0 (SwiftShader
// Device (Subzero)), SwiftShader driver)". --enable-unsafe-swiftshader is required
// as of Chromium 130+; without it the context is refused in headless.
const CHROME_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'];

// Fixed seeds. #world-seed (index.html:154) pins terrain generation, which is what
// makes "the bytes are identical after a reload" a legitimate assertion rather
// than a coin flip. Two different seeds so H-1's overwrite is visible in the bytes.
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
// Opens `cuubz-worlds` with NO version argument. That reads the current version
// without triggering `onupgradeneeded`, which matters a great deal here:
// DEPLOY.md §2.1 / H-2 — the upgrade handler deletes every object store before
// recreating it, so a harness that opened with an explicit version and got the
// number wrong would destroy the very data it is inspecting. `onupgradeneeded`
// firing is reported as an error rather than tolerated.
//
// This is safe only because the database already exists by the time it runs;
// opening a NON-existent DB with no version is H-3 (creates a store-less v1).
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

  const rec = await get(chunks, '0,0');
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

  fs.mkdirSync(ARTIFACTS, { recursive: true });

  const { start } = require('./staticServer');
  const server = await start(path.resolve(ROOT), 0);
  console.log(`  ℹ  serving ${ROOT} at ${server.url}`);

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
  page.on('console', m => {
    if (m.type() === 'error') consoleErrors.push({ text: m.text(), url: m.location().url });
  });
  page.on('pageerror', e => pageErrors.push({ text: e.message, url: '' }));

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
      return {
        hasContext: !!gl,
        version: gl ? gl.getParameter(gl.VERSION) : null,
        renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null,
        threeLoadFailed: window.__THREE_LOAD_FAILED === true,
        threeType: typeof THREE,
        revision: typeof THREE !== 'undefined' ? THREE.REVISION : null,
      };
    });
    assert(gfx.hasContext, `A WebGL context is available (${gfx.version})`);
    assert(/SwiftShader|ANGLE/.test(gfx.renderer || ''), `glRenderer is a real rasteriser (${gfx.renderer})`);
    assertEquals(gfx.threeLoadFailed, false, 'window.__THREE_LOAD_FAILED is not set (index.html:9 onerror)');
    assertEquals(gfx.threeType, 'object', 'THREE is loaded');
    // refactor.md §1.2 — three is pinned at r134 and PR 8 must keep it there.
    assertEquals(gfx.revision, '134', 'THREE.REVISION is r134');

    // ═══ DEPLOY.md §2 invariants, read from the running page ══
    // Not from source text: these are the values the browser actually holds.
    // Reachable because top-level `const` in a classic <script> is a lexical
    // binding in global scope — refactor.md §2.4.
    console.log('\n[DEPLOY.md §2.1 — IndexedDB constants]');
    const inv = await page.evaluate(() => ({
      dbName: typeof DB_NAME !== 'undefined' ? DB_NAME : null,
      dbVersion: typeof DB_VERSION !== 'undefined' ? DB_VERSION : null,
      storeChunks: typeof STORE_CHUNKS !== 'undefined' ? STORE_CHUNKS : null,
      storeManifests: typeof STORE_MANIFESTS !== 'undefined' ? STORE_MANIFESTS : null,
      chunkW: typeof CHUNK_W !== 'undefined' ? CHUNK_W : null,
      chunkD: typeof CHUNK_D !== 'undefined' ? CHUNK_D : null,
      chunkKeyFormat: typeof ChunkManager !== 'undefined' ? ChunkManager.key(-3, 7) : null,
      magic: typeof CHUNK_MAGIC !== 'undefined' ? CHUNK_MAGIC : null,
      codecVersion: typeof CHUNK_VERSION !== 'undefined' ? CHUNK_VERSION : null,
      legacyMax: typeof LEGACY_LAYOUT_MAX !== 'undefined' ? LEGACY_LAYOUT_MAX : null,
      headerSize: typeof HEADER_SIZE !== 'undefined' ? HEADER_SIZE : null,
      chunkHeight: typeof CHUNK_HEIGHT !== 'undefined' ? CHUNK_HEIGHT : null,
      maxSlots: typeof MAX_WORLD_SLOTS !== 'undefined' ? MAX_WORLD_SLOTS : null,
      blockRegistryLength: typeof BLOCK_REGISTRY !== 'undefined' ? BLOCK_REGISTRY.length : null,
    }));
    assertEquals(inv.dbName, 'cuubz-worlds', 'DB_NAME (chunkmanager.js:20)');
    assertEquals(inv.dbVersion, 2, 'DB_VERSION (chunkmanager.js:21) — H-2: incrementing this destroys every saved world');
    assertEquals(inv.storeChunks, 'chunks', 'STORE_CHUNKS (chunkmanager.js:23)');
    assertEquals(inv.storeManifests, 'manifests', 'STORE_MANIFESTS (chunkmanager.js:24)');
    assertEquals(inv.chunkW, 16, 'CHUNK_W (chunkmanager.js:18)');
    assertEquals(inv.chunkD, 16, 'CHUNK_D (chunkmanager.js:19)');
    assertEquals(inv.chunkKeyFormat, '-3,7', 'Chunk primary key format `${cx},${cz}` (chunkmanager.js:455)');

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
    assert(usedBytes <= bufA1.length,
      `The header's run count fits inside the stored buffer (${runCount} runs → ${usedBytes} of ${bufA1.length} bytes)`);

    // [D-15] ASSERTING A KNOWN DEFECT, same convention as H-1 and D-14 below.
    //
    // chunkBinaryCodec.js:63 sizes the buffer as
    //     HEADER_SIZE + blockRuns.length * 4
    // but `blockRuns` is a flat Uint16Array of [id, count, id, count, …], so the
    // number of RUNS is blockRuns.length / 2 and the payload it goes on to write is
    // (blockRuns.length / 2) * 4 bytes. The allocation is therefore exactly double
    // what is used, and every stored chunk carries a zero-filled tail of the same
    // size as its real payload.
    //
    // Not a corruption bug: decode() stops after blockRunCount runs, and the
    // checksum is computed over the whole data portion at both ends, so the padding
    // is self-consistent. It is pure waste — half of the IndexedDB footprint and
    // half of the bytes written on every 5 s flush.
    //
    // Not fixed here: shrinking the allocation changes the byte length and checksum
    // of every future chunk, which is a DEPLOY.md §2.2 on-disk-format change, and
    // js/ is off-limits in this PR beyond the log-severity fix. Backward compatible
    // in principle — decode() never consults the buffer length — but it wants its
    // own PR. Fixing it turns this assertion red on purpose.
    assertEquals(bufA1.length, usedBytes * 2 - 20,
      `D-15 — the stored chunk is exactly twice the size it needs to be: ${bufA1.length} bytes allocated, ` +
      `${usedBytes} used, ${bufA1.length - usedBytes} bytes of zero padding ` +
      `(${((1 - usedBytes / bufA1.length) * 100).toFixed(1)}% waste, ~${Math.round((bufA1.length - usedBytes) * snapA1.chunkCount / 1048576)} MB across this world's ${snapA1.chunkCount} chunks)`);
    const tail = bufA1.subarray(usedBytes);
    assertEquals(tail.some(b => b !== 0), false, 'D-15 — the wasted tail is entirely zeroes, confirming it is unwritten padding');

    const ChunkBinaryCodec = require('../../js/world/chunkBinaryCodec');
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

    note(
      '§7 step 4/6 for PLACED and BROKEN blocks — the harness generates terrain and ' +
      'proves it persists byte-for-byte, but it never modifies a block',
      'Placing a block needs pointer lock plus mouse-look, and the running ' +
      'chunkManager/inventory/blockInteraction are closure locals inside startGame() ' +
      "(refactor.md §1.6), so page.evaluate cannot reach them. PR 12-13 hoist them onto " +
      'Game; after that, place → flush → reload → assert the voxel is a one-line addition here.'
    );

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
    // [H-1] This is the section the whole harness was designed around.
    //
    // DEPLOY.md §7 marks steps 8-9 "EXPECTED TO FAIL TODAY" and §9 admits the
    // prediction was inference from three read paths, never observed. The naive way
    // to observe it is to build a shape in world A, visit world B, and look — which
    // needs block placement, which is exactly what this harness cannot do.
    //
    // It needs none of that. World B generating chunk "0,0" overwrites world A's
    // record because the primary key is coordinate-only, so the proof is entirely in
    // storage: the record's own `worldName` field flips to B's id while A's manifest
    // still lists the key as generated, carrying a checksum that no longer matches
    // the bytes stored there. No pointer lock, no mouse simulation.
    //
    // THESE ASSERTIONS DESCRIBE A DEFECT, NOT A REQUIREMENT. They pass because the
    // bug is present. Fixing H-1 turns this block red — that is the intent, and the
    // fix's own PR replaces it with the inverse assertions written below each one.
    console.log('\n[§7 steps 8-9 — H-1 two-world test — ASSERTING A KNOWN DEFECT]');
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

    assertEquals(snapB.rec.worldName, worldB,
      'H-1 — chunk "0,0" now carries world B\'s worldName: B\'s record overwrote A\'s at the same key');
    assert(snapB.recBytes !== snapA1.recBytes,
      'H-1 — the bytes under key "0,0" changed: A\'s terrain at spawn is gone, replaced by B\'s');
    assertEquals(snapAafterB.manifest.lists00, true,
      'H-1 — world A\'s manifest still lists "0,0" as generated, so A will load the stale record instead of regenerating');
    assert(snapAafterB.manifest.checksum00 !== snapAafterB.recStoredChecksum,
      `H-1 — world A's manifest checksum for "0,0" (${snapAafterB.manifest.checksum00}) no longer matches the ` +
      `bytes stored there (${snapAafterB.recStoredChecksum}). Nothing verifies this on load.`);

    // How much damage one visit does, measured rather than described.
    const overwritten = snapA1.chunkCount + snapB.manifest.generatedCount - snapB.chunkCount;
    assert(overwritten > 0,
      `H-1 — ${overwritten} of world A's ${snapA1.chunkCount} saved chunks were overwritten by one visit to world B ` +
      `(${snapA1.chunkCount} + ${snapB.manifest.generatedCount} generated = ${snapA1.chunkCount + snapB.manifest.generatedCount} ` +
      `if keys were world-scoped; the store holds ${snapB.chunkCount})`);

    console.log('\n[§7 step 9 — return to world A — ASSERTING A KNOWN DEFECT]');
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#main-menu:not(.hidden)', { timeout: 30000 });
    await sleep(1500);
    drain(consoleErrors); drain(pageErrors);
    await enterWorld(page, worldA, 'survival');
    await settleAndPause(page, 'world A re-entry after B');
    await shot(page, '05-world-alpha-contaminated');
    const snapA3 = await readStorage(page, worldA);

    assert(snapA3.recBytes === snapB.recBytes,
      'H-1 step 9 — re-entering world A loads world B\'s spawn chunk, byte for byte. The player is standing in ' +
      `the other world's terrain. (world A now serves ${digest(snapA3.recBytes)}, which is world B's ${digest(snapB.recBytes)})`);
    assert(snapA3.recBytes !== snapA1.recBytes,
      'H-1 step 9 — world A\'s original spawn chunk is unrecoverable: nothing in the store holds those bytes ' +
      `any more (world A's own ${digest(snapA1.recBytes)} is gone)`);
    assertEquals(snapA3.rec.worldName, worldB,
      'H-1 step 9 — the record loaded while playing world A still identifies itself as belonging to world B');

    // ═══ §7 step 7 — quit to menu, re-enter ═══════════════════
    //
    // [D-14] BLOCKED. `js/main.js:4562` calls `game.playerSync.reset()`, which does
    // not exist on PlayerSyncManager — `reset()` belongs to PingTracker
    // (playerSync.js:103, class boundaries at :51/:125/:366). `game.playerSync` is
    // set whenever `sessionManager.client` exists, which includes solo play
    // (main.js:2612), so EVERY "Exit to Menu" throws a TypeError partway through
    // onExit. Same shape as the two assertions above: this describes the defect.
    console.log('\n[§7 step 7 — quit to menu — ASSERTING A KNOWN DEFECT (D-14)]');
    drain(consoleErrors); drain(pageErrors);
    await page.click('#btn-exit-menu');
    await sleep(4000);
    await shot(page, '06-exit-to-menu-blank');

    const exitErrors = drain(pageErrors);
    assertEquals(exitErrors.length, 1,
      `D-14 — "Exit to Menu" raises exactly one uncaught exception${exitErrors.length ? ' — ' + exitErrors.map(e => e.text).join(' | ') : ''}`);
    assert(exitErrors.some(e => /playerSync\.reset is not a function/.test(e.text)),
      'D-14 — the exception is `game.playerSync.reset is not a function` (main.js:4562)');
    const screenState = await page.evaluate(() => {
      const ids = ['main-menu', 'character-screen', 'world-screen', 'mode-screen', 'loading-screen', 'pause-menu', 'hud'];
      return ids.filter(id => {
        const el = document.getElementById(id);
        return el && !el.classList.contains('hidden');
      });
    });
    assertEquals(screenState.length, 0,
      `D-14 — the throw skips showScreen('mainMenu') (main.js:4603), leaving every screen hidden: a blank page ` +
      `with no way back except F5. Visible screens: [${screenState.join(', ')}]`);

    note(
      '§7 step 7 — "quit to menu, re-enter the same world without reloading". One of the ' +
      'three load-bearing steps ("if steps 6, 7 or 13 fail, stop the refactor and bisect"), ' +
      'and it cannot be executed at all: D-14 tears the session down and then throws before ' +
      'returning to the menu, so there is no menu to re-enter from',
      'Fix D-14 — delete the `game.playerSync.reset()` call at js/main.js:4562. ' +
      '`clearAll()` on the line above already disposes every remote-player mesh and clears ' +
      'the map (playerSync.js:523-531), so the call is redundant as well as wrong. Then ' +
      'replace this block with the step-6 round trip driven through Exit to Menu instead of reload.'
    );

    note(
      '§7 steps 12-13 — multiplayer host/guest persistence',
      'Needs a running relay (server/index.js on 8765), two browser contexts, and a guest ' +
      'PLACING a block — which is the same pointer-lock wall as step 4. The relay half is ' +
      'reachable today (spawn it as a child process and point js/main.js:2126 at localhost); ' +
      'the block-placement half waits for PR 12-13.'
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
  console.log('   Note: three blocks above assert KNOWN DEFECTS (H-1, D-14, D-15) rather');
  console.log('   than requirements — they pass because the bug is present. Fixing any of');
  console.log('   them turns this harness red on purpose, which is the signal to replace');
  console.log('   that block with the assertion the fix makes true.');
  process.exit(0);
}

main().catch(err => {
  console.error(`\nHarness crashed outside the assertion scope: ${err.stack}`);
  process.exit(1);
});
