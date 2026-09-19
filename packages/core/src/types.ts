/**
 * Types du domaine Avisio.
 *
 * Règle structurante : le produit ne s'interpose jamais entre le client et la
 * plateforme d'avis. Aucun type ne porte de notion de « filtrage avant
 * publication » — voir `compliance.ts`.
 */

export type PlanId = 'essentiel' | 'pro' | 'premium';

export type AddonId =
  | 'negative_reviews'
  | 'extra_platform'
  | 'analytics'
  | 'loyalty';

export type PlatformId =
  | 'google'
  | 'tripadvisor'
  | 'facebook'
  | 'yelp'
  | 'thefork';

export type Sector =
  | 'restaurant'
  | 'bar'
  | 'hotel'
  | 'retail'
  | 'beauty'
  | 'health'
  | 'other';

export type Locale = 'fr' | 'en' | 'es' | 'de' | 'it' | 'nl';

export interface Establishment {
  id: string;
  name: string;
  sector: Sector;
  postalCode: string;
  /** Code NAF, utilisé pour le benchmark sectoriel anonymisé. */
  nafCode?: string;
  plan: PlanId;
  addons: AddonId[];
  /** Engagement 12 mois : conditionne la gratuité de la mise en service. */
  committed12Months: boolean;
  /** Ton de marque injecté dans le prompt de suggestion de réponse. */
  brandTone: string;
  defaultLocale: Locale;
  createdAt: string;
}

export interface PlatformLink {
  establishmentId: string;
  platform: PlatformId;
  /** URL publique de dépôt d'avis (deep link mobile quand disponible). */
  reviewUrl: string;
  /** Identifiant côté plateforme (place id, page id, business id…). */
  externalId?: string;
  enabled: boolean;
  /** Compteur d'avis connus, alimenté par les connecteurs de lecture. */
  reviewCount: number;
  /** Nombre de scans routés vers cette plateforme (fallback sans API). */
  routedScans: number;
  averageRating?: number;
}

export interface NfcTag {
  id: string;
  establishmentId: string;
  label: string;
  /** Slug encodé dans l'URL du tag : https://avis.io/s/<slug> */
  slug: string;
  material: 'sticker' | 'chevalet' | 'premium';
  createdAt: string;
  scanCount: number;
  lastScanAt?: string;
}

export interface ScanEvent {
  id: string;
  tagId: string;
  establishmentId: string;
  platform: PlatformId;
  locale: Locale;
  userAgent?: string;
  createdAt: string;
}

export type ReviewStatus = 'new' | 'draft_ready' | 'answered' | 'ignored';

export interface Review {
  id: string;
  establishmentId: string;
  platform: PlatformId;
  externalId: string;
  author: string;
  rating: number;
  comment: string;
  /** Date de publication côté plateforme. */
  publishedAt: string;
  /** Date de récupération par l'ingestion. */
  ingestedAt: string;
  /**
   * Provenance de l'avis.
   *
   * `sync` : rapatrié par un connecteur de plateforme.
   * `import` : chargé à la main depuis un export, en attendant l'accès API.
   *
   * Absent sur les avis antérieurs à ce champ, traités comme `sync`. La
   * distinction existe pour qu'aucun chiffre du tableau de bord ne puisse
   * laisser croire à une connexion en direct qui n'existe pas.
   */
  source?: 'sync' | 'import';
  status: ReviewStatus;
  replyText?: string;
  repliedAt?: string;
  analysis?: ReviewAnalysis;
}

export interface ReviewAnalysis {
  sentiment: 'positive' | 'neutral' | 'negative';
  /** Score de -1 (très négatif) à 1 (très positif). */
  score: number;
  themes: ThemeId[];
  /** Mots-clés saillants, utilisés pour les alertes de tendance. */
  keywords: string[];
  language: string;
  /** Moteur ayant produit l'analyse : utile pour l'audit et le coût. */
  engine: 'llm' | 'heuristic';
}

export type ThemeId =
  | 'attente'
  | 'accueil'
  | 'qualite_produit'
  | 'proprete'
  | 'prix'
  | 'ambiance'
  | 'service'
  | 'reservation'
  | 'autre';

export interface LoyaltyMember {
  id: string;
  establishmentId: string;
  /** Identifiant de contact haché : on ne stocke jamais le numéro en clair. */
  contactHash: string;
  channel: 'sms' | 'email';
  points: number;
  createdAt: string;
  lastEarnedAt?: string;
}

/**
 * `owner` : gérant, accès limité à ses propres établissements.
 * `admin` : exploitant d'Avisio, accès au back-office et à tout le parc.
 */
export type ManagerRole = 'owner' | 'admin';

export interface Manager {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  role: ManagerRole;
  establishmentIds: string[];
  createdAt: string;
}

export interface Alert {
  id: string;
  establishmentId: string;
  type: 'negative_review' | 'theme_trend' | 'rating_drop';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  body: string;
  reviewId?: string;
  createdAt: string;
  readAt?: string;
}
