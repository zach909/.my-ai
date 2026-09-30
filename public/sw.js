// NeuroClaw service worker: lets the installed app open without a connection.
// Pages are network-first (fall back to the last copy), static assets are
// cache-first. /api/* is never cached: the agent's answers must be live.
const CACHE = 'neuroclaw-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/app', '/manifest.webmanifest', '/icon.png'])).catch(() => {}))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return

  const store = (res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)) }
    return res
  }

  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).then(store).catch(() => caches.match(req).then((r) => r || caches.match('/app'))))
    return
  }
  event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then(store)))
})
