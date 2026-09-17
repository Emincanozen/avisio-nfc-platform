/**
 * Analyse sémantique des avis et rédaction assistée des réponses.
 *
 * Deux moteurs interchangeables :
 *  - `llm` : appel à l'API Claude, piloté par les prompts construits ici ;
 *  - `heuristic` : lexique français local, sans appel réseau. Il sert de
 *    repli quand la clé API est absente, quand le quota est atteint ou quand
 *    l'appel échoue — le produit ne doit jamais s'arrêter pour ça.
 *
 * Le parsing de la sortie du modèle est volontairement défensif : un JSON
 * malformé ou un thème inconnu ne fait pas tomber le pipeline, il retombe sur
 * l'heuristique.
 */

import type { Review, ReviewAnalysis, ThemeId } from './types.js';

export const THEMES: ThemeId[] = [
  'attente',
  'accueil',
  'qualite_produit',
  'proprete',
  'prix',
  'ambiance',
  'service',
  'reservation',
  'autre',
];

export const THEME_LABELS: Record<ThemeId, string> = {
  attente: "Temps d'attente",
  accueil: 'Accueil',
  qualite_produit: 'Qualité produit / plats',
  proprete: 'Propreté',
  prix: 'Prix',
  ambiance: 'Ambiance',
  service: 'Service en salle',
  reservation: 'Réservation',
  autre: 'Autre',
};

/** Lexique de repli. Volontairement court : il cible les motifs les plus fréquents. */
const THEME_LEXICON: Record<Exclude<ThemeId, 'autre'>, string[]> = {
  attente: ['attente', 'attendu', 'attendre', 'lent', 'lenteur', 'long', "file d'attente", 'patienter'],
  accueil: ['accueil', 'accueillant', 'souriant', 'sourire', 'aimable', 'désagréable', 'bonjour', 'poli', 'impoli'],
  qualite_produit: ['plat', 'plats', 'cuisine', 'goût', 'gout', 'savoureux', 'fade', 'froid', 'produit', 'qualité', 'qualite', 'frais', 'délicieux', 'delicieux'],
  proprete: ['propre', 'propreté', 'proprete', 'sale', 'saleté', 'salete', 'hygiène', 'hygiene', 'toilettes'],
  prix: ['prix', 'cher', 'onéreux', 'onereux', 'tarif', 'addition', 'rapport qualité', 'abordable'],
  ambiance: ['ambiance', 'bruyant', 'bruit', 'musique', 'décor', 'decor', 'cadre', 'chaleureux'],
  service: ['service', 'serveur', 'serveuse', 'personnel', 'équipe', 'equipe', 'staff'],
  reservation: ['réservation', 'reservation', 'réserver', 'reserver', 'table réservée', 'annulation'],
};

const POSITIVE_WORDS = [
  'excellent', 'parfait', 'super', 'génial', 'genial', 'délicieux', 'delicieux',
  'agréable', 'agreable', 'top', 'recommande', 'formidable', 'impeccable',
  'chaleureux', 'rapide', 'savoureux', 'copieux', 'bravo', 'merci',
];

const NEGATIVE_WORDS = [
  'mauvais', 'décevant', 'decevant', 'déçu', 'decu', 'horrible', 'sale',
  'froid', 'lent', 'cher', 'bruyant', 'désagréable', 'desagreable', 'fade',
  'inadmissible', 'scandaleux', 'jamais', 'éviter', 'eviter', 'attente',
];

// --------------------------------------------------------------------------
// Prompts
// --------------------------------------------------------------------------

export interface AnalysisPromptInput {
  comment: string;
  rating: number;
  sector: string;
}

/**
 * Prompt d'analyse. Sortie JSON stricte pour alimenter directement le
 * dashboard sans post-traitement manuel.
 */
