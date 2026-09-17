/**
 * Intégration caisse / point de vente.
 *
 * Le webhook est public mais signé : la caisse ne présente pas de jeton de
 * session, elle signe son corps de requête avec la clé remise à l'installation.
 *
 * Le corps brut est nécessaire à la vérification de signature — d'où le parseur
 * dédié enregistré sur cette seule route : `JSON.parse` du corps déjà analysé
 * par Fastify donnerait un texte re-sérialisé, dont la signature ne
 * correspondrait plus (ordre des clés, espaces).
 */

import { hasFeature, type PosTicket } from '@avisio/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { assertAccess, httpError } from '../app.js';
import { PosAuthError } from '../services/pos.js';

const ticketSchema = z.object({
  externalId: z.string().min(1).max(120),
  closedAt: z.string().datetime(),
  totalCents: z.number().int().min(0).max(10_000_000),
  contact: z.string().min(5).max(160).optional(),
  contactChannel: z.enum(['email', 'sms']).optional(),
  reference: z.string().max(120).optional(),
});

export async function registerIntegrationRoutes(app: FastifyInstance): Promise<void> {
  const { repo, pos } = app.ctx;
  const protectedRoute = { onRequest: [app.authenticate] };

  /**
   * Webhook de caisse.
   *
   * En-têtes attendus :
   *   x-avisio-timestamp : horodatage Unix en secondes
   *   x-avisio-signature : HMAC-SHA256 de `<timestamp>.<corps brut>`
   */
  app.post(
    '/integrations/pos/:establishmentId',
    {
      config: { rawBody: true },
      // Conserve le corps brut avant l'analyse JSON, pour la signature.
      preParsing: async (request, _reply, payload) => {
        const chunks: Buffer[] = [];
        for await (const chunk of payload) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
        }
        const raw = Buffer.concat(chunks);
        (request as unknown as { rawBody: string }).rawBody = raw.toString('utf8');
        const { Readable } = await import('node:stream');
        return Readable.from(raw);
      },
    },
    async (request) => {
      const { establishmentId } = z
        .object({ establishmentId: z.string().min(3) })
        .parse(request.params);

      const signature = String(request.headers['x-avisio-signature'] ?? '');
      const timestamp = String(request.headers['x-avisio-timestamp'] ?? '');
      if (!signature || !timestamp) {
        throw httpError(401, 'En-têtes de signature manquants.');
      }

      try {
        await pos.verify({
          establishmentId,
          rawBody: (request as unknown as { rawBody: string }).rawBody ?? '',
          signature,
          timestamp,
        });
      } catch (error) {
        if (error instanceof PosAuthError) throw httpError(401, error.message);
        throw error;
      }

      const establishment = await repo.establishments.findById(establishmentId);
      if (!establishment) throw httpError(404, 'Établissement introuvable.');

      const body = ticketSchema.parse(request.body);
      const ticket: PosTicket = { ...body, establishmentId };

      return pos.handleTicket(establishment, ticket);
    },
  );

  // ---- Administration de l'intégration, côté gérant ----------------------

  app.get('/establishments/:id/pos', protectedRoute, async (request) => {
    const { id } = z.object({ id: z.string().min(3) }).parse(request.params);
    assertAccess(request, id);

    const establishment = await repo.establishments.findById(id);
    if (!establishment) throw httpError(404, 'Établissement introuvable.');

    const entitled = hasFeature(establishment.plan, establishment.addons, 'pos_integration');
    const credential = await repo.pos.getCredential(id);
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();

    return {
      entitled,
      configured: Boolean(credential),
      vendor: credential?.vendor ?? null,
      lastUsedAt: credential?.lastUsedAt ?? null,
      webhookUrl: `${request.protocol}://${request.host}/integrations/pos/${id}`,
      stats: await pos.stats(id, since),
    };
  });

  /**
   * Génère une clé de caisse. La valeur en clair n'est renvoyée qu'ici et
   * jamais stockée : si le gérant la perd, on en régénère une.
   */
  app.post('/establishments/:id/pos/credential', protectedRoute, async (request) => {
    const { id } = z.object({ id: z.string().min(3) }).parse(request.params);
    assertAccess(request, id);

    const establishment = await repo.establishments.findById(id);
    if (!establishment) throw httpError(404, 'Établissement introuvable.');
    if (!hasFeature(establishment.plan, establishment.addons, 'pos_integration')) {
      throw httpError(402, "L'intégration caisse est comprise dans l'offre Premium.");
    }

    const body = z
      .object({
        vendor: z.enum(['generic', 'lightspeed', 'zelty', 'tiller', 'square']).default('generic'),
      })
      .parse(request.body ?? {});

    const secret = await pos.issueCredential(id, body.vendor);
    return {
      secret,
      webhookUrl: `${request.protocol}://${request.host}/integrations/pos/${id}`,
      instructions:
        "Signez chaque appel : HMAC-SHA256 de `<timestamp>.<corps JSON>` avec cette clé, dans l'en-tête x-avisio-signature, et l'horodatage Unix en secondes dans x-avisio-timestamp. La fenêtre de validité est de 5 minutes.",
    };
  });

  app.get('/establishments/:id/pos/tickets', protectedRoute, async (request) => {
    const { id } = z.object({ id: z.string().min(3) }).parse(request.params);
    assertAccess(request, id);
    const { days } = z
      .object({ days: z.coerce.number().int().min(1).max(90).default(30) })
      .parse(request.query);

    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const tickets = await repo.pos.listTickets(id, since);

    // Le condensat du contact ne sort jamais de l'API : on expose seulement
    // le fait qu'un contact était présent.
    return tickets
      .sort((a, b) => b.closedAt.localeCompare(a.closedAt))
      .map((ticket) => ({
        id: ticket.id,
        externalId: ticket.externalId,
        closedAt: ticket.closedAt,
        totalCents: ticket.totalCents,
        reference: ticket.reference ?? null,
        hasContact: Boolean(ticket.contactHash),
        invitedAt: ticket.invitedAt ?? null,
      }));
  });
}
