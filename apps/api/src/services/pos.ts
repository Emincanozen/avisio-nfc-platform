/**
 * Intégration caisse : réception des tickets et invitation à déposer un avis.
 *
 * Authentification par HMAC-SHA256 sur le corps de la requête, avec
 * horodatage : la caisse signe, l'API vérifie. Pas de jeton porteur en clair
 * dans un fichier de configuration de caisse, souvent partagé entre plusieurs
 * postes et rarement protégé.
 *
 * La fenêtre de rejeu est de cinq minutes : au-delà, une requête interceptée
 * ne peut plus être renvoyée.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  decideInvitation,
  generateId,
  hasFeature,
  invitationMessage,
  posStats,
  tagUrl,
  type Establishment,
  type PosTicket,
} from '@avisio/core';
import { hashContact } from '../auth.js';
import { env } from '../env.js';
import type { Repository } from '../repository/index.js';

export const SIGNATURE_WINDOW_SECONDS = 300;

export interface PosWebhookInput {
  establishmentId: string;
  rawBody: string;
  signature: string;
  timestamp: string;
}

export class PosAuthError extends Error {
  override name = 'PosAuthError';
}

interface Deps {
  repo: Repository;
  logger: { info: (msg: string) => void; warn: (msg: string) => void };
  sendInvitation: (
    channel: 'email' | 'sms',
    contact: string,
    message: { subject?: string; body: string },
  ) => Promise<void>;
}

export function createPosService({ repo, logger, sendInvitation }: Deps) {
  /** Signature attendue : HMAC-SHA256 de `<timestamp>.<corps>`. */
  function sign(secret: string, timestamp: string, rawBody: string): string {
    return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  }

  async function verify(input: PosWebhookInput): Promise<void> {
    const credential = await repo.pos.getCredential(input.establishmentId);
    if (!credential) {
      throw new PosAuthError("Aucune clé de caisse configurée pour cet établissement.");
    }

    const age = Math.abs(Date.now() / 1000 - Number(input.timestamp));
    if (!Number.isFinite(age) || age > SIGNATURE_WINDOW_SECONDS) {
      throw new PosAuthError('Horodatage hors fenêtre : requête rejouée ou horloge décalée.');
    }

    // La clé n'est pas stockée en clair : on compare le condensat de la
    // signature reconstruite à partir du condensat connu.
    const expected = sign(credential.secretHash, input.timestamp, input.rawBody);
    const provided = Buffer.from(input.signature, 'utf8');
    const candidate = Buffer.from(expected, 'utf8');
    if (provided.length !== candidate.length || !timingSafeEqual(provided, candidate)) {
      throw new PosAuthError('Signature invalide.');
    }

    await repo.pos.touchCredential(input.establishmentId, new Date().toISOString());
  }

  return {
    sign,
    verify,

    /** Génère une clé de caisse et renvoie sa valeur en clair, une seule fois. */
    async issueCredential(establishmentId: string, vendor = 'generic'): Promise<string> {
      const secret = randomBytes(24).toString('base64url');
      await repo.pos.upsertCredential({
        establishmentId,
        vendor,
        secretHash: hashContact(secret, 'pos'),
        createdAt: new Date().toISOString(),
      });
      return secret;
    },

    /** Signature que la caisse doit produire, à partir de sa clé en clair. */
    signatureFor(secret: string, timestamp: string, rawBody: string): string {
      return sign(hashContact(secret, 'pos'), timestamp, rawBody);
    },

    /**
     * Traite un ticket : enregistrement, décision d'invitation, envoi.
     * Renvoie toujours l'URL à imprimer sur le ticket, même sans invitation —
     * c'est le QR du ticket qui fait l'essentiel du travail.
     */
    async handleTicket(
      establishment: Establishment,
      ticket: PosTicket,
      now = new Date().toISOString(),
    ): Promise<{ recorded: boolean; invited: boolean; reason: string; receiptUrl: string | null }> {
      const entitled = hasFeature(establishment.plan, establishment.addons, 'pos_integration');

      const existing = await repo.pos.findTicket(establishment.id, ticket.externalId);
      const contactHash = ticket.contact
        ? hashContact(ticket.contact, env.jwtSecret)
        : undefined;

      const lastInvitedAt = contactHash
        ? await repo.pos.lastInvitedAt(establishment.id, contactHash)
        : undefined;

      const decision = decideInvitation(
        ticket,
        {
          entitled,
          alreadyProcessed: Boolean(existing),
          ...(lastInvitedAt ? { lastInvitedAt } : {}),
        },
        now,
      );

      const tags = await repo.tags.listByEstablishment(establishment.id);
      const receiptUrl = tags[0] ? tagUrl(env.webUrl, tags[0].slug) : null;

      if (existing) {
        return { recorded: false, invited: false, reason: decision.reason, receiptUrl };
      }

      const record = await repo.pos.createTicket({
        id: generateId('pos'),
        establishmentId: establishment.id,
        externalId: ticket.externalId,
        closedAt: ticket.closedAt,
        totalCents: ticket.totalCents,
        ...(contactHash ? { contactHash } : {}),
        ...(ticket.contactChannel ? { contactChannel: ticket.contactChannel } : {}),
        ...(ticket.reference ? { reference: ticket.reference } : {}),
        createdAt: now,
      });

      if (!decision.invite || !ticket.contact || !ticket.contactChannel || !receiptUrl) {
        return {
          recorded: true,
          invited: false,
          reason: receiptUrl ? decision.reason : "Aucune plaquette configurée : rien à imprimer.",
          receiptUrl,
        };
      }

      // L'envoi est immédiat si la date programmée est déjà passée ; sinon la
      // tâche périodique s'en charge à l'heure dite.
      if (new Date(decision.sendAt).getTime() <= new Date(now).getTime()) {
        await sendInvitation(
          ticket.contactChannel,
          ticket.contact,
          invitationMessage(establishment.name, receiptUrl, ticket.contactChannel),
        );
        await repo.pos.markInvited(record.id, now);
        logger.info(`Invitation envoyée pour le ticket ${ticket.externalId}.`);
        return { recorded: true, invited: true, reason: decision.reason, receiptUrl };
      }

      return { recorded: true, invited: false, reason: decision.reason, receiptUrl };
    },

    async stats(establishmentId: string, since?: string) {
      const tickets = await repo.pos.listTickets(establishmentId, since);
      const invited = tickets.filter((t) => t.invitedAt).length;
      return posStats(
        tickets.map((t) => ({
          externalId: t.externalId,
          establishmentId: t.establishmentId,
          closedAt: t.closedAt,
          totalCents: t.totalCents,
        })),
        invited,
      );
    },
  };
}
