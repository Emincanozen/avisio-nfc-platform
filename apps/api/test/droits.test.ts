/**
 * Intégrité commerciale : les droits suivent la facture.
 *
 * Ces tests couvrent deux défauts constatés, tous deux exploitables par un
 * gérant ordinaire depuis son propre compte.
 *
 * `PATCH /establishments/:id` acceptait `plan` et `addons`. Les droits lisant
 * l'établissement et la facturation lisant l'abonnement, il suffisait d'une
 * requête pour passer en Premium sans changer de facture. Aucune erreur, aucun
 * journal : le produit, gratuitement.
 *
 * Et un abonnement suspendu pour impayé conservait l'intégralité de ses
 * fonctions. La suspension était un mot dans le back-office.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { DEMO_ADMIN_CREDENTIALS, DEMO_CREDENTIALS } from '../src/demo-data.js';
import { createMemoryRepository } from '../src/repository/memory.js';
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
    return { text: 'Merci pour votre retour.', warnings: [], engine: 'llm' };
  },
};

const fakeNotifier: Notifier = {
  async alert() {},
  async billing() {},
  async monthlyReport() {},
};

let app: FastifyInstance;
let token: string;
let adminToken: string;

const auth = (): Record<string, string> => ({ authorization: `Bearer ${token}` });
const adminAuth = (): Record<string, string> => ({ authorization: `Bearer ${adminToken}` });

beforeAll(async () => {
  app = await buildApp({
    repo: createMemoryRepository(),
    llm: fakeLlm,
    notifier: fakeNotifier,
  });
  token = (
    await app.inject({ method: 'POST', url: '/auth/login', payload: DEMO_CREDENTIALS })
  ).json().token;
  adminToken = (
    await app.inject({ method: 'POST', url: '/auth/login', payload: DEMO_ADMIN_CREDENTIALS })
  ).json().token;
});

afterAll(async () => {
  await app.close();
});

describe('un gérant ne peut pas s’offrir une montée de gamme', () => {
  it("refuse une modification d'offre depuis la route de l'espace gérant", async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/establishments/est_hotel',
      headers: auth(),
      payload: { plan: 'premium' },
    });

    // 400 : le champ n'existe pas dans le contrat de cette route. Ce n'est pas
    // un refus d'autorisation, c'est une requête qui ne veut rien dire ici.
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('validation');
  });

  it("refuse l'ajout d'une option payante", async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/establishments/est_hotel',
      headers: auth(),
      payload: { addons: ['analytics', 'loyalty'] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('laisse passer les informations opérationnelles', async () => {
    // La route garde son utilité : nom, ton de marque, langue restent du
    // ressort du gérant.
    const res = await app.inject({
      method: 'PATCH',
      url: '/establishments/est_hotel',
      headers: auth(),
      payload: { name: 'Hôtel Garonne — Rive Gauche', brandTone: 'chaleureux et direct' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('Hôtel Garonne — Rive Gauche');
  });

  it("n'accorde aucun droit même si l'établissement porte une offre supérieure", async () => {
    // Ceinture ET bretelles : on force la divergence directement en base, ce
    // qu'aucune route ne permet plus, et on vérifie que les droits n'en
    // tiennent pas compte. C'est ce qui protège d'une écriture partielle ou
    // d'une future route étourdie.
    await app.ctx.repo.establishments.update('est_hotel', {
      plan: 'premium',
      addons: ['analytics', 'loyalty'],
    });

    const detail = await app.inject({
      method: 'GET',
      url: '/establishments/est_hotel',
      headers: auth(),
    });
    expect(detail.json().features.benchmark).toBe(false);

    const benchmark = await app.inject({
      method: 'GET',
      url: '/establishments/est_hotel/benchmark',
      headers: auth(),
    });
    expect(benchmark.statusCode).toBe(402);

    // On remet l'établissement d'aplomb pour les tests suivants.
    await app.ctx.repo.establishments.update('est_hotel', {
      plan: 'essentiel',
      addons: [],
    });
  });

  it("signale la divergence à l'exploitant", async () => {
    await app.ctx.repo.establishments.update('est_hotel', { plan: 'premium' });

    const parc = await app.inject({
      method: 'GET',
      url: '/admin/establishments',
      headers: adminAuth(),
    });
    const hotel = parc.json().find((e: { id: string }) => e.id === 'est_hotel');
    expect(hotel.entitlementDrift).toContain('essentiel');

    await app.ctx.repo.establishments.update('est_hotel', { plan: 'essentiel' });
  });
});

describe('un abonnement suspendu perd ses fonctions facturées', () => {
  const suspendre = async (status: 'suspended' | 'active'): Promise<void> => {
    const sub = await app.ctx.repo.subscriptions.findByEstablishment('est_comptoir');
    await app.ctx.repo.subscriptions.update(sub!.id, { status });
  };

  it('coupe le benchmark et les suggestions de réponse', async () => {
    await suspendre('suspended');

    const detail = await app.inject({
      method: 'GET',
      url: '/establishments/est_comptoir',
      headers: auth(),
    });
    expect(detail.json().features.benchmark).toBe(false);
    expect(detail.json().subscriptionStatus).toBe('suspended');
    expect(detail.json().restriction).toContain('suspendu');

    const benchmark = await app.inject({
      method: 'GET',
      url: '/establishments/est_comptoir/benchmark',
      headers: auth(),
    });
    expect(benchmark.statusCode).toBe(402);

    await suspendre('active');
  });

  it('laisse la consultation et les factures accessibles', async () => {
    await suspendre('suspended');

    // Retirer ses factures à un client suspendu pour impayé lui ôterait le
    // document dont il a besoin pour payer.
    const factures = await app.inject({
      method: 'GET',
      url: '/establishments/est_comptoir/invoices',
      headers: auth(),
    });
    expect(factures.statusCode).toBe(200);

    const vue = await app.inject({
      method: 'GET',
      url: '/establishments/est_comptoir/overview',
      headers: auth(),
    });
    expect(vue.statusCode).toBe(200);

    await suspendre('active');
  });

  it('rend les droits dès la régularisation', async () => {
    await suspendre('suspended');
    await suspendre('active');

    const detail = await app.inject({
      method: 'GET',
      url: '/establishments/est_comptoir',
      headers: auth(),
    });
    expect(detail.json().features.benchmark).toBe(true);
    expect(detail.json().restriction).toBe('');
  });
});

describe('un point de terminaison push ne change pas de propriétaire', () => {
  const endpoint = 'https://push.example.com/appareil-du-gerant-legitime';

  it("refuse de rattacher au compte appelant l'appareil d'un autre", async () => {
    // Le scénario : l'intrus connaît le point de terminaison d'un concurrent.
    // En le réenregistrant, il se l'appropriait — et le concurrent cessait de
    // recevoir ses alertes sans rien remarquer.
    await app.inject({
      method: 'POST',
      url: '/push/subscribe',
      headers: auth(),
      payload: { endpoint, keys: { p256dh: 'cle-publique-de-test', auth: 'secret-auth' } },
    });

    await app.inject({
      method: 'POST',
      url: '/admin/managers',
      headers: adminAuth(),
      payload: {
        name: 'Intrus push',
        email: 'intrus.push@test.fr',
        password: 'intrus12345',
        role: 'owner',
        establishmentIds: [],
      },
    });
    const session = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'intrus.push@test.fr', password: 'intrus12345' },
    });

    const vol = await app.inject({
      method: 'POST',
      url: '/push/subscribe',
      headers: { authorization: `Bearer ${session.json().token}` },
      payload: { endpoint, keys: { p256dh: 'cle-de-lintrus', auth: 'auth-de-lintrus' } },
    });
    expect(vol.statusCode).toBe(409);
    expect(vol.json().code).toBe('endpoint_pris');

    // Ce qui compte n'est pas le code renvoyé mais l'état : l'appareil doit
    // toujours appartenir au gérant légitime.
    const legitime = (await app.inject({ method: 'GET', url: '/auth/me', headers: auth() })).json()
      .manager.id as string;
    const restants = await app.ctx.repo.push.listByManager(legitime);
    expect(restants.map((s) => s.endpoint)).toContain(endpoint);
  });

  it('laisse le propriétaire réenregistrer son propre appareil', async () => {
    // Cas normal : le navigateur régénère ses clés et réenregistre. Il ne doit
    // pas se heurter à la garde posée contre le vol.
    const res = await app.inject({
      method: 'POST',
      url: '/push/subscribe',
      headers: auth(),
      payload: { endpoint, keys: { p256dh: 'nouvelle-cle-publique', auth: 'nouveau-secret' } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().subscribed).toBe(true);
  });
});
