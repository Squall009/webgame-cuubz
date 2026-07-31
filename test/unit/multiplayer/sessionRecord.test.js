/**
 * Cuubz — the rejoin record: one key, one shape, one writer (PR 16)
 *
 * This is **D-43's regression test**. Six `setItem` calls on `cuubz_last_session` lived in
 * `src/main.js`, two of them `beforeunload` handlers on the same event; both fired, the
 * second-registered one won, and it hard-coded `mode: 'survival'` for a joiner. Refreshing
 * while joined to a creative session therefore rejoined into survival.
 *
 * `refactor.md` §8.3's fix is `src/util/StorageHelper.js` — one writer with one shape —
 * and this file asserts the three properties that make that claim checkable:
 *
 *   1. **the shape** — every record carries every field, with explicit nulls;
 *   2. **the semantics** — a joiner's `mode` is the mode of the session it joined, and
 *      it survives the round trip that used to lose it;
 *   3. **the structure** — exactly one file in `src/` writes the key at all, asserted the
 *      way `test_globalCollisions.js` asserts the `window` allowlist, because a fourth
 *      write site added in two years' time is how this comes back.
 *
 * The session layer had **no** coverage before this file: `test/e2e/saveLoad.js` is
 * single-context and never clicks `#btn-host` or `#btn-join`, and `test_sessionUI.js`
 * asserts against a private reimplementation rather than the shipped class (`BUGS.md`
 * D-47). PR 16 is what made the real class `require`-able, and this uses it directly.
 */

import { it } from 'vitest';
import { legacy } from '../../helpers/legacy.js';
import { TEST_DIR as __dirname } from '../../helpers/paths.js';
import fs from 'fs';
import path from 'path';
import { REJOIN_STORAGE_KEY, REJOIN_MAX_AGE, clearLastSession, normaliseSessionRecord, readLastSession, writeLastSession } from '../../../src/util/StorageHelper.js';
import { SessionManager } from '../../../src/multiplayer/SessionManager.js';

