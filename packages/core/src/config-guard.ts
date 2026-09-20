/**
 * Contrôle de configuration au démarrage.
 *
 * Le produit a été conçu pour démarrer sans aucune variable renseignée : chaque
 * dépendance absente bascule sur un repli annoncé. C'est ce qui permet de le
 * démontrer sur un portable sans réseau, et c'est une bonne propriété.
 *
 * En production, c'est exactement la mauvaise. Un serveur qui démarre sans
 * `DATABASE_URL` sert des données en mémoire — perdues au premier redémarrage,
 * avec le jeu de démonstration et ses identifiants publiés dans ce dépôt. Un
 * serveur qui démarre sur le `JWT_SECRET` de développement accepte n'importe
 * quel jeton forgé par quiconque a lu `.env.example`. Aucun des deux ne signale
 * quoi que ce soit : ils fonctionnent, et c'est le problème.
 *
 * Ce module refuse le démarrage plutôt que de laisser un déploiement silencieux
 * s'installer. La logique est pure et testable ; le refus est prononcé par
 * `server.ts`.
 */

/** Secret de développement publié dans `.env.example`. Jamais en production. */
export const DEMO_JWT_SECRET = 'dev-secret-change-me-in-production-0123456789';

/** Longueur minimale d'un secret de signature digne de ce nom. */
export const MIN_SECRET_LENGTH = 32;

/**
 * Identité d'émetteur par défaut, portée par `.env.example`.
 *
 * Ce ne sont pas des réglages de confort : une facture sans SIRET ni numéro
 * de TVA valides n'est pas une facture. Le client peut refuser de la régler,
 * ne peut pas déduire la TVA, et l'émetteur s'expose à une amende par
 * mention manquante (art. L.441-9 du code de commerce).
 */
export const PLACEHOLDER_COMPANY = {
  siret: '000 000 000 00000',
  vatNumber: 'FR00000000000',
} as const;

export interface RuntimeConfig {
  nodeEnv: string;
  databaseUrl: string;
  jwtSecret: string;
  secretsKey: string;
  webUrl: string;
  apiUrl: string;
  demoMode: boolean;
  /** Identité de l'émetteur, portée par chaque facture. */
  company: { name: string; address: string; siret: string; vatNumber: string };
  /** Fournisseurs configurés, pour vérifier la cohérence des options activées. */
  providers: {
    anthropic: boolean;
    googleOAuth: boolean;
    email: boolean;
    push: boolean;
  };
}

export interface ConfigProblem {
  /** Variable ou réglage en cause, tel qu'on le nomme dans `.env`. */
  setting: string;
  /** Ce qui ne va pas, et pourquoi c'est bloquant. */
  reason: string;
}

/**
 * Problèmes qui interdisent un démarrage en production.
 *
 * Renvoie une liste vide hors production : le mode dégradé y est légitime, et
 * le but n'est pas de rendre le développement pénible.
 */
