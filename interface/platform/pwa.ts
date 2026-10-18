/**
 * The installable web app: manifest, offline shell, and icons.
 *
 * Before this the repo shipped public/manifest.webmanifest and public/sw.js,
 * but the backend only serves dist/ and those files were never copied there,
 * so /manifest.webmanifest and /sw.js answered 404 and no browser could install
 * the app. The backend now generates both itself, in the app's own colours.
 * They are served without a login (see isPwaRoute) because a browser fetches
 * them without credentials and an install prompt cannot work behind one.
 */
import { appVersion } from './version.js';

export function webManifest(version = appVersion()): string {
  return JSON.stringify({
    id: '/',
    name: 'NeuroClaw',
    short_name: 'NeuroClaw',
    description: 'A local-first AI agent.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#110c0e',
    theme_color: '#110c0e',
    categories: ['productivity', 'utilities'],
    icons: [
      { src: '/app-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/app-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/app-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Settings', url: '/settings' },
    ],
    version,
  });
}

/**
 * The service worker. Pages: network first, last good copy when offline, and a
 * plain "server not reachable" page when there is neither. Look files: cache
 * first. /api/* is never cached or answered from cache: an answer from the
 * agent must be live, and a stale settings read would be a lie.
 */
export function serviceWorkerSource(version = appVersion()): string {
  return `// NeuroClaw offline shell (app version ${version}).
const CACHE = 'neuroclaw-shell-${version}';
const SHELL = ['/', '/settings', '/ambient.css', '/ambient.js', '/manifest.webmanifest'];
const OFFLINE = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Server not reachable</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#110c0e;color:#f8ede9;font-family:ui-rounded,system-ui,sans-serif"><main style="max-width:26rem;padding:24px;text-align:center"><h1 style="font-size:1.2rem">The NeuroClaw server is not reachable</h1><p style="color:rgba(248,237,233,.62)">Start it on its computer, or check this device is on the same network, then try again.</p><button onclick="location.reload()" style="font:inherit;padding:10px 20px;border-radius:999px;border:1px solid rgba(255,154,132,.5);background:rgba(255,154,132,.16);color:#ffc4b4">Try again</button></main>';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  const keep = (res) => {
    // Only a good answer, only for the shell, and never a response that asked not to be stored.
    if (res.ok && SHELL.includes(url.pathname) && !/no-store/.test(res.headers.get('cache-control') || '')) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  };
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).then(keep).catch(() => caches.match(req).then((hit) => hit || new Response(OFFLINE, { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } }))));
    return;
  }
  if (SHELL.includes(url.pathname)) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then(keep)));
  }
});
`;
}