export function buildAnalysisPrompt(input: AnalysisPromptInput): string {
  return [
    "Tu analyses un avis client déposé sur une plateforme publique pour un établissement du secteur « " +
      input.sector +
      ' ».',
    '',
    `Note attribuée : ${input.rating}/5`,
    'Avis :',
    '"""',
    input.comment,
    '"""',
    '',
    'Réponds UNIQUEMENT par un objet JSON valide, sans texte autour, au format :',
    '{',
    '  "sentiment": "positive" | "neutral" | "negative",',
    '  "score": nombre entre -1 et 1,',
    `  "themes": tableau de 1 à 3 valeurs parmi ${JSON.stringify(THEMES)},`,
    '  "keywords": tableau de 1 à 5 mots ou expressions saillants extraits de l\'avis,',
    '  "language": code ISO 639-1 de la langue de l\'avis',
    '}',
    '',
    "N'invente aucun thème absent de la liste. Si l'avis est vide ou inexploitable, renvoie le thème \"autre\" et un score de 0.",
  ].join('\n');
}

export interface ReplyPromptInput {
  establishmentName: string;
  brandTone: string;
  review: Pick<Review, 'author' | 'rating' | 'comment' | 'platform'>;
  /** Geste commercial autorisé par le gérant, le cas échéant. */
  gesture?: string;
}

/**
 * Prompt de suggestion de réponse.
 *
 * Contraintes imposées au modèle : réponse publique signée par
 * l'établissement, jamais de contrepartie conditionnée à la note, jamais de
 * demande de suppression ou de modification de l'avis.
 */
export function buildReplyPrompt(input: ReplyPromptInput): string {
  const { review } = input;
  return [
    `Tu rédiges la réponse publique de l'établissement « ${input.establishmentName} » à un avis client publié sur ${review.platform}.`,
    '',
    `Ton de marque à respecter : ${input.brandTone}`,
    `Note : ${review.rating}/5 — Auteur : ${review.author}`,
    'Avis :',
    '"""',
    review.comment,
    '"""',
    '',
    input.gesture
      ? `Le gérant autorise ce geste commercial, à proposer en invitant le client à revenir vers l'établissement en privé : ${input.gesture}.`
      : "Ne propose aucun geste commercial : le gérant n'en a pas autorisé.",
    '',
    'Règles impératives :',
    "- 400 caractères maximum, en français, à la première personne du pluriel au nom de l'établissement ;",
    '- remercier, reconnaître précisément ce qui est reproché ou salué, indiquer une action concrète ;',
    "- ne jamais demander au client de retirer, modifier ou améliorer son avis ;",
    '- ne jamais conditionner une compensation à la note donnée ;',
    "- ne jamais contester la véracité de l'avis ni mettre en cause le client ;",
    '- pas de formule générique creuse, pas de markdown, pas de liste à puces.',
    '',
    'Réponds uniquement par le texte de la réponse.',
  ].join('\n');
}

// --------------------------------------------------------------------------
// Parsing défensif
// --------------------------------------------------------------------------

export function parseAnalysis(raw: string): ReviewAnalysis | null {
  const json = extractJson(raw);
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const sentiment = parsed.sentiment;
    if (sentiment !== 'positive' && sentiment !== 'neutral' && sentiment !== 'negative') {
      return null;
    }
    const score = typeof parsed.score === 'number' ? clamp(parsed.score, -1, 1) : 0;
    const themes = Array.isArray(parsed.themes)
      ? (parsed.themes.filter((t): t is ThemeId => THEMES.includes(t as ThemeId)).slice(0, 3))
      : [];
    const keywords = Array.isArray(parsed.keywords)
      ? parsed.keywords.filter((k): k is string => typeof k === 'string').slice(0, 5)
      : [];
    return {
      sentiment,
      score,
      themes: themes.length > 0 ? themes : ['autre'],
      keywords,
      language: typeof parsed.language === 'string' ? parsed.language.slice(0, 5) : 'fr',
      engine: 'llm',
    };
  } catch {
    return null;
  }
}

/** Récupère le premier objet JSON d'une réponse, même entourée de texte. */
function extractJson(raw: string): string | null {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced?.[1]?.trim() ?? trimmed;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return body.slice(start, end + 1);
}

/**
 * Nettoie une réponse suggérée avant de la présenter au gérant.
 * Retire le markdown résiduel, les guillemets d'encadrement et tronque
 * proprement à 400 caractères.
 */
