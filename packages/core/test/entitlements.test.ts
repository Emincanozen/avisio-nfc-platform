/**
 * Droits effectifs.
 *
 * Deux défauts réels sont couverts ici, et le premier était une faille
 * d'intégrité commerciale : les droits lisaient `establishment.plan` pendant
 * que la facturation lisait `subscription.plan`, et la route
 * `PATCH /establishments/:id` laissait le gérant modifier le premier. Passer
 * en Premium sans changer de facture ne produisait aucune erreur — juste le
 * produit gratuitement.
 */

import { describe, expect, it } from 'vitest';
import {
  activeFeatures,
  entitlementDrift,
  hasEntitlement,
  resolveEntitlements,
} from '../src/entitlements.js';
import type { Subscription } from '../src/billing.js';

const abonnement = (over: Partial<Subscription> = {}): Subscription => ({
  id: 'sub_1',
  establishmentId: 'est_1',
  plan: 'essentiel',
  addons: [],
  extraPlatforms: 0,
  tags: 1,
  committed12Months: true,
  status: 'active',
  startedAt: '2026-01-01T00:00:00.000Z',
  currentPeriodStart: '2026-09-01T00:00:00.000Z',
  currentPeriodEnd: '2026-10-01T00:00:00.000Z',
  ...over,
});

describe("l'abonnement fait foi", () => {
  it("ignore une offre gonflée sur l'établissement", () => {
    // LE cas. Le gérant a mis premium sur son établissement ; il paie
    // essentiel. Les droits doivent suivre la facture, pas la déclaration.
    const state = resolveEntitlements(abonnement({ plan: 'essentiel' }), {
      plan: 'premium',
      addons: ['analytics', 'loyalty'],
    });

    expect(state.plan).toBe('essentiel');
    expect(state.addons).toEqual([]);
    expect(state.source).toBe('subscription');
    expect(hasEntitlement(state, 'competitive_benchmark')).toBe(false);
    expect(hasEntitlement(state, 'ai_reply_suggestions')).toBe(false);
  });

  it("n'ampute pas non plus les droits réellement payés", () => {
    // Le symétrique : la garde ne doit pas retirer ce qui est facturé.
    const state = resolveEntitlements(abonnement({ plan: 'premium' }), {
      plan: 'essentiel',
      addons: [],
    });
    expect(state.plan).toBe('premium');
    expect(hasEntitlement(state, 'competitive_benchmark')).toBe(true);
  });

  it("retombe sur l'établissement quand aucun abonnement n'existe", () => {
    // Établissement créé à la main, ou jeu de démonstration. Cas nommé plutôt
    // que subi : sans abonnement, il n'y a rien d'autre à lire.
    const state = resolveEntitlements(null, { plan: 'pro', addons: ['loyalty'] });
    expect(state.source).toBe('establishment');
    expect(state.status).toBeNull();
    expect(hasEntitlement(state, 'loyalty')).toBe(true);
  });
});

describe('statut de l’abonnement', () => {
  it('coupe les fonctions facturées sur un abonnement suspendu', () => {
    const state = resolveEntitlements(abonnement({ plan: 'premium', status: 'suspended' }), {
      plan: 'premium',
      addons: [],
    });

    expect(state.active).toBe(false);
    expect(hasEntitlement(state, 'competitive_benchmark')).toBe(false);
    expect(hasEntitlement(state, 'ai_reply_suggestions')).toBe(false);
    expect(state.restriction).toContain('suspendu');
  });

  it('coupe aussi sur un abonnement résilié', () => {
    const state = resolveEntitlements(abonnement({ plan: 'premium', status: 'canceled' }), {
      plan: 'premium',
      addons: [],
    });
    expect(hasEntitlement(state, 'nlp_themes')).toBe(false);
  });

  it('laisse la consultation ouverte malgré la suspension', () => {
    // Couper l'accès aux données d'un client suspendu pour impayé lui
    // retirerait ce dont il a besoin pour comprendre sa situation — et le
    // RGPD ne s'interrompt pas avec l'abonnement.
    const state = resolveEntitlements(abonnement({ plan: 'premium', status: 'suspended' }), {
      plan: 'premium',
      addons: [],
    });
    expect(hasEntitlement(state, 'analytics_basic')).toBe(true);
  });

  it('ne coupe rien pendant le délai de grâce', () => {
    // `past_due` est un retard de paiement, pas une suspension. Couper au
    // premier jour ferait fuir un client qui a changé de carte, et les
    // relances existent pour occuper ce temps.
    const state = resolveEntitlements(abonnement({ plan: 'premium', status: 'past_due' }), {
      plan: 'premium',
      addons: [],
    });
    expect(state.active).toBe(true);
    expect(hasEntitlement(state, 'competitive_benchmark')).toBe(true);
  });

  it('laisse la période d’essai accéder à tout', () => {
    const state = resolveEntitlements(abonnement({ plan: 'premium', status: 'trialing' }), {
      plan: 'premium',
      addons: [],
    });
    expect(state.active).toBe(true);
  });

  it('réduit la liste affichée aux fonctions réellement ouvertes', () => {
    const suspendu = resolveEntitlements(abonnement({ plan: 'premium', status: 'suspended' }), {
      plan: 'premium',
      addons: [],
    });
    const actif = resolveEntitlements(abonnement({ plan: 'premium', status: 'active' }), {
      plan: 'premium',
      addons: [],
    });

    expect(activeFeatures(suspendu).length).toBeLessThan(activeFeatures(actif).length);
    expect(activeFeatures(suspendu)).toContain('analytics_basic');
  });
});

describe('détection de divergence', () => {
  it("signale un établissement qui ne dit pas la même chose que sa facture", () => {
    const ecart = entitlementDrift(abonnement({ plan: 'essentiel' }), {
      plan: 'premium',
      addons: [],
    });
    expect(ecart).toContain('essentiel');
    expect(ecart).toContain('premium');
  });

  it('signale une option en trop', () => {
    const ecart = entitlementDrift(abonnement({ plan: 'pro', addons: [] }), {
      plan: 'pro',
      addons: ['loyalty'],
    });
    expect(ecart).toContain('loyalty');
  });

  it('ne signale rien quand tout concorde, quel que soit l’ordre des options', () => {
    expect(
      entitlementDrift(abonnement({ plan: 'pro', addons: ['loyalty', 'analytics'] }), {
        plan: 'pro',
        addons: ['analytics', 'loyalty'],
      }),
    ).toBeNull();
  });

  it("ne signale rien en l'absence d'abonnement", () => {
    expect(entitlementDrift(null, { plan: 'premium', addons: [] })).toBeNull();
  });
});
