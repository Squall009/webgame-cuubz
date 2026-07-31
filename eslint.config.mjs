/**
 * Cuubz — ESLint flat config (PR 11)
 *
 * **Flat config, not `.eslintrc.cjs`.** ESLint 9+ ignores the old file entirely;
 * `refactor.md` §14 names that as an anti-pattern because v1 of the plan got it wrong.
 *
 * **`.mjs`, not `.js`.** §4.1 names this file `eslint.config.js`; the extension is the one
 * deviation and it is not a design change. This file is an ES module and package.json has
 * no `"type": "module"` — adding one would reclassify every `.js` in `test/` and
 * `scripts/`, which are CommonJS. Without it Node prints a MODULE_TYPELESS_PACKAGE_JSON
 * warning on every single lint run. `.mjs` is ESLint's documented answer and costs nothing.
 *
 * **PR 33 note.** `server/` *did* get a `"type": "module"`, in `server/package.json` —
 * scoped to that subtree precisely so the root does not need one and `scripts/` and
 * `test/e2e/` keep the CommonJS they actually are. That is what let `shared/protocol.js`
 * be one ES module both the browser bundle and the relay import; see that file.
 *
 * ─── `no-undef` IS THE POINT ────────────────────────────────────────────────
 *
 * `refactor.md` §6 PR 11 calls it "the payoff", and the payoff only became collectable at
 * PR 9. Before that every one of the 65 files was a classic `<script>` sharing one global
 * scope, so *every* cross-file reference was an undeclared global and `no-undef` would
 * have reported 368 symbols as errors. With ES modules, an unresolved name is a real bug
 * — and `no-undef` is what replaces `scripts/check-globals.js`, which this PR deletes.
 *
 * Do not disable the rule. Do not add a name to `globals` below to silence a report:
 * `globals` is for things the *host environment* provides, and anything else that is
 * undefined is either a missing import or a typo.
 *
 * ─── THE THREE ENVIRONMENTS ─────────────────────────────────────────────────
 *
 * This codebase has three, and they are genuinely different:
 *
 *   1. `src/**`      — browser ES modules. `window`, `document`, `IndexedDB`, `WebGL`.
 *   2. `scripts/**` and `test/e2e/**` — Node CommonJS. `require`, `module`, `__dirname`.
 *      (`server/**` was in this bucket until PR 33 and is now a Node ES module; `test/**`
 *      left at PR 31.)
 *   3. `src/engine/renderer/meshWorker.js` and `src/engine/world/workerGeneration.js`
 *      — Web Worker **classic scripts**. Not modules, no `window`, but `self`,
 *      `postMessage` and `onmessage`. They are fetched as text and wrapped in a Blob
 *      (`refactor.md` §1.3); linting them as browser modules reports `self` and
 *      `postMessage` as undefined and misses that `import` would break them.
 *
 * The globals lists are written out rather than pulled from the `globals` package. One
 * fewer dependency, and an explicit list is a statement about what this code is allowed
 * to reach for — which is the same reason `check-globals.js` existed.
 */

const BROWSER_GLOBALS = {
  // Core
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  location: 'readonly',
  history: 'readonly',
  console: 'readonly',
  performance: 'readonly',
  screen: 'readonly',
  // Timers
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  queueMicrotask: 'readonly',
  // Networking / workers
  fetch: 'readonly',
  Request: 'readonly',
  Response: 'readonly',
  Headers: 'readonly',
  WebSocket: 'readonly',
  Worker: 'readonly',
  Blob: 'readonly',
  File: 'readonly',
  FileReader: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  AbortController: 'readonly',
  // Storage — DEPLOY.md §2 lives on these
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  indexedDB: 'readonly',
  IDBKeyRange: 'readonly',
  IDBRequest: 'readonly',
  // DOM types used with `instanceof` / `new`
  Image: 'readonly',
  ImageData: 'readonly',
  Event: 'readonly',
  CustomEvent: 'readonly',
  MouseEvent: 'readonly',
  KeyboardEvent: 'readonly',
  TouchEvent: 'readonly',
  PointerEvent: 'readonly',
  HTMLElement: 'readonly',
  HTMLCanvasElement: 'readonly',
  HTMLImageElement: 'readonly',
  Node: 'readonly',
  DOMParser: 'readonly',
  MutationObserver: 'readonly',
  ResizeObserver: 'readonly',
  IntersectionObserver: 'readonly',
  getComputedStyle: 'readonly',
  matchMedia: 'readonly',
  // Audio — the subsystem D-25 says is never instantiated, but still has to lint
  AudioContext: 'readonly',
  webkitAudioContext: 'readonly',
  OfflineAudioContext: 'readonly',
  // Misc
  alert: 'readonly',
  confirm: 'readonly',
  prompt: 'readonly',
  crypto: 'readonly',
  btoa: 'readonly',
  atob: 'readonly',
  AbortSignal: 'readonly',
  structuredClone: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  createImageBitmap: 'readonly',
};

