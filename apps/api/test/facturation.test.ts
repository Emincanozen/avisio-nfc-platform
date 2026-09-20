/**
 * Idempotence de la facturation.
 *
 * Le défaut corrigé ici coûtait de l'argent réel à un client réel : deux
 * cycles de facturation qui se chevauchaient émettaient deux factures pour le
 * même mois, chacune avec un numéro légal valide, et le prélèvement doublait.
 *
 * Il ne demandait rien d'exotique pour se produire. Le cron qui traîne pendant
 * que l'exploitant clique « lancer la facturation » dans le back-office
 * suffit. Deux instances de l'API derrière un répartiteur aussi. Un
 * redémarrage au mauvais moment également.
 *
 * Ces cas s'exécutent sur l'adaptateur mémoire, qui porte la même règle. La
 * concurrence *réelle* — deux transactions PostgreSQL simultanées, arbitrées
 * par la contrainte d'unicité — est vérifiée par `scripts/pg-verify.mts`
 * contre une vraie base : l'adaptateur mémoire ne peut pas la prouver, il
 * n'a pas de parallélisme à exhiber.
 */

import { describe, expect, it } from 'vitest';
import { addMonths, generateId, type Establishment, type Subscription } from '@avisio/core';
import { createMemoryRepository } from '../src/repository/memory.js';
import type { Repository } from '../src/repository/index.js';
import { createBillingService } from '../src/services/billing.js';
import type { Notifier } from '../src/services/notify.js';

const MAINTENANT = '2026-09-21T10:00:00.000Z';

const silencieux = { info: () => {}, warn: () => {} };

const notifierMuet = (): { notifier: Notifier; envoyes: string[] } => {
  const envoyes: string[] = [];
  return {
    envoyes,
    notifier: {
      async alert() {},
      async billing(_to, _etab, subject) {
        envoyes.push(subject);
      },
      async monthlyReport() {},
    },
  };
};

/** Un établissement abonné dont la période est échue : à facturer. */
async function terrain(repo: Repository): Promise<{
  etablissement: Establishment;
  abonnement: Subscription;
}> {
  const etablissement = await repo.establishments.create({
    id: generateId('est'),
    name: 'Le Bistrot Témoin',
    postalCode: '69001',
    sector: 'restaurant',
    plan: 'essentiel',
    addons: [],
    committed12Months: false,
    brandTone: 'professionnel et courtois',
    defaultLocale: 'fr',
    createdAt: addMonths(MAINTENANT, -1),
  });

  const abonnement = await repo.subscriptions.create({
    id: generateId('sub'),
    establishmentId: etablissement.id,
    plan: 'essentiel',
    addons: [],
    extraPlatforms: 0,
    tags: 1,
    committed12Months: false,
    status: 'active',
    startedAt: addMonths(MAINTENANT, -1),
    currentPeriodStart: addMonths(MAINTENANT, -1),
    currentPeriodEnd: MAINTENANT,
  });

  return { etablissement, abonnement };
}

