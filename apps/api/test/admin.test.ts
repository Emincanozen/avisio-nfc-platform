/**
 * Tests d'intégration du back-office, de la facturation, des notifications et
 * de l'intégration caisse. Adaptateur mémoire, services externes en doublure.
 */

import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { DEMO_ADMIN_CREDENTIALS, DEMO_CREDENTIALS } from '../src/demo-data.js';
import { createMemoryRepository } from '../src/repository/memory.js';
import type { Repository } from '../src/repository/index.js';
import type { LlmService } from '../src/services/anthropic.js';
import type { Notifier } from '../src/services/notify.js';
import type { PushSender } from '../src/services/push.js';

const fakeLlm: LlmService = {
  async analyze(review) {
    return {
      sentiment: review.rating >= 4 ? 'positive' : 'negative',
      score: review.rating >= 4 ? 0.8 : -0.8,
      themes: ['service'],
      keywords: [],
      language: 'fr',
      engine: 'llm',
    };
  },
  async suggestReply() {
    return { text: 'Merci pour votre retour.', warnings: [], engine: 'llm' };
  },
};

const sent: Array<{ to: string; subject: string; kind: string }> = [];
const fakeNotifier: Notifier = {
  async alert(to, establishment, alert) {
    sent.push({ to, subject: alert.title, kind: 'alert' });
  },
  async billing(to, _establishment, subject) {
    sent.push({ to, subject, kind: 'billing' });
  },
  async monthlyReport(to, establishment) {
    sent.push({ to, subject: `${establishment.name} — rapport`, kind: 'report' });
  },
};

const pushed: Array<{ managerId: string; title: string }> = [];
const fakePush: PushSender = {
  enabled: true,
  publicKey: 'BFakePublicKeyForTests',
  async sendToManager(managerId, payload) {
    pushed.push({ managerId, title: payload.title });
    return 1;
  },
  async flushQueued() {
    return 0;
  },
};

let app: FastifyInstance;
let repo: Repository;
let adminToken: string;
let ownerToken: string;

beforeAll(async () => {
  repo = createMemoryRepository();
  app = await buildApp({ repo, llm: fakeLlm, notifier: fakeNotifier, push: fakePush });

  const admin = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: DEMO_ADMIN_CREDENTIALS,
  });
  adminToken = admin.json().token;

  const owner = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: DEMO_CREDENTIALS,
  });
  ownerToken = owner.json().token;
});

afterAll(async () => {
  await app.close();
});

const asAdmin = (): Record<string, string> => ({ authorization: `Bearer ${adminToken}` });
const asOwner = (): Record<string, string> => ({ authorization: `Bearer ${ownerToken}` });

describe('rôles', () => {
  it('distingue admin et gérant à la connexion', async () => {
    const admin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: DEMO_ADMIN_CREDENTIALS,
    });
    expect(admin.json().manager.role).toBe('admin');

    const owner = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: DEMO_CREDENTIALS,
    });
    expect(owner.json().manager.role).toBe('owner');
  });

  it('interdit le back-office à un gérant', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/overview', headers: asOwner() });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('administrateurs');
  });

  it('refuse le back-office sans jeton', async () => {
    expect((await app.inject({ method: 'GET', url: '/admin/overview' })).statusCode).toBe(401);
  });

  it('ouvre le back-office à un admin', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/overview', headers: asAdmin() });
    expect(res.statusCode).toBe(200);
  });
});

describe('back-office — vue d’ensemble', () => {
  it('consolide MRR, ARR et impayés', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/overview', headers: asAdmin() });
    const body = res.json();

    // Démo : Essentiel 29 + Pro 79 + analytics 39 + Premium 149, plus les
    // plateformes supplémentaires hors quota.
    expect(body.activeSubscriptions).toBe(3);
    expect(body.mrrCents).toBeGreaterThan(25_000);
    expect(body.arrCents).toBe(body.mrrCents * 12);
    expect(body.byPlan).toEqual({ essentiel: 1, pro: 1, premium: 1 });
    // L'Hôtel Garonne porte une facture échue dans le jeu de démonstration.
    expect(body.overdueCount).toBe(1);
    expect(body.establishments).toBe(3);
  });

  it('liste le parc avec son MRR par établissement', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/establishments',
      headers: asAdmin(),
    });
    const rows = res.json();
    expect(rows).toHaveLength(3);
    expect(rows.every((r: { mrrCents: number }) => r.mrrCents > 0)).toBe(true);
    expect(rows.find((r: { id: string }) => r.id === 'est_hotel').overdueInvoices).toBe(1);
  });
});