const NODE_GLOBALS = {
  require: 'readonly',
  module: 'writable',
  exports: 'writable',
  process: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  Buffer: 'readonly',
  global: 'writable',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  setImmediate: 'readonly',
  queueMicrotask: 'readonly',
  URL: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  AbortController: 'readonly',
  structuredClone: 'readonly',
  fetch: 'readonly',
};

const WORKER_GLOBALS = {
  self: 'readonly',
  postMessage: 'readonly',
  onmessage: 'writable',
  onerror: 'writable',
  importScripts: 'readonly',
  console: 'readonly',
  performance: 'readonly',
  Blob: 'readonly',
  URL: 'readonly',
  fetch: 'readonly',
};

const BASE_RULES = {
  'no-undef': 'error',
  'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
};

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'textures/**', 'test/e2e/artifacts/**', 'sync-legacy.sh'],
  },

  // ── 1. The application: browser ES modules ────────────────────────────────
  {
    files: ['src/**/*.js'],
    ignores: ['src/engine/renderer/meshWorker.js', 'src/engine/world/workerGeneration.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: BROWSER_GLOBALS,
    },
    rules: BASE_RULES,
  },

  // ── 2. The two Web Workers: classic scripts, not modules ──────────────────
  //
  // `sourceType: 'script'` is the load-bearing part. It makes an accidental `import`
  // in either file a parse error here rather than a silent runtime failure in a Blob
  // worker — where the pool falls back to main-thread generation and only `console.warn`s
  // (see the assertion in test/e2e/saveLoad.js).
  {
    files: ['src/engine/renderer/meshWorker.js', 'src/engine/world/workerGeneration.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: { ...WORKER_GLOBALS, window: 'readonly', document: 'readonly' },
    },
    rules: BASE_RULES,
  },

  // ── 3. Node CommonJS: the scripts and the e2e harness ─────────────────────
  //
  // `test/**` used to be in this list and is not any more — PR 31 moved the unit suite
  // to Vitest and ES modules, and the first converted file failed `no-undef` on its own
  // `import` until this block was split (**D-79**). `server/**` left at PR 33 for the
  // same reason, one block down. What is left here is genuinely still CommonJS:
  // `scripts/` (both shell out or are shelled out to) and `test/e2e/` — the browser
  // harness, a standalone Node program rather than a Vitest file, which is excluded
  // from the Vitest glob for that reason. Its `page.evaluate` callbacks are serialised
  // into a browser, which is why this block keeps the browser globals.
  {
    files: ['scripts/**/*.js', 'test/e2e/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: { ...NODE_GLOBALS, ...BROWSER_GLOBALS },
    },
    rules: BASE_RULES,
  },

  // ── 3a. The relay: Node ES modules (PR 33) ────────────────────────────────
  //
  // `server/package.json` says `"type": "module"`, so Node parses these as ES modules
  // and `require` / `module.exports` / `__dirname` are **ReferenceErrors at runtime**,
  // not merely unfashionable. They are therefore switched off here rather than
  // inherited from NODE_GLOBALS: a leftover `module.exports` in a converted file is a
  // `no-undef` error at lint time instead of a crash on the deploy host. `test/**`
  // does the same thing with `__dirname` for the same reason.
  //
  // No BROWSER_GLOBALS. The relay is Node; `WebSocket` here comes from `ws` by import,
  // and anything that reaches for a browser global is a bug worth an error.
  {
    files: ['server/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...NODE_GLOBALS,
        require: 'off',
        module: 'off',
        exports: 'off',
        __dirname: 'off',
        __filename: 'off',
      },
    },
    rules: BASE_RULES,
  },

  // ── 3c. `shared/`: ES modules BOTH environments import ────────────────────
  //
  // `shared/protocol.js` is imported by `src/multiplayer/Client.js` (browser, through
  // Vite) and by `server/` (Node). Only the **intersection** of the two environments is
  // available to it, which is why this block does not spread NODE_GLOBALS or
  // BROWSER_GLOBALS: a `process.env` read here would work on the relay and be a
  // ReferenceError in the bundle, and the linter should be the one that says so.
  {
    files: ['shared/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { console: 'readonly' },
    },
    rules: BASE_RULES,
  },

  // ── 3b. The Vitest suite: Node ES modules ─────────────────────────────────
  //
  // `sourceType: 'module'` is the half that matters: these files `import` from `src/`,
  // which is what deleting `test/helpers/esmRequire.js` bought. They keep the Node
  // globals (`process`, `Buffer`, `URL`) and the browser ones (several build a `document`
  // stub by hand and `environment: 'node'` means nothing supplies them — see
  // `vitest.config.js` note 1). `__dirname` is deliberately NOT a global here: it does
  // not exist in an ES module, and `test/helpers/paths.js` is what replaced it, so a
  // stray `__dirname` must be a `no-undef` error rather than a silent `undefined`.
  {
    files: ['test/**/*.js'],
    ignores: ['test/e2e/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...NODE_GLOBALS, ...BROWSER_GLOBALS, __dirname: 'off', __filename: 'off' },
    },
    rules: BASE_RULES,
  },

  // ── 4. Config files at the repo root ──────────────────────────────────────
  {
    files: ['*.config.js', '*.config.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: NODE_GLOBALS },
    rules: BASE_RULES,
  },
];
