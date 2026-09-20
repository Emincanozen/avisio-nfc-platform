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

describe('prorata d’un changement d’offre', () => {
  it("reporte le prorata sur la facture suivante au lieu de le perdre", async () => {
    const repo = createMemoryRepository({ seed: false });
    const { notifier } = notifierMuet();
    const facturation = createBillingService({ repo, notifier, logger: silencieux });
    const { etablissement, abonnement } = await terrain(repo);

    // Montée en gamme à mi-période. Le calcul existait déjà et s'affichait au
    // back-office ; il n'était simplement écrit nulle part, donc la facture
    // suivante ne le portait pas et le complément n'était jamais encaissé.
    const changement = await facturation.changePlan(
      abonnement.id,
      'pro',
      [],
      '2026-09-06T10:00:00.000Z',
    );
    expect(changement.prorationCents).not.toBe(0);

    await facturation.runBilling(MAINTENANT);
    const [facture] = await repo.invoices.listByEstablishment(etablissement.id);

    const prorata = facture!.lines.filter(
      (l) => l.kind === 'proration' || l.kind === 'credit',
    );
    expect(prorata.length).toBeGreaterThan(0);
    expect(facture!.lines.reduce((t, l) => t + l.totalCents, 0)).toBe(facture!.subtotalCents);
  });

  it('ne facture le même prorata qu’une seule fois', async () => {
    const repo = createMemoryRepository({ seed: false });
    const { notifier } = notifierMuet();
    const facturation = createBillingService({ repo, notifier, logger: silencieux });
    const { etablissement, abonnement } = await terrain(repo);

    await facturation.changePlan(abonnement.id, 'pro', [], '2026-09-06T10:00:00.000Z');
    await facturation.runBilling(MAINTENANT);
    // Le mois suivant : le prorata a déjà été porté, il ne doit pas revenir.
    await facturation.runBilling(addMonths(MAINTENANT, 1));

    const factures = await repo.invoices.listByEstablishment(etablissement.id);
    expect(factures).toHaveLength(2);

    const avecProrata = factures.filter((f) =>
      f.lines.some((l) => l.kind === 'proration' || l.kind === 'credit'),
    );
    expect(avecProrata).toHaveLength(1);
  });

  it('ne laisse aucune ligne en attente après facturation', async () => {
    const repo = createMemoryRepository({ seed: false });
    const { notifier } = notifierMuet();
    const facturation = createBillingService({ repo, notifier, logger: silencieux });
    const { abonnement } = await terrain(repo);

    await facturation.changePlan(abonnement.id, 'pro', [], '2026-09-06T10:00:00.000Z');
    expect(await repo.pendingLines.listPending(abonnement.id)).not.toHaveLength(0);

    await facturation.runBilling(MAINTENANT);

    // Une ligne consommée n'est pas supprimée, elle porte l'identifiant de
    // sa facture : c'est ce qui justifie le montant sur la pièce comptable.
    expect(await repo.pendingLines.listPending(abonnement.id)).toHaveLength(0);
  });
});

describe('modèle de période — comportement constaté, à trancher', () => {
  /**
   * Ces cas ne disent pas ce qui *devrait* se passer : ils fixent ce qui se
   * passe, pour que personne ne le change sans le vouloir.
   *
   * Le modèle est incohérent, et c'est constaté, pas supposé : la première
   * facture couvre le mois **à venir**, toutes les suivantes couvrent le mois
   * **écoulé**. Il en découle un trou de deux mois entre la première et la
   * deuxième facture, puis un décalage permanent d'un mois à l'encaissement.
   *
   * Aucun mois n'est facturé deux fois et aucun n'est oublié : ce n'est pas
   * une perte d'argent, c'est une base de facturation mixte. Trancher entre
   * « tout à échoir » et « tout à terme échu » engage le contrat client et la
   * trésorerie — ce n'est pas une décision technique, elle revient au
   * propriétaire. D'ici là, le comportement est verrouillé ici.
   */
  const souscrire = async (repo: Repository, debut: string) => {
    const { notifier } = notifierMuet();
    const facturation = createBillingService({ repo, notifier, logger: silencieux });
    const etablissement = await repo.establishments.create({
      id: generateId('est'),
      name: 'Client témoin',
      postalCode: '69001',
      sector: 'restaurant',
      plan: 'essentiel',
      addons: [],
      committed12Months: false,
      brandTone: 'professionnel et courtois',
      defaultLocale: 'fr',
      createdAt: debut,
    });
    await facturation.subscribe({
      establishmentId: etablissement.id,
      plan: 'essentiel',
      addons: [],
      extraPlatforms: 0,
      tags: 1,
      committed12Months: false,
      now: debut,
    });
    return { facturation, etablissement };
  };

  const DEBUT = '2026-01-10T12:00:00.000Z';

  it('facture la première période à échoir, les suivantes à terme échu', async () => {
    const repo = createMemoryRepository({ seed: false });
    const { facturation, etablissement } = await souscrire(repo, DEBUT);

    for (let mois = 1; mois <= 4; mois += 1) {
      await facturation.runBilling(addMonths(DEBUT, mois));
    }

    const factures = (await repo.invoices.listByEstablishment(etablissement.id)).sort((a, b) =>
      a.number.localeCompare(b.number),
    );

    const echue = (f: (typeof factures)[number]): boolean =>
      new Date(f.periodEnd).getTime() <= new Date(f.issuedAt).getTime();

    expect(echue(factures[0]!)).toBe(false); // à échoir
    expect(factures.slice(1).every(echue)).toBe(true); // toutes échues
  });

  it('laisse deux mois entre la première et la deuxième facture', async () => {
    const repo = createMemoryRepository({ seed: false });
    const { facturation, etablissement } = await souscrire(repo, DEBUT);

    for (let mois = 1; mois <= 4; mois += 1) {
      await facturation.runBilling(addMonths(DEBUT, mois));
    }

    const factures = (await repo.invoices.listByEstablishment(etablissement.id)).sort((a, b) =>
      a.number.localeCompare(b.number),
    );
    const jours = Math.round(
      (new Date(factures[1]!.issuedAt).getTime() - new Date(factures[0]!.issuedAt).getTime()) /
        86_400_000,
    );

    // Le client paie à la souscription, puis plus rien pendant deux mois. Il
    // le remarque, et c'est le genre d'anomalie qui fait douter d'une facture.
    expect(jours).toBeGreaterThan(50);
  });

  it('ne facture aucun mois deux fois, et n’en oublie aucun', async () => {
    const repo = createMemoryRepository({ seed: false });
    const { facturation, etablissement } = await souscrire(repo, DEBUT);

    for (let mois = 1; mois <= 6; mois += 1) {
      await facturation.runBilling(addMonths(DEBUT, mois));
    }

    const factures = (await repo.invoices.listByEstablishment(etablissement.id)).sort((a, b) =>
      a.periodStart.localeCompare(b.periodStart),
    );

    // Le point rassurant : la base est mixte, mais la couverture est
    // continue. Aucune periode a cheval, aucun mois saute.
    for (let i = 1; i < factures.length; i += 1) {
      expect(factures[i]!.periodStart).toBe(factures[i - 1]!.periodEnd);
    }
    expect(new Set(factures.map((f) => f.periodStart)).size).toBe(factures.length);
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
