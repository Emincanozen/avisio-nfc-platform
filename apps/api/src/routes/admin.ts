/**
 * Back-office d'exploitation.
 *
 * Réservé aux comptes de rôle `admin`. C'est ici que vit tout ce qu'un gérant
 * ne doit pas pouvoir faire : créer un établissement, changer une offre,
 * constater un règlement, déclencher les traitements de fond.
 *
 * Chaque route passe par `requireAdmin` : un JWT de gérant, même valide,
 * reçoit un 403.
 */

import {
  DEFAULT_PREFERENCES,
  PLANS,
  commitmentEndsAt,
  computeMetrics,
  entitlementDrift,
  formatEuros,
  generateId,
  generateSlug,
  monthlyCents,
  observedChurn,
  tagUrl,
  type Establishment,
  type NfcTag,
} from '@avisio/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { httpError } from '../app.js';
import { hashPassword } from '../auth.js';
import { env } from '../env.js';

const idParam = z.object({ id: z.string().min(3) });

const onboardingSchema = z.object({
  establishment: z.object({
    name: z.string().min(2).max(120),
    sector: z.enum(['restaurant', 'bar', 'hotel', 'retail', 'beauty', 'health', 'other']),
    postalCode: z.string().regex(/^\d{5}$/, 'Code postal à 5 chiffres attendu.'),
    nafCode: z.string().max(10).optional(),
    brandTone: z.string().min(5).max(400).default('professionnel et courtois'),
    defaultLocale: z.enum(['fr', 'en', 'es', 'de', 'it', 'nl']).default('fr'),
  }),
  subscription: z.object({
    plan: z.enum(['essentiel', 'pro', 'premium']),
    addons: z
      .array(z.enum(['negative_reviews', 'extra_platform', 'analytics', 'loyalty']))
      .default([]),
    extraPlatforms: z.number().int().min(0).max(4).default(0),
    tags: z.number().int().min(1).max(20).default(1),
    committed12Months: z.boolean().default(true),
  }),
  manager: z.object({
    name: z.string().min(2).max(120),
    email: z.string().email(),
    password: z.string().min(8).max(128),
  }),
  googleReviewUrl: z.string().url(),
  tagLabels: z.array(z.string().min(1).max(60)).default([]),
});

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  const { repo, billing, reports, ingest, push, llm } = app.ctx;
  const adminRoute = { onRequest: [app.requireAdmin] };

  // ---- Vue d'ensemble ----------------------------------------------------

  app.get('/admin/overview', adminRoute, async () => {
    const now = new Date().toISOString();
    const [metrics, establishments, subscriptions, reviews] = await Promise.all([
      billing.metrics(now),
      repo.establishments.listAll(),
      repo.subscriptions.listAll(),
      repo.reviews.listAll(),
    ]);

    // Attrition du mois civil en cours : l'hypothèse la plus sensible du
    // modèle financier doit être mesurée, pas supposée.
    const monthStart = new Date(
      Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1),
    ).toISOString();
    const monthEnd = new Date(
      Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1),
    ).toISOString();

    const signupsThisMonth = subscriptions.filter(
      (s) => new Date(s.startedAt).getTime() >= new Date(monthStart).getTime(),
    ).length;

    return {
      ...metrics,
      establishments: establishments.length,
      signupsThisMonth,
      churn: observedChurn(subscriptions, monthStart, monthEnd),
      reviewsTotal: reviews.length,
      importedReviews: reviews.filter((r) => r.source === 'import').length,
      unansweredNegatives: reviews.filter((r) => r.rating <= 3 && r.status !== 'answered').length,
      /**
       * Consommation du modèle de langage sur l'heure en cours.
       *
       * Exposée parce qu'un plafond qu'on ne voit pas ne se règle jamais
       * correctement : on ignore où le placer tant qu'on ne sait pas ce que
       * consomme une journée ordinaire. `throttled` à zéro est le cas normal ;
       * s'il monte, soit quelque chose s'emballe, soit le plafond est trop bas.
       */
      llm: llm.usage(),
      googleConnections: (await repo.googleConnections.listAll()).length,
      capabilities: {
        push: push.enabled,
      },
    };
  });

  // ---- Parc --------------------------------------------------------------

  app.get('/admin/establishments', adminRoute, async () => {
    const [establishments, subscriptions, invoices, reviews] = await Promise.all([
      repo.establishments.listAll(),
      repo.subscriptions.listAll(),
      repo.invoices.listAll(),
      repo.reviews.listAll(),
    ]);

    const now = Date.now();
    return establishments.map((establishment) => {
      const subscription = subscriptions.find((s) => s.establishmentId === establishment.id);
      const own = reviews.filter((r) => r.establishmentId === establishment.id);
      const overdue = invoices.filter(
        (i) =>
          i.establishmentId === establishment.id &&
          i.status === 'open' &&
          new Date(i.dueAt).getTime() < now,
      );

      return {
        id: establishment.id,
        name: establishment.name,
        sector: establishment.sector,
        postalCode: establishment.postalCode,
        plan: establishment.plan,
        addons: establishment.addons,
        status: subscription?.status ?? 'none',
        mrrCents: subscription ? monthlyCents(subscription) : 0,
        mrrLabel: formatEuros(subscription ? monthlyCents(subscription) : 0),
        startedAt: subscription?.startedAt ?? establishment.createdAt,
        commitmentEndsAt: subscription ? commitmentEndsAt(subscription) : null,
        // Signale un etablissement dont l offre ne correspond pas a sa facture.
        // Nul en fonctionnement normal ; non nul, c est une ecriture partielle
        // ou une modification indue, et cela doit se voir ici plutot que six
        // mois plus tard en comparant une facture a un usage.
        entitlementDrift: entitlementDrift(subscription, establishment),
        overdueInvoices: overdue.length,
        reviews: own.length,
        averageRating: computeMetrics(own).averageRating,
      };
    });
  });

  /**
   * Onboarding complet, en un appel : c'est le parcours que le commercial
   * déroule devant le client au moment de la signature. Établissement,
   * compte gérant, fiche Google, plaquettes, abonnement et première facture.
   */
  app.post('/admin/establishments', adminRoute, async (request) => {
    const input = onboardingSchema.parse(request.body);
    const now = new Date().toISOString();

    const existingManager = await repo.managers.findByEmail(input.manager.email);
    if (existingManager) {
      throw httpError(409, 'Un compte existe déjà avec cet e-mail.');
    }

    const establishment: Establishment = {
      id: generateId('est'),
      name: input.establishment.name,
      sector: input.establishment.sector,
      postalCode: input.establishment.postalCode,
      ...(input.establishment.nafCode ? { nafCode: input.establishment.nafCode } : {}),
      plan: input.subscription.plan,
      addons: input.subscription.addons,
      committed12Months: input.subscription.committed12Months,
      brandTone: input.establishment.brandTone,
      defaultLocale: input.establishment.defaultLocale,
      createdAt: now,
    };
    await repo.establishments.create(establishment);

    const manager = await repo.managers.create({
      id: generateId('mgr'),
      email: input.manager.email.toLowerCase(),
      passwordHash: hashPassword(input.manager.password),
      name: input.manager.name,
      role: 'owner',
      establishmentIds: [establishment.id],
      createdAt: now,
    });

    await repo.platformLinks.upsert({
      establishmentId: establishment.id,
      platform: 'google',
      reviewUrl: input.googleReviewUrl,
      enabled: true,
      reviewCount: 0,
      routedScans: 0,
    });

    // Plaquettes : une par emplacement nommé, complétées jusqu'au quota vendu.
    const labels = [...input.tagLabels];
    while (labels.length < input.subscription.tags) {
      labels.push(`Emplacement ${labels.length + 1}`);
    }

    const tags: NfcTag[] = [];
    for (const label of labels.slice(0, input.subscription.tags)) {
      let slug = generateSlug();
      for (let attempt = 0; attempt < 5 && (await repo.tags.findBySlug(slug)); attempt += 1) {
        slug = generateSlug();
      }
      tags.push(
        await repo.tags.create({
          id: generateId('tag'),
          establishmentId: establishment.id,
          label,
          slug,
          material: input.subscription.plan === 'premium' ? 'premium' : 'sticker',
          scanCount: 0,
          createdAt: now,
        }),
      );
    }

    await repo.notificationPreferences.upsert(DEFAULT_PREFERENCES(establishment.id));

    const { subscription, invoice } = await billing.subscribe({
      establishmentId: establishment.id,
      plan: input.subscription.plan,
      addons: input.subscription.addons,
      extraPlatforms: input.subscription.extraPlatforms,
      tags: input.subscription.tags,
      committed12Months: input.subscription.committed12Months,
      now,
    });

    return {
      establishment,
      manager: { id: manager.id, email: manager.email, name: manager.name },
      subscription,
      invoice: { ...invoice, totalLabel: formatEuros(invoice.totalCents) },
      tags: tags.map((tag) => ({ ...tag, url: tagUrl(env.webUrl, tag.slug) })),
    };
  });

  // ---- Abonnements -------------------------------------------------------

  app.patch('/admin/subscriptions/:id', adminRoute, async (request) => {
    const { id } = idParam.parse(request.params);
    const body = z
      .object({
        plan: z.enum(['essentiel', 'pro', 'premium']),
        addons: z
          .array(z.enum(['negative_reviews', 'extra_platform', 'analytics', 'loyalty']))
          .default([]),
      })
      .parse(request.body);

    const result = await billing.changePlan(id, body.plan, body.addons);
    return {
      ...result,
      prorationLabel: formatEuros(result.prorationCents),
      monthlyLabel: formatEuros(monthlyCents(result.subscription)),
    };
  });

  app.post('/admin/subscriptions/:id/cancel', adminRoute, async (request) => {
    const { id } = idParam.parse(request.params);
    return billing.cancel(id);
  });

  app.post('/admin/subscriptions/:id/reactivate', adminRoute, async (request) => {
    const { id } = idParam.parse(request.params);
    const subscription = await repo.subscriptions.findById(id);
    if (!subscription) throw httpError(404, 'Abonnement introuvable.');
    return repo.subscriptions.update(id, {
      status: 'active',
      cancelAt: undefined,
      canceledAt: undefined,
    });
  });

  // ---- Factures ----------------------------------------------------------

  app.get('/admin/invoices', adminRoute, async (request) => {
    const { status } = z
      .object({ status: z.enum(['draft', 'open', 'paid', 'void', 'uncollectible']).optional() })
      .parse(request.query);

    const [invoices, establishments] = await Promise.all([
      repo.invoices.listAll(),
      repo.establishments.listAll(),
    ]);
    const names = new Map(establishments.map((e) => [e.id, e.name]));
    const now = Date.now();

    return invoices
      .filter((invoice) => (status ? invoice.status === status : true))
      .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))
      .map((invoice) => ({
        ...invoice,
        establishmentName: names.get(invoice.establishmentId) ?? invoice.establishmentId,
        totalLabel: formatEuros(invoice.totalCents),
        overdue: invoice.status === 'open' && new Date(invoice.dueAt).getTime() < now,
      }));
  });

  app.post('/admin/invoices/:id/pay', adminRoute, async (request) => {
    const { id } = idParam.parse(request.params);
    const body = z
      .object({ reference: z.string().min(1).max(120).default('Règlement constaté') })
      .parse(request.body ?? {});
    return billing.markPaid(id, body.reference);
  });

  app.post('/admin/invoices/:id/void', adminRoute, async (request) => {
    const { id } = idParam.parse(request.params);
    // Une facture émise ne se supprime jamais (numérotation continue) : elle
    // est annulée, et la trace reste.
    return repo.invoices.update(id, { status: 'void' });
  });

  // ---- Comptes -----------------------------------------------------------

  app.get('/admin/managers', adminRoute, async () => {
    const managers = await repo.managers.listAll();
    return managers.map((manager) => ({
      id: manager.id,
      email: manager.email,
      name: manager.name,
      role: manager.role,
      establishmentIds: manager.establishmentIds,
      createdAt: manager.createdAt,
    }));
  });

  app.post('/admin/managers', adminRoute, async (request) => {
    const body = z
      .object({
        name: z.string().min(2).max(120),
        email: z.string().email(),
        password: z.string().min(8).max(128),
        role: z.enum(['owner', 'admin']).default('owner'),
        establishmentIds: z.array(z.string()).default([]),
      })
      .parse(request.body);

    if (await repo.managers.findByEmail(body.email)) {
      throw httpError(409, 'Un compte existe déjà avec cet e-mail.');
    }

    const manager = await repo.managers.create({
      id: generateId('mgr'),
      email: body.email.toLowerCase(),
      passwordHash: hashPassword(body.password),
      name: body.name,
      role: body.role,
      establishmentIds: body.establishmentIds,
      createdAt: new Date().toISOString(),
    });

    return { id: manager.id, email: manager.email, name: manager.name, role: manager.role };
  });

  // ---- Traitements de fond ----------------------------------------------

  /**
   * Déclenchement manuel des tâches planifiées : indispensable au support
   * (« relancez la facturation de ce mois ») et à la démonstration.
   */
  app.post('/admin/ops/:job', adminRoute, async (request) => {
    const { job } = z
      .object({
        job: z.enum(['billing', 'dunning', 'reports', 'ingest', 'trends', 'push']),
      })
      .parse(request.params);

    switch (job) {
      case 'billing':
        return billing.runBilling();
      case 'dunning':
        return billing.runDunning();
      case 'reports':
        return reports.runMonthly();
      case 'ingest':
        return ingest.runOnce();
      case 'trends':
        return { alertsCreated: await ingest.runDaily() };
      case 'push':
        return { sent: await push.flushQueued() };
    }
  });

  app.get('/admin/catalog', adminRoute, async () => ({
    plans: Object.values(PLANS).map((plan) => ({
      id: plan.id,
      name: plan.name,
      monthlyCents: plan.monthlyCents,
      monthlyLabel: formatEuros(plan.monthlyCents),
      includedTags: plan.includedTags,
    })),
  }));
}