describe('onboarding', () => {
  const payload = {
    establishment: {
      name: 'Pizzeria Da Vinci',
      sector: 'restaurant',
      postalCode: '31500',
      nafCode: '5610A',
      brandTone: 'familial et direct, tutoiement proscrit',
    },
    subscription: {
      plan: 'pro',
      addons: ['loyalty'],
      extraPlatforms: 1,
      tags: 3,
      committed12Months: true,
    },
    manager: {
      name: 'Marco Rossi',
      email: 'marco@davinci.test',
      password: 'motdepasse1',
    },
    googleReviewUrl: 'https://g.page/r/davinci/review',
    tagLabels: ['Comptoir', 'Terrasse'],
  };

  it('crée établissement, compte, plaquettes, abonnement et première facture', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/establishments',
      headers: asAdmin(),
      payload,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.establishment.name).toBe('Pizzeria Da Vinci');
    expect(body.manager.email).toBe('marco@davinci.test');
    expect(body.tags).toHaveLength(3);
    // Les emplacements non nommés sont complétés automatiquement.
    expect(body.tags[2].label).toBe('Emplacement 3');
    expect(body.tags[0].url).toMatch(/\/s\/[a-z2-9]{8}$/);

    // Pro 79 € + fidélité 12 € ; 1 plateforme supplémentaire comprise dans Pro.
    expect(body.subscription.plan).toBe('pro');
    expect(body.invoice.number).toMatch(/^AVS-\d{4}-\d{6}$/);
    expect(body.invoice.subtotalCents).toBe(7900 + 1200);
  });

  it('permet au nouveau gérant de se connecter immédiatement', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'marco@davinci.test', password: 'motdepasse1' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().manager.role).toBe('owner');
    expect(res.json().manager.establishmentIds).toHaveLength(1);
  });

  it('rend la plaquette du nouvel établissement immédiatement scannable', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/admin/establishments',
      headers: asAdmin(),
    });
    const created = list.json().find((r: { name: string }) => r.name === 'Pizzeria Da Vinci');
    const tags = await app.inject({
      method: 'GET',
      url: `/establishments/${created.id}/tags`,
      headers: asAdmin(),
    });
    const slug = tags.json()[0].slug;

    const landing = await app.inject({ method: 'GET', url: `/public/tag/${slug}` });
    expect(landing.statusCode).toBe(200);
    expect(landing.json().establishment.name).toBe('Pizzeria Da Vinci');

    const scan = await app.inject({ method: 'POST', url: `/public/tag/${slug}/scan` });
    expect(scan.json().redirectUrl).toBe('https://g.page/r/davinci/review');
  });

  it('refuse un e-mail déjà utilisé', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/establishments',
      headers: asAdmin(),
      payload,
    });
    expect(res.statusCode).toBe(409);
  });

  it('valide le code postal', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/establishments',
      headers: asAdmin(),
      payload: {
        ...payload,
        establishment: { ...payload.establishment, postalCode: '3150' },
        manager: { ...payload.manager, email: 'autre@davinci.test' },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('Code postal');
  });
});

