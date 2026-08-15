/**
 * Cuubz — one wire protocol, asserted structurally (PR 33)
 *
 * ─── WHY THE OBVIOUS TEST WOULD BE VACUOUS ──────────────────────────────────
 *
 * PR 33's acceptance criterion is "the client's and the server's `MESSAGE_TYPES` are
 * deep-equal". After `shared/protocol.js` they are **the same object**, so
 * `expect(clientTable).toEqual(serverTable)` compares a reference with itself and is
 * green no matter what either side does. That is the `BUGS.md` D-45 shape — a test
 * that cannot go red when the shipped code breaks — and writing it would be worse
 * than writing nothing, because it reads as coverage.
 *
 * So the deep-equal is asserted the only way it still means something: **over the
 * source text of the three files that used to hold the three copies.** Every message
 * type each of them names has to be a key of the one table, no bare protocol string
 * literal may come back, and every type the relay SENDS has to be a type the client
 * NAMES. That last one is D-78: `HOST_REJECTED` went out on the wire and appeared
 * nowhere in `src/` at all, and it is red on this file if it ever does again.
 *
 * ─── THE SCANNER ────────────────────────────────────────────────────────────
 *
 * `stringLiterals()` is a character-level scanner rather than a
 * `source.replace(/\/\/.*$/gm, '')`, because these files are full of `'ws://…'` and
 * `'http://…'` — a naive line-comment strip truncates those strings and would silently
 * hide any protocol literal sitting to the right of one on the same line, which is a
 * weakened assertion by accident. `scannerSelfCheck()` below drives the scanner over a
 * fixture that contains a protocol literal in code, one in a line comment, one in a
 * block comment and one after a `//` inside a string, and asserts it reports exactly
 * the two real ones. None of the three files contains a regex literal (checked), which
 * is the one construct this scanner does not model.
 */

import { it } from 'vitest';
import { legacy } from '../../helpers/legacy.js';
import { REPO_ROOT } from '../../helpers/paths.js';
import fs from 'node:fs';
import path from 'node:path';
import { MESSAGE_TYPES, MIN_PLAYERS_LIMIT, MAX_PLAYERS_LIMIT, clampMaxPlayers } from '../../../shared/protocol.js';
import { MESSAGE_TYPES as CLIENT_MESSAGE_TYPES, MATCHMAKING_EVENTS, WSConnection, MultiplayerClient } from '../../../src/multiplayer/Client.js';
import SessionManagerServer from '../../../server/session.js';
import Matchmaking from '../../../server/matchmaking.js';

