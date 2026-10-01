
const CACHE = 'flow-next-shell-live-v7';

const OFFLINE = '/offline.html';

const STATIC = [
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

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin);
  if (target.origin !== self.location.origin) return;
  event.waitUntil((async () => {
    const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const page = pages.find(client => new URL(client.url).origin === target.origin);
    if (page) {
      await page.focus();
      await page.navigate(target.href);
    } else {
      await self.clients.openWindow(target.href);
    }
  })());
});

self.addEventListener('push', event => {
  let alert;
  try { alert = event.data?.json(); } catch { alert = null; }
  const level = Number(alert?.level);
  const nodeId = typeof alert?.nodeId === 'string' && /^[A-Z0-9-]{3,40}$/.test(alert.nodeId)
    ? alert.nodeId : '';
  const title = typeof alert?.title === 'string' ? alert.title : 'FLOW nearby alert';
  const body = typeof alert?.body === 'string'
    ? alert.body : 'A monitored water level changed near your saved area.';
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: '/assets/flow-icon.png',
    tag: nodeId ? 'flow-nearby-' + nodeId : 'flow-nearby',
    renotify: true,
    data: { url: nodeId ? '/#node=' + encodeURIComponent(nodeId) : '/' },
    ...(level === 3 ? { vibrate: [150, 100, 150] } : {})
  }));
});
