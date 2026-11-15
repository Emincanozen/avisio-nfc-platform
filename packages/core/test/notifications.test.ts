import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFERENCES,
  digestTitle,
  endOfQuietHours,
  isQuietHour,
  planDelivery,
  shouldBatch,
  type NotificationPreferences,
} from '../src/notifications.js';
import {
  buildHighlights,
  formatDelta,
  plural,
  previousMonthPeriod,
  renderReportHtml,
} from '../src/report.js';
import { decideInvitation, invitationMessage, posStats, type PosTicket } from '../src/pos.js';

const prefs = (overrides: Partial<NotificationPreferences> = {}): NotificationPreferences => ({
  ...DEFAULT_PREFERENCES('est_1'),
  ...overrides,
});

describe('planDelivery', () => {
  const midday = '2026-09-17T12:00:00.000Z'; // 14 h heure locale (UTC+2)
  const night = '2026-09-17T21:30:00.000Z'; // 23 h 30 heure locale

  it('envoie sur tous les canaux configurés en journée', () => {
    const plan = planDelivery(prefs(), 'negative_review', midday);
    expect(plan.channels).toEqual(['email', 'push']);
    expect(plan.deferPushUntil).toBeUndefined();
  });

  it('diffère le push pendant les heures calmes, pas l’e-mail', () => {
    const plan = planDelivery(prefs(), 'negative_review', night);
    expect(plan.channels).toEqual(['email']);
    expect(plan.deferPushUntil).toBeTruthy();
    expect(plan.reason).toContain('Heures calmes');
  });

  it('respecte un canal désactivé par le gérant', () => {
    const plan = planDelivery(
      prefs({
        channels: { ...DEFAULT_PREFERENCES('est_1').channels, negative_review: ['push'] },
      }),
      'negative_review',
      midday,
    );
    expect(plan.channels).toEqual(['push']);
  });

  it('n’envoie rien quand tous les canaux sont coupés', () => {
    const plan = planDelivery(
      prefs({ channels: { ...DEFAULT_PREFERENCES('est_1').channels, theme_trend: [] } }),
      'theme_trend',
      midday,
    );
    expect(plan.channels).toEqual([]);
  });

  it('bloque un événement non compris dans l’offre', () => {
    const plan = planDelivery(prefs(), 'negative_review', midday, false);
    expect(plan.channels).toEqual([]);
    expect(plan.reason).toContain("l'offre");
  });

  it('laisse toujours passer les messages de facturation', () => {
    const plan = planDelivery(
      prefs({ channels: { ...DEFAULT_PREFERENCES('est_1').channels, billing: [] } }),
      'billing',
      night,
      false,
    );
    expect(plan.channels).toContain('email');
  });

  it('ignore les heures calmes pour la facturation', () => {
    const plan = planDelivery(prefs(), 'billing', night);
    expect(plan.deferPushUntil).toBeUndefined();
  });
});

describe('heures calmes', () => {
  it('reconnaît une plage qui traverse minuit', () => {
    // 22 h → 8 h locales, avec UTC+2
    expect(isQuietHour('2026-09-17T21:00:00.000Z', prefs())).toBe(true); // 23 h
    expect(isQuietHour('2026-09-17T03:00:00.000Z', prefs())).toBe(true); // 5 h
    expect(isQuietHour('2026-09-17T08:00:00.000Z', prefs())).toBe(false); // 10 h
  });

  it('calcule la fin des heures calmes au matin suivant', () => {
    const end = endOfQuietHours('2026-09-17T21:30:00.000Z', prefs());
    // 8 h locales le 18 = 6 h UTC
    expect(end).toBe('2026-09-18T06:00:00.000Z');
  });

  it('n’a pas d’heures calmes quand elles sont désactivées', () => {
    expect(isQuietHour('2026-09-17T23:00:00.000Z', prefs({ quietHours: null }))).toBe(false);
  });
});

