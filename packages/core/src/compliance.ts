/**
 * Garde-fous de conformité.
 *
 * Contexte réglementaire (France / UE) :
 *  - Directive (UE) 2019/2161 « Omnibus », transposée aux articles L.111-7-2 et
 *    L.121-4 21° du code de la consommation : afficher des avis en laissant
 *    croire qu'ils sont tous publiés alors qu'un tri a eu lieu est une pratique
 *    commerciale trompeuse.
 *  - Norme AFNOR NF Z74-501 / ISO 20488 : pas de sélection des avis selon leur
 *    contenu, pas de contrepartie conditionnée au sens de l'avis.
 *  - Règles Google sur les faux engagements : interdiction du « review gating »
 *    (ne solliciter publiquement que les clients satisfaits) et de toute
 *    incitation conditionnée à une note positive.
 *
 * Conséquence produit : le parcours NFC ne comporte AUCUNE étape de tri par
 * note avant redirection. Le module ci-dessous existe pour rendre cette règle
 * exécutable — toute configuration qui reviendrait à filtrer est rejetée par
 * l'API, et les tests échouent si quelqu'un tente de la réintroduire.
 */

export type ComplianceViolation =
  | 'rating_gate_before_redirect'
  | 'reward_conditioned_on_rating'
  | 'review_hidden_from_public'
  | 'reply_impersonates_customer';

export interface ComplianceIssue {
  code: ComplianceViolation;
  message: string;
}

export interface LandingConfig {
  /** Étape demandant la note AVANT d'envoyer vers la plateforme : interdit. */
  askRatingBeforeRedirect?: boolean;
  /** Redirection différenciée selon une note pré-saisie : interdit. */
  routeByPrefilledRating?: boolean;
  /** Redirection vers un formulaire privé pour les clients mécontents. */
  privateFeedbackInsteadOfPublic?: boolean;
}

export interface LoyaltyRuleConfig {
  /** Points accordés pour le fait de déposer un avis, quelle que soit la note. */
  pointsPerReview: number;
  /** Note minimale exigée pour obtenir la récompense : interdit. */
  minimumRatingForReward?: number | null;
  /** Bonus de points indexé sur la note : interdit. */
  bonusPointsByRating?: Record<string, number> | null;
}

const ISSUES: Record<ComplianceViolation, string> = {
  rating_gate_before_redirect:
    "Le parcours ne peut pas demander la note avant la redirection : c'est du review gating, interdit par Google et par la directive Omnibus.",
  reward_conditioned_on_rating:
    "Une récompense ne peut pas dépendre de la note laissée. Le geste doit être accordé pour le dépôt d'un avis, quel qu'en soit le sens.",
  review_hidden_from_public:
    "Aucun avis publié ne peut être masqué ou retardé par le produit : l'avis part directement sur la plateforme, Avisio le lit ensuite.",
  reply_impersonates_customer:
    "Une réponse générée doit être publiée au nom de l'établissement, jamais au nom d'un client.",
};

/** Vérifie la configuration d'une landing page NFC. */
export function checkLandingConfig(config: LandingConfig): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];
  if (config.askRatingBeforeRedirect) issues.push(issue('rating_gate_before_redirect'));
  if (config.routeByPrefilledRating) issues.push(issue('rating_gate_before_redirect'));
  if (config.privateFeedbackInsteadOfPublic) {
    issues.push(issue('rating_gate_before_redirect'));
  }
  return dedupeIssues(issues);
}

/** Vérifie les règles d'un programme de fidélité. */
export function checkLoyaltyRule(rule: LoyaltyRuleConfig): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];
  if (rule.minimumRatingForReward != null) {
    issues.push(issue('reward_conditioned_on_rating'));
  }
  if (rule.bonusPointsByRating && Object.keys(rule.bonusPointsByRating).length > 0) {
    issues.push(issue('reward_conditioned_on_rating'));
  }
  return dedupeIssues(issues);
}

export function assertCompliant(issues: ComplianceIssue[]): void {
  if (issues.length === 0) return;
  const err = new Error(issues.map((i) => i.message).join(' | '));
  err.name = 'ComplianceError';
  throw err;
}

/**
 * Mention légale affichée sur la landing page NFC.
 * Elle est obligatoire dès lors qu'une contrepartie (points fidélité) existe :
 * l'article L.111-7-2 impose d'indiquer si l'avis fait l'objet d'une contrepartie.
 */
export function landingDisclosure(hasLoyaltyReward: boolean): string {
  return hasLoyaltyReward
    ? "Votre avis est publié directement sur la plateforme, sans relecture de notre part. Les points fidélité sont accordés pour le dépôt d'un avis, quelle que soit la note donnée."
    : 'Votre avis est publié directement sur la plateforme, sans relecture ni filtrage de notre part.';
}

const issue = (code: ComplianceViolation): ComplianceIssue => ({
  code,
  message: ISSUES[code],
});

const dedupeIssues = (issues: ComplianceIssue[]): ComplianceIssue[] => {
  const seen = new Set<ComplianceViolation>();
  return issues.filter((i) => (seen.has(i.code) ? false : (seen.add(i.code), true)));
};
