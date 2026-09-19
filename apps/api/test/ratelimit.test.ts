/**
 * Limitation de débit.
 *
 * Trois choses à prouver, et la troisième compte autant que les deux autres :
 * l'abus est refusé, le refus est exploitable par l'appelant (429, `retry-after`,
 * code machine), et l'usage normal n'est pas gêné. Une protection qui bloque
 * les clients légitimes n'est pas une protection, c'est une panne.
 *
 * Ces tests montent une instance dédiée : la suite principale partage une seule
 * adresse d'appel, et y saturer un budget perturberait les autres fichiers.
 */

import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { RATE_RULES, rateVerdict, windowStartMs } from '@avisio/core';
import { buildApp } from '../src/app.js';
import { DEMO_CREDENTIALS } from '../src/demo-data.js';
import { createMemoryRepository } from '../src/repository/memory.js';
import { scopeFor } from '../src/ratelimit.js';

let app: FastifyInstance | null = null;

const freshApp = async (): Promise<FastifyInstance> => {
  // Dépôt neuf à chaque cas : les compteurs vivent dedans, donc repartir de
  // zéro suffit à isoler les budgets d'un test à l'autre.
  app = await buildApp({ repo: createMemoryRepository() });
  return app;
};

afterEach(async () => {
  await app?.close();
  app = null;
});

describe('politique', () => {
  it('compte la première requête comme rang 1, pas comme rang 0', () => {
    const rule = { limit: 3, windowSeconds: 60 };
    expect(rateVerdict(1, rule, Date.now()).allowed).toBe(true);
    expect(rateVerdict(3, rule, Date.now()).allowed).toBe(true);
    expect(rateVerdict(4, rule, Date.now()).allowed).toBe(false);
  });

  it('annonce un délai de réessai qui ne dépasse jamais la fenêtre', () => {
    const rule = { limit: 1, windowSeconds: 60 };
    const now = Date.now();
    const verdict = rateVerdict(2, rule, now);
    expect(verdict.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(verdict.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('aligne les fenêtres sur des bornes fixes', () => {
    const start = windowStartMs(1_700_000_123_456, 60);
    expect(start % 60_000).toBe(0);
    expect(windowStartMs(start + 59_999, 60)).toBe(start);
    expect(windowStartMs(start + 60_000, 60)).toBe(start + 60_000);
  });

  it('range toute route inconnue dans un périmètre plutôt que de la laisser libre', () => {
    // Le défaut est la pièce maîtresse : une route ajoutée demain sans y
    // penser doit être protégée, pas exemptée.
    expect(scopeFor('POST', '/une/route/inventee')).toBe('authenticated');
    expect(scopeFor('POST', '/auth/login')).toBe('login_ip');
    expect(scopeFor('POST', '/public/tag/:slug/scan')).toBe('scan');
    expect(scopeFor('POST', '/reviews/:id/suggest-reply')).toBe('llm');
  });

  it("n'assujettit pas la sonde de santé", () => {
    // Renvoyer 429 à l'orchestrateur le ferait redémarrer le service au pire
    // moment : celui où il est déjà sous pression.
    expect(scopeFor('GET', '/health')).toBeNull();
  });
});

describe('connexion', () => {
  it('coupe le forçage de mot de passe sur un compte', async () => {
    const instance = await freshApp();
    const budget = RATE_RULES.login.limit;

    const codes: number[] = [];
    for (let i = 0; i < budget + 3; i += 1) {
      const res = await instance.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: DEMO_CREDENTIALS.email, password: 'mauvais-mot-de-passe' },
      });
      codes.push(res.statusCode);
    }

    expect(codes.slice(0, budget)).toEqual(Array(budget).fill(401));
    expect(codes.slice(budget)).toEqual([429, 429, 429]);
  });

  it('rend le refus par compte aussi exploitable que celui par adresse', async () => {
    const instance = await freshApp();
    for (let i = 0; i < RATE_RULES.login.limit; i += 1) {
      await instance.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: DEMO_CREDENTIALS.email, password: 'mot-de-passe-faux' },
      });
    }

    // Le client ne peut pas savoir laquelle des deux limites l'a arrete : les
    // deux refus doivent donc porter le meme code machine et le meme en-tete.
    const res = await instance.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: DEMO_CREDENTIALS.email, password: 'mot-de-passe-faux' },
    });
    expect(res.statusCode).toBe(429);
    expect(res.json().code).toBe('rate_limited');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(res.json().retryAfterSeconds).toBeGreaterThan(0);
  });

  it('refuse même le bon mot de passe une fois le budget du compte épuisé', async () => {
    const instance = await freshApp();

    for (let i = 0; i < RATE_RULES.login.limit; i += 1) {
      await instance.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: DEMO_CREDENTIALS.email, password: 'mot-de-passe-faux' },
      });
    }

    // Le point important : l'attaquant qui tombe juste au dernier essai ne
    // doit pas être récompensé. Le compte est verrouillé le temps de la
    // fenêtre, quel que soit le mot de passe présenté.
    const res = await instance.inject({
      method: 'POST',
      url: '/auth/login',
      payload: DEMO_CREDENTIALS,
    });
    expect(res.statusCode).toBe(429);
  });

  it("ne verrouille pas un compte voisin quand un autre est attaqué", async () => {
    const instance = await freshApp();

    for (let i = 0; i < RATE_RULES.login.limit + 2; i += 1) {
      await instance.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'cible@avisio.fr', password: 'mot-de-passe-faux' },
      });
    }

    // Sans cette séparation, il suffirait de matraquer l'adresse d'un gérant
    // pour l'empêcher de se connecter : un déni de service offert.
    const res = await instance.inject({
      method: 'POST',
      url: '/auth/login',
      payload: DEMO_CREDENTIALS,
    });
    expect(res.statusCode).toBe(200);
  });

  it("laisse la validation passer devant le budget du compte", async () => {
    const instance = await freshApp();

    // Une requête malformée (mot de passe trop court) est rejetée avant
    // d'atteindre le compteur par compte. C'est voulu : le budget par compte
    // existe pour ralentir les essais *plausibles*, et un attaquant enverrait
    // de toute façon des mots de passe de longueur valide. Le budget par
    // adresse, lui, s'applique en amont et couvre bien ces requêtes-là.
    const codes: number[] = [];
    for (let i = 0; i < RATE_RULES.login.limit + 2; i += 1) {
      const res = await instance.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: DEMO_CREDENTIALS.email, password: 'court' },
      });
      codes.push(res.statusCode);
    }
    expect(new Set(codes)).toEqual(new Set([400]));

    const res = await instance.inject({
      method: 'POST',
      url: '/auth/login',
      payload: DEMO_CREDENTIALS,
    });
    expect(res.statusCode).toBe(200);
  });

  it('consomme le budget même sur un compte inexistant', async () => {
    const instance = await freshApp();

    const codes: number[] = [];
    for (let i = 0; i < RATE_RULES.login.limit + 1; i += 1) {
      const res = await instance.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'inconnu@example.com', password: 'peu-importe' },
      });
      codes.push(res.statusCode);
    }

    // Autrement, l'énumération des comptes resterait gratuite : on saurait
    // qu'une adresse existe au seul fait qu'elle finit par être limitée.
    expect(codes.at(-1)).toBe(429);
  });
});

