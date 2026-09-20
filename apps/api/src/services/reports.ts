/**
 * Rapport mensuel de réputation.
 *
 * Envoyé le 1er de chaque mois aux établissements dont l'offre comprend les
 * analyses avancées. C'est la preuve de valeur qui arrive sans qu'on la
 * demande — et, d'après le plan de rétention, le levier le plus efficace
 * contre l'attrition après l'usage hebdomadaire du tableau de bord.
 */

import {
  resolveEntitlements,
  hasEntitlement,
  PLATFORM_LABELS,
  buildHighlights,
  computeMetrics,
  previousMonthPeriod,
  ratingTrend,
  renderReportHtml,
  type MonthlyReport,
  type ReportPeriod,
} from '@avisio/core';
import type { Repository } from '../repository/index.js';
import { themeBreakdown } from './analytics.js';
import type { Notifier } from './notify.js';

interface Deps {
  repo: Repository;
  notifier: Notifier;
  logger: { info: (msg: string) => void; warn: (msg: string) => void };
}

export function createReportService({ repo, notifier, logger }: Deps) {
  /** Construit le rapport d'un établissement pour une période donnée. */
  async function build(
    establishmentId: string,
    period: ReportPeriod = previousMonthPeriod(),
  ): Promise<MonthlyReport> {
    const establishment = await repo.establishments.findById(establishmentId);
    if (!establishment) throw new Error('Établissement introuvable.');

    const [allReviews, links, scans, loyaltyMembers] = await Promise.all([
      repo.reviews.query({ establishmentId, limit: 1000 }),
      repo.platformLinks.listByEstablishment(establishmentId),
      repo.scans.listByEstablishment(establishmentId, period.start),
      repo.loyalty.countByEstablishment(establishmentId),
    ]);

    const start = new Date(period.start).getTime();
    const end = new Date(period.end).getTime();
    const inPeriod = allReviews.filter((review) => {
      const at = new Date(review.publishedAt).getTime();
      return at >= start && at < end;
    });

    // Mois précédent, pour les écarts affichés en tête de rapport.
    const previousStart = new Date(
      Date.UTC(new Date(period.start).getUTCFullYear(), new Date(period.start).getUTCMonth() - 1, 1),
    ).getTime();
    const previous = allReviews.filter((review) => {
      const at = new Date(review.publishedAt).getTime();
      return at >= previousStart && at < start;
    });

    const metrics = computeMetrics(inPeriod, new Date(period.end));
    const trend = ratingTrend(allReviews, new Date(period.end), 30);
    const scansInPeriod = scans.filter((scan) => {
      const at = new Date(scan.createdAt).getTime();
      return at >= start && at < end;
    });

    const totalPresence = links.reduce((acc, link) => acc + link.reviewCount, 0);

    // Sans avis le mois précédent, il n'y a pas d'écart à afficher : annoncer
    // « +4,33 » contre une base vide serait une progression imaginaire.
    const hasBaseline = previous.length > 0;

    const base = {
      establishmentName: establishment.name,
      period,
      averageRating: metrics.averageRating,
      ratingDelta: hasBaseline ? trend.delta : null,
      reviewCount: inPeriod.length,
      reviewCountDelta: hasBaseline ? inPeriod.length - previous.length : null,
      negativeCount: metrics.negativeCount,
      replyRate: metrics.replyRate,
      medianReplyDelayHours: metrics.medianReplyDelayHours,
      scans: scansInPeriod.length,
      scanToReviewRate:
        scansInPeriod.length === 0
          ? null
          : Number((inPeriod.length / scansInPeriod.length).toFixed(3)),
      loyaltyMembers,
      topThemes: themeBreakdown(inPeriod)
        .slice(0, 5)
        .map((theme) => ({
          theme: theme.theme,
          label: theme.label,
          mentions: theme.mentions,
          averageRating: theme.averageRating,
        })),
      platforms: links
        .map((link) => ({
          label: PLATFORM_LABELS[link.platform],
          reviewCount: link.reviewCount,
          share: totalPresence === 0 ? 0 : (link.reviewCount / totalPresence) * 100,
        }))
        .sort((a, b) => b.reviewCount - a.reviewCount),
    };

    return { ...base, highlights: buildHighlights(base) };
  }

  return {
    build,
    renderHtml: renderReportHtml,

    /**
     * Envoi mensuel. Ne s'adresse qu'aux offres qui comprennent les analyses
     * avancées : envoyer un rapport à un client Essentiel reviendrait à lui
     * livrer gratuitement l'argument de la montée en gamme.
     */
    async runMonthly(period: ReportPeriod = previousMonthPeriod()): Promise<{
      sent: number;
      skipped: number;
      errors: string[];
    }> {
      const establishments = await repo.establishments.listAll();
      const result = { sent: 0, skipped: 0, errors: [] as string[] };

      for (const establishment of establishments) {
        const droits = resolveEntitlements(
          await repo.subscriptions.findByEstablishment(establishment.id),
          establishment,
        );
        if (!hasEntitlement(droits, 'analytics_advanced')) {
          result.skipped += 1;
          continue;
        }
        try {
          const report = await build(establishment.id, period);
          const html = renderReportHtml(report);
          for (const manager of await repo.managers.listByEstablishment(establishment.id)) {
            await notifier.monthlyReport(manager.email, establishment, html);
          }
          result.sent += 1;
        } catch (error) {
          result.errors.push(`${establishment.name}: ${(error as Error).message}`);
        }
      }

      if (result.sent > 0) logger.info(`Rapports mensuels : ${result.sent} envoyé(s).`);
      return result;
    },
  };
}
