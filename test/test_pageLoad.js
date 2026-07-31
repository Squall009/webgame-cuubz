#!/usr/bin/env node
/**
 * Cuubz — page structure tests (rewritten in PR 26)
 *
 * ─── WHAT CHANGED, AND WHY THIS FILE SHRANK BY 400 LINES ────────────────────
 *
 * The old file was 486 lines and 115 assertions over a **static markup inventory** of
 * `index.html`. `QUARANTINE.md` called it "`readFileSync` + regex"; it actually parsed
 * with jsdom, which was never the problem. The problem was what it asserted:
 *
 *   - 33 `js/*.js` files on disk and a `js/three.min.js` `<script>` — the whole `js/`
 *     tree was deleted in **PR 9**. (`js/main.js` is `BUGS.md` **D-61**.)
 *   - 26 `textures/*.png` at the repo root — `textures/` has held generated names under
 *     `textures/blocks/` since the manifest landed. Not one of the 26 exists. That
 *     behaviour — every registry block resolving to a PNG on disk — is
 *     `test_manifestGenerator.js`'s job now, and it runs the real generator to check it.
 *   - `#render-distance`, `#inventory-screen`, `#inventory-grid`, `#btn-close-inventory` —
 *     ids that do not exist. The live controls are `#perf-render-distance` (a `<select>`,
 *     not a slider) and `#crafting-screen` / `#crafting-inv-grid` / `#btn-close-crafting`.
 *     (`#music-volume` was asserted too. That one exists — nothing in `src/` reads it,
 *     which is a different problem and not this file's.)
 *   - `css/style.css` — split into 31 files under `src/ui/css/` in this PR.
 *
 * Every one of those was **already false before PR 26 touched anything**. They are
 * deleted, not ported.
 *
 * ─── WHAT SURVIVED, POINTED AT THE ASSEMBLED DOM ────────────────────────────
 *
 * `index.html` is 28 lines now and its `<body>` is one `<div id="app">`; the markup lives
 * in `src/ui/templates/*.js` and `mountTemplates()` puts it back. So the structural
 * assertions mount the templates into a jsdom document and assert against *that* — the
 * same DOM the browser gets — while the three assertions that are genuinely about the
 * HTML file (title, viewport, charset) still read the file.
 *
 * The id list is **derived by scraping `test/e2e/saveLoad.js`**, not transcribed. Those
 * are the ids the end-to-end harness actually drives; hand-copying them would let the two
 * lists drift apart silently, which is the failure mode this whole rewrite is about.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { mountTemplates } = require('../src/ui/templates/index.js');

const ROOT = path.resolve(__dirname, '..');
const HTML_PATH = path.join(ROOT, 'index.html');
const E2E_PATH = path.join(ROOT, 'test', 'e2e', 'saveLoad.js');

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (condition) { passCount++; } else { failCount++; console.error(`  ❌ FAIL — ${message}`); }
}
function assertEquals(actual, expected, message) {
  assert(actual === expected, `${message} (expected ${expected}, got ${actual})`);
}

// ─── The assembled DOM ────────────────────────────────────────────────────────

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>');
const document = dom.window.document;
mountTemplates(document.getElementById('app'));

console.log('Group 1: every id test/e2e/saveLoad.js drives exists in the assembled DOM');

/**
 * Scrape the harness. Two shapes reach an element: a `#id` CSS selector handed to
 * Playwright, and a `getElementById('id')` inside `page.evaluate`. Matches ending in `-`
 * are template literals (`#btn-${mode}`) and are dropped — an id cannot end in a hyphen.
 */
const harness = fs.readFileSync(E2E_PATH, 'utf8');
const e2eIds = new Set();
for (const m of harness.matchAll(/#([A-Za-z][-\w]*)/g)) {
  if (!m[1].endsWith('-')) e2eIds.add(m[1]);
}
for (const m of harness.matchAll(/getElementById\(\s*['"]([^'"]+)['"]/g)) e2eIds.add(m[1]);

assert(e2eIds.size >= 30, `Scraped a plausible id list from saveLoad.js (${e2eIds.size} ids)`);
for (const id of [...e2eIds].sort()) {
  assert(document.getElementById(id) !== null, `#${id} exists (driven by test/e2e/saveLoad.js)`);
}

console.log('Group 2: the assembled document is well-formed');

// 157 ids arrive from 16 template strings that never see each other. A duplicate is
// silent — `getElementById` just returns the first one — so this is the assertion that
// makes splitting the markup safe.
const ids = [...document.querySelectorAll('[id]')].map((el) => el.id);
assertEquals(ids.length, new Set(ids).size,
  `All ids are unique across all 16 templates (${ids.length} elements)`);

// Deliverable 2's gate: the old markup carried 24 `style=` attributes; they are CSS now.
assertEquals(document.querySelectorAll('[style]').length, 0,
  'No inline style= attributes survive in the assembled DOM');

assertEquals(document.querySelectorAll('[onclick],[onload],[onerror],[onchange],[oninput]').length, 0,
  'No inline on* event handlers in the assembled DOM');

// The single best assertion the old file had: boot state is one visible screen.
const screens = [...document.querySelectorAll('.screen')];
assert(screens.length >= 5, `At least 5 .screen elements (found ${screens.length})`);
const visible = screens.filter((s) => !s.classList.contains('hidden'));
assertEquals(visible.length, 1, 'Exactly 1 .screen lacks .hidden on load');
if (visible.length === 1) assertEquals(visible[0].id, 'main-menu', 'The one visible screen is #main-menu');

console.log('Group 3: index.html itself');

const html = fs.readFileSync(HTML_PATH, 'utf8');
const page = new JSDOM(html).window.document;

assertEquals(page.title, 'Cuubz — Voxel Survival', 'Page title is correct');
assert(page.getElementById('app') !== null, 'index.html ships the #app mount point mountTemplates() needs');

const viewport = page.querySelector('meta[name="viewport"]');
assert(viewport !== null, 'Viewport meta tag exists');
const vp = viewport ? viewport.getAttribute('content') || '' : '';
assert(vp.includes('width=device-width'), 'Viewport has width=device-width');
assert(vp.includes('user-scalable=no'), 'Viewport has user-scalable=no (no accidental pinch-zoom on mobile)');

const charset = page.querySelector('meta[charset]');
assert(charset !== null, 'Charset meta tag exists');
if (charset) assertEquals(charset.getAttribute('charset'), 'UTF-8', 'Charset is UTF-8');

const cdn = [...page.querySelectorAll('script[src]')]
  .filter((s) => /^https?:\/\//.test(s.getAttribute('src') || ''));
assertEquals(cdn.length, 0, 'No CDN <script src> — everything is bundled');

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log('\n===================================');
console.log(`Results: ${passCount} passed, ${failCount} failed`);
console.log('===================================');

process.exit(failCount > 0 ? 1 : 0);
