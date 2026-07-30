/**
 * Cuubz — ESLint flat config (PR 11)
 *
 * **Flat config, not `.eslintrc.cjs`.** ESLint 9+ ignores the old file entirely;
 * `refactor.md` §14 names that as an anti-pattern because v1 of the plan got it wrong.
 *
 * **`.mjs`, not `.js`.** §4.1 names this file `eslint.config.js`; the extension is the one
 * deviation and it is not a design change. This file is an ES module and package.json has
 * no `"type": "module"` — adding one would reclassify every `.js` in `server/`, `test/`
 * and `scripts/`, which are CommonJS. Without it Node prints a MODULE_TYPELESS_PACKAGE_JSON
 * warning on every single lint run. `.mjs` is ESLint's documented answer and costs nothing.
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
 *   2. `server/**`, `scripts/**`, `test/**` — Node CommonJS. `require`, `module`,
 *      `__dirname`, `process`.
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

  // ── 3. Node CommonJS: the relay, the tests, the scripts ───────────────────
  {
    files: ['server/**/*.js', 'test/**/*.js', 'scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: { ...NODE_GLOBALS, ...BROWSER_GLOBALS },
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
