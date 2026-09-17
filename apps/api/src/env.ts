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

  google: {
    clientId: str('GOOGLE_CLIENT_ID'),
    clientSecret: str('GOOGLE_CLIENT_SECRET'),
    refreshToken: str('GOOGLE_REFRESH_TOKEN'),
  },

  resendApiKey: str('RESEND_API_KEY'),
  mailFrom: str('MAIL_FROM', 'alertes@avisio.fr'),

  ingestIntervalMinutes: num('INGEST_INTERVAL_MINUTES', 20),
} as const;

export const capabilities = {
  /** false => adaptateur mémoire avec jeu de démonstration. */
  persistence: env.databaseUrl.length > 0,
  /** false => analyse et réponses produites par le moteur heuristique local. */
  llm: env.anthropicApiKey.length > 0,
  /** false => connecteur Google simulé (avis générés, cadence réelle). */
  googleReviews: Boolean(env.google.clientId && env.google.refreshToken),
  /** false => emails journalisés en console. */
  email: env.resendApiKey.length > 0,
} as const;

export function describeMode(): string {
  const mode = (label: string, on: boolean, off: string): string =>
    `${label}: ${on ? 'connecté' : off}`;
  return [
    mode('persistance', capabilities.persistence, 'mémoire (démo)'),
    mode('LLM', capabilities.llm, 'heuristique locale'),
    mode('Google', capabilities.googleReviews, 'simulé'),
    mode('email', capabilities.email, 'console'),
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
