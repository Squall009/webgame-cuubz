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

import { it } from 'vitest';
import { legacy } from '../../helpers/legacy.js';
import { TEST_DIR as __dirname } from '../../helpers/paths.js';
import fs from 'fs';
import path from 'path';

it('threePin', () => legacy(async () => {
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
  // (a) Unminified ESM build (`node_modules/three/build/three.module.js`, which is
  //     what Vite resolves): `const REVISION = '134';` — the identifier survives.
  const declared = /\bREVISION\s*=\s*["']([^"']+)["']/.exec(source);
  if (declared) return { revision: declared[1], form: 'declaration' };

  // (b) Minified UMD build: `t.REVISION=<minified ident>`, so the literal is found in
  //     two steps rather than by grepping for `"134"` — which would also match a
  //     shader define, a magic number, or nothing at all after a rebuild.
  const assignment = /\.REVISION\s*=\s*([A-Za-z_$][\w$]*)/.exec(source);
  if (!assignment) return { error: 'no `REVISION = "<literal>"` and no `.REVISION=<ident>` assignment found' };
  const ident = assignment[1];
  const literal = new RegExp(`\\b${ident}\\s*=\\s*["']([^"']+)["']`).exec(source);
  if (!literal) return { error: `\`${ident}\` is assigned to REVISION but never to a string literal` };
  return { revision: literal[1], ident, form: 'minified' };
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

// ── 3. The bundle the browser actually executes is the same revision ──
//
// PR 8 checked `js/three.min.js`, because that was the copy the game ran: a classic
// <script> tag in index.html. **PR 9 deleted it** and switched every renderer file to
// `import * as THREE from 'three'`, so the copy the browser executes is now the one
// Vite resolves out of node_modules — `three`'s `module` entry, `build/three.module.js`.
//
// The assertion is therefore repointed rather than dropped. It is the same claim it
// always was ("the code the browser runs is r134"), aimed at the file that is now true
// of. Section 2 above already checks the package *manifest*; this checks the built
// artifact inside it, because a manifest version and a bundle revision are two
// different facts and §1.2's failure mode is exactly the two disagreeing.
{
  const legacyBundle = path.join(ROOT, 'js', 'three.min.js');
  assert(!fs.existsSync(legacyBundle),
    'The vendored js/three.min.js is gone — PR 9 removed it and switched to the npm package');

  const pkgPath = path.join(ROOT, 'node_modules', 'three', 'package.json');
  if (!fs.existsSync(pkgPath)) {
    assert(false, 'node_modules/three is installed (run npm ci)');
  } else {
    // Resolve the ESM entry the same way Vite does: package.json `module`, falling
    // back to `main`. Hard-coding `build/three.module.js` would stop checking anything
    // the day the package reorganises its files.
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const entry = pkg.module || pkg.main;
    assert(!!entry, 'three declares an entry point (`module` or `main`)');
    const entryPath = path.join(ROOT, 'node_modules', 'three', entry);
    assert(fs.existsSync(entryPath), `three's declared entry exists on disk (${entry})`);
    if (fs.existsSync(entryPath)) {
      const found = revisionFromBundle(fs.readFileSync(entryPath, 'utf8'));
      assert(!found.error, `${entry} exposes a readable REVISION${found.error ? ` — ${found.error}` : ''}`);
      if (!found.error) assertEquals(found.revision, REVISION, `${entry} is r134`);
    }
  }

  // The pinned package version and the bundle revision are two spellings of the same
  // number. If they ever disagree, the renderer is running something else.
  assertEquals(`0.${REVISION}.0`, PINNED,
    'The pinned package version and the shipped bundle revision are the same release');
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
}));
