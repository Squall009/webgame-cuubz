'use strict';
/**
 * Minimal static file server for the e2e harness.
 *
 * Why this exists rather than reusing a dev server: the e2e harness must be able
 * to serve the CURRENT working tree with no build step and no extra dependency,
 * so it works identically before and after the Vite switch in PR 7. Once PR 7
 * lands, `npm run dev` is an alternative host, but this keeps the harness
 * independent of it — a harness that depends on the thing it is validating is
 * not a gate.
 *
 * The game must be served over http://. file:// breaks two things:
 *   - js/renderer/textureAtlas.js fetches textures with relative paths.
 *   - js/chunkmanager.js builds both worker pools by fetch()ing source text and
 *     wrapping it in a Blob (refactor.md §1.3). fetch() of a file:// URL fails.
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
 * Serve `root` on `port`. Resolves to { server, port, url, missing }.
 *
 * `missing` accumulates every path that 404'd. The harness asserts on it, so a
 * genuinely missing asset fails the run instead of scrolling past in a log.
 * /favicon.ico is excluded — Chromium requests it unprompted and the repo has
 * none, so counting it would make every run dirty.
 */
function start(root, port = 0) {
  const missing = [];

  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
    const filePath = path.join(root, rel);

    // Refuse to serve outside root — path traversal guard.
    if (!filePath.startsWith(root)) {
      res.writeHead(403);
      return res.end('403');
    }

    fs.readFile(filePath, (err, data) => {
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
