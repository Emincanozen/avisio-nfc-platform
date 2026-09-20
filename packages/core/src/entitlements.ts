/**
 * Droits effectifs d'un établissement.
 *
 * Une seule question, posée au seul endroit qui a le droit d'y répondre :
 * **qu'est-ce que ce client a réellement payé, et son abonnement est-il encore
 * en vigueur ?**
 *
 * Deux défauts sont corrigés ici, et ils ont la même racine.
 *
 * 1. `establishment.plan` et `subscription.plan` étaient deux copies de la
 *    même vérité. Les droits lisaient l'établissement, la facturation lisait
 *    l'abonnement. Un gérant qui modifiait son établissement — ce que la
 *    route `PATCH /establishments/:id` permettait — obtenait les fonctions
 *    Premium tout en restant facturé Essentiel. La divergence ne produisait
 *    aucune erreur : elle donnait simplement le produit gratuitement.
 *
 * 2. Un abonnement suspendu pour impayé conservait tous ses droits. La
 *    suspension était un état affiché dans le back-office, sans effet.
 *
 * **L'abonnement fait foi.** L'établissement ne sert de source que lorsqu'il
 * n'y a pas d'abonnement du tout — un établissement créé à la main, une
 * démonstration — et ce cas est nommé explicitement plutôt que subi.
 */

import { entitlements, type Feature } from './pricing.js';
import type { AddonId, PlanId } from './types.js';
import type { Subscription, SubscriptionStatus } from './billing.js';

/** D'où viennent les droits constatés. Sert à l'affichage et au diagnostic. */
export type EntitlementSource = 'subscription' | 'establishment';

export interface EntitlementState {
  plan: PlanId;
  addons: AddonId[];
  /** `null` quand aucun abonnement n'existe. */
  status: SubscriptionStatus | null;
  source: EntitlementSource;
  /** Faux quand le statut restreint l'accès (suspension, résiliation). */
  active: boolean;
  /** Motif lisible, à afficher au gérant. Vide quand l'accès est entier. */
  restriction: string;
}

/**
 * Fonctions qui restent accessibles même sur un abonnement suspendu ou résilié.
 *
 * Couper l'accès aux factures d'un client suspendu pour impayé serait absurde :
 * on lui retirerait le document dont il a besoin pour payer. La consultation de
 * ses propres données reste ouverte pour la même raison — et parce que le RGPD
 * ne s'interrompt pas avec l'abonnement.
 */
const FEATURES_HORS_SUSPENSION: Feature[] = ['analytics_basic'];

/**
 * Statuts qui suspendent les fonctions facturées.
 *
 * `past_due` n'en fait PAS partie : c'est le délai de grâce. Couper le service
 * au premier jour de retard ferait fuir un client qui a simplement changé de
 * carte, et les relances existent précisément pour occuper ce temps-là. La
 * suspension arrive après trente jours, et c'est `dunningAction` qui la
 * prononce.
 */
const STATUTS_RESTREINTS: SubscriptionStatus[] = ['suspended', 'canceled'];

const MOTIFS: Record<string, string> = {
  suspended:
    'Abonnement suspendu pour impayé. Vos factures restent accessibles ; le service reprend dès régularisation.',
  canceled: 'Abonnement résilié. Vos factures et vos données restent consultables.',
  none: "Aucun abonnement n'est rattaché à cet établissement.",
};

/**
 * Établit les droits effectifs.
 *
 * `establishment` n'est utilisé qu'à défaut d'abonnement. Le passer n'autorise
 * jamais à élargir ce que l'abonnement accorde : c'est un repli, pas un
 * complément.
 */
export function resolveEntitlements(
  subscription: Pick<Subscription, 'plan' | 'addons' | 'status'> | null | undefined,
  establishment: { plan: PlanId; addons: AddonId[] },
): EntitlementState {
  if (!subscription) {
    return {
      plan: establishment.plan,
      addons: establishment.addons,
      status: null,
      source: 'establishment',
      active: true,
      restriction: '',
    };
  }

  const restreint = STATUTS_RESTREINTS.includes(subscription.status);
  return {
    plan: subscription.plan,
    addons: subscription.addons,
    status: subscription.status,
    source: 'subscription',
    active: !restreint,
    restriction: restreint ? (MOTIFS[subscription.status] ?? '') : '',
  };
}

/**
 * La fonction est-elle accessible ?
 *
 * Remplace `hasFeature(establishment.plan, establishment.addons, …)` partout
 * où une décision d'accès est prise. `hasFeature` reste utile pour décrire une
 * offre du catalogue — « que contient Premium ? » — mais ne doit plus servir à
 * autoriser quoi que ce soit.
 */
export function hasEntitlement(state: EntitlementState, feature: Feature): boolean {
  if (!entitlements(state.plan, state.addons).has(feature)) return false;
  if (state.active) return true;
  return FEATURES_HORS_SUSPENSION.includes(feature);
}

/** Liste des fonctions effectivement accessibles. Sert à l'interface. */
export function activeFeatures(state: EntitlementState): Feature[] {
  return [...entitlements(state.plan, state.addons)].filter((feature) =>
    hasEntitlement(state, feature),
  );
}

/**
 * L'abonnement et l'établissement disent-ils la même chose ?
 *
 * Un désaccord signale soit une écriture partielle — un changement d'offre
 * interrompu entre les deux mises à jour — soit une modification indue. Dans
 * les deux cas il doit être visible dans le back-office, pas découvert en
 * comparant une facture à un usage six mois plus tard.
 */
export function entitlementDrift(
  subscription: Pick<Subscription, 'plan' | 'addons'> | null | undefined,
  establishment: { plan: PlanId; addons: AddonId[] },
): string | null {
  if (!subscription) return null;

  const memeOffre = subscription.plan === establishment.plan;
  const memesOptions =
    subscription.addons.length === establishment.addons.length &&
    [...subscription.addons].sort().join(',') === [...establishment.addons].sort().join(',');

  if (memeOffre && memesOptions) return null;

  return (
    `Abonnement facturé : ${subscription.plan} [${[...subscription.addons].sort().join(', ') || 'aucune option'}] · ` +
    `Établissement : ${establishment.plan} [${[...establishment.addons].sort().join(', ') || 'aucune option'}]`
  );
}
