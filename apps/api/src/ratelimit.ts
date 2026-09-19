/**
 * Limitation de débit.
 *
 * La politique — quel budget pour quelle nature de coût — vit dans
 * `@avisio/core`. Ce fichier fait le reste : reconnaître à quel périmètre
 * appartient une route, décider de l'identité à compter, et refuser proprement
 * en 429.
 *
 * Deux choix méritent d'être expliqués.
 *
 * L'identité comptée est l'adresse IP, y compris sur les routes authentifiées.
 * Le jeton serait une meilleure identité, mais il n'est vérifié qu'après ce
 * crochet, et compter un jeton non vérifié laisserait un attaquant en changer
 * à volonté. Le plafond de dépense par établissement, lui, est traité là où il
 * a du sens — dans le service de modèle de langage, sur des données vérifiées.
 *
 * Le compteur passe par le dépôt, pas par une variable de module : sur
 * plusieurs instances, un compteur local diviserait le budget par le nombre
 * d'instances.
 */

import { RATE_RULES, rateKey, rateVerdict, windowStartMs, type RateScope } from '@avisio/core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Table des périmètres.
 *
 * Indexée sur le gabarit d'URL tel que Fastify le connaît (`/reviews/:id/reply`
 * et non l'URL concrète) : la clé ne dépend donc pas des identifiants, et une
 * route ajoutée sans entrée ici retombe sur un périmètre par défaut plutôt que
 * de passer sans limite.
 */
const SCOPES: Array<[method: string, url: string, scope: RateScope]> = [
  // Le budget par compte, lui, est appliqué dans la route : l'adresse e-mail
  // est dans le corps, qui n'est pas encore analysé à ce stade.
  ['POST', '/auth/login', 'login_ip'],

  ['GET', '/public/tag/:slug', 'public_read'],
  ['POST', '/public/tag/:slug/scan', 'scan'],
  ['POST', '/public/tag/:slug/loyalty', 'loyalty'],
  ['GET', '/public/widget/:establishmentId', 'public_read'],
  ['GET', '/catalog', 'public_read'],
  ['POST', '/catalog/quote', 'public_read'],
  ['GET', '/push/public-key', 'public_read'],

  ['POST', '/integrations/pos/:establishmentId', 'pos'],

  // Les deux seules routes de l'espace gérant qui appellent un modèle de
  // langage, donc qui coûtent de l'argent à chaque requête.
  ['POST', '/reviews/:id/suggest-reply', 'llm'],

  ['POST', '/admin/ops/:job', 'ops'],
];

/**
 * Périmètre d'une requête.
 *
 * `/health` est délibérément exclu : c'est la sonde de l'orchestrateur, et la
 * faire tomber en 429 déclencherait un redémarrage en boucle au pire moment,
 * celui où le service est déjà sous pression.
 */
export function scopeFor(method: string, url: string | undefined): RateScope | null {
  if (!url) return null;
  if (url === '/health') return null;
  for (const [m, u, scope] of SCOPES) {
    if (m === method && u === url) return scope;
  }
  return 'authenticated';
}

/**
 * Consomme une unité de budget sur une identité arbitraire, en dehors du
 * crochet global.
 *
 * Sert aux limites qui portent sur une donnée du corps de la requête — donc
 * indisponible à `onRequest`. Lève une erreur 429 plutôt que de renvoyer un
 * verdict : les appelants sont des routes, et c'est leur mode normal d'échec.
 */
export async function consumeRate(
  app: FastifyInstance,
  scope: RateScope,
  identity: string,
): Promise<void> {
  const rule = RATE_RULES[scope];
  const nowMs = Date.now();
  const start = windowStartMs(nowMs, rule.windowSeconds);
  const expiresAt = new Date(start + rule.windowSeconds * 1000).toISOString();

  let count: number;
  try {
    count = await app.ctx.repo.rateLimit.hit(rateKey(scope, identity, start), expiresAt);
  } catch {
    return; // compteur indisponible : on laisse passer, comme dans le crochet
  }

  const verdict = rateVerdict(count, rule, nowMs);
  if (verdict.allowed) return;

  const error = new Error(
    `Trop de tentatives. Réessayez dans ${verdict.retryAfterSeconds} seconde(s).`,
  ) as Error & { statusCode: number };
  error.statusCode = 429;
  throw error;
}

export function registerRateLimit(app: FastifyInstance): void {
  const { repo } = app.ctx;

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const scope = scopeFor(request.method, request.routeOptions?.url);
    if (!scope) return;

    const rule = RATE_RULES[scope];
    const nowMs = Date.now();
    const start = windowStartMs(nowMs, rule.windowSeconds);
    const key = rateKey(scope, request.ip, start);

    let count: number;
    try {
      count = await repo.rateLimit.hit(key, new Date(start + rule.windowSeconds * 1000).toISOString());
    } catch (error) {
      // Une panne du compteur ne doit pas fermer le service. On laisse passer
      // et on trace : refuser tout le trafic parce que la table de comptage
      // est indisponible transformerait une gêne en interruption.
      request.log.warn({ err: error }, 'Compteur de débit indisponible, requête laissée passer');
      return;
    }

    const verdict = rateVerdict(count, rule, nowMs);
    void reply.header('x-ratelimit-limit', String(rule.limit));
    void reply.header('x-ratelimit-remaining', String(verdict.remaining));
    void reply.header('x-ratelimit-reset', String(Math.ceil(verdict.resetAtMs / 1000)));

    if (verdict.allowed) return;

    request.log.warn(
      `Débit dépassé (${scope}) depuis ${request.ip} : ${count} requêtes sur ${rule.windowSeconds} s`,
    );
    await reply
      .header('retry-after', String(verdict.retryAfterSeconds))
      .code(429)
      .send({
        error: `Trop de requêtes. Réessayez dans ${verdict.retryAfterSeconds} seconde(s).`,
        code: 'rate_limited',
        retryAfterSeconds: verdict.retryAfterSeconds,
      });
  });
}