export function productionConfigProblems(config: RuntimeConfig): ConfigProblem[] {
  if (config.nodeEnv !== 'production') return [];

  const problems: ConfigProblem[] = [];

  if (!config.databaseUrl) {
    problems.push({
      setting: 'DATABASE_URL',
      reason:
        "Absente : l'API démarrerait sur l'adaptateur mémoire, avec le jeu de " +
        'démonstration et ses identifiants publics, et perdrait tout au premier ' +
        'redémarrage.',
    });
  }

  if (!config.jwtSecret || config.jwtSecret === DEMO_JWT_SECRET) {
    problems.push({
      setting: 'JWT_SECRET',
      reason:
        'Absent ou égal au secret de développement publié dans `.env.example`. ' +
        'Quiconque a lu ce dépôt pourrait forger un jeton de session valide, ' +
        'y compris avec le rôle administrateur.',
    });
  } else if (config.jwtSecret.length < MIN_SECRET_LENGTH) {
    problems.push({
      setting: 'JWT_SECRET',
      reason: `Trop court (${config.jwtSecret.length} caractères, ${MIN_SECRET_LENGTH} minimum).`,
    });
  }

  if (config.secretsKey && config.secretsKey === config.jwtSecret) {
    problems.push({
      setting: 'SECRETS_KEY',
      reason:
        'Identique à JWT_SECRET. Faire tourner le secret des sessions est une ' +
        'opération banale ; confondus, elle rendrait illisibles tous les jetons ' +
        'Google des clients, qui devraient chacun réautoriser leur fiche.',
    });
  }

  for (const [setting, url] of [
    ['PUBLIC_WEB_URL', config.webUrl],
    ['PUBLIC_API_URL', config.apiUrl],
  ] as const) {
    if (!url) {
      problems.push({ setting, reason: 'Absente : les liens des plaquettes et le retour OAuth seraient faux.' });
      continue;
    }
    if (!url.startsWith('https://')) {
      problems.push({
        setting,
        reason:
          `« ${url} » n'est pas en HTTPS. Le push web l'exige — sans lui, aucune ` +
          'alerte ne parvient au téléphone du gérant — et les jetons de session ' +
          'transiteraient en clair.',
      });
    }
  }

  // Identité de l'émetteur. Le produit facture dès le premier client : une
  // API de production qui démarre avec le SIRET d'exemple émet des factures
  // légalement invalides, et rien ne le signale — la facture sort, le PDF
  // est propre, le client la reçoit. On ne s'en aperçoit qu'au moment où il
  // la refuse, ou au contrôle.
  if (!config.company.siret || config.company.siret === PLACEHOLDER_COMPANY.siret) {
    problems.push({
      setting: 'COMPANY_SIRET',
      reason:
        "Absent ou laissé à l'exemple. Les factures émises porteraient un SIRET " +
        'fictif : le client peut refuser de les régler, et une mention ' +
        'obligatoire manquante est sanctionnée (art. L.441-9 c. com.).',
    });
  }

  if (!config.company.vatNumber || config.company.vatNumber === PLACEHOLDER_COMPANY.vatNumber) {
    problems.push({
      setting: 'COMPANY_VAT',
      reason:
        "Absent ou laissé à l'exemple. Sans numéro de TVA valide, le client ne " +
        'peut pas déduire la TVA qu’on lui facture.',
    });
  }

  for (const [setting, valeur] of [
    ['COMPANY_NAME', config.company.name],
    ['COMPANY_ADDRESS', config.company.address],
  ] as const) {
    if (!valeur.trim()) {
      problems.push({
        setting,
        reason: "Absent : c'est une mention obligatoire de toute facture française.",
      });
    }
  }

  if (config.demoMode) {
    problems.push({
      setting: 'AVISIO_DEMO_MODE',
      reason:
        'Activé en production. Il autorise les connecteurs simulés, qui ' +
        'écriraient de faux avis dans la base réelle et fausseraient les ' +
        "métriques vendues au client.",
    });
  }

  return problems;
}

/**
 * Avertissements : le démarrage est possible, mais quelque chose est annoncé
 * au client et ne fonctionnera pas.
 *
 * Distincts des problèmes bloquants parce qu'ils relèvent du choix commercial :
 * exploiter sans e-mail transactionnel est une décision, pas une faute.
 */
export function productionConfigWarnings(config: RuntimeConfig): ConfigProblem[] {
  if (config.nodeEnv !== 'production') return [];

  const warnings: ConfigProblem[] = [];

  if (!config.providers.email) {
    warnings.push({
      setting: 'RESEND_API_KEY',
      reason:
        "Absente : les alertes e-mail sont journalisées en console au lieu d'être " +
        'envoyées. Le gérant ne recevra rien.',
    });
  }

  if (!config.providers.push) {
    warnings.push({
      setting: 'VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY',
      reason:
        'Absentes : aucune notification push ne part. La promesse « alerte ' +
        'immédiate » ne tient plus que par e-mail.',
    });
  }

  if (!config.providers.googleOAuth) {
    warnings.push({
      setting: 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET',
      reason:
        "Absentes : aucun client ne peut connecter sa fiche. Les avis n'entrent " +
        "que par l'import manuel.",
    });
  }

  if (!config.providers.anthropic) {
    warnings.push({
      setting: 'ANTHROPIC_API_KEY',
      reason:
        "Absente : l'analyse et les suggestions de réponse tournent sur le moteur " +
        'heuristique local, nettement moins fin.',
    });
  }

  return warnings;
}

/** Message d'arrêt, prêt à être affiché. */
export function formatConfigRefusal(problems: ConfigProblem[]): string {
  const lignes = problems.map((p) => `  · ${p.setting}\n    ${p.reason}`);
  return [
    '',
    'DÉMARRAGE REFUSÉ — configuration de production incomplète',
    '='.repeat(62),
    '',
    ...lignes,
    '',
    'Chacun de ces points laisserait tourner un service qui a l’air de',
    'fonctionner. C’est pour cela que le démarrage est refusé plutôt que',
    'signalé dans un journal que personne ne lira.',
    '',
    'Voir docs/deploiement.md §2.',
    '',
  ].join('\n');
}
