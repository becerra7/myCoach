// Service worker: la app abre sin red con la última versión descargada.
// La página va "red primero" (siempre la más nueva si hay conexión); /api nunca se cachea.
const CACHE = 'mycoach-v2';
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(['/', '/icon.svg', '/icon-192.png', '/manifest.webmanifest']))); });
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return r; }).catch(() => caches.match(e.request).then(r => r || caches.match('/'))));
});

// Avisos: el push llega sin contenido; el aviso se lee del servidor con el id de esta suscripción
// (un hash de su endpoint, el mismo que calcula el conector). Al tocarlo, abre la pantalla del aviso.
async function idSuscripcion(endpoint) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint)));
  return [...h.slice(0, 16)].map(b => b.toString(16).padStart(2, '0')).join('');
}
self.addEventListener('push', e => e.waitUntil((async () => {
  let a = null;
  try { const sub = await self.registration.pushManager.getSubscription(); if (sub) { const r = await fetch(`/avisos/${await idSuscripcion(sub.endpoint)}`, { cache: 'no-store' }); if (r.ok) a = await r.json(); } } catch (err) { }
  // Si no se pudo leer, se avisa igual (los navegadores exigen enseñar algo en cada push).
  a = a || { titulo: 'myCoach', texto: 'Tienes un aviso nuevo.', url: '/' };
  await self.registration.showNotification(a.titulo, { body: a.texto, icon: '/icon-192.png', badge: '/icon-192.png', tag: a.tipo || 'mycoach', data: { url: a.url || '/' }, lang: 'es' });
})()));
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', location.origin).href;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    const w = ws.find(c => new URL(c.url).origin === location.origin);
    return w ? w.navigate(url).then(c => (c || w).focus()) : clients.openWindow(url);
  }));
});