export function sanitizeReply(raw: string, maxLength = 400): string {
  let text = raw.trim();
  text = text.replace(/^```[a-z]*\s*/i, '').replace(/```$/, '');
  text = text.replace(/^["«»\s]+|["«»\s]+$/g, '');
  // Le gras/italique est retiré avant le nettoyage des puces, sinon la paire
  // d'astérisques est cassée par le strip de début de ligne.
  text = text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1');
  text = text.replace(/^[*\-#>\s]+/gm, '');
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return (lastStop > maxLength * 0.6 ? cut.slice(0, lastStop + 1) : cut).trim();
}

/**
 * Détecte les formulations interdites dans une réponse avant publication.
 * Le gérant reste maître de la publication, mais il est averti.
 */
export function replyWarnings(text: string): string[] {
  const lower = text.toLowerCase();
  const warnings: string[] = [];
  if (/(supprim|retir|modifi|enlev|effac)\w*\s+(votre|ton|cet|l'|l’)?\s*(avis|commentaire|note)/.test(lower)) {
    warnings.push("La réponse semble demander le retrait ou la modification de l'avis : c'est interdit par les règles Google.");
  }
  if (/(si vous (mettez|passez|changez)|contre (un|une) (avis|note) (5|cinq))/.test(lower)) {
    warnings.push('La réponse conditionne une contrepartie à la note : formulation non conforme.');
  }
  if (/(faux avis|vous mentez|jamais venu|client fantôme|client fantome)/.test(lower)) {
    warnings.push("La réponse met en cause la véracité de l'avis : à reformuler ou à traiter par un signalement à la plateforme.");
  }
  return warnings;
}

// --------------------------------------------------------------------------
// Moteur heuristique de repli
// --------------------------------------------------------------------------

export function heuristicAnalysis(comment: string, rating: number): ReviewAnalysis {
  const normalized = normalize(comment);
  const words = normalized.split(/[^a-zàâçéèêëîïôûùüÿñæœ]+/i).filter(Boolean);

  const themeHits = new Map<ThemeId, number>();
  for (const [theme, lexicon] of Object.entries(THEME_LEXICON) as [
    Exclude<ThemeId, 'autre'>,
    string[],
  ][]) {
    let hits = 0;
    for (const term of lexicon) {
      if (mentions(normalized, term)) hits += 1;
    }
    if (hits > 0) themeHits.set(theme, hits);
  }

  const themes = [...themeHits.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([theme]) => theme);

  const positives = words.filter((w) => POSITIVE_WORDS.some((p) => w.startsWith(normalize(p).slice(0, 5)))).length;
  const negatives = words.filter((w) => NEGATIVE_WORDS.some((n) => w.startsWith(normalize(n).slice(0, 5)))).length;

  // La note reste le signal le plus fiable ; le lexique l'ajuste à la marge.
  const ratingScore = (rating - 3) / 2;
  const lexicalScore = positives + negatives === 0 ? 0 : (positives - negatives) / (positives + negatives);
  const score = clamp(ratingScore * 0.7 + lexicalScore * 0.3, -1, 1);

  return {
    sentiment: score > 0.2 ? 'positive' : score < -0.2 ? 'negative' : 'neutral',
    score: Number(score.toFixed(2)),
    themes: themes.length > 0 ? themes : ['autre'],
    keywords: extractKeywords(normalized),
    language: 'fr',
    engine: 'heuristic',
  };
}

function extractKeywords(normalized: string): string[] {
  const found: string[] = [];
  for (const [, lexicon] of Object.entries(THEME_LEXICON)) {
    for (const term of lexicon) {
      if (mentions(normalized, term) && !found.includes(term)) found.push(term);
    }
  }
  return found.slice(0, 5);
}

/**
 * Recherche d'un terme du lexique, ancrée sur un début de mot.
 *
 * Une simple recherche de sous-chaîne produit des faux positifs coûteux :
 * « exce-LENT-e » déclencherait le thème « attente » sur un avis 5 étoiles, et
 * le dashboard afficherait une plainte là où il y a un compliment. L'ancrage
 * `\b` laisse passer les dérivations utiles (lent → lentement, long → longue)
 * sans capturer l'intérieur des mots.
 */
function mentions(normalizedText: string, term: string): boolean {
  const escaped = normalize(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}`, 'u').test(normalizedText);
}

const normalize = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));
