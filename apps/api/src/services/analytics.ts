/**
 * Agrégation des indicateurs du tableau de bord.
 *
 * Tout est recalculé à la demande sur la fenêtre demandée. À l'échelle visée
 * (quelques centaines d'avis par établissement), c'est plus simple et plus
 * juste qu'un cache à invalider. Le passage à des tables de reporting
 * pré-agrégées est documenté dans `docs/architecture.md` — il devient utile
 * au-delà de ~2 000 établissements.
 */

import {
  PLATFORM_LABELS,
  THEME_LABELS,
  computeBenchmark,
  computeMetrics,
  detectThemeTrends,
  ratingTrend,
  type BenchmarkResult,
  type PeerSnapshot,
  type PlatformId,
  type Review,
  type ThemeId,
} from '@avisio/core';
import type { Repository } from '../repository/index.js';

export interface ThemeBreakdown {
  theme: ThemeId;
  label: string;
  mentions: number;
  share: number;
  averageRating: number;
  sentiment: 'positive' | 'neutral' | 'negative';
}

export interface PlatformBreakdown {
  platform: PlatformId;
  label: string;
  reviewCount: number;
  averageRating: number | null;
  routedScans: number;
  /** Part de la présence totale, en pourcentage. */
  share: number;
}

export interface DashboardOverview {
  establishmentId: string;
  windowDays: number;
  metrics: ReturnType<typeof computeMetrics>;
  rating: ReturnType<typeof ratingTrend>;
  themes: ThemeBreakdown[];
  platforms: PlatformBreakdown[];
  trends: ReturnType<typeof detectThemeTrends>;
  scans: { total: number; byDay: Array<{ date: string; count: number }> };
  loyaltyMembers: number;
  /** Taux de conversion scan -> avis publié, indicateur clé du terrain. */
  scanToReviewRate: number | null;
}

export function createAnalyticsService(repo: Repository) {
  async function overview(
    establishmentId: string,
    windowDays = 30,
  ): Promise<DashboardOverview> {
    const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();
    const [windowed, all, links, scans, loyaltyMembers] = await Promise.all([
      repo.reviews.query({ establishmentId, since, limit: 500 }),
      repo.reviews.query({ establishmentId, limit: 1000 }),
      repo.platformLinks.listByEstablishment(establishmentId),
      repo.scans.listByEstablishment(establishmentId, since),
      repo.loyalty.countByEstablishment(establishmentId),
    ]);

    const totalPresence = links.reduce((acc, l) => acc + l.reviewCount, 0);

    return {
      establishmentId,
      windowDays,
      metrics: computeMetrics(windowed),
      rating: ratingTrend(all, new Date(), windowDays),
      themes: themeBreakdown(windowed),
      platforms: links
        .map((link) => ({
          platform: link.platform,
          label: PLATFORM_LABELS[link.platform],
          reviewCount: link.reviewCount,
          averageRating: link.averageRating ?? null,
          routedScans: link.routedScans,
          share: totalPresence === 0 ? 0 : round((link.reviewCount / totalPresence) * 100, 1),
        }))
        .sort((a, b) => b.reviewCount - a.reviewCount),
      trends: detectThemeTrends(all),
      scans: {
        total: scans.length,
        byDay: groupByDay(scans.map((s) => s.createdAt), windowDays),
      },
      loyaltyMembers,
      scanToReviewRate:
        scans.length === 0 ? null : round(windowed.length / scans.length, 3),
    };
  }

  /**
   * Benchmark sectoriel. Les pairs sont construits à la volée à partir de la
   * base complète, puis anonymisés par `computeBenchmark` (k-anonymat).
   */
  async function benchmark(establishmentId: string): Promise<BenchmarkResult> {
    const [establishments, reviews] = await Promise.all([
      repo.establishments.listAll(),
      repo.reviews.listAll(),
    ]);

    const since = Date.now() - 30 * 86_400_000;
    const snapshots: PeerSnapshot[] = establishments.map((establishment) => {
      const own = reviews.filter((r) => r.establishmentId === establishment.id);
      const recent = own.filter((r) => new Date(r.publishedAt).getTime() >= since);
      const metrics = computeMetrics(own);
      return {
        establishmentId: establishment.id,
        sector: establishment.sector,
        ...(establishment.nafCode ? { nafCode: establishment.nafCode } : {}),
        postalCode: establishment.postalCode,
        averageRating: metrics.averageRating,
        reviewsLast30Days: recent.length,
        replyRate: metrics.replyRate,
      };
    });

    const self = snapshots.find((s) => s.establishmentId === establishmentId);
    if (!self) throw new Error(`Établissement inconnu : ${establishmentId}`);
    return computeBenchmark(self, snapshots);
  }

  return { overview, benchmark };
}

export function themeBreakdown(reviews: Review[]): ThemeBreakdown[] {
  const analysed = reviews.filter((r) => r.analysis);
  if (analysed.length === 0) return [];

  const buckets = new Map<ThemeId, { mentions: number; ratingSum: number }>();
  for (const review of analysed) {
    for (const theme of review.analysis!.themes) {
      const bucket = buckets.get(theme) ?? { mentions: 0, ratingSum: 0 };
      bucket.mentions += 1;
      bucket.ratingSum += review.rating;
      buckets.set(theme, bucket);
    }
  }

  return [...buckets.entries()]
    .map(([theme, bucket]) => {
      const averageRating = bucket.ratingSum / bucket.mentions;
      return {
        theme,
        label: THEME_LABELS[theme],
        mentions: bucket.mentions,
        share: round(bucket.mentions / analysed.length, 3),
        averageRating: round(averageRating, 2),
        sentiment:
          averageRating >= 4 ? ('positive' as const)
          : averageRating >= 3 ? ('neutral' as const)
          : ('negative' as const),
      };
    })
    .sort((a, b) => b.mentions - a.mentions);
}

function groupByDay(
  timestamps: string[],
  windowDays: number,
): Array<{ date: string; count: number }> {
  const counts = new Map<string, number>();
  for (const iso of timestamps) {
    const day = iso.slice(0, 10);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  // Les jours sans scan doivent apparaître à zéro, sinon la courbe ment.
  const days: Array<{ date: string; count: number }> = [];
  for (let i = windowDays - 1; i >= 0; i -= 1) {
    const date = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    days.push({ date, count: counts.get(date) ?? 0 });
  }
  return days;
}

const round = (value: number, digits: number): number => Number(value.toFixed(digits));
