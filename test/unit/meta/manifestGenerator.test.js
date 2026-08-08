/**
 * Cuubz — Manifest Generator Smoke Test
 *
 * Replaces test_textureGenerator.js, which asserted the existence of
 * scripts/generate_textures.py — a script that no longer exists.
 *
 * Why this test matters for the refactor: generate-manifest.js does not import
 * the block registry, it *scrapes* it:
 *
 *   eval('(' + registrySource.match(/const BLOCK_REGISTRY = (\[.*?\]);/s)[1] + ')')
 *
 * That regex is non-greedy up to the first `];`. It survives adding
 * `export ` in front of the declaration, but it silently truncates — or throws —
 * if the array is reformatted, wrapped, split, or if a `];` ever appears inside
 * it. A truncated parse still writes a syntactically valid manifest, just one
 * missing most blocks, and the game would then load with missing textures.
 *
 * So the load-bearing assertion here is the cross-check: the number of blocks the
 * script found must equal the number a real `require()` of the registry reports.
 * That is what protects the Phase 1 module conversion.
 *
 * The generator writes textures/blocks/manifest.json, so this test snapshots that
 * file and restores it byte-for-byte afterwards — running the suite must never
 * dirty the working tree.
 */

import { it } from 'vitest';
import { legacy } from '../../helpers/legacy.js';
import { TEST_DIR as __dirname } from '../../helpers/paths.js';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { BLOCK_REGISTRY } from '../../../src/engine/world/BlockRegistry.js';

