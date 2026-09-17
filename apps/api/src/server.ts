/**
 * Point d'entrée de l'API.
 *
 * Deux tâches planifiées, volontairement portées par le processus plutôt que
 * par un ordonnanceur externe tant qu'il n'y a qu'une instance :
 *  - ingestion des avis toutes les INGEST_INTERVAL_MINUTES ;
 *  - détection de tendance une fois par jour.
 *
 * Passage à l'échelle : au-delà d'une instance, ces deux boucles migrent vers
 * un worker dédié consommant une file (Redis/SQS) — voir docs/architecture.md.
 */

import { buildApp } from './app.js';
import { describeMode, env } from './env.js';
import { createRepository } from './repository/index.js';

const repo = await createRepository();
const app = await buildApp({ repo });

const ingestIntervalMs = Math.max(1, env.ingestIntervalMinutes) * 60_000;
const ingestTimer = setInterval(() => {
  void app.ctx.ingest.runOnce().catch((error: unknown) => {
    app.log.error({ error }, "Cycle d'ingestion en échec");
  });
}, ingestIntervalMs);

const dailyTimer = setInterval(
  () => {
    void app.ctx.ingest.runDaily().catch((error: unknown) => {
      app.log.error({ error }, 'Détection de tendance en échec');
    });
  },
  24 * 3_600_000,
);

// Les timers ne doivent pas maintenir le processus en vie à eux seuls.
ingestTimer.unref();
dailyTimer.unref();

const shutdown = async (signal: string): Promise<void> => {
  app.log.info(`${signal} reçu, arrêt en cours.`);
  clearInterval(ingestTimer);
  clearInterval(dailyTimer);
  await app.close();
  await repo.close();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: env.port, host: '0.0.0.0' });
app.log.info(`Avisio API — ${describeMode()}`);
app.log.info(`Ingestion toutes les ${env.ingestIntervalMinutes} min.`);
