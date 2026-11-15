/**
 * Notifications gérant : e-mail transactionnel et push web.
 *
 * Le routage passe par les préférences de l'établissement (`@avisio/core`
 * `planDelivery`) : canaux choisis par le gérant, heures calmes qui diffèrent
 * le push sans retenir l'e-mail, et messages de facturation qui passent
 * toujours.
 *
 * Sans clé Resend, les e-mails sont journalisés en console avec leur contenu
 * intégral ; sans clés VAPID, le push est journalisé de la même façon. La
 * chaîne d'alerte reste démontrable de bout en bout en local.
 */

import {
  DEFAULT_PREFERENCES,
  PLATFORM_LABELS,
  generateId,
  planDelivery,
  type Alert,
  type Establishment,
  type NotificationEvent,
  type Review,
} from '@avisio/core';
import { capabilities, env } from '../env.js';
import type { Repository } from '../repository/index.js';
import type { PushSender } from './push.js';

export interface Notifier {
  /** Alerte produit : avis négatif, tendance. Soumise aux préférences. */
  alert(to: string, establishment: Establishment, alert: Alert, review?: Review): Promise<void>;
  /** Message contractuel : facture, relance. Jamais filtré. */
  billing(to: string, establishment: Establishment, subject: string, body: string): Promise<void>;
  monthlyReport(to: string, establishment: Establishment, html: string): Promise<void>;
}

interface Deps {
  repo?: Repository;
  push?: PushSender;
  logger: { info: (msg: string) => void; warn: (msg: string) => void };
}

export function createNotifier(deps: Deps): Notifier {
  const { repo, push, logger } = deps;

  const sendEmail = async (to: string, subject: string, html: string): Promise<void> => {
    if (!capabilities.email) {
      logger.info(`[e-mail simulé] à ${to} — ${subject}`);
      return;
    }
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.resendApiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ from: env.mailFrom, to, subject, html }),
      });
      if (!response.ok) {
        logger.warn(`Envoi e-mail refusé (${response.status}) pour ${to}`);
      }
    } catch (error) {
      logger.warn(`Envoi e-mail impossible : ${(error as Error).message}`);
    }
  };

  /**
   * Envoie un push aux appareils du gérant, ou le met en file s'il tombe dans
   * les heures calmes. Le différé est porté par la base, pas par un timer en
   * mémoire : un redémarrage ne doit pas perdre l'alerte.
   */
  const dispatchPush = async (
    to: string,
    title: string,
    body: string,
    url: string,
    deferUntil?: string,
  ): Promise<void> => {
    if (!repo) {
      logger.info(`[push simulé] à ${to} — ${title}`);
      return;
    }
    const manager = await repo.managers.findByEmail(to);
    if (!manager) return;

    if (deferUntil) {
      await repo.push.queue({
        id: generateId('push'),
        managerId: manager.id,
        title,
        body,
        url,
        sendAt: deferUntil,
        createdAt: new Date().toISOString(),
      });
      logger.info(`Push différé pour ${to} jusqu'à ${deferUntil} (heures calmes).`);
      return;
    }

    if (!push) {
      logger.info(`[push simulé] à ${to} — ${title}`);
      return;
    }
    await push.sendToManager(manager.id, { title, body, url });
  };

  const resolvePlan = async (
    establishment: Establishment,
    event: NotificationEvent,
    entitled: boolean,
  ) => {
    const stored = repo
      ? await repo.notificationPreferences.get(establishment.id)
      : null;
    const preferences = stored ?? DEFAULT_PREFERENCES(establishment.id);
    return planDelivery(preferences, event, new Date().toISOString(), entitled);
  };

  return {
    async alert(to, establishment, alert, review) {
      const event: NotificationEvent =
        alert.type === 'theme_trend' ? 'theme_trend' : 'negative_review';
      const plan = await resolvePlan(establishment, event, true);

      if (plan.channels.length === 0 && !plan.deferPushUntil) {
        logger.info(`Notification non envoyée à ${to} : ${plan.reason}`);
        return;
      }

      const subject =
        alert.type === 'negative_review'
          ? `${establishment.name} — avis ${review?.rating ?? ''}★ à traiter`
          : `${establishment.name} — ${alert.title}`;

      if (plan.channels.includes('email')) {
        await sendEmail(to, subject, alertHtml(establishment, alert, review));
      }
      if (plan.channels.includes('push') || plan.deferPushUntil) {
        await dispatchPush(
          to,
          subject,
          alert.body.slice(0, 160),
          `${env.webUrl}/dashboard/${establishment.id}/avis`,
          plan.deferPushUntil,
        );
      }
    },

    async billing(to, establishment, subject, body) {
      // Aucun filtrage : c'est un message contractuel.
      await sendEmail(to, subject, simpleHtml(establishment, subject, body));
    },

    async monthlyReport(to, establishment, html) {
      const plan = await resolvePlan(establishment, 'monthly_report', true);
      if (!plan.channels.includes('email')) {
        logger.info(`Rapport mensuel non envoyé à ${to} : ${plan.reason}`);
        return;
      }
      await sendEmail(to, `${establishment.name} — rapport mensuel de réputation`, html);
    },
  };
}

function alertHtml(establishment: Establishment, alert: Alert, review?: Review): string {
  const dashboardUrl = `${env.webUrl}/dashboard/${establishment.id}/avis`;
  const reviewBlock = review
    ? `
      <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f8f7f4;border-radius:10px">
        <tr><td style="padding:16px">
          <div style="font-size:13px;color:#6b6b6b">${escapeHtml(review.author)} · ${PLATFORM_LABELS[review.platform]} · ${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)}</div>
          <div style="font-size:15px;color:#141413;margin-top:8px;line-height:1.5">${escapeHtml(review.comment)}</div>
        </td></tr>
      </table>`
    : '';

  return wrap(
    alert.title,
    `<p style="font-size:15px;color:#3d3d3a;line-height:1.55">${escapeHtml(alert.body)}</p>
     ${reviewBlock}
     <a href="${dashboardUrl}" style="display:inline-block;background:#141413;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:15px">Répondre depuis le tableau de bord</a>`,
  );
}

const simpleHtml = (establishment: Establishment, title: string, body: string): string =>
  wrap(
    title,
    `<p style="font-size:15px;color:#3d3d3a;line-height:1.55">${escapeHtml(body)}</p>
     <a href="${env.webUrl}/dashboard/${establishment.id}/factures" style="display:inline-block;background:#141413;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:15px">Voir mes factures</a>`,
  );

const wrap = (title: string, content: string): string => `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#141413">
    <div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#c96442">Avisio</div>
    <h1 style="font-size:20px;margin:8px 0 12px">${escapeHtml(title)}</h1>
    ${content}
    <p style="font-size:12px;color:#8a8a85;margin-top:24px;line-height:1.5">
      Avisio lit les avis déjà publiés via les API officielles.
      Aucun avis n'est filtré, masqué ni retardé.
    </p>
  </div>`;

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