describe('regroupement', () => {
  it('regroupe les alertes rapprochées', () => {
    expect(shouldBatch('2026-09-17T12:00:00.000Z', '2026-09-17T12:05:00.000Z')).toBe(true);
    expect(shouldBatch('2026-09-17T12:00:00.000Z', '2026-09-17T12:30:00.000Z')).toBe(false);
    expect(shouldBatch(undefined, '2026-09-17T12:00:00.000Z')).toBe(false);
  });

  it('accorde le titre au nombre', () => {
    expect(digestTitle(1, 'Le Comptoir')).toContain('un avis');
    expect(digestTitle(4, 'Le Comptoir')).toContain('4 avis');
  });
});

describe('rapport mensuel', () => {
  const base = {
    establishmentName: 'Le Comptoir des Minimes',
    period: previousMonthPeriod(new Date('2026-09-17T00:00:00.000Z')),
    averageRating: 4.3,
    ratingDelta: 0.2,
    reviewCount: 24,
    reviewCountDelta: 6,
    negativeCount: 3,
    replyRate: 0.9,
    medianReplyDelayHours: 8,
    scans: 210,
    scanToReviewRate: 0.11,
    loyaltyMembers: 34,
    topThemes: [
      { theme: 'accueil' as const, label: 'Accueil', mentions: 9, averageRating: 4.8 },
      { theme: 'attente' as const, label: "Temps d'attente", mentions: 4, averageRating: 2.2 },
    ],
    platforms: [
      { label: 'Google', reviewCount: 412, share: 91 },
      { label: 'TheFork', reviewCount: 3, share: 1 },
    ],
  };

  it('calcule la période du mois précédent', () => {
    const period = previousMonthPeriod(new Date('2026-09-17T00:00:00.000Z'));
    expect(period.start).toBe('2026-08-01T00:00:00.000Z');
    expect(period.end).toBe('2026-09-01T00:00:00.000Z');
    expect(period.label).toContain('août');
  });

  it('commence par ce qui va bien', () => {
    const highlights = buildHighlights(base);
    expect(highlights[0]?.kind).toBe('win');
    expect(highlights.length).toBeGreaterThan(1);
    expect(highlights.length).toBeLessThanOrEqual(5);
  });

  it('signale un thème mal noté', () => {
    const highlights = buildHighlights(base);
    expect(highlights.some((h) => h.kind === 'watch' && h.text.includes("attente"))).toBe(true);
  });

  it('demande de répondre quand le taux est faible', () => {
    const highlights = buildHighlights({ ...base, replyRate: 0.4 });
    expect(highlights.some((h) => h.kind === 'action' && h.text.includes('réponse'))).toBe(true);
  });

  it('pointe une plateforme sous-représentée', () => {
    const highlights = buildHighlights(base);
    expect(highlights.some((h) => h.text.includes('TheFork'))).toBe(true);
  });

  it('n’invente pas de progression quand il n’y a pas de base de comparaison', () => {
    // Régression : un premier mois de suivi affichait « +4,33 vs mois
    // précédent » parce que la moyenne du mois absent valait zéro.
    const highlights = buildHighlights({ ...base, ratingDelta: null, reviewCountDelta: null });
    expect(highlights[0]?.text).toContain('Premier mois de suivi');
    expect(highlights.some((h) => h.text.includes('vs mois précédent'))).toBe(false);
    expect(highlights.some((h) => h.text.includes('de plus que le mois précédent'))).toBe(false);
  });

  it('formate les nombres à la française', () => {
    const html = renderReportHtml({ ...base, highlights: buildHighlights(base) });
    expect(html).toContain('4,30');
    expect(html).not.toContain('4.30');
    expect(formatDelta(0.2)).toBe('+0,20 vs mois précédent');
    expect(formatDelta(null)).toBe('premier mois de suivi');
    expect(formatDelta(0)).toBe('stable');
  });

  it('accorde les pluriels', () => {
    expect(plural(1, 'négatif')).toBe('1 négatif');
    expect(plural(3, 'négatif')).toBe('3 négatifs');
    expect(plural(0, 'négatif')).toBe('0 négatif');
    expect(plural(2, 'membre fidélité', 'membres fidélité')).toBe('2 membres fidélité');
  });

  it('évite les caractères absents de l’encodage des PDF', () => {
    // La police Helvetica de PDFKit est en WinAnsi : « → » y sort en
    // caractères parasites. Le libellé doit rester lisible sur le PDF.
    const html = renderReportHtml({ ...base, highlights: [] });
    expect(html).not.toContain('→');
  });

  it('produit un HTML complet et échappé', () => {
    const html = renderReportHtml({
      ...base,
      establishmentName: 'Bistrot <script>',
      highlights: buildHighlights(base),
    });
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('Bistrot &lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('Rapport de réputation');
  });
});

describe('intégration caisse', () => {
  const ticket = (overrides: Partial<PosTicket> = {}): PosTicket => ({
    externalId: 'tk_1',
    establishmentId: 'est_1',
    closedAt: '2026-09-17T12:00:00.000Z',
    totalCents: 4200,
    contact: 'client@test.fr',
    contactChannel: 'email',
    ...overrides,
  });

  it('programme l’invitation deux heures après la clôture', () => {
    const decision = decideInvitation(ticket(), { entitled: true, alreadyProcessed: false });
    expect(decision.invite).toBe(true);
    if (decision.invite) expect(decision.sendAt).toBe('2026-09-17T14:00:00.000Z');
  });

  it('refuse sans le droit correspondant', () => {
    const decision = decideInvitation(ticket(), { entitled: false, alreadyProcessed: false });
    expect(decision.invite).toBe(false);
    expect(decision.reason).toContain('Premium');
  });

  it('est idempotent sur un ticket déjà traité', () => {
    expect(
      decideInvitation(ticket(), { entitled: true, alreadyProcessed: true }).invite,
    ).toBe(false);
  });

  it('accepte un ticket sans contact sans le traiter comme un échec', () => {
    const decision = decideInvitation(
      ticket({ contact: undefined, contactChannel: undefined }),
      { entitled: true, alreadyProcessed: false },
    );
    expect(decision.invite).toBe(false);
    expect(decision.reason).toContain('QR');
  });

  it('respecte la carence entre deux invitations', () => {
    const decision = decideInvitation(
      ticket(),
      {
        entitled: true,
        alreadyProcessed: false,
        lastInvitedAt: '2026-09-01T12:00:00.000Z',
      },
      '2026-09-17T12:00:00.000Z',
    );
    expect(decision.invite).toBe(false);
    expect(decision.reason).toContain('carence');
  });

  it('réinvite après la carence', () => {
    const decision = decideInvitation(
      ticket(),
      {
        entitled: true,
        alreadyProcessed: false,
        lastInvitedAt: '2026-07-01T12:00:00.000Z',
      },
      '2026-09-17T12:00:00.000Z',
    );
    expect(decision.invite).toBe(true);
  });

  it('ne décide jamais selon le montant du ticket', () => {
    const small = decideInvitation(ticket({ totalCents: 350 }), {
      entitled: true,
      alreadyProcessed: false,
    });
    const large = decideInvitation(ticket({ externalId: 'tk_2', totalCents: 28000 }), {
      entitled: true,
      alreadyProcessed: false,
    });
    expect(small.invite).toBe(large.invite);
  });

  it('tient un SMS en 160 caractères', () => {
    const message = invitationMessage(
      'Le Comptoir des Minimes et sa très longue enseigne',
      'https://avis.io/s/k7m2p9qa',
      'sms',
    );
    expect(message.body.length).toBeLessThanOrEqual(160);
    expect(message.subject).toBeUndefined();
  });

  it('annonce l’absence de filtrage dans l’e-mail', () => {
    const message = invitationMessage('Le Comptoir', 'https://avis.io/s/k7m2p9qa', 'email');
    expect(message.subject).toBeTruthy();
    expect(message.body).toContain('nous ne filtrons aucun avis');
  });

  it('calcule le panier moyen', () => {
    const stats = posStats([ticket({ totalCents: 3000 }), ticket({ totalCents: 5000 })], 1);
    expect(stats.averageTicketCents).toBe(4000);
    expect(stats.inviteRate).toBe(0.5);
    expect(posStats([], 0).averageTicketCents).toBe(0);
  });
});
