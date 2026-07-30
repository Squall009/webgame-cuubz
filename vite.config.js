/**
 * Cuubz — Vite configuration (PR 7)
 *
 * PR 7 is the skeleton only: the tooling arrives, `js/` is not touched, and the
 * site `npm run dev` serves is byte-for-byte the classic-script site that has
 * always been served. PR 9 is what converts `js/` to `src/` ES modules.
 *
 * THREE THINGS HERE ARE LOAD-BEARING. Read refactor.md §1.3, §1.4 and §1.8 before
 * changing any of them.
 *
 * 1. `publicDir: false`. `textures/` is 118 MB across 3,370 files and is already
 *    in git at the repo root (refactor.md §1.8). Vite's default `publicDir`
 *    behaviour is to COPY the public directory into `dist/` on every build, so
 *    pointing it at `textures/` would duplicate 118 MB per build, and copying the
 *    tree into a `public/` directory would duplicate it in the repo as well. With
 *    `publicDir: false` the dev server still serves `textures/` — it is inside the
 *    project root, and `js/renderer/textureAtlas.js` fetches it with relative
 *    paths. PR 9 owns making those paths survive a base-URL change; PR 10 owns how
 *    textures reach the deploy host.
 *
 * 2. `build.rollupOptions.input` is index.html, and index.html still loads 65
 *    classic `<script src>` tags. Vite does NOT bundle a non-module script tag —
 *    it emits the file and rewrites the URL. That is exactly what PR 7 wants,
 *    because those 65 files share ONE global scope (refactor.md §2): bundling them
 *    into ES modules early would silently change name resolution and break the
 *    "identical game" claim this phase rests on. `scripts/check-globals.js` parses
 *    that same tag list and must keep working.
 *
 * 3. `target: 'es2020'`. `js/three.min.js` is r134 and the renderer's hand-written
 *    shaders depend on r134 defaults (refactor.md §1.2). Nothing here transpiles
 *    or upgrades it; the pin is PR 8's job and `npm run test:e2e` asserts
 *    `THREE.REVISION === 134`.
 *
 * WHAT `npm run build` PRODUCES TODAY IS NOT DEPLOYABLE, AND THAT IS EXPECTED.
 * `sync.sh` excludes `dist/` (refactor.md §1.4, DEPLOY.md §4.3), so from this PR
 * until PR 10 a deploy must ship the source tree, exactly as it does today. Do not
 * point the deploy at `dist/` before PR 10.
 */
import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  // See note 1. Do not set this to 'textures'.
  publicDir: false,
  build: {
    outDir: 'dist',
    target: 'es2020',
    // The classic-script site is not minifiable as a unit — see note 2 — and a
    // readable dist is worth more than a small one while dist/ is not deployed.
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