describe('parcours public', () => {
  it('laisse passer une salle qui scanne normalement', async () => {
    const instance = await freshApp();

    // Vingt scans dans l'heure : un service de midi bien rempli. Aucun ne doit
    // être refusé, sans quoi la protection coûterait des avis au client.
    for (let i = 0; i < 20; i += 1) {
      const res = await instance.inject({ method: 'POST', url: '/public/tag/k7m2p9qa/scan' });
      expect(res.statusCode).toBe(200);
    }
  });

  it('coupe le gonflage des compteurs de scan', async () => {
    const instance = await freshApp();
    const budget = RATE_RULES.scan.limit;

    let last = 0;
    for (let i = 0; i < budget + 1; i += 1) {
      last = (await instance.inject({ method: 'POST', url: '/public/tag/k7m2p9qa/scan' }))
        .statusCode;
    }
    expect(last).toBe(429);
  });

  it('donne au client refusé de quoi réessayer', async () => {
    const instance = await freshApp();
    for (let i = 0; i < RATE_RULES.scan.limit; i += 1) {
      await instance.inject({ method: 'POST', url: '/public/tag/k7m2p9qa/scan' });
    }

    const res = await instance.inject({ method: 'POST', url: '/public/tag/k7m2p9qa/scan' });
    expect(res.statusCode).toBe(429);
    expect(res.json().code).toBe('rate_limited');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(res.json().retryAfterSeconds).toBeGreaterThan(0);
  });

  it('ne fait pas payer aux scans le budget de la fidélité', async () => {
    const instance = await freshApp();

    // Les périmètres sont séparés dans la clé de comptage : saturer l'un ne
    // doit pas fermer l'autre, un restaurant et ses clients partageant
    // souvent une seule adresse publique.
    for (let i = 0; i < RATE_RULES.loyalty.limit + 1; i += 1) {
      await instance.inject({
        method: 'POST',
        url: '/public/tag/k7m2p9qa/loyalty',
        payload: { contact: `client${i}@example.com`, channel: 'email' },
      });
    }

    const res = await instance.inject({ method: 'POST', url: '/public/tag/k7m2p9qa/scan' });
    expect(res.statusCode).toBe(200);
  });

  it("garde la sonde de santé accessible sous le feu", async () => {
    const instance = await freshApp();
    for (let i = 0; i < RATE_RULES.scan.limit + 5; i += 1) {
      await instance.inject({ method: 'POST', url: '/public/tag/k7m2p9qa/scan' });
    }

    const res = await instance.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });
});

describe('compteur partagé', () => {
  it('compte chaque requête simultanée exactement une fois', async () => {
    const instance = await freshApp();

    // Le compteur est la seule chose qui sépare un abus d'un passage : s'il
    // perd des incréments sous concurrence, le budget annoncé est faux.
    const repo = instance.ctx.repo;
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const results = await Promise.all(
      Array.from({ length: 50 }, () => repo.rateLimit.hit('essai:concurrence', expiresAt)),
    );

    expect([...results].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 50 }, (_, i) => i + 1),
    );
  });
});
