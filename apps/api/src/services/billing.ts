/**
 * Service de facturation.
 *
 * Deux tâches planifiées :
 *  - `runBilling` : émet les factures des abonnements dont la période est
 *    échue, puis fait rouler la période. Idempotent — une période déjà
 *    facturée ne l'est pas deux fois.
 *
 *    Ce commentaire affirmait déjà l'idempotence avant le 21 septembre 2026,
 *    « parce que la période avance dans la même opération que l'émission ».
 *    Ce n'était pas le cas : c'étaient deux écritures séparées, sans
 *    transaction. Deux cycles qui se chevauchaient facturaient le même mois
 *    deux fois, avec deux numéros légaux valides. Reproduit contre
 *    PostgreSQL réel, 69,60 € au lieu de 34,80 €.
 *
 *    L'idempotence repose maintenant sur une contrainte d'unicité
 *    `(subscriptionId, periodStart)` et une vraie transaction, pas sur
 *    l'ordre des instructions. Une affirmation dans un commentaire ne
 *    protège personne.
 *  - `runDunning` : relances et suspension des impayés.
 *
 * L'encaissement passe par un port `PaymentProvider`. L'adaptateur fourni est
 * `manual` : la facture est émise et envoyée, le règlement est constaté par
 * l'exploitant depuis le back-office. Brancher un prestataire (Stripe Billing,
 * GoCardless pour le mandat SEPA) revient à écrire un second adaptateur —
 * aucune autre partie du code ne change.
 */

import {
  addMonths,
  buildInvoice,
  dunningAction,
  formatEuros,
  nextPeriod,
  planCancellation,
  prorationLines,
  revenueMetrics,
  monthlyCents,
  PLANS,
  type AddonId,
  type Establishment,
  type Invoice,
  type PlanId,
  type Subscription,
} from '@avisio/core';
import { generateId } from '@avisio/core';
import type { Repository } from '../repository/index.js';
import type { Notifier } from './notify.js';

export interface PaymentResult {
  status: 'paid' | 'pending' | 'failed';
  reference?: string;
  message: string;
}

export interface PaymentProvider {
  readonly name: string;
  charge(invoice: Invoice, establishment: Establishment): Promise<PaymentResult>;
}

/**
 * Adaptateur par défaut : aucun prélèvement automatique.
 *
 * C'est volontaire tant qu'aucun mandat SEPA n'est en place — prétendre
 * encaisser sans mandat valide serait pire qu'une facturation manuelle.
 */
export const manualPaymentProvider: PaymentProvider = {
  name: 'manual',
  async charge() {
    return {
      status: 'pending',
      message: 'Facture émise. Règlement à constater manuellement (virement ou SEPA hors ligne).',
    };
  },
};

export interface BillingReport {
  invoicesIssued: number;
  totalCents: number;
  /**
   * Périodes trouvées échues mais déjà facturées — cycle rejoué, cycle
   * concurrent, reprise après panne. Compté à part plutôt que passé sous
   * silence : un chiffre qui monte ici signale un ordonnanceur qui se
   * chevauche, ce qu'on veut voir avant que ce soit un incident.
   */
  alreadyBilled: number;
  errors: string[];
}

export interface DunningReport {
  remindersSent: number;
  suspended: number;
  errors: string[];
}

interface Deps {
  repo: Repository;
  notifier: Notifier;
  payments?: PaymentProvider;
  logger: { info: (msg: string) => void; warn: (msg: string) => void };
}

