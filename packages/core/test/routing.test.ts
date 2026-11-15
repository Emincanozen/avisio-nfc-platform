import { describe, expect, it } from 'vitest';
import {
  NoRoutablePlatformError,
  selectPlatform,
  simulateRouting,
} from '../src/routing.js';
import type { PlatformId, PlatformLink } from '../src/types.js';

const link = (
  platform: PlatformId,
  reviewCount: number,
  routedScans = 0,
  enabled = true,
): PlatformLink => ({
  establishmentId: 'est_1',
  platform,
  reviewUrl: `https://example.test/${platform}`,
  enabled,
  reviewCount,
  routedScans,
});

describe('selectPlatform', () => {
  it('refuse de router sans plateforme active', () => {
    expect(() => selectPlatform([link('google', 10, 0, false)], 'restaurant')).toThrow(
      NoRoutablePlatformError,
    );
  });

  it('route vers l’unique plateforme active', () => {
    const decision = selectPlatform([link('google', 120)], 'restaurant');
    expect(decision.platform).toBe('google');
    expect(decision.reviewUrl).toBe('https://example.test/google');
  });

  it('amorce sur la plateforme prioritaire du secteur quand tout est à zéro', () => {
    const decision = selectPlatform(
      [link('tripadvisor', 0), link('google', 0), link('thefork', 0)],
      'restaurant',
    );
    expect(decision.platform).toBe('google');
  });

  it('privilégie la plateforme la plus en déficit de présence', () => {
    // Google sur-représenté (300 avis) vs TripAdvisor quasi absent.
    const decision = selectPlatform(
      [link('google', 300), link('tripadvisor', 5)],
      'restaurant',
    );
    expect(decision.platform).toBe('tripadvisor');
    expect(decision.deficit).toBeGreaterThan(0);
  });

  it('tient compte des scans déjà routés entre deux synchronisations', () => {
    const links = [link('google', 100), link('tripadvisor', 30, 0)];
    const first = selectPlatform(links, 'restaurant');
    expect(first.platform).toBe('tripadvisor');

    // 80 scans déjà envoyés sur TripAdvisor : le déficit s'inverse.
    const after = selectPlatform([link('google', 100), link('tripadvisor', 30, 80)], 'restaurant');
    expect(after.platform).toBe('google');
  });

  it('respecte le quota de plateformes de l’offre', () => {
    const links = [link('google', 500), link('tripadvisor', 0), link('yelp', 0)];
    const decision = selectPlatform(links, 'restaurant', { quota: 1 });
    expect(decision.platform).toBe('google');
  });

  it('ne prend aucune décision à partir d’une note client', () => {
    // Garde-fou : la signature n'accepte pas de note. Le test documente
    // l'intention — si quelqu'un ajoute un paramètre de note, il casse ici.
    expect(selectPlatform.length).toBeLessThanOrEqual(3);
  });
});

describe('simulateRouting', () => {
  it('converge vers les parts cibles du secteur', () => {
    const links = [link('google', 0), link('tripadvisor', 0), link('thefork', 0)];
    const tally = simulateRouting(links, 'restaurant', 1000);
    const total = Object.values(tally).reduce((a, b) => a + b, 0);
    expect(total).toBe(1000);

    // Cibles restaurant renormalisées sur ces 3 plateformes :
    // google 0.55/0.88 ≈ 62 %, tripadvisor 0.18/0.88 ≈ 20 %, thefork ≈ 17 %
    expect(tally.google! / total).toBeGreaterThan(0.58);
    expect(tally.google! / total).toBeLessThan(0.66);
    expect(tally.tripadvisor! / total).toBeGreaterThan(0.16);
    expect(tally.thefork! / total).toBeGreaterThan(0.13);
  });

  it('rattrape un déséquilibre historique', () => {
    const links = [link('google', 400), link('tripadvisor', 10)];
    const tally = simulateRouting(links, 'hotel', 200);
    // Hôtel : cible TripAdvisor 35 % vs présence réelle 2 % -> rattrapage massif.
    expect(tally.tripadvisor!).toBeGreaterThan(tally.google ?? 0);
  });
});
