#!/usr/bin/env node
/**
 * Cuubz — total the suite's assertions (PR 31)
 *
 * `test/run_tests.sh` never had this. It printed how many *files* passed; each of the
 * 58 suites prints its own assertion total in its own format and nothing aggregated
 * them, so the "6,532 assertions" figure quoted in six handoff documents was produced
 * by an ad-hoc shell loop that was rewritten from memory each time. This script is that
 * loop, written down.
 *
 * It runs Vitest with `--silent=false` (the config sets `silent: 'passed-only'`, which
 * would hide exactly the lines this reads), then for each test file takes the LAST line
 * matching the four report shapes the suites actually use:
 *
 *     Results: 267/267 passed, 0 failed
 *     Results: 182/182 assertions passed
 *     Results: 116 passed, 0 failed
 *     Survival System Tests: 360 passed, 0 failed
 *
 * The first capture group is the passing count. Verified against the legacy runner at the
 * migration commit: run file-for-file, the old runner and this script produce the **same
 * number for every one of the 58 migrated files**, which is what makes this a measurement
 * rather than a new number. The totals differ only by what PR 31 deliberately added and
 * removed — see that PR's outcome for the reconciliation.
 *
 * Usage: npm run test:count
 */
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const COUNT = /(\d+)(?:\s*\/\s*\d+)?\s+(?:assertions\s+)?passed/;

// `shell: true` is required: spawning `npx.cmd` directly fails with EINVAL on Windows
// under Node's CVE-2024-27980 mitigation, and `res.error` is where that shows up rather
// than in the exit code — which is how the first draft of this script reported
// `TOTAL ASSERTIONS: 0` and exited 0. `--reporter=verbose`, not `basic`: Vitest 4 has no
// `basic` reporter and dies resolving it. Both were caught by the adversarial pass.
const res = spawnSync('npx', ['vitest', 'run', '--silent=false', '--reporter=verbose'], {
  cwd: REPO,
  encoding: 'utf8',
  shell: true,
  maxBuffer: 256 * 1024 * 1024,
});

if (res.error) {
  console.error(`could not run vitest: ${res.error.message}`);
  process.exit(1);
}

const out = (res.stdout || '') + (res.stderr || '');

// Vitest prefixes intercepted console output with `stdout | test/<file> > <name>`.
// Split on those banners so a count is attributed to the file that printed it.
const perFile = new Map();
let current = null;
for (const line of out.split('\n')) {
  // Vitest's own summary (`Test Files  58 passed (58)`) matches the count regex and
  // would be charged to whichever file printed last — which is exactly how the first
  // draft credited `playerPhysics` with 58 assertions instead of its real 40. The
  // summary is the end of anything worth reading.
  if (/^\s*Test Files\s/.test(line)) break;

  const banner = line.match(/^std(?:out|err)\s*\|\s*(\S+\.test\.js)/);
  if (banner) {
    current = banner[1];
    if (!perFile.has(current)) perFile.set(current, null);
    continue;
  }
  if (!current) continue;
  const m = line.match(COUNT);
  if (m) perFile.set(current, Number(m[1])); // last one wins
}

let total = 0;
const missing = [];
for (const [file, n] of [...perFile].sort()) {
  if (n === null) missing.push(file);
  else total += n;
}

for (const [file, n] of [...perFile].sort()) console.log(`${String(n ?? '?').padStart(6)}  ${file}`);
console.log('');
console.log(`files reporting a count : ${perFile.size - missing.length}`);
if (missing.length) console.log(`files with NO count line: ${missing.join(', ')}`);
console.log(`TOTAL ASSERTIONS        : ${total}`);

// A run that spawned nothing must not read as "zero assertions, all fine", and neither
// must a file that prints no count — it would contribute 0 to the total in silence,
// which is the same "green proves nothing" shape this script exists to close. A new
// plain-Vitest file must print a `Results: N/N passed` line to be countable.
if (perFile.size === 0) {
  console.error('no test files reported anything — the vitest run did not produce output');
  process.exit(1);
}
if (missing.length) {
  console.error(`${missing.length} file(s) printed no assertion count — the total above is short`);
  process.exit(1);
}

process.exit(res.status === 0 ? 0 : 1);
