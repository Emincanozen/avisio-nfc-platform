/**
 * Pipeline d'ingestion des avis.
 *
 *   plateformes → dédoublonnage → analyse NLP → alertes → notifications
 *
 * Le pipeline est idempotent : la clé (établissement, plateforme, identifiant
 * externe) garantit qu'un avis n'entre qu'une fois, même si le cycle
 * d'ingestion se chevauche ou redémarre.
 *
 * Il ne modifie jamais l'avis côté plateforme. Il lit, classe et alerte.
 */

import {
  detectThemeTrends,
  generateId,
  hasFeature,
  shouldAlert,
  type Alert,
  type Establishment,
  type PlatformId,
  type Review,
} from '@avisio/core';
import { PLATFORM_LABELS } from '@avisio/core';
import type { Repository } from '../repository/index.js';
import type { LlmService } from './anthropic.js';
import type { ReviewConnector } from './google.js';
import { toDomainReview } from './google.js';
import type { Notifier } from './notify.js';

export interface IngestReport {
  establishments: number;
  newReviews: number;
  alertsCreated: number;
  errors: string[];
}

interface Deps {
  repo: Repository;
  connectors: Map<PlatformId, ReviewConnector>;
  llm: LlmService;
  notifier: Notifier;
  logger: { info: (msg: string) => void; warn: (msg: string) => void };
}

export function createIngestService(deps: Deps) {
  const { repo, connectors, llm, notifier, logger } = deps;

  async function ingestEstablishment(establishment: Establishment): Promise<{
    newReviews: Review[];
    alerts: Alert[];
  }> {
    const links = await repo.platformLinks.listByEstablishment(establishment.id);
    const newReviews: Review[] = [];
    const alerts: Alert[] = [];

    for (const link of links) {
      if (!link.enabled) continue;
      const connector = connectors.get(link.platform);
      if (!connector) continue;

      const locationId = link.externalId ?? link.establishmentId;
      const lastKnown = await lastReviewDate(establishment.id, link.platform);

      let externals;
      try {
        externals = await connector.fetchReviews(locationId, lastKnown);
      } catch (error) {
        logger.warn(
          `Ingestion ${link.platform} pour ${establishment.name} : ${(error as Error).message}`,
        );
        continue;
      }

      const candidates = externals.map((e) => toDomainReview(e, establishment.id, link.platform));
      const created = await repo.reviews.upsertMany(candidates);

      for (const review of created) {
        const analysis = await llm.analyze(review, establishment.sector);
        const stored = await repo.reviews.update(review.id, { analysis });
        newReviews.push(stored);

        if (shouldAlert(stored)) {
          alerts.push(await raiseNegativeAlert(establishment, stored));
        }
      }

      // Synchronisation des compteurs : elle pilote le moteur de routage.
      try {
        const counters = await connector.fetchCounters(locationId);
        if (counters) {
          await repo.platformLinks.syncCounts(establishment.id, link.platform, counters);
        }
      } catch (error) {
        logger.warn(`Compteurs ${link.platform} indisponibles : ${(error as Error).message}`);
      }
    }

    return { newReviews, alerts };
  }

  async function raiseNegativeAlert(
    establishment: Establishment,
    review: Review,
  ): Promise<Alert> {
    const alert: Alert = {
      id: generateId('alr'),
      establishmentId: establishment.id,
      type: 'negative_review',
      severity: review.rating <= 2 ? 'critical' : 'warning',
      title: `Avis ${review.rating}★ sur ${PLATFORM_LABELS[review.platform]}`,
      body: review.comment.slice(0, 200),
      reviewId: review.id,
      createdAt: new Date().toISOString(),
    };
    const created = await repo.alerts.create(alert);

    // L'alerte temps réel est une fonctionnalité facturée : sans le droit,
    // l'avis reste visible dans le dashboard mais ne réveille personne.
    if (hasFeature(establishment.plan, establishment.addons, 'negative_alerts')) {
      for (const email of await managerEmails(establishment.id)) {
        await notifier.alert(email, establishment, created, review);
      }
    }
    return created;
  }

  /**
   * Détection de tendance : tourne une fois par jour, pas à chaque cycle
   * d'ingestion — une tendance sur 7 jours ne change pas toutes les 20 minutes,
   * et réémettre l'alerte à chaque passage ferait fuir le gérant.
   */
  async function detectTrends(establishment: Establishment): Promise<Alert[]> {
    if (!hasFeature(establishment.plan, establishment.addons, 'nlp_themes')) return [];

    const reviews = await repo.reviews.query({
      establishmentId: establishment.id,
      since: new Date(Date.now() - 31 * 86_400_000).toISOString(),
      limit: 500,
    });

    const trends = detectThemeTrends(reviews).filter((t) => t.severity !== 'info');
    const created: Alert[] = [];
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();

    for (const trend of trends) {
      const title = `Tendance : ${trend.label}`;
      if (await repo.alerts.existsSince(establishment.id, 'theme_trend', title, since)) continue;

      const alert = await repo.alerts.create({
        id: generateId('alr'),
        establishmentId: establishment.id,
        type: 'theme_trend',
        severity: trend.severity,
        title,
        body: trend.message,
        createdAt: new Date().toISOString(),
      });
      created.push(alert);
      for (const email of await managerEmails(establishment.id)) {
        await notifier.alert(email, establishment, alert);
      }
    }
    return created;
  }

  async function lastReviewDate(
    establishmentId: string,
    platform: PlatformId,
  ): Promise<string | undefined> {
    const recent = await repo.reviews.query({ establishmentId, limit: 200 });
    const onPlatform = recent.filter((r) => r.platform === platform);
    return onPlatform[0]?.publishedAt;
  }

  async function managerEmails(establishmentId: string): Promise<string[]> {
    const managers = await repo.managers.listByEstablishment(establishmentId);
    return managers.map((m) => m.email);
  }

  return {
    ingestEstablishment,
    detectTrends,

    /** Un cycle complet sur tous les établissements actifs. */
    async runOnce(): Promise<IngestReport> {
      const establishments = await repo.establishments.listAll();
      const report: IngestReport = {
        establishments: establishments.length,
        newReviews: 0,
        alertsCreated: 0,
        errors: [],
      };

      for (const establishment of establishments) {
        try {
          const { newReviews, alerts } = await ingestEstablishment(establishment);
          report.newReviews += newReviews.length;
          report.alertsCreated += alerts.length;
        } catch (error) {
          report.errors.push(`${establishment.name}: ${(error as Error).message}`);
        }
      }

      if (report.newReviews > 0) {
        logger.info(
          `Ingestion : ${report.newReviews} nouvel(s) avis, ${report.alertsCreated} alerte(s).`,
        );
      }
      return report;
    },

    /** Passe quotidienne : tendances thématiques. */
    async runDaily(): Promise<number> {
      const establishments = await repo.establishments.listAll();
      let count = 0;
      for (const establishment of establishments) {
        try {
          count += (await detectTrends(establishment)).length;
        } catch (error) {
          logger.warn(`Tendances ${establishment.name} : ${(error as Error).message}`);
        }
      }
      return count;
    },
  };
}
