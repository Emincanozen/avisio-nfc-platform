/**
 * Moteur de routage multi-plateformes.
 *
 * Objectif : équilibrer la présence de l'établissement en envoyant chaque
 * client vers UNE seule plateforme, celle où il est le moins présent au regard
 * de la cible attendue pour son secteur.
 *
 * Principe : round-robin pondéré par déficit.
 *   déficit(p) = part_cible(p) - part_actuelle(p)
 * La plateforme au plus fort déficit gagne le scan. Les scans déjà routés mais
 * pas encore reflétés dans les compteurs (`routedScans`, remis à zéro à chaque
 * synchronisation) sont comptés comme des avis en attente, sinon tout le flux
 * partirait sur la même plateforme entre deux synchros.
 *
 * Quand aucune API de lecture n'est disponible (TheFork par exemple), le
 * compteur d'avis reste à 0 et l'algorithme se réduit naturellement à une
 * rotation par nombre de scans.
 */

import type { PlatformId, PlatformLink, Sector } from './types.js';

/**
 * Parts de présence visées par secteur. Elles traduisent l'endroit où les
 * clients de l'établissement cherchent réellement l'information : Google reste
 * majoritaire partout, TheFork et TripAdvisor pèsent sur la restauration,
 * Facebook sur les commerces de proximité.
 */
export const SECTOR_TARGET_SHARES: Record<Sector, Partial<Record<PlatformId, number>>> = {
  restaurant: { google: 0.55, tripadvisor: 0.18, thefork: 0.15, facebook: 0.07, yelp: 0.05 },
  bar: { google: 0.6, facebook: 0.18, tripadvisor: 0.12, yelp: 0.1 },
  hotel: { google: 0.45, tripadvisor: 0.35, facebook: 0.12, yelp: 0.08 },
  retail: { google: 0.75, facebook: 0.18, yelp: 0.07 },
  beauty: { google: 0.8, facebook: 0.2 },
  health: { google: 0.9, facebook: 0.1 },
  other: { google: 0.8, facebook: 0.12, yelp: 0.08 },
};

export interface RoutingDecision {
  platform: PlatformId;
  reviewUrl: string;
  /** Explique le choix — affiché dans le dashboard et journalisé. */
  reason: string;
  /** Déficit de présence au moment du choix, pour audit. */
  deficit: number;
}

export class NoRoutablePlatformError extends Error {
  override name = 'NoRoutablePlatformError';
}

/**
 * Sélectionne la plateforme de destination d'un scan.
 *
 * Aucune information sur le client n'entre dans la décision : ni note
 * pressentie, ni profil. Seule compte la répartition de la présence en ligne
 * de l'établissement (cf. `compliance.ts`).
 */
export function selectPlatform(
  links: PlatformLink[],
  sector: Sector,
  options: { quota?: number } = {},
): RoutingDecision {
  const enabled = links.filter((l) => l.enabled && l.reviewUrl.length > 0);
  if (enabled.length === 0) {
    throw new NoRoutablePlatformError(
      "Aucune plateforme active pour cet établissement : configurez au moins l'URL Google.",
    );
  }

  const quota = options.quota ?? Number.POSITIVE_INFINITY;
  const eligible = Number.isFinite(quota) ? applyQuota(enabled, quota) : enabled;

  if (eligible.length === 1) {
    const only = eligible[0]!;
    return {
      platform: only.platform,
      reviewUrl: only.reviewUrl,
      reason: 'Seule plateforme active sur cet établissement.',
      deficit: 0,
    };
  }

  const shares = SECTOR_TARGET_SHARES[sector];
  const weights = eligible.map((link) => ({
    link,
    target: shares[link.platform] ?? 0.05,
    presence: link.reviewCount + link.routedScans,
  }));

  const totalTarget = weights.reduce((acc, w) => acc + w.target, 0) || 1;
  const totalPresence = weights.reduce((acc, w) => acc + w.presence, 0);

  // Aucun avis nulle part : on amorce sur la plateforme de plus forte cible.
  if (totalPresence === 0) {
    const best = weights.reduce((a, b) => (b.target > a.target ? b : a));
    return {
      platform: best.link.platform,
      reviewUrl: best.link.reviewUrl,
      reason: `Amorçage : plateforme prioritaire pour le secteur « ${sector} ».`,
      deficit: best.target / totalTarget,
    };
  }

  const scored = weights.map((w) => ({
    ...w,
    deficit: w.target / totalTarget - w.presence / totalPresence,
  }));

  const winner = scored.reduce((a, b) => {
    if (b.deficit !== a.deficit) return b.deficit > a.deficit ? b : a;
    // Départage stable : présence la plus faible, puis ordre alphabétique.
    if (b.presence !== a.presence) return b.presence < a.presence ? b : a;
    return a.link.platform < b.link.platform ? a : b;
  });

  return {
    platform: winner.link.platform,
    reviewUrl: winner.link.reviewUrl,
    reason: formatReason(winner.link.platform, winner.presence, totalPresence, winner.target / totalTarget),
    deficit: Number(winner.deficit.toFixed(4)),
  };
}

/**
 * Restreint la sélection au quota de l'offre : Google est toujours conservé,
 * les autres plateformes sont prises dans l'ordre de configuration.
 */
function applyQuota(links: PlatformLink[], quota: number): PlatformLink[] {
  if (links.length <= quota) return links;
  const google = links.filter((l) => l.platform === 'google');
  const others = links.filter((l) => l.platform !== 'google');
  return [...google, ...others].slice(0, Math.max(1, Math.floor(quota)));
}

function formatReason(
  platform: PlatformId,
  presence: number,
  totalPresence: number,
  target: number,
): string {
  const current = Math.round((presence / totalPresence) * 100);
  const goal = Math.round(target * 100);
  return `${PLATFORM_LABELS[platform]} : ${current} % de la présence actuelle pour une cible de ${goal} %.`;
}

export const PLATFORM_LABELS: Record<PlatformId, string> = {
  google: 'Google',
  tripadvisor: 'TripAdvisor',
  facebook: 'Facebook',
  yelp: 'Yelp',
  thefork: 'TheFork',
};

/** Plateformes disposant d'une API de lecture des compteurs d'avis. */
export const PLATFORMS_WITH_COUNT_API: Record<PlatformId, boolean> = {
  google: true,
  tripadvisor: true, // Content API, accès partenaire à demander
  facebook: true, // Graph API, permission Page Public Content Access
  yelp: true, // Fusion API
  thefork: false, // pas d'API publique : rotation par scans
};

/**
 * Simule la répartition de N scans, utilisé par le dashboard pour montrer au
 * gérant l'effet du routage avant activation.
 */
export function simulateRouting(
  links: PlatformLink[],
  sector: Sector,
  scans: number,
  quota?: number,
): Record<string, number> {
  const state = links.map((l) => ({ ...l }));
  const tally: Record<string, number> = {};
  for (let i = 0; i < scans; i += 1) {
    const decision = selectPlatform(state, sector, quota == null ? {} : { quota });
    tally[decision.platform] = (tally[decision.platform] ?? 0) + 1;
    const target = state.find((l) => l.platform === decision.platform);
    if (target) target.routedScans += 1;
  }
  return tally;
}
