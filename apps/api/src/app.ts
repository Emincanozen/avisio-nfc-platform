/**
 * Assemblage de l'API.
 *
 * `buildApp` construit une instance complète à partir d'un dépôt injecté :
 * le serveur l'appelle avec l'adaptateur choisi, les tests avec l'adaptateur
 * mémoire non amorcé. Aucune dépendance globale, aucun singleton.
 */

import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  type FastifyServerOptions,
} from 'fastify';
import { ZodError } from 'zod';
import type { ManagerRole, PlatformId } from '@avisio/core';
import { capabilities, env } from './env.js';
import type { Repository } from './repository/index.js';
import { createLlmService, type LlmService } from './services/anthropic.js';
import { createAnalyticsService } from './services/analytics.js';
import { createBillingService, type PaymentProvider } from './services/billing.js';
import {
  createGoogleConnector,
  createSimulatedConnector,
  type ReviewConnector,
} from './services/google.js';
import { createGoogleTokenService, type GoogleTokenService } from './services/google-tokens.js';
import { createIngestService } from './services/ingest.js';
import { createNotifier, type Notifier } from './services/notify.js';
import { createPosService } from './services/pos.js';
import { createPushSender, type PushSender } from './services/push.js';
import { createReportService } from './services/reports.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerBillingRoutes } from './routes/billing.js';
import { registerCatalogRoutes } from './routes/catalog.js';
import { registerIntegrationRoutes } from './routes/integrations.js';
import { registerGoogleRoutes } from './routes/google.js';
import { registerManagerRoutes } from './routes/manager.js';
import { registerPublicRoutes } from './routes/public.js';
import { registerRateLimit } from './ratelimit.js';

export interface AppDeps {
  repo: Repository;
  llm?: LlmService;
  notifier?: Notifier;
  push?: PushSender;
  payments?: PaymentProvider;
  connectors?: Map<PlatformId, ReviewConnector>;
}

