import { describe, expect, it } from 'vitest';
import { PLANS, entitlements, hasFeature, platformQuota, quote } from '../src/pricing.js';

describe('quote', () => {
  it('facture l’abonnement seul quand tout est inclus', () => {
    const q = quote({ plan: 'essentiel', addons: [], tags: 1, committed12Months: true });
    expect(q.monthlyCentsExclVat).toBe(2900);
    expect(q.oneOffCentsExclVat).toBe(0);
    expect(q.lines).toHaveLength(1);
  });

  it('ajoute les frais de mise en service sans engagement', () => {
    const q = quote({ plan: 'essentiel', addons: [], tags: 1, committed12Months: false });
    expect(q.oneOffCentsExclVat).toBe(4900);
    expect(q.lines.some((l) => l.label.includes('Mise en service'))).toBe(true);
  });

  it('facture les plaquettes au-delà du quota de l’offre', () => {
    const q = quote({ plan: 'pro', addons: [], tags: 5, committed12Months: true });
    const line = q.lines.find((l) => l.label.includes('supplémentaire'));
    expect(line?.quantity).toBe(2);
    expect(line?.totalCents).toBe(3000);
  });

  it('ne refacture pas un add-on déjà compris dans l’offre', () => {
    const q = quote({
      plan: 'premium',
      addons: ['negative_reviews', 'analytics', 'loyalty'],
      tags: 5,
      committed12Months: true,
    });
    expect(q.monthlyCentsExclVat).toBe(14900);
    expect(q.redundantAddons).toEqual(['negative_reviews', 'analytics', 'loyalty']);
  });

  it('déduit les plateformes incluses avant de facturer les supplémentaires', () => {
    const pro = quote({ plan: 'pro', addons: [], tags: 3, extraPlatforms: 3, committed12Months: true });
    const line = pro.lines.find((l) => l.label === 'Plateforme supplémentaire');
    expect(line?.quantity).toBe(2); // 3 demandées - 1 incluse dans Pro
    expect(pro.monthlyCentsExclVat).toBe(7900 + 3000);
  });

  it('n’applique aucun surcoût plateforme sur Premium (illimité)', () => {
    const q = quote({ plan: 'premium', addons: [], tags: 5, extraPlatforms: 4, committed12Months: true });
    expect(q.lines.some((l) => l.label === 'Plateforme supplémentaire')).toBe(false);
  });

  it('calcule la TVA et la première facture', () => {
    const q = quote({ plan: 'pro', addons: ['loyalty'], tags: 4, committed12Months: false });
    expect(q.monthlyCentsExclVat).toBe(7900 + 1200);
    expect(q.oneOffCentsExclVat).toBe(1500 + 4900);
    expect(q.monthlyCentsInclVat).toBe(Math.round(9100 * 1.2));
    expect(q.firstInvoiceCentsInclVat).toBe(Math.round((9100 + 6400) * 1.2));
  });

  it('dédoublonne les add-ons demandés deux fois', () => {
    const q = quote({ plan: 'essentiel', addons: ['loyalty', 'loyalty'], tags: 1, committed12Months: true });
    expect(q.lines.filter((l) => l.label === 'Module fidélité')).toHaveLength(1);
  });
});

describe('droits', () => {
  it('cumule les fonctionnalités de l’offre et des add-ons', () => {
    expect(hasFeature('essentiel', [], 'ai_reply_suggestions')).toBe(false);
    expect(hasFeature('essentiel', ['negative_reviews'], 'ai_reply_suggestions')).toBe(true);
  });

  it('expose le benchmark seulement avec analytics ou Premium', () => {
    expect(hasFeature('pro', [], 'competitive_benchmark')).toBe(false);
    expect(hasFeature('pro', ['analytics'], 'competitive_benchmark')).toBe(true);
    expect(hasFeature('premium', [], 'competitive_benchmark')).toBe(true);
  });

  it('calcule le quota de plateformes', () => {
    expect(platformQuota('essentiel', [])).toBe(1);
    expect(platformQuota('pro', [])).toBe(2);
    expect(platformQuota('pro', ['extra_platform'], 2)).toBe(4);
    expect(platformQuota('premium', [])).toBe(Number.POSITIVE_INFINITY);
  });

  it('garde les offres ordonnées par prix croissant', () => {
    expect(PLANS.essentiel.monthlyCents).toBeLessThan(PLANS.pro.monthlyCents);
    expect(PLANS.pro.monthlyCents).toBeLessThan(PLANS.premium.monthlyCents);
  });

  it('inclut tous les droits de Pro dans Premium', () => {
    const pro = entitlements('pro', []);
    const premium = entitlements('premium', []);
    for (const feature of pro) expect(premium.has(feature)).toBe(true);
  });
});
