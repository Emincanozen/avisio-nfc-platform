/**
 * Modèle financier Avisio — 36 mois.
 *
 * Le modèle est du code, pas un tableur : les hypothèses sont nommées en un
 * seul endroit, la projection est reproductible, et une hypothèse qu'on change
 * se propage partout. Lancer avec :
 *
 *   npx tsx scripts/financial-model.ts
 *
 * Sorties : docs/modele-financier.md et docs/modele-financier.csv.
 *
 * Toutes les valeurs sont en euros HT. Les hypothèses commerciales sont
 * volontairement prudentes et sourcées dans docs/business-plan.md §8.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLANS, ADDONS } from '../packages/core/src/pricing.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCS = resolve(HERE, '..', 'docs');

// ---------------------------------------------------------------------------
// Hypothèses
// ---------------------------------------------------------------------------

const ASSUMPTIONS = {
  /** Répartition des nouveaux clients par offre. */
  planMix: { essentiel: 0.5, pro: 0.35, premium: 0.15 },

  /**
   * Add-ons souscrits en plus de l'offre, en part des clients concernés.
   * Un add-on déjà compris dans l'offre n'est jamais refacturé (cf. pricing.ts),
   * on ne compte donc que les ventes réellement facturables.
   */
  addonAttach: {
    /** Analytics vendu aux clients Pro (inclus en Premium). */
    analytics: 0.3,
    /** Fidélité vendue aux clients Essentiel et Pro. */
    loyalty: 0.2,
    /** Plateformes supplémentaires facturées, hors quota de l'offre. */
    extraPlatform: 0.25,
  },

  /** Attrition mensuelle. Commerce de proximité : fermetures + reventes. */
  monthlyChurn: 0.03,

  /** Part des contrats signés avec engagement 12 mois (mise en service offerte). */
  committedShare: 0.7,

  /** Plaquettes vendues au-delà du quota, par nouveau client. */
  extraTagsPerCustomer: 0.8,
  /** Plaquettes premium personnalisées vendues, par nouveau client. */
  premiumTagsPerCustomer: 0.25,

  /** Coûts variables mensuels par établissement actif. */
  cogsPerCustomer: {
    hosting: 1.1,
    llm: 0.9, // analyse NLP + suggestions de réponse, marge de sécurité ×4
    email: 0.15,
    payments: 0, // calculé en % du CA ci-dessous
  },
  /** Commissions d'encaissement (Stripe/GoCardless SEPA). */
  paymentFeeRate: 0.014,

  /** Coût de revient du matériel. */
  hardwareCost: { sticker: 0.9, chevalet: 5.5, premium: 14 },

  /** Coût d'acquisition : rémunération commerciale rapportée aux ventes. */
  salesCostPerRep: 3800, // brut chargé + frais de déplacement
  salesPerRepPerMonth: 14, // signatures par commercial en rythme de croisière
  rampUpMonths: 2, // montée en charge d'un nouveau commercial
  /**
   * Le fondateur assure lui-même l'équivalent d'un poste de vente : on ne
   * recrute donc qu'à partir du second « équivalent commercial » nécessaire.
   * C'est l'hypothèse la plus optimiste du modèle — si le fondateur passe son
   * temps sur le produit ou le support, il faut recruter un rang plus tôt.
   */
  founderSellsAsOneRep: true,

  /** Charges fixes hors force de vente. */
  fixedCosts: {
    founder: 2600, // rémunération fondateur à partir du mois 4
    founderStartMonth: 4,
    developerSalary: 4200, // brut chargé, recrutement au mois 10
    developerStartMonth: 10,
    supportSalary: 2900, // support/onboarding, recrutement au mois 18
    supportStartMonth: 18,
    tools: 180, // SaaS outillage, comptabilité, domaine
    legal: 120, // assurance RC pro, conseil, RGPD
    marketing: 250, // site, print, salons locaux
  },

  /** Investissement initial. */
  initialInvestment: 40000,
} as const;

