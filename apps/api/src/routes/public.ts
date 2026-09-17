/**
 * Routes publiques : parcours NFC, fidélité, widget avis.
 *
 * Aucune authentification, aucun cookie, aucun traceur. La seule donnée
 * personnelle qui transite est le contact volontairement saisi pour la
 * fidélité, et il est haché avant stockage.
 */

import {
  generateId,
  hasFeature,
  landingDisclosure,
  messages,
  negotiateLocale,
  platformQuota,
  selectPlatform,
  earnPoints,
  balanceMessage,
  PLATFORM_LABELS,
  type Locale,
  type ScanEvent,
} from '@avisio/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { httpError } from '../app.js';
import { hashContact } from '../auth.js';
import { env } from '../env.js';

export async function registerPublicRoutes(app: FastifyInstance): Promise<void> {
  const { repo } = app.ctx;

  app.get('/health', async () => ({
    status: 'ok',
    persistence: repo.kind,
    time: new Date().toISOString(),
  }));

  /**
   * Données de la landing page.
   *
   * Réponse volontairement minimale : le budget est de moins d'une seconde sur
   * un réseau mobile moyen, et la page est rendue côté serveur par Next.js.
   * Cet appel ne compte PAS de scan — seul le tap sur le bouton en déclenche un.
   */
  app.get('/public/tag/:slug', async (request) => {
    const { slug } = z.object({ slug: z.string().min(4) }).parse(request.params);
    const tag = await repo.tags.findBySlug(slug);
    if (!tag) throw httpError(404, "Plaquette inconnue ou non activée.");

    const establishment = await repo.establishments.findById(tag.establishmentId);
    if (!establishment) throw httpError(404, 'Établissement introuvable.');

    const locale = negotiateLocale(
      request.headers['accept-language'],
      establishment.defaultLocale,
    );

    const links = await repo.platformLinks.listByEstablishment(establishment.id);
    const quota = platformQuota(establishment.plan, establishment.addons);
    const decision = selectPlatform(links, establishment.sector, { quota });

    const loyaltyEnabled = hasFeature(establishment.plan, establishment.addons, 'loyalty');

    return {
      tag: { slug: tag.slug, label: tag.label },
      establishment: { id: establishment.id, name: establishment.name },
      locale,
      messages: messages(locale),
      platform: { id: decision.platform, label: PLATFORM_LABELS[decision.platform] },
      loyaltyEnabled,
      disclosure: landingDisclosure(loyaltyEnabled),
    };
  });

  /**
   * Enregistre le scan et renvoie l'URL de dépôt d'avis.
   *
   * La décision de routage est reprise ici — et non celle calculée à
   * l'affichage — pour rester cohérente avec les compteurs au moment du clic.
   */
  app.post('/public/tag/:slug/scan', async (request) => {
    const { slug } = z.object({ slug: z.string().min(4) }).parse(request.params);
    const tag = await repo.tags.findBySlug(slug);
    if (!tag) throw httpError(404, 'Plaquette inconnue.');

    const establishment = await repo.establishments.findById(tag.establishmentId);
    if (!establishment) throw httpError(404, 'Établissement introuvable.');

    const links = await repo.platformLinks.listByEstablishment(establishment.id);
    const quota = platformQuota(establishment.plan, establishment.addons);
    const decision = selectPlatform(links, establishment.sector, { quota });

    const locale = negotiateLocale(
      request.headers['accept-language'],
      establishment.defaultLocale,
    );

    const scan: ScanEvent = {
      id: generateId('scan'),
      tagId: tag.id,
      establishmentId: establishment.id,
      platform: decision.platform,
      locale: locale as Locale,
      createdAt: new Date().toISOString(),
    };

    await Promise.all([
      repo.scans.create(scan),
      repo.tags.recordScan(tag.id, scan.createdAt),
      repo.platformLinks.incrementRoutedScans(establishment.id, decision.platform),
    ]);

    return {
      redirectUrl: decision.reviewUrl,
      platform: { id: decision.platform, label: PLATFORM_LABELS[decision.platform] },
      reason: decision.reason,
    };
  });

  /**
   * Fidélité : crédit de points après un scan.
   *
   * Le crédit ne dépend ni de la note, ni du contenu de l'avis — il ne peut
   * pas en dépendre : l'API ne reçoit aucune de ces informations.
   */
  app.post('/public/tag/:slug/loyalty', async (request) => {
    const { slug } = z.object({ slug: z.string().min(4) }).parse(request.params);
    const body = z
      .object({
        contact: z.string().min(5).max(120),
        channel: z.enum(['sms', 'email']),
      })
      .parse(request.body);

    const tag = await repo.tags.findBySlug(slug);
    if (!tag) throw httpError(404, 'Plaquette inconnue.');
    const establishment = await repo.establishments.findById(tag.establishmentId);
    if (!establishment) throw httpError(404, 'Établissement introuvable.');

    if (!hasFeature(establishment.plan, establishment.addons, 'loyalty')) {
      throw httpError(403, "Le module fidélité n'est pas actif sur cet établissement.");
    }

    const contactHash = hashContact(body.contact, env.jwtSecret);
    const existing = await repo.loyalty.findByContactHash(establishment.id, contactHash);

    if (!existing) {
      const created = await repo.loyalty.create({
        id: generateId('loy'),
        establishmentId: establishment.id,
        contactHash,
        channel: body.channel,
        points: 0,
        createdAt: new Date().toISOString(),
      });
      const outcome = earnPoints(created);
      if (!outcome.credited) throw httpError(429, 'Crédit déjà enregistré récemment.');
      const updated = await repo.loyalty.update(created.id, {
        points: outcome.balance,
        lastEarnedAt: new Date().toISOString(),
      });
      return {
        credited: true,
        balance: updated.points,
        message: balanceMessage(updated.points),
        unlocked: outcome.unlocked,
      };
    }

    const outcome = earnPoints(existing);
    if (!outcome.credited) {
      return {
        credited: false,
        balance: outcome.balance,
        message: balanceMessage(outcome.balance),
        nextEligibleAt: outcome.nextEligibleAt,
      };
    }

    const updated = await repo.loyalty.update(existing.id, {
      points: outcome.balance,
      lastEarnedAt: new Date().toISOString(),
    });
    return {
      credited: true,
      balance: updated.points,
      message: balanceMessage(updated.points),
      unlocked: outcome.unlocked,
    };
  });

  /**
   * Widget avis à embarquer sur le site du client.
   *
   * Ne renvoie que des avis publics déjà visibles sur les plateformes. Le tri
   * par note est assumé ici : c'est une vitrine éditoriale sur son propre site,
   * pas la restitution d'un panel d'avis — la distinction est faite explicite
   * par le champ `disclosure`.
   */
  app.get('/public/widget/:establishmentId', async (request) => {
    const { establishmentId } = z
      .object({ establishmentId: z.string().min(3) })
      .parse(request.params);
    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(20).default(5) })
      .parse(request.query);

    const establishment = await repo.establishments.findById(establishmentId);
    if (!establishment) throw httpError(404, 'Établissement introuvable.');

    const links = await repo.platformLinks.listByEstablishment(establishmentId);
    const reviews = await repo.reviews.query({ establishmentId, limit: 200 });

    const totalCount = links.reduce((acc, l) => acc + l.reviewCount, 0);
    const weighted = links.filter((l) => l.averageRating != null);
    const averageRating =
      weighted.length === 0
        ? null
        : Number(
            (
              weighted.reduce((acc, l) => acc + l.averageRating! * l.reviewCount, 0) /
              Math.max(1, weighted.reduce((acc, l) => acc + l.reviewCount, 0))
            ).toFixed(2),
          );

    return {
      establishment: { id: establishment.id, name: establishment.name },
      averageRating,
      totalCount,
      reviews: reviews
        .filter((r) => r.rating >= 4 && r.comment.length > 20)
        .slice(0, query.limit)
        .map((r) => ({
          author: r.author,
          rating: r.rating,
          comment: r.comment,
          platform: PLATFORM_LABELS[r.platform],
          publishedAt: r.publishedAt,
        })),
      disclosure:
        'Sélection d’avis publiés sur nos plateformes. Consultez-les tous sur Google.',
    };
  });
}