it('manifestGenerator', () => legacy(async () => {
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
    console.log(`  ❌ ${message}`);
  }
}

function assertEquals(actual, expected, message) {
  assert(actual === expected, `${message}: expected ${expected}, got ${actual}`);
}

const ROOT = path.join(__dirname, '..');
const SCRIPT_PATH = path.join(ROOT, 'scripts', 'generate-manifest.js');
const MANIFEST_PATH = path.join(ROOT, 'textures', 'blocks', 'manifest.json');
const REGISTRY_PATH = path.join(ROOT, 'src', 'engine', 'world', 'BlockRegistry.js');
// The generator writes a second manifest now (items, derived from NAMED_ITEMS). This test
// predates it and only knew to snapshot the block one, so running the suite would have
// left textures/items/manifest.json rewritten in the working tree — the exact thing the
// header above says must never happen. Both are snapshotted and restored below.
const ITEMS_MANIFEST_PATH = path.join(ROOT, 'textures', 'items', 'manifest.json');

console.log('Manifest Generator Smoke Test');
console.log('=============================\n');

// ── Preconditions ─────────────────────────────────────────────
console.log('[Preconditions]');
assert(fs.existsSync(SCRIPT_PATH), 'scripts/generate-manifest.js exists');
// D-82: this message read `js/world/blockRegistry.js`, a path PR 9 renamed 17 PRs before
// this line was last touched. REGISTRY_PATH above has pointed at
// src/engine/world/BlockRegistry.js the whole time, so the assertion was correct and only
// its message lied — which is the worst shape for a message, because it is the only thing
// a reader sees when the assertion goes red.
assert(fs.existsSync(REGISTRY_PATH), 'src/engine/world/BlockRegistry.js exists');

// Snapshot the existing manifests so the run leaves no trace.
const hadManifest = fs.existsSync(MANIFEST_PATH);
const originalManifest = hadManifest ? fs.readFileSync(MANIFEST_PATH) : null;
const hadItemsManifest = fs.existsSync(ITEMS_MANIFEST_PATH);
const originalItemsManifest = hadItemsManifest ? fs.readFileSync(ITEMS_MANIFEST_PATH) : null;

let exitOk = false;
let stdout = '';
try {
  // ── Run the generator ───────────────────────────────────────
  console.log('\n[Execution]');
  stdout = execFileSync(process.execPath, [SCRIPT_PATH], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  exitOk = true;
  assert(true, 'generate-manifest.js runs without throwing');

  assert(/Manifest: \d+ block entries/.test(stdout), 'Reports how many block entries it wrote');
  assert(stdout.includes('Written:'), 'Reports the output path it wrote');
  // The items half runs in a trailing async IIFE (it dynamic-imports an ES module from
  // this CommonJS script). If that ever stops running, the block half still prints a
  // clean success and the only symptom is a stale items manifest, so assert it ran.
  assert(/Item manifest: \d+ item entries/.test(stdout), 'Reports how many item entries it wrote');

  // ── The manifest it produced ────────────────────────────────
  console.log('\n[Manifest output]');
  assert(fs.existsSync(MANIFEST_PATH), 'manifest.json was written');

  const raw = fs.readFileSync(MANIFEST_PATH, 'utf8');
  let manifest = null;
  try {
    manifest = JSON.parse(raw);
    assert(true, 'manifest.json is valid JSON');
  } catch (err) {
    assert(false, `manifest.json is valid JSON (parse error: ${err.message})`);
  }

  if (manifest) {
    assert(Array.isArray(manifest), 'manifest.json is an array');
    assert(manifest.length > 0, `manifest is non-empty (${manifest.length} entries)`);

    // ── The load-bearing check: the scraped parse matches a real require ──
    console.log('\n[Registry cross-check]');
    const expectedEntries = BLOCK_REGISTRY.filter(b => b.texture).length;

    assertEquals(manifest.length, expectedEntries,
      'Manifest covers every registry block that has a texture ' +
      '(a mismatch means the eval-regex truncated the registry)');

    // Also assert the reported count agrees, so a silent write/report drift shows up
    const reported = Number((stdout.match(/Manifest: (\d+) block entries/) || [])[1]);
    assertEquals(reported, manifest.length, 'Reported entry count matches the file written');

    // ── Entry shape ───────────────────────────────────────────
    console.log('\n[Entry shape]');
    const badId = manifest.filter(e => typeof e.id !== 'number');
    const badName = manifest.filter(e => typeof e.name !== 'string' || !e.name);
    const badTextures = manifest.filter(e => !e.textures || typeof e.textures !== 'object');
    assertEquals(badId.length, 0, 'Every entry has a numeric id');
    assertEquals(badName.length, 0, 'Every entry has a non-empty name');
    assertEquals(badTextures.length, 0, 'Every entry has a textures object');

    // ids are unique — a duplicate would mean two blocks fight over one atlas slot
    const ids = new Set(manifest.map(e => e.id));
    assertEquals(ids.size, manifest.length, 'Block ids in the manifest are unique');

    // Every referenced texture records whether the PNG resolved
    const faceEntries = manifest.flatMap(e => Object.values(e.textures));
    assert(faceEntries.length > 0, 'Manifest references at least one texture face');
    const malformed = faceEntries.filter(
      f => !f || typeof f.base !== 'string' || typeof f.exists !== 'boolean'
    );
    assertEquals(malformed.length, 0, 'Every texture face has a string base and boolean exists');

    // ── Textures actually resolve ─────────────────────────────
    console.log('\n[Texture resolution]');
    const missing = faceEntries.filter(f => f.exists === false);
    assertEquals(missing.length, 0,
      missing.length === 0
        ? 'Every registry texture resolves to a PNG on disk'
        : `Every registry texture resolves to a PNG on disk (missing: ${missing.slice(0, 5).map(m => m.base).join(', ')})`);

    // ── Spot-check core blocks ────────────────────────────────
    console.log('\n[Core blocks present]');
    for (const name of ['stone', 'dirt', 'grass_block', 'bedrock']) {
      const entry = manifest.find(e => e.name === name);
      assert(entry !== undefined, `Manifest includes ${name}`);
      if (entry) {
        const faces = Object.keys(entry.textures);
        assert(faces.length > 0, `${name} declares at least one texture face`);
      }
    }

    // grass_block is the interesting one — per-face textures plus a side overlay
    const grass = manifest.find(e => e.name === 'grass_block');
    if (grass) {
      assert(grass.textures.top !== undefined, 'grass_block declares a top texture');
      assert(grass.textures.side !== undefined, 'grass_block declares a side texture');
      assert(grass.overlay !== undefined, 'grass_block carries its overlay definition through');
    }
  }
} catch (err) {
  if (!exitOk) {
    assert(false, `generate-manifest.js runs without throwing (${err.message})`);
  } else {
    assert(false, `Unexpected failure after running the generator: ${err.message}`);
  }
} finally {
  // ── Restore the working tree ────────────────────────────────
  if (hadManifest) {
    fs.writeFileSync(MANIFEST_PATH, originalManifest);
  } else if (fs.existsSync(MANIFEST_PATH)) {
    fs.unlinkSync(MANIFEST_PATH);
  }
  if (hadItemsManifest) {
    fs.writeFileSync(ITEMS_MANIFEST_PATH, originalItemsManifest);
  } else if (fs.existsSync(ITEMS_MANIFEST_PATH)) {
    fs.unlinkSync(ITEMS_MANIFEST_PATH);
  }
}

console.log('\n=============================');
console.log(`Results: ${passCount} passed, ${failCount} failed`);

if (failCount > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
}
console.log('🎉 All manifest generator tests passing!');
process.exit(0);
}));