/** Plan d'acquisition : nouveaux clients signés par mois. */
const ACQUISITION_PLAN: number[] = [
  // Phase 1 — MVP, pilotes gratuits convertis (mois 1-2)
  0, 4,
  // Phase 2 — offre Pro, premier vrai démarchage (mois 3-5)
  6, 9, 12,
  // Phase 3 — analytics + multi-plateformes, 1er commercial (mois 6-9)
  14, 15, 16, 16,
  // Phase 4 — fidélité et plaquettes premium (mois 10-12)
  18, 20, 22,
  // Année 2 — 2e commercial au mois 15, 3e au mois 21
  24, 26, 28, 34, 36, 38, 40, 42, 44, 52, 54, 56,
  // Année 3 — maillage Occitanie + revente par agences partenaires
  58, 60, 62, 64, 66, 68, 70, 72, 74, 76, 78, 80,
];

// ---------------------------------------------------------------------------
// Calculs dérivés
// ---------------------------------------------------------------------------

/** ARPU mensuel : abonnement moyen + add-ons réellement facturables. */
function computeArpu(): { arpu: number; detail: Record<string, number> } {
  const mix = ASSUMPTIONS.planMix;
  const subscription =
    (mix.essentiel * PLANS.essentiel.monthlyCents +
      mix.pro * PLANS.pro.monthlyCents +
      mix.premium * PLANS.premium.monthlyCents) /
    100;

  // Analytics : facturable uniquement aux clients Pro (compris en Premium).
  const analytics =
    (mix.pro * ASSUMPTIONS.addonAttach.analytics * ADDONS.analytics.monthlyCents) / 100;
  // Fidélité : facturable en Essentiel et Pro (comprise en Premium).
  const loyalty =
    ((mix.essentiel + mix.pro) * ASSUMPTIONS.addonAttach.loyalty * ADDONS.loyalty.monthlyCents) /
    100;
  // Plateforme supplémentaire : hors quota, donc pas sur Premium (illimité).
  const extraPlatform =
    ((mix.essentiel + mix.pro) *
      ASSUMPTIONS.addonAttach.extraPlatform *
      ADDONS.extra_platform.monthlyCents) /
    100;

  const detail = { subscription, analytics, loyalty, extraPlatform };
  return { arpu: subscription + analytics + loyalty + extraPlatform, detail };
}

/** Chiffre d'affaires ponctuel encaissé à chaque signature. */
function oneOffPerCustomer(): { revenue: number; cost: number } {
  const setup = (1 - ASSUMPTIONS.committedShare) * 49;
  const extraTags = ASSUMPTIONS.extraTagsPerCustomer * 15;
  const premiumTags = ASSUMPTIONS.premiumTagsPerCustomer * 35;

  // Le matériel inclus dans l'offre est un coût sans recette associée.
  const includedTags =
    ASSUMPTIONS.planMix.essentiel * PLANS.essentiel.includedTags +
    ASSUMPTIONS.planMix.pro * PLANS.pro.includedTags +
    ASSUMPTIONS.planMix.premium * PLANS.premium.includedTags;

  const cost =
    includedTags * ASSUMPTIONS.hardwareCost.chevalet * 0.4 +
    includedTags * ASSUMPTIONS.hardwareCost.sticker * 0.6 +
    ASSUMPTIONS.extraTagsPerCustomer * ASSUMPTIONS.hardwareCost.sticker +
    ASSUMPTIONS.premiumTagsPerCustomer * ASSUMPTIONS.hardwareCost.premium;

  return { revenue: setup + extraTags + premiumTags, cost };
}

interface MonthRow {
  month: number;
  newCustomers: number;
  churned: number;
  activeCustomers: number;
  mrr: number;
  recurringRevenue: number;
  oneOffRevenue: number;
  totalRevenue: number;
  cogs: number;
  salesCost: number;
  fixedCost: number;
  totalCost: number;
  ebitda: number;
  cash: number;
  salesReps: number;
}

