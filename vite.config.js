/**
 * Cuubz — Vite configuration (PR 7, rewritten in PR 9)
 *
 * PR 7 added the tooling without touching a line of `js/`. **PR 9 converted the tree**:
 * `index.html` loads one `<script type="module" src="/src/index.js">`, the 65 classic
 * script tags are gone, and `npm run build` now produces a `dist/` that actually runs.
 *
 * FOUR THINGS HERE ARE LOAD-BEARING. Read refactor.md §1.2, §1.3, §1.4 and §1.8 before
 * changing any of them.
 *
 * 1. `publicDir: false`. `textures/` is 118 MB across 3,370 files and is already in git
 *    at the repo root (refactor.md §1.8). Vite's default is to COPY the public directory
 *    into `dist/` on every build, so pointing it at `textures/` would duplicate 118 MB
 *    per build, and moving the tree into `public/` would duplicate it in the repo too.
 *    The dev server still serves it — it is inside the project root — and PR 9 made
 *    `src/engine/renderer/TextureAtlas.js` fetch it from an absolute `/textures/…` path
 *    so the base URL cannot shift under it. **`dist/` therefore has no textures**, which
 *    is why `test/e2e/staticServer.js` falls back to the repo root for them and why
 *    **PR 10 owns getting textures onto the deploy host.**
 *
 * 2. The two Web Workers are NOT in the module graph and must not be.
 *    `src/engine/world/workerGeneration.js` and `src/engine/renderer/meshWorker.js` are
 *    classic scripts fetched as text and wrapped in a Blob (refactor.md §1.3). They reach
 *    the build through `?url` imports in `ChunkManager.js`, which makes Vite emit each one
 *    as a standalone hashed asset instead of folding it into the bundle. Nothing here has
 *    to configure that, but a `rollupOptions` change could break it *silently*: both pools
 *    fall back to main-thread generation and only `console.warn`, so the game still works
 *    and is quietly single-threaded. `npm run test:e2e` asserts that warning never fires.
 *
 * 3. `target: 'es2020'` and the `three` pin. The renderer is 843 hand-written shader lines
 *    that depend on r134 defaults (refactor.md §1.2). PR 9 deleted the vendored
 *    `js/three.min.js` and switched every file to `import * as THREE from 'three'`, so
 *    Vite now resolves the pinned package's `build/three.module.js`.
 *    `test/test_threePin.js` asserts the manifest and that bundle agree, and
 *    `npm run test:e2e` asserts `THREE.REVISION === 134` from the running browser.
 *
 * 4. `minify: 'esbuild'` and `sourcemap: true` — **PR 33 / D-30 flipped both, together.**
 *
 *    PR 9 set `minify: false` because its entire claim was "identical game" and an
 *    unminified bundle keeps a stack trace legible while that claim is checked. That
 *    reason expired: `dist/` has been the shipped artifact since PR 10, and the bundle
 *    had grown to 1.90 MB raw / 418 kB gzipped.
 *
 *    Minification is safe here because nothing in the tree reads a function or class
 *    IDENTITY. Re-verified over the whole of `src/`, `server/`, `shared/` and
 *    `scripts/` at PR 33: **0** `constructor.name`, **0** `extends Error`, **0**
 *    `Function.prototype.toString`. All 124 `.name` reads are data properties on plain
 *    objects (mob definitions, item definitions, player records, DOM nodes, `File`),
 *    none of them reflective. `worldPersistence.test.js:393` reads `x.constructor` to
 *    reach a static method — that is the constructor OBJECT, which minification
 *    preserves, not its `.name`.
 *
 *    `sourcemap` is flipped in the SAME edit and that pairing is the point. It was
 *    previously unset (Vite default `false`), so flipping `minify` on its own would
 *    have made the first real production incident get debugged from a minified bundle
 *    with no map — trading the exact legibility PR 9 was protecting for nothing. The
 *    `.map` is a separate file the browser fetches only when devtools are open.
 *
 *    **The gate for this is ONE e2e host, not two.** `npm run test:e2e:vite` runs
 *    `npm run dev` and never calls `vite build`, so it cannot observe this setting at
 *    all — the dev server serves unbundled ES modules. Only `npm run test:e2e` (which
 *    is literally `npm run build && node test/e2e/saveLoad.js`) exercises the minified
 *    artifact. A minification regression is therefore invisible to the `:vite` run;
 *    do not read a green `:vite` as coverage for a change to this block.
 *
 *    The two Web Workers are `?url` ASSETS, not chunks (see note 2), so they are copied
 *    byte-for-byte and are unaffected by `minify` either way.
 *
 * `dist/` IS THE APPLICATION, AND `sync.sh` SHIPS IT.
 *
 * **D-82:** this paragraph read "`sync.sh` STILL EXCLUDES `dist/` … that is D-4, and it
 * is why PR 10 must land with PR 9. Until it does, do not run `./sync.sh`." PR 10 landed
 * and closed D-4: `sync.sh` packs `-C dist .` as the FIRST member of its archive, refuses
 * to deploy at all if `npm run build` produced no `dist/index.html`, and verifies on the
 * host that `index.html` points at a JS file that is actually on disk. The standing
 * instruction not to run `./sync.sh` from this workstation still holds — but it is the
 * owner's deployment ruling, not this defect, and the two are not the same thing. Leaving
 * a closed blocker in the file made every reader re-derive that.
 */
import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  // See note 1. Do not set this to 'textures'.
  publicDir: false,
  build: {
    outDir: 'dist',
    target: 'es2020',
    // See note 4. PR 33 / D-30. These two are a pair — do not flip one without the
    // other, and remember only `npm run test:e2e` can see either of them.
    // `true`, NOT `'esbuild'`. Vite 8 here is the rolldown build and its bundled
    // minifier is oxc; `esbuild` is not an installed package, and naming it makes
    // `vite build` die with ERR_MODULE_NOT_FOUND *after* `emptyOutDir` has already
    // wiped `dist/`. `true` selects whichever minifier the installed Vite ships.
    minify: true,
    // `'hidden'`, NOT `true` — decision 67. `true` appends a `//# sourceMappingURL`
    // comment to the bundle, and `sync.sh` ships `dist/*`, so every browser that opens
    // devtools on 10.0.30.160 would fetch a 3.7 MB map carrying `sourcesContent` for
    // **148 files / 2,526,003 bytes** — the whole of `src/` plus `node_modules/three`,
    // served chmod 644 at a guessable URL. That is D-13's complaint (the repo reaching a
    // web root) coming back in through the change that was supposed to make the first
    // deploy debuggable. `'hidden'` emits the map and omits the comment: the operator
    // attaches it by hand in devtools when they need it, which is the case the flip
    // exists for, and nothing fetches it on its own. Found by PR 33's third slice.
    sourcemap: 'hidden',
    emptyOutDir: true,
  },
  server: {
    port: 3000,
    strictPort: true,
  },
  preview: {
    port: 3001,
    strictPort: true,
  },
});
