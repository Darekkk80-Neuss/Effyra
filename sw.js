/* Effyra – Service Worker
   Empfängt Web-Push-Benachrichtigungen (Medikamenten-Erinnerungen) auch bei
   geschlossener App und zeigt sie an. Wird von index.html registriert.
   Der eigentliche Versand läuft serverseitig (Supabase Edge Function
   `send-med-reminders` + VAPID) – siehe BACKEND.md, Phase 3. */

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (e) { data = { title: 'Effyra', body: event.data ? event.data.text() : '' }; }
  const title = data.title || '💊 Effyra Erinnerung';
  const options = {
    body: data.body || '',
    icon: 'icon.svg',
    badge: 'icon.svg',
    tag: data.tag || 'effyra-med',
    renotify: true,
    data: { url: data.url || './' },
    requireInteraction: !!data.requireInteraction,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) { try { await c.navigate(url); } catch (e) {} return c.focus(); }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