function project(): MonthRow[] {
  const { arpu } = computeArpu();
  const oneOff = oneOffPerCustomer();
  const rows: MonthRow[] = [];

  let active = 0;
  let cash = ASSUMPTIONS.initialInvestment;

  for (let month = 1; month <= ACQUISITION_PLAN.length; month += 1) {
    const newCustomers = ACQUISITION_PLAN[month - 1] ?? 0;

    // L'attrition porte sur le parc de début de mois.
    const churned = Math.round(active * ASSUMPTIONS.monthlyChurn);
    active = active - churned + newCustomers;

    // Les nouveaux clients ne paient en moyenne qu'une demi-mensualité le
    // premier mois : les signatures s'étalent dans le mois.
    const billable = active - newCustomers / 2;
    const recurringRevenue = billable * arpu;
    const oneOffRevenue = newCustomers * oneOff.revenue;
    const totalRevenue = recurringRevenue + oneOffRevenue;

    const variable = ASSUMPTIONS.cogsPerCustomer;
    const cogs =
      active * (variable.hosting + variable.llm + variable.email) +
      newCustomers * oneOff.cost +
      totalRevenue * ASSUMPTIONS.paymentFeeRate;

    const salesReps = repsNeeded(month);
    const salesCost = salesReps * ASSUMPTIONS.salesCostPerRep;

    const fixed = ASSUMPTIONS.fixedCosts;
    const fixedCost =
      (month >= fixed.founderStartMonth ? fixed.founder : 0) +
      (month >= fixed.developerStartMonth ? fixed.developerSalary : 0) +
      (month >= fixed.supportStartMonth ? fixed.supportSalary : 0) +
      fixed.tools +
      fixed.legal +
      fixed.marketing;

    const totalCost = cogs + salesCost + fixedCost;
    const ebitda = totalRevenue - totalCost;
    cash += ebitda;

    rows.push({
      month,
      newCustomers,
      churned,
      activeCustomers: active,
      mrr: active * arpu,
      recurringRevenue,
      oneOffRevenue,
      totalRevenue,
      cogs,
      salesCost,
      fixedCost,
      totalCost,
      ebitda,
      cash,
      salesReps,
    });
  }

  return rows;
}

/**
 * Effectif commercial nécessaire pour tenir le plan d'acquisition, avec une
 * montée en charge : un commercial recruté n'est pleinement productif qu'au
 * bout de deux mois, et il faut donc l'embaucher avant d'en avoir besoin.
 */
function repsNeeded(month: number): number {
  const target = ACQUISITION_PLAN[Math.min(ACQUISITION_PLAN.length, month + ASSUMPTIONS.rampUpMonths) - 1] ?? 0;
  return Math.max(0, Math.ceil(target / ASSUMPTIONS.salesPerRepPerMonth) - 1);
}

// ---------------------------------------------------------------------------
// Restitution
// ---------------------------------------------------------------------------

const eur = (value: number): string =>
  `${Math.round(value).toLocaleString('fr-FR')} €`;

function yearSummary(rows: MonthRow[], year: number) {
  const slice = rows.slice((year - 1) * 12, year * 12);
  const last = slice[slice.length - 1]!;
  return {
    year,
    revenue: slice.reduce((a, r) => a + r.totalRevenue, 0),
    recurring: slice.reduce((a, r) => a + r.recurringRevenue, 0),
    oneOff: slice.reduce((a, r) => a + r.oneOffRevenue, 0),
    costs: slice.reduce((a, r) => a + r.totalCost, 0),
    ebitda: slice.reduce((a, r) => a + r.ebitda, 0),
    endCustomers: last.activeCustomers,
    endMrr: last.mrr,
    endArr: last.mrr * 12,
    endCash: last.cash,
  };
}