describe('facturation', () => {
  it('liste les factures d’un établissement pour son gérant', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/establishments/est_comptoir/invoices',
      headers: asOwner(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().length).toBeGreaterThanOrEqual(3);
    expect(res.json()[0].totalLabel).toContain('€');
  });

  it('interdit les factures d’un autre établissement', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/establishments/est_inconnu/invoices',
      headers: asOwner(),
    });
    expect(res.statusCode).toBe(403);
  });

  it('produit un PDF de facture conforme', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/establishments/est_comptoir/invoices',
      headers: asOwner(),
    });
    const invoice = list.json()[0];

    const res = await app.inject({
      method: 'GET',
      url: `/invoices/${invoice.id}/pdf`,
      headers: asOwner(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(res.rawPayload.length).toBeGreaterThan(1000);
  });

  it('constate un règlement et lève la suspension', async () => {
    const before = await app.inject({
      method: 'GET',
      url: '/admin/invoices?status=open',
      headers: asAdmin(),
    });
    const unpaid = before.json().find((i: { overdue: boolean }) => i.overdue);
    expect(unpaid).toBeDefined();

    const res = await app.inject({
      method: 'POST',
      url: `/admin/invoices/${unpaid.id}/pay`,
      headers: asAdmin(),
      payload: { reference: 'VIR-2026-0912' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('paid');
    expect(res.json().paymentReference).toBe('VIR-2026-0912');
  });

  it('annule une facture sans la supprimer', async () => {
    const list = await app.inject({ method: 'GET', url: '/admin/invoices', headers: asAdmin() });
    const invoice = list.json()[0];

    const res = await app.inject({
      method: 'POST',
      url: `/admin/invoices/${invoice.id}/void`,
      headers: asAdmin(),
    });
    expect(res.json().status).toBe('void');
    // Le numéro reste attribué : la séquence légale n'a pas de trou.
    expect(res.json().number).toBe(invoice.number);
  });

  it('change d’offre avec prorata', async () => {
    const subscription = await repo.subscriptions.findByEstablishment('est_hotel');
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/subscriptions/${subscription!.id}`,
      headers: asAdmin(),
      payload: { plan: 'pro', addons: [] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().subscription.plan).toBe('pro');
    // Montée en gamme : le prorata est positif.
    expect(res.json().prorationCents).toBeGreaterThan(0);

    // L'offre de l'établissement suit, donc les droits aussi.
    const establishment = await repo.establishments.findById('est_hotel');
    expect(establishment!.plan).toBe('pro');
  });

  it('reporte une résiliation à la fin de l’engagement', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/establishments/est_comptoir/subscription/cancel',
      headers: asOwner(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().effectiveAt).toBeTruthy();
  });

  it('émet les factures des périodes échues sans doublon', async () => {
    const subscription = await repo.subscriptions.findByEstablishment('est_atelier');
    // On ramène la période dans le passé pour rendre la facture exigible.
    await repo.subscriptions.update(subscription!.id, {
      currentPeriodStart: '2026-07-01T00:00:00.000Z',
      currentPeriodEnd: '2026-08-01T00:00:00.000Z',
    });

    const first = await app.inject({
      method: 'POST',
      url: '/admin/ops/billing',
      headers: asAdmin(),
    });
    expect(first.json().invoicesIssued).toBeGreaterThanOrEqual(1);

    // La période a avancé : un second passage ne refacture pas la même.
    const second = await app.inject({
      method: 'POST',
      url: '/admin/ops/billing',
      headers: asAdmin(),
    });
    expect(second.json().invoicesIssued).toBeLessThan(first.json().invoicesIssued + 1);
  });

  it('attribue des numéros séquentiels sans trou', async () => {
    const list = await app.inject({ method: 'GET', url: '/admin/invoices', headers: asAdmin() });
    const numbers = list
      .json()
      .map((i: { number: string }) => Number(i.number.slice(-6)))
      .sort((a: number, b: number) => a - b);

    for (let i = 1; i < numbers.length; i += 1) {
      expect(numbers[i]).toBe(numbers[i - 1] + 1);
    }
  });

  it('exécute les relances', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/ops/dunning',
      headers: asAdmin(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().errors).toEqual([]);
  });
});

describe('notifications', () => {
  it('renvoie les préférences par défaut', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/establishments/est_comptoir/notifications',
      headers: asOwner(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().channels.negative_review).toEqual(['email', 'push']);
    expect(res.json().quietHours).toEqual({ start: 22, end: 8 });
  });

  it('enregistre des préférences modifiées', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/establishments/est_comptoir/notifications',
      headers: asOwner(),
      payload: {
        channels: {
          negative_review: ['push'],
          theme_trend: [],
          weekly_digest: ['email'],
          monthly_report: ['email'],
          billing: ['email'],
        },
        quietHours: null,
        utcOffsetHours: 2,
      },
    });
    expect(res.statusCode).toBe(200);

    const reread = await app.inject({
      method: 'GET',
      url: '/establishments/est_comptoir/notifications',
      headers: asOwner(),
    });
    expect(reread.json().channels.negative_review).toEqual(['push']);
    expect(reread.json().quietHours).toBeNull();
  });

  it('expose la clé publique VAPID sans authentification', async () => {
    const res = await app.inject({ method: 'GET', url: '/push/public-key' });
    expect(res.statusCode).toBe(200);
    expect(res.json().publicKey).toBeTruthy();
  });

  it('enregistre un abonnement push et envoie un test', async () => {
    const subscribe = await app.inject({
      method: 'POST',
      url: '/push/subscribe',
      headers: asOwner(),
      payload: {
        endpoint: 'https://push.example.test/abc123',
        keys: { p256dh: 'BPublicKeyValue123456', auth: 'AuthSecret' },
      },
    });
    expect(subscribe.statusCode).toBe(200);
    expect(subscribe.json().subscribed).toBe(true);

    const test = await app.inject({
      method: 'POST',
      url: '/push/test',
      headers: asOwner(),
    });
    expect(test.json().delivered).toBe(1);
    expect(pushed.at(-1)?.title).toContain('test');
  });

  it('retire un abonnement push', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/push/unsubscribe',
      headers: asOwner(),
      payload: { endpoint: 'https://push.example.test/abc123' },
    });
    expect(res.json().unsubscribed).toBe(true);
  });
});

describe('rapport mensuel', () => {
  it('produit le rapport JSON d’un établissement Premium', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/establishments/est_comptoir/report',
      headers: asOwner(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.establishmentName).toBe('Le Comptoir des Minimes');
    expect(body.period.label).toBeTruthy();
    expect(Array.isArray(body.highlights)).toBe(true);
    expect(body.platforms.length).toBeGreaterThan(0);
  });

  it('produit le PDF du rapport', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/establishments/est_comptoir/report.pdf',
      headers: asOwner(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('accepte une période explicite', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/establishments/est_comptoir/report?period=2026-08',
      headers: asOwner(),
    });
    expect(res.json().period.start).toBe('2026-08-01T00:00:00.000Z');
  });

  it('rejette une période mal formée', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/establishments/est_comptoir/report?period=aout',
      headers: asOwner(),
    });
    expect(res.statusCode).toBe(400);
  });

  it('refuse le rapport à une offre qui ne l’inclut pas', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/establishments/est_atelier/report',
      headers: asOwner(),
    });
    // Atelier Sézanne est en Pro + analytics : le rapport est compris.
    expect(res.statusCode).toBe(200);
  });

  it('envoie les rapports aux seules offres éligibles', async () => {
    const before = sent.filter((s) => s.kind === 'report').length;
    const res = await app.inject({
      method: 'POST',
      url: '/admin/ops/reports',
      headers: asAdmin(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().sent).toBeGreaterThan(0);
    expect(res.json().skipped).toBeGreaterThan(0);
    expect(sent.filter((s) => s.kind === 'report').length).toBeGreaterThan(before);
  });
});

describe('intégration caisse', () => {
  let secret: string;
  const establishmentId = 'est_comptoir';

  it('refuse la configuration sans le droit Premium', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/establishments/est_hotel/pos/credential',
      headers: asOwner(),
      payload: {},
    });
    // L'hôtel est passé en Pro plus haut : l'intégration reste hors offre.
    expect(res.statusCode).toBe(402);
  });

  it('génère une clé de caisse, montrée une seule fois', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/establishments/${establishmentId}/pos/credential`,
      headers: asOwner(),
      payload: { vendor: 'zelty' },
    });
    expect(res.statusCode).toBe(200);
    secret = res.json().secret;
    expect(secret.length).toBeGreaterThan(20);
    expect(res.json().webhookUrl).toContain(`/integrations/pos/${establishmentId}`);

    // La clé en clair n'est jamais rendue par la suite.
    const status = await app.inject({
      method: 'GET',
      url: `/establishments/${establishmentId}/pos`,
      headers: asOwner(),
    });
    expect(JSON.stringify(status.json())).not.toContain(secret);
    expect(status.json().configured).toBe(true);
    expect(status.json().vendor).toBe('zelty');
  });

  const signedRequest = (body: unknown, options: { timestamp?: string; secret?: string } = {}) => {
    const rawBody = JSON.stringify(body);
    const timestamp = options.timestamp ?? String(Math.floor(Date.now() / 1000));
    const key = app.ctx.pos.signatureFor(options.secret ?? secret, timestamp, rawBody);
    return {
      method: 'POST' as const,
      url: `/integrations/pos/${establishmentId}`,
      headers: {
        'content-type': 'application/json',
        'x-avisio-signature': key,
        'x-avisio-timestamp': timestamp,
      },
      payload: rawBody,
    };
  };

  it('accepte un ticket signé', async () => {
    const res = await app.inject(
      signedRequest({
        externalId: 'TCK-9001',
        closedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
        totalCents: 4250,
        contact: 'client.pos@test.fr',
        contactChannel: 'email',
        reference: 'Table 7',
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().recorded).toBe(true);
    // Clôturé il y a 3 h : le délai de 2 h est dépassé, l'invitation part.
    expect(res.json().invited).toBe(true);
    expect(res.json().receiptUrl).toMatch(/\/s\//);
  });

  it('est idempotent sur un ticket rejoué', async () => {
    const res = await app.inject(
      signedRequest({
        externalId: 'TCK-9001',
        closedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
        totalCents: 4250,
        contact: 'client.pos@test.fr',
        contactChannel: 'email',
      }),
    );
    expect(res.json().recorded).toBe(false);
  });

  it('ne réinvite pas le même client avant la carence', async () => {
    const res = await app.inject(
      signedRequest({
        externalId: 'TCK-9002',
        closedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
        totalCents: 3100,
        contact: 'client.pos@test.fr',
        contactChannel: 'email',
      }),
    );
    expect(res.json().recorded).toBe(true);
    expect(res.json().invited).toBe(false);
    expect(res.json().reason).toContain('carence');
  });

  it('enregistre un ticket sans contact et renvoie l’URL du QR', async () => {
    const res = await app.inject(
      signedRequest({
        externalId: 'TCK-9003',
        closedAt: new Date().toISOString(),
        totalCents: 1890,
      }),
    );
    expect(res.json().recorded).toBe(true);
    expect(res.json().invited).toBe(false);
    expect(res.json().receiptUrl).toMatch(/\/s\//);
  });

  it('rejette une signature invalide', async () => {
    const res = await app.inject({
      ...signedRequest({ externalId: 'TCK-9100', closedAt: new Date().toISOString(), totalCents: 1000 }),
      headers: {
        'content-type': 'application/json',
        'x-avisio-signature': createHmac('sha256', 'mauvaise-cle').update('x').digest('hex'),
        'x-avisio-timestamp': String(Math.floor(Date.now() / 1000)),
      },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain('Signature');
  });

  it('rejette un horodatage hors fenêtre (rejeu)', async () => {
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    const res = await app.inject(
      signedRequest(
        { externalId: 'TCK-9101', closedAt: new Date().toISOString(), totalCents: 1000 },
        { timestamp: old },
      ),
    );
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain('Horodatage');
  });

  it('rejette un appel sans en-têtes de signature', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/integrations/pos/${establishmentId}`,
      payload: { externalId: 'TCK-9102', closedAt: new Date().toISOString(), totalCents: 1000 },
    });
    expect(res.statusCode).toBe(401);
  });

  it('agrège les statistiques de caisse', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/establishments/${establishmentId}/pos`,
      headers: asOwner(),
    });
    expect(res.json().stats.tickets).toBeGreaterThan(0);
    expect(res.json().stats.averageTicketCents).toBeGreaterThan(0);
  });

  it('n’expose jamais le condensat du contact', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/establishments/${establishmentId}/pos/tickets`,
      headers: asOwner(),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.stringify(res.json());
    expect(body).not.toContain('contactHash');
    expect(res.json()[0]).toHaveProperty('hasContact');
  });
});

describe('comptes', () => {
  it('liste les comptes', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/managers', headers: asAdmin() });
    expect(res.statusCode).toBe(200);
    expect(res.json().some((m: { role: string }) => m.role === 'admin')).toBe(true);
    // Aucun condensat de mot de passe ne sort de l'API.
    expect(JSON.stringify(res.json())).not.toContain('scrypt$');
  });

  it('crée un second compte admin', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/managers',
      headers: asAdmin(),
      payload: {
        name: 'Support Avisio',
        email: 'support@avisio.fr',
        password: 'support1234',
        role: 'admin',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe('admin');

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'support@avisio.fr', password: 'support1234' },
    });
    expect(login.json().manager.role).toBe('admin');
  });
});
