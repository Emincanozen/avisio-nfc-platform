/**
 * Connecteur Google Business Profile.
 *
 * API réelle : `accounts.locations.reviews.list` (Business Profile API v4).
 * Elle exige un projet Google Cloud avec l'API activée, un accès validé par
 * Google (formulaire d'accès, délai de quelques semaines) et un jeton OAuth du
 * propriétaire de la fiche. Tant que ces conditions ne sont pas réunies, le
 * connecteur simulé prend le relais : même interface, mêmes cadences, avis
 * générés — ce qui permet de développer et de démontrer le produit avant
 * l'obtention des accès.
 *
 * Limites à connaître : quota par défaut de 300 requêtes/minute et par projet,
 * pas de webhook d'avis — d'où le polling toutes les 15-30 minutes retenu dans
 * le plan technique.
 */

import { generateId, type PlatformId, type Review } from '@avisio/core';
import { capabilities, env } from '../env.js';

export interface ExternalReview {
  externalId: string;
  author: string;
  rating: number;
  comment: string;
  publishedAt: string;
  replyText?: string;
}

export interface PlatformCounters {
  reviewCount: number;
  averageRating?: number;
}

/**
 * Ce qu'un connecteur reçoit pour travailler.
 *
 * L'identifiant d'établissement en fait partie — et non seulement
 * l'identifiant de fiche — parce que l'autorisation d'accès est propre à
 * chaque client : c'est lui qui permet de retrouver SON jeton. Un connecteur
 * qui ne recevrait que l'identifiant de fiche imposerait un jeton global, ce
 * qui n'existe pas chez Google.
 */
export interface ConnectorTarget {
  establishmentId: string;
  /** Identifiant côté plateforme (`locations/123…`, place id, page id…). */
  externalId: string | null;
}

export interface ReviewConnector {
  readonly platform: PlatformId;
  readonly live: boolean;
  /** Avis publiés depuis `since`, du plus récent au plus ancien. */
  fetchReviews(target: ConnectorTarget, since?: string): Promise<ExternalReview[]>;
  fetchCounters(target: ConnectorTarget): Promise<PlatformCounters | null>;
  /** Publie la réponse du gérant sur la plateforme. */
  publishReply(target: ConnectorTarget, reviewExternalId: string, text: string): Promise<void>;
}

/**
 * Fournit le jeton d'accès valide d'un établissement, ou `null` s'il n'a pas
 * (ou plus) autorisé Avisio sur sa fiche.
 */
export type AccessTokenProvider = (establishmentId: string) => Promise<string | null>;

const GOOGLE_API = 'https://mybusiness.googleapis.com/v4';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * Connecteur Google réel.
 *
 * Il ne détient aucun jeton : il en demande un à `tokenFor`, qui va le
 * chercher dans l'autorisation donnée par le propriétaire de la fiche. Sans
 * autorisation, il ne se plaint pas — il ne renvoie rien. C'est le
 * comportement juste : un établissement qui n'a pas connecté Google n'est pas
 * une erreur d'exploitation, c'est un onboarding en cours.
 */
