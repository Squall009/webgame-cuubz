#!/usr/bin/env node
/**
 * Cuubz — Module Boundary Gate
 *
 * ─── WHAT THIS USED TO BE, AND WHY IT CHANGED ───────────────────────────────
 *
 * Until PR 9 this script read the `<script src>` list out of `index.html` in load
 * order, collected every column-0 declaration across those 65 files, and exited
 * non-zero if a name was declared twice. All 65 shared one global scope, the file that
 * loaded LAST silently won, and three live production bugs came from exactly that
 * (`refactor.md` §2.1). It was a hard CI gate and it is what stopped PR 3's eight
 * collisions coming back *during* the migration.
 *
 * PR 9 made those files ES modules and left `index.html` with one `<script>` tag. The
 * old check would then scan one file, find zero symbols, and exit 0 having verified
 * nothing — a green gate that checks nothing is worse than no gate, because it reads as
 * coverage. Retiring it belongs to PR 11, in the same commit that turns on ESLint's
 * `no-undef` (the strictly stronger replacement — `refactor.md` §6 PR 11 calls that
 * "the payoff"). Deleting it here would leave the intervening commits unguarded.
 *
 * So it was repointed rather than left vacuous or removed early. Same job — "nothing is
 * quietly sharing the global scope" — asked of the structure that now exists:
 *
 *   1. `index.html` loads EXACTLY ONE `<script type="module">` and ZERO classic
 *      `<script src>` tags. A classic tag reintroduces the shared global scope for
 *      whatever it loads, silently, and is the single fastest way to undo PR 9.
 *   2. No `window.<Name> =` assignment anywhere in `src/`, except the one sanctioned
 *      namespace in `src/testBridge.js` (which PR 12 removes). §14: "Don't assign to
 *      `window.*`. ES exports only."
 *   3. No CommonJS left in `src/`: no `module.exports`, no `typeof module`, no
 *      `require(`. Those were the 62 test shims; `test/helpers/esmRequire.js` replaced
 *      the need for them.
 *   4. Every `.js` file under `src/` is reachable by import from `src/index.js`.
 *      An unreachable module is one Vite will not build, `no-undef` will not lint, and
 *      nobody will notice is dead — which is how twelve subsystems (D-25) came to be
 *      loaded on every page and referenced by nothing.
 *
 * **PR 11 deletes this file and its CI step together.** Do not let it survive as a step
 * that checks something weaker than `no-undef` does.
 *
 * Usage:  node scripts/check-globals.js [--verbose]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const INDEX_HTML = path.join(ROOT, 'index.html');
const ENTRY = 'src/index.js';
const VERBOSE = process.argv.includes('--verbose');

// The one sanctioned `window.*` assignment. Each entry needs a reason and an owner.
const WINDOW_ALLOWLIST = new Map([
  ['src/testBridge.js', 'The e2e harness bridge — refactor.md §7 PR 12 removes it'],
]);

const failures = [];
function fail(message) {
  failures.push(message);
}

/** Every .js file under src/, repo-relative with forward slashes. */
function listSourceFiles(dir = SRC) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSourceFiles(abs));
    else if (entry.name.endsWith('.js')) out.push(path.relative(ROOT, abs).split(path.sep).join('/'));
  }
  return out.sort();
}

/** Strip comments and string/template literals so matches are real code. */
function stripLiterals(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
}

