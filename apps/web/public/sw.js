/*
 * Service worker Avisio.
 *
 * Son seul rôle est la réception des notifications push : pas de mise en cache
 * hors ligne. Mettre en cache le tableau de bord donnerait au gérant des
 * chiffres périmés sans qu'il le sache — sur un outil de pilotage, une page
 * qui ne charge pas vaut mieux qu'une page qui ment.
 */

self.addEventListener('install', (event) => {
  // Le nouveau worker prend la main sans attendre la fermeture des onglets.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = { title: 'Avisio', body: 'Nouvelle activité sur votre établissement.' };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    // Charge utile illisible : on notifie quand même, sans détail.
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icon.svg',
      badge: '/icon-maskable.svg',
      // Regroupe les alertes d'un même établissement plutôt que d'empiler.
      tag: payload.tag || 'avisio-alert',
      renotify: true,
      data: { url: payload.url || '/dashboard' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/dashboard';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Réutilise un onglet déjà ouvert plutôt que d'en empiler un par alerte.
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
