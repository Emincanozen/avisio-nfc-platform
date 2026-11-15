/**
 * Client Claude — analyse sémantique des avis et suggestions de réponse.
 *
 * Deux garanties de service :
 *  - sans clé API, le moteur heuristique local prend le relais ;
 *  - en cas d'erreur, de quota atteint ou de sortie illisible, on retombe
 *    également sur l'heuristique plutôt que d'échouer. Un avis non analysé
 *    resterait invisible dans le dashboard, ce qui est pire qu'une analyse
 *    approximative.
 *
 * Coût : l'analyse tourne à effort « low » (tâche de classification courte,
 * la profondeur de raisonnement n'y apporte rien) tandis que la rédaction de
 * réponse, qui engage l'image de l'établissement, tourne à effort « medium ».
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  buildAnalysisPrompt,
  buildReplyPrompt,
  heuristicAnalysis,
  parseAnalysis,
  replyWarnings,
  sanitizeReply,
  type Establishment,
  type Review,
  type ReviewAnalysis,
} from '@avisio/core';
import { capabilities, env } from '../env.js';

export interface ReplySuggestion {
  text: string;
  warnings: string[];
  engine: 'llm' | 'template';
}

/**
 * Compteur de consommation.
 *
 * Il sert deux buts distincts : borner la dépense, et la rendre visible. Sans
 * le second, le premier ne se règle jamais correctement — on ne sait pas où
 * placer le plafond tant qu'on ignore ce que consomme une journée normale.
 *
 * Le comptage est en mémoire du processus, ce qui suffit : c'est un
 * garde-fou contre l'emballement (une boucle, un import massif, un afflux
 * d'avis), pas une comptabilité analytique. La facturation fait foi.
 */
export interface LlmUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  failures: number;
  /** Appels refusés parce que le plafond horaire était atteint. */
  throttled: number;
  windowStartedAt: string;
}

export interface LlmService {
  analyze(review: Pick<Review, 'comment' | 'rating'>, sector: string): Promise<ReviewAnalysis>;
  suggestReply(
    review: Pick<Review, 'author' | 'rating' | 'comment' | 'platform'>,
    establishment: Pick<Establishment, 'name' | 'brandTone'>,
    gesture?: string,
  ): Promise<ReplySuggestion>;
  /** Consommation depuis le début de la fenêtre courante. */
  usage(): LlmUsage;
}

/**
 * Plafond d'appels par heure, tous établissements confondus.
 *
 * Dimensionné très au-dessus de l'usage attendu — un parc de cent
 * établissements produit quelques dizaines d'avis par heure au plus fort —
 * pour ne servir que dans le cas qu'il vise : quelque chose qui s'emballe.
 * Réglable par `LLM_MAX_CALLS_PER_HOUR`.
 *
 * Le dépassement ne fait pas échouer l'appelant : il bascule sur le moteur
 * heuristique local. Un avis analysé approximativement reste exploitable ; un
 * avis non analysé disparaît du tableau de bord.
 */
const WINDOW_MS = 3_600_000;

