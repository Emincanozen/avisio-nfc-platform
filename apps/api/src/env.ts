/**
 * Configuration d'exécution.
 *
 * Principe : l'API doit démarrer sans aucune variable renseignée. Chaque
 * dépendance externe absente bascule sur un mode dégradé explicite
 * (mémoire / heuristique / simulation / console), jamais sur un crash.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

loadDotEnv();

const str = (key: string, fallback = ''): string => process.env[key]?.trim() || fallback;
const num = (key: string, fallback: number): number => {
  const parsed = Number.parseInt(process.env[key] ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const env = {
  nodeEnv: str('NODE_ENV', 'development'),
  port: num('API_PORT', 4000),
  webUrl: str('PUBLIC_WEB_URL', 'http://localhost:3000'),
  apiUrl: str('PUBLIC_API_URL', 'http://localhost:4000'),

  databaseUrl: str('DATABASE_URL'),
  jwtSecret: str('JWT_SECRET', 'dev-secret-change-me-in-production-0123456789'),

  anthropicApiKey: str('ANTHROPIC_API_KEY'),
  anthropicModel: str('ANTHROPIC_MODEL', 'claude-opus-5'),

  /**
   * Clé de scellement des secrets stockés en base (jetons OAuth des clients).
   * Vide => dérivée de `JWT_SECRET`. À séparer en production : faire tourner
   * le secret des sessions ne doit pas rendre illisibles les jetons Google.
   */
  secretsKey: str('SECRETS_KEY'),

  google: {
    clientId: str('GOOGLE_CLIENT_ID'),
    clientSecret: str('GOOGLE_CLIENT_SECRET'),
    /**
     * Jeton de rafraîchissement global — hérité, et conservé uniquement comme
     * solution de repli pour un déploiement mono-établissement.
     *
     * Le chemin normal est le consentement par établissement : le propriétaire
     * de la fiche autorise Avisio sur SA fiche, et c'est son jeton qui est
     * utilisé pour elle. Un jeton unique pour tout le parc ne peut pas exister
     * chez Google — personne ne peut consentir à la place d'un autre.
     */
    refreshToken: str('GOOGLE_REFRESH_TOKEN'),
    /** URL de retour déclarée dans la console Google Cloud. */
    redirectUri: str('GOOGLE_REDIRECT_URI'),
  },

  resendApiKey: str('RESEND_API_KEY'),
  mailFrom: str('MAIL_FROM', 'alertes@avisio.fr'),

  /** Clés Web Push. `npx web-push generate-vapid-keys` pour en produire. */
  vapid: {
    publicKey: str('VAPID_PUBLIC_KEY'),
    privateKey: str('VAPID_PRIVATE_KEY'),
  },

  /** Coordonnées de l'émetteur, portées par les factures (mentions légales). */
  company: {
    name: str('COMPANY_NAME', 'Avisio SAS'),
    address: str('COMPANY_ADDRESS', '12 rue des Minimes, 31200 Toulouse'),
    siret: str('COMPANY_SIRET', '000 000 000 00000'),
    vatNumber: str('COMPANY_VAT', 'FR00000000000'),
    iban: str('COMPANY_IBAN', ''),
  },

  /**
   * Plafond d'appels au modele de langage, par heure et par processus.
   *
   * Tres au-dessus de l'usage attendu : il ne sert que dans le cas qu'il vise,
   * quelque chose qui s'emballe (une boucle, un import massif). Le depassement
   * bascule sur le moteur heuristique, il ne fait echouer personne.
   */
  llmMaxCallsPerHour: num('LLM_MAX_CALLS_PER_HOUR', 500),
  /** Delai de garde d'un appel au modele. Au-dela, repli local. */
  llmTimeoutMs: num('LLM_TIMEOUT_MS', 30000),

  ingestIntervalMinutes: num('INGEST_INTERVAL_MINUTES', 20),
  billingIntervalHours: num('BILLING_INTERVAL_HOURS', 6),

  /**
   * Confiance accordée à `X-Forwarded-For`.
   *
   * Par défaut : aucune. C'est le seul réglage sûr, parce qu'un en-tête est
   * trivial à falsifier — et l'IP qu'il porte est précisément ce sur quoi
   * repose la limitation de débit. Faire confiance sans proxy devant revient
   * à laisser n'importe qui se donner une IP neuve à chaque requête et
   * contourner tous les budgets.
   *
   * En production derrière un proxy, renseigner le NOMBRE de sauts de
   * confiance (`TRUST_PROXY=1` pour un seul reverse proxy), ou la liste des
   * adresses/CIDR de confiance. Le nombre de sauts est préférable : il ne se
   * périme pas quand l'hébergeur change ses plages d'adresses.
   */
  trustProxy: parseTrustProxy(str('TRUST_PROXY')),

  /**
   * Mode démonstration.
   *
   * Il autorise les connecteurs simulés, qui **fabriquent des avis**. Sans
   * lui, un établissement dont la plateforme n'est pas connectée reste
   * simplement muet — ce qui est la vérité — au lieu de voir arriver de faux
   * avis, de fausses alertes et des statistiques inventées.
   *
   * C'est le seul réglage capable de contaminer une vraie base : le contrôle
   * de configuration refuse le démarrage s'il est actif en production.
   */
  demoMode: str('AVISIO_DEMO_MODE').toLowerCase() === 'true',
} as const;

