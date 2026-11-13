/* Telos service worker: lets the app open offline, and shows notifications.
   Strategy: network first (so updates arrive right away), falling back to what was last cached. */
const VERSION = '20261113145623';
const CACHE = `lifeos-shell-${VERSION}`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('lifeos-shell-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.type === 'cache' && Array.isArray(d.urls)) {
    e.waitUntil(caches.open(CACHE).then((c) => Promise.all(d.urls.map((u) => c.add(u).catch(() => {})))));
  }
});

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/')) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: false }) || await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') { const shell = await cache.match(self.registration.scope) || await cache.match(self.registration.scope + 'index.html'); if (shell) return shell; }
      throw err;
    }
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const hash = (e.notification.data && e.notification.data.url) || '#/today';
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if (c.url.startsWith(self.registration.scope)) { await c.focus(); c.postMessage({ type: 'goto', url: hash }); return; } }
    await self.clients.openWindow(self.registration.scope + hash);
  })());
});

/* Real push: the server (web-push) sends { title, body, url, tag } and this shows it even when the app is closed. */
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Telos', {
    body: d.body || '', tag: d.tag || 'telos', icon: 'icons/icon-192.png', badge: 'icons/favicon-32.png', data: { url: d.url || '#/today' },
  }));
});

/* Best effort for browsers that support periodic background sync: fire reminders that are due. */
self.addEventListener('periodicsync', (e) => {
  if (e.tag !== 'lifeos-reminders') return;
  e.waitUntil((async () => {
    const ca = await caches.open('lifeos-reminders'), res = await ca.match('reminders.json'), fired = await ca.match('fired.json');
    if (!res) return;
    const data = await res.json(), done = fired ? await fired.json() : {};
    if (!data.enabled) return;
    const now = Date.now();
    for (const r of data.list || []) {
      if (r.at <= now && now - r.at < 6 * 3600 * 1000 && !done[r.key]) {
        done[r.key] = now;
        await self.registration.showNotification(r.title, { body: r.body, tag: r.key, icon: 'icons/icon-192.png', data: { url: r.url } });
      }
    }
    await ca.put('fired.json', new Response(JSON.stringify(done)));
  })());
});