export function createGoogleConnector(
  logger: { warn: (msg: string) => void; info: (msg: string) => void },
  tokenFor: AccessTokenProvider,
): ReviewConnector {
  const call = async (
    establishmentId: string,
    path: string,
    init: RequestInit = {},
  ): Promise<unknown> => {
    const accessToken = await tokenFor(establishmentId);
    if (!accessToken) throw new NotConnectedError(establishmentId);

    const response = await fetch(`${GOOGLE_API}/${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
    });
    if (response.status === 429) {
      // Message explicite : c'est l'erreur que rencontre tout projet dont la
      // demande d'accès n'a pas encore été approuvée — quota par défaut à 0.
      throw new Error(
        'Quota Google épuisé (un projet non encore approuvé a un quota de 0 requête/minute)',
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(`Autorisation Google refusée (${response.status}) sur ${path}`);
    }
    if (!response.ok) throw new Error(`Google API ${response.status} sur ${path}`);
    return response.json();
  };

  return {
    platform: 'google',
    live: true,

    async fetchReviews({ establishmentId, externalId }, since) {
      if (!externalId) return [];
      const locationName = externalId;
      const floor = since ? new Date(since).getTime() : 0;
      const collected: ExternalReview[] = [];
      let pageToken: string | undefined;

      // La pagination s'arrête dès qu'on atteint un avis déjà connu : sur un
      // établissement à fort volume, cela évite de rapatrier tout l'historique
      // à chaque cycle.
      do {
        const query = new URLSearchParams({ pageSize: '50', orderBy: 'updateTime desc' });
        if (pageToken) query.set('pageToken', pageToken);
        const body = (await call(establishmentId, `${locationName}/reviews?${query}`)) as {
          reviews?: GoogleReview[];
          nextPageToken?: string;
        };
        const page = body.reviews ?? [];
        for (const review of page) {
          const publishedAt = review.createTime ?? review.updateTime ?? new Date().toISOString();
          if (new Date(publishedAt).getTime() <= floor) return collected;
          collected.push({
            externalId: review.reviewId,
            author: review.reviewer?.displayName ?? 'Client Google',
            rating: STAR_VALUES[review.starRating] ?? 0,
            comment: review.comment ?? '',
            publishedAt,
            ...(review.reviewReply?.comment ? { replyText: review.reviewReply.comment } : {}),
          });
        }
        pageToken = body.nextPageToken;
      } while (pageToken && collected.length < 500);

      return collected;
    },

    async fetchCounters({ establishmentId, externalId }) {
      if (!externalId) return null;
      const body = (await call(establishmentId, `${externalId}/reviews?pageSize=1`)) as {
        totalReviewCount?: number;
        averageRating?: number;
      };
      return {
        reviewCount: body.totalReviewCount ?? 0,
        ...(body.averageRating == null ? {} : { averageRating: body.averageRating }),
      };
    },

    async publishReply({ establishmentId, externalId }, reviewExternalId, text) {
      if (!externalId) throw new NotConnectedError(establishmentId);
      await call(establishmentId, `${externalId}/reviews/${reviewExternalId}/reply`, {
        method: 'PUT',
        body: JSON.stringify({ comment: text }),
      });
    },
  };
}

/**
 * L'établissement n'a pas autorisé Avisio sur sa fiche.
 *
 * Erreur distincte pour que l'ingestion la traite comme un état d'onboarding
 * — à signaler dans l'interface — et non comme une panne à alerter.
 */
export class NotConnectedError extends Error {
  constructor(readonly establishmentId: string) {
    super("Aucune autorisation Google pour cet établissement.");
    this.name = 'NotConnectedError';
  }
}

interface GoogleReview {
  reviewId: string;
  reviewer?: { displayName?: string };
  starRating: keyof typeof STAR_VALUES;
  comment?: string;
  createTime?: string;
  updateTime?: string;
  reviewReply?: { comment: string };
}

const STAR_VALUES = {
  STAR_RATING_UNSPECIFIED: 0,
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
} as const;

// ---------------------------------------------------------------------------
// Connecteur simulé
// ---------------------------------------------------------------------------

const SIMULATED_COMMENTS: Array<[number, string]> = [
  [5, 'Très bonne expérience, accueil au top et produits de qualité.'],
  [4, 'Bon moment, service efficace. Je reviendrai.'],
  [5, 'Rien à redire : équipe souriante, cadre agréable.'],
  [2, "Beaucoup d'attente et personne pour nous renseigner, dommage."],
  [3, 'Correct mais un peu cher pour ce que c’est.'],
  [1, 'Très déçu, accueil désagréable et attente interminable.'],
  [4, 'Ambiance sympathique, quelques lenteurs au service.'],
];

/**
 * Connecteur simulé : produit 0 à 2 avis par cycle, avec la même distribution
 * de notes qu'un établissement réel (≈ 70 % de 4-5 étoiles). Il permet de
 * dérouler toute la chaîne — ingestion, analyse, alerte, réponse — sans accès
 * aux API partenaires.
 */
export function createSimulatedConnector(platform: PlatformId): ReviewConnector {
  return {
    platform,
    live: false,

    async fetchReviews() {
      const count = Math.random() < 0.55 ? 0 : Math.random() < 0.8 ? 1 : 2;
      return Array.from({ length: count }, () => {
        const [rating, comment] =
          SIMULATED_COMMENTS[Math.floor(Math.random() * SIMULATED_COMMENTS.length)]!;
        return {
          externalId: generateId('sim'),
          author: SIMULATED_AUTHORS[Math.floor(Math.random() * SIMULATED_AUTHORS.length)]!,
          rating,
          comment,
          publishedAt: new Date().toISOString(),
        } satisfies ExternalReview;
      });
    },

    async fetchCounters() {
      return null; // le compteur reste celui de la base
    },

    async publishReply() {
      // En mode simulé, la publication est un no-op tracé côté API.
    },
  };
}

const SIMULATED_AUTHORS = [
  'Alexandre P.',
  'Manon D.',
  'Yanis B.',
  'Chloé F.',
  'Romain T.',
  'Fatima A.',
];

/** Convertit un avis de plateforme en avis du domaine. */
export function toDomainReview(
  external: ExternalReview,
  establishmentId: string,
  platform: PlatformId,
): Review {
  return {
    id: generateId('rev'),
    establishmentId,
    platform,
    externalId: external.externalId,
    author: external.author,
    rating: external.rating,
    comment: external.comment,
    publishedAt: external.publishedAt,
    ingestedAt: new Date().toISOString(),
    status: external.replyText ? 'answered' : 'new',
    ...(external.replyText ? { replyText: external.replyText, repliedAt: external.publishedAt } : {}),
  };
}
