/* FLOW service worker: public app shell only. Never cache telemetry/API data. */
const CACHE = 'flow-next-shell-live-v6';

const OFFLINE = '/offline.html';

const STATIC = [
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/flow-wordmark.png',
  OFFLINE
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(
        keys => Promise.all(
          keys.filter(
            k => (k.startsWith('flow-next-shell-') || k.startsWith('flow-shell-')) && k !== CACHE
          )
            .map(k => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request, u = new URL(req.url);
  if (req.method !== 'GET' || u.origin !== self.location.origin)
    return;

  // Never cache App Router RSC payloads, API responses, auth or live sensor data.
  if (req.headers.get('RSC') === '1' || u.searchParams.has('_rsc')
    || u.pathname.startsWith('/api/')
    || u.pathname.startsWith('/_next/'))
    return;

  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE)));
    return;
  }

  if (u.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req)
        .then(
          hit => hit
            || fetch(req)
              .then(
                r => {
                  if (r.ok) {
                    const copy = r.clone();
                    caches.open(CACHE).then(c => c.put(req, copy));
                  }

                  return r;
                }
              )
        )
    );
  }
});

