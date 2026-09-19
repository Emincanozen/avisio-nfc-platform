/**
 * Abonnements et facturation.
 *
 * Contraintes françaises prises en compte :
 *  - numérotation des factures **continue et sans rupture** (art. 242 nonies A
 *    de l'annexe II au CGI) : une séquence par année civile, jamais de trou ;
 *  - mentions obligatoires portées par la facture (émetteur, client, dates,
 *    détail, TVA, pénalités de retard, indemnité forfaitaire de recouvrement) ;
 *  - engagement 12 mois : la résiliation anticipée ne prend effet qu'au terme,
 *    sauf motif légitime — le calcul est ici, pas dans l'interface.
 *
 * Tous les montants sont en centimes d'euro HT, comme dans `pricing.ts`.
 */

import { fr } from './format.js';
import { VAT_RATE, quote, type QuoteLine } from './pricing.js';
import type { AddonId, PlanId } from './types.js';

/** Pénalités de retard : 3× le taux d'intérêt légal (art. L.441-10 c. com.). */
export const LATE_PENALTY_RATE = 0.1026;
/** Indemnité forfaitaire pour frais de recouvrement (art. D.441-5 c. com.). */
export const RECOVERY_FEE_CENTS = 4000;
/** Délai de paiement par défaut, en jours. */
export const PAYMENT_TERMS_DAYS = 15;

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'suspended'
  | 'canceled';

export interface Subscription {
  id: string;
  establishmentId: string;
  plan: PlanId;
  addons: AddonId[];
  /** Plateformes activées au-delà de Google, facturées hors quota. */
  extraPlatforms: number;
  /** Plaquettes totales commandées, pour la facture de mise en service. */
  tags: number;
  committed12Months: boolean;
  status: SubscriptionStatus;
  startedAt: string;
  /** Début de la période en cours de facturation. */
  currentPeriodStart: string;
  currentPeriodEnd: string;
  /** Fin de la période d'essai, le cas échéant. */
  trialEndsAt?: string;
  /** Date de résiliation demandée ; l'abonnement reste actif jusque-là. */
  cancelAt?: string;
  canceledAt?: string;
}

export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';

export interface InvoiceLine {
  label: string;
  quantity: number;
  unitCents: number;
  totalCents: number;
  kind: 'recurring' | 'one_off' | 'proration' | 'credit';
}

export interface Invoice {
  id: string;
  /** Numéro légal, séquentiel et sans rupture : AVS-2026-000001. */
  number: string;
  establishmentId: string;
  subscriptionId: string;
  status: InvoiceStatus;
  periodStart: string;
  periodEnd: string;
  issuedAt: string;
  dueAt: string;
  paidAt?: string;
  lines: InvoiceLine[];
  subtotalCents: number;
  vatCents: number;
  totalCents: number;
  /** Référence du prélèvement ou du paiement chez le prestataire. */
  paymentReference?: string;
  /** Nombre de relances déjà envoyées. */
  remindersSent: number;
}

// ---------------------------------------------------------------------------
// Périodes
// ---------------------------------------------------------------------------

/**
 * Fin de la période mensuelle commençant à `start`.
 *
 * Le 31 janvier + 1 mois donne le 28 (ou 29) février, pas le 3 mars : sans ce
 * calage, un abonnement souscrit un 31 dérive d'un mois à l'autre et finit par
 * être facturé deux fois dans le même mois civil.
 */
export function addMonths(iso: string, months: number): string {
  const date = new Date(iso);
  const day = date.getUTCDate();
  const target = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()),
  );
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString();
}

export function nextPeriod(subscription: Subscription): {
  start: string;
  end: string;
} {
  return {
    start: subscription.currentPeriodEnd,
    end: addMonths(subscription.currentPeriodEnd, 1),
  };
}

/** Fin de l'engagement de 12 mois, ou null s'il n'y en a pas. */
export function commitmentEndsAt(subscription: Subscription): string | null {
  return subscription.committed12Months ? addMonths(subscription.startedAt, 12) : null;
}

