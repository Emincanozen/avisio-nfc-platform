/**
 * Politique de limitation de débit.
 *
 * Le calcul est ici, pur et testable ; le comptage est ailleurs, derrière le
 * port dépôt — en mémoire sur une instance unique, en base dès qu'il y en a
 * plusieurs. Cette séparation est la raison d'être du fichier : une politique
 * qu'on peut lire et vérifier sans monter un serveur.
 *
 * Le découpage en fenêtres fixes est assumé. Il autorise, au pire, deux fois
 * le quota à cheval sur deux fenêtres. C'est sans conséquence ici : les
 * budgets visent l'abus industriel (des milliers de requêtes), pas le
 * lissage à la requête près.
 */

/** Budget d'un périmètre : `limit` requêtes par `windowSeconds`. */
export interface RateRule {
  limit: number;
  windowSeconds: number;
}

/**
 * Périmètres de limitation.
 *
 * Un périmètre par nature de coût, pas un par route : ce qu'on protège, c'est
 * une ressource (un mot de passe à deviner, un quota d'API tierce, une
 * dépense de modèle de langage), pas un chemin d'URL.
 */
export type RateScope =
  /**
   * Tentatives de connexion vues depuis une adresse IP.
   *
   * Budget volontairement large : un siège de chaîne, un hôtel, un espace de
   * coworking sortent tous par une seule adresse publique. Serrer ici
   * enfermerait dehors des clients légitimes sans gêner un attaquant, qui
   * dispose de bien plus d'une adresse.
   */
  | 'login_ip'
  /**
   * Tentatives de connexion sur un compte donné.
   *
   * C'est là que se joue la protection réelle : deviner un mot de passe exige
   * d'essayer beaucoup de fois sur le même compte, et aucune rotation
   * d'adresse ne contourne ce compteur-là.
   */
  | 'login'
  /** Dépôt de scan NFC : on protège l'intégrité des compteurs. */
  | 'scan'
  /** Fidélité : on protège les contacts contre l'énumération. */
  | 'loyalty'
  /** Lecture publique (landing, widget, catalogue) : on protège la bande passante. */
  | 'public_read'
  /** Webhook de caisse : budget large, la caisse est légitime et bavarde. */
  | 'pos'
  /** Routes qui déclenchent un appel de modèle de langage : on protège la dépense. */
  | 'llm'
  /** Traitements de fond déclenchés à la main : on protège contre le double clic. */
  | 'ops'
  /** Tout le reste de l'espace gérant. */
  | 'authenticated';

/**
 * Budgets retenus.
 *
 * Ils sont dimensionnés sur l'usage réel observable dans le produit : une
 * plaquette posée au comptoir d'un restaurant plein produit une dizaine de
 * scans à l'heure, pas six cents. Un gérant qui consulte son tableau de bord
 * déclenche une quinzaine d'appels par minute au plus fort.
 */
export const RATE_RULES: Record<RateScope, RateRule> = {
  // Dix essais par quart d'heure sur un compte : un humain qui hésite sur son
  // mot de passe en fait trois ou quatre, un script en fait des milliers.
  login: { limit: 10, windowSeconds: 900 },

  // Cent essais par quart d'heure depuis une adresse : de quoi laisser
  // travailler une équipe entière derrière un seul routeur, tout en coupant
  // le balayage de comptes depuis une machine unique.
  login_ip: { limit: 100, windowSeconds: 900 },

  // Soixante scans par heure et par IP. Au-delà, ce n'est plus une salle de
  // restaurant : c'est quelqu'un qui gonfle les compteurs.
  scan: { limit: 60, windowSeconds: 3600 },

  // La fidélité manipule des contacts : budget serré, c'est la route par
  // laquelle on énumérerait des adresses.
  loyalty: { limit: 20, windowSeconds: 3600 },

  public_read: { limit: 300, windowSeconds: 60 },

  // Une caisse d'un établissement à fort débit ferme un ticket toutes les
  // quelques secondes en coup de feu.
  pos: { limit: 600, windowSeconds: 60 },

  // Chaque appel coûte un appel de modèle. Trente par heure et par compte
  // couvre largement une journée de réponses aux avis.
  llm: { limit: 30, windowSeconds: 3600 },

  ops: { limit: 10, windowSeconds: 3600 },

  authenticated: { limit: 600, windowSeconds: 60 },
};

export interface RateVerdict {
  allowed: boolean;
  /** Requêtes encore disponibles dans la fenêtre courante. */
  remaining: number;
  /** Secondes avant la réouverture. Toujours ≥ 1 pour un refus. */
  retryAfterSeconds: number;
  /** Fin de la fenêtre courante, en millisecondes epoch. */
  resetAtMs: number;
}

/** Début de la fenêtre contenant `nowMs`, en millisecondes epoch. */
export function windowStartMs(nowMs: number, windowSeconds: number): number {
  const size = windowSeconds * 1000;
  return Math.floor(nowMs / size) * size;
}

/**
 * Verdict pour une requête déjà comptée.
 *
 * `count` est le rang de la requête courante dans sa fenêtre : la première
 * vaut 1. Une requête est donc refusée dès que son rang dépasse le budget.
 */
export function rateVerdict(count: number, rule: RateRule, nowMs: number): RateVerdict {
  const resetAtMs = windowStartMs(nowMs, rule.windowSeconds) + rule.windowSeconds * 1000;
  const allowed = count <= rule.limit;
  return {
    allowed,
    remaining: Math.max(0, rule.limit - count),
    retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((resetAtMs - nowMs) / 1000)),
    resetAtMs,
  };
}

/**
 * Clé de comptage.
 *
 * Le périmètre fait partie de la clé : saturer le budget de connexion ne doit
 * pas fermer la porte aux scans depuis la même IP — un restaurant et ses
 * clients partagent souvent une seule adresse publique.
 */
export function rateKey(scope: RateScope, identity: string, windowStart: number): string {
  return `${scope}:${identity}:${windowStart}`;
}
