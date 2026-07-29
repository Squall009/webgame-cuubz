#!/usr/bin/env node
/**
 * Cuubz — Global Collision Detector
 *
 * All 64 classic <script> tags in index.html share one global scope. A top-level
 * `const`/`let`/`var`/`function`/`class` declared in two files silently collides:
 * the file that loads LAST wins, and the earlier definition vanishes with no error.
 *
 * Three live production bugs were caused by exactly this (see refactor.md §2.1).
 *
 * This script reads the <script src> list from index.html in load order, collects
 * every column-0 declaration, and exits non-zero if any name is declared twice.
 *
 * Usage:  node scripts/check-globals.js [--verbose]
 *
 * Assumption: this codebase indents all nested code, so a declaration keyword at
 * column 0 is top-level. IIFE-wrapped files (js/main.js) correctly contribute nothing.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INDEX_HTML = path.join(ROOT, 'index.html');
const VERBOSE = process.argv.includes('--verbose');

// Files that are deliberately allowed to redeclare a name. Each entry needs a reason.
// Keep this EMPTY if at all possible — an allowance here is a silent-collision waiver.
const ALLOWLIST = new Map([
  // 'symbolName', 'why it is safe'
]);

/** Extract `src` values from every <script src="..."> in index.html, in load order. */
function readScriptSources() {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const sources = [];
  const re = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    // Strip the ?v=cache-bust query string.
    sources.push({ src: m[1].split('?')[0], htmlLine: html.slice(0, m.index).split('\n').length });
  }
  return sources;
}

/**
 * Collect top-level declarations from one file.
 * Returns [{ name, kind, line }].
 */
function collectTopLevelDeclarations(source) {
  const declarations = [];
  const lines = source.split('\n');

  // Column-0 declaration keywords. Destructuring patterns are handled separately.
  const simple = /^(export\s+)?(async\s+function\*?|function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/;
  const destructured = /^(export\s+)?(const|let|var)\s+[[{]/;

  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track /* */ comments so commented-out declarations do not count.
    if (inBlockComment) {
      if (line.includes('*/')) inBlockComment = false;
      continue;
    }
    const openIdx = line.indexOf('/*');
    if (openIdx !== -1 && !line.includes('*/', openIdx)) {
      inBlockComment = true;
      if (openIdx === 0) continue;
    }

    const m = simple.exec(line);
    if (m) {
      declarations.push({ name: m[3], kind: m[2].trim(), line: i + 1 });
      continue;
    }

    if (destructured.test(line)) {
      // e.g.  const { a, b } = require('x')   /   const [x, y] = ...
      const names = line.match(/[A-Za-z_$][\w$]*(?=\s*[,:}\]=])/g) || [];
      const kind = /^(export\s+)?(const|let|var)/.exec(line)[2];
      for (const name of names) {
        if (name === 'const' || name === 'let' || name === 'var' || name === 'export') continue;
        declarations.push({ name, kind, line: i + 1 });
      }
    }
  }

  return declarations;
}

function main() {
  const sources = readScriptSources();
  if (sources.length === 0) {
    console.error('❌ No <script src> tags found in index.html — did the file move?');
    process.exit(1);
  }

  // name -> [{ file, line, kind }]
  const symbols = new Map();
  let filesScanned = 0;
  const missing = [];

  for (const { src } of sources) {
    // Skip the vendored Three.js bundle — minified, one line, not ours to police.
    if (src.endsWith('three.min.js')) continue;

    const abs = path.join(ROOT, src);
    if (!fs.existsSync(abs)) {
      missing.push(src);
      continue;
    }

    filesScanned++;
    const declarations = collectTopLevelDeclarations(fs.readFileSync(abs, 'utf8'));
    for (const d of declarations) {
      if (!symbols.has(d.name)) symbols.set(d.name, []);
      symbols.get(d.name).push({ file: src, line: d.line, kind: d.kind });
    }
  }

  const duplicates = [...symbols.entries()]
    .filter(([name, sites]) => sites.length > 1 && !ALLOWLIST.has(name))
    .sort((a, b) => a[0].localeCompare(b[0]));

  console.log(`Scanned ${filesScanned} script-tagged files from index.html`);
  console.log(`Found ${symbols.size} unique top-level symbols`);

  if (missing.length) {
    console.log(`\n⚠️  ${missing.length} <script src> path(s) do not exist on disk:`);
    for (const src of missing) console.log(`   ${src}`);
  }

  if (VERBOSE) {
    console.log('\nAll symbols:');
    for (const [name, sites] of [...symbols].sort()) {
      console.log(`  ${name}  ←  ${sites.map((s) => `${s.file}:${s.line}`).join(', ')}`);
    }
  }

  if (duplicates.length === 0) {
    console.log('\n✅ No duplicate top-level declarations.');
    process.exit(0);
  }

  console.log(`\n❌ ${duplicates.length} duplicate top-level symbol(s) — later script wins, earlier one is silently lost:\n`);
  for (const [name, sites] of duplicates) {
    console.log(`  ${name}`);
    sites.forEach((s, i) => {
      const tag = i === sites.length - 1 ? '  ← WINS (loads last)' : '  ← shadowed';
      console.log(`      ${s.kind} at ${s.file}:${s.line}${tag}`);
    });
    console.log('');
  }
  console.log('Fix by renaming, consolidating into a shared module, or (post-Phase 1) using ES module scope.');
  process.exit(1);
}

main();