it('sessionRecord', () => legacy(async () => {
// A localStorage the modules under test will find. It has to be installed BEFORE the
// modules are required only in spirit — `StorageHelper` looks the property up on every
// call — but installing it first keeps the test honest about what it is exercising.
class FakeStorage {
  constructor() { this._d = new Map(); }
  getItem(k) { return this._d.has(k) ? this._d.get(k) : null; }
  setItem(k, v) { this._d.set(k, String(v)); }
  removeItem(k) { this._d.delete(k); }
  get size() { return this._d.size; }
}
globalThis.localStorage = new FakeStorage();




let passed = 0;
let failed = 0;
let total = 0;

function assert(condition, message) {
  total++;
  if (condition) { passed++; } else { failed++; console.error(`  ❌ FAIL: ${message}`); }
}
function assertEquals(actual, expected, message) {
  assert(actual === expected, `${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function reset() { globalThis.localStorage = new FakeStorage(); }

/** A `uiDeps`-shaped bridge with no DOM behind it. */
function fakeDeps(overrides = {}) {
  return Object.assign({
    ui: null,
    characterManager: null,
    worldManager: null,
    log() {},
    startGame() {},
    updateRejoinPanel() {},
  }, overrides);
}

console.log('\n[1] The key and the expiry window are what DEPLOY.md §2 says they are');
// refactor.md §1.5 and §14: changing this string loses every player's rejoin record.
assertEquals(REJOIN_STORAGE_KEY, 'cuubz_last_session', 'REJOIN_STORAGE_KEY is unchanged');
assertEquals(REJOIN_MAX_AGE, 24 * 60 * 60 * 1000, 'REJOIN_MAX_AGE is 24 hours');

console.log('\n[2] One shape — every record carries every field');
{
  const r = normaliseSessionRecord({ sessionId: 's1' });
  assertEquals(Object.keys(r).sort().join(','),
    'characterId,isHost,mode,name,seed,sessionId,timestamp,worldId',
    'A minimal record is normalised to all eight fields');
  assertEquals(r.seed, null, 'An unknown seed is an explicit null, not absent');
  assertEquals(r.characterId, null, 'An unknown characterId is an explicit null');
  assertEquals(r.worldId, null, 'An unknown worldId is an explicit null');
  assertEquals(r.isHost, false, 'isHost defaults to false, and is a boolean');
  assertEquals(r.mode, 'survival', 'mode falls back to survival only when nothing supplied one');
  assertEquals(r.name, 'Joined Session', 'A joiner with no name gets the joiner default');
  assertEquals(normaliseSessionRecord({ isHost: true }), null,
    'A record with no sessionId normalises to null — there is nothing to rejoin');
  assertEquals(normaliseSessionRecord(null), null, 'A null record normalises to null');
  assertEquals(normaliseSessionRecord({ sessionId: 's1', isHost: true }).name, 'My Session',
    'A host with no name gets the host default');
}

console.log('\n[3] Round trip, expiry and corruption');
{
  reset();
  assertEquals(readLastSession(), null, 'No record reads back as null');

  const written = writeLastSession({ sessionId: 's2', mode: 'creative', isHost: true, seed: 7 });
  assertEquals(written.mode, 'creative', 'writeLastSession returns what it wrote');
  const read = readLastSession();
  assertEquals(read.sessionId, 's2', 'The record round-trips its sessionId');
  assertEquals(read.mode, 'creative', 'The record round-trips its mode');
  assertEquals(read.seed, 7, 'The record round-trips its seed');

  assertEquals(writeLastSession({ mode: 'creative' }), null,
    'A record with no sessionId is not written at all');
  assertEquals(readLastSession().sessionId, 's2',
    '…and the rejected write did not clobber the existing record');

  // Expiry: one millisecond past the window.
  reset();
  globalThis.localStorage.setItem(REJOIN_STORAGE_KEY, JSON.stringify({
    sessionId: 'stale', timestamp: Date.now() - REJOIN_MAX_AGE - 1,
  }));
  assertEquals(readLastSession(), null, 'A record older than 24 hours reads back as null');
  assertEquals(globalThis.localStorage.getItem(REJOIN_STORAGE_KEY), null,
    '…and is removed, so it cannot be re-read');

  reset();
  globalThis.localStorage.setItem(REJOIN_STORAGE_KEY, JSON.stringify({
    sessionId: 'fresh', timestamp: Date.now() - REJOIN_MAX_AGE + 60000,
  }));
  assertEquals(readLastSession().sessionId, 'fresh', 'A record inside the window survives');

  reset();
  globalThis.localStorage.setItem(REJOIN_STORAGE_KEY, '{not json');
  assertEquals(readLastSession(), null, 'Corrupt JSON reads back as null rather than throwing');

  reset();
  writeLastSession({ sessionId: 's3' });
  clearLastSession();
  assertEquals(readLastSession(), null, 'clearLastSession removes the record');

  // No localStorage at all — the Node default, and a browser with storage disabled.
  const saved = globalThis.localStorage;
  globalThis.localStorage = null;
  assertEquals(readLastSession(), null, 'With no localStorage, reading is null rather than a throw');
  assertEquals(writeLastSession({ sessionId: 'x' }), null, 'With no localStorage, writing is a no-op');
  clearLastSession(); // must not throw
  assert(true, 'With no localStorage, clearing is a no-op');
  globalThis.localStorage = saved;
}

console.log('\n[4] D-43 — a joiner records the mode of the session it joined');
{
  reset();
  const sm = new SessionManager(fakeDeps());

  assertEquals(sm.getSessionRecord(), null,
    'With no session in progress there is no record — a beforeunload in the main menu writes nothing');
  assertEquals(sm.saveSessionRecord(), null, '…and saveSessionRecord writes nothing');
  assertEquals(globalThis.localStorage.size, 0, '…and localStorage is untouched');

  // This is exactly what `LobbyScreen._joinSession` does: it knows the browsed session's
  // mode, name and seed, and hands them to `joinSession`. Before PR 16 it handed over
  // nothing, `JOIN_ACCEPTED` carried no mode either (server/matchmaking.js), and the
  // handler that won the beforeunload race wrote the literal 'survival'.
  sm.joinSession('sess-creative', { mode: 'creative', name: 'Build Server', seed: 12345 });
  sm.currentSessionId = 'sess-creative'; // what JOIN_ACCEPTED sets

  const record = sm.getSessionRecord();
  assertEquals(record.mode, 'creative',
    'D-43 — a joiner in a creative session records mode "creative", not "survival"');
  assertEquals(record.isHost, false, 'D-43 — the joiner record says isHost false');
  assertEquals(record.name, 'Build Server', 'D-43 — the joiner record carries the real session name');
  assertEquals(record.seed, 12345,
    "D-43 — the joiner record carries the host's seed, so the rejoin can rebuild the temp world");

  // The two write moments — JOIN_ACCEPTED and beforeunload — must agree. Disagreeing was
  // the whole of D-43; there is one code path now, so this asserts they cannot diverge.
  sm.saveSessionRecord();
  const atJoin = readLastSession();
  sm.saveSessionRecord(); // the beforeunload write
  const atUnload = readLastSession();
  assertEquals(atUnload.mode, atJoin.mode, 'D-43 — the unload write agrees with the join write about mode');
  assertEquals(atUnload.isHost, atJoin.isHost, 'D-43 — …and about isHost');
  assertEquals(atUnload.seed, atJoin.seed, 'D-43 — …and about seed');
  assertEquals(atUnload.name, atJoin.name, 'D-43 — …and about name');
  assertEquals(readLastSession().mode, 'creative',
    'D-43 — and what is actually on disk after both writes is still "creative"');
}

console.log('\n[5] The host record, and leaving');
{
  reset();
  const sm = new SessionManager(fakeDeps({
    characterManager: { getSelectedCharacter: () => ({ id: 'char-1', name: 'Ada' }) },
    worldManager: { getSelectedWorld: () => ({ id: 'world-1', seed: 999 }) },
  }));
  sm.hostingSessionId = 'sess-host';
  sm._gameMode = 'creative';
  sm._sessionName = 'My Creative World';

  const r = sm.getSessionRecord();
  assertEquals(r.isHost, true, 'A hosting manager records isHost true');
  assertEquals(r.mode, 'creative', 'The host records the mode it started with, not a form value');
  assertEquals(r.characterId, 'char-1', 'The host record carries the selected character id');
  assertEquals(r.worldId, 'world-1', 'The host record carries the selected world id');
  assertEquals(r.seed, 999, "The host record carries the selected world's seed");

  // Hosting wins over a stale currentSessionId, which is the precedence both former
  // handlers used and the auto-rejoin block still depends on.
  sm.currentSessionId = 'sess-stale';
  assertEquals(sm.getSessionRecord().sessionId, 'sess-host',
    'hostingSessionId takes precedence over currentSessionId');

  sm.leaveSession();
  assertEquals(sm.getSessionRecord(), null, 'After leaveSession there is no record to write');
  assertEquals(sm._gameMode, null, 'leaveSession forgets the mode, so the next session cannot inherit it');
}

console.log('\n[6] One writer — asserted structurally, like the window allowlist');
//
// `no-undef` cannot see this and neither can any lint rule: a `localStorage.setItem` is
// valid everywhere. D-43 was six of them. If a future PR genuinely needs a second writer,
// change this constant deliberately and say why in the PR outcome. Do not delete the
// assertion to make a build pass.
const ALLOWED_REJOIN_WRITERS = ['src/util/StorageHelper.js'];

const srcRoot = path.join(__dirname, '..', 'src');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const full = path.join(dir, e.name);
  return e.isDirectory() ? walk(full) : (e.name.endsWith('.js') ? [full] : []);
});
const rel = (full) => path.relative(path.join(__dirname, '..'), full).replace(/\\/g, '/');
// Strip line comments and block-comment bodies so the prose in main.js and StorageHelper.js
// — both of which name the key and the old call — is not a match.
const stripped = (full) => fs.readFileSync(full, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const srcFiles = walk(srcRoot);

const keySpellers = srcFiles
  .filter((f) => /['"`]cuubz_last_session['"`]/.test(stripped(f)))
  .map(rel).sort();
assertEquals(keySpellers.join(', '), ALLOWED_REJOIN_WRITERS.join(', '),
  'Exactly one file in src/ spells the literal "cuubz_last_session"');

const keyWriters = srcFiles
  .filter((f) => /setItem\s*\(\s*(REJOIN_STORAGE_KEY|['"`]cuubz_last_session['"`])/.test(stripped(f)))
  .map(rel).sort();
assertEquals(keyWriters.join(', '), ALLOWED_REJOIN_WRITERS.join(', '),
  'Exactly one file in src/ calls setItem on the rejoin key — D-43 was six');

// The other half of D-43 was TWO handlers on one event, both writing the rejoin record.
// There are two `beforeunload` handlers in `src/` and they do different jobs:
//
//   ChunkStorage.js — the D-19 chunk flush: dirty chunks and their manifest, in one
//                     transaction. Nothing to do with sessions. It was in
//                     `ChunkManager.js` until PR 23 split that file; `_setupGracefulShutdown`
//                     moved verbatim into the storage mixin, which is where the flush
//                     queue and both object stores now live. Still one registration,
//                     still registered from the same `chunkManager._setupGracefulShutdown()`
//                     call in `src/core/init/initWorld.js`.
//   Bootstrap.js    — the rejoin record, and the only writer of it. This was `main.js`
//                     until PR 18 deleted that file; the handler itself is unchanged,
//                     still registered once, at module evaluation.
//
// Counted by file and by occurrence, because D-43's two were in the same file.
const ALLOWED_BEFOREUNLOAD = ['src/core/Bootstrap.js', 'src/engine/world/ChunkStorage.js'];
const beforeUnloadFiles = [];
let beforeUnloadCount = 0;
for (const f of srcFiles) {
  const m = stripped(f).match(/addEventListener\s*\(\s*['"`]beforeunload['"`]/g);
  if (m) { beforeUnloadFiles.push(rel(f)); beforeUnloadCount += m.length; }
}
assertEquals(beforeUnloadFiles.sort().join(', '), ALLOWED_BEFOREUNLOAD.join(', '),
  'Exactly two files in src/ register a beforeunload handler, and they do different jobs');
assertEquals(beforeUnloadCount, 2,
  'Two beforeunload handlers in total — D-43 was three, two of them writing the same key');

console.log(`\n===================================`);
console.log(`Results: ${passed}/${total} passed, ${failed} failed`);
console.log(`===================================`);

process.exit(failed === 0 ? 0 : 1);
}));
