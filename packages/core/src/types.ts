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

/**
 * Cycle de vie d'une réponse à un avis.
 *
 * `answered` signifie **publié et confirmé par la plateforme**, rien d'autre.
 * La distinction avec `reply_pending` corrige un défaut réel : un avis était
 * marqué répondu même quand la plateforme n'était pas connectée et que rien
 * n'avait été publié. Le gérant croyait avoir répondu publiquement ; son
 * client ne voyait jamais la réponse, et le taux de réponse affiché — un
 * indicateur vendu — comptait des réponses qui n'existaient pas.
 *
 * | Statut          | Ce qu'il veut dire                                    |
 * |-----------------|-------------------------------------------------------|
 * | `new`           | rien n'a été fait                                     |
 * | `draft_ready`   | une suggestion existe, non validée par le gérant       |
 * | `reply_pending` | texte validé, publication **non confirmée**           |
 * | `answered`      | publié et confirmé par la plateforme                   |
 * | `reply_failed`  | la plateforme a refusé la publication                  |
 * | `ignored`       | le gérant a décidé de ne pas répondre                  |
 */
export type ReviewStatus =
  | 'new'
  | 'draft_ready'
  | 'reply_pending'
  | 'answered'
  | 'reply_failed'
  | 'ignored';

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
   * `sync` : rapatrié d'une plateforme par un connecteur **réel**.
   * `import` : chargé à la main depuis un export, en attendant l'accès API.
   * `demo` : **fabriqué** par le connecteur simulé, en mode démonstration.
   *
   * Absent sur les avis antérieurs à ce champ, traités comme `sync`.
   *
   * `demo` est la distinction qui compte : un avis fabriqué ne doit jamais
   * entrer dans une métrique montrée au client, ni pouvoir être confondu avec
   * un avis réel. Le simulateur tournait auparavant sans marquage, y compris
   * sur une base PostgreSQL de production.
   */
  source?: 'sync' | 'import' | 'demo';
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
