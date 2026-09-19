/**
 * Authentification de l'espace gérant.
 *
 * Un compte peut porter plusieurs établissements (cas des chaînes) : la liste
 * est embarquée dans le JWT et sert de périmètre d'accès à chaque requête.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { httpError } from '../app.js';
import { verifyPassword } from '../auth.js';
import { clearRate, consumeRate } from '../ratelimit.js';

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  const { repo } = app.ctx;

  app.post('/auth/login', async (request) => {
    const body = z
      .object({ email: z.string().email(), password: z.string().min(8) })
      .parse(request.body);

    // Budget par compte, en plus du budget par adresse IP appliqué en amont.
    // C'est celui-ci qui protège réellement un mot de passe : deviner exige
    // d'insister sur le même compte, et changer d'adresse n'y change rien.
    // Il est consommé avant la vérification, donc y compris quand le compte
    // n'existe pas — sinon l'énumération des comptes resterait gratuite.
    await consumeRate(app, 'login', body.email.toLowerCase());

    const manager = await repo.managers.findByEmail(body.email);
    // Message identique dans les deux cas : ne pas révéler l'existence du compte.
    const invalid = httpError(401, 'Identifiants incorrects.');
    if (!manager) throw invalid;
    if (!verifyPassword(body.password, manager.passwordHash)) throw invalid;

    // Le mot de passe est bon : le compteur d'essais n'a plus lieu d'être.
    // Sans cette remise à zéro, un gérant qui se connecte sur son téléphone,
    // son ordinateur et sa tablette, puis relance son gestionnaire de mots de
    // passe, finirait par se verrouiller lui-même sur ses propres succès.
    await clearRate(app, 'login', body.email.toLowerCase());

    const token = app.jwt.sign({
      sub: manager.id,
      email: manager.email,
      role: manager.role,
      establishmentIds: manager.establishmentIds,
    });

    return {
      token,
      manager: {
        id: manager.id,
        email: manager.email,
        name: manager.name,
        role: manager.role,
        establishmentIds: manager.establishmentIds,
      },
    };
  });

  app.get('/auth/me', { onRequest: [app.authenticate] }, async (request) => {
    const claims = request.user as { sub: string };
    const manager = await repo.managers.findById(claims.sub);
    if (!manager) throw httpError(401, 'Session expirée.');
    const establishments = await repo.establishments.listByIds(manager.establishmentIds);
    return {
      manager: {
        id: manager.id,
        email: manager.email,
        name: manager.name,
        role: manager.role,
      },
      establishments,
    };
  });
}
