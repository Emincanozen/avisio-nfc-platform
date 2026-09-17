/**
 * Intégration caisse / point de vente (offre Premium).
 *
 * La caisse pousse un ticket clôturé ; Avisio décide s'il faut inviter ce
 * client à déposer un avis et renvoie l'URL à imprimer sur le ticket.
 *
 * Règle de conformité, encore : **l'invitation ne dépend jamais du montant du
 * ticket, ni d'une satisfaction supposée**. Sélectionner les gros paniers ou
 * les habitués reviendrait à solliciter un échantillon choisi, ce que les
 * plateformes et la directive Omnibus interdisent. Le seul filtre est un délai
 * de carence par client, pour ne pas harceler un habitué qui vient tous les
 * jours.
 */

export type PosVendor = 'generic' | 'lightspeed' | 'zelty' | 'tiller' | 'square';

export interface PosTicket {
  /** Identifiant du ticket chez l'éditeur de caisse : garantit l'idempotence. */
  externalId: string;
  establishmentId: string;
  closedAt: string;
  /** Montant TTC en centimes. Conservé pour les statistiques, jamais pour filtrer. */
  totalCents: number;
  /** Contact fourni par la caisse, si le client l'a laissé. */
  contact?: string;
  contactChannel?: 'email' | 'sms';
  /** Table, couvert, vendeur… selon la caisse. Sert au rapprochement support. */
  reference?: string;
}

/** Délai de carence entre deux invitations au même client. */
export const INVITE_COOLDOWN_DAYS = 30;

/**
 * Délai avant envoi de l'invitation.
 *
 * Deux heures : le client a fini son repas et quitté l'établissement, mais
 * l'expérience est encore fraîche. Envoyer à la clôture du ticket attrape le
 * client encore à table, ce qui met le personnel dans une position gênante.
 */
export const INVITE_DELAY_MINUTES = 120;

export type PosDecision =
  | { invite: true; sendAt: string; reason: string }
  | { invite: false; reason: string };

export interface PosContext {
  /** true quand l'offre de l'établissement comprend l'intégration caisse. */
  entitled: boolean;
  /** Date de la dernière invitation envoyée à ce contact, le cas échéant. */
  lastInvitedAt?: string;
  /** true si ce ticket a déjà été traité. */
  alreadyProcessed: boolean;
}

export function decideInvitation(
  ticket: PosTicket,
  context: PosContext,
  now = new Date().toISOString(),
): PosDecision {
  if (!context.entitled) {
    return { invite: false, reason: "L'intégration caisse est comprise dans l'offre Premium." };
  }
  if (context.alreadyProcessed) {
    return { invite: false, reason: 'Ticket déjà traité.' };
  }
  if (!ticket.contact || !ticket.contactChannel) {
    // Pas de contact : le ticket est enregistré pour les statistiques et le QR
    // imprimé fait le travail. Ce n'est pas un échec.
    return { invite: false, reason: 'Aucun contact fourni : seul le QR du ticket sera utilisé.' };
  }
  if (context.lastInvitedAt) {
    const days =
      (new Date(now).getTime() - new Date(context.lastInvitedAt).getTime()) / 86_400_000;
    if (days < INVITE_COOLDOWN_DAYS) {
      return {
        invite: false,
        reason: `Client déjà invité il y a ${Math.floor(days)} jours (carence de ${INVITE_COOLDOWN_DAYS} jours).`,
      };
    }
  }

  return {
    invite: true,
    sendAt: new Date(
      new Date(ticket.closedAt).getTime() + INVITE_DELAY_MINUTES * 60_000,
    ).toISOString(),
    reason: `Invitation programmée ${INVITE_DELAY_MINUTES} minutes après la clôture du ticket.`,
  };
}

/** Message d'invitation, dans la langue de l'établissement. */
export function invitationMessage(
  establishmentName: string,
  tagUrl: string,
  channel: 'email' | 'sms',
): { subject?: string; body: string } {
  if (channel === 'sms') {
    // 160 caractères pour un SMS simple : au-delà, l'opérateur facture deux
    // segments et le message est tronqué sur certains téléphones.
    return {
      body: `${establishmentName} : merci de votre visite. Votre avis nous aide beaucoup, il prend une minute : ${tagUrl}`.slice(
        0,
        160,
      ),
    };
  }
  return {
    subject: `${establishmentName} — merci de votre visite`,
    body: `Bonjour,\n\nMerci d'être passé chez ${establishmentName}. Votre avis nous aide à progresser et prend une minute :\n\n${tagUrl}\n\nQuel qu'il soit, il sera publié tel quel : nous ne filtrons aucun avis.\n\nL'équipe de ${establishmentName}`,
  };
}

/**
 * Statistiques de l'intégration, affichées au gérant.
 * Le panier moyen est calculé ici parce que la caisse le fournit déjà — c'est
 * la seule donnée de gestion que le produit peut restituer sans effort.
 */
export interface PosStats {
  tickets: number;
  invitationsSent: number;
  /** Part des tickets ayant donné lieu à une invitation. */
  inviteRate: number;
  averageTicketCents: number;
}

export function posStats(tickets: PosTicket[], invitationsSent: number): PosStats {
  const total = tickets.reduce((acc, ticket) => acc + ticket.totalCents, 0);
  return {
    tickets: tickets.length,
    invitationsSent,
    inviteRate: tickets.length === 0 ? 0 : Number((invitationsSent / tickets.length).toFixed(3)),
    averageTicketCents: tickets.length === 0 ? 0 : Math.round(total / tickets.length),
  };
}
