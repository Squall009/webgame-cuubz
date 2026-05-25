#!/usr/bin/env node
'use strict';

/**
 * Tests for getRelayUrl() relay URL auto-detection logic.
 * Extracts the pure logic from main.js into a testable function.
 */

// ============================================================
// Pure implementation of getRelayUrl logic (extracted from main.js)
// This mirrors the browser function but is Node.js testable.
// ============================================================

/**
 * Determine the correct WebSocket relay URL based on page origin.
 * @param {string} [pageOrigin] — Page origin for testing (e.g., 'https://webgame-cuubz.thehomelabguy.com')
 * @param {string} [queryParam] — Simulated ?relayUrl= query parameter
 * @returns {string} WebSocket URL for the matchmaking relay server
 */
function getRelayUrl(pageOrigin, queryParam) {
  // Allow override via URL query parameter: ?relayUrl=ws://custom-host:8765
  if (queryParam) return queryParam;

  // Use provided origin or detect from current page
  const origin = pageOrigin || '';
  const hostname = pageOrigin
    ? new URL(pageOrigin).hostname
    : '';

  // If served from thehomelabguy.com domain, use WSS through NPM relay proxy
  if (hostname && hostname.endsWith('.thehomelabguy.com')) {
    // Extract game subdomain: webgame-cuubz.thehomelabguy.com → relay.webgame-cuubz.thehomelabguy.com
    const domain = hostname;
    const parts = domain.split('.');
    if (parts.length >= 3) {
      const subdomain = parts[0];
      const baseDomain = parts.slice(1).join('.');
      return `wss://relay.${subdomain}.${baseDomain}`;
    }
  }

  // Default: localhost for local development / direct server access
  return 'ws://localhost:8765';
}

// ============================================================
// Test assertions
// ============================================================

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  assert(actual === expected, `${message} — expected "${expected}", got "${actual}"`);
}

// ============================================================
// Test Groups
// ============================================================

console.log('Test Group 1: Query parameter override');
assertEqual(getRelayUrl(undefined, 'ws://custom:9999'), 'ws://custom:9999', 'Query param overrides everything');
assertEqual(getRelayUrl('https://webgame-cuubz.thehomelabguy.com', 'wss://test:8080'), 'wss://test:8080', 'Query param overrides domain detection');

console.log('\nTest Group 2: Localhost default (no origin)');
assertEqual(getRelayUrl(), 'ws://localhost:8765', 'No origin → localhost default');
assertEqual(getRelayUrl(''), 'ws://localhost:8765', 'Empty origin → localhost default');

console.log('\nTest Group 3: Localhost origin');
assertEqual(getRelayUrl('http://localhost'), 'ws://localhost:8765', 'http://localhost → ws://localhost:8765');
assertEqual(getRelayUrl('http://localhost:8080'), 'ws://localhost:8765', 'localhost with port → ws://localhost:8765');
assertEqual(getRelayUrl('http://127.0.0.1'), 'ws://localhost:8765', '127.0.0.1 → ws://localhost:8765');
assertEqual(getRelayUrl('http://10.0.30.160'), 'ws://localhost:8765', 'Internal IP → ws://localhost:8765');

console.log('\nTest Group 4: thehomelabguy.com domain detection');
assertEqual(
  getRelayUrl('https://webgame-cuubz.thehomelabguy.com'),
  'wss://relay.webgame-cuubz.thehomelabguy.com',
  'Deployed URL → WSS relay subdomain'
);
assertEqual(
  getRelayUrl('http://webgame-cuubz.thehomelabguy.com'),
  'wss://relay.webgame-cuubz.thehomelabguy.com',
  'HTTP deployed URL → still uses WSS relay'
);
assertEqual(
  getRelayUrl('https://webgame-deeproot.thehomelabguy.com'),
  'wss://relay.webgame-deeproot.thehomelabguy.com',
  'Different game subdomain → correct relay subdomain'
);

console.log('\nTest Group 5: Subdomain extraction logic');
assertEqual(
  getRelayUrl('https://a.b.c.thehomelabguy.com'),
  'wss://relay.a.b.c.thehomelabguy.com',
  'Multi-level subdomain preserved'
);

console.log('\nTest Group 6: Non-thehomelabguy domains');
assertEqual(getRelayUrl('https://example.com'), 'ws://localhost:8765', 'Random domain → localhost default');
assertEqual(getRelayUrl('https://github.com/user/repo'), 'ws://localhost:8765', 'GitHub URL → localhost default');
assertEqual(getRelayUrl('https://cdn.cloudflare.com'), 'ws://localhost:8765', 'CDN domain → localhost default');

console.log('\nTest Group 7: Edge cases');
assertEqual(getRelayUrl(null), 'ws://localhost:8765', 'null origin → localhost default');
assertEqual(getRelayUrl(undefined, undefined), 'ws://localhost:8765', 'undefined params → localhost default');

console.log('\nTest Group 8: URL scheme handling');
assertEqual(
  getRelayUrl('https://webgame-cuubz.thehomelabguy.com/path'),
  'wss://relay.webgame-cuubz.thehomelabguy.com',
  'URL with path → hostname extracted correctly'
);
assertEqual(
  getRelayUrl('https://webgame-cuubz.thehomelabguy.com?foo=bar'),
  'wss://relay.webgame-cuubz.thehomelabguy.com',
  'URL with query string → hostname extracted correctly'
);

console.log('\nTest Group 9: Relay URL format validation');
const relayUrl = getRelayUrl('https://webgame-cuubz.thehomelabguy.com');
assert(relayUrl.startsWith('wss://'), 'Deployed relay URL uses WSS scheme');
assert(!relayUrl.includes(':8765'), 'WSS relay URL does not include port (implicit 443)');

const localUrl = getRelayUrl();
assert(localUrl.startsWith('ws://'), 'Local relay URL uses WS scheme');
assert(localUrl.endsWith(':8765'), 'Local relay URL includes port 8765');

// ============================================================
// Results
// ============================================================

const total = passed + failed;
console.log(`\n--- Results: ${passed}/${total} assertions passed, ${failed} failed ---`);

if (failed > 0) {
  console.error('❌ Some tests failed!');
  process.exit(1);
} else {
  console.log('🎉 All relay URL tests passing!');
  process.exit(0);
}