export function createBillingService(deps: Deps) {
  const { repo, notifier, logger } = deps;
  const payments = deps.payments ?? manualPaymentProvider;

  /**
   * Émet la facture d'une période et fait avancer l'abonnement.
   *
   * `created` vaut `false` quand la période était déjà facturée — appel
   * rejoué, cycle concurrent, reprise après panne. Rien n'a été écrit, et
   * l'appelant ne doit ni compter cette facture dans son rapport ni la
   * représenter au client.
   */
  async function invoiceSubscription(
    subscription: Subscription,
    now: string,
    options: { includeOneOff?: boolean } = {},
  ): Promise<{ invoice: Invoice; created: boolean }> {
    const year = new Date(now).getUTCFullYear();

    // Prorata d'un changement d'offre survenu pendant la période : il a été
    // mis en attente par `changePlan`, c'est ici qu'il devient facturable.
    const enAttente = await repo.pendingLines.listPending(subscription.id);

    const draft = buildInvoice({
      subscription,
      periodStart: subscription.currentPeriodStart,
      periodEnd: subscription.currentPeriodEnd,
      // Le numéro réel est attribué par le dépôt, dans la même transaction.
      sequence: 0,
      issuedAt: now,
      ...(enAttente.length > 0 ? { extraLines: enAttente.map((l) => l.line) } : {}),
      ...(options.includeOneOff ? { includeOneOff: true } : {}),
    });

    // Émission et avance de période dans une seule transaction, arbitrée par
    // la contrainte d'unicité `(subscriptionId, periodStart)`. Deux cycles
    // concurrents ne peuvent plus produire deux factures du même mois : le
    // perdant se voit rendre celle du gagnant.
    const period = nextPeriod(subscription);
    const { invoice, created } = await repo.invoices.issueForPeriod(
      draft,
      year,
      {
        subscriptionId: subscription.id,
        periodStart: period.start,
        periodEnd: period.end,
      },
      enAttente.map((l) => l.id),
    );

    // Déjà facturée : ni encaissement, ni courriel. Réencaisser ferait payer
    // deux fois, et renvoyer l'avis d'échéance inquiéterait un client qui a
    // déjà reçu le sien — pour beaucoup, un second avis veut dire impayé.
    if (!created) return { invoice, created: false };

    const establishment = await repo.establishments.findById(subscription.establishmentId);
    if (establishment) {
      const result = await payments.charge(invoice, establishment);
      if (result.status === 'paid') {
        await repo.invoices.update(invoice.id, {
          status: 'paid',
          paidAt: now,
          ...(result.reference ? { paymentReference: result.reference } : {}),
        });
      }
      for (const manager of await repo.managers.listByEstablishment(establishment.id)) {
        await notifier.billing(
          manager.email,
          establishment,
          `Facture ${invoice.number} — ${formatEuros(invoice.totalCents)} TTC`,
          `Votre facture ${invoice.number} pour la période du ${formatDate(invoice.periodStart)} au ${formatDate(invoice.periodEnd)} est disponible dans votre espace. Montant : ${formatEuros(invoice.totalCents)} TTC, à régler avant le ${formatDate(invoice.dueAt)}.`,
        );
      }
    }

    return { invoice, created: true };
  }

  return {
    invoiceSubscription,

    /** Souscription initiale : abonnement + première facture avec les frais. */
    async subscribe(input: {
      establishmentId: string;
      plan: PlanId;
      addons: AddonId[];
      extraPlatforms: number;
      tags: number;
      committed12Months: boolean;
      now?: string;
    }): Promise<{ subscription: Subscription; invoice: Invoice }> {
      const now = input.now ?? new Date().toISOString();
      const existing = await repo.subscriptions.findByEstablishment(input.establishmentId);
      if (existing) throw new Error('Cet établissement a déjà un abonnement.');

      const subscription = await repo.subscriptions.create({
        id: generateId('sub'),
        establishmentId: input.establishmentId,
        plan: input.plan,
        addons: input.addons,
        extraPlatforms: input.extraPlatforms,
        tags: input.tags,
        committed12Months: input.committed12Months,
        status: 'active',
        startedAt: now,
        currentPeriodStart: now,
        currentPeriodEnd: addMonths(now, 1),
      });

      const { invoice } = await invoiceSubscription(subscription, now, { includeOneOff: true });
      return { subscription, invoice };
    },

    /**
     * Changement d'offre en cours de période : le prorata est facturé sur la
     * facture suivante via des lignes d'avoir et de complément.
     */
    async changePlan(
      subscriptionId: string,
      plan: PlanId,
      addons: AddonId[],
      now = new Date().toISOString(),
    ): Promise<{ subscription: Subscription; prorationCents: number }> {
      const subscription = await repo.subscriptions.findById(subscriptionId);
      if (!subscription) throw new Error('Abonnement introuvable.');

      const before = monthlyCents(subscription);
      const updated = await repo.subscriptions.update(subscriptionId, { plan, addons });
      const after = monthlyCents(updated);

      const lines = prorationLines(
        before,
        after,
        subscription.currentPeriodStart,
        subscription.currentPeriodEnd,
        now,
      );

      // Mises en attente, pas jetées. Elles étaient calculées, affichées au
      // back-office, puis perdues à la fin de la requête : un client qui
      // montait en gamme le 3 du mois ne payait pas le complément, et un
      // client qui descendait ne recevait pas son avoir. Personne ne s'en
      // plaignait — c'est bien le problème d'un montant qui disparaît.
      if (lines.length > 0) await repo.pendingLines.add(subscriptionId, lines);

      await repo.establishments.update(subscription.establishmentId, { plan, addons });

      return {
        subscription: updated,
        prorationCents: lines.reduce((acc, line) => acc + line.totalCents, 0),
      };
    },

    async cancel(subscriptionId: string, now = new Date().toISOString()) {
      const subscription = await repo.subscriptions.findById(subscriptionId);
      if (!subscription) throw new Error('Abonnement introuvable.');
      const outcome = planCancellation(subscription, now);
      await repo.subscriptions.update(subscriptionId, {
        cancelAt: outcome.effectiveAt,
        canceledAt: now,
      });
      return outcome;
    },

    /** Constatation manuelle d'un règlement depuis le back-office. */
    async markPaid(invoiceId: string, reference: string, now = new Date().toISOString()) {
      const invoice = await repo.invoices.findById(invoiceId);
      if (!invoice) throw new Error('Facture introuvable.');

      const updated = await repo.invoices.update(invoiceId, {
        status: 'paid',
        paidAt: now,
        paymentReference: reference,
      });

      // Un règlement lève la suspension : le service reprend immédiatement.
      const subscription = await repo.subscriptions.findById(invoice.subscriptionId);
      if (subscription && (subscription.status === 'past_due' || subscription.status === 'suspended')) {
        const stillOverdue = (await repo.invoices.listOverdue(now)).filter(
          (i) => i.subscriptionId === subscription.id && i.id !== invoiceId,
        );
        if (stillOverdue.length === 0) {
          await repo.subscriptions.update(subscription.id, { status: 'active' });
        }
      }

      return updated;
    },

    /** Cycle de facturation : toutes les périodes échues. */
    async runBilling(now = new Date().toISOString()): Promise<BillingReport> {
      const due = await repo.subscriptions.listDue(now);
      const report: BillingReport = {
        invoicesIssued: 0,
        totalCents: 0,
        alreadyBilled: 0,
        errors: [],
      };

      for (const subscription of due) {
        if (subscription.cancelAt && new Date(subscription.cancelAt).getTime() <= new Date(now).getTime()) {
          // Résiliation arrivée à terme : on arrête sans facturer la période.
          await repo.subscriptions.update(subscription.id, { status: 'canceled' });
          continue;
        }
        try {
          const { invoice, created } = await invoiceSubscription(subscription, now);
          // Une période déjà facturée ne gonfle pas le rapport : sinon un
          // cycle rejoué afficherait un chiffre d'affaires qui n'existe pas.
          if (created) {
            report.invoicesIssued += 1;
            report.totalCents += invoice.totalCents;
          } else {
            report.alreadyBilled += 1;
          }
        } catch (error) {
          report.errors.push(`${subscription.establishmentId}: ${(error as Error).message}`);
        }
      }

      if (report.invoicesIssued > 0) {
        logger.info(
          `Facturation : ${report.invoicesIssued} facture(s), ${formatEuros(report.totalCents)} TTC.`,
        );
      }
      return report;
    },

    /** Relances et suspensions. */
    async runDunning(now = new Date().toISOString()): Promise<DunningReport> {
      const overdue = await repo.invoices.listOverdue(now);
      const report: DunningReport = { remindersSent: 0, suspended: 0, errors: [] };

      for (const invoice of overdue) {
        const action = dunningAction(invoice, now);
        if (action.action === 'none') continue;

        const establishment = await repo.establishments.findById(invoice.establishmentId);
        if (!establishment) continue;

        try {
          if (action.action === 'remind') {
            for (const manager of await repo.managers.listByEstablishment(establishment.id)) {
              await notifier.billing(manager.email, establishment, action.subject, action.body);
            }
            await repo.invoices.update(invoice.id, { remindersSent: action.stage });
            await repo.subscriptions
              .findById(invoice.subscriptionId)
              .then((sub) =>
                sub && sub.status === 'active'
                  ? repo.subscriptions.update(sub.id, { status: 'past_due' })
                  : null,
              );
            report.remindersSent += 1;
          } else {
            await repo.subscriptions.update(invoice.subscriptionId, { status: 'suspended' });
            logger.warn(`Abonnement suspendu : ${action.reason}`);
            report.suspended += 1;
          }
        } catch (error) {
          report.errors.push(`${invoice.number}: ${(error as Error).message}`);
        }
      }

      return report;
    },

    /** Indicateurs consolidés du back-office. */
    async metrics(now = new Date().toISOString()) {
      const [subscriptions, invoices] = await Promise.all([
        repo.subscriptions.listAll(),
        repo.invoices.listAll(),
      ]);
      const base = revenueMetrics(subscriptions, invoices, now);
      return {
        ...base,
        mrrLabel: formatEuros(base.mrrCents),
        arrLabel: formatEuros(base.arrCents),
        arpuLabel: formatEuros(base.arpuCents),
        overdueLabel: formatEuros(base.overdueCents),
        planPrices: Object.fromEntries(
          Object.values(PLANS).map((plan) => [plan.id, plan.monthlyCents]),
        ),
      };
    },
  };
}

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