// ─── 1. index.html loads one module and no classic scripts ──────────────────
function checkIndexHtml() {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const tags = [...html.matchAll(/<script\b([^>]*)\bsrc\s*=\s*["']([^"']+)["']([^>]*)>/gi)]
    .map((m) => ({ attrs: m[1] + m[3], src: m[2], line: html.slice(0, m.index).split('\n').length }));

  const modules = tags.filter((t) => /\btype\s*=\s*["']module["']/i.test(t.attrs));
  const classic = tags.filter((t) => !/\btype\s*=\s*["']module["']/i.test(t.attrs));

  if (classic.length) {
    for (const t of classic) {
      fail(
        `index.html:${t.line} loads "${t.src}" as a CLASSIC script. Every top-level ` +
          'declaration in it becomes a global shared with every other classic script — ' +
          'the mechanism behind refactor.md §2.1. Import it from src/index.js instead.'
      );
    }
  }
  if (modules.length !== 1) {
    fail(`index.html must load exactly ONE <script type="module">; found ${modules.length}.`);
  } else if (modules[0].src.replace(/^\//, '') !== ENTRY) {
    fail(`index.html's module entry is "${modules[0].src}"; expected "/${ENTRY}".`);
  }
  return { modules: modules.length, classic: classic.length };
}

// ─── 2/3. No window.* assignments and no CommonJS in src/ ───────────────────
function checkFileContents(files) {
  let windowAssignments = 0;
  for (const file of files) {
    const source = stripLiterals(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    const lines = source.split('\n');

    lines.forEach((line, i) => {
      const win = /(?:^|[^.\w$])window\.([A-Za-z_$][\w$]*)\s*=(?!=)/.exec(line);
      if (win) {
        windowAssignments++;
        if (!WINDOW_ALLOWLIST.has(file)) {
          fail(
            `${file}:${i + 1} assigns window.${win[1]}. ES exports only (refactor.md §14). ` +
              'If a symbol genuinely has to reach the page, it belongs in the one allowlisted ' +
              'bridge, with a reason and the PR that removes it.'
          );
        }
      }
      if (/(?:^|[^.\w$])module\.exports/.test(line) || /typeof\s+module\b/.test(line)) {
        fail(`${file}:${i + 1} still carries a CommonJS export shim. src/ is ES modules only.`);
      }
      if (/(?:^|[^.\w$])require\s*\(/.test(line)) {
        fail(`${file}:${i + 1} calls require(). src/ is ES modules only; tests go through test/helpers/esmRequire.js.`);
      }
    });
  }
  return { windowAssignments };
}

// ─── 4. Every src/ module is reachable from the entry point ─────────────────
function checkReachability(files) {
  const edges = new Map();
  for (const file of files) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const specs = [...source.matchAll(/^import[^'"\n]*['"](\.[^'"]+)['"]/gm)].map((m) => m[1]);
    edges.set(
      file,
      specs.map((s) => {
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), s));
        return resolved.replace(/\?.*$/, ''); // strip ?url and friends
      })
    );
  }

  const seen = new Set();
  const stack = [ENTRY];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const next of edges.get(file) || []) stack.push(next);
  }

  const unreachable = files.filter((f) => !seen.has(f));
  for (const f of unreachable) {
    fail(
      `${f} is not reachable by import from ${ENTRY}. Vite will not build it, ESLint will ` +
        'not see it, and nothing will tell you it is dead. Import it (src/index.js has a ' +
        'section for exactly this, see D-25) or delete it.'
    );
  }
  return { reachable: seen.size, unreachable: unreachable.length };
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.error('❌ src/ does not exist — did the tree move?');
    process.exit(1);
  }
  const files = listSourceFiles();
  if (files.length === 0) {
    console.error('❌ No .js files under src/ — this gate is checking nothing.');
    process.exit(1);
  }

  const html = checkIndexHtml();
  const contents = checkFileContents(files);
  const reach = checkReachability(files);

  console.log(`Scanned ${files.length} ES modules under src/`);
  console.log(`index.html: ${html.modules} module entry, ${html.classic} classic <script src> tags`);
  console.log(`window.* assignments: ${contents.windowAssignments} (allowlisted: ${WINDOW_ALLOWLIST.size} file)`);
  console.log(`Reachable from ${ENTRY}: ${reach.reachable}/${files.length}`);

  if (VERBOSE) {
    console.log('\nModules:');
    for (const f of files) console.log(`  ${f}`);
  }

  if (failures.length === 0) {
    console.log('\n✅ Module boundary intact.');
    process.exit(0);
  }

  console.log(`\n❌ ${failures.length} module boundary violation(s):\n`);
  for (const f of failures) console.log(`  ${f}\n`);
  console.log('PR 11 replaces this gate with ESLint `no-undef` under a flat config.');
  process.exit(1);
}

main();
