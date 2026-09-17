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

export interface LlmService {
  analyze(review: Pick<Review, 'comment' | 'rating'>, sector: string): Promise<ReviewAnalysis>;
  suggestReply(
    review: Pick<Review, 'author' | 'rating' | 'comment' | 'platform'>,
    establishment: Pick<Establishment, 'name' | 'brandTone'>,
    gesture?: string,
  ): Promise<ReplySuggestion>;
}

export function createLlmService(logger: {
  warn: (msg: string) => void;
  info: (msg: string) => void;
}): LlmService {
  const client = capabilities.llm ? new Anthropic({ apiKey: env.anthropicApiKey }) : null;

  return {
    async analyze(review, sector) {
      if (!client) return heuristicAnalysis(review.comment, review.rating);
      try {
        const text = await complete(
          client,
          buildAnalysisPrompt({ comment: review.comment, rating: review.rating, sector }),
          { maxTokens: 512, effort: 'low' },
        );
        const parsed = parseAnalysis(text);
        if (parsed) return parsed;
        logger.warn('Analyse LLM illisible, repli heuristique.');
      } catch (error) {
        logger.warn(`Analyse LLM en échec (${describeError(error)}), repli heuristique.`);
      }
      return heuristicAnalysis(review.comment, review.rating);
    },

    async suggestReply(review, establishment, gesture) {
      if (client) {
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
          );
          const text = sanitizeReply(raw);
          if (text.length > 0) {
            return { text, warnings: replyWarnings(text), engine: 'llm' };
          }
        } catch (error) {
          logger.warn(`Suggestion LLM en échec (${describeError(error)}), repli modèle.`);
        }
      }
      const text = templateReply(review, establishment.name, gesture);
      return { text, warnings: replyWarnings(text), engine: 'template' };
    },
  };
}

async function complete(
  client: Anthropic,
  prompt: string,
  options: { maxTokens: number; effort: 'low' | 'medium' | 'high' },
): Promise<string> {
  const response = await client.messages.create({
    model: env.anthropicModel,
    max_tokens: options.maxTokens,
    output_config: { effort: options.effort },
    messages: [{ role: 'user', content: prompt }],
  });

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
