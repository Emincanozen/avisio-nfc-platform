/**
 * Espace gérant : abonnement, factures, rapport mensuel, notifications.
 *
 * Le gérant consulte et résilie ; il ne fixe pas ses prix. Tout ce qui touche
 * au barème ou au statut d'une facture passe par le back-office (`admin.ts`).
 */

import {
  DEFAULT_PREFERENCES,
  commitmentEndsAt,
  formatEuros,
  generateId,
  hasFeature,
  latePenaltyCents,
  monthlyCents,
  previousMonthPeriod,
  type ReportPeriod,
} from '@avisio/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { assertAccess, httpError } from '../app.js';
import { renderInvoicePdf, renderReportPdf } from '../services/pdf.js';

const idParam = z.object({ id: z.string().min(3) });

const channelSchema = z.array(z.enum(['email', 'push']));

export async function registerBillingRoutes(app: FastifyInstance): Promise<void> {
  const { repo, billing, reports, push } = app.ctx;
  const protectedRoute = { onRequest: [app.authenticate] };

  // ---- Abonnement --------------------------------------------------------

  app.get('/establishments/:id/subscription', protectedRoute, async (request) => {
    const { id } = idParam.parse(request.params);
    assertAccess(request, id);

    const subscription = await repo.subscriptions.findByEstablishment(id);
    if (!subscription) throw httpError(404, 'Aucun abonnement sur cet établissement.');

    return {
      subscription,
      monthlyCents: monthlyCents(subscription),
      monthlyLabel: formatEuros(monthlyCents(subscription)),
      commitmentEndsAt: commitmentEndsAt(subscription),
    };
  });

  app.post('/establishments/:id/subscription/cancel', protectedRoute, async (request) => {
    const { id } = idParam.parse(request.params);
    assertAccess(request, id);
    const subscription = await repo.subscriptions.findByEstablishment(id);
    if (!subscription) throw httpError(404, 'Aucun abonnement sur cet établissement.');
    return billing.cancel(subscription.id);
  });

  // ---- Factures ----------------------------------------------------------

  app.get('/establishments/:id/invoices', protectedRoute, async (request) => {
    const { id } = idParam.parse(request.params);
    assertAccess(request, id);
    const now = new Date().toISOString();
    const invoices = await repo.invoices.listByEstablishment(id);

    return invoices.map((invoice) => ({
      ...invoice,
      totalLabel: formatEuros(invoice.totalCents),
      penaltyCents: latePenaltyCents(invoice, now),
      overdue: invoice.status === 'open' && new Date(invoice.dueAt).getTime() < Date.now(),
    }));
  });

  /** PDF de la facture, avec les mentions légales obligatoires. */
  app.get('/invoices/:id/pdf', protectedRoute, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const invoice = await repo.invoices.findById(id);
    if (!invoice) throw httpError(404, 'Facture introuvable.');
    assertAccess(request, invoice.establishmentId);

    const establishment = await repo.establishments.findById(invoice.establishmentId);
    if (!establishment) throw httpError(404, 'Établissement introuvable.');

    const pdf = await renderInvoicePdf(invoice, establishment);
    return reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `inline; filename="${invoice.number}.pdf"`)
      .send(pdf);
  });

  // ---- Rapport mensuel ---------------------------------------------------

  const parsePeriod = (value?: string): ReportPeriod => {
    if (!value) return previousMonthPeriod();
    const match = /^(\d{4})-(\d{2})$/.exec(value);
    if (!match) throw httpError(400, 'Période attendue au format AAAA-MM.');
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const start = new Date(Date.UTC(year, month, 1));
    const end = new Date(Date.UTC(year, month + 1, 1));
    return {
      start: start.toISOString(),
      end: end.toISOString(),
      label: start.toLocaleDateString('fr-FR', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }),
    };
  };

  app.get('/establishments/:id/report', protectedRoute, async (request) => {
    const { id } = idParam.parse(request.params);
    assertAccess(request, id);
    const { period } = z.object({ period: z.string().optional() }).parse(request.query);

    const establishment = await repo.establishments.findById(id);
    if (!establishment) throw httpError(404, 'Établissement introuvable.');
    if (!hasFeature(establishment.plan, establishment.addons, 'analytics_advanced')) {
      throw httpError(
        402,
        "Le rapport mensuel est compris dans l'offre Premium ou l'add-on Analytics.",
      );
    }

    return reports.build(id, parsePeriod(period));
  });

  app.get('/establishments/:id/report.pdf', protectedRoute, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    assertAccess(request, id);
    const { period } = z.object({ period: z.string().optional() }).parse(request.query);

    const establishment = await repo.establishments.findById(id);
    if (!establishment) throw httpError(404, 'Établissement introuvable.');
    if (!hasFeature(establishment.plan, establishment.addons, 'analytics_advanced')) {
      throw httpError(402, "Le rapport mensuel est compris dans l'offre Premium.");
    }

    const report = await reports.build(id, parsePeriod(period));
    const pdf = await renderReportPdf(report);
    const slug = report.period.label.replace(/\s+/g, '-').toLowerCase();

    return reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `inline; filename="avisio-${slug}.pdf"`)
      .send(pdf);
  });

  // ---- Préférences de notification --------------------------------------

  app.get('/establishments/:id/notifications', protectedRoute, async (request) => {
    const { id } = idParam.parse(request.params);
    assertAccess(request, id);
    const stored = await repo.notificationPreferences.get(id);
    return stored ?? DEFAULT_PREFERENCES(id);
  });

  app.put('/establishments/:id/notifications', protectedRoute, async (request) => {
    const { id } = idParam.parse(request.params);
    assertAccess(request, id);

    const body = z
      .object({
        channels: z.object({
          negative_review: channelSchema,
          theme_trend: channelSchema,
          weekly_digest: channelSchema,
          monthly_report: channelSchema,
          billing: channelSchema,
        }),
        quietHours: z
          .object({ start: z.number().int().min(0).max(23), end: z.number().int().min(0).max(23) })
          .nullable(),
        utcOffsetHours: z.number().int().min(-12).max(14).default(2),
      })
      .parse(request.body);

    return repo.notificationPreferences.upsert({ establishmentId: id, ...body });
  });

  // ---- Push web ----------------------------------------------------------

  /** Clé publique VAPID, nécessaire au navigateur pour s'abonner. */
  app.get('/push/public-key', async () => ({
    publicKey: push.publicKey,
    enabled: push.enabled,
  }));

  app.post('/push/subscribe', protectedRoute, async (request) => {
    const body = z
      .object({
        endpoint: z.string().url(),
        keys: z.object({ p256dh: z.string().min(10), auth: z.string().min(5) }),
      })
      .parse(request.body);

    const record = await repo.push.subscribe({
      id: generateId('psub'),
      managerId: request.managerId,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      ...(request.headers['user-agent'] ? { userAgent: String(request.headers['user-agent']) } : {}),
      createdAt: new Date().toISOString(),
    });

    return { subscribed: true, id: record.id };
  });

  app.post('/push/unsubscribe', protectedRoute, async (request) => {
    const body = z.object({ endpoint: z.string().url() }).parse(request.body);
    await repo.push.unsubscribe(body.endpoint);
    return { unsubscribed: true };
  });

  /** Envoi de test : vérifie la chaîne complète depuis l'interface. */
  app.post('/push/test', protectedRoute, async (request) => {
    const delivered = await push.sendToManager(request.managerId, {
      title: 'Avisio — notification de test',
      body: 'Si vous lisez ceci, les alertes arriveront bien sur cet appareil.',
      url: '/dashboard',
    });
    return { delivered, enabled: push.enabled };
  });
}
