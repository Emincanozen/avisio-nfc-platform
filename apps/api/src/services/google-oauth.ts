/**
 * Consentement Google par établissement.
 *
 * Le connecteur d'origine s'appuyait sur un jeton de rafraîchissement unique,
 * lu dans l'environnement. C'est impossible en multi-établissements : personne
 * ne peut consentir à la place d'un autre, et la fiche d'un restaurant
 * n'appartient pas à Avisio. Chaque propriétaire autorise donc l'application
 * sur SA fiche, et c'est son jeton — scellé en base — qui sert pour elle.
 *
 * Ce que Google exige, et qui ne dépend pas de ce code :
 *
 *  1. Un projet Google Cloud avec l'API Business Profile activée.
 *  2. Une demande d'accès validée par Google. Tant qu'elle ne l'est pas, le
 *     quota du projet reste à 0 requête/minute et TOUT appel échoue — ce n'est
 *     pas une erreur d'implémentation, c'est l'état par défaut. Une fois
 *     accordé, le quota passe à 300 requêtes/minute.
 *  3. Pour la demande : une fiche vérifiée et active depuis plus de 60 jours,
 *     un site web représentant l'établissement, et le numéro du projet Cloud.
 *  4. Le consentement OAuth du propriétaire de chaque fiche.
 *
 * Le délai d'approbation se compte en semaines. Tout ce qui précède le point 2
 * est implémenté et testable ; la lecture d'avis réels ne l'est pas tant que
 * Google n'a pas répondu. Voir `docs/google.md`.
 */

import { env } from '../env.js';

/**
 * Portée demandée.
 *
 * `business.manage` est la seule portée publiée pour les API Business Profile,
 * et elle couvre lecture et réponse. Il n'existe pas de portée en lecture
 * seule : c'est une limite de Google, à annoncer au client au moment du
 * consentement plutôt qu'à découvrir après.
 */
export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/business.manage';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const ACCOUNTS_API = 'https://mybusinessaccountmanagement.googleapis.com/v1';
const INFO_API = 'https://mybusinessbusinessinformation.googleapis.com/v1';

export interface GoogleTokens {
  accessToken: string;
  /** Absent si Google ne le renvoie pas — cas d'un consentement déjà accordé. */
  refreshToken?: string;
  expiresAt: string;
  scope: string;
}

export interface GoogleLocation {
  /** Nom de ressource complet : `locations/123…`. */
  name: string;
  title: string;
  address?: string;
  /** Identifiant de la fiche côté Maps, quand Google le fournit. */
  placeId?: string;
}

export class GoogleOAuthError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = 'GoogleOAuthError';
  }
}

/** URL de retour effective : celle déclarée, ou déduite de l'API publique. */
export function redirectUri(): string {
  return env.google.redirectUri || `${env.apiUrl}/integrations/google/callback`;
}

/** Le consentement est-il configurable ? (identifiants d'application présents) */
export function oauthConfigured(): boolean {
  return Boolean(env.google.clientId && env.google.clientSecret);
}

/**
 * URL de consentement.
 *
 * `access_type=offline` et `prompt=consent` sont indispensables : sans eux,
 * Google ne renvoie un jeton de rafraîchissement qu'au tout premier
 * consentement. Un client qui reconnecte sa fiche après l'avoir retirée
 * repartirait alors sans jeton, et la synchronisation s'arrêterait au bout
 * d'une heure sans rien signaler.
 */
export function authorizationUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.google.clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: GOOGLE_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

/** Échange le code de retour contre un couple de jetons. */
export async function exchangeCode(code: string): Promise<GoogleTokens> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.google.clientId,
      client_secret: env.google.clientSecret,
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    }),
  });

  const body = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !body.access_token) {
    throw new GoogleOAuthError(
      `Google a refusé l'échange du code (${response.status}) : ${body.error_description ?? body.error ?? 'raison non précisée'}`,
      response.status === 400 ? 400 : 502,
    );
  }

  return {
    accessToken: body.access_token,
    ...(body.refresh_token ? { refreshToken: body.refresh_token } : {}),
    expiresAt: new Date(Date.now() + (body.expires_in ?? 3600) * 1000).toISOString(),
    scope: body.scope ?? GOOGLE_SCOPE,
  };
}

