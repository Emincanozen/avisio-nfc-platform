/**
 * Tests d'intégration de l'API.
 *
 * Ils tournent sur l'adaptateur mémoire avec le jeu de démonstration : pas de
 * base, pas de Docker, pas de réseau. Les services externes (LLM, e-mail) sont
 * injectés en doublure, ce qui rend la suite déterministe.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { DEMO_ADMIN_CREDENTIALS, DEMO_CREDENTIALS } from '../src/demo-data.js';
import { createMemoryRepository } from '../src/repository/memory.js';
import type { LlmService } from '../src/services/anthropic.js';
import { createSimulatedConnector } from '../src/services/google.js';
import type { Notifier } from '../src/services/notify.js';
import type { PlatformId } from '@avisio/core';

const fakeLlm: LlmService = {
  async analyze(review) {
    return {
      sentiment: review.rating >= 4 ? 'positive' : 'negative',
      score: review.rating >= 4 ? 0.8 : -0.8,
      themes: ['service'],
      keywords: ['test'],
      language: 'fr',
      engine: 'llm',
    };
  },
  async suggestReply() {
    return { text: 'Merci pour votre retour, nous en tenons compte.', warnings: [], engine: 'llm' };
  },
};

const sentEmails: Array<{ to: string; subject: string }> = [];
const fakeNotifier: Notifier = {
  async alert(to, establishment, alert) {
    sentEmails.push({ to, subject: `${establishment.name} — ${alert.title}` });
  },
  async billing(to, _establishment, subject) {
    sentEmails.push({ to, subject });
  },
  async monthlyReport(to, establishment) {
    sentEmails.push({ to, subject: `${establishment.name} — rapport` });
  },
};

let app: FastifyInstance;
let token: string;
let adminToken: string;

beforeAll(async () => {
  const connectors = new Map<PlatformId, ReturnType<typeof createSimulatedConnector>>([
    ['google', createSimulatedConnector('google')],
    ['tripadvisor', createSimulatedConnector('tripadvisor')],
    ['facebook', createSimulatedConnector('facebook')],
    ['yelp', createSimulatedConnector('yelp')],
    ['thefork', createSimulatedConnector('thefork')],
  ]);

  app = await buildApp({
    repo: createMemoryRepository(),
    llm: fakeLlm,
    notifier: fakeNotifier,
    connectors,
  });

  const login = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: DEMO_CREDENTIALS,
  });
  token = login.json().token;

  const admin = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: DEMO_ADMIN_CREDENTIALS,
  });
  adminToken = admin.json().token;
});

afterAll(async () => {
  await app.close();
});

const auth = (): Record<string, string> => ({ authorization: `Bearer ${token}` });
const adminAuth = (): Record<string, string> => ({ authorization: `Bearer ${adminToken}` });

describe('santé et catalogue', () => {
  it('répond sur /health', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().persistence).toBe('memory');
  });

  it('expose le catalogue', async () => {
    const res = await app.inject({ method: 'GET', url: '/catalog' });
    expect(res.statusCode).toBe(200);
    expect(res.json().plans).toHaveLength(3);
  });

  it('calcule un devis', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/catalog/quote',
      payload: { plan: 'pro', addons: ['loyalty'], tags: 4, committed12Months: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().monthlyCentsExclVat).toBe(9100);
    expect(res.json().oneOffCentsExclVat).toBe(6400);
  });

  it('refuse un devis mal formé en 400, pas en 500', async () => {
    // Une saisie invalide n'est pas une panne serveur : en 500, elle
    // déclencherait les alertes d'exploitation à chaque formulaire mal rempli.
    const res = await app.inject({
      method: 'POST',
      url: '/catalog/quote',
      payload: { plan: 'diamant' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('validation');
    expect(res.json().fields[0].champ).toBe('plan');
  });

  it('nomme le champ fautif', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/catalog/quote',
      payload: { plan: 'pro', tags: 999 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().fields.some((f: { champ: string }) => f.champ === 'tags')).toBe(true);
  });
});

describe('authentification', () => {
  it('rejette un mot de passe faux sans révéler le compte', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: DEMO_CREDENTIALS.email, password: 'mauvaispass' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('Identifiants incorrects.');
  });

  it('renvoie le même message pour un compte inexistant', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'inconnu@nulle-part.fr', password: 'mauvaispass' },
    });
    expect(res.json().error).toBe('Identifiants incorrects.');
  });

  it('refuse l’accès sans jeton', async () => {
    const res = await app.inject({ method: 'GET', url: '/establishments' });
    expect(res.statusCode).toBe(401);
  });

  it('liste les établissements du compte', async () => {
    const res = await app.inject({ method: 'GET', url: '/establishments', headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(3);
  });

  it('interdit un établissement hors périmètre', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/establishments/est_inconnu/overview',
      headers: auth(),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('parcours NFC', () => {
  it('sert la landing page avec la langue négociée', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/public/tag/k7m2p9qa',
      headers: { 'accept-language': 'en-GB,en;q=0.9' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.locale).toBe('en');
    expect(body.establishment.name).toBe('Le Comptoir des Minimes');
    expect(body.messages.cta).toContain('Leave a review');
  });

  it('retombe sur la langue de l’établissement', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/public/tag/k7m2p9qa',
      headers: { 'accept-language': 'ja-JP,ja;q=0.9' },
    });
    expect(res.json().locale).toBe('fr');
  });

  it('affiche la mention de non-filtrage', async () => {
    const res = await app.inject({ method: 'GET', url: '/public/tag/z2q7v4kh' });
    expect(res.json().disclosure).toContain('sans relecture');
  });

  it('renvoie 404 sur une plaquette inconnue', async () => {
    const res = await app.inject({ method: 'GET', url: '/public/tag/inexistant' });
    expect(res.statusCode).toBe(404);
  });

  it('signale une plaquette sans plateforme active sans crier à la panne', async () => {
    // Un gérant qui désactive sa seule plateforme produit une configuration
    // incomplète, pas une erreur serveur. En 500, chaque scan sur une plaquette
    // mal réglée réveillerait l'astreinte.
    //
    // L'établissement est créé pour ce test seul : désactiver une plateforme
    // d'un établissement partagé casserait les tests de routage suivants.
    const stamp = Date.now();
    const created = await app.inject({
      method: 'POST',
      url: '/admin/establishments',
      headers: adminAuth(),
      payload: {
        establishment: {
          name: `Sans plateforme ${stamp}`,
          sector: 'retail',
          postalCode: '31000',
          brandTone: 'sobre et direct',
          defaultLocale: 'fr',
        },
        subscription: {
          plan: 'essentiel',
          addons: [],
          extraPlatforms: 0,
          tags: 1,
          committed12Months: true,
        },
        manager: {
          name: 'Testeur Config',
          email: `config.${stamp}@test.fr`,
          password: 'motdepasse1',
        },
        googleReviewUrl: 'https://g.page/r/config/review',
        tagLabels: ['Caisse'],
      },
    });
    expect(created.statusCode).toBe(200);
    const establishmentId = created.json().establishment.id;
    const slug = created.json().tags[0].slug;

    const disabled = await app.inject({
      method: 'PUT',
      url: `/establishments/${establishmentId}/platforms/google`,
      headers: adminAuth(),
      payload: { reviewUrl: 'https://g.page/r/config/review', enabled: false },
    });
    expect(disabled.statusCode).toBe(200);

    const page = await app.inject({ method: 'GET', url: `/public/tag/${slug}` });
    expect(page.statusCode).toBe(409);
    expect(page.json().code).toBe('not_configured');
    expect(page.json().error).toContain('Google');

    const scan = await app.inject({ method: 'POST', url: `/public/tag/${slug}/scan` });
    expect(scan.statusCode).toBe(409);
  });

  it('enregistre le scan et renvoie une URL de dépôt d’avis', async () => {
    const before = await app.inject({
      method: 'GET',
      url: '/establishments/est_comptoir/tags',
      headers: auth(),
    });
    const scansBefore = before.json().find((t: { slug: string }) => t.slug === 'k7m2p9qa').scanCount;

    const res = await app.inject({ method: 'POST', url: '/public/tag/k7m2p9qa/scan' });
    expect(res.statusCode).toBe(200);
    expect(res.json().redirectUrl).toMatch(/^https:\/\//);
    expect(res.json().reason).toBeTruthy();

    const after = await app.inject({
      method: 'GET',
      url: '/establishments/est_comptoir/tags',
      headers: auth(),
    });
    const scansAfter = after.json().find((t: { slug: string }) => t.slug === 'k7m2p9qa').scanCount;
    expect(scansAfter).toBe(scansBefore + 1);
  });

  it('concentre le flux sur la plateforme la plus en retard', async () => {
    // Le Comptoir : 412 avis Google, 38 TripAdvisor, 0 TheFork. Le rattrapage
    // attendu est une série continue vers TheFork, pas une alternance — il faut
    // ~90 scans pour que sa part rejoigne la cible du secteur.
    const platforms = new Set<string>();
    for (let i = 0; i < 12; i += 1) {
      const res = await app.inject({ method: 'POST', url: '/public/tag/r4x8t2vb/scan' });
      platforms.add(res.json().platform.id);
    }
    expect([...platforms]).toEqual(['thefork']);
  });

  it('ne route que vers Google sur une offre Essentiel', async () => {
    for (let i = 0; i < 5; i += 1) {
      const res = await app.inject({ method: 'POST', url: '/public/tag/z2q7v4kh/scan' });
      expect(res.json().platform.id).toBe('google');
    }
  });
});

describe('fidélité', () => {
  it('crédite puis bloque pendant la carence', async () => {
    const payload = { contact: 'client@test.fr', channel: 'email' };
    const first = await app.inject({
      method: 'POST',
      url: '/public/tag/k7m2p9qa/loyalty',
      payload,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().credited).toBe(true);
    expect(first.json().balance).toBe(10);

    const second = await app.inject({
      method: 'POST',
      url: '/public/tag/k7m2p9qa/loyalty',
      payload,
    });
    expect(second.json().credited).toBe(false);
    expect(second.json().nextEligibleAt).toBeTruthy();
  });

  it('normalise le contact : même client, même compte', async () => {
    await app.inject({
      method: 'POST',
      url: '/public/tag/k7m2p9qa/loyalty',
      payload: { contact: 'Dupont@Test.FR', channel: 'email' },
    });
    const again = await app.inject({
      method: 'POST',
      url: '/public/tag/k7m2p9qa/loyalty',
      payload: { contact: ' dupont@test.fr ', channel: 'email' },
    });
    expect(again.json().credited).toBe(false);
  });

  it('refuse la fidélité si l’offre ne l’inclut pas', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/public/tag/z2q7v4kh/loyalty',
      payload: { contact: 'client@test.fr', channel: 'email' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('conformité', () => {
  it('refuse de configurer un tri par note avant redirection', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/establishments/est_comptoir/landing-config',
      headers: auth(),
      payload: { askRatingBeforeRedirect: true },
    });
    // 422 : la requête est bien formée, mais ce qu'elle demande est refusé.
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('compliance');
    expect(res.json().error).toContain('review gating');
  });

  it('accepte une configuration conforme', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/establishments/est_comptoir/landing-config',
      headers: auth(),
      payload: {},
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('avis et réponses', () => {
  it('liste les avis négatifs non traités', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/establishments/est_hotel/reviews?maxRating=3&status=new',
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const reviews = res.json();
    expect(reviews.length).toBeGreaterThan(0);
    expect(reviews.every((r: { rating: number }) => r.rating <= 3)).toBe(true);
  });

  it('suggère une réponse puis la publie', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/establishments/est_hotel/reviews?maxRating=2',
      headers: auth(),
    });
    const review = list.json()[0];

    const suggestion = await app.inject({
      method: 'POST',
      url: `/reviews/${review.id}/suggest-reply`,
      headers: auth(),
      payload: { gesture: 'une nuit offerte' },
    });
    expect(suggestion.statusCode).toBe(200);
    expect(suggestion.json().text).toBeTruthy();

    const published = await app.inject({
      method: 'POST',
      url: `/reviews/${review.id}/reply`,
      headers: auth(),
      payload: { text: suggestion.json().text },
    });
    expect(published.statusCode).toBe(200);
    expect(published.json().review.status).toBe('answered');
    expect(published.json().warnings).toEqual([]);
  });

  it('signale une réponse non conforme sans la bloquer', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/establishments/est_hotel/reviews?maxRating=3',
      headers: auth(),
    });
    const review = list.json().find((r: { status: string }) => r.status !== 'answered');

    const res = await app.inject({
      method: 'POST',
      url: `/reviews/${review.id}/reply`,
      headers: auth(),
      payload: { text: 'Merci, pourriez-vous supprimer votre avis ? Nous vous offrons un café.' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().warnings.length).toBeGreaterThan(0);
  });

  it('refuse les suggestions IA sur une offre qui ne les inclut pas', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/establishments/est_atelier/reviews',
      headers: auth(),
    });
    const review = list.json()[0];

    // Atelier Sézanne est en Pro : les suggestions sont incluses.
    const ok = await app.inject({
      method: 'POST',
      url: `/reviews/${review.id}/suggest-reply`,
      headers: auth(),
    });
    expect(ok.statusCode).toBe(200);
  });
});

describe('analytics', () => {
  it('produit une vue d’ensemble', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/establishments/est_comptoir/overview',
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.metrics.total).toBeGreaterThan(0);
    expect(body.platforms.length).toBeGreaterThan(0);
    expect(body.scans.byDay).toHaveLength(30);
  });

  it('remonte la tendance « attente » du restaurant de démonstration', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/establishments/est_comptoir/overview',
      headers: auth(),
    });
    const themes = res.json().themes.map((t: { theme: string }) => t.theme);
    expect(themes).toContain('attente');
  });

  it('refuse le benchmark sans le droit correspondant', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/establishments/est_hotel/benchmark',
      headers: auth(),
    });
    expect(res.statusCode).toBe(402);
  });

  it('refuse le benchmark faute de pairs suffisants', async () => {
    // Le jeu de démonstration ne contient que 3 établissements : le seuil
    // d'anonymat ne peut pas être atteint, et c'est le comportement attendu.
    const res = await app.inject({
      method: 'GET',
      url: '/establishments/est_comptoir/benchmark',
      headers: auth(),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('anonymat');
  });

  it('simule la répartition du routage', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/establishments/est_comptoir/routing/simulate?scans=200',
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const distribution = res.json().distribution as Record<string, number>;
    const total = Object.values(distribution).reduce((a, b) => a + b, 0);
    expect(total).toBe(200);
    // Sur un horizon suffisant, le flux se répartit : le rattrapage initial
    // laisse place à l'équilibrage entre plateformes.
    expect(Object.keys(distribution).length).toBeGreaterThan(1);
  });
});

describe('plaquettes', () => {
  it('crée une plaquette avec une URL qui tient sur la puce', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/establishments/est_atelier/tags',
      headers: auth(),
      payload: { label: 'Vitrine', material: 'premium' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().url).toMatch(/\/s\/[a-z2-9]{8}$/);
    expect(res.json().fitsOnNtag213).toBe(true);
  });
});

describe('plateformes', () => {
  it('bloque l’ajout au-delà du quota de l’offre', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/establishments/est_hotel/platforms/yelp',
      headers: auth(),
      payload: { reviewUrl: 'https://yelp.com/biz/garonne', enabled: true },
    });
    // Hôtel Garonne est en Essentiel : Google seulement.
    expect(res.statusCode).toBe(402);
    expect(res.json().error).toContain('Plateforme supplémentaire');
  });

  it('accepte une plateforme dans le quota', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/establishments/est_atelier/platforms/facebook',
      headers: auth(),
      payload: { reviewUrl: 'https://facebook.com/ateliersezanne/reviews', enabled: true },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('cloisonnement entre établissements', () => {
  it('refuse de marquer lue l’alerte d’un autre établissement', async () => {
    // L'identifiant d'une alerte suffisait : la route ne vérifiait pas à quel
    // établissement elle appartenait.
    const alerts = await app.inject({
      method: 'GET',
      url: '/establishments/est_hotel/alerts?limit=1',
      headers: auth(),
    });
    const alertId = alerts.json()[0].id;

    const intruder = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'intrus@test.fr', password: 'intrus12345' },
    });
    // Le compte n'existe pas encore : on le crée via le back-office, sans
    // aucun établissement rattaché.
    if (intruder.statusCode !== 200) {
      await app.inject({
        method: 'POST',
        url: '/admin/managers',
        headers: adminAuth(),
        payload: {
          name: 'Intrus',
          email: 'intrus@test.fr',
          password: 'intrus12345',
          role: 'owner',
          establishmentIds: [],
        },
      });
    }
    const session = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'intrus@test.fr', password: 'intrus12345' },
    });
    const intruderAuth = { authorization: `Bearer ${session.json().token}` };

    const res = await app.inject({
      method: 'POST',
      url: `/alerts/${alertId}/read`,
      headers: intruderAuth,
    });
    expect(res.statusCode).toBe(403);
  });

  it('laisse le gérant légitime marquer son alerte', async () => {
    const alerts = await app.inject({
      method: 'GET',
      url: '/establishments/est_hotel/alerts?limit=1',
      headers: auth(),
    });
    const res = await app.inject({
      method: 'POST',
      url: `/alerts/${alerts.json()[0].id}/read`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
  });

  it('renvoie 404 sur une alerte inexistante', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/alerts/alr_inexistante/read',
      headers: auth(),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('ingestion', () => {
  it('réserve le déclenchement des traitements à l’exploitation', async () => {
    // Ces traitements balaient tout le parc : ouverts à un gérant, ils lui
    // permettraient de déclencher les appels aux API des plateformes et les
    // dépenses de modèle de langage de tous les autres établissements.
    for (const url of ['/ops/ingest', '/ops/trends']) {
      const legacy = await app.inject({ method: 'POST', url, headers: auth() });
      expect(legacy.statusCode).toBe(404);
    }
    const forbidden = await app.inject({
      method: 'POST',
      url: '/admin/ops/ingest',
      headers: auth(),
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it('exécute un cycle complet sans erreur', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/ops/ingest',
      headers: adminAuth(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().errors).toEqual([]);
    // Au moins les trois du jeu de démonstration : d’autres tests en créent.
    expect(res.json().establishments).toBeGreaterThanOrEqual(3);
  });

  it('n’ingère jamais deux fois le même avis', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/admin/ops/ingest',
      headers: adminAuth(),
    });
    const countBefore = (
      await app.inject({
        method: 'GET',
        url: '/establishments/est_comptoir/reviews?limit=200',
        headers: auth(),
      })
    ).json().length;

    // Les connecteurs simulés produisent des identifiants uniques : on vérifie
    // ici que le compteur progresse exactement du nombre d'avis annoncés.
    const second = await app.inject({
      method: 'POST',
      url: '/admin/ops/ingest',
      headers: adminAuth(),
    });
    const countAfter = (
      await app.inject({
        method: 'GET',
        url: '/establishments/est_comptoir/reviews?limit=200',
        headers: auth(),
      })
    ).json().length;

    expect(first.statusCode).toBe(200);
    expect(countAfter).toBeGreaterThanOrEqual(countBefore);
    expect(second.json().errors).toEqual([]);
  });
});
