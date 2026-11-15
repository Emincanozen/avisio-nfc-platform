/**
 * Préférences et routage des notifications.
 *
 * Trois principes :
 *  1. Le gérant décide de ce qui le réveille. Une alerte qu'il ne peut pas
 *     couper finit par être filtrée dans sa boîte mail, et on perd tout.
 *  2. Les heures calmes s'appliquent au push, pas à l'e-mail : un e-mail à
 *     23 h attend sagement, une notification push non.
 *  3. Les messages contractuels — facture, relance, suspension — ne se coupent
 *     jamais. Ce ne sont pas des alertes produit.
 */

export type NotificationChannel = 'email' | 'push';

export type NotificationEvent =
  | 'negative_review'
  | 'theme_trend'
  | 'weekly_digest'
  | 'monthly_report'
  | 'billing';

/** Événements que le gérant ne peut pas désactiver. */
export const MANDATORY_EVENTS: NotificationEvent[] = ['billing'];

export interface QuietHours {
  /** Heure de début, 0-23, dans le fuseau de l'établissement. */
  start: number;
  /** Heure de fin, 0-23. `start > end` traverse minuit. */
  end: number;
}

export interface NotificationPreferences {
  establishmentId: string;
  /** Canaux actifs par type d'événement. */
  channels: Record<NotificationEvent, NotificationChannel[]>;
  quietHours: QuietHours | null;
  /** Décalage horaire de l'établissement, en heures (Europe/Paris = 1 ou 2). */
  utcOffsetHours: number;
}

export const DEFAULT_PREFERENCES = (establishmentId: string): NotificationPreferences => ({
  establishmentId,
  channels: {
    negative_review: ['email', 'push'],
    theme_trend: ['email'],
    weekly_digest: ['email'],
    monthly_report: ['email'],
    billing: ['email'],
  },
  quietHours: { start: 22, end: 8 },
  utcOffsetHours: 2,
});

export interface DeliveryPlan {
  channels: NotificationChannel[];
  /** Envoi différé : moment où le push sortira des heures calmes. */
  deferPushUntil?: string;
  /** Explique la décision, journalisé et visible en support. */
  reason: string;
}

/**
 * Décide des canaux à utiliser pour un événement.
 *
 * `entitled` porte le droit commercial : un établissement en offre Essentiel
 * n'a pas les alertes sur avis négatifs, quelles que soient ses préférences.
 */
export function planDelivery(
  preferences: NotificationPreferences,
  event: NotificationEvent,
  now: string,
  entitled = true,
): DeliveryPlan {
  const mandatory = MANDATORY_EVENTS.includes(event);

  if (!entitled && !mandatory) {
    return { channels: [], reason: "Fonctionnalité non comprise dans l'offre." };
  }

  const configured = mandatory
    ? dedupe([...(preferences.channels[event] ?? []), 'email' as NotificationChannel])
    : (preferences.channels[event] ?? []);

  if (configured.length === 0) {
    return { channels: [], reason: 'Aucun canal activé pour cet événement.' };
  }

  if (mandatory || !preferences.quietHours) {
    return { channels: configured, reason: 'Envoi immédiat.' };
  }

  if (!isQuietHour(now, preferences)) {
    return { channels: configured, reason: 'Envoi immédiat.' };
  }

  const withoutPush = configured.filter((channel) => channel !== 'push');
  if (!configured.includes('push')) {
    return { channels: withoutPush, reason: 'Envoi immédiat.' };
  }

  return {
    channels: withoutPush,
    deferPushUntil: endOfQuietHours(now, preferences),
    reason: `Heures calmes (${preferences.quietHours.start} h - ${preferences.quietHours.end} h) : le push est différé, l'e-mail part tout de suite.`,
  };
}

export function isQuietHour(now: string, preferences: NotificationPreferences): boolean {
  if (!preferences.quietHours) return false;
  const hour = localHour(now, preferences.utcOffsetHours);
  const { start, end } = preferences.quietHours;
  // Une plage qui traverse minuit (22 h → 8 h) est vraie de part et d'autre.
  return start > end ? hour >= start || hour < end : hour >= start && hour < end;
}

/** Prochain instant, en ISO, où les heures calmes sont terminées. */
export function endOfQuietHours(now: string, preferences: NotificationPreferences): string {
  if (!preferences.quietHours) return now;
  const date = new Date(now);
  const offsetMs = preferences.utcOffsetHours * 3_600_000;
  const local = new Date(date.getTime() + offsetMs);

  const target = new Date(local);
  target.setUTCHours(preferences.quietHours.end, 0, 0, 0);
  if (target.getTime() <= local.getTime()) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  return new Date(target.getTime() - offsetMs).toISOString();
}

const localHour = (iso: string, offsetHours: number): number =>
  new Date(new Date(iso).getTime() + offsetHours * 3_600_000).getUTCHours();

/**
 * Regroupe des alertes en une notification unique.
 *
 * Trois avis négatifs en dix minutes doivent produire un message, pas trois.
 * Le seuil est volontairement bas : au-delà de deux, le gérant a besoin d'une
 * vue d'ensemble, pas d'une rafale.
 */
export function digestTitle(count: number, establishmentName: string): string {
  if (count === 1) return `${establishmentName} — un avis à traiter`;
  return `${establishmentName} — ${count} avis à traiter`;
}

export const DIGEST_WINDOW_MINUTES = 10;

/** true quand une nouvelle alerte doit rejoindre la précédente plutôt qu'en créer une. */
export function shouldBatch(lastSentAt: string | undefined, now: string): boolean {
  if (!lastSentAt) return false;
  const elapsedMinutes = (new Date(now).getTime() - new Date(lastSentAt).getTime()) / 60_000;
  return elapsedMinutes < DIGEST_WINDOW_MINUTES;
}

const dedupe = <T>(items: T[]): T[] => Array.from(new Set(items));
