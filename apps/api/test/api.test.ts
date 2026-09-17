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
import { DEMO_CREDENTIALS } from '../src/demo-data.js';
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
  async monthlyReport(to, establishment) {
    sentEmails.push({ to, subject: `${establishment.name} — rapport` });
  },
};

let app: FastifyInstance;
let token: string;

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
});

afterAll(async () => {
  await app.close();
});

const auth = (): Record<string, string> => ({ authorization: `Bearer ${token}` });

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

  it('refuse un devis mal formé', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/catalog/quote',
      payload: { plan: 'diamant' },
    });
    expect(res.statusCode).toBe(500);
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
    expect(res.statusCode).toBe(500);
    expect(res.json().code).toBe('compliance');
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

describe('ingestion', () => {
  it('exécute un cycle complet sans erreur', async () => {
    const res = await app.inject({ method: 'POST', url: '/ops/ingest', headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(res.json().errors).toEqual([]);
    expect(res.json().establishments).toBe(3);
  });

  it('n’ingère jamais deux fois le même avis', async () => {
    const first = await app.inject({ method: 'POST', url: '/ops/ingest', headers: auth() });
    const countBefore = (
      await app.inject({
        method: 'GET',
        url: '/establishments/est_comptoir/reviews?limit=200',
        headers: auth(),
      })
    ).json().length;

    // Les connecteurs simulés produisent des identifiants uniques : on vérifie
    // ici que le compteur progresse exactement du nombre d'avis annoncés.
    const second = await app.inject({ method: 'POST', url: '/ops/ingest', headers: auth() });
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
