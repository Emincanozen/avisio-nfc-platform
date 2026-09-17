/**
 * Charge le jeu de démonstration dans PostgreSQL.
 *
 *   docker compose -f infra/docker-compose.yml up -d
 *   npm run db:push
 *   npm run seed
 *
 * Le script est idempotent au sens où il refuse de tourner sur une base qui
 * contient déjà des établissements : on ne veut pas écraser des données réelles
 * par le jeu de démonstration.
 */

import { buildDemoDataset, DEMO_CREDENTIALS } from '../demo-data.js';
import { capabilities } from '../env.js';
import { createRepository } from '../repository/index.js';

async function main(): Promise<void> {
  if (!capabilities.persistence) {
    console.error(
      'DATABASE_URL absente : rien à amorcer. En mode mémoire, le jeu de\n' +
        'démonstration est chargé automatiquement au démarrage de l’API.',
    );
    process.exit(1);
  }

  const repo = await createRepository();
  const existing = await repo.establishments.listAll();
  if (existing.length > 0) {
    console.error(
      `La base contient déjà ${existing.length} établissement(s). Amorçage annulé\n` +
        'pour ne pas écraser des données existantes.',
    );
    await repo.close();
    process.exit(1);
  }

  const demo = buildDemoDataset();

  // L'ordre compte : les établissements avant les gérants (la relation est
  // portée par une table de liaison), puis tout ce qui référence un
  // établissement.
  for (const establishment of demo.establishments) {
    await repo.establishments.create(establishment);
  }
  for (const manager of demo.managers) await repo.managers.create(manager);
  for (const link of demo.platformLinks) await repo.platformLinks.upsert(link);
  for (const tag of demo.tags) await repo.tags.create(tag);
  await repo.reviews.upsertMany(demo.reviews);
  for (const scan of demo.scans) await repo.scans.create(scan);
  for (const alert of demo.alerts) await repo.alerts.create(alert);
  for (const member of demo.loyalty) await repo.loyalty.create(member);

  console.log(
    [
      'Jeu de démonstration chargé :',
      `  ${demo.establishments.length} établissements`,
      `  ${demo.tags.length} plaquettes NFC`,
      `  ${demo.reviews.length} avis`,
      `  ${demo.scans.length} scans`,
      '',
      `Connexion : ${DEMO_CREDENTIALS.email} / ${DEMO_CREDENTIALS.password}`,
    ].join('\n'),
  );

  await repo.close();
}

main().catch((error: unknown) => {
  console.error('Amorçage en échec :', error);
  process.exit(1);
});