function main(): void {
  const rows = project();
  const { arpu, detail } = computeArpu();
  const oneOff = oneOffPerCustomer();

  const grossMarginPerCustomer =
    arpu -
    (ASSUMPTIONS.cogsPerCustomer.hosting +
      ASSUMPTIONS.cogsPerCustomer.llm +
      ASSUMPTIONS.cogsPerCustomer.email) -
    arpu * ASSUMPTIONS.paymentFeeRate;
  const grossMarginRate = grossMarginPerCustomer / arpu;

  const cac = ASSUMPTIONS.salesCostPerRep / ASSUMPTIONS.salesPerRepPerMonth;
  const ltv = grossMarginPerCustomer / ASSUMPTIONS.monthlyChurn;
  const paybackMonths = cac / grossMarginPerCustomer;
  const averageLifetimeMonths = 1 / ASSUMPTIONS.monthlyChurn;

  // Équilibre durable : premier mois à partir duquel l'EBITDA ne repasse plus
  // jamais négatif. Prendre le premier mois positif serait trompeur — les tout
  // premiers mois le sont mécaniquement, avant les premiers recrutements.
  const breakEven = rows.find((r, index) => rows.slice(index).every((next) => next.ebitda > 0));
  const cashLow = rows.reduce((min, r) => (r.cash < min.cash ? r : min), rows[0]!);

  const years = [1, 2, 3].map((y) => yearSummary(rows, y));

  // ---- CSV ---------------------------------------------------------------
  const csv = [
    'mois;nouveaux;perdus;parc;mrr;ca_recurrent;ca_ponctuel;ca_total;couts_variables;cout_commercial;charges_fixes;cout_total;ebitda;tresorerie',
    ...rows.map((r) =>
      [
        r.month,
        r.newCustomers,
        r.churned,
        r.activeCustomers,
        r.mrr.toFixed(0),
        r.recurringRevenue.toFixed(0),
        r.oneOffRevenue.toFixed(0),
        r.totalRevenue.toFixed(0),
        r.cogs.toFixed(0),
        r.salesCost.toFixed(0),
        r.fixedCost.toFixed(0),
        r.totalCost.toFixed(0),
        r.ebitda.toFixed(0),
        r.cash.toFixed(0),
      ].join(';'),
    ),
  ].join('\n');

  // ---- Markdown ----------------------------------------------------------
  const md = `# Modèle financier — Avisio

> Généré par \`scripts/financial-model.ts\`. Ne pas éditer à la main :
> modifier les hypothèses dans le script et relancer \`npx tsx scripts/financial-model.ts\`.
> Montants en euros HT.

## 1. Revenu moyen par établissement (ARPU)

| Composante | Montant mensuel |
|---|---:|
| Abonnement moyen (mix ${pct(ASSUMPTIONS.planMix.essentiel)} / ${pct(ASSUMPTIONS.planMix.pro)} / ${pct(ASSUMPTIONS.planMix.premium)}) | ${eur(detail.subscription)} |
| Add-on Analytics (${pct(ASSUMPTIONS.addonAttach.analytics)} des clients Pro) | ${eur(detail.analytics)} |
| Add-on Fidélité (${pct(ASSUMPTIONS.addonAttach.loyalty)} hors Premium) | ${eur(detail.loyalty)} |
| Plateformes supplémentaires (${pct(ASSUMPTIONS.addonAttach.extraPlatform)} hors quota) | ${eur(detail.extraPlatform)} |
| **ARPU mensuel** | **${eur(arpu)}** |

Recette ponctuelle à la signature : **${eur(oneOff.revenue)}** (mise en service hors
engagement + plaquettes supplémentaires et premium), pour un coût matériel de
${eur(oneOff.cost)}.

## 2. Économie unitaire

| Indicateur | Valeur | Lecture |
|---|---:|---|
| Marge brute par client | ${eur(grossMarginPerCustomer)}/mois | ${pct(grossMarginRate)} de l'ARPU |
| Coût d'acquisition (CAC) | ${eur(cac)} | coût commercial ÷ ${ASSUMPTIONS.salesPerRepPerMonth} signatures/mois |
| Durée de vie moyenne | ${averageLifetimeMonths.toFixed(0)} mois | attrition ${pct(ASSUMPTIONS.monthlyChurn)}/mois |
| Valeur vie client (LTV) | ${eur(ltv)} | marge brute × durée de vie |
| **LTV / CAC** | **${(ltv / cac).toFixed(1)}×** | seuil de viabilité : 3× |
| **Retour sur CAC** | **${paybackMonths.toFixed(1)} mois** | seuil de confort : < 12 mois |

Le modèle tient parce que le coût variable est faible : l'analyse d'un avis par
un modèle de langage coûte moins d'un centime, et l'essentiel du prix paie le
logiciel, pas la consommation.

## 3. Projection à 3 ans

| | Année 1 | Année 2 | Année 3 |
|---|---:|---:|---:|
| Parc en fin d'année | ${years[0]!.endCustomers} | ${years[1]!.endCustomers} | ${years[2]!.endCustomers} |
| MRR en fin d'année | ${eur(years[0]!.endMrr)} | ${eur(years[1]!.endMrr)} | ${eur(years[2]!.endMrr)} |
| ARR en fin d'année | ${eur(years[0]!.endArr)} | ${eur(years[1]!.endArr)} | ${eur(years[2]!.endArr)} |
| CA récurrent | ${eur(years[0]!.recurring)} | ${eur(years[1]!.recurring)} | ${eur(years[2]!.recurring)} |
| CA ponctuel (matériel, mise en service) | ${eur(years[0]!.oneOff)} | ${eur(years[1]!.oneOff)} | ${eur(years[2]!.oneOff)} |
| **CA total** | **${eur(years[0]!.revenue)}** | **${eur(years[1]!.revenue)}** | **${eur(years[2]!.revenue)}** |
| Charges totales | ${eur(years[0]!.costs)} | ${eur(years[1]!.costs)} | ${eur(years[2]!.costs)} |
| **EBITDA** | **${eur(years[0]!.ebitda)}** | **${eur(years[1]!.ebitda)}** | **${eur(years[2]!.ebitda)}** |
| Trésorerie en fin d'année | ${eur(years[0]!.endCash)} | ${eur(years[1]!.endCash)} | ${eur(years[2]!.endCash)} |

## 4. Points de passage

- **Équilibre durable atteint au mois ${breakEven ? breakEven.month : '—'}**${
    breakEven
      ? ` (${breakEven.activeCustomers} établissements) : à partir de là, l'EBITDA ne repasse plus négatif.`
      : '.'
  }
