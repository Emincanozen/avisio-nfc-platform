import { describe, expect, it } from 'vitest';
import { detectThemeTrends } from '../src/trends.js';
import { NotEnoughPeersError, computeBenchmark, percentile } from '../src/benchmark.js';
import type { PeerSnapshot } from '../src/benchmark.js';
import type { Review, ThemeId } from '../src/types.js';

const NOW = new Date('2026-09-17T12:00:00.000Z');
const daysAgo = (d: number): string => new Date(NOW.getTime() - d * 86_400_000).toISOString();

const review = (rating: number, themes: ThemeId[], days: number): Review => ({
  id: `rev_${Math.random().toString(36).slice(2)}`,
  establishmentId: 'est_1',
  platform: 'google',
  externalId: 'x',
  author: 'Client',
  rating,
  comment: '...',
  publishedAt: daysAgo(days),
  ingestedAt: daysAgo(days),
  status: 'new',
  analysis: {
    sentiment: rating <= 2 ? 'negative' : 'positive',
    score: rating <= 2 ? -0.7 : 0.7,
    themes,
    keywords: [],
    language: 'fr',
    engine: 'heuristic',
  },
});

describe('detectThemeTrends', () => {
  it('ne signale rien sans avis', () => {
    expect(detectThemeTrends([], NOW)).toEqual([]);
  });

  it('exige un nombre minimum de mentions', () => {
    const reviews = [review(1, ['attente'], 1), review(1, ['attente'], 2)];
    expect(detectThemeTrends(reviews, NOW)).toEqual([]);
  });

  it('détecte une montée du thème attente et la classe critique', () => {
    const reviews = [
      // Fond de 30 jours : surtout de la qualité produit bien notée.
      ...Array.from({ length: 12 }, (_, i) => review(5, ['qualite_produit'], 12 + i)),
      // Semaine écoulée : l'attente explose.
      review(1, ['attente'], 1),
      review(2, ['attente'], 2),
      review(1, ['attente'], 3),
      review(2, ['attente'], 5),
    ];
    const trends = detectThemeTrends(reviews, NOW);
    const attente = trends.find((t) => t.theme === 'attente');
    expect(attente).toBeDefined();
    expect(attente!.shortWindowMentions).toBe(4);
    expect(attente!.severity).toBe('critical');
    expect(attente!.message).toContain('attente');
  });

  it('compare à la période précédente, pas à une fenêtre qui contient la semaine', () => {
    // Régression : avec une référence 30 j incluant les 7 derniers jours, une
    // semaine entièrement consacrée à un thème plafonne à un ratio d'environ
    // 1,4 et ne déclenche jamais l'alerte. La référence doit exclure la
    // fenêtre courte.
    const reviews = [
      ...Array.from({ length: 6 }, (_, i) => review(5, ['qualite_produit'], 10 + i)),
      review(1, ['attente'], 1),
      review(1, ['attente'], 2),
      review(2, ['attente'], 4),
    ];
    const attente = detectThemeTrends(reviews, NOW).find((t) => t.theme === 'attente');
    expect(attente).toBeDefined();
    expect(attente!.baselineShare).toBe(0);
    expect(attente!.severity).toBe('critical');
  });

  it('ne déclenche rien sans période de référence exploitable', () => {
    // Un établissement qui vient d'être équipé n'a pas de fond de comparaison :
    // trois avis la première semaine ne sont pas une tendance.
    const reviews = [
      review(1, ['attente'], 1),
      review(1, ['attente'], 2),
      review(2, ['attente'], 4),
      review(5, ['accueil'], 20),
    ];
    expect(detectThemeTrends(reviews, NOW)).toEqual([]);
  });

  it('classe en information une tendance sur un thème bien noté', () => {
    const reviews = [
      ...Array.from({ length: 10 }, (_, i) => review(4, ['prix'], 12 + i)),
      review(5, ['accueil'], 1),
      review(5, ['accueil'], 2),
      review(5, ['accueil'], 3),
    ];
    const trends = detectThemeTrends(reviews, NOW);
    expect(trends.find((t) => t.theme === 'accueil')?.severity).toBe('info');
  });

  it('trie les alertes critiques en premier', () => {
    const reviews = [
      ...Array.from({ length: 10 }, (_, i) => review(4, ['prix'], 12 + i)),
      review(5, ['accueil'], 1),
      review(5, ['accueil'], 2),
      review(5, ['accueil'], 3),
      review(1, ['proprete'], 1),
      review(1, ['proprete'], 2),
      review(2, ['proprete'], 4),
    ];
    const trends = detectThemeTrends(reviews, NOW);
    expect(trends[0]?.severity).toBe('critical');
  });
});

