import { capabilities } from '../env.js';
import { createMemoryRepository } from './memory.js';
import type { Repository } from './types.js';

export type { Repository, ReviewQuery } from './types.js';
export { createMemoryRepository } from './memory.js';

/**
 * Choisit l'adaptateur de persistance.
 * DATABASE_URL renseignée -> PostgreSQL. Sinon mémoire + jeu de démonstration.
 */
export async function createRepository(): Promise<Repository> {
  if (!capabilities.persistence) return createMemoryRepository();
  const { createPrismaRepository } = await import('./prisma.js');
  return createPrismaRepository();
}
