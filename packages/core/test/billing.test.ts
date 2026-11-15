import { describe, expect, it } from 'vitest';
import {
  addMonths,
  buildInvoice,
  commitmentEndsAt,
  dunningAction,
  formatInvoiceNumber,
  latePenaltyCents,
  monthlyCents,
  nextPeriod,
  observedChurn,
  parseInvoiceNumber,
  planCancellation,
  prorationLines,
  revenueMetrics,
  type Invoice,
  type Subscription,
} from '../src/billing.js';

const subscription = (overrides: Partial<Subscription> = {}): Subscription => ({
  id: 'sub_1',
  establishmentId: 'est_1',
  plan: 'pro',
  addons: [],
  extraPlatforms: 0,
  tags: 3,
  committed12Months: true,
  status: 'active',
  startedAt: '2026-01-15T00:00:00.000Z',
  currentPeriodStart: '2026-09-15T00:00:00.000Z',
  currentPeriodEnd: '2026-10-15T00:00:00.000Z',
  ...overrides,
});

describe('addMonths', () => {
  it('avance d’un mois', () => {
    expect(addMonths('2026-01-15T00:00:00.000Z', 1)).toBe('2026-02-15T00:00:00.000Z');
  });

  it('cale le 31 sur le dernier jour du mois court', () => {
    // Sans ce calage, le 31 janvier + 1 mois donnerait le 3 mars et
    // l'abonnement dériverait de mois en mois.
    expect(addMonths('2026-01-31T00:00:00.000Z', 1)).toBe('2026-02-28T00:00:00.000Z');
    expect(addMonths('2026-03-31T00:00:00.000Z', 1)).toBe('2026-04-30T00:00:00.000Z');
  });

  it('gère une année bissextile', () => {
    expect(addMonths('2028-01-31T00:00:00.000Z', 1)).toBe('2028-02-29T00:00:00.000Z');
  });

  it('avance de douze mois', () => {
    expect(addMonths('2026-01-15T00:00:00.000Z', 12)).toBe('2027-01-15T00:00:00.000Z');
  });
});

describe('périodes et engagement', () => {
  it('enchaîne les périodes sans trou', () => {
    const period = nextPeriod(subscription());
    expect(period.start).toBe('2026-10-15T00:00:00.000Z');
    expect(period.end).toBe('2026-11-15T00:00:00.000Z');
  });

  it('calcule la fin d’engagement', () => {
    expect(commitmentEndsAt(subscription())).toBe('2027-01-15T00:00:00.000Z');
    expect(commitmentEndsAt(subscription({ committed12Months: false }))).toBeNull();
  });

  it('reporte la résiliation à la fin de l’engagement', () => {
    const outcome = planCancellation(subscription(), '2026-09-20T00:00:00.000Z');
    expect(outcome.deferredToCommitmentEnd).toBe(true);
    expect(outcome.effectiveAt).toBe('2027-01-15T00:00:00.000Z');
    expect(outcome.message).toContain('Engagement 12 mois');
  });

  it('résilie en fin de période sans engagement', () => {
    const outcome = planCancellation(
      subscription({ committed12Months: false }),
      '2026-09-20T00:00:00.000Z',
    );
    expect(outcome.deferredToCommitmentEnd).toBe(false);
    expect(outcome.effectiveAt).toBe('2026-10-15T00:00:00.000Z');
  });

  it('ne reporte plus une fois l’engagement écoulé', () => {
    const outcome = planCancellation(
      subscription({
        startedAt: '2024-01-15T00:00:00.000Z',
        currentPeriodEnd: '2026-10-15T00:00:00.000Z',
      }),
      '2026-09-20T00:00:00.000Z',
    );
    expect(outcome.deferredToCommitmentEnd).toBe(false);
  });
});

describe('numérotation', () => {
  it('formate un numéro séquentiel sur six chiffres', () => {
    expect(formatInvoiceNumber(2026, 1)).toBe('AVS-2026-000001');
    expect(formatInvoiceNumber(2026, 123456)).toBe('AVS-2026-123456');
  });

  it('relit un numéro', () => {
    expect(parseInvoiceNumber('AVS-2026-000042')).toEqual({ year: 2026, sequence: 42 });
    expect(parseInvoiceNumber('FACTURE-1')).toBeNull();
  });
});

