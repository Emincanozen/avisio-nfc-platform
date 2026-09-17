import { describe, expect, it } from 'vitest';
import { bucketOf, computeMetrics, nextStatus, ratingTrend, shouldAlert } from '../src/reviews.js';
import type { Review } from '../src/types.js';

const NOW = new Date('2026-09-17T12:00:00.000Z');

const review = (overrides: Partial<Review> & { rating: number }): Review => ({
  id: `rev_${Math.random().toString(36).slice(2)}`,
  establishmentId: 'est_1',
  platform: 'google',
  externalId: 'g1',
  author: 'Client',
  comment: 'Commentaire',
  publishedAt: NOW.toISOString(),
  ingestedAt: NOW.toISOString(),
  status: 'new',
  ...overrides,
});

const daysAgo = (days: number): string =>
  new Date(NOW.getTime() - days * 86_400_000).toISOString();

describe('classement', () => {
  it('classe les notes', () => {
    expect(bucketOf(1)).toBe('negative');
    expect(bucketOf(2)).toBe('negative');
    expect(bucketOf(3)).toBe('neutral');
    expect(bucketOf(4)).toBe('positive');
  });

  it('alerte de 1 à 3 étoiles inclus', () => {
    expect(shouldAlert({ rating: 3 })).toBe(true);
    expect(shouldAlert({ rating: 4 })).toBe(false);
  });
});

describe('computeMetrics', () => {
  it('renvoie des métriques neutres sur un jeu vide', () => {
    const m = computeMetrics([], NOW);
    expect(m.total).toBe(0);
    expect(m.averageRating).toBe(0);
    expect(m.medianReplyDelayHours).toBeNull();
    expect(m.negativeReplyRate).toBe(1);
  });

  it('calcule moyenne, distribution et taux de réponse', () => {
    const reviews = [
      review({ rating: 5 }),
      review({ rating: 4 }),
      review({
        rating: 2,
        status: 'answered',
        publishedAt: daysAgo(3),
        repliedAt: new Date(NOW.getTime() - 2 * 86_400_000).toISOString(),
      }),
    ];
    const m = computeMetrics(reviews, NOW);
    expect(m.total).toBe(3);
    expect(m.averageRating).toBeCloseTo(3.67, 2);
    expect(m.distribution[5]).toBe(1);
    expect(m.negativeCount).toBe(1);
    expect(m.negativeReplyRate).toBe(1);
    expect(m.replyRate).toBeCloseTo(0.333, 3);
    expect(m.medianReplyDelayHours).toBe(24);
  });

  it('compte les avis négatifs hors SLA', () => {
    const m = computeMetrics([review({ rating: 1, publishedAt: daysAgo(4) })], NOW);
    expect(m.overdueCount).toBe(1);
    expect(m.negativeReplyRate).toBe(0);
  });

  it('ne compte pas hors SLA un avis récent', () => {
    const m = computeMetrics(
      [review({ rating: 1, publishedAt: new Date(NOW.getTime() - 3_600_000).toISOString() })],
      NOW,
    );
    expect(m.overdueCount).toBe(0);
  });
});

describe('ratingTrend', () => {
  it('compare deux fenêtres glissantes', () => {
    const reviews = [
      review({ rating: 5, publishedAt: daysAgo(2) }),
      review({ rating: 5, publishedAt: daysAgo(10) }),
      review({ rating: 3, publishedAt: daysAgo(40) }),
      review({ rating: 3, publishedAt: daysAgo(50) }),
    ];
    const trend = ratingTrend(reviews, NOW, 30);
    expect(trend.current).toBe(5);
    expect(trend.previous).toBe(3);
    expect(trend.delta).toBe(2);
  });
});

describe('nextStatus', () => {
  it('ne revient jamais en arrière une fois répondu', () => {
    expect(nextStatus('answered', 'draft')).toBe('answered');
    expect(nextStatus('answered', 'ignore')).toBe('answered');
  });

  it('suit le cycle nominal', () => {
    expect(nextStatus('new', 'draft')).toBe('draft_ready');
    expect(nextStatus('draft_ready', 'publish')).toBe('answered');
    expect(nextStatus('new', 'ignore')).toBe('ignored');
  });
});
