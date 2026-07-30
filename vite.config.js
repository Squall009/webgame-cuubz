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
 * 4. `minify: false`, still, and deliberately. PR 9 is the PR whose entire claim is
 *    "identical game", and an unminified bundle keeps a stack trace legible while that
 *    claim is being checked. Output is 1.7 MB raw / 353 kB gzipped and the deploy target
 *    is a LAN box, so the cost is small. **PR 10 owns the call** — it is the PR that
 *    starts shipping `dist/` — and whichever way it goes, both e2e hosts now run against
 *    the real artifact, so the decision is verifiable rather than assumed.
 *
 * `dist/` IS THE APPLICATION FROM THIS PR ONWARD, AND `sync.sh` STILL EXCLUDES IT.
 * That is D-4, and it is why PR 10 must land with PR 9. Until it does, do not run
 * `./sync.sh` — DEPLOY.md §4.3.
 */
import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  // See note 1. Do not set this to 'textures'.
  publicDir: false,
  build: {
    outDir: 'dist',
    target: 'es2020',
    // See note 4. PR 10 owns whether this stays false once dist/ is what ships.
    minify: false,
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