export interface AppContext {
  repo: Repository;
  llm: LlmService;
  notifier: Notifier;
  push: PushSender;
  connectors: Map<PlatformId, ReviewConnector>;
  analytics: ReturnType<typeof createAnalyticsService>;
  ingest: ReturnType<typeof createIngestService>;
  billing: ReturnType<typeof createBillingService>;
  reports: ReturnType<typeof createReportService>;
  pos: ReturnType<typeof createPosService>;
  googleTokens: GoogleTokenService;
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
    /** Vérifie le JWT ; 401 sinon. */
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Vérifie le JWT **et** le rôle admin ; 403 sinon. */
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    /** Établissements accessibles par le gérant authentifié. */
    establishmentIds: string[];
    managerId: string;
    role: ManagerRole;
  }
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  // Par défaut on ne croit pas X-Forwarded-For (voir `env.trustProxy`) :
  // l'IP sert de clé à toute la limitation de débit, et la croire sur parole
  // offrirait une identité neuve à chaque requête.
  //
  // Un nombre de sauts se traduit en prédicat — Fastify ne prend pas la forme
  // numérique dans ses types, alors que c'est la configuration la plus sûre
  // derrière un proxy : elle ne se périme pas quand l'hébergeur change ses
  // plages d'adresses. Les options sont typées explicitement parce que cette
  // union ferait autrement basculer Fastify sur sa surcharge HTTP/2.
  const hops = env.trustProxy;
  const trustProxy: FastifyServerOptions['trustProxy'] =
    typeof hops === 'number' ? (_address: string, hop: number) => hop < hops : hops;

  const options: FastifyServerOptions = {
    logger: env.nodeEnv === 'test' ? false : { level: 'info', transport: undefined },
    trustProxy,
  };
  const app = Fastify(options);

  const logger = {
    info: (msg: string) => app.log.info(msg),
    warn: (msg: string) => app.log.warn(msg),
  };

  /**
   * Origines autorisées à appeler l'espace gérant et le back-office.
   *
   * `PUBLIC_WEB_URL` en production ; localhost s'y ajoute hors production pour
   * que `npm run dev` fonctionne sans configuration.
   */
  const allowedOrigins = new Set<string>([env.webUrl]);
  if (env.nodeEnv !== 'production') {
    for (const port of [3000, 3001]) {
      allowedOrigins.add(`http://localhost:${port}`);
      allowedOrigins.add(`http://127.0.0.1:${port}`);
    }
  }

  const llm = deps.llm ?? createLlmService(logger);
  const push = deps.push ?? createPushSender(deps.repo, logger);
  const notifier = deps.notifier ?? createNotifier({ repo: deps.repo, push, logger });
  const googleTokens = createGoogleTokenService(deps.repo, logger);

  /**
   * Choix du connecteur Google.
   *
   * En direct dès que l'application OAuth est configurée : il se débrouille
   * alors par établissement, et un établissement non connecté ne renvoie
   * simplement rien. Sinon, connecteur simulé — ce qui permet de démontrer et
   * de développer tout le pipeline sans accès partenaire, à condition que
   * l'interface le dise, ce qu'elle fait via `/health`.
   */
  const connectors =
    deps.connectors ??
    new Map<PlatformId, ReviewConnector>([
      [
        'google',
        capabilities.googleOAuth
          ? createGoogleConnector(logger, (id) => googleTokens.accessTokenFor(id))
          : createSimulatedConnector('google'),
      ],
      ['tripadvisor', createSimulatedConnector('tripadvisor')],
      ['facebook', createSimulatedConnector('facebook')],
      ['yelp', createSimulatedConnector('yelp')],
      ['thefork', createSimulatedConnector('thefork')],
    ]);

  const ctx: AppContext = {
    repo: deps.repo,
    llm,
    notifier,
    push,
    connectors,
    googleTokens,
    analytics: createAnalyticsService(deps.repo),
    ingest: createIngestService({ repo: deps.repo, connectors, llm, notifier, logger }),
    billing: createBillingService({
      repo: deps.repo,
      notifier,
      logger,
      ...(deps.payments ? { payments: deps.payments } : {}),
    }),
    reports: createReportService({ repo: deps.repo, notifier, logger }),
    pos: createPosService({
      repo: deps.repo,
      logger,
      // L'invitation sort par le même canal que les autres messages
      // transactionnels : pas de second fournisseur à administrer.
      sendInvitation: async (channel, contact, message) => {
        if (channel === 'sms') {
          logger.info(`[SMS simulé] à ${contact} — ${message.body}`);
          return;
        }
        logger.info(`[e-mail invitation] à ${contact} — ${message.subject ?? ''}`);
      },
    }),
  };
  app.decorate('ctx', ctx);

  await app.register(cors, {
    /**
     * Le widget d'avis est fait pour être embarqué sur le site de n'importe
     * quel client : son origine ne peut pas être connue à l'avance, donc la
     * lecture publique reste ouverte.
     *
     * Tout le reste est réservé à l'interface Avisio. `credentials` est à
     * `false` : la session est un jeton porté par un en-tête, jamais un
     * cookie — rien n'a besoin d'être renvoyé par le navigateur, et l'activer
     * en même temps qu'une origine reflétée serait une faute.
     */
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // appel serveur à serveur
      callback(null, allowedOrigins.has(origin) ? origin : false);
    },
    credentials: false,
  });

  // Les routes publiques restent lisibles depuis n'importe quelle origine :
  // c'est le propre d'un widget embarquable et d'une landing scannée.
  app.addHook('onSend', async (request, reply) => {
    if (request.raw.url?.startsWith('/public/') || request.raw.url === '/health') {
      void reply.header('access-control-allow-origin', '*');
    }
  });

  await app.register(jwt, {
    secret: env.jwtSecret,
    sign: { expiresIn: '12h' },
  });

  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const claims = await request.jwtVerify<{
        sub: string;
        establishmentIds: string[];
        role?: ManagerRole;
      }>();
      request.establishmentIds = claims.establishmentIds ?? [];
      request.managerId = claims.sub;
      request.role = claims.role ?? 'owner';
    } catch {
      await reply.code(401).send({ error: 'Authentification requise.' });
    }
  });

  app.decorate('requireAdmin', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const claims = await request.jwtVerify<{
        sub: string;
        establishmentIds: string[];
        role?: ManagerRole;
      }>();
      request.establishmentIds = claims.establishmentIds ?? [];
      request.managerId = claims.sub;
      request.role = claims.role ?? 'owner';
      if (request.role !== 'admin') {
        await reply.code(403).send({ error: 'Réservé aux comptes administrateurs.' });
      }
    } catch {
      await reply.code(401).send({ error: 'Authentification requise.' });
    }
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    const err = error as { statusCode?: number; message?: string; name?: string };

    // Une saisie invalide est une erreur du client, pas du serveur. Renvoyée en
    // 500, elle déclencherait les alertes d'exploitation à chaque formulaire mal
    // rempli, et un intégrateur réessaierait une requête qui ne passera jamais.
    if (error instanceof ZodError) {
      const fields = error.issues.map((issue) => ({
        champ: issue.path.join('.') || '(racine)',
        message: issue.message,
      }));
      void reply.code(400).send({
        error: `Requête invalide : ${fields.map((f) => `${f.champ} — ${f.message}`).join(' ; ')}`,
        code: 'validation',
        fields,
      });
      return;
    }

    // Refus de conformité : la requête est bien formée mais inacceptable.
    if (err.name === 'ComplianceError') {
      void reply.code(422).send({ error: err.message ?? 'Configuration non conforme.', code: 'compliance' });
      return;
    }

    // Plaquette scannée sur un établissement sans plateforme active : c'est une
    // configuration incomplète, pas une panne. En 500, la page du client
    // devenait indistinguable d'une vraie indisponibilité, et chaque scan sur
    // une plaquette mal réglée déclenchait les alertes d'exploitation.
    if (err.name === 'NoRoutablePlatformError') {
      void reply.code(409).send({
        error: err.message ?? 'Aucune plateforme active sur cet établissement.',
        code: 'not_configured',
      });
      return;
    }

    const status = err.statusCode ?? 500;
    if (status >= 500) request.log.error({ err: error }, 'Erreur non gérée');

    // Un refus de débit levé depuis une route (limite par compte) doit être
    // aussi exploitable que celui du crochet global : même code machine, même
    // en-tête. Sans quoi le client doit deviner quand réessayer selon la
    // limite qui l'a arrêté, ce qu'il ne peut pas savoir.
    if (status === 429) {
      const retryAfterSeconds = (error as { retryAfterSeconds?: number }).retryAfterSeconds;
      if (retryAfterSeconds != null) {
        void reply.header('retry-after', String(retryAfterSeconds));
      }
      void reply.code(429).send({
        error: err.message ?? 'Trop de requêtes.',
        code: 'rate_limited',
        ...(retryAfterSeconds != null ? { retryAfterSeconds } : {}),
      });
      return;
    }

    void reply.code(status).send({
      error: status >= 500 ? 'Erreur interne.' : (err.message ?? 'Requête invalide.'),
    });
  });

  // Le limiteur s'enregistre avant les routes : le crochet global `onRequest`
  // s'exécute ainsi avant les gardes d'authentification de chaque route, et un
  // déluge de tentatives de connexion est refusé avant d'atteindre le calcul
  // de condensat du mot de passe, qui est volontairement lent.
  registerRateLimit(app);

  await registerPublicRoutes(app);
  await registerAuthRoutes(app);
  await registerCatalogRoutes(app);
  await registerManagerRoutes(app);
  await registerBillingRoutes(app);
  await registerIntegrationRoutes(app);
  await registerGoogleRoutes(app);
  await registerAdminRoutes(app);

  return app;
}

/**
 * Garde d'accès multi-locataire, appliquée dans chaque route protégée.
 * Un compte admin traverse la garde : c'est le propre du back-office.
 */
export function assertAccess(request: FastifyRequest, establishmentId: string): void {
  if (request.role === 'admin') return;
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