export function createLlmService(logger: {
  warn: (msg: string) => void;
  info: (msg: string) => void;
}): LlmService {
  const client = capabilities.llm ? new Anthropic({ apiKey: env.anthropicApiKey }) : null;
  const maxCallsPerHour = env.llmMaxCallsPerHour;

  let usage: LlmUsage = freshUsage();
  let alerted = false;

  /** Ouvre une nouvelle fenêtre si l'heure est écoulée. */
  const rollWindow = (): void => {
    if (Date.now() - new Date(usage.windowStartedAt).getTime() < WINDOW_MS) return;
    if (usage.calls > 0) {
      logger.info(
        `Consommation LLM de l'heure écoulée : ${usage.calls} appels, ` +
          `${usage.inputTokens} jetons en entrée, ${usage.outputTokens} en sortie` +
          (usage.throttled > 0 ? `, ${usage.throttled} appels plafonnés` : ''),
      );
    }
    usage = freshUsage();
    alerted = false;
  };

  /** Faux quand le plafond est atteint : l'appelant doit se replier. */
  const grant = (): boolean => {
    rollWindow();
    if (usage.calls < maxCallsPerHour) return true;
    usage.throttled += 1;
    if (!alerted) {
      alerted = true;
      logger.warn(
        `Plafond d'appels au modèle atteint (${maxCallsPerHour}/h) : repli sur le moteur ` +
          "heuristique jusqu'à la fin de l'heure. Si ce n'est pas un incident, relever " +
          'LLM_MAX_CALLS_PER_HOUR.',
      );
    }
    return false;
  };

  const record = (response: Anthropic.Message): void => {
    usage.calls += 1;
    usage.inputTokens += response.usage?.input_tokens ?? 0;
    usage.outputTokens += response.usage?.output_tokens ?? 0;
  };

  return {
    usage: () => {
      rollWindow();
      return { ...usage };
    },

    async analyze(review, sector) {
      if (!client || !grant()) return heuristicAnalysis(review.comment, review.rating);
      try {
        const text = await complete(
          client,
          buildAnalysisPrompt({ comment: review.comment, rating: review.rating, sector }),
          { maxTokens: 512, effort: 'low' },
          record,
        );
        const parsed = parseAnalysis(text);
        if (parsed) return parsed;
        logger.warn('Analyse LLM illisible, repli heuristique.');
      } catch (error) {
        usage.failures += 1;
        logger.warn(`Analyse LLM en échec (${describeError(error)}), repli heuristique.`);
      }
      return heuristicAnalysis(review.comment, review.rating);
    },

    async suggestReply(review, establishment, gesture) {
      if (client && grant()) {
        try {
          const raw = await complete(
            client,
            buildReplyPrompt({
              establishmentName: establishment.name,
              brandTone: establishment.brandTone,
              review,
              ...(gesture ? { gesture } : {}),
            }),
            { maxTokens: 1024, effort: 'medium' },
            record,
          );
          const text = sanitizeReply(raw);
          if (text.length > 0) {
            return { text, warnings: replyWarnings(text), engine: 'llm' };
          }
        } catch (error) {
          usage.failures += 1;
          logger.warn(`Suggestion LLM en échec (${describeError(error)}), repli modèle.`);
        }
      }
      const text = templateReply(review, establishment.name, gesture);
      return { text, warnings: replyWarnings(text), engine: 'template' };
    },
  };
}

/**
 * Un appel, avec délai de garde.
 *
 * Le délai est la moitié de l'histoire : sans lui, un appel qui ne revient
 * jamais bloque le cycle d'ingestion, et donc tous les établissements qui
 * suivent dans la boucle. Mieux vaut une analyse heuristique que l'arrêt de
 * la file.
 */
async function complete(
  client: Anthropic,
  prompt: string,
  options: { maxTokens: number; effort: 'low' | 'medium' | 'high' },
  record: (response: Anthropic.Message) => void,
): Promise<string> {
  const response = await client.messages.create(
    {
      model: env.anthropicModel,
      max_tokens: options.maxTokens,
      output_config: { effort: options.effort },
      messages: [{ role: 'user', content: prompt }],
    },
    // Deux tentatives au plus : au-delà, on paie des jetons pour un service
    // qui ne répond pas, alors que le repli local est immédiat et gratuit.
    { timeout: env.llmTimeoutMs, maxRetries: 1 },
  );

  record(response);

  if (response.stop_reason === 'refusal') {
    throw new Error('refus du modèle');
  }

  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

function describeError(error: unknown): string {
  if (error instanceof Anthropic.RateLimitError) return 'quota atteint';
  if (error instanceof Anthropic.AuthenticationError) return 'clé API invalide';
  if (error instanceof Anthropic.BadRequestError) return `requête invalide : ${error.message}`;
  if (error instanceof Anthropic.APIError) return `erreur API ${error.status}`;
  return error instanceof Error ? error.message : String(error);
}

/**
 * Réponse de repli, sans appel réseau.
 *
 * Volontairement sobre : elle reconnaît le retour et ouvre un canal privé,
 * sans promettre quoi que ce soit que le gérant n'aurait pas validé.
 */
function templateReply(
  review: Pick<Review, 'author' | 'rating'>,
  establishmentName: string,
  gesture?: string,
): string {
  const firstName = review.author.split(' ')[0] ?? '';
  const opening = firstName ? `Bonjour ${firstName}, ` : 'Bonjour, ';

  if (review.rating <= 3) {
    return (
      `${opening}merci d'avoir pris le temps de nous écrire. Votre retour ne correspond pas ` +
      `à ce que nous voulons offrir et nous le prenons au sérieux. ` +
      (gesture ? `Nous aimerions vous proposer ${gesture} : ` : 'Nous restons à votre écoute : ') +
      `contactez-nous directement pour que nous en parlions. L'équipe de ${establishmentName}.`
    );
  }

  return (
    `${opening}merci beaucoup pour votre retour, il fait plaisir à toute l'équipe. ` +
    `Au plaisir de vous accueillir à nouveau. L'équipe de ${establishmentName}.`
  );
}

function freshUsage(): LlmUsage {
  return {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    failures: 0,
    throttled: 0,
    windowStartedAt: new Date().toISOString(),
  };
}