describe('buildInvoice', () => {
  it('facture le seul récurrent en régime de croisière', () => {
    const invoice = buildInvoice({
      subscription: subscription(),
      periodStart: '2026-09-15T00:00:00.000Z',
      periodEnd: '2026-10-15T00:00:00.000Z',
      sequence: 12,
      issuedAt: '2026-09-15T06:00:00.000Z',
    });
    expect(invoice.number).toBe('AVS-2026-000012');
    expect(invoice.subtotalCents).toBe(7900);
    expect(invoice.vatCents).toBe(1580);
    expect(invoice.totalCents).toBe(9480);
    expect(invoice.lines).toHaveLength(1);
  });

  it('inclut les frais ponctuels sur la première facture', () => {
    const invoice = buildInvoice({
      subscription: subscription({ committed12Months: false, tags: 5 }),
      periodStart: '2026-09-15T00:00:00.000Z',
      periodEnd: '2026-10-15T00:00:00.000Z',
      sequence: 1,
      issuedAt: '2026-09-15T06:00:00.000Z',
      includeOneOff: true,
    });
    // 79 € abonnement + 2 plaquettes à 15 € + 49 € de mise en service
    expect(invoice.subtotalCents).toBe(7900 + 3000 + 4900);
    expect(invoice.lines.some((l) => l.kind === 'one_off')).toBe(true);
  });

  it('fixe une échéance à 15 jours', () => {
    const invoice = buildInvoice({
      subscription: subscription(),
      periodStart: '2026-09-15T00:00:00.000Z',
      periodEnd: '2026-10-15T00:00:00.000Z',
      sequence: 3,
      issuedAt: '2026-09-15T00:00:00.000Z',
    });
    expect(invoice.dueAt).toBe('2026-09-30T00:00:00.000Z');
  });

  it('ajoute les lignes supplémentaires fournies', () => {
    const invoice = buildInvoice({
      subscription: subscription(),
      periodStart: '2026-09-15T00:00:00.000Z',
      periodEnd: '2026-10-15T00:00:00.000Z',
      sequence: 4,
      issuedAt: '2026-09-15T00:00:00.000Z',
      extraLines: [
        { label: 'Avoir commercial', quantity: 1, unitCents: -1000, totalCents: -1000, kind: 'credit' },
      ],
    });
    expect(invoice.subtotalCents).toBe(6900);
  });

  it('utilise le même barème que le devis commercial', () => {
    const sub = subscription({ plan: 'premium', addons: ['analytics'], tags: 5 });
    const invoice = buildInvoice({
      subscription: sub,
      periodStart: '2026-09-15T00:00:00.000Z',
      periodEnd: '2026-10-15T00:00:00.000Z',
      sequence: 5,
      issuedAt: '2026-09-15T00:00:00.000Z',
    });
    // Analytics est compris dans Premium : jamais refacturé.
    expect(invoice.subtotalCents).toBe(14900);
    expect(monthlyCents(sub)).toBe(14900);
  });
});

describe('prorationLines', () => {
  it('crédite l’ancienne offre et facture la nouvelle au prorata', () => {
    const lines = prorationLines(
      2900,
      7900,
      '2026-09-01T00:00:00.000Z',
      '2026-10-01T00:00:00.000Z',
      '2026-09-16T00:00:00.000Z',
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]!.totalCents).toBeLessThan(0);
    expect(lines[1]!.totalCents).toBeGreaterThan(0);
    // Un peu moins de la moitié de la période reste à courir.
    expect(lines[1]!.totalCents).toBeCloseTo(3950, -2);
  });

  it('ne produit rien si le changement tombe à la fin de la période', () => {
    expect(
      prorationLines(
        2900,
        7900,
        '2026-09-01T00:00:00.000Z',
        '2026-10-01T00:00:00.000Z',
        '2026-10-01T00:00:00.000Z',
      ),
    ).toEqual([]);
  });
});

