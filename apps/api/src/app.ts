/**
 * Assemblage de l'API.
 *
 * `buildApp` construit une instance complète à partir d'un dépôt injecté :
 * le serveur l'appelle avec l'adaptateur choisi, les tests avec l'adaptateur
 * mémoire non amorcé. Aucune dépendance globale, aucun singleton.
 */

import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type { PlatformId } from '@avisio/core';
import { env } from './env.js';
import type { Repository } from './repository/index.js';
import { createLlmService, type LlmService } from './services/anthropic.js';
import { createAnalyticsService } from './services/analytics.js';
import { createGoogleConnector, createSimulatedConnector, type ReviewConnector } from './services/google.js';
import { createIngestService } from './services/ingest.js';
import { createNotifier, type Notifier } from './services/notify.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerCatalogRoutes } from './routes/catalog.js';
import { registerManagerRoutes } from './routes/manager.js';
import { registerPublicRoutes } from './routes/public.js';

export interface AppDeps {
  repo: Repository;
  llm?: LlmService;
  notifier?: Notifier;
  connectors?: Map<PlatformId, ReviewConnector>;
}

export interface AppContext {
  repo: Repository;
  llm: LlmService;
  notifier: Notifier;
  connectors: Map<PlatformId, ReviewConnector>;
  analytics: ReturnType<typeof createAnalyticsService>;
  ingest: ReturnType<typeof createIngestService>;
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
    /** Vérifie le JWT ; 401 sinon. */
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    /** Établissements accessibles par le gérant authentifié. */
    establishmentIds: string[];
  }
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      env.nodeEnv === 'test'
        ? false
        : { level: 'info', transport: undefined },
    // Les landing pages NFC sont servies derrière un proxy : on fait confiance
    // à X-Forwarded-* pour l'IP et le protocole.
    trustProxy: true,
  });

  const logger = {
    info: (msg: string) => app.log.info(msg),
    warn: (msg: string) => app.log.warn(msg),
  };

  const llm = deps.llm ?? createLlmService(logger);
  const notifier = deps.notifier ?? createNotifier(logger);
  const connectors =
    deps.connectors ??
    new Map<PlatformId, ReviewConnector>([
      ['google', createGoogleConnector(logger)],
      ['tripadvisor', createSimulatedConnector('tripadvisor')],
      ['facebook', createSimulatedConnector('facebook')],
      ['yelp', createSimulatedConnector('yelp')],
      ['thefork', createSimulatedConnector('thefork')],
    ]);

  const ctx: AppContext = {
    repo: deps.repo,
    llm,
    notifier,
    connectors,
    analytics: createAnalyticsService(deps.repo),
    ingest: createIngestService({ repo: deps.repo, connectors, llm, notifier, logger }),
  };
  app.decorate('ctx', ctx);

  await app.register(cors, {
    // Le widget avis est embarqué sur les sites des clients : lecture ouverte,
    // écriture réservée aux origines connues.
    origin: true,
    credentials: true,
  });

  await app.register(jwt, {
    secret: env.jwtSecret,
    sign: { expiresIn: '12h' },
  });

  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const claims = await request.jwtVerify<{ sub: string; establishmentIds: string[] }>();
      request.establishmentIds = claims.establishmentIds ?? [];
    } catch {
      await reply.code(401).send({ error: 'Authentification requise.' });
    }
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    const err = error as { statusCode?: number; message?: string; name?: string };
    const status = err.statusCode ?? 500;
    if (status >= 500) request.log.error({ err: error }, 'Erreur non gérée');
    void reply.code(status).send({
      error: status >= 500 ? 'Erreur interne.' : (err.message ?? 'Requête invalide.'),
      ...(err.name === 'ComplianceError' ? { code: 'compliance' } : {}),
    });
  });

  await registerPublicRoutes(app);
  await registerAuthRoutes(app);
  await registerCatalogRoutes(app);
  await registerManagerRoutes(app);

  return app;
}

/** Garde d'accès multi-locataire, appliquée dans chaque route protégée. */
export function assertAccess(request: FastifyRequest, establishmentId: string): void {
  if (!request.establishmentIds?.includes(establishmentId)) {
    const error = new Error('Établissement non accessible avec ce compte.') as Error & {
      statusCode: number;
    };
    error.statusCode = 403;
    throw error;
  }
}

export function httpError(status: number, message: string): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = status;
  return error;
}
