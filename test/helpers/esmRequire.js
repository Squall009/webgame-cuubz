'use strict';
/**
 * Cuubz — let CommonJS tests `require()` the ES modules in `src/` (PR 9)
 *
 * ─── THE PROBLEM THIS SOLVES ────────────────────────────────────────────────
 *
 * `refactor.md` §6 PR 9 step 3 says to keep the `typeof module !== 'undefined'`
 * CommonJS shim "only where a currently-passing test needs it". That instruction
 * cannot be followed as written: the shim is irrelevant once the file contains an
 * `import` or `export` statement, because `require()` refuses to compile the file at
 * all — `SyntaxError: Cannot use import statement outside a module`, before any shim
 * runs. Thirty-five test files require thirty-odd source files. Without something
 * here, PR 9 takes `npm test` from 52/52 to roughly 17/52.
 *
 * The alternatives were weighed and this is the cheapest one that keeps every
 * assertion:
 *
 *   - `"type": "module"` in the root package.json makes `server/` (CommonJS), all 56
 *     test files and both `scripts/` CommonJS too — a far larger blast radius than the
 *     conversion itself, in the PR that is supposed to be mechanical.
 *   - A nested `src/package.json` scoping `"type": "module"` works for Node but adds a
 *     package boundary inside the source tree that Vite also has to be right about.
 *   - Rewriting all 35 test files onto `await import()` means making every one of them
 *     async. That is PR 31/32's job (Vitest), done properly and once.
 *
 * So: a `require` hook that compiles `src/**` as CommonJS on the fly. It is test-only
 * infrastructure, it is installed by `test/run_tests.sh` (`node -r`) and by
 * `test/e2e/saveLoad.js`, and **PR 31 deletes it** — Vitest loads ESM natively, which
 * is most of why PR 31 exists. Its slot is `refactor.md` §11 PR 31.
 *
 * ─── WHY A REGEX TRANSFORM IS ACCEPTABLE HERE AND NOT ELSEWHERE ─────────────
 *
 * `refactor.md` §1.9 criticises `scripts/generate-manifest.js` for eval-parsing source
 * with a regex, and that criticism is right. The difference is the input: this hook
 * only ever sees files written by PR 9's codemod, whose import/export syntax is
 * generated and therefore uniform — `import { a, b } from './X.js';`,
 * `import * as THREE from 'three';`, `import './X.js';`, `import x from './X.js?url';`
 * and `export` on a column-0 declaration. Anything outside that shape is a hard error
 * rather than a silent miss (see `assertNoUnhandledSyntax`), so the failure mode is a
 * red test naming the file and line, not a wrong answer.
 *
 * ─── THE ONE BEHAVIOUR DIFFERENCE, AND WHY IT DOES NOT BITE TODAY ───────────
 *
 * ES modules have live bindings and hoisted, cycle-tolerant evaluation; CommonJS has
 * neither. A cycle that ESM resolves would, under this hook, hand `undefined` to
 * whichever side loads second.
 *
 * `src/` has **no import cycles**, so nothing depends on the difference right now.
 * There was exactly one — `SurvivalSystem.js` ↔ `DamageSystem.js` over `DAMAGE_SOURCES`
 * — and it was not survivable in either format: `DamageSystem.js` reads the table at
 * module top level, so real ESM threw a temporal-dead-zone `ReferenceError` in the
 * browser. PR 9 broke it by moving the table to `src/game/data/DamageSources.js`
 * (**D-26**). If a future PR reintroduces a cycle, the browser and this hook will
 * disagree about it — logged as **D-28**, owned by PR 31, which removes the hook.
 *
 * Exports are exposed as getters rather than a snapshot so a reassigned `let`
 * (`MAX_BLOCK_ID` in `BlockRegistry.js`) still reads through, the way a live binding
 * does. That covers the common half of the difference; cycles are the other half.
 */

const fs = require('fs');
const path = require('path');
const Module = require('module');

const SRC = path.resolve(__dirname, '..', '..', 'src') + path.sep;

