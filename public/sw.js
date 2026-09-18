const CACHE = 'flow-next-shell-live-v4';

const OFFLINE = '/offline.html';

const STATIC = [
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/flow-wordmark.png',
  '/assets/flow-intelligence.png',
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

  // Leave Next.js bundles, API requests, and server-component data
  // to the browser and Next.js. Do not serve cached copies.
  if (
    req.headers.get('RSC') === '1' ||
    u.searchParams.has('_rsc') ||
    u.pathname.startsWith('/api/') ||
    u.pathname.startsWith('/_next/')
  ) {
    return;
  }

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

self.addEventListener('push', event => {
  let p = {
    title: 'F.L.O.W. observation update',
    body: 'Open the map to check the latest sensor observations.'
  };
  try {
    Object.assign(p, event.data?.json() || {});
  }
  catch { }

  const url = new URL('/', self.location.origin);
  if (typeof p.node_id === 'string' && /^[A-Z0-9-]{3,40}$/.test(p.node_id))
    url.hash = 'node=' + encodeURIComponent(p.node_id);

  const time = p.recorded_at ? Date.parse(p.recorded_at) : Date.now();
  event.waitUntil(
    self.registration.showNotification(String(p.title).slice(0, 120), {
      body: String(p.body).slice(0, 300),
      icon: '/assets/icon-192.png',
      badge: '/assets/icon-192.png',
      tag: p.node_id ? 'flow-' + p.node_id : 'flow-update',
      renotify: true,
      data: { url: url.href },
      timestamp: Number.isFinite(time) ? time : Date.now()
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  let target;
  try {
    target = new URL(event.notification.data?.url || '/', self.location.origin);
  }
  catch {
    target = new URL('/', self.location.origin);
  }

  if (target.origin !== self.location.origin)
    target = new URL('/', self.location.origin);

  event.waitUntil(
    self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    })
      .then(
        async (windows) => {
          const client = windows.find(w => new URL(w.url).origin === target.origin);
          if (client) {
            await client.navigate(target.href);
            return client.focus();
          }

          return self.clients.openWindow(target.href);
        }
      )
  );
});
