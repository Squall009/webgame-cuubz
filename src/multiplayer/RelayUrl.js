/**
 * Cuubz — where the matchmaking relay lives (PR 16)
 *
 * Extracted from `src/main.js` as its own module for one reason beyond size:
 * `test/test_relayUrl.js` carried 152 lines of assertions against a **reimplementation**
 * of this function that it defined inline, and that copy resolved a per-subdomain relay
 * (`wss://relay.<sub>.<domain>`) which the shipped function has not done for some time. A
 * test that asserts a private copy of the logic cannot go red when the real logic changes
 * — `BUGS.md` **D-45**. A file this small, with no DOM and no imports, is `require()`-able
 * from a Node test, which is what lets that row be closed rather than restated.
 *
 * The `pageOrigin` parameter this function used to take is gone — `BUGS.md` **D-46**. It
 * was documented as a test override and **no line of the function ever read it**, in nine
 * of nine call sites that passed nothing. The override that works is the `?relayUrl=`
 * query parameter below.
 *
 * **D-82:** that last sentence used to name `test/e2e/saveLoad.js` as the harness that
 * uses `?relayUrl=`. It never did — `saveLoad.js` is the single-player save/load harness
 * and never opens a relay connection at all. The file that points this parameter at a
 * local relay is **`test/e2e/multiplayer.js`** (PR 31), which spawns a relay child on a
 * fixed port and loads the page with `?relayUrl=ws://localhost:<port>`. Naming the wrong
 * harness is worse than naming none: it sends anyone changing this function to a file
 * whose 189 assertions cannot go red for it.
 */

/**
 * Determine the WebSocket relay URL for the current page.
 *
 * The relay runs behind `cuubz-relay.thehomelabguy.com` with path-based routing —
 * `/matchmaking` for session discovery, `/session/:id` for a game session — and nginx
 * terminates TLS, so the game never names a port.
 *
 * @returns {string} a `ws://` or `wss://` URL.
 */
export function getRelayUrl() {
  // Override via URL query parameter: ?relayUrl=ws://localhost:8765
  if (globalThis.location && globalThis.location.search) {
    const params = new URLSearchParams(globalThis.location.search);
    const relayOverride = params.get('relayUrl');
    if (relayOverride) return relayOverride;
  }

  const loc = globalThis.location;
  const protocol = loc && loc.protocol === 'https:' ? 'wss' : 'ws';

  // ─── D-102: the page's own host, when it is not the public one ──────────────
  //
  // This function used to return `${protocol}://cuubz-relay.thehomelabguy.com`
  // unconditionally, and the test above this one asserted, deliberately, that "the page
  // hostname is NOT consulted". That is correct for the public deployment — the relay
  // subdomain is fronted by a reverse proxy that terminates TLS and forwards to 8765, so
  // the game names no port — and it is **unconditionally wrong for every other way the
  // game is reached.**
  //
  // Loading the game straight off the production server, `http://10.0.30.160/`, made the
  // client open `ws://cuubz-relay.thehomelabguy.com` — a different machine, on port 80,
  // where no relay listens. **Multiplayer could not work from an IP at all**: the host's
  // HOST never reached the relay and the guest's BROWSE never saw it, which reads exactly
  // like "hosting works but sessions do not show up".
  //
  // The relay itself was never the problem. Verified against 10.0.30.160:8765 by hand:
  // `HOST` returns `HOST_CREATED` and a second socket's `BROWSE` returns that session.
  // `npm run test:e2e:mp` passes 70 assertions across two browser contexts. Both talk to
  // a relay they name explicitly; neither exercises this function's default.
  //
  // The rule below is additive on purpose. The public hostname keeps byte-identical
  // behaviour, so the proxied path is untouched; the only inputs whose result changes are
  // the ones that were already broken.
  const host = loc && loc.hostname;
  if (host && !/(^|\.)thehomelabguy\.com$/.test(host)) {
    // Served from an IP, localhost, or any other host: the relay is the one on THIS
    // machine. `server/index.js` binds 8765 directly and nothing proxies it there, so
    // unlike the public path this URL has to name the port.
    return `${protocol}://${host}:8765`;
  }

  // Public deployment (or no `location` at all — Node, a worker, a unit test): the fixed
  // relay subdomain, no port, TLS terminated in front of it.
  return `${protocol}://cuubz-relay.thehomelabguy.com`;
}
