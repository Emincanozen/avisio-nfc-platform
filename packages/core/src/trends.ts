/**
 * Détection de tendance sur les thèmes d'avis.
 *
 * Comparaison glissante 7 j contre les 23 jours précédents : un thème dont la
 * fréquence récente dépasse nettement sa fréquence de fond déclenche une
 * alerte.
 *
 * Point d'implémentation qui compte : la période de référence EXCLUT la
 * fenêtre courte. Comparer 7 jours à un mois qui les contient écrase
 * mécaniquement le ratio — une semaine catastrophique noyée dans son propre
 * mois de référence ne déclenche jamais rien.
 *
 * Deux garde-fous contre le bruit : un minimum de mentions récentes (deux avis
 * ne font pas une tendance) et un minimum d'avis dans la période de référence,
 * sans quoi il n'y a pas de fond de comparaison — seulement un établissement
 * qui démarre.
 */

import { fr } from './format.js';
import type { Review, ThemeId } from './types.js';
import { THEME_LABELS } from './nlp.js';

export interface TrendOptions {
  shortWindowDays: number;
  longWindowDays: number;
  /** Mentions minimales sur la fenêtre courte pour envisager une alerte. */
  minMentions: number;
  /** Avis minimaux dans la période de référence pour qu'elle fasse foi. */
  minBaselineReviews: number;
  /** Rapport de fréquence déclenchant l'alerte (2 = deux fois plus fréquent). */
  ratioThreshold: number;
}

export const DEFAULT_TREND_OPTIONS: TrendOptions = {
  shortWindowDays: 7,
  longWindowDays: 30,
  minMentions: 3,
  minBaselineReviews: 5,
  ratioThreshold: 1.8,
};

export interface ThemeTrend {
  theme: ThemeId;
  label: string;
  shortWindowMentions: number;
  shortWindowShare: number;
  /** Fréquence du thème sur la période de référence (hors fenêtre courte). */
  baselineShare: number;
  /**
   * Rapport fenêtre courte / référence. Vaut 99 quand le thème était absent de
   * la période de référence : l'infini n'est pas sérialisable en JSON, et cette
   * valeur signale un thème entièrement nouveau.
   */
  ratio: number;
  /** Note moyenne des avis récents mentionnant le thème. */
  averageRating: number;
  severity: 'info' | 'warning' | 'critical';
  message: string;
}

export function detectThemeTrends(
  reviews: Review[],
  now = new Date(),
  options: Partial<TrendOptions> = {},
): ThemeTrend[] {
  const opts = { ...DEFAULT_TREND_OPTIONS, ...options };
  const nowMs = now.getTime();
  const shortStart = nowMs - opts.shortWindowDays * 86_400_000;
  const longStart = nowMs - opts.longWindowDays * 86_400_000;

  const analysed = reviews.filter((r) => r.analysis);
  const shortWindow = analysed.filter((r) => at(r.publishedAt) >= shortStart);
  const baseline = analysed.filter(
    (r) => at(r.publishedAt) >= longStart && at(r.publishedAt) < shortStart,
  );

  if (shortWindow.length === 0) return [];
  if (baseline.length < opts.minBaselineReviews) return [];

  const shortCounts = countThemes(shortWindow);
  const baselineCounts = countThemes(baseline);
  const trends: ThemeTrend[] = [];

  for (const [theme, mentions] of shortCounts) {
    if (mentions < opts.minMentions) continue;

    const shortShare = mentions / shortWindow.length;
    const baselineShare = (baselineCounts.get(theme) ?? 0) / baseline.length;
    const ratio = baselineShare === 0 ? Number.POSITIVE_INFINITY : shortShare / baselineShare;
    if (ratio < opts.ratioThreshold) continue;

    const themed = shortWindow.filter((r) => r.analysis!.themes.includes(theme));
    const averageRating =
      themed.reduce((acc, r) => acc + r.rating, 0) / Math.max(1, themed.length);

    // Une tendance sur un thème bien noté n'est pas un problème : on l'affiche
    // en information, elle nourrit le dashboard sans réveiller le gérant.
    const severity: ThemeTrend['severity'] =
      averageRating <= 2.5 ? 'critical' : averageRating <= 3.5 ? 'warning' : 'info';

    trends.push({
      theme,
      label: THEME_LABELS[theme],
      shortWindowMentions: mentions,
      shortWindowShare: round(shortShare, 3),
      baselineShare: round(baselineShare, 3),
      ratio: Number.isFinite(ratio) ? round(ratio, 2) : 99,
      averageRating: round(averageRating, 2),
      severity,
      message: buildMessage(theme, mentions, opts.shortWindowDays, averageRating),
    });
  }

  return trends.sort(bySeverityThenRatio);
}

function buildMessage(
  theme: ThemeId,
  mentions: number,
  days: number,
  averageRating: number,
): string {
  const label = THEME_LABELS[theme].toLowerCase();
  if (averageRating <= 3.5) {
    return `${mentions} avis des ${days} derniers jours citent « ${label} » avec une note moyenne de ${fr(averageRating, 1)}/5. Le sujet monte nettement par rapport aux semaines précédentes.`;
  }
  return `« ${label} » revient dans ${mentions} avis sur ${days} jours, avec une note moyenne favorable (${fr(averageRating, 1)}/5) : un point fort à mettre en avant.`;
}

function countThemes(reviews: Review[]): Map<ThemeId, number> {
  const counts = new Map<ThemeId, number>();
  for (const review of reviews) {
    for (const theme of review.analysis?.themes ?? []) {
      if (theme === 'autre') continue;
      counts.set(theme, (counts.get(theme) ?? 0) + 1);
    }
  }
  return counts;
}

const SEVERITY_ORDER: Record<ThemeTrend['severity'], number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

const bySeverityThenRatio = (a: ThemeTrend, b: ThemeTrend): number =>
  SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.ratio - a.ratio;

const at = (iso: string): number => new Date(iso).getTime();
const round = (value: number, digits: number): number => Number(value.toFixed(digits));
