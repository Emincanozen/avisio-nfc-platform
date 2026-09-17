/**
 * Benchmark sectoriel anonymisé.
 *
 * Contrainte RGPD et contractuelle : un gérant ne doit jamais pouvoir déduire
 * les chiffres d'un concurrent identifiable. Deux garde-fous :
 *  - k-anonymat : un groupe de comparaison n'est restitué qu'à partir de
 *    `MIN_PEERS` établissements, l'établissement demandeur exclu ;
 *  - aucune donnée nominative ne sort de la fonction : uniquement des
 *    agrégats (médiane, moyenne, quartiles).
 *
 * La maille de regroupement est (secteur ou code NAF) × zone géographique.
 * La zone est dérivée du code postal, du plus fin au plus large, jusqu'à
 * atteindre le seuil : commune -> département -> national.
 */

export const MIN_PEERS = 5;

export interface PeerSnapshot {
  establishmentId: string;
  sector: string;
  nafCode?: string;
  postalCode: string;
  averageRating: number;
  reviewsLast30Days: number;
  replyRate: number;
}

export type BenchmarkScope = 'commune' | 'departement' | 'national';

export interface BenchmarkResult {
  scope: BenchmarkScope;
  /** Nombre d'établissements comparables, hors demandeur. */
  peerCount: number;
  averageRating: { self: number; peerMedian: number; peerP25: number; peerP75: number };
  reviewsLast30Days: { self: number; peerMedian: number };
  replyRate: { self: number; peerMedian: number };
  /** Rang centile du demandeur sur la note moyenne (0-100). */
  ratingPercentile: number;
  summary: string;
}

export class NotEnoughPeersError extends Error {
  override name = 'NotEnoughPeersError';
  constructor(public readonly peerCount: number) {
    super(
      `Benchmark indisponible : ${peerCount} établissement(s) comparable(s), minimum ${MIN_PEERS} pour garantir l'anonymat.`,
    );
  }
}

export function computeBenchmark(
  self: PeerSnapshot,
  population: PeerSnapshot[],
): BenchmarkResult {
  const sameSector = population.filter(
    (p) => p.establishmentId !== self.establishmentId && isSameCategory(p, self),
  );

  const scopes: Array<{ scope: BenchmarkScope; peers: PeerSnapshot[] }> = [
    { scope: 'commune', peers: sameSector.filter((p) => p.postalCode === self.postalCode) },
    {
      scope: 'departement',
      peers: sameSector.filter((p) => department(p.postalCode) === department(self.postalCode)),
    },
    { scope: 'national', peers: sameSector },
  ];

  const chosen = scopes.find((s) => s.peers.length >= MIN_PEERS);
  if (!chosen) throw new NotEnoughPeersError(sameSector.length);

  const ratings = chosen.peers.map((p) => p.averageRating);
  const volumes = chosen.peers.map((p) => p.reviewsLast30Days);
  const replyRates = chosen.peers.map((p) => p.replyRate);

  const peerMedian = percentile(ratings, 50);
  const percentileRank = rankOf(self.averageRating, ratings);

  return {
    scope: chosen.scope,
    peerCount: chosen.peers.length,
    averageRating: {
      self: round(self.averageRating, 2),
      peerMedian: round(peerMedian, 2),
      peerP25: round(percentile(ratings, 25), 2),
      peerP75: round(percentile(ratings, 75), 2),
    },
    reviewsLast30Days: {
      self: self.reviewsLast30Days,
      peerMedian: Math.round(percentile(volumes, 50)),
    },
    replyRate: {
      self: round(self.replyRate, 3),
      peerMedian: round(percentile(replyRates, 50), 3),
    },
    ratingPercentile: Math.round(percentileRank),
    summary: buildSummary(self, peerMedian, percentileRank, chosen.scope, chosen.peers.length),
  };
}

function buildSummary(
  self: PeerSnapshot,
  peerMedian: number,
  percentileRank: number,
  scope: BenchmarkScope,
  peerCount: number,
): string {
  const where =
    scope === 'commune'
      ? `sur votre commune (${self.postalCode})`
      : scope === 'departement'
        ? `sur votre département (${department(self.postalCode)})`
        : 'au niveau national';
  const delta = self.averageRating - peerMedian;
  const position =
    Math.abs(delta) < 0.05
      ? 'au niveau de'
      : delta > 0
        ? `${delta.toFixed(2)} point au-dessus de`
        : `${Math.abs(delta).toFixed(2)} point en dessous de`;
  return `Comparé à ${peerCount} établissements du même secteur ${where}, vous êtes ${position} la médiane (${peerMedian.toFixed(2)}/5) et dans le ${ordinal(Math.round(percentileRank))} centile.`;
}

const isSameCategory = (a: PeerSnapshot, b: PeerSnapshot): boolean =>
  a.nafCode && b.nafCode ? a.nafCode === b.nafCode : a.sector === b.sector;

export const department = (postalCode: string): string => postalCode.trim().slice(0, 2);

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0]!;
  const index = ((sorted.length - 1) * p) / 100;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower]!;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (index - lower);
}

/** Part des pairs strictement en dessous, en pourcentage. */
function rankOf(value: number, values: number[]): number {
  if (values.length === 0) return 50;
  const below = values.filter((v) => v < value).length;
  const equal = values.filter((v) => v === value).length;
  return ((below + equal / 2) / values.length) * 100;
}

const ordinal = (n: number): string => (n === 1 ? '1er' : `${n}e`);
const round = (value: number, digits: number): number => Number(value.toFixed(digits));
