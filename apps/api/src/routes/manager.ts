/**
 * Espace gérant : avis, réponses, alertes, plaquettes, plateformes, analytics.
 *
 * Toutes les routes portent l'identifiant d'établissement et passent par
 * `assertAccess` : un JWT valide ne suffit pas, il faut que l'établissement
 * fasse partie du périmètre du compte.
 */

import {
  PLATFORM_LABELS,
  REVIEW_STATUS_LABELS,
  hasEntitlement,
  NotEnoughPeersError,
  assertCompliant,
  checkLandingConfig,
  fitsOnNtag213,
  generateId,
  generateSlug,
  nextStatus,
  platformQuota,
  replyWarnings,
  sanitizeReply,
  simulateRouting,
  tagUrl,
  type NfcTag,
  type PlatformLink,
} from '@avisio/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { assertAccess, httpError } from '../app.js';
import { env } from '../env.js';

const idParam = z.object({ id: z.string().min(3) });

export async function registerManagerRoutes(app: FastifyInstance): Promise<void> {
  const { repo, analytics, llm, connectors } = app.ctx;
  const protectedRoute = { onRequest: [app.authenticate] };

  // ---- Établissements ----------------------------------------------------

  app.get('/establishments', protectedRoute, async (request) =>
    repo.establishments.listByIds(request.establishmentIds),
  );

  app.get('/establishments/:id', protectedRoute, async (request) => {
    const { id } = idParam.parse(request.params);
    assertAccess(request, id);
    const establishment = await repo.establishments.findById(id);
    if (!establishment) throw httpError(404, 'Établissement introuvable.');

    const [links, tags] = await Promise.all([
      repo.platformLinks.listByEstablishment(id),
      repo.tags.listByEstablishment(id),
    ]);

    // Les droits viennent de l'abonnement facturé, jamais de l'établissement :
    // ce dernier est modifiable par le gérant, le premier ne l'est que par
    // l'exploitant. Voir packages/core/src/entitlements.ts.
    const droits = await app.ctx.entitlements.forEstablishment(establishment);

    return {
      establishment,
      platformLinks: links,
      tags: tags.map((tag) => ({ ...tag, url: tagUrl(env.webUrl, tag.slug) })),
      quota: platformQuota(droits.plan, droits.addons),
      /** Statut de l'abonnement, pour que l'interface explique une restriction. */
      subscriptionStatus: droits.status,
      restriction: droits.restriction,
      features: {
        negativeAlerts: hasEntitlement(droits, 'negative_alerts'),
        aiReplies: hasEntitlement(droits, 'ai_reply_suggestions'),
        analytics: hasEntitlement(droits, 'analytics_basic'),
        nlpThemes: hasEntitlement(droits, 'nlp_themes'),
        benchmark: hasEntitlement(droits, 'competitive_benchmark'),
        loyalty: hasEntitlement(droits, 'loyalty'),
        multiPlatform: hasEntitlement(droits, 'multi_platform'),
      },
    };
  });

  app.patch('/establishments/:id', protectedRoute, async (request) => {
    const { id } = idParam.parse(request.params);
    assertAccess(request, id);
    /**
     * Informations opérationnelles uniquement.
     *
     * `plan` et `addons` ont été retirés, et c'est une correction de sécurité,
     * pas un resserrement de confort. Les droits lisaient l'établissement
     * pendant que la facturation lisait l'abonnement : une seule requête sur
     * cette route suffisait à passer en Premium en restant facturé Essentiel.
     * Aucune erreur, aucun journal — juste le produit gratuitement.
     *
     * Les conditions commerciales passent désormais exclusivement par
     * `PATCH /admin/subscriptions/:id`, qui met à jour l'abonnement ET
     * l'établissement, et calcule le prorata.
     *
     * `strict()` refuse tout champ inconnu plutôt que de l'ignorer en
     * silence : un client qui envoie `plan` doit l'apprendre, pas croire que
     * sa demande a été prise en compte.
     */
    const patch = z
      .object({
        name: z.string().min(2).max(120).optional(),
        brandTone: z.string().min(5).max(400).optional(),
        defaultLocale: z.enum(['fr', 'en', 'es', 'de', 'it', 'nl']).optional(),
        postalCode: z.string().regex(/^\d{5}$/).optional(),
        nafCode: z.string().max(10).optional(),
      })
      .strict()
      .parse(request.body);

    return repo.establishments.update(id, patch);
  });

  /**
   * Garde-fou de conformité exposé en API : toute tentative de configurer un
   * tri par note sur le parcours NFC est refusée avec le motif réglementaire.
   */
  app.post('/establishments/:id/landing-config', protectedRoute, async (request) => {
    const { id } = idParam.parse(request.params);
    assertAccess(request, id);
    const config = z
      .object({
        askRatingBeforeRedirect: z.boolean().optional(),
        routeByPrefilledRating: z.boolean().optional(),
        privateFeedbackInsteadOfPublic: z.boolean().optional(),
      })
      .parse(request.body);

    assertCompliant(checkLandingConfig(config));
    return { accepted: true };
  });

  // ---- Analytics ---------------------------------------------------------

  app.get('/establishments/:id/overview', protectedRoute, async (request) => {
    const { id } = idParam.parse(request.params);
    assertAccess(request, id);
    const { days } = z
      .object({ days: z.coerce.number().int().min(7).max(365).default(30) })
      .parse(request.query);
    return analytics.overview(id, days);
  });

  app.get('/establishments/:id/benchmark', protectedRoute, async (request) => {
    const { id } = idParam.parse(request.params);
    assertAccess(request, id);
    const establishment = await repo.establishments.findById(id);
    if (!establishment) throw httpError(404, 'Établissement introuvable.');
    const droits = await app.ctx.entitlements.forEstablishment(establishment);
    if (!hasEntitlement(droits, 'competitive_benchmark')) {
      throw httpError(402, "Le benchmark est inclus dans l'offre Premium ou l'add-on Analytics.");
    }
    try {
      return await analytics.benchmark(id);
    } catch (error) {
      if (error instanceof NotEnoughPeersError) {
        throw httpError(409, error.message);
      }
      throw error;
    }
  });

  // ---- Avis --------------------------------------------------------------

  app.get('/establishments/:id/reviews', protectedRoute, async (request) => {
    const { id } = idParam.parse(request.params);
    assertAccess(request, id);
    const query = z
      .object({
        status: z
          .enum(['new', 'draft_ready', 'reply_pending', 'answered', 'reply_failed', 'ignored'])
          .optional(),
        maxRating: z.coerce.number().int().min(1).max(5).optional(),
        days: z.coerce.number().int().min(1).max(365).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .parse(request.query);

    return repo.reviews.query({
      establishmentId: id,
      ...(query.status ? { status: query.status } : {}),
      ...(query.maxRating ? { maxRating: query.maxRating } : {}),
      ...(query.days
        ? { since: new Date(Date.now() - query.days * 86_400_000).toISOString() }
        : {}),
      limit: query.limit,
    });
  });

  app.post('/reviews/:id/suggest-reply', protectedRoute, async (request) => {
    const { id } = idParam.parse(request.params);
    const body = z.object({ gesture: z.string().max(200).optional() }).parse(request.body ?? {});

    const review = await repo.reviews.findById(id);
    if (!review) throw httpError(404, 'Avis introuvable.');
    assertAccess(request, review.establishmentId);

    const establishment = await repo.establishments.findById(review.establishmentId);
    if (!establishment) throw httpError(404, 'Établissement introuvable.');
    const droits = await app.ctx.entitlements.forEstablishment(establishment);
    if (!hasEntitlement(droits, 'ai_reply_suggestions')) {
      throw httpError(402, "Les suggestions de réponse sont incluses à partir de l'offre Pro.");
    }

    const suggestion = await llm.suggestReply(
      review,
      establishment,
      body.gesture,
    );
    await repo.reviews.update(review.id, { status: nextStatus(review.status, 'draft') });
    return suggestion;
  });

  /**
   * Publication de la réponse.
   *
   * La réponse part telle que le gérant l'a validée : le texte suggéré n'est
   * jamais publié automatiquement. Les avertissements de conformité sont
   * renvoyés mais ne bloquent pas — c'est sa parole, sur sa fiche.
   */
  app.post('/reviews/:id/reply', protectedRoute, async (request) => {
    const { id } = idParam.parse(request.params);
    const body = z.object({ text: z.string().min(10).max(1000) }).parse(request.body);

    const review = await repo.reviews.findById(id);
    if (!review) throw httpError(404, 'Avis introuvable.');
    assertAccess(request, review.establishmentId);

    const text = sanitizeReply(body.text, 1000);
    const links = await repo.platformLinks.listByEstablishment(review.establishmentId);
    const link = links.find((l) => l.platform === review.platform);
    const connector = connectors.get(review.platform);

    /**
     * Le statut dit ce qui s'est réellement passé, jamais ce qu'on espérait.
     *
     * Avant, la réponse était marquée `answered` dans tous les cas — y compris
     * quand la plateforme n'était pas connectée et que rien n'était parti. Le
     * gérant croyait avoir répondu publiquement, son client ne voyait jamais
     * la réponse, et le taux de réponse affiché — un indicateur vendu —
     * comptait des réponses inexistantes.
     *
     * Trois issues, trois statuts :
     *  - la plateforme confirme        → `answered`
     *  - pas de connecteur en direct   → `reply_pending`, texte conservé
     *  - la plateforme refuse          → `reply_failed`, et on le dit
     *
     * Aucune ne lève d'erreur : le texte du gérant est toujours enregistré.
     * Le perdre parce que Google est injoignable serait le punir d'une panne
     * qui n'est pas la sienne.
     */
    let outcome: 'confirmed' | 'pending' | 'failed' = 'pending';
    let detail = '';

    if (connector?.live && link) {
      try {
        await connector.publishReply(
          { establishmentId: review.establishmentId, externalId: link.externalId ?? null },
          review.externalId,
          text,
        );
        outcome = 'confirmed';
      } catch (error) {
        outcome = 'failed';
        detail = (error as Error).message;
        request.log.warn(
          `Publication refusée par ${review.platform} pour l'avis ${review.id} : ${detail}`,
        );
      }
    } else {
      detail = `${PLATFORM_LABELS[review.platform]} n'est pas connectée : la réponse est enregistrée mais n'est pas publiée.`;
    }

    const updated = await repo.reviews.update(review.id, {
      replyText: text,
      repliedAt: new Date().toISOString(),
      status: nextStatus(review.status, 'publish', outcome),
    });

    return {
      review: updated,
      /** Vrai uniquement si la plateforme a confirmé. */
      published: outcome === 'confirmed',
      outcome,
      statusLabel: REVIEW_STATUS_LABELS[updated.status],
      ...(detail ? { detail } : {}),
      warnings: replyWarnings(text),
    };
  });

  app.post('/reviews/:id/ignore', protectedRoute, async (request) => {
    const { id } = idParam.parse(request.params);
    const review = await repo.reviews.findById(id);
    if (!review) throw httpError(404, 'Avis introuvable.');
    assertAccess(request, review.establishmentId);
    return repo.reviews.update(review.id, { status: nextStatus(review.status, 'ignore') });
  });

  // ---- Alertes -----------------------------------------------------------

  app.get('/establishments/:id/alerts', protectedRoute, async (request) => {
    const { id } = idParam.parse(request.params);
    assertAccess(request, id);
    const { limit } = z
      .object({ limit: z.coerce.number().int().min(1).max(100).default(30) })
      .parse(request.query);
    return repo.alerts.listByEstablishment(id, limit);
  });

  app.post('/alerts/:id/read', protectedRoute, async (request) => {
    const { id } = idParam.parse(request.params);
    // Sans cette lecture préalable, n'importe quel gérant authentifié pouvait
    // marquer lue l'alerte d'un autre établissement : l'identifiant suffisait.
    const alert = await repo.alerts.findById(id);
    if (!alert) throw httpError(404, 'Alerte introuvable.');
    assertAccess(request, alert.establishmentId);

    await repo.alerts.markRead(id, new Date().toISOString());
    return { ok: true };
  });

  // ---- Plaquettes NFC ----------------------------------------------------

  app.get('/establishments/:id/tags', protectedRoute, async (request) => {
    const { id } = idParam.parse(request.params);
    assertAccess(request, id);
    const tags = await repo.tags.listByEstablishment(id);
    return tags.map((tag) => ({
      ...tag,
      url: tagUrl(env.webUrl, tag.slug),
      fitsOnNtag213: fitsOnNtag213(tagUrl(env.webUrl, tag.slug)),
    }));
  });

  app.post('/establishments/:id/tags', protectedRoute, async (request) => {
    const { id } = idParam.parse(request.params);
    assertAccess(request, id);
    const body = z
      .object({
        label: z.string().min(2).max(60),
        material: z.enum(['sticker', 'chevalet', 'premium']).default('sticker'),
      })
      .parse(request.body);

    // Collision de slug quasi impossible (2^39) mais vérifiée : une plaquette
    // imprimée qui pointe vers le mauvais commerce est irrattrapable.
    let slug = generateSlug();
    for (let attempt = 0; attempt < 5 && (await repo.tags.findBySlug(slug)); attempt += 1) {
      slug = generateSlug();
    }

    const tag: NfcTag = {
      id: generateId('tag'),
      establishmentId: id,
      label: body.label,
      slug,
      material: body.material,
      scanCount: 0,
      createdAt: new Date().toISOString(),
    };
    const created = await repo.tags.create(tag);
    const url = tagUrl(env.webUrl, created.slug);

    return { ...created, url, fitsOnNtag213: fitsOnNtag213(url) };
  });

  // ---- Plateformes & routage --------------------------------------------

  app.put('/establishments/:id/platforms/:platform', protectedRoute, async (request) => {
    const params = z
      .object({
        id: z.string().min(3),
        platform: z.enum(['google', 'tripadvisor', 'facebook', 'yelp', 'thefork']),
      })
      .parse(request.params);
    assertAccess(request, params.id);

    const body = z
      .object({
        reviewUrl: z.string().url(),
        externalId: z.string().max(200).optional(),
        enabled: z.boolean().default(true),
      })
      .parse(request.body);

    const establishment = await repo.establishments.findById(params.id);
    if (!establishment) throw httpError(404, 'Établissement introuvable.');

    const existing = await repo.platformLinks.listByEstablishment(params.id);
    const quota = platformQuota(establishment.plan, establishment.addons);
    const enabledCount = existing.filter(
      (l) => l.enabled && l.platform !== params.platform,
    ).length;
    if (body.enabled && enabledCount + 1 > quota) {
      throw httpError(
        402,
        `Votre offre autorise ${quota} plateforme(s). Ajoutez l'add-on « Plateforme supplémentaire » pour aller plus loin.`,
      );
    }

    const current = existing.find((l) => l.platform === params.platform);
    const link: PlatformLink = {
      establishmentId: params.id,
      platform: params.platform,
      reviewUrl: body.reviewUrl,
      ...(body.externalId ? { externalId: body.externalId } : {}),
      enabled: body.enabled,
      reviewCount: current?.reviewCount ?? 0,
      routedScans: current?.routedScans ?? 0,
      ...(current?.averageRating == null ? {} : { averageRating: current.averageRating }),
    };
    return repo.platformLinks.upsert(link);
  });

  app.get('/establishments/:id/routing/simulate', protectedRoute, async (request) => {
    const { id } = idParam.parse(request.params);
    assertAccess(request, id);
    const { scans } = z
      .object({ scans: z.coerce.number().int().min(10).max(5000).default(100) })
      .parse(request.query);

    const establishment = await repo.establishments.findById(id);
    if (!establishment) throw httpError(404, 'Établissement introuvable.');
    const links = await repo.platformLinks.listByEstablishment(id);
    const quota = platformQuota(establishment.plan, establishment.addons);

    return {
      scans,
      distribution: simulateRouting(
        links,
        establishment.sector,
        scans,
        Number.isFinite(quota) ? quota : undefined,
      ),
    };
  });

  // Le déclenchement manuel des traitements vit dans `admin.ts`, derrière
  // `requireAdmin`. Ces traitements balaient TOUT le parc : laissés ouverts à
  // un gérant, ils auraient permis à un client de déclencher les appels aux
  // API des plateformes et les dépenses de modèle de langage de tous les
  // autres établissements.
}