describe('percentile', () => {
  it('interpole entre deux valeurs', () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([10], 90)).toBe(10);
    expect(percentile([], 50)).toBe(0);
  });
});

describe('computeBenchmark', () => {
  const peer = (id: string, postalCode: string, rating: number): PeerSnapshot => ({
    establishmentId: id,
    sector: 'restaurant',
    postalCode,
    averageRating: rating,
    reviewsLast30Days: 20,
    replyRate: 0.5,
  });

  const self: PeerSnapshot = {
    establishmentId: 'est_self',
    sector: 'restaurant',
    postalCode: '31000',
    averageRating: 4.4,
    reviewsLast30Days: 32,
    replyRate: 0.8,
  };

  it('refuse le benchmark sous le seuil d’anonymat', () => {
    const population = [peer('a', '31000', 4), peer('b', '31000', 4.2)];
    expect(() => computeBenchmark(self, population)).toThrow(NotEnoughPeersError);
  });

  it('compare à la commune quand le seuil est atteint', () => {
    const population = Array.from({ length: 6 }, (_, i) =>
      peer(`p${i}`, '31000', 3.8 + i * 0.1),
    );
    const result = computeBenchmark(self, population);
    expect(result.scope).toBe('commune');
    expect(result.peerCount).toBe(6);
    expect(result.averageRating.self).toBe(4.4);
    expect(result.ratingPercentile).toBeGreaterThan(50);
    expect(result.summary).toContain('31000');
  });

  it('élargit au département puis au national', () => {
    const departement = Array.from({ length: 6 }, (_, i) => peer(`d${i}`, '31400', 4 + i * 0.05));
    expect(computeBenchmark(self, departement).scope).toBe('departement');

    const national = Array.from({ length: 6 }, (_, i) => peer(`n${i}`, '75008', 4 + i * 0.05));
    expect(computeBenchmark(self, national).scope).toBe('national');
  });

  it('exclut l’établissement demandeur de ses propres pairs', () => {
    const population = [
      { ...self },
      ...Array.from({ length: 5 }, (_, i) => peer(`p${i}`, '31000', 4)),
    ];
    expect(computeBenchmark(self, population).peerCount).toBe(5);
  });

  it('ne renvoie aucune donnée nominative', () => {
    const population = Array.from({ length: 6 }, (_, i) => peer(`p${i}`, '31000', 4));
    const result = computeBenchmark(self, population);
    expect(JSON.stringify(result)).not.toContain('p0');
  });

  it('regroupe par code NAF quand il est renseigné des deux côtés', () => {
    const withNaf: PeerSnapshot = { ...self, nafCode: '5610A' };
    const sameNaf = Array.from({ length: 5 }, (_, i) => ({
      ...peer(`n${i}`, '31000', 4),
      nafCode: '5610A',
    }));
    const otherNaf = Array.from({ length: 5 }, (_, i) => ({
      ...peer(`o${i}`, '31000', 2),
      nafCode: '5630Z',
    }));
    const result = computeBenchmark(withNaf, [...sameNaf, ...otherNaf]);
    expect(result.peerCount).toBe(5);
    expect(result.averageRating.peerMedian).toBe(4);
  });
});
