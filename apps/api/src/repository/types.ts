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
  LoyaltyMember,
  Manager,
  NfcTag,
  PlatformId,
  PlatformLink,
  Review,
  ScanEvent,
} from '@avisio/core';

export interface ReviewQuery {
  establishmentId: string;
  status?: Review['status'];
  maxRating?: number;
  since?: string;
  limit?: number;
}

export interface Repository {
  readonly kind: 'memory' | 'prisma';

  managers: {
    findByEmail(email: string): Promise<Manager | null>;
    findById(id: string): Promise<Manager | null>;
    /** Destinataires des alertes d'un établissement. */
    listByEstablishment(establishmentId: string): Promise<Manager[]>;
    create(manager: Manager): Promise<Manager>;
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
    listByEstablishment(establishmentId: string, limit?: number): Promise<Alert[]>;
    markRead(id: string, at: string): Promise<void>;
    /** Évite de réémettre la même alerte de tendance plusieurs jours de suite. */
    existsSince(establishmentId: string, type: Alert['type'], title: string, since: string): Promise<boolean>;
  };

  loyalty: {
    findByContactHash(establishmentId: string, contactHash: string): Promise<LoyaltyMember | null>;
    create(member: LoyaltyMember): Promise<LoyaltyMember>;
    update(id: string, patch: Partial<LoyaltyMember>): Promise<LoyaltyMember>;
    countByEstablishment(establishmentId: string): Promise<number>;
  };

  close(): Promise<void>;
}
