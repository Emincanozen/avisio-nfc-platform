/**
 * Module fidélité.
 *
 * Règle de conformité non négociable : les points sont accordés pour le FAIT
 * d'avoir déposé un avis, jamais pour son contenu ni pour sa note. Le barème
 * ci-dessous n'a donc aucun paramètre de note — et `compliance.checkLoyaltyRule`
 * rejette toute configuration qui en introduirait un.
 *
 * Anti-abus : un même contact ne peut créditer qu'une fois par période de
 * carence, ce qui évite le scan en boucle de la plaquette au comptoir.
 */

import type { LoyaltyMember } from './types.js';

export const POINTS_PER_REVIEW = 10;
export const COOLDOWN_HOURS = 24;

export interface RewardTier {
  points: number;
  label: string;
}

export const DEFAULT_REWARDS: RewardTier[] = [
  { points: 30, label: 'Café ou boisson chaude offerte' },
  { points: 60, label: 'Dessert offert' },
  { points: 100, label: '10 € de remise sur l’addition' },
];

export type EarnOutcome =
  | { credited: true; points: number; balance: number; unlocked: RewardTier | null }
  | { credited: false; reason: 'cooldown'; nextEligibleAt: string; balance: number };

/**
 * Crédite un membre après un scan ayant abouti à une redirection.
 *
 * Note : le crédit intervient au moment de la redirection vers la plateforme,
 * pas après vérification du dépôt de l'avis. Vérifier le dépôt supposerait de
 * relier l'avis publié à l'identité du client, ce que les plateformes
 * n'autorisent pas et que le RGPD rendrait disproportionné.
 */
export function earnPoints(
  member: Pick<LoyaltyMember, 'points' | 'lastEarnedAt'>,
  now = new Date(),
  pointsPerReview = POINTS_PER_REVIEW,
  cooldownHours = COOLDOWN_HOURS,
): EarnOutcome {
  if (member.lastEarnedAt) {
    const elapsedHours = (now.getTime() - new Date(member.lastEarnedAt).getTime()) / 3_600_000;
    if (elapsedHours < cooldownHours) {
      const nextEligible = new Date(
        new Date(member.lastEarnedAt).getTime() + cooldownHours * 3_600_000,
      );
      return {
        credited: false,
        reason: 'cooldown',
        nextEligibleAt: nextEligible.toISOString(),
        balance: member.points,
      };
    }
  }

  const balance = member.points + pointsPerReview;
  return {
    credited: true,
    points: pointsPerReview,
    balance,
    unlocked: highestUnlocked(member.points, balance),
  };
}

/** Palier franchi par ce crédit (null si aucun). */
function highestUnlocked(before: number, after: number, rewards = DEFAULT_REWARDS): RewardTier | null {
  const crossed = rewards.filter((r) => before < r.points && after >= r.points);
  return crossed.length === 0 ? null : crossed[crossed.length - 1]!;
}

export function nextReward(
  balance: number,
  rewards = DEFAULT_REWARDS,
): { reward: RewardTier; missing: number } | null {
  const upcoming = [...rewards].sort((a, b) => a.points - b.points).find((r) => r.points > balance);
  return upcoming ? { reward: upcoming, missing: upcoming.points - balance } : null;
}

export function balanceMessage(balance: number, rewards = DEFAULT_REWARDS): string {
  const next = nextReward(balance, rewards);
  if (!next) return `${balance} points — tous les paliers sont atteints, profitez-en !`;
  return `${balance} points — encore ${next.missing} pour « ${next.reward.label} ».`;
}
