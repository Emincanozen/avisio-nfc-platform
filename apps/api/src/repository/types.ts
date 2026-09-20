/**
 * Port de persistance.
 *
 * Le domaine ne connaît que cette interface. Deux adaptateurs l'implémentent :
 *  - `memory` : démarrage immédiat, jeu de démonstration, données volatiles ;
 *  - `prisma` : PostgreSQL, utilisé dès que DATABASE_URL est renseignée.
 *
 * Toute requête porte l'identifiant d'établissement : c'est la frontière de
 * cloisonnement multi-locataire, vérifiée une seconde fois dans les routes.
 */

import type {
  Alert,
  Establishment,
  Invoice,
  LoyaltyMember,
  Manager,
  NfcTag,
  NotificationPreferences,
  PlatformId,
  PlatformLink,
  Review,
  ScanEvent,
  Subscription,
} from '@avisio/core';

export interface ReviewQuery {
  establishmentId: string;
  status?: Review['status'];
  maxRating?: number;
  since?: string;
  /**
   * Restreint à une plateforme.
   *
   * Nécessaire pour trouver le dernier avis connu SUR une plateforme donnée.
   * Sans ce filtre, on prenait les 200 avis les plus récents toutes
   * plateformes confondues : un établissement très actif sur Google pouvait
   * n'avoir aucun avis TripAdvisor dans cette tranche, la borne temporelle
   * était alors perdue et le connecteur rapatriait tout l'historique à chaque
   * cycle — de la latence, et du quota d'API tierce brûlé pour rien.
   */
  platform?: Review['platform'];
  limit?: number;
}

export interface PushSubscriptionRecord {
  id: string;
  managerId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
  createdAt: string;
  lastUsedAt?: string;
}

export interface PendingPushRecord {
  id: string;
  managerId: string;
  title: string;
  body: string;
  url?: string;
  sendAt: string;
  sentAt?: string;
  createdAt: string;
}

export interface PosTicketRecord {
  id: string;
  establishmentId: string;
  externalId: string;
  closedAt: string;
  totalCents: number;
  contactHash?: string;
  contactChannel?: 'email' | 'sms';
  reference?: string;
  invitedAt?: string;
  createdAt: string;
}

export interface PosCredentialRecord {
  establishmentId: string;
  vendor: string;
  secretHash: string;
  createdAt: string;
  lastUsedAt?: string;
}

/**
 * Autorisation Google accordée par le propriétaire d'une fiche.
 *
 * Une ligne par établissement : la fiche appartient au client, pas à Avisio,
 * et c'est son consentement qui est stocké — scellé, jamais en clair.
 */
export interface GoogleConnectionRecord {
  establishmentId: string;
  /** Jeton de rafraîchissement scellé (voir `services/secrets.ts`). */
  refreshTokenSealed: string;
  /** Portées réellement accordées, telles que Google les a renvoyées. */
  scope: string;
  /** Fiche sélectionnée : `locations/123…`. Nul tant que le client n'a pas choisi. */
  locationName?: string;
  locationTitle?: string;
  connectedAt: string;
  /** Compte ayant donné l'autorisation, pour que le client s'y reconnaisse. */
  authorizedBy?: string;
  lastSyncAt?: string;
  /**
   * Dernière erreur rencontrée par la synchronisation.
   *
   * Conservée pour que l'interface puisse dire au client que sa connexion est
   * rompue. Une connexion qui échoue en silence est pire que pas de connexion :
   * il croit être couvert alors qu'il ne l'est plus.
   */
  lastError?: string;
}

export interface Repository {
  readonly kind: 'memory' | 'prisma';

  managers: {
    findByEmail(email: string): Promise<Manager | null>;
    findById(id: string): Promise<Manager | null>;
    /** Destinataires des alertes d'un établissement. */
    listByEstablishment(establishmentId: string): Promise<Manager[]>;
    listAll(): Promise<Manager[]>;
    create(manager: Manager): Promise<Manager>;
    update(id: string, patch: Partial<Manager>): Promise<Manager>;
  };

