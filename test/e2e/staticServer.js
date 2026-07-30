'use strict';
/**
 * Minimal static file server for the e2e harness.
 *
 * Why this exists rather than reusing a dev server: a harness that only runs against
 * the thing it is validating is not a gate. `npm run dev` is the second host
 * (`--server=vite`, added by PR 7); this one is the baseline, and the two must produce
 * the same numbers.
 *
 * ─── PR 9 CHANGED WHAT "THE BASELINE" IS ────────────────────────────────────
 *
 * Until PR 9 this served the **working tree**: index.html plus 65 classic `<script
 * src>` tags read straight off disk, no build step. That is no longer servable by any
 * static server. `index.html` now loads one ES module and the module graph contains
 * bare specifiers (`import * as THREE from 'three'`), which only a bundler or an import
 * map can resolve. A raw file server would hand the browser an unresolvable import and
 * a blank page.
 *
 * So the baseline is now `dist/` — the **built** output, which is exactly what PR 10
 * uploads to the deploy host. That is a strictly better baseline than the one it
 * replaces: `npm run test:e2e` now proves the artifact that ships actually runs, which
 * is the claim `npm run build` alone never made (**D-24**).
 *
 * ─── TEXTURES ARE SERVED FROM THE REPO ROOT, DELIBERATELY ───────────────────
 *
 * `vite.config.js` sets `publicDir: false` because `textures/` is 118 MB across 3,370
 * files and Vite copies the public directory into `dist/` on *every* build
 * (`refactor.md` §1.8). So `dist/` has no textures, and this server falls back to the
 * repo root for them. That mirrors the deploy topology PR 10 is going to create —
 * bundle deployed per release, textures uploaded once — rather than working around it.
 *
 * The game must be served over http://. file:// breaks two things:
 *   - src/engine/renderer/TextureAtlas.js fetches textures over HTTP.
 *   - src/engine/world/ChunkManager.js builds both worker pools by fetch()ing source
 *     text and wrapping it in a Blob (refactor.md §1.3). fetch() of file:// fails.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
};

/**
 * Serve the built site on `port`. Resolves to { server, port, url, missing }.
 *
 * `root` is the repo root. Application files come from `<root>/dist`; anything not
 * there is looked up under `<root>` so `textures/` resolves (see the header).
 *
 * `missing` accumulates every path that 404'd in BOTH locations. The harness asserts on
 * it, so a genuinely missing asset fails the run instead of scrolling past in a log.
 * /favicon.ico is excluded — Chromium requests it unprompted and the repo has none, so
 * counting it would make every run dirty.
 */
function start(root, port = 0) {
  const missing = [];
  const dist = path.join(root, 'dist');

  if (!fs.existsSync(path.join(dist, 'index.html'))) {
    return Promise.reject(
      new Error(
        `No dist/index.html under ${root}.\n` +
          '  Since PR 9 the static host serves the BUILT site, not the working tree —\n' +
          '  index.html loads one ES module whose graph contains bare specifiers, which\n' +
          '  no raw file server can resolve. Run `npm run build` first (`npm run test:e2e`\n' +
          '  does it for you).'
      )
    );
  }

  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');

    // Refuse to serve outside either root — path traversal guard.
    const candidates = [path.join(dist, rel), path.join(root, rel)]
      .filter((p, i) => p.startsWith(i === 0 ? dist : root));
    if (candidates.length === 0) {
      res.writeHead(403);
      return res.end('403');
    }

    const readFirst = (list, cb) => {
      const [head, ...tail] = list;
      fs.readFile(head, (err, data) => {
        if (err && tail.length) return readFirst(tail, cb);
        cb(err, data, head);
      });
    };

    readFirst(candidates, (err, data, filePath) => {
      if (err) {
        if (urlPath !== '/favicon.ico') missing.push(urlPath);
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('404');
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        // No caching: the harness reloads the same URLs repeatedly and must always
        // see the current tree.
        'Cache-Control': 'no-store',
      });
      res.end(data);
    });
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const actualPort = server.address().port;
      resolve({
        server,
        port: actualPort,
        url: `http://127.0.0.1:${actualPort}`,
        missing,
        close: () => new Promise(r => server.close(r)),
      });
    });
  });
}

module.exports = { start };