- **Trésorerie au plus bas : ${eur(cashLow.cash)} au mois ${cashLow.month}.** C'est
  ce creux qui dimensionne le besoin de financement, pas la perte cumulée.
- Apport initial modélisé : ${eur(ASSUMPTIONS.initialInvestment)}.${
    cashLow.cash < 0
      ? ` **Insuffisant : il manque ${eur(-cashLow.cash)}** au point bas. Trois leviers : ralentir le recrutement commercial, augmenter la part de contrats engagés, ou lever ce complément.`
      : ' Suffisant pour absorber le creux sans financement externe.'
  }

## 5. Détail mensuel

| Mois | Parc | MRR | CA total | Coût total | EBITDA | Trésorerie |
|---:|---:|---:|---:|---:|---:|---:|
${rows
  .map(
    (r) =>
      `| ${r.month} | ${r.activeCustomers} | ${eur(r.mrr)} | ${eur(r.totalRevenue)} | ${eur(r.totalCost)} | ${eur(r.ebitda)} | ${eur(r.cash)} |`,
  )
  .join('\n')}

## 6. Sensibilité

Les trois hypothèses qui font basculer le modèle, testées isolément :

${sensitivity()}

## 7. Ce que le modèle ne dit pas

- Il suppose un cycle de vente court (une visite, une signature). Sur les
  chaînes et les franchises, comptez 3 à 6 mois et un interlocuteur siège.
- Il ne modélise pas la saisonnalité : un restaurant signe mal en août et en
  janvier. Sur l'année, l'effet se compense ; sur un trimestre, non.
