/**
 * Connexion Google et import manuel, vus depuis l'API.
 *
 * Ce qui est réellement prouvé ici : le cloisonnement entre établissements,
 * le refus propre quand l'application OAuth n'est pas configurée, le
 * scellement des jetons, et l'import de bout en bout — analyse, écriture,
 * dédoublonnage, alerte.
 *
 * Ce qui ne peut pas l'être : la lecture d'avis Google réels. Elle exige un
 * accès approuvé par Google, et aucune doublure ne peut en tenir lieu. Cette
 * limite est documentée, pas contournée par un test qui mimerait le succès.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { DEMO_CREDENTIALS } from '../src/demo-data.js';
import { createMemoryRepository } from '../src/repository/memory.js';
import { isSealed, open, seal } from '../src/services/secrets.js';
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
  async suggestReply() {
    return { text: 'Merci pour votre retour.', warnings: [], engine: 'llm' };
  },
};

const alerted: string[] = [];
const fakeNotifier: Notifier = {
  async alert(_to, _establishment, alert) {
    alerted.push(alert.title);
  },
  async billing() {},
  async monthlyReport() {},
};

let app: FastifyInstance;
let token: string;

const auth = (): Record<string, string> => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  app = await buildApp({
    repo: createMemoryRepository(),
    llm: fakeLlm,
    notifier: fakeNotifier,
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

describe('scellement des jetons', () => {
  it('rend illisible un jeton stocké', () => {
    const sealed = seal('1//refresh-token-du-client');
    expect(sealed).not.toContain('refresh-token');
    expect(isSealed(sealed)).toBe(true);
    expect(open(sealed)).toBe('1//refresh-token-du-client');
  });

  it('produit un chiffré différent à chaque scellement', () => {
    // Vecteur d'initialisation aléatoire : deux clients dont le jeton serait
    // identique ne doivent pas produire la même ligne en base.
    expect(seal('identique')).not.toBe(seal('identique'));
  });

  it('refuse un enregistrement modifié plutôt que de l’interpréter', () => {
    const sealed = seal('secret');
    const parts = sealed.split('.');
    // On altère un octet du chiffré : l'étiquette d'authentification GCM doit
    // le détecter. Sans elle, on déchiffrerait des octets arbitraires.
    const tampered = [parts[0], parts[1], parts[2], `${parts[3]!.slice(0, -2)}AA`].join('.');
    expect(open(tampered)).toBeNull();
  });

  it('renvoie null sur une valeur qui n’est pas scellée', () => {
    expect(open('pas-un-jeton')).toBeNull();
    expect(open('v1.a.b')).toBeNull();
  });
});

describe('état de la connexion', () => {
  it('annonce une connexion absente sans faire d’erreur', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/establishments/est_comptoir/google',
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().connected).toBe(false);
  });

  it("dit que l'instance n'est pas configurée plutôt que d'échouer", async () => {
    // Sans GOOGLE_CLIENT_ID, aucun client ne peut consentir. C'est une
    // configuration manquante (409), pas une panne (500) ni un refus (403).
    const res = await app.inject({
      method: 'POST',
      url: '/establishments/est_comptoir/google/authorize',
      headers: auth(),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('GOOGLE_CLIENT_ID');
  });

  it('refuse de lire la connexion d’un établissement étranger', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/establishments/est_inconnu_ailleurs/google',
      headers: auth(),
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuse le consentement sans authentification', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/establishments/est_comptoir/google/authorize',
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('retour de Google', () => {
  it('ramène le client dans l’interface quand il annule', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/integrations/google/callback?error=access_denied',
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('google=annule');
  });

  it('rejette un état forgé', async () => {
    // L'état signé est la seule preuve que la fiche autorisée revient bien à
    // l'établissement qui l'a demandée. Sans cette vérification, n'importe qui
    // pourrait provoquer un rattachement.
    const res = await app.inject({
      method: 'GET',
      url: '/integrations/google/callback?code=abc&state=jeton-invente',
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('etat-invalide');
  });

  it('rejette une réponse incomplète', async () => {
    const res = await app.inject({ method: 'GET', url: '/integrations/google/callback' });
    expect(res.headers.location).toContain('reponse-incomplete');
  });
});

describe('diagnostic', () => {
  it("nomme l'étape qui bloque plutôt que d'échouer en bloc", async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/establishments/est_comptoir/google/test',
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(false);
    expect(res.json().etape).toBe('autorisation');
  });

  it('signale un jeton devenu illisible comme tel', async () => {
    // Cas réel : la clé de scellement a changé entre deux déploiements. Le
    // symptôme ne doit pas être cherché du côté de Google.
    await app.ctx.repo.googleConnections.upsert({
      establishmentId: 'est_hotel',
      refreshTokenSealed: 'v1.aaaa.bbbb.cccc',
      scope: 'https://www.googleapis.com/auth/business.manage',
      connectedAt: new Date().toISOString(),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/establishments/est_hotel/google/test',
      headers: auth(),
    });
    expect(res.json().etape).toBe('scellement');
    await app.ctx.repo.googleConnections.remove('est_hotel');
  });
});

describe('import manuel', () => {
  const csv = (rows: string[]): string =>
    ['externalId,author,rating,comment,publishedAt,replyText', ...rows].join('\n');

  it('sert un modèle CSV lisible par Excel', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/establishments/est_comptoir/reviews/import/template',
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    // Le BOM évite qu'Excel français affiche les accents en charabia.
    expect(res.body.startsWith('﻿')).toBe(true);
  });

  it('montre ce qui serait importé sans rien écrire', async () => {
    const before = await app.ctx.repo.reviews.query({
      establishmentId: 'est_comptoir',
      limit: 500,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/establishments/est_comptoir/reviews/import',
      headers: auth(),
      payload: {
        platform: 'google',
        dryRun: true,
        csv: csv(['essai1,Marie,5,"Très bien, merci",2026-03-01,']),
      },
    });

    expect(res.json().dryRun).toBe(true);
    expect(res.json().summary.imported).toBe(1);

    const after = await app.ctx.repo.reviews.query({
      establishmentId: 'est_comptoir',
      limit: 500,
    });
    expect(after).toHaveLength(before.length);
  });

  it('importe, analyse et marque la provenance', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/establishments/est_comptoir/reviews/import',
      headers: auth(),
      payload: {
        platform: 'google',
        csv: csv([
          'imp-a,Marie D.,5,"Accueil impeccable",2026-03-01,',
          'imp-b,Paul T.,4,"Bon moment dans l\'ensemble",2026-03-02,',
        ]),
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().summary.imported).toBe(2);

    const stored = await app.ctx.repo.reviews.query({
      establishmentId: 'est_comptoir',
      limit: 500,
    });
    const imported = stored.filter((r) => r.externalId.startsWith('imp-'));
    expect(imported).toHaveLength(2);
    // La provenance est ce qui interdit de présenter ces avis comme le
    // produit d'une connexion en direct.
    expect(imported.every((r) => r.source === 'import')).toBe(true);
    expect(imported.every((r) => r.analysis != null)).toBe(true);
  });

  it('ne réimporte pas deux fois le même fichier', async () => {
    const payload = {
      platform: 'google' as const,
      csv: csv(['rejouable,Léa,5,"Parfait du début à la fin",2026-03-05,']),
    };

    const first = await app.inject({
      method: 'POST',
      url: '/establishments/est_comptoir/reviews/import',
      headers: auth(),
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/establishments/est_comptoir/reviews/import',
      headers: auth(),
      payload,
    });

    expect(first.json().summary.imported).toBe(1);
    expect(second.json().summary.imported).toBe(0);
    expect(second.json().summary.duplicates).toBe(1);
  });

  it('alerte sur un avis négatif récent, pas sur un vieil avis', async () => {
    alerted.length = 0;
    const recent = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);

    const res = await app.inject({
      method: 'POST',
      url: '/establishments/est_comptoir/reviews/import',
      headers: auth(),
      payload: {
        platform: 'google',
        csv: csv([
          `neg-recent,Yanis,1,"Service catastrophique ce soir",${recent},`,
          'neg-vieux,Chloé,1,"Très déçu de cette visite",2024-01-15,',
        ]),
      },
    });

    // Un import rétroactif ne doit pas déclencher une avalanche d'alertes sur
    // des avis vieux de deux ans : le gérant fermerait les notifications.
    // Les deux avis entrent, un seul alerte.
    expect(res.json().summary.imported).toBe(2);
    expect(res.json().alertsCreated).toBe(1);
    // Une alerte notifie chaque gérant de l'établissement, d'où un compte de
    // notifications supérieur ou égal au compte d'alertes.
    expect(alerted.length).toBeGreaterThanOrEqual(1);
    expect(new Set(alerted).size).toBe(1);
    expect(alerted[0]).toContain('1★');
  });

  it('refuse un import sur l’établissement d’un autre', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/establishments/est_pas_a_moi/reviews/import',
      headers: auth(),
      payload: { platform: 'google', csv: csv(['x,A,5,Bien,2026-01-01,']) },
    });
    expect(res.statusCode).toBe(403);
  });

  it('explique un fichier illisible au lieu de renvoyer une erreur interne', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/establishments/est_comptoir/reviews/import',
      headers: auth(),
      payload: { platform: 'google', csv: 'ceci nest pas un csv' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().summary.imported).toBe(0);
    expect(res.json().message).toContain('Colonnes manquantes');
  });

  it('refuse une plateforme inconnue en 400, pas en 500', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/establishments/est_comptoir/reviews/import',
      headers: auth(),
      payload: { platform: 'pages-jaunes', csv: csv(['x,A,5,Bien,2026-01-01,']) },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('validation');
  });
});