describe('une période, une facture', () => {
  it('ne facture pas deux fois quand deux cycles se chevauchent', async () => {
    const repo = createMemoryRepository({ seed: false });
    const { notifier } = notifierMuet();
    const facturation = createBillingService({ repo, notifier, logger: silencieux });
    const { etablissement } = await terrain(repo);

    const [a, b] = await Promise.all([
      facturation.runBilling(MAINTENANT),
      facturation.runBilling(MAINTENANT),
    ]);

    const factures = await repo.invoices.listByEstablishment(etablissement.id);
    expect(factures).toHaveLength(1);

    // Un seul des deux cycles a émis ; l'autre a reconnu une période déjà
    // facturée. Lequel gagne n'a aucune importance, et dépendre de l'ordre
    // rendrait ce test menteur.
    expect(a.invoicesIssued + b.invoicesIssued).toBe(1);
    expect(a.alreadyBilled + b.alreadyBilled).toBe(1);
  });

  it('ne facture pas deux fois un cycle rejoué', async () => {
    const repo = createMemoryRepository({ seed: false });
    const { notifier } = notifierMuet();
    const facturation = createBillingService({ repo, notifier, logger: silencieux });
    const { etablissement } = await terrain(repo);

    const premier = await facturation.runBilling(MAINTENANT);
    // Rejeu à l'identique : une reprise après panne, ou un ordonnanceur qui
    // relance un traitement dont il n'a pas vu la fin.
    const second = await facturation.runBilling(MAINTENANT);

    expect(premier.invoicesIssued).toBe(1);
    expect(second.invoicesIssued).toBe(0);
    expect(await repo.invoices.listByEstablishment(etablissement.id)).toHaveLength(1);
  });

  it("ne compte pas dans le chiffre d'affaires une facture qu'il n'a pas émise", async () => {
    const repo = createMemoryRepository({ seed: false });
    const { notifier } = notifierMuet();
    const facturation = createBillingService({ repo, notifier, logger: silencieux });
    await terrain(repo);

    await facturation.runBilling(MAINTENANT);
    const rejeu = await facturation.runBilling(MAINTENANT);

    // Sans cela, un cycle rejoué afficherait un chiffre d'affaires inventé,
    // et l'exploitant piloterait sur un nombre faux.
    expect(rejeu.totalCents).toBe(0);
    expect(rejeu.invoicesIssued).toBe(0);

    // `alreadyBilled` reste à zéro, et c'est la bonne réponse : la période
    // ayant avancé, l'abonnement n'est plus échu, donc le rejeu ne le
    // trouve même pas. Ce compteur sert au chevauchement — deux cycles qui
    // lisent la même période avant que l'un des deux ne l'ait fait avancer.
    expect(rejeu.alreadyBilled).toBe(0);
  });

  it("n'envoie qu'un seul avis d'échéance au client", async () => {
    const repo = createMemoryRepository({ seed: false });
    const { notifier, envoyes } = notifierMuet();
    const facturation = createBillingService({ repo, notifier, logger: silencieux });
    await terrain(repo);
    await repo.managers.create({
      id: generateId('mgr'),
      email: 'gerant@bistrot.fr',
      name: 'Gérant',
      passwordHash: 'scrypt$sel$abc',
      role: 'owner',
      establishmentIds: [(await repo.establishments.listAll())[0]!.id],
      createdAt: MAINTENANT,
    });

    await facturation.runBilling(MAINTENANT);
    await facturation.runBilling(MAINTENANT);

    // Un second avis pour la même facture ne serait pas qu'un doublon : pour
    // beaucoup de gérants, recevoir deux fois un avis d'échéance veut dire
    // qu'un règlement n'est pas passé.
    expect(envoyes).toHaveLength(1);
  });
});

describe('ce que la correction ne doit pas casser', () => {
  it('facture bien la période suivante le mois d’après', async () => {
    const repo = createMemoryRepository({ seed: false });
    const { notifier } = notifierMuet();
    const facturation = createBillingService({ repo, notifier, logger: silencieux });
    const { etablissement } = await terrain(repo);

    await facturation.runBilling(MAINTENANT);
    // Le danger d'une contrainte d'unicité est de bloquer aussi le cas
    // légitime : un mois plus tard, la nouvelle période doit être facturée.
    const suivant = await facturation.runBilling(addMonths(MAINTENANT, 1));

    expect(suivant.invoicesIssued).toBe(1);
    const factures = await repo.invoices.listByEstablishment(etablissement.id);
    expect(factures).toHaveLength(2);
    expect(new Set(factures.map((f) => f.periodStart)).size).toBe(2);
  });

  it('ne modifie ni ne supprime la facture déjà émise', async () => {
    const repo = createMemoryRepository({ seed: false });
    const { notifier } = notifierMuet();
    const facturation = createBillingService({ repo, notifier, logger: silencieux });
    const { etablissement } = await terrain(repo);

    await facturation.runBilling(MAINTENANT);
    const avant = (await repo.invoices.listByEstablishment(etablissement.id))[0]!;

    await facturation.runBilling(MAINTENANT);
    const apres = (await repo.invoices.listByEstablishment(etablissement.id))[0]!;

    // Une facture émise est une pièce comptable : la réécrire, même à
    // l'identique, n'est pas permis. Le rejeu doit être sans effet, pas
    // « sans effet visible ».
    expect(apres).toEqual(avant);
  });

  it('laisse la séquence légale sans trou après un doublon refusé', async () => {
    const repo = createMemoryRepository({ seed: false });
    const { notifier } = notifierMuet();
    const facturation = createBillingService({ repo, notifier, logger: silencieux });
    const premier = await terrain(repo);

    await facturation.runBilling(MAINTENANT);
    await facturation.runBilling(MAINTENANT); // refusé

    // Un second établissement facturé après le refus : son numéro doit
    // suivre immédiatement le premier. Un numéro consommé par une tentative
    // rejetée laisserait un trou dans la numérotation, ce que
    // l'administration fiscale n'admet pas.
    const second = await terrain(repo);
    await facturation.runBilling(MAINTENANT);

    const [f1] = await repo.invoices.listByEstablishment(premier.etablissement.id);
    const [f2] = await repo.invoices.listByEstablishment(second.etablissement.id);
    const rang = (numero: string): number => Number(numero.split('-').at(-1));

    expect(rang(f2!.number) - rang(f1!.number)).toBe(1);
  });
});