/** Renouvelle un jeton d'accès à partir du jeton de rafraîchissement. */
export async function refreshAccessToken(refreshToken: string): Promise<GoogleTokens> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.google.clientId,
      client_secret: env.google.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const body = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
  };

  if (!response.ok || !body.access_token) {
    // `invalid_grant` : le client a retiré l'accès, ou le jeton a expiré faute
    // d'usage. Il faut redemander le consentement, pas réessayer — d'où le 401,
    // que l'appelant traduit en « connexion à refaire » plutôt qu'en incident.
    throw new GoogleOAuthError(
      body.error === 'invalid_grant'
        ? "L'autorisation Google a été retirée ou a expiré : elle doit être redonnée."
        : `Renouvellement du jeton Google refusé (${response.status}).`,
      body.error === 'invalid_grant' ? 401 : 502,
    );
  }

  return {
    accessToken: body.access_token,
    expiresAt: new Date(Date.now() + (body.expires_in ?? 3600) * 1000).toISOString(),
    scope: body.scope ?? GOOGLE_SCOPE,
  };
}

/**
 * Révoque l'autorisation côté Google.
 *
 * Appelée à la déconnexion. Supprimer la ligne en base sans révoquer
 * laisserait une autorisation active dans le compte du client, invisible pour
 * lui dans notre interface : ce serait lui mentir sur ce qu'il a coupé.
 */
export async function revokeToken(token: string): Promise<void> {
  await fetch(REVOKE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
  }).catch(() => undefined);
}

/**
 * Fiches accessibles avec ce jeton.
 *
 * Deux API distinctes : les comptes d'un côté, les établissements de l'autre.
 * On parcourt les comptes parce qu'un même utilisateur peut gérer sa fiche en
 * direct et d'autres via un groupe d'établissements.
 */
export async function listLocations(accessToken: string): Promise<GoogleLocation[]> {
  const headers = { authorization: `Bearer ${accessToken}` };

  const accountsResponse = await fetch(`${ACCOUNTS_API}/accounts?pageSize=20`, { headers });
  if (!accountsResponse.ok) {
    throw new GoogleOAuthError(await describeApiError(accountsResponse));
  }
  const accounts = ((await accountsResponse.json()) as { accounts?: Array<{ name: string }> })
    .accounts ?? [];

  const found: GoogleLocation[] = [];
  for (const account of accounts) {
    const params = new URLSearchParams({
      pageSize: '100',
      readMask: 'name,title,storefrontAddress,metadata',
    });
    const response = await fetch(`${INFO_API}/${account.name}/locations?${params}`, { headers });
    if (!response.ok) continue; // un compte sans fiche lisible n'est pas une erreur

    const body = (await response.json()) as {
      locations?: Array<{
        name: string;
        title?: string;
        storefrontAddress?: { addressLines?: string[]; locality?: string; postalCode?: string };
        metadata?: { placeId?: string };
      }>;
    };

    for (const location of body.locations ?? []) {
      const address = [
        ...(location.storefrontAddress?.addressLines ?? []),
        location.storefrontAddress?.postalCode,
        location.storefrontAddress?.locality,
      ]
        .filter(Boolean)
        .join(' ');

      found.push({
        name: location.name,
        title: location.title ?? location.name,
        ...(address ? { address } : {}),
        ...(location.metadata?.placeId ? { placeId: location.metadata.placeId } : {}),
      });
    }
  }

  return found;
}

/**
 * Traduit une erreur d'API en message exploitable.
 *
 * Le cas du quota à zéro mérite son propre message : c'est l'erreur que tout
 * le monde rencontre en premier, et le message brut de Google ne dit pas que
 * la cause est une demande d'accès non encore approuvée.
 */
async function describeApiError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as {
    error?: { message?: string; status?: string };
  };
  const message = body.error?.message ?? `HTTP ${response.status}`;

  if (response.status === 429 || /quota/i.test(message)) {
    return (
      "Quota Google épuisé ou nul. Un projet dont la demande d'accès n'a pas " +
      'encore été approuvée a un quota de 0 requête/minute : tous les appels ' +
      `échouent ainsi. Détail Google : ${message}`
    );
  }
  if (response.status === 403) {
    return `Accès refusé par Google — API non activée sur le projet, ou demande d'accès non approuvée. Détail : ${message}`;
  }
  return `Google a répondu ${response.status} : ${message}`;
}
