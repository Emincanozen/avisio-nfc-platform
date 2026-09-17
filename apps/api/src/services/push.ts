/**
 * Push web (norme Web Push, protocole VAPID).
 *
 * Choix : une PWA installable plutôt qu'une application native. Le gérant
 * ajoute le tableau de bord à son écran d'accueil et reçoit les alertes comme
 * n'importe quelle notification. Pas de store, pas de cycle de publication,
 * et le même code sur Android comme sur iOS (16.4+).
 *
 * Sans clés VAPID, les envois sont journalisés : la chaîne reste vérifiable en
 * local. Générer un jeu de clés : `npx web-push generate-vapid-keys`.
 */

import webpush from 'web-push';
import { env } from '../env.js';
import type { Repository } from '../repository/index.js';

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

export interface PushSender {
  readonly enabled: boolean;
  readonly publicKey: string;
  sendToManager(managerId: string, payload: PushPayload): Promise<number>;
  /** Vide la file des push différés par les heures calmes. */
  flushQueued(now?: string): Promise<number>;
}

export function createPushSender(
  repo: Repository,
  logger: { info: (msg: string) => void; warn: (msg: string) => void },
): PushSender {
  const enabled = Boolean(env.vapid.publicKey && env.vapid.privateKey);

  if (enabled) {
    webpush.setVapidDetails(
      `mailto:${env.mailFrom}`,
      env.vapid.publicKey,
      env.vapid.privateKey,
    );
  } else {
    logger.info('Clés VAPID absentes : les notifications push sont journalisées.');
  }

  async function sendToManager(managerId: string, payload: PushPayload): Promise<number> {
    const subscriptions = await repo.push.listByManager(managerId);
    if (subscriptions.length === 0) return 0;

    if (!enabled) {
      logger.info(
        `[push simulé] ${subscriptions.length} appareil(s) — ${payload.title} : ${payload.body}`,
      );
      return subscriptions.length;
    }

    let delivered = 0;
    for (const subscription of subscriptions) {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          JSON.stringify(payload),
          { TTL: 3600 },
        );
        delivered += 1;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        // 404 / 410 : l'abonnement est mort côté navigateur (application
        // désinstallée, permission retirée). On le retire plutôt que de
        // réessayer indéfiniment.
        if (status === 404 || status === 410) {
          await repo.push.unsubscribe(subscription.endpoint);
          logger.info('Abonnement push expiré, retiré.');
        } else {
          logger.warn(`Envoi push en échec (${status ?? 'inconnu'}).`);
        }
      }
    }
    return delivered;
  }

  return {
    enabled,
    publicKey: env.vapid.publicKey,
    sendToManager,

    async flushQueued(now = new Date().toISOString()) {
      const queued = await repo.push.listQueued(now);
      let sent = 0;
      for (const item of queued) {
        const payload: PushPayload = {
          title: item.title,
          body: item.body,
          ...(item.url ? { url: item.url } : {}),
        };
        await sendToManager(item.managerId, payload);
        await repo.push.markSent(item.id, now);
        sent += 1;
      }
      if (sent > 0) logger.info(`${sent} push différé(s) envoyé(s).`);
      return sent;
    },
  };
}
