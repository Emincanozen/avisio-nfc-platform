/**
 * Point d'entrée de l'API.
 *
 * Cinq tâches planifiées, portées par le processus tant qu'il n'y a qu'une
 * instance :
 *  - ingestion des avis toutes les INGEST_INTERVAL_MINUTES ;
 *  - détection de tendance une fois par jour ;
 *  - facturation et relances toutes les BILLING_INTERVAL_HOURS ;
 *  - rapports mensuels, déclenchés le 1er du mois ;
 *  - vidage de la file des push différés par les heures calmes.
 *
 * Passage à l'échelle : au-delà d'une instance, ces boucles migrent vers un
 * worker dédié consommant une file (Redis/SQS) — sans quoi chaque instance
 * facturerait de son côté. Voir docs/architecture.md.
 */

import { formatConfigRefusal, productionConfigProblems, productionConfigWarnings } from '@avisio/core';
import { buildApp } from './app.js';
import { capabilities, describeMode, env } from './env.js';
import { createRepository } from './repository/index.js';

/**
 * Contrôle de configuration, avant toute connexion.
 *
 * Il tourne en premier, avant même d'ouvrir la base : un déploiement mal
 * configuré doit s'arrêter net, pas démarrer à moitié. Chacun des cas refusés
 * produisait un serveur qui **a l'air de fonctionner** — sans base, il sert le
 * jeu de démonstration et ses identifiants publics ; avec le secret de
 * développement, il accepte n'importe quel jeton forgé.
 *
 * Voir packages/core/src/config-guard.ts pour la liste et les motifs.
 */
const runtimeConfig = {
  nodeEnv: env.nodeEnv,
  databaseUrl: env.databaseUrl,
  jwtSecret: env.jwtSecret,
  secretsKey: env.secretsKey,
  webUrl: env.webUrl,
  apiUrl: env.apiUrl,
  demoMode: env.demoMode,
  providers: {
    anthropic: capabilities.llm,
    googleOAuth: capabilities.googleOAuth,
    email: capabilities.email,
    push: capabilities.push,
  },
};

const problems = productionConfigProblems(runtimeConfig);
if (problems.length > 0) {
  process.stderr.write(formatConfigRefusal(problems));
  process.exit(78); // EX_CONFIG : erreur de configuration, pas de logiciel
}

for (const warning of productionConfigWarnings(runtimeConfig)) {
  process.stderr.write(`Avertissement — ${warning.setting} : ${warning.reason}\n`);
}

const repo = await createRepository();
const app = await buildApp({ repo });

/** Planifie une tâche récurrente qui ne tue jamais le processus en cas d'erreur. */
function schedule(name: string, intervalMs: number, task: () => Promise<unknown>): NodeJS.Timeout {
  const timer = setInterval(() => {
    void task().catch((error: unknown) => {
      app.log.error({ error }, `Tâche « ${name} » en échec`);
    });
  }, intervalMs);
  // Les timers ne doivent pas maintenir le processus en vie à eux seuls.
  timer.unref();
  return timer;
}

const timers = [
  schedule('ingestion', Math.max(1, env.ingestIntervalMinutes) * 60_000, () =>
    app.ctx.ingest.runOnce(),
  ),
  schedule('tendances', 24 * 3_600_000, () => app.ctx.ingest.runDaily()),
  schedule('facturation', Math.max(1, env.billingIntervalHours) * 3_600_000, async () => {
    await app.ctx.billing.runBilling();
    await app.ctx.billing.runDunning();
  }),
  // Le push différé se vide souvent : une alerte retenue par les heures calmes
  // doit partir peu après 8 h, pas à midi.
  schedule('push différés', 5 * 60_000, () => app.ctx.push.flushQueued()),
];

/**
 * Rapports mensuels : on vérifie toutes les heures si le 1er du mois est
 * arrivé, plutôt que de calculer un délai jusqu'au prochain 1er — un processus
 * redémarré au mauvais moment sauterait sinon le mois.
 */
let lastReportMonth = new Date().getUTCMonth();
timers.push(
  schedule('rapports mensuels', 3_600_000, async () => {
    const month = new Date().getUTCMonth();
    if (new Date().getUTCDate() !== 1 || month === lastReportMonth) return;
    lastReportMonth = month;
    await app.ctx.reports.runMonthly();
  }),
);

const shutdown = async (signal: string): Promise<void> => {
  app.log.info(`${signal} reçu, arrêt en cours.`);
  for (const timer of timers) clearInterval(timer);
  await app.close();
  await repo.close();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: env.port, host: '0.0.0.0' });
app.log.info(`Avisio API — ${describeMode()}`);
app.log.info(
  `Ingestion toutes les ${env.ingestIntervalMinutes} min · facturation toutes les ${env.billingIntervalHours} h.`,
);