export interface CancellationOutcome {
  /** Date à laquelle l'abonnement s'arrête réellement. */
  effectiveAt: string;
  /** true quand la demande est reportée à la fin de l'engagement. */
  deferredToCommitmentEnd: boolean;
  message: string;
}

/**
 * Résiliation : elle prend effet à la fin de la période en cours, ou à la fin
 * de l'engagement s'il court encore. On ne facture jamais après la date
 * d'effet, et on ne rembourse pas la période entamée.
 */
export function planCancellation(
  subscription: Subscription,
  requestedAt: string,
): CancellationOutcome {
  const periodEnd = subscription.currentPeriodEnd;
  const commitment = commitmentEndsAt(subscription);

  if (commitment && new Date(commitment).getTime() > new Date(periodEnd).getTime()) {
    return {
      effectiveAt: commitment,
      deferredToCommitmentEnd: true,
      message: `Engagement 12 mois en cours : la résiliation prendra effet le ${formatDate(commitment)}.`,
    };
  }

  return {
    effectiveAt: periodEnd,
    deferredToCommitmentEnd: false,
    message: `Résiliation enregistrée le ${formatDate(requestedAt)}, effective le ${formatDate(periodEnd)}.`,
  };
}

// ---------------------------------------------------------------------------
// Numérotation
// ---------------------------------------------------------------------------

/**
 * Numéro de facture. La séquence est continue par année civile : c'est au
 * dépôt de garantir l'unicité et l'absence de trou (compteur transactionnel).
 */
export function formatInvoiceNumber(year: number, sequence: number): string {
  return `AVS-${year}-${String(sequence).padStart(6, '0')}`;
}

export function parseInvoiceNumber(
  number: string,
): { year: number; sequence: number } | null {
  const match = /^AVS-(\d{4})-(\d{6})$/.exec(number);
  if (!match) return null;
  return { year: Number(match[1]), sequence: Number(match[2]) };
}

// ---------------------------------------------------------------------------
// Construction des factures
// ---------------------------------------------------------------------------

export interface BuildInvoiceInput {
  subscription: Subscription;
  periodStart: string;
  periodEnd: string;
  sequence: number;
  issuedAt: string;
  /** Lignes ponctuelles à joindre : mise en service, plaquettes, proratas. */
  extraLines?: InvoiceLine[];
  /** true pour la toute première facture : les frais d'installation y entrent. */
  includeOneOff?: boolean;
}

/**
 * Construit une facture à partir de l'abonnement et du catalogue.
 *
 * Le montant récurrent vient de `quote()` : il n'existe pas de second barème,
 * donc le prix annoncé au client en rendez-vous est exactement celui facturé.
 */
export function buildInvoice(input: BuildInvoiceInput): Omit<Invoice, 'id'> {
  const { subscription } = input;

  const priced = quote({
    plan: subscription.plan,
    addons: subscription.addons,
    tags: subscription.tags,
    extraPlatforms: subscription.extraPlatforms,
    committed12Months: subscription.committed12Months,
  });

  const lines: InvoiceLine[] = priced.lines
    .filter((line) => (input.includeOneOff ? true : line.kind === 'recurring'))
    .map(toInvoiceLine);

  for (const extra of input.extraLines ?? []) lines.push(extra);

  const subtotalCents = lines.reduce((acc, line) => acc + line.totalCents, 0);
  const vatCents = Math.round(subtotalCents * VAT_RATE);

  const issuedAt = input.issuedAt;
  const year = new Date(issuedAt).getUTCFullYear();

  return {
    number: formatInvoiceNumber(year, input.sequence),
    establishmentId: subscription.establishmentId,
    subscriptionId: subscription.id,
    status: 'open',
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    issuedAt,
    dueAt: addDays(issuedAt, PAYMENT_TERMS_DAYS),
    lines,
    subtotalCents,
    vatCents,
    totalCents: subtotalCents + vatCents,
    remindersSent: 0,
  };
}

