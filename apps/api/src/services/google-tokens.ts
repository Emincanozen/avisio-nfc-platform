/**
 * Fournisseur de jetons d'accès Google, par établissement.
 *
 * Il sait trois choses, et rien d'autre : ouvrir le jeton de rafraîchissement
 * scellé d'un établissement, le troquer contre un jeton d'accès, et garder ce
 * dernier en mémoire jusqu'à son expiration.
 *
 * Le cache n'est pas une optimisation accessoire. Un jeton d'accès vaut une
 * heure ; sans cache, chaque cycle d'ingestion consommerait un appel de
 * renouvellement par établissement et par plateforme, pour rien — et Google
 * limite aussi ces appels-là.
 */

import type { Repository } from '../repository/index.js';
import { GoogleOAuthError, refreshAccessToken } from './google-oauth.js';
import { open } from './secrets.js';

interface CachedToken {
  value: string;
  expiresAtMs: number;
}

export interface GoogleTokenService {
  /** Jeton d'accès valide, ou `null` si l'établissement n'a pas autorisé Avisio. */
  accessTokenFor(establishmentId: string): Promise<string | null>;
  /** Oublie le jeton en cache — après une déconnexion ou une reconnexion. */
  forget(establishmentId: string): void;
}

export function createGoogleTokenService(
  repo: Repository,
  logger: { warn: (msg: string) => void },
): GoogleTokenService {
  const cache = new Map<string, CachedToken>();

  return {
    async accessTokenFor(establishmentId) {
      const cached = cache.get(establishmentId);
      // Marge de trente secondes : un jeton qui expire pendant le vol d'une
      // requête produirait un 401 que rien ne distingue d'une révocation.
      if (cached && cached.expiresAtMs > Date.now() + 30_000) return cached.value;

      const connection = await repo.googleConnections.get(establishmentId);
      if (!connection) return null;

      const refreshToken = open(connection.refreshTokenSealed);
      if (!refreshToken) {
        // La clé de scellement a changé : le jeton est définitivement illisible.
        // Le dire explicitement évite de chercher la panne du côté de Google.
        logger.warn(
          `Jeton Google illisible pour ${establishmentId} : la clé de scellement a changé, l'autorisation doit être redonnée.`,
        );
        await repo.googleConnections
          .update(establishmentId, {
            lastError: "Jeton illisible (clé de scellement changée) : autorisation à redonner.",
          })
          .catch(() => undefined);
        return null;
      }

      try {
        const tokens = await refreshAccessToken(refreshToken);
        cache.set(establishmentId, {
          value: tokens.accessToken,
          expiresAtMs: new Date(tokens.expiresAt).getTime(),
        });
        return tokens.accessToken;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Un refus définitif (accès retiré côté client) est enregistré sur la
        // connexion : l'interface doit pouvoir lui dire de la refaire, plutôt
        // que de laisser la synchronisation s'éteindre sans bruit.
        if (error instanceof GoogleOAuthError && error.status === 401) {
          await repo.googleConnections
            .update(establishmentId, { lastError: message })
            .catch(() => undefined);
        }
        logger.warn(`Jeton Google indisponible pour ${establishmentId} : ${message}`);
        return null;
      }
    },

    forget(establishmentId) {
      cache.delete(establishmentId);
    },
  };
}
