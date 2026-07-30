#!/usr/bin/env node
'use strict';

/**
 * Cuubz — `getRelayUrl()` (PR 16)
 *
 * ─── THIS FILE USED TO TEST A COPY OF THE CODE ──────────────────────────────
 *
 * Until PR 16 it opened with *"Pure implementation of getRelayUrl logic (extracted from
 * main.js)"* and then defined its own 30-line `getRelayUrl(pageOrigin, queryParam)`,
 * resolving a per-game relay subdomain — `https://webgame-cuubz.thehomelabguy.com` →
 * `wss://relay.webgame-cuubz.thehomelabguy.com` — and falling back to
 * `ws://localhost:8765`. **`src/main.js` has not done either of those things for some
 * time.** The shipped function returns a fixed host and reads the page protocol; its only
 * override is a `?relayUrl=` query parameter, which the copy modelled as a second
 * argument that the real function never had.
 *
 * So all 24 assertions here passed, on every CI run, against logic no browser executed.
 * That is `BUGS.md` **D-45**, and it is the third vacuous test this refactor has found.
 * `refactor.md` §8.3 moving `getRelayUrl` into `src/multiplayer/RelayUrl.js` — a module
 * with no DOM and no imports — is what makes the real function `require`-able, so the
 * assertions below are rewritten into what the real code makes true.
 *
 * The `pageOrigin` parameter went with the rewrite (`BUGS.md` **D-46**): it was in the
 * signature, documented as a test override, and **read by no line of the function**.
 */

const { getRelayUrl } = require('../src/multiplayer/RelayUrl.js');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) { passed++; } else { failed++; console.error(`  ❌ FAIL: ${message}`); }
}
function assertEqual(actual, expected, message) {
  assert(actual === expected, `${message} — expected "${expected}", got "${actual}"`);
}

/** Stand in for the browser's `location`. `undefined` means "no location at all". */
function withLocation(loc, fn) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'location');
  try {
    if (loc === undefined) { delete globalThis.location; } else { globalThis.location = loc; }
    return fn();
  } finally {
    delete globalThis.location;
    if (saved) Object.defineProperty(globalThis, 'location', saved);
  }
}

const RELAY_HOST = 'cuubz-relay.thehomelabguy.com';

console.log('Group 1: the fixed relay host, chosen by page protocol');
assertEqual(withLocation({ protocol: 'https:', search: '' }, getRelayUrl),
  `wss://${RELAY_HOST}`, 'An https page gets wss:// — nginx terminates TLS in front of the relay');
assertEqual(withLocation({ protocol: 'http:', search: '' }, getRelayUrl),
  `ws://${RELAY_HOST}`, 'An http page gets ws://');
assertEqual(withLocation({ protocol: 'file:', search: '' }, getRelayUrl),
  `ws://${RELAY_HOST}`, 'Any non-https protocol gets ws:// — only https: is special-cased');

console.log('Group 2: no location at all (Node, a worker, a unit test)');
assertEqual(withLocation(undefined, getRelayUrl), `ws://${RELAY_HOST}`,
  'With no location the function still returns a URL rather than throwing');

console.log('Group 3: the ?relayUrl= override — the only override there is');
//
// This is not a convenience. It is how a harness points the game at a relay it controls:
// `test/e2e/saveLoad.js` would otherwise have to reach a public host to exercise any
// multiplayer path. PR15_HANDOFF.md §4.3 names it as the cheapest way into that work.
assertEqual(withLocation({ protocol: 'http:', search: '?relayUrl=ws://localhost:8765' }, getRelayUrl),
  'ws://localhost:8765', 'The query parameter is returned verbatim');
assertEqual(withLocation({ protocol: 'https:', search: '?relayUrl=ws://localhost:8765' }, getRelayUrl),
  'ws://localhost:8765', 'The override beats the protocol rule — an https page can target a local ws:// relay');
assertEqual(withLocation({ protocol: 'https:', search: '?seed=1&relayUrl=wss%3A%2F%2Fcustom%3A9999&x=2' }, getRelayUrl),
  'wss://custom:9999', 'It is found among other parameters, and percent-decoded');

console.log('Group 4: what does NOT override it');
assertEqual(withLocation({ protocol: 'https:', search: '?relayUrl=' }, getRelayUrl),
  `wss://${RELAY_HOST}`, 'An empty ?relayUrl= falls through to the default rather than returning ""');
assertEqual(withLocation({ protocol: 'https:', search: '?seed=12345&mode=creative' }, getRelayUrl),
  `wss://${RELAY_HOST}`, 'Unrelated query parameters change nothing');
assertEqual(withLocation({ protocol: 'https:', search: '', hostname: 'webgame-cuubz.thehomelabguy.com' }, getRelayUrl),
  `wss://${RELAY_HOST}`,
  'The page hostname is NOT consulted — the per-game relay subdomain this file used to assert does not exist');

console.log('Group 5: shape of the result');
{
  const wss = withLocation({ protocol: 'https:', search: '' }, getRelayUrl);
  assert(wss.startsWith('wss://'), 'The deployed URL uses the wss scheme');
  assert(!/:\d+$/.test(wss), 'The deployed URL names no port — nginx forwards 443 to 8765');
  assert(!wss.endsWith('/'), 'The URL has no trailing slash; the client appends /matchmaking and /session/:id');
}

const total = passed + failed;
console.log(`\n--- Results: ${passed}/${total} assertions passed, ${failed} failed ---`);

if (failed > 0) {
  console.error('❌ Some tests failed!');
  process.exit(1);
}
console.log('🎉 All relay URL tests passing — against src/multiplayer/RelayUrl.js, not a copy of it.');
process.exit(0);