  establishments: {
    create(establishment: Establishment): Promise<Establishment>;
    findById(id: string): Promise<Establishment | null>;
    listByIds(ids: string[]): Promise<Establishment[]>;
    listAll(): Promise<Establishment[]>;
    update(id: string, patch: Partial<Establishment>): Promise<Establishment>;
  };

  platformLinks: {
    listByEstablishment(establishmentId: string): Promise<PlatformLink[]>;
    upsert(link: PlatformLink): Promise<PlatformLink>;
    incrementRoutedScans(establishmentId: string, platform: PlatformId): Promise<void>;
    syncCounts(
      establishmentId: string,
      platform: PlatformId,
      counts: { reviewCount: number; averageRating?: number },
    ): Promise<void>;
  };

  tags: {
    findBySlug(slug: string): Promise<NfcTag | null>;
    listByEstablishment(establishmentId: string): Promise<NfcTag[]>;
    create(tag: NfcTag): Promise<NfcTag>;
    recordScan(tagId: string, at: string): Promise<void>;
  };

  scans: {
    create(scan: ScanEvent): Promise<ScanEvent>;
    listByEstablishment(establishmentId: string, since?: string): Promise<ScanEvent[]>;
  };

  reviews: {
    query(query: ReviewQuery): Promise<Review[]>;
    findById(id: string): Promise<Review | null>;
    /** Insère les avis inconnus, renvoie uniquement les nouveaux. */
    upsertMany(reviews: Review[]): Promise<Review[]>;
    update(id: string, patch: Partial<Review>): Promise<Review>;
    /** Utilisé par le benchmark : lecture transverse, agrégée ensuite. */
    listAll(): Promise<Review[]>;
  };

  alerts: {
    create(alert: Alert): Promise<Alert>;
    findById(id: string): Promise<Alert | null>;
    listByEstablishment(establishmentId: string, limit?: number): Promise<Alert[]>;
    markRead(id: string, at: string): Promise<void>;
    /** Évite de réémettre la même alerte de tendance plusieurs jours de suite. */
    existsSince(
      establishmentId: string,
      type: Alert['type'],
      title: string,
      since: string,
    ): Promise<boolean>;
  };

  loyalty: {
    findByContactHash(establishmentId: string, contactHash: string): Promise<LoyaltyMember | null>;
    create(member: LoyaltyMember): Promise<LoyaltyMember>;
    update(id: string, patch: Partial<LoyaltyMember>): Promise<LoyaltyMember>;
    countByEstablishment(establishmentId: string): Promise<number>;
  };

  // -------------------------------------------------------------------------
  // Facturation
  // -------------------------------------------------------------------------

  subscriptions: {
    create(subscription: Subscription): Promise<Subscription>;
    findByEstablishment(establishmentId: string): Promise<Subscription | null>;
    findById(id: string): Promise<Subscription | null>;
    listAll(): Promise<Subscription[]>;
    /** Abonnements dont la période est échue : à facturer. */
    listDue(now: string): Promise<Subscription[]>;
    update(id: string, patch: Partial<Subscription>): Promise<Subscription>;
  };

  invoices: {
    /**
     * Crée la facture en réservant son numéro dans la même opération.
     * C'est cette atomicité qui garantit une séquence sans trou.
     */
    create(invoice: Omit<Invoice, 'id' | 'number'>, year: number): Promise<Invoice>;
    findById(id: string): Promise<Invoice | null>;
    listByEstablishment(establishmentId: string): Promise<Invoice[]>;
    listAll(): Promise<Invoice[]>;
    /** Factures ouvertes dont l'échéance est dépassée. */
    listOverdue(now: string): Promise<Invoice[]>;
    update(id: string, patch: Partial<Invoice>): Promise<Invoice>;
  };

  // -------------------------------------------------------------------------
  // Notifications
  // -------------------------------------------------------------------------

