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

  // Fixed relay subdomain — works regardless of how the game is reached.
  const protocol = (globalThis.location && globalThis.location.protocol === 'https:') ? 'wss' : 'ws';
  return `${protocol}://cuubz-relay.thehomelabguy.com`;
}