it('protocol', () => legacy(async () => {
let passCount = 0;
let failCount = 0;
const failures = [];

function assert(condition, message) {
  if (condition) {
    passCount++;
  } else {
    failCount++;
    failures.push(message);
    console.log(`  ❌ FAIL — ${message}`);
  }
}
function assertEquals(actual, expected, message) {
  assert(actual === expected, `${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function assertSetEquals(actual, expected, message) {
  const a = [...actual].sort().join(',');
  const b = [...expected].sort().join(',');
  assert(a === b, `${message}\n      only in actual:   ${[...actual].filter((x) => !expected.includes(x)).join(', ') || '—'}\n      only in expected: ${[...expected].filter((x) => !actual.includes(x)).join(', ') || '—'}`);
}

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

// ═══════════════════════════════════════════════════════════════════
// The scanner
// ═══════════════════════════════════════════════════════════════════

/**
 * Every string-literal *value* in `source`, with comments excluded.
 * @returns {{ literals: string[], clean: boolean }} `clean` is false if the scan ended
 *   inside a string or a comment, which means the source contains something this
 *   scanner does not model (a regex literal) and no result should be trusted.
 */
function stringLiterals(source) {
  const out = [];
  let i = 0;
  const n = source.length;
  let state = 'code';
  let quote = '';
  let buf = '';
  while (i < n) {
    const c = source[i];
    const c2 = source[i + 1];
    if (state === 'code') {
      if (c === '/' && c2 === '/') { state = 'line'; i += 2; continue; }
      if (c === '/' && c2 === '*') { state = 'block'; i += 2; continue; }
      if (c === "'" || c === '"' || c === '`') { state = 'string'; quote = c; buf = ''; i++; continue; }
      i++; continue;
    }
    if (state === 'line') {
      if (c === '\n') state = 'code';
      i++; continue;
    }
    if (state === 'block') {
      if (c === '*' && c2 === '/') { state = 'code'; i += 2; continue; }
      i++; continue;
    }
    // state === 'string'
    if (c === '\\') { buf += source[i + 1] || ''; i += 2; continue; }
    if (c === quote) { out.push(buf); state = 'code'; i++; continue; }
    if (c === '\n' && quote !== '`') { state = 'code'; i++; continue; } // unterminated; bail out of it
    buf += c; i++;
  }
  return { literals: out, clean: state === 'code' };
}

/** The scanner has to be proved before anything is concluded from it. */
function scannerSelfCheck() {
  const fixture = [
    "const a = 'HOST_CREATED';",
    "// this comment mentions 'JOIN_REJECTED' and must not count",
    '/* nor this block comment, which mentions \'SESSION_LIST\' */',
    "console.log('ws://host// not a comment', 'LEFT_LOBBY');",
  ].join('\n');
  const { literals, clean } = stringLiterals(fixture);
  assert(clean, 'scanner self-check: the fixture scan ends in code state');
  const protocolish = literals.filter((s) => Object.hasOwn(MESSAGE_TYPES, s));
  assertSetEquals(protocolish, ['HOST_CREATED', 'LEFT_LOBBY'],
    'scanner self-check: exactly the two literals that are really in CODE are reported — ' +
    'the two in comments are not, and the one to the right of a `//` INSIDE a string is');
}

/** Every `MESSAGE_TYPES.X` named in code (comments excluded). */
function symbolRefs(source) {
  const withoutComments = source
    .split('\n')
    .map((line) => line)
    .join('\n');
  // Comments are stripped by reusing the scanner's state machine: rebuild the code-only
  // text by blanking comment spans.
  let i = 0, state = 'code', quote = '', code = '';
  while (i < withoutComments.length) {
    const c = withoutComments[i], c2 = withoutComments[i + 1];
    if (state === 'code') {
      if (c === '/' && c2 === '/') { state = 'line'; i += 2; continue; }
      if (c === '/' && c2 === '*') { state = 'block'; i += 2; continue; }
      if (c === "'" || c === '"' || c === '`') { state = 'string'; quote = c; }
      code += c; i++; continue;
    }
    if (state === 'line') { if (c === '\n') { state = 'code'; code += '\n'; } i++; continue; }
    if (state === 'block') { if (c === '*' && c2 === '/') { state = 'code'; i += 2; continue; } i++; continue; }
    if (c === '\\') { code += c + (withoutComments[i + 1] || ''); i += 2; continue; }
    if (c === quote) state = 'code';
    if (c === '\n' && quote !== '`') state = 'code';
    code += c; i++;
  }
  return [...new Set([...code.matchAll(/MESSAGE_TYPES\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))];
}

scannerSelfCheck();

// ═══════════════════════════════════════════════════════════════════
// Group 1 — the table itself
// ═══════════════════════════════════════════════════════════════════

const KEYS = Object.keys(MESSAGE_TYPES);
assertEquals(KEYS.length, 36,
  'shared/protocol.js exports 36 message types — 9 that both former tables had, 15 the ' +
  'client had alone, HEARTBEAT_ACK the server had alone, TIME_SYNC + HOST_REJECTED, ' +
  'which lived only as string literals and which no table could therefore have agreed on, ' +
  'CHUNK_REQUEST, the client→host re-send ask added by D-116, and the 8 quest/seal/boss ' +
  'types added by S0 (QUEST_SYNC, QUEST_CONTRIBUTE, SEAL_UPDATE, BOSS_SPAWN, BOSS_STATE, ' +
  'BOSS_HIT, BOSS_DEFEATED, BOSS_DESPAWN)');

for (const k of KEYS) {
  assertEquals(MESSAGE_TYPES[k], k, `MESSAGE_TYPES.${k} is its own name — the symbol IS the wire string`);
}

assert(Object.isFrozen(MESSAGE_TYPES), 'MESSAGE_TYPES is frozen');
let mutationThrew = false;
try { MESSAGE_TYPES.JOIN = 'SOMETHING_ELSE'; } catch { mutationThrew = true; }
assert(mutationThrew, 'Writing to MESSAGE_TYPES throws — three mutable copies is how this got here');
assertEquals(MESSAGE_TYPES.JOIN, 'JOIN', 'and the write did not land');

// This one IS the tautology named in the header, and it is here labelled as one: it
// proves only that Client.js re-exports the shared object rather than shadowing it,
// which is worth exactly one assertion and no more.
assert(CLIENT_MESSAGE_TYPES === MESSAGE_TYPES,
  "Client.js's MESSAGE_TYPES is the shared object by identity (a re-export, not a copy) " +
  '— every real claim below is made over source text instead');

// ═══════════════════════════════════════════════════════════════════
// Group 2 — no file declares a second copy
// ═══════════════════════════════════════════════════════════════════

const PROTOCOL_FILES = [
  'src/multiplayer/Client.js',
  'server/session.js',
  'server/matchmaking.js',
];

for (const rel of PROTOCOL_FILES) {
  const src = read(rel);
  assert(!/(const|let|var)\s+MESSAGE_TYPES\s*=/.test(src),
    `${rel} does not declare its own MESSAGE_TYPES`);
  assert(/from '(\.\.\/)+shared\/protocol\.js'/.test(src),
    `${rel} imports the protocol from shared/protocol.js by relative path (no alias, so ` +
    'vite.config.js needs no change and Node resolves it unaided)');
}

// ═══════════════════════════════════════════════════════════════════
// Group 3 — no bare protocol string literal survives in any of the three
// ═══════════════════════════════════════════════════════════════════

const VALUES = Object.values(MESSAGE_TYPES);

for (const rel of PROTOCOL_FILES) {
  const { literals, clean } = stringLiterals(read(rel));
  assert(clean, `${rel}: the literal scan ends in code state (no regex literal confused it)`);
  const bare = [...new Set(literals.filter((s) => VALUES.includes(s)))];
  assertEquals(bare.join(', '), '',
    `${rel} contains NO bare protocol string literal — this is the assertion that keeps ` +
    'server/matchmaking.js from becoming a third copy again (it held 14 of them)');
}

// ═══════════════════════════════════════════════════════════════════
// Group 4 — every symbol each side names is a real key
// ═══════════════════════════════════════════════════════════════════
//
// `MESSAGE_TYPES.TYPOED` is `undefined` in JavaScript, not an error. A handler
// registered under `undefined` is simply never called, which is D-78's failure mode
// arriving by a different route, so this is the assertion that has to exist.

const refsByFile = {};
for (const rel of PROTOCOL_FILES) {
  const refs = symbolRefs(read(rel));
  refsByFile[rel] = refs;
  assert(refs.length > 0, `${rel} names at least one message type through MESSAGE_TYPES`);
  for (const name of refs) {
    assert(Object.hasOwn(MESSAGE_TYPES, name),
      `${rel} names MESSAGE_TYPES.${name}, which is a key of the shared table ` +
      '(a member access that is not would be silently undefined)');
  }
}

// Nothing in the table is dead: every one of the 28 is named by at least one of the
// three. A key added here and used nowhere is the same drift in the other direction.
const allRefs = new Set(PROTOCOL_FILES.flatMap((f) => refsByFile[f]));
assertSetEquals([...allRefs], KEYS,
  'The union of what the three files name is exactly the 28 keys — no dead symbol in the ' +
  'table, no type named that is not in it');

// ═══════════════════════════════════════════════════════════════════
// Group 5 — D-78: every type the RELAY SENDS is one the CLIENT NAMES
// ═══════════════════════════════════════════════════════════════════
//
// This is the assertion whose absence was D-78. `server/matchmaking.js:141` sent
// `HOST_REJECTED`; the string appeared nowhere in `src/` at all — not in the client's
// table, not in `MultiplayerClient`'s matchmaking routing list, not in a
// `SessionManager` handler — so a host whose request the relay refused was shown
// `connecting` and then nothing, forever.
//
// The client side is read across ALL of `src/`, counting both `MESSAGE_TYPES.X` and a
// bare `'X'` literal: several files outside Client.js still name their events as
// strings (`SessionManager.js`, `NetworkStep.js`), and the question this asks is
// simply "does the browser mention this type anywhere", which is the weakest form of
// the claim and therefore the one that cannot be satisfied by accident.

const serverSends = new Set();
for (const rel of ['server/session.js', 'server/matchmaking.js']) {
  for (const m of read(rel).matchAll(/type:\s*MESSAGE_TYPES\.([A-Za-z_$][\w$]*)/g)) {
    serverSends.add(m[1]);
  }
}
assert(serverSends.size >= 15,
  `The relay sends ${serverSends.size} distinct message types (sanity floor: the extraction found some)`);

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const full = path.join(dir, e.name);
  return e.isDirectory() ? walk(full) : (e.name.endsWith('.js') ? [full] : []);
});
const clientNames = new Set();
for (const full of walk(path.join(REPO_ROOT, 'src'))) {
  const src = fs.readFileSync(full, 'utf8');
  for (const name of symbolRefs(src)) clientNames.add(name);
  for (const s of stringLiterals(src).literals) {
    if (Object.hasOwn(MESSAGE_TYPES, s)) clientNames.add(s);
  }
}

for (const name of [...serverSends].sort()) {
  assert(clientNames.has(name),
    `D-78: the relay sends ${name} and src/ names it somewhere — a type the server can ` +
    'send that the browser has never heard of is a message that arrives and is dropped');
}

// And the specific one, named, so the regression cannot be lost in a set comparison.
assert(serverSends.has('HOST_REJECTED'), 'server/matchmaking.js still sends HOST_REJECTED');
assert(clientNames.has('HOST_REJECTED'), 'D-78: src/ knows what HOST_REJECTED is');

// ═══════════════════════════════════════════════════════════════════
// Group 6 — D-78: HOST_REJECTED is routed like its sibling, end to end
// ═══════════════════════════════════════════════════════════════════

assert(MATCHMAKING_EVENTS.includes(MESSAGE_TYPES.HOST_REJECTED),
  'HOST_REJECTED is a matchmaking event, so `client.on()` sends it to the matchmaking ' +
  'handler table rather than the game-session one');
assert(MATCHMAKING_EVENTS.includes(MESSAGE_TYPES.JOIN_REJECTED),
  'JOIN_REJECTED — its sibling, which always worked — is still in the same list');

// Drive the REAL routing: a fake connection, the real `_setupMatchmakingHandlers`, and
// the real `on()`. Nothing is reimplemented and no socket is opened.
function fakeConn() {
  const handlers = {};
  return {
    handlers,
    on(evt, cb) { (handlers[evt] = handlers[evt] || []).push(cb); },
    dispose() {},
    fire(evt, data) { for (const cb of handlers[evt] || []) cb(data); },
  };
}

for (const type of ['HOST_REJECTED', 'JOIN_REJECTED']) {
  const client = new MultiplayerClient({ host: 'test.invalid', matchmakingPort: 1 });
  const seen = [];
  client.on(type, (d) => seen.push(d));
  const conn = fakeConn();
  client._matchmakingConn = conn;
  client._setupMatchmakingHandlers();
  assert((conn.handlers[type] || []).length === 1,
    `${type}: MultiplayerClient subscribed to it on the matchmaking connection`);
  conn.fire(type, { reason: 'Session is full' });
  assertEquals(seen.length, 1, `${type}: a frame off the matchmaking socket reached the caller's handler`);
  assertEquals(seen[0] && seen[0].reason, 'Session is full', `${type}: the reason came through intact`);
  client.dispose();
}

// ═══════════════════════════════════════════════════════════════════
// Group 7 — D-84: maxPlayers survives the trip out of the browser
// ═══════════════════════════════════════════════════════════════════
//
// `SessionHosting.js:87` has always passed `{ name, seed, mode, maxPlayers }`.
// `MultiplayerClient.hostSession` destructured three of those four and dropped the
// fourth without a word, and `sendHost` had no such parameter and the HOST message no
// such field — so the number the host chose died two function calls from the form.
//
// The real `WSConnection.prototype.sendHost` is driven here over a recording `send`,
// so the assertion is about the actual bytes that would go on the wire.

function recordingClient() {
  const sent = [];
  const client = new MultiplayerClient({ host: 'test.invalid', matchmakingPort: 1 });
  client._matchmakingConn = {
    sendHost: WSConnection.prototype.sendHost.bind({ send: (m) => sent.push(m) }),
    dispose() {},
  };
  return { client, sent };
}

{
  const { client, sent } = recordingClient();
  client.hostSession({ name: 'Quarry', seed: 12345, mode: 'creative', maxPlayers: 2 });
  assertEquals(sent.length, 1, 'D-84: hostSession({...}) produced one HOST message');
  assertEquals(sent[0].type, MESSAGE_TYPES.HOST, 'D-84: and it is a HOST');
  assertEquals(sent[0].maxPlayers, 2,
    'D-84: the object form carries maxPlayers onto the wire — this is the destructure in ' +
    'Client.js:hostSession that used to name only { name, seed, mode }');
  assertEquals(sent[0].name, 'Quarry', 'D-84: name still carried');
  assertEquals(sent[0].worldSeed, 12345, 'D-84: seed still carried');
  assertEquals(sent[0].mode, 'creative', 'D-84: mode still carried');
  client.dispose();
}

{
  const { client, sent } = recordingClient();
  client.hostSession('Positional', 7, 'survival', 3);
  assertEquals(sent[0].maxPlayers, 3, 'D-84: the positional form carries it too');
  client.dispose();
}

{
  const { client, sent } = recordingClient();
  client.hostSession({ name: 'NoCap', seed: 7, mode: 'survival' });
  assert(!Object.hasOwn(sent[0], 'maxPlayers'),
    'D-84: a caller that supplies no cap sends no field at all, so an old client keeps ' +
    "hitting the relay's default rather than a fabricated number");
  client.dispose();
}

// ═══════════════════════════════════════════════════════════════════
// Group 8 — D-84: the relay clamps, because the client is not trusted
// ═══════════════════════════════════════════════════════════════════

assertEquals(MIN_PLAYERS_LIMIT, 2, 'The floor matches the slider min in lobbyScreen.js:117');
assertEquals(MAX_PLAYERS_LIMIT, 4, 'The ceiling matches the slider max, and the old hard-coded default');

for (const [input, expected, why] of [
  [2, 2, 'the minimum passes through'],
  [3, 3, 'the e2e harness sets the slider to 3'],
  [4, 4, 'the maximum passes through'],
  [1, 2, 'below the floor clamps UP — a one-player session is not multiplayer'],
  [0, 2, 'zero clamps up'],
  [-5, 2, 'negative clamps up'],
  [5, 4, 'above the ceiling clamps DOWN'],
  [9999, 4, 'a hostile number clamps down'],
  [3.7, 3, 'a fraction floors before clamping'],
  ['3', 3, 'a numeric string, which is what a slider value is before parseInt'],
  [undefined, 4, 'MISSING falls back to the old default, so an old client is unaffected'],
  [null, 4, 'null falls back'],
  ['', 4, 'empty string falls back'],
  ['banana', 4, 'garbage falls back'],
  [NaN, 4, 'NaN falls back'],
  [Infinity, 4, 'Infinity falls back'],
]) {
  assertEquals(clampMaxPlayers(input), expected, `clampMaxPlayers(${JSON.stringify(input)}) → ${expected}: ${why}`);
}

// The relay hands whatever the client asked for to `onHostRequest` as argument 5. This
// drives the REAL `Matchmaking._handleMessage`, so it is the actual code path a HOST
// frame takes.
{
  const calls = [];
  const mm = new Matchmaking({
    wss: { on: () => {} },
    onHostRequest: (...args) => { calls.push(args); return { sessionId: 's1' }; },
  });
  const ws = { readyState: 1, send: () => {} };
  mm.clients.set(ws, { playerId: 'p1', sessionId: null, name: 'x', isHost: false });
  mm._handleMessage(ws, 'p1', { type: MESSAGE_TYPES.HOST, name: 'S', worldSeed: 1, mode: 'survival', maxPlayers: 3 });
  assertEquals(calls.length, 1, 'D-84: the HOST frame reached onHostRequest');
  assertEquals(calls[0][4], 3, 'D-84: server/matchmaking.js forwards msg.maxPlayers as argument 5');

  mm._handleMessage(ws, 'p1', { type: MESSAGE_TYPES.HOST, name: 'S', worldSeed: 1, mode: 'survival' });
  assertEquals(calls[1][4], undefined,
    'D-84: a HOST with no maxPlayers forwards undefined, which clampMaxPlayers turns into the default');
}

// And a session built with the clamped cap actually enforces it — the number has to
// reach `SessionManager`, not merely be computed.
{
  const session = new SessionManagerServer({
    wss: { on: () => {} },
    sessionId: 'cap_test',
    hostId: 'h',
    maxPlayers: clampMaxPlayers(3),
    heartbeatInterval: 30000,
  });
  assertEquals(session.maxPlayers, 3, 'D-84: a session created with a cap of 3 has a cap of 3');
  assertEquals(session.getSessionInfo().maxPlayers, 3,
    'D-84: and getSessionInfo() reports it — this is the field the browse list renders as ' +
    '"players/maxPlayers", so a host who picks 3 shows 1/3 rather than 1/4');
  for (let i = 0; i < 3; i++) {
    session.players.set('p' + i, { playerId: 'p' + i, ws: {}, character: {}, position: {}, rotation: {}, lastHeartbeat: Date.now() });
  }
  assertEquals(session.canPlayerJoin(), false, 'D-84: and it refuses a 4th player at 3/3');
  session.dispose();
}

// ─── Summary ────────────────────────────────────────────────────

console.log('\n===================================');
console.log(`Results: ${passCount} passed, ${failCount} failed`);
console.log('===================================');

if (failCount > 0) {
  console.error('\n❌ Failures:');
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
} else {
  process.exit(0);
}
}));