const toInvoiceLine = (line: QuoteLine): InvoiceLine => ({
  label: line.label,
  quantity: line.quantity,
  unitCents: line.unitCents,
  totalCents: line.totalCents,
  kind: line.kind,
});

/**
 * Prorata lors d'un changement d'offre en cours de période.
 *
 * On crédite la part non consommée de l'ancienne offre et on facture la part
 * restante de la nouvelle, au jour près. Un changement le dernier jour de la
 * période ne produit donc presque rien, ce qui est le comportement attendu.
 */
export function prorationLines(
  fromPlanMonthlyCents: number,
  toPlanMonthlyCents: number,
  periodStart: string,
  periodEnd: string,
  changeAt: string,
): InvoiceLine[] {
  const total = new Date(periodEnd).getTime() - new Date(periodStart).getTime();
  const remaining = new Date(periodEnd).getTime() - new Date(changeAt).getTime();
  if (total <= 0 || remaining <= 0) return [];

  const ratio = Math.min(1, remaining / total);
  const credit = Math.round(fromPlanMonthlyCents * ratio);
  const charge = Math.round(toPlanMonthlyCents * ratio);
  if (credit === 0 && charge === 0) return [];

  const days = Math.round(remaining / 86_400_000);
  return [
    {
      label: `Avoir sur l'offre précédente (${days} j non consommés)`,
      quantity: 1,
      unitCents: -credit,
      totalCents: -credit,
      kind: 'credit',
    },
    {
      label: `Nouvelle offre au prorata (${days} j)`,
      quantity: 1,
      unitCents: charge,
      totalCents: charge,
      kind: 'proration',
    },
  ];
}

// ---------------------------------------------------------------------------
// Recouvrement
// ---------------------------------------------------------------------------

export type DunningAction =
  | { action: 'none' }
  | { action: 'remind'; stage: 1 | 2 | 3; subject: string; body: string }
  | { action: 'suspend'; reason: string };

/** Échéancier de relance : J+1, J+8, J+15, suspension à J+30. */
export const DUNNING_SCHEDULE = [1, 8, 15] as const;
export const SUSPENSION_AFTER_DAYS = 30;

/**
 * Décide de l'action de recouvrement pour une facture impayée.
 *
 * La suspension coupe les alertes et le tableau de bord, jamais la landing NFC :
 * couper la page scannée par les clients d'un commerçant pour un impayé de
 * 29 € punit le commerçant devant ses propres clients.
 */
export function dunningAction(invoice: Invoice, now: string): DunningAction {
  if (invoice.status !== 'open') return { action: 'none' };

  const overdueDays = Math.floor(
    (new Date(now).getTime() - new Date(invoice.dueAt).getTime()) / 86_400_000,
  );
  if (overdueDays < DUNNING_SCHEDULE[0]) return { action: 'none' };

  if (overdueDays >= SUSPENSION_AFTER_DAYS) {
    return {
      action: 'suspend',
      reason: `Facture ${invoice.number} impayée depuis ${overdueDays} jours.`,
    };
  }

  const stage = DUNNING_SCHEDULE.filter((threshold) => overdueDays >= threshold).length as
    | 1
    | 2
    | 3;
  if (stage <= invoice.remindersSent) return { action: 'none' };

  const amount = (invoice.totalCents / 100).toFixed(2).replace('.', ',');
  const bodies: Record<1 | 2 | 3, string> = {
    1: `La facture ${invoice.number} de ${amount} € TTC est arrivée à échéance. Si le règlement est déjà parti, merci de ne pas tenir compte de ce message.`,
    2: `La facture ${invoice.number} de ${amount} € TTC reste impayée depuis ${overdueDays} jours. Des pénalités de retard au taux de ${fr(LATE_PENALTY_RATE * 100)} % courent à compter de l'échéance.`,
    3: `Dernier rappel avant suspension : la facture ${invoice.number} de ${amount} € TTC est impayée depuis ${overdueDays} jours. Sans règlement sous 15 jours, l'accès au tableau de bord et aux alertes sera suspendu. Les plaquettes NFC de vos clients continueront de fonctionner.`,
  };

  return {
    action: 'remind',
    stage,
    subject: `Facture ${invoice.number} — ${stage === 3 ? 'dernier rappel' : 'relance'}`,
    body: bodies[stage],
  };
}

