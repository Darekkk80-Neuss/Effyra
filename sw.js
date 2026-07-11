/* Effyra – Service Worker (PWA: installierbar + offline).
   Strategie: Netzwerk-zuerst mit Cache-Fallback. So kommen Updates sofort an
   (kein „hängengebliebenes" altes HTML), offline greift der Cache.
   Nur GET-Anfragen der eigenen Origin werden abgefangen – Supabase, OpenAI,
   Google Fonts usw. laufen immer direkt durch. */
const CACHE = 'effyra-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg', './bg.jpg'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // externe Hosts nicht anfassen
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
  );
});
