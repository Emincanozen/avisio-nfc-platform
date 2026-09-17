/**
 * Métriques et règles de traitement des avis.
 *
 * Aucun avis n'est masqué : les fonctions ci-dessous classent, mesurent et
 * déclenchent des alertes internes sur des avis DÉJÀ publiés sur la plateforme.
 */

import type { Review, ReviewStatus } from './types.js';

/** Seuil de déclenchement d'une alerte « avis négatif ». */
export const NEGATIVE_RATING_THRESHOLD = 3;

/** Délai de réponse au-delà duquel l'avis est considéré comme en retard. */
export const REPLY_SLA_HOURS = 24;

export type ReviewBucket = 'negative' | 'neutral' | 'positive';

export function bucketOf(rating: number): ReviewBucket {
  if (rating <= NEGATIVE_RATING_THRESHOLD - 1) return 'negative';
  if (rating === NEGATIVE_RATING_THRESHOLD) return 'neutral';
  return 'positive';
}

/** Un avis 1-3 étoiles déclenche une alerte ; rien n'est bloqué ni masqué. */
export function shouldAlert(review: Pick<Review, 'rating'>): boolean {
  return review.rating <= NEGATIVE_RATING_THRESHOLD;
}

export interface ReviewMetrics {
  total: number;
  averageRating: number;
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
  negativeCount: number;
  /** Part des avis négatifs ayant reçu une réponse publiée. */
  negativeReplyRate: number;
  /** Part de tous les avis ayant reçu une réponse publiée. */
  replyRate: number;
  /** Délai médian de réponse, en heures (null si aucune réponse). */
  medianReplyDelayHours: number | null;
  /** Avis négatifs sans réponse au-delà du SLA. */
  overdueCount: number;
}

export function computeMetrics(reviews: Review[], now = new Date()): ReviewMetrics {
  const distribution: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let ratingSum = 0;
  let negativeCount = 0;
  let negativeAnswered = 0;
  let answered = 0;
  let overdueCount = 0;
  const delays: number[] = [];

  for (const review of reviews) {
    const rating = clampRating(review.rating);
    distribution[rating] += 1;
    ratingSum += rating;

    const isAnswered = review.status === 'answered' && Boolean(review.repliedAt);
    if (isAnswered) {
      answered += 1;
      delays.push(hoursBetween(review.publishedAt, review.repliedAt!));
    }

    if (shouldAlert(review)) {
      negativeCount += 1;
      if (isAnswered) negativeAnswered += 1;
      else if (hoursBetween(review.publishedAt, now.toISOString()) > REPLY_SLA_HOURS) {
        overdueCount += 1;
      }
    }
  }

  const total = reviews.length;
  return {
    total,
    averageRating: total === 0 ? 0 : round(ratingSum / total, 2),
    distribution,
    negativeCount,
    negativeReplyRate: negativeCount === 0 ? 1 : round(negativeAnswered / negativeCount, 3),
    replyRate: total === 0 ? 0 : round(answered / total, 3),
    medianReplyDelayHours: delays.length === 0 ? null : round(median(delays), 1),
    overdueCount,
  };
}

/** Évolution de la note moyenne entre deux fenêtres glissantes. */
export function ratingTrend(
  reviews: Review[],
  now = new Date(),
  windowDays = 30,
): { current: number; previous: number; delta: number } {
  const ms = windowDays * 24 * 3600 * 1000;
  const start = now.getTime() - ms;
  const previousStart = start - ms;

  const current = reviews.filter((r) => at(r.publishedAt) >= start);
  const previous = reviews.filter(
    (r) => at(r.publishedAt) >= previousStart && at(r.publishedAt) < start,
  );

  const avg = (list: Review[]): number =>
    list.length === 0 ? 0 : round(list.reduce((a, r) => a + r.rating, 0) / list.length, 2);

  const c = avg(current);
  const p = avg(previous);
  return { current: c, previous: p, delta: round(c - p, 2) };
}

/** Transition d'état autorisée pour un avis. */
export function nextStatus(current: ReviewStatus, action: 'draft' | 'publish' | 'ignore'): ReviewStatus {
  switch (action) {
    case 'draft':
      return current === 'answered' ? 'answered' : 'draft_ready';
    case 'publish':
      return 'answered';
    case 'ignore':
      return current === 'answered' ? 'answered' : 'ignored';
  }
}

const clampRating = (rating: number): 1 | 2 | 3 | 4 | 5 =>
  Math.min(5, Math.max(1, Math.round(rating))) as 1 | 2 | 3 | 4 | 5;

const at = (iso: string): number => new Date(iso).getTime();

const hoursBetween = (from: string, to: string): number =>
  Math.max(0, (at(to) - at(from)) / 3_600_000);

const round = (value: number, digits: number): number =>
  Number(value.toFixed(digits));

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}
