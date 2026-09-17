/**
 * Abonnement aux notifications push depuis le navigateur.
 *
 * Le parcours complet : enregistrer le service worker, demander la permission,
 * s'abonner auprès du service de push du navigateur, puis transmettre
 * l'abonnement à l'API qui s'en servira pour pousser les alertes.
 */

import { api } from './api';

export type PushState =
  | 'unsupported'
  | 'server-disabled'
  | 'denied'
  | 'subscribed'
  | 'available';

/**
 * La clé VAPID transite en base64url ; l'API navigateur attend des octets.
 * Le tampon est alloué explicitement pour que le type soit bien
 * `Uint8Array<ArrayBuffer>` — `applicationServerKey` refuse une vue sur un
 * `SharedArrayBuffer`.
 */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(normalized);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

export function isSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export async function currentState(): Promise<PushState> {
  if (!isSupported()) return 'unsupported';

  const { enabled } = await api<{ publicKey: string; enabled: boolean }>('/push/public-key', {
    auth: false,
  });
  if (!enabled) return 'server-disabled';
  if (Notification.permission === 'denied') return 'denied';

  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  return subscription ? 'subscribed' : 'available';
}

export async function subscribe(): Promise<PushState> {
  if (!isSupported()) return 'unsupported';

  const { publicKey, enabled } = await api<{ publicKey: string; enabled: boolean }>(
    '/push/public-key',
    { auth: false },
  );
  if (!enabled || !publicKey) return 'server-disabled';

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';

  const registration = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;

  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      // Obligatoire sur Chrome : toute notification poussée doit être visible.
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));

  const raw = subscription.toJSON() as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  if (!raw.endpoint || !raw.keys?.p256dh || !raw.keys.auth) return 'available';

  await api('/push/subscribe', {
    method: 'POST',
    body: JSON.stringify({
      endpoint: raw.endpoint,
      keys: { p256dh: raw.keys.p256dh, auth: raw.keys.auth },
    }),
  });

  return 'subscribed';
}

export async function unsubscribe(): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;

  await api('/push/unsubscribe', {
    method: 'POST',
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  await subscription.unsubscribe();
}

export async function sendTest(): Promise<number> {
  const result = await api<{ delivered: number }>('/push/test', { method: 'POST' });
  return result.delivered;
}