- Il ignore le coût d'un accès partenaire TripAdvisor, encore inconnu à ce
  stade. Si cet accès devient payant au volume, l'add-on multi-plateformes doit
  être reprixé.
- L'attrition retenue (${pct(ASSUMPTIONS.monthlyChurn)}/mois) est une hypothèse,
  pas une mesure. C'est le premier chiffre à confirmer sur les pilotes.
`;

  mkdirSync(DOCS, { recursive: true });
  writeFileSync(resolve(DOCS, 'modele-financier.md'), md, 'utf8');
  writeFileSync(resolve(DOCS, 'modele-financier.csv'), csv, 'utf8');

  console.log('ARPU                :', eur(arpu));
  console.log('Marge brute/client  :', eur(grossMarginPerCustomer), `(${pct(grossMarginRate)})`);
  console.log('CAC                 :', eur(cac));
  console.log('LTV                 :', eur(ltv), `— LTV/CAC ${(ltv / cac).toFixed(1)}x`);
  console.log('Retour sur CAC      :', `${paybackMonths.toFixed(1)} mois`);
  console.log('Équilibre durable   :', breakEven ? `mois ${breakEven.month}` : 'non atteint');
  console.log('Trésorerie mini     :', eur(cashLow.cash), `(mois ${cashLow.month})`);
  for (const year of years) {
    console.log(
      `Année ${year.year}            :`,
      `CA ${eur(year.revenue)} · EBITDA ${eur(year.ebitda)} · parc ${year.endCustomers}`,
    );
  }
  console.log('\nÉcrit : docs/modele-financier.md et docs/modele-financier.csv');
}

/** Variations à une seule hypothèse, pour montrer où est la fragilité. */
function sensitivity(): string {
  const base = project();
  const baseYear3 = yearSummary(base, 3);

  const scenarios: Array<{ label: string; mutate: () => void; restore: () => void }> = [];
  const original = {
    churn: ASSUMPTIONS.monthlyChurn,
    mix: { ...ASSUMPTIONS.planMix },
    perRep: ASSUMPTIONS.salesPerRepPerMonth,
  };

  const mutable = ASSUMPTIONS as unknown as {
    monthlyChurn: number;
    planMix: { essentiel: number; pro: number; premium: number };
    salesPerRepPerMonth: number;
  };

  scenarios.push({
    label: `Attrition à 5 %/mois au lieu de ${pct(original.churn)}`,
    mutate: () => {
      mutable.monthlyChurn = 0.05;
    },
    restore: () => {
      mutable.monthlyChurn = original.churn;
    },
  });
  scenarios.push({
    label: 'Mix tiré vers le bas (70 % Essentiel, 25 % Pro, 5 % Premium)',
    mutate: () => {
      mutable.planMix = { essentiel: 0.7, pro: 0.25, premium: 0.05 };
    },
    restore: () => {
      mutable.planMix = original.mix;
    },
  });
  scenarios.push({
    label: `Productivité commerciale à 9 signatures/mois au lieu de ${original.perRep}`,
    mutate: () => {
      mutable.salesPerRepPerMonth = 9;
    },
    restore: () => {
      mutable.salesPerRepPerMonth = original.perRep;
    },
  });

  const lines = ['| Scénario | ARR fin année 3 | EBITDA année 3 | Écart |', '|---|---:|---:|---:|'];
  lines.push(
    `| Référence | ${eur(baseYear3.endArr)} | ${eur(baseYear3.ebitda)} | — |`,
  );

  for (const scenario of scenarios) {
    scenario.mutate();
    const summary = yearSummary(project(), 3);
    scenario.restore();
    const delta = summary.ebitda - baseYear3.ebitda;
    lines.push(
      `| ${scenario.label} | ${eur(summary.endArr)} | ${eur(summary.ebitda)} | ${delta >= 0 ? '+' : ''}${eur(delta)} |`,
    );
  }

  return lines.join('\n');
}

const pct = (value: number): string => `${Math.round(value * 100)} %`;

main();