  push: {
    subscribe(record: PushSubscriptionRecord): Promise<PushSubscriptionRecord>;
    /**
     * Abonnement rattaché à ce point de terminaison, quel qu'en soit le
     * propriétaire.
     *
     * Nécessaire pour refuser une réattribution : `subscribe` écrasait le
     * `managerId` d'un enregistrement existant, si bien qu'un gérant
     * connaissant le point de terminaison d'un autre se l'appropriait — et
     * l'autre cessait de recevoir ses alertes sans rien remarquer.
     */
    findByEndpoint(endpoint: string): Promise<PushSubscriptionRecord | null>;
    listByManager(managerId: string): Promise<PushSubscriptionRecord[]>;
    unsubscribe(endpoint: string): Promise<void>;
    queue(record: PendingPushRecord): Promise<PendingPushRecord>;
    listQueued(now: string): Promise<PendingPushRecord[]>;
    markSent(id: string, at: string): Promise<void>;
  };

  notificationPreferences: {
    get(establishmentId: string): Promise<NotificationPreferences | null>;
    upsert(preferences: NotificationPreferences): Promise<NotificationPreferences>;
  };

  // -------------------------------------------------------------------------
  // Intégration caisse
  // -------------------------------------------------------------------------

  pos: {
    findTicket(establishmentId: string, externalId: string): Promise<PosTicketRecord | null>;
    createTicket(ticket: PosTicketRecord): Promise<PosTicketRecord>;
    listTickets(establishmentId: string, since?: string): Promise<PosTicketRecord[]>;
    markInvited(id: string, at: string): Promise<void>;
    /** Dernière invitation envoyée à ce contact, pour la carence. */
    lastInvitedAt(establishmentId: string, contactHash: string): Promise<string | undefined>;
    getCredential(establishmentId: string): Promise<PosCredentialRecord | null>;
    upsertCredential(credential: PosCredentialRecord): Promise<PosCredentialRecord>;
    touchCredential(establishmentId: string, at: string): Promise<void>;
  };

  // -------------------------------------------------------------------------
  // Connexion Google par établissement
  // -------------------------------------------------------------------------

  googleConnections: {
    get(establishmentId: string): Promise<GoogleConnectionRecord | null>;
    upsert(record: GoogleConnectionRecord): Promise<GoogleConnectionRecord>;
    update(
      establishmentId: string,
      patch: Partial<GoogleConnectionRecord>,
    ): Promise<GoogleConnectionRecord>;
    remove(establishmentId: string): Promise<void>;
    listAll(): Promise<GoogleConnectionRecord[]>;
  };

  // -------------------------------------------------------------------------
  // Limitation de débit
  // -------------------------------------------------------------------------

  /**
   * Compteurs de la limitation de débit.
   *
   * Derrière le port, et non dans une variable de module, pour une raison
   * précise : sur plusieurs instances d'API, un compteur en mémoire divise le
   * budget réel par le nombre d'instances et se réinitialise à chaque
   * redéploiement. L'adaptateur PostgreSQL rend le compteur commun aux
   * instances et lui donne une durée de vie indépendante des processus.
   */
  rateLimit: {
    /**
     * Incrémente le compteur de `key` et renvoie son rang dans la fenêtre :
     * la première requête vaut 1. `expiresAt` borne la vie de la ligne, une
     * fenêtre écoulée n'ayant plus aucune valeur.
     */
    hit(key: string, expiresAt: string): Promise<number>;
    /**
     * Efface un compteur.
     *
     * Sert au seul cas où l'événement compté prouve qu'il n'était pas un
     * abus : une connexion réussie. Le budget de connexion existe pour
     * ralentir qui devine un mot de passe ; un mot de passe correct est la
     * démonstration du contraire, et laisser le compteur courir verrouillerait
     * un utilisateur légitime sur ses propres succès.
     */
    reset(key: string): Promise<void>;
  };

  close(): Promise<void>;
}