if (!global.__cuubzEsmRequireInstalled) {
  global.__cuubzEsmRequireInstalled = true;

  const originalJs = Module._extensions['.js'];

  Module._extensions['.js'] = function (module, filename) {
    if (!filename.startsWith(SRC)) return originalJs(module, filename);
    const source = fs.readFileSync(filename, 'utf8');
    module._compile(transform(source, filename), filename);
  };

  // `?url` imports (the two worker sources — see src/engine/world/ChunkManager.js).
  // Vite turns these into a URL string; Node has no such concept, so resolve the
  // query off and hand back the path as a default export. Nothing in Node spawns a
  // worker, so the value only has to be a string that is not a lie about which file
  // it names.
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (typeof request === 'string' && request.endsWith('?url')) {
      return originalResolve.call(this, request.slice(0, -4), ...rest);
    }
    return originalResolve.call(this, request, ...rest);
  };
}

/** Anything matching these means the transform below would silently drop something. */
function assertNoUnhandledSyntax(out, filename) {
  const leftover = out.split('\n').findIndex((l) => /^\s*(import\s|export\s|export\{)/.test(l));
  if (leftover !== -1) {
    throw new SyntaxError(
      `[esmRequire] ${filename}:${leftover + 1} — unhandled ESM syntax:\n    ` +
        out.split('\n')[leftover].trim() +
        '\n  This hook only understands the import/export shapes PR 9 generates. ' +
        'Teach it the new shape rather than working around it.'
    );
  }
}

function transform(source, filename) {
  const exported = new Set();
  let out = source;

  // `import x from './X.js?url';`  →  the resolved path as a string.
  out = out.replace(
    /^import\s+([A-Za-z_$][\w$]*)\s+from\s+'([^']+)\?url';?[ \t]*(?:\/\/.*)?$/gm,
    (_m, name, spec) => `const ${name} = require.resolve('${spec}');`
  );

  // `import * as NS from 'spec';`
  out = out.replace(
    /^import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+'([^']+)';?[ \t]*(?:\/\/.*)?$/gm,
    (_m, ns, spec) => `const ${ns} = require('${spec}');`
  );

  // `import { a, b as c } from 'spec';`  (single line — the codemod never wraps)
  out = out.replace(/^import\s*\{([^}]*)\}\s*from\s+'([^']+)';?[ \t]*(?:\/\/.*)?$/gm, (_m, names, spec) => {
    const pairs = names
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean)
      .map((n) => {
        const as = n.split(/\s+as\s+/);
        return as.length === 2 ? `${as[0].trim()}: ${as[1].trim()}` : n;
      });
    return `const { ${pairs.join(', ')} } = require('${spec}');`;
  });

  // `import 'spec';`  (side effect only)
  out = out.replace(/^import\s+'([^']+)';?[ \t]*(?:\/\/.*)?$/gm, (_m, spec) => `require('${spec}');`);

  // `export { a, b };`
  out = out.replace(/^export\s*\{([^}]*)\}\s*;?[ \t]*(?:\/\/.*)?$/gm, (_m, names) => {
    for (const n of names.split(',').map((s) => s.trim()).filter(Boolean)) {
      exported.add(n.split(/\s+as\s+/).pop().trim());
    }
    return '';
  });

  // `export <decl> NAME` on a column-0 declaration.
  out = out.replace(
    /^export\s+(async\s+function\*?|function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm,
    (_m, kind, name) => {
      exported.add(name);
      return `${kind} ${name}`;
    }
  );

  assertNoUnhandledSyntax(out, filename);

  if (exported.size) {
    // Getters, not a snapshot: a `let` reassigned after load (MAX_BLOCK_ID in
    // BlockRegistry.js is one) must read through, the way an ES live binding does.
    const props = [...exported].map((n) => `  get ${n}() { return ${n}; },`).join('\n');
    out += `\n\n/* esmRequire: CommonJS view of this module's ES exports */\nmodule.exports = {\n${props}\n};\n`;
  }
  return out;
}

module.exports = { transform };