function parseTrustProxy(raw: string): boolean | number | string[] {
  if (!raw) return false;
  const hops = Number.parseInt(raw, 10);
  if (Number.isFinite(hops) && String(hops) === raw) return hops;
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

export const capabilities = {
  /** false => adaptateur mémoire avec jeu de démonstration. */
  persistence: env.databaseUrl.length > 0,
  /** false => analyse et réponses produites par le moteur heuristique local. */
  llm: env.anthropicApiKey.length > 0,
  /**
   * L'application OAuth Google est-elle configurée ?
   *
   * C'est la condition du parcours de consentement par établissement : sans
   * identifiants d'application, aucun client ne peut autoriser sa fiche.
   * L'accès API approuvé par Google, lui, ne se lit pas dans la configuration
   * — il se constate au premier appel, un projet non approuvé ayant un quota
   * de 0 requête/minute.
   */
  googleOAuth: Boolean(env.google.clientId && env.google.clientSecret),
  /** Repli mono-établissement hérité : jeton de rafraîchissement global. */
  googleReviews: Boolean(env.google.clientId && env.google.refreshToken),
  /** false => emails journalisés en console. */
  email: env.resendApiKey.length > 0,
  /** false => push journalisés en console. */
  push: env.vapid.publicKey.length > 0 && env.vapid.privateKey.length > 0,
  /**
   * Connecteurs simulés autorisés.
   *
   * La double condition n'est pas redondante : le contrôle de configuration
   * refuse déjà le démarrage en production avec `AVISIO_DEMO_MODE`, mais une
   * instance lancée autrement — un script, un test, un binaire exécuté à la
   * main — contournerait ce contrôle. Ici, la simulation est impossible en
   * production quel que soit le chemin emprunté.
   */
  demoMode: env.demoMode && env.nodeEnv !== 'production',
} as const;

export function describeMode(): string {
  const mode = (label: string, on: boolean, off: string): string =>
    `${label}: ${on ? 'connecté' : off}`;
  return [
    mode('persistance', capabilities.persistence, 'mémoire (démo)'),
    mode('LLM', capabilities.llm, 'heuristique locale'),
    // « non connecté » et non « simulé » : hors mode démonstration, aucune
    // donnée n'est fabriquée. Annoncer une simulation qui n'a pas lieu ferait
    // chercher de faux avis là où il n'y a rien du tout.
    mode('Google', capabilities.googleOAuth, 'non connecté'),
    mode('email', capabilities.email, 'console'),
    mode('push', capabilities.push, 'console'),
    // Annoncé au démarrage, en majuscules : lire « MODE DÉMONSTRATION » dans
    // le journal d'un serveur censé servir de vrais clients doit sauter aux yeux.
    capabilities.demoMode ? 'MODE DÉMONSTRATION (avis fabriqués)' : 'données réelles',
  ].join(' · ');
}

/**
 * Chargement minimal du .env racine : évite une dépendance supplémentaire et
 * garde un comportement lisible (les variables déjà définies gagnent).
 */
function loadDotEnv(): void {
  for (const candidate of ['.env', '../../.env', '../../../.env']) {
    try {
      const content = readFileSync(resolve(process.cwd(), candidate), 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
        if (!(key in process.env)) process.env[key] = value;
      }
      return;
    } catch {
      // fichier absent : on essaie le candidat suivant
    }
  }
}