/** Pénalités de retard dues à la date donnée. */
export function latePenaltyCents(invoice: Invoice, now: string): number {
  const overdueDays = Math.floor(
    (new Date(now).getTime() - new Date(invoice.dueAt).getTime()) / 86_400_000,
  );
  if (overdueDays <= 0 || invoice.status !== 'open') return 0;
  return Math.round((invoice.totalCents * LATE_PENALTY_RATE * overdueDays) / 365);
}

// ---------------------------------------------------------------------------
// Indicateurs
// ---------------------------------------------------------------------------

export interface RevenueMetrics {
  activeSubscriptions: number;
  mrrCents: number;
  arrCents: number;
  arpuCents: number;
  /** Répartition du parc par offre. */
  byPlan: Record<PlanId, number>;
  /** Factures ouvertes échues, en centimes. */
  overdueCents: number;
  overdueCount: number;
}

export function revenueMetrics(
  subscriptions: Subscription[],
  invoices: Invoice[],
  now = new Date().toISOString(),
): RevenueMetrics {
  const active = subscriptions.filter(
    (s) => s.status === 'active' || s.status === 'trialing' || s.status === 'past_due',
  );

  const byPlan: Record<PlanId, number> = { essentiel: 0, pro: 0, premium: 0 };
  let mrrCents = 0;

  for (const subscription of active) {
    byPlan[subscription.plan] += 1;
    mrrCents += monthlyCents(subscription);
  }

  const overdue = invoices.filter(
    (i) => i.status === 'open' && new Date(i.dueAt).getTime() < new Date(now).getTime(),
  );

  return {
    activeSubscriptions: active.length,
    mrrCents,
    arrCents: mrrCents * 12,
    arpuCents: active.length === 0 ? 0 : Math.round(mrrCents / active.length),
    byPlan,
    overdueCents: overdue.reduce((acc, i) => acc + i.totalCents, 0),
    overdueCount: overdue.length,
  };
}

/** Montant mensuel récurrent d'un abonnement, add-ons compris. */
export function monthlyCents(subscription: Subscription): number {
  return quote({
    plan: subscription.plan,
    addons: subscription.addons,
    tags: subscription.tags,
    extraPlatforms: subscription.extraPlatforms,
    committed12Months: subscription.committed12Months,
  }).monthlyCentsExclVat;
}

/**
 * Attrition mensuelle observée : résiliations effectives du mois rapportées au
 * parc de début de mois. C'est l'hypothèse la plus sensible du modèle
 * financier — elle doit être mesurée, pas supposée.
 */
export function observedChurn(
  subscriptions: Subscription[],
  monthStart: string,
  monthEnd: string,
): { churned: number; atStart: number; rate: number } {
  const start = new Date(monthStart).getTime();
  const end = new Date(monthEnd).getTime();

  const atStart = subscriptions.filter((s) => {
    const started = new Date(s.startedAt).getTime();
    const ended = s.canceledAt ? new Date(s.canceledAt).getTime() : Number.POSITIVE_INFINITY;
    return started < start && ended >= start;
  }).length;

  const churned = subscriptions.filter((s) => {
    if (!s.canceledAt) return false;
    const ended = new Date(s.canceledAt).getTime();
    return ended >= start && ended < end;
  }).length;

  return { churned, atStart, rate: atStart === 0 ? 0 : Number((churned / atStart).toFixed(4)) };
}

const addDays = (iso: string, days: number): string =>
  new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
