#!/usr/bin/env node
/**
 * Cuubz — Three.js pin test (PR 8)
 *
 * `refactor.md` §1.2 is the constraint this file makes executable:
 *
 *   `js/three.min.js` is r134 (2021). `js/renderer/pbrShader.js` is 843 hand-written
 *   lines with seven `ShaderMaterial` instances, `fog: true` on six of them, custom
 *   world-space lighting and custom shadow-map uniforms. There is ZERO occurrence of
 *   `outputEncoding`, `sRGBEncoding`, `outputColorSpace`, `physicallyCorrectLights` or
 *   `useLegacyLights` anywhere in `js/`. Three r15x+ flipped colour management to
 *   sRGB-by-default and changed light units, so a blind upgrade changes **every colour
 *   in the game** and breaks the shader's fog and shadow integration.
 *
 * The upgrade is a separate project (`refactor.md` §12), gated on screenshot diffing.
 * Until then the pin is load-bearing, and until this file it was a paragraph.
 *
 * WHY THIS IS THREE ASSERTIONS AND NOT ONE
 * ----------------------------------------
 * There are two copies of Three in this repo and PR 9 is the PR that swaps which one
 * runs: `js/three.min.js` (loaded by a `<script>` tag today) and the `three` package
 * (imported by ES modules from PR 9 onward). The dangerous state is not "the pin
 * moved" — it is **the two copies disagreeing**, because the switchover would then
 * silently change renderer behaviour while every version string still looked right in
 * isolation. So this checks the declared range, the installed package, the vendored
 * bundle, and that all three agree.
 *
 * `npm run test:e2e` asserts `THREE.REVISION === 134` from the running browser, which
 * covers the vendored bundle at runtime. It is not in CI (it needs Edge). This is.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PINNED = '0.134.0';
const REVISION = '134';

let passCount = 0;
let failCount = 0;
const failures = [];

function assert(condition, message) {
  if (condition) {
    passCount++;
  } else {
    failCount++;
    failures.push(message);
    console.log(`FAIL: ${message}`);
  }
}

function assertEquals(actual, expected, message) {
  assert(actual === expected, `${message} (expected ${expected}, got ${actual})`);
}

/**
 * Read `REVISION` out of the minified UMD bundle.
 *
 * The bundle assigns `t.REVISION=<ident>` where `<ident>` is a minifier-chosen name,
 * so the literal is found in two steps rather than by grepping for `"134"` — which
 * would also match a shader define, a magic number, or nothing at all after a rebuild.
 */
function revisionFromBundle(source) {
  const assignment = /\.REVISION\s*=\s*([A-Za-z_$][\w$]*)/.exec(source);
  if (!assignment) return { error: 'no `.REVISION=<ident>` assignment found' };
  const ident = assignment[1];
  const literal = new RegExp(`\\b${ident}\\s*=\\s*["']([^"']+)["']`).exec(source);
  if (!literal) return { error: `\`${ident}\` is assigned to REVISION but never to a string literal` };
  return { revision: literal[1], ident };
}

console.log('\n=== Three.js pin (refactor.md §1.2) ===\n');

// ── 1. The declared dependency is EXACT ──────────────────────────
//
// `^0.134.0` would satisfy 0.134.x today and is a different constraint from
// `0.134.0`. Three ships breaking changes in minor releases — that is the whole
// premise of §1.2 — so the caret is the bug, not the version.
{
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const declared = (pkg.dependencies || {}).three;
  assert(declared !== undefined, 'three is declared in package.json dependencies');
  assertEquals(declared, PINNED, 'three is pinned EXACTLY — no ^, no ~, no range');
  assert(!/[\^~><*x]/.test(declared || ''), `The three range contains no range operator (got "${declared}")`);
}

// ── 2. The installed package matches the pin ─────────────────────
{
  const installedPkg = path.join(ROOT, 'node_modules', 'three', 'package.json');
  if (!fs.existsSync(installedPkg)) {
    assert(false, 'node_modules/three is installed (run npm ci)');
  } else {
    const installed = JSON.parse(fs.readFileSync(installedPkg, 'utf8'));
    assertEquals(installed.version, PINNED, 'The INSTALLED three matches the pin');
  }
}

// ── 3. The vendored bundle is the same revision ──────────────────
//
// This is the copy the game actually runs today: index.html loads
// js/three.min.js through a classic <script> tag. PR 9 switches the renderer to
// the npm package, and the two must be the same revision across that switch or
// the change is not the mechanical one PR 9 claims to be.
{
  const bundlePath = path.join(ROOT, 'js', 'three.min.js');
  assert(fs.existsSync(bundlePath), 'js/three.min.js is still on disk (PR 9 removes it, not PR 8)');
  if (fs.existsSync(bundlePath)) {
    const source = fs.readFileSync(bundlePath, 'utf8');
    const found = revisionFromBundle(source);
    assert(!found.error, `js/three.min.js exposes a readable REVISION${found.error ? ` — ${found.error}` : ''}`);
    if (!found.error) {
      assertEquals(found.revision, REVISION, 'js/three.min.js is r134');
    }
    // The pinned package version and the bundle revision are two spellings of the
    // same number. If they ever disagree, PR 9's switchover changes the renderer.
    assertEquals(`0.${REVISION}.0`, PINNED,
      'The pinned package version and the vendored bundle revision are the same release');
  }
}

// ── Results ──────────────────────────────────────────────────────
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passCount} passed, ${failCount} failed`);
if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f}`));
  console.log('\nrefactor.md §1.2: do NOT "fix" this by upgrading three. The renderer');
  console.log('depends on r134 defaults and the upgrade is a separate project (§12).');
  process.exit(1);
}
console.log('All tests passed!\n');
process.exit(0);
