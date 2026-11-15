/**
 * Catalogue commercial et simulateur de devis.
 *
 * Exposé sans authentification : il alimente la page tarifs du site et le
 * simulateur utilisé en rendez-vous par le commercial.
 */

import { ADDONS, PLANS, formatEuros, quote } from '@avisio/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const quoteSchema = z.object({
  plan: z.enum(['essentiel', 'pro', 'premium']),
  addons: z
    .array(z.enum(['negative_reviews', 'extra_platform', 'analytics', 'loyalty']))
    .default([]),
  tags: z.number().int().min(1).max(50).default(1),
  premiumTags: z.number().int().min(0).max(50).default(0),
  extraPlatforms: z.number().int().min(0).max(4).default(0),
  committed12Months: z.boolean().default(true),
});

export async function registerCatalogRoutes(app: FastifyInstance): Promise<void> {
  app.get('/catalog', async () => ({
    plans: Object.values(PLANS).map((plan) => ({
      ...plan,
      extraPlatforms: Number.isFinite(plan.extraPlatforms) ? plan.extraPlatforms : null,
      monthlyLabel: formatEuros(plan.monthlyCents),
    })),
    addons: Object.values(ADDONS).map((addon) => ({
      ...addon,
      monthlyLabel: formatEuros(addon.monthlyCents),
    })),
    oneOff: {
      extraTag: { cents: 1500, label: formatEuros(1500) },
      premiumTag: { cents: 3500, label: formatEuros(3500) },
      setupFee: { cents: 4900, label: formatEuros(4900) },
    },
  }));

  app.post('/catalog/quote', async (request) => {
    const input = quoteSchema.parse(request.body);
    const result = quote(input);
    return {
      ...result,
      lines: result.lines.map((line) => ({ ...line, totalLabel: formatEuros(line.totalCents) })),
      monthlyLabel: formatEuros(result.monthlyCentsExclVat),
      monthlyInclVatLabel: formatEuros(result.monthlyCentsInclVat),
      firstInvoiceLabel: formatEuros(result.firstInvoiceCentsInclVat),
    };
  });
}
