/**
 * Local static file + API reverse-proxy server for the desktop app's window.
 *
 * The real product is the Vite/TanStack Start frontend (built into
 * `<repo>/dist/*.html` + `dist/assets/`) talking to the Node backend
 * (`dist/interface/main.js web <port>`) over `/api/*`. In dev, Vite's own
 * proxy bridges the two (see vite.config.ts); a production static build has
 * no such bridge -- DESKTOP_LAUNCHER_IMPLEMENTATION.md flags this as a real,
 * disclosed gap ("not yet solved here"). This module is that missing
 * hosting-layer proxy, scoped to the desktop app.
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/**
 * Resolve a request pathname to a real file under `distDir`, trying the
 * TanStack Start prerender's per-route `index.html` files. Never resolves
 * outside `distDir` -- `path.join` + the `startsWith` guard below block
 * `..`-style traversal in a maliciously crafted `req.url`.
 */
function resolveStaticFile(distDir, pathname) {
  const decoded = decodeURIComponent(pathname);
  const candidates = decoded.endsWith('/')
    ? [path.join(distDir, decoded, 'index.html')]
    : [path.join(distDir, decoded), path.join(distDir, decoded, 'index.html')];

  for (const candidate of candidates) {
    const resolved = path.normalize(candidate);
    if (!resolved.startsWith(path.normalize(distDir))) continue;
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved;
  }
  return null;
}

/**
 * Start the combined static+proxy server.
 * @returns {Promise<http.Server>}
 */
function startAppServer({ distDir, backendPort, port }) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://internal');

      if (url.pathname.startsWith('/api/')) {
        const proxyReq = http.request(
          {
            host: '127.0.0.1',
            port: backendPort,
            path: req.url,
            method: req.method,
            headers: req.headers,
          },
          (proxyRes) => {
            res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
            proxyRes.pipe(res);
          }
        );
        proxyReq.on('error', () => {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Backend unreachable' }));
        });
        req.pipe(proxyReq);
        return;
      }

      // The build fully prerenders every route (vite.config.ts: `crawlLinks:
      // true`), so every real page already has its own on-disk index.html --
      // an unconditional index.html fallback here would silently mask a
      // genuinely missing/mistyped asset behind a 200, instead of the 404
      // that should surface a broken build or a bad link.
      const file = resolveStaticFile(distDir, url.pathname);
      if (!file) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }
      const ext = path.extname(file);
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });

    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

module.exports = { startAppServer, resolveStaticFile };
