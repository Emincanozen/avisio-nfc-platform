/**
 * Catalogue commercial et moteur de devis.
 *
 * Tous les montants sont exprimés en centimes d'euro HT pour éviter les
 * arrondis flottants. La TVA (20 %) est appliquée en fin de calcul.
 */

import type { AddonId, PlanId } from './types.js';

export const VAT_RATE = 0.2;
export const SETUP_FEE_CENTS = 4900;
export const EXTRA_TAG_CENTS = 1500;
export const PREMIUM_TAG_CENTS = 3500;

export type Feature =
  | 'nfc_google_direct'
  | 'realtime_notifications'
  | 'site_widget'
  | 'negative_alerts'
  | 'ai_reply_suggestions'
  | 'multi_platform'
  | 'multi_platform_unlimited'
  | 'analytics_basic'
  | 'analytics_advanced'
  | 'nlp_themes'
  | 'competitive_benchmark'
  | 'loyalty'
  | 'custom_tag_design'
  | 'pos_integration';

export interface PlanDefinition {
  id: PlanId;
  name: string;
  monthlyCents: number;
  includedTags: number;
  /** Nombre de plateformes activables en plus de Google (Infinity = illimité). */
  extraPlatforms: number;
  features: Feature[];
  /** Add-ons déjà couverts par l'offre : jamais refacturés. */
  bundledAddons: AddonId[];
  tagline: string;
}

export interface AddonDefinition {
  id: AddonId;
  name: string;
  monthlyCents: number;
  /** true : facturé à l'unité (une ligne par plateforme supplémentaire). */
  perUnit: boolean;
  features: Feature[];
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  essentiel: {
    id: 'essentiel',
    name: 'Essentiel',
    monthlyCents: 2900,
    includedTags: 1,
    extraPlatforms: 0,
    features: ['nfc_google_direct', 'realtime_notifications', 'site_widget'],
    bundledAddons: [],
    tagline: 'Collecter des avis Google au comptoir, sans friction.',
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    monthlyCents: 7900,
    includedTags: 3,
    extraPlatforms: 1,
    features: [
      'nfc_google_direct',
      'realtime_notifications',
      'site_widget',
      'negative_alerts',
      'ai_reply_suggestions',
      'multi_platform',
      'analytics_basic',
    ],
    bundledAddons: ['negative_reviews'],
    tagline: 'Ne plus jamais laisser un avis négatif sans réponse.',
  },
  premium: {
    id: 'premium',
    name: 'Premium',
    monthlyCents: 14900,
    includedTags: 5,
    extraPlatforms: Number.POSITIVE_INFINITY,
    features: [
      'nfc_google_direct',
      'realtime_notifications',
      'site_widget',
      'negative_alerts',
      'ai_reply_suggestions',
      'multi_platform',
      'multi_platform_unlimited',
      'analytics_basic',
      'analytics_advanced',
      'nlp_themes',
      'competitive_benchmark',
      'loyalty',
      'custom_tag_design',
      'pos_integration',
    ],
    bundledAddons: ['negative_reviews', 'analytics', 'loyalty'],
    tagline: 'Piloter la réputation comme un indicateur de gestion.',
  },
};

export const ADDONS: Record<AddonId, AddonDefinition> = {
  negative_reviews: {
    id: 'negative_reviews',
    name: 'Gestion des avis négatifs',
    monthlyCents: 2500,
    perUnit: false,
    features: ['negative_alerts', 'ai_reply_suggestions'],
  },
  extra_platform: {
    id: 'extra_platform',
    name: 'Plateforme supplémentaire',
    monthlyCents: 1500,
    perUnit: true,
    features: ['multi_platform'],
  },
  analytics: {
    id: 'analytics',
    name: 'Analytics & intelligence business',
    monthlyCents: 3900,
    perUnit: false,
    features: [
      'analytics_basic',
      'analytics_advanced',
      'nlp_themes',
      'competitive_benchmark',
    ],
  },
  loyalty: {
    id: 'loyalty',
    name: 'Module fidélité',
    monthlyCents: 1200,
    perUnit: false,
    features: ['loyalty'],
  },
};

export interface QuoteInput {
  plan: PlanId;
  addons: AddonId[];
  /** Nombre total de plaquettes souhaitées (incluses + supplémentaires). */
  tags: number;
  /** Plaquettes premium personnalisées, facturées à l'unité. */
  premiumTags?: number;
  /** Plateformes activées en plus de Google. */
  extraPlatforms?: number;
  committed12Months: boolean;
}

export interface QuoteLine {
  label: string;
  quantity: number;
  unitCents: number;
  totalCents: number;
  kind: 'recurring' | 'one_off';
}

export interface Quote {
  lines: QuoteLine[];
  monthlyCentsExclVat: number;
  oneOffCentsExclVat: number;
  monthlyCentsInclVat: number;
  oneOffCentsInclVat: number;
  /** Montant facturé au premier mois, TTC. */
  firstInvoiceCentsInclVat: number;
  /** Add-ons demandés mais déjà inclus dans l'offre : non facturés. */
  redundantAddons: AddonId[];
}

