/**
 * Cloisonnement des données fabriquées.
 *
 * Le défaut corrigé ici était le plus insidieux du produit. Sans accès Google
 * — c'est-à-dire dans l'état actuel — le connecteur simulé tournait quand
 * même, et sur une vraie base PostgreSQL il y écrivait de faux avis, de
 * fausses alertes et de fausses statistiques. Rien ne le signalait : le client
 * voyait simplement son tableau de bord se remplir d'avis qui n'existaient
 * pas, et la note moyenne qu'on lui facturait était inventée.
 *
 * Deux garanties, testées séparément parce qu'elles peuvent casser
 * indépendamment : rien n'est fabriqué hors mode démonstration, et ce qui est
 * fabriqué en mode démonstration ne compte jamais.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computeMetrics, countableOnly, isCountable, type Review } from '@avisio/core';
import { buildApp } from '../src/app.js';
import { createMemoryRepository } from '../src/repository/memory.js';
import {
  createInactiveConnector,
  createSimulatedConnector,
  toDomainReview,
} from '../src/services/google.js';
import type { LlmService } from '../src/services/anthropic.js';
import type { Notifier } from '../src/services/notify.js';

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
  usage: () => ({
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    failures: 0,
    throttled: 0,
    windowStartedAt: new Date().toISOString(),
  }),
  async suggestReply() {
    return { text: 'Merci.', warnings: [], engine: 'llm' };
  },
};

const fakeNotifier: Notifier = {
  async alert() {},
  async billing() {},
  async monthlyReport() {},
};

const avis = (over: Partial<Review> = {}): Review => ({
  id: 'rev_x',
  establishmentId: 'est_1',
  platform: 'google',
  externalId: 'ext_x',
  author: 'Client',
  rating: 5,
  comment: 'Très bien.',
  publishedAt: new Date().toISOString(),
  ingestedAt: new Date().toISOString(),
  status: 'new',
  ...over,
});

describe('connecteur inactif', () => {
  it("ne fabrique rien : c'est ce qui remplace le simulateur hors démonstration", async () => {
    const connecteur = createInactiveConnector('tripadvisor');
    const cible = { establishmentId: 'est_1', externalId: 'peu-importe' };

    expect(connecteur.live).toBe(false);
    expect(await connecteur.fetchReviews(cible)).toEqual([]);
    expect(await connecteur.fetchCounters(cible)).toBeNull();
  });

  it('refuse de publier une réponse plutôt que de faire semblant', async () => {
    // Renvoyer un succès laisserait croire au gérant que sa réponse est en
    // ligne. Mieux vaut un échec visible qu'un mensonge silencieux.
    await expect(
      createInactiveConnector('yelp').publishReply(
        { establishmentId: 'est_1', externalId: 'x' },
        'rev_1',
        'Merci de votre retour.',
      ),
    ).rejects.toThrow();
  });

  it('se distingue du simulateur, qui lui fabrique bien des avis', async () => {
    // Contrôle du contrôle : si le simulateur ne produisait rien non plus, le
    // test précédent ne prouverait rien.
    const simule = createSimulatedConnector('google');
    const lots = await Promise.all(
      Array.from({ length: 40 }, () =>
        simule.fetchReviews({ establishmentId: 'est_1', externalId: 'x' }),
      ),
    );
    expect(lots.flat().length).toBeGreaterThan(0);
  });
});

describe('marquage de la provenance', () => {
  it('marque « demo » tout avis issu du simulateur', async () => {
    const simule = createSimulatedConnector('google');
    let externes = await simule.fetchReviews({ establishmentId: 'est_1', externalId: 'x' });
    // Le simulateur ne produit pas d'avis à tous les coups : on insiste.
    for (let i = 0; i < 40 && externes.length === 0; i += 1) {
      externes = await simule.fetchReviews({ establishmentId: 'est_1', externalId: 'x' });
    }
    expect(externes.length).toBeGreaterThan(0);

    for (const externe of externes) {
      expect(toDomainReview(externe, 'est_1', 'google').source).toBe('demo');
    }
  });
});

describe('exclusion des métriques', () => {
  it('écarte les avis fabriqués du calcul', () => {
    // Un avis de démonstration à 1 étoile ne doit pas faire chuter la note
    // moyenne affichée — pas plus qu'un 5 étoiles ne doit la flatter.
    const reels = [avis({ id: 'a', externalId: 'a', rating: 4, source: 'sync' })];
    const avecDemo = [
      ...reels,
      avis({ id: 'b', externalId: 'b', rating: 1, source: 'demo' }),
      avis({ id: 'c', externalId: 'c', rating: 5, source: 'demo' }),
    ];

    expect(computeMetrics(avecDemo).total).toBe(1);
    expect(computeMetrics(avecDemo).averageRating).toBe(computeMetrics(reels).averageRating);
  });

  it('compte les avis importés et synchronisés, et ceux sans provenance', () => {
    // `import` est un chemin de production, et les avis antérieurs au champ
    // n'ont pas de provenance : les écarter viderait les tableaux de bord.
    expect(isCountable(avis({ source: 'sync' }))).toBe(true);
    expect(isCountable(avis({ source: 'import' }))).toBe(true);
    expect(isCountable(avis({}))).toBe(true);
    expect(isCountable(avis({ source: 'demo' }))).toBe(false);
  });

  it('expose un filtre réutilisable', () => {
    const liste = [avis({ id: 'a', source: 'demo' }), avis({ id: 'b', source: 'sync' })];
    expect(countableOnly(liste).map((r) => r.id)).toEqual(['b']);
  });
});

describe('bout en bout : aucune contamination hors démonstration', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // L'application est construite sans injecter de connecteurs : elle choisit
    // donc elle-même, comme en exploitation. NODE_ENV vaut `test` et
    // AVISIO_DEMO_MODE n'est pas posé — donc pas de mode démonstration.
    app = await buildApp({
      repo: createMemoryRepository(),
      llm: fakeLlm,
      notifier: fakeNotifier,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("n'active aucun connecteur simulé par défaut", () => {
    for (const [platform, connecteur] of app.ctx.connectors) {
      expect(connecteur.live, `${platform} ne doit pas être en direct sans configuration`).toBe(
        false,
      );
    }
  });

  it("n'écrit aucun avis lors d'un cycle d'ingestion complet", async () => {
    const avant = (await app.ctx.repo.reviews.listAll()).length;

    // Plusieurs cycles : le simulateur ne produisait pas à tous les coups, un
    // seul passage pouvait donner un faux négatif.
    for (let i = 0; i < 5; i += 1) await app.ctx.ingest.runOnce();

    expect((await app.ctx.repo.reviews.listAll()).length).toBe(avant);
  });

  it("ne crée aucune alerte lors d'un cycle d'ingestion", async () => {
    const avant = (await app.ctx.repo.alerts.listByEstablishment('est_comptoir', 200)).length;
    for (let i = 0; i < 5; i += 1) await app.ctx.ingest.runOnce();
    expect((await app.ctx.repo.alerts.listByEstablishment('est_comptoir', 200)).length).toBe(avant);
  });

  it('rapporte un cycle sans erreur : muet ne veut pas dire en panne', async () => {
    // Une plateforme non connectée est un état d'onboarding, pas un incident.
    // La faire remonter en erreur noierait les vraies pannes.
    const rapport = await app.ctx.ingest.runOnce();
    expect(rapport.newReviews).toBe(0);
    expect(rapport.errors).toEqual([]);
  });
});