describe('recouvrement', () => {
  const invoice = (overrides: Partial<Invoice> = {}): Invoice => ({
    id: 'inv_1',
    number: 'AVS-2026-000001',
    establishmentId: 'est_1',
    subscriptionId: 'sub_1',
    status: 'open',
    periodStart: '2026-09-01T00:00:00.000Z',
    periodEnd: '2026-10-01T00:00:00.000Z',
    issuedAt: '2026-09-01T00:00:00.000Z',
    dueAt: '2026-09-16T00:00:00.000Z',
    lines: [],
    subtotalCents: 7900,
    vatCents: 1580,
    totalCents: 9480,
    remindersSent: 0,
    ...overrides,
  });

  it('ne relance pas une facture payée', () => {
    expect(dunningAction(invoice({ status: 'paid' }), '2026-12-01T00:00:00.000Z')).toEqual({
      action: 'none',
    });
  });

  it('ne relance pas avant l’échéance', () => {
    expect(dunningAction(invoice(), '2026-09-15T00:00:00.000Z')).toEqual({ action: 'none' });
  });

  it('relance au premier jour de retard', () => {
    const action = dunningAction(invoice(), '2026-09-17T00:00:00.000Z');
    expect(action.action).toBe('remind');
    if (action.action === 'remind') expect(action.stage).toBe(1);
  });

  it('n’envoie pas deux fois la même relance', () => {
    expect(
      dunningAction(invoice({ remindersSent: 1 }), '2026-09-17T00:00:00.000Z'),
    ).toEqual({ action: 'none' });
  });

  it('passe au dernier rappel puis à la suspension', () => {
    const third = dunningAction(invoice({ remindersSent: 2 }), '2026-10-02T00:00:00.000Z');
    expect(third.action).toBe('remind');
    if (third.action === 'remind') {
      expect(third.stage).toBe(3);
      // La landing NFC ne doit jamais être coupée : le message le dit au client.
      expect(third.body).toContain('plaquettes NFC de vos clients continueront');
    }

    const suspension = dunningAction(invoice({ remindersSent: 3 }), '2026-10-20T00:00:00.000Z');
    expect(suspension.action).toBe('suspend');
  });

  it('calcule les pénalités de retard au taux légal', () => {
    const penalty = latePenaltyCents(invoice(), '2026-10-16T00:00:00.000Z');
    // 30 jours de retard sur 94,80 € au taux de 10,26 %
    expect(penalty).toBe(Math.round((9480 * 0.1026 * 30) / 365));
    expect(latePenaltyCents(invoice(), '2026-09-10T00:00:00.000Z')).toBe(0);
  });
});

describe('indicateurs', () => {
  it('calcule MRR, ARR et ARPU sur le parc actif', () => {
    const metrics = revenueMetrics(
      [
        subscription({ id: 's1', plan: 'essentiel', tags: 1 }),
        subscription({ id: 's2', plan: 'pro', tags: 3 }),
        subscription({ id: 's3', plan: 'premium', tags: 5 }),
        subscription({ id: 's4', plan: 'pro', tags: 3, status: 'canceled' }),
      ],
      [],
    );
    expect(metrics.activeSubscriptions).toBe(3);
    expect(metrics.mrrCents).toBe(2900 + 7900 + 14900);
    expect(metrics.arrCents).toBe(metrics.mrrCents * 12);
    expect(metrics.byPlan).toEqual({ essentiel: 1, pro: 1, premium: 1 });
  });

  it('compte les impayés échus', () => {
    const metrics = revenueMetrics(
      [subscription()],
      [
        {
          id: 'inv_1',
          number: 'AVS-2026-000001',
          establishmentId: 'est_1',
          subscriptionId: 'sub_1',
          status: 'open',
          periodStart: '2026-08-01T00:00:00.000Z',
          periodEnd: '2026-09-01T00:00:00.000Z',
          issuedAt: '2026-08-01T00:00:00.000Z',
          dueAt: '2026-08-16T00:00:00.000Z',
          lines: [],
          subtotalCents: 7900,
          vatCents: 1580,
          totalCents: 9480,
          remindersSent: 1,
        },
      ],
      '2026-09-20T00:00:00.000Z',
    );
    expect(metrics.overdueCount).toBe(1);
    expect(metrics.overdueCents).toBe(9480);
  });

  it('mesure l’attrition observée sur un mois', () => {
    const churn = observedChurn(
      [
        subscription({ id: 'a', startedAt: '2026-01-01T00:00:00.000Z' }),
        subscription({ id: 'b', startedAt: '2026-01-01T00:00:00.000Z' }),
        subscription({
          id: 'c',
          startedAt: '2026-01-01T00:00:00.000Z',
          canceledAt: '2026-09-10T00:00:00.000Z',
          status: 'canceled',
        }),
        // Souscrit pendant le mois : ne compte pas dans le parc de départ.
        subscription({ id: 'd', startedAt: '2026-09-05T00:00:00.000Z' }),
      ],
      '2026-09-01T00:00:00.000Z',
      '2026-10-01T00:00:00.000Z',
    );
    expect(churn.atStart).toBe(3);
    expect(churn.churned).toBe(1);
    expect(churn.rate).toBeCloseTo(0.3333, 3);
  });
});