const withVat = (cents: number): number => Math.round(cents * (1 + VAT_RATE));

/**
 * Construit un devis complet.
 *
 * Deux règles de gestion structurantes :
 *  - un add-on déjà couvert par l'offre n'est jamais refacturé (il apparaît
 *    dans `redundantAddons` pour que le commercial puisse l'expliquer) ;
 *  - les plateformes supplémentaires comprises dans l'offre sont déduites
 *    avant facturation à l'unité.
 */
export function quote(input: QuoteInput): Quote {
  const plan = PLANS[input.plan];
  const lines: QuoteLine[] = [];
  const redundantAddons: AddonId[] = [];

  lines.push({
    label: `Abonnement ${plan.name}`,
    quantity: 1,
    unitCents: plan.monthlyCents,
    totalCents: plan.monthlyCents,
    kind: 'recurring',
  });

  for (const addonId of dedupe(input.addons)) {
    if (addonId === 'extra_platform') continue; // traité via extraPlatforms
    if (plan.bundledAddons.includes(addonId)) {
      redundantAddons.push(addonId);
      continue;
    }
    const addon = ADDONS[addonId];
    lines.push({
      label: addon.name,
      quantity: 1,
      unitCents: addon.monthlyCents,
      totalCents: addon.monthlyCents,
      kind: 'recurring',
    });
  }

  const requestedPlatforms = Math.max(0, input.extraPlatforms ?? 0);
  const billablePlatforms = Number.isFinite(plan.extraPlatforms)
    ? Math.max(0, requestedPlatforms - plan.extraPlatforms)
    : 0;
  if (billablePlatforms > 0) {
    const addon = ADDONS.extra_platform;
    lines.push({
      label: addon.name,
      quantity: billablePlatforms,
      unitCents: addon.monthlyCents,
      totalCents: addon.monthlyCents * billablePlatforms,
      kind: 'recurring',
    });
  }

  const extraTags = Math.max(0, input.tags - plan.includedTags);
  if (extraTags > 0) {
    lines.push({
      label: 'Plaquette NFC supplémentaire',
      quantity: extraTags,
      unitCents: EXTRA_TAG_CENTS,
      totalCents: EXTRA_TAG_CENTS * extraTags,
      kind: 'one_off',
    });
  }

  const premiumTags = Math.max(0, input.premiumTags ?? 0);
  if (premiumTags > 0) {
    lines.push({
      label: 'Plaquette premium personnalisée',
      quantity: premiumTags,
      unitCents: PREMIUM_TAG_CENTS,
      totalCents: PREMIUM_TAG_CENTS * premiumTags,
      kind: 'one_off',
    });
  }

  if (!input.committed12Months) {
    lines.push({
      label: 'Mise en service (sans engagement)',
      quantity: 1,
      unitCents: SETUP_FEE_CENTS,
      totalCents: SETUP_FEE_CENTS,
      kind: 'one_off',
    });
  }

  const monthlyCentsExclVat = sum(lines.filter((l) => l.kind === 'recurring'));
  const oneOffCentsExclVat = sum(lines.filter((l) => l.kind === 'one_off'));

  return {
    lines,
    monthlyCentsExclVat,
    oneOffCentsExclVat,
    monthlyCentsInclVat: withVat(monthlyCentsExclVat),
    oneOffCentsInclVat: withVat(oneOffCentsExclVat),
    firstInvoiceCentsInclVat: withVat(monthlyCentsExclVat + oneOffCentsExclVat),
    redundantAddons,
  };
}

/** Droits effectifs = fonctionnalités de l'offre + fonctionnalités des add-ons. */
export function entitlements(plan: PlanId, addons: AddonId[]): Set<Feature> {
  const set = new Set<Feature>(PLANS[plan].features);
  for (const addonId of dedupe(addons)) {
    for (const feature of ADDONS[addonId].features) set.add(feature);
  }
  return set;
}

export function hasFeature(
  plan: PlanId,
  addons: AddonId[],
  feature: Feature,
): boolean {
  return entitlements(plan, addons).has(feature);
}

/** Nombre maximum de plateformes activables (Google inclus). */
export function platformQuota(
  plan: PlanId,
  addons: AddonId[],
  paidExtraPlatforms = 0,
): number {
  const base = PLANS[plan].extraPlatforms;
  if (!Number.isFinite(base)) return Number.POSITIVE_INFINITY;
  if (addons.includes('extra_platform')) {
    return 1 + base + Math.max(1, paidExtraPlatforms);
  }
  return 1 + base + Math.max(0, paidExtraPlatforms);
}

export const formatEuros = (cents: number): string =>
  (cents / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });

const sum = (lines: QuoteLine[]): number =>
  lines.reduce((acc, l) => acc + l.totalCents, 0);

const dedupe = <T>(items: T[]): T[] => Array.from(new Set(items));
