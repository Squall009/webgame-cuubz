/**
 * Cuubz — the host's Max Players setting, end to end through the real relay (PR 33, D-84)
 *
 * The other five socket suites in this directory build their own relay wiring: they
 * construct `Matchmaking` and `SessionManager` by hand and supply their own
 * `onHostRequest`. That is the right shape for testing those two modules, and it means
 * **not one of them has ever executed `server/index.js`** — which is precisely where
 * D-84 lived. `maxPlayers` was hard-coded there, one line, in a callback nothing drove.
 *
 * So this file spawns the actual `server/index.js` as a child process, talks to it over
 * a real WebSocket, and reads the answer back over its own HTTP `/sessions` endpoint —
 * from outside the process, the way `test/e2e/multiplayer.js` does. Every link is the
 * shipped one: the browser's HOST frame shape, `Matchmaking`'s forwarding, `index.js`'s
 * clamp, `SessionManager`'s cap, and `getSessionInfo()`, which is the object the browse
 * list renders as "players/maxPlayers".
 *
 * It is also the first assertion in the repo that `server/` runs at all as an ES module.
 */

import { it } from 'vitest';
import { legacy } from '../helpers/legacy.js';
import { REPO_ROOT } from '../helpers/paths.js';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { WebSocket } from 'ws';

it('relayMaxPlayers', () => legacy(async () => {
let passCount = 0;
let failCount = 0;
const failures = [];

function assert(condition, message) {
  if (condition) {
    passCount++;
    console.log(`  ✅ ${message}`);
  } else {
    failCount++;
    failures.push(message);
    console.log(`  ❌ FAIL — ${message}`);
  }
}
const assertEquals = (a, b, m) => assert(a === b, `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

/**
 * An ephemeral port, released before the child claims it. `server/index.js` reads
 * `MATCHMAKING_PORT` and has no listen(0) path, so — unlike the other socket suites,
 * which bind 0 and read the port back (D-20) — the port has to be chosen up front.
 * `fileParallelism: false` (vitest.config.js note 2) means nothing else in this suite
 * is binding while this runs.
 */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHealth(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return await res.json();
    } catch { /* not up yet */ }
    await sleep(150);
  }
  return null;
}

/** Open a matchmaking socket, send one HOST, resolve with the reply. */
function hostOnce(port, payload, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/matchmaking`);
    const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('HOST timed out')); }, timeoutMs);
    ws.on('error', (err) => { clearTimeout(timer); reject(err); });
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'HOST', ...payload }));
    });
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'WELCOME') return; // the lobby greeting, not the answer
      clearTimeout(timer);
      // The socket is deliberately left OPEN: closing it is what tells the relay the
      // host left, and `/sessions` is read while the session is still live.
      resolve({ msg, ws });
    });
  });
}

const PORT = await freePort();
const child = spawn(process.execPath, [path.join(REPO_ROOT, 'server', 'index.js')], {
  cwd: path.join(REPO_ROOT, 'server'),
  env: { ...process.env, MATCHMAKING_PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let childStderr = '';
child.stderr.on('data', (d) => { childStderr += d.toString(); });
child.stdout.on('data', () => {});

const openSockets = [];
try {
  const health = await waitForHealth(PORT);
  assert(health !== null,
    `server/index.js started and answered /health on port ${PORT} — it is a Node ES ` +
    `module now ("type": "module" in server/package.json)${childStderr ? '\n      stderr: ' + childStderr.slice(0, 800) : ''}`);
  if (health === null) throw new Error('relay never became healthy: ' + childStderr.slice(0, 2000));
  assertEquals(health.status, 'ok', '/health reports ok');

  // The MODULE_TYPELESS_PACKAGE_JSON warning is what `shared/package.json` exists to
  // silence — `shared/` sits outside `server/`, so without its own `"type"` Node falls
  // back to the ROOT package.json, which deliberately has none (eslint.config.mjs:7-14).
  assert(!/MODULE_TYPELESS_PACKAGE_JSON/.test(childStderr),
    'the relay boots with no MODULE_TYPELESS_PACKAGE_JSON warning');

  const readSessions = async () => await (await fetch(`http://127.0.0.1:${PORT}/sessions`)).json();

  // ── 1. The number the host asked for is the number it gets ──
  {
    const { msg, ws } = await hostOnce(PORT, { name: 'Trio', worldSeed: 4242, mode: 'survival', maxPlayers: 3 });
    openSockets.push(ws);
    assertEquals(msg.type, 'HOST_CREATED', 'the relay accepted the HOST');
    const list = await readSessions();
    assertEquals(list.length, 1, 'the relay holds one session');
    assertEquals(list[0].maxPlayers, 3,
      'D-84: a host who asked for 3 gets a session capped at 3. server/index.js:140 used ' +
      'to read `maxPlayers: MAX_PLAYERS_PER_SESSION` and this was 4 no matter what');
    assertEquals(list[0].players, 0, 'nobody has joined the game session yet');
    assertEquals(list[0].name, 'Trio', 'and the name still crossed the wire');
    assertEquals(list[0].seed, 4242, 'and the seed');
    // This is the string test/e2e/multiplayer.js reads out of the browse list.
    assertEquals(`${list[0].players}/${list[0].maxPlayers}`, '0/3',
      'the browse row renders "0/3" — one join short of the "1/3" the e2e harness sees');
    ws.close();
  }

  // Sessions are destroyed 30s after emptying, and the relay keeps them keyed by id, so
  // each case below simply adds one and reads the newest.
  await sleep(200);

  // ── 2. A client that sends no field at all still works ──
  {
    const { msg, ws } = await hostOnce(PORT, { name: 'OldClient', worldSeed: 7, mode: 'survival' });
    openSockets.push(ws);
    assertEquals(msg.type, 'HOST_CREATED', 'a HOST with no maxPlayers is still accepted');
    const row = (await readSessions()).find((s) => s.name === 'OldClient');
    assertEquals(row && row.maxPlayers, 4,
      'D-84: a client built before this change sends no maxPlayers and gets the old ' +
      'hard-coded default of 4 — the change is backward compatible by construction');
    ws.close();
  }

  await sleep(200);

  // ── 3. The client is not trusted ──
  {
    const { ws } = await hostOnce(PORT, { name: 'Greedy', worldSeed: 8, mode: 'survival', maxPlayers: 99 });
    openSockets.push(ws);
    const row = (await readSessions()).find((s) => s.name === 'Greedy');
    assertEquals(row && row.maxPlayers, 4,
      'D-84: a client asking for 99 is clamped DOWN to the ceiling — the cap is enforced ' +
      'on the relay, not requested politely from the browser');
    ws.close();
  }

  await sleep(200);

  {
    const { ws } = await hostOnce(PORT, { name: 'Lonely', worldSeed: 9, mode: 'survival', maxPlayers: 1 });
    openSockets.push(ws);
    const row = (await readSessions()).find((s) => s.name === 'Lonely');
    assertEquals(row && row.maxPlayers, 2,
      'D-84: and asking for 1 is clamped UP to the floor');
    ws.close();
  }

  await sleep(200);

  {
    const { ws } = await hostOnce(PORT, { name: 'Junk', worldSeed: 10, mode: 'survival', maxPlayers: 'banana' });
    openSockets.push(ws);
    const row = (await readSessions()).find((s) => s.name === 'Junk');
    assertEquals(row && row.maxPlayers, 4,
      'D-84: garbage in the field falls back to the default rather than producing NaN');
    ws.close();
  }
} finally {
  for (const ws of openSockets) { try { ws.close(); } catch {} }
  child.kill('SIGKILL');
  await sleep(200);
}

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
