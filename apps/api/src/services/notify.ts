/**
 * Notifications gérant : e-mail transactionnel + point de sortie push.
 *
 * Sans clé Resend, les messages sont journalisés en console avec leur contenu
 * intégral : la chaîne d'alerte reste démontrable de bout en bout en local.
 *
 * Le push (Firebase Cloud Messaging) est branché sur la même interface. Il
 * n'est pas implémenté ici : il suppose une application mobile ou une PWA
 * installée, ce qui arrive en phase 2 du plan de lancement.
 */

import type { Alert, Establishment, Review } from '@avisio/core';
import { PLATFORM_LABELS } from '@avisio/core';
import { capabilities, env } from '../env.js';

export interface Notifier {
  alert(to: string, establishment: Establishment, alert: Alert, review?: Review): Promise<void>;
  monthlyReport(to: string, establishment: Establishment, html: string): Promise<void>;
}

export function createNotifier(logger: {
  info: (msg: string) => void;
  warn: (msg: string) => void;
}): Notifier {
  const send = async (to: string, subject: string, html: string): Promise<void> => {
    if (!capabilities.email) {
      logger.info(`[email simulé] à ${to} — ${subject}`);
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

  return {
    async alert(to, establishment, alert, review) {
      const subject =
        alert.type === 'negative_review'
          ? `${establishment.name} — avis ${review?.rating ?? ''}★ à traiter`
          : `${establishment.name} — ${alert.title}`;
      await send(to, subject, alertHtml(establishment, alert, review));
    },

    async monthlyReport(to, establishment, html) {
      await send(to, `${establishment.name} — rapport mensuel de réputation`, html);
    },
  };
}

function alertHtml(establishment: Establishment, alert: Alert, review?: Review): string {
  const dashboardUrl = `${env.webUrl}/dashboard/${establishment.id}`;
  const reviewBlock = review
    ? `
      <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f8f7f4;border-radius:10px">
        <tr><td style="padding:16px">
          <div style="font-size:13px;color:#6b6b6b">${review.author} · ${PLATFORM_LABELS[review.platform]} · ${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)}</div>
          <div style="font-size:15px;color:#141413;margin-top:8px;line-height:1.5">${escapeHtml(review.comment)}</div>
        </td></tr>
      </table>`
    : '';

  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#141413">
    <div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#c96442">Avisio</div>
    <h1 style="font-size:20px;margin:8px 0 4px">${escapeHtml(alert.title)}</h1>
    <p style="font-size:15px;color:#3d3d3a;line-height:1.55">${escapeHtml(alert.body)}</p>
    ${reviewBlock}
    <a href="${dashboardUrl}" style="display:inline-block;background:#141413;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:15px">Répondre depuis le tableau de bord</a>
    <p style="font-size:12px;color:#8a8a85;margin-top:24px;line-height:1.5">
      Avisio lit les avis déjà publiés via les API officielles des plateformes.
      Aucun avis n'est filtré, masqué ni retardé.
    </p>
  </div>`;
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
