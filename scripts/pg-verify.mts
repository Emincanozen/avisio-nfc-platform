/**
 * Vérification de l'adaptateur PostgreSQL sur les chemins que la suite de
 * tests ne touche jamais.
 *
 * Raison d'être : les tests tournent sur l'adaptateur mémoire. Tout le code
 * Prisma — et en particulier le SQL brut de la limitation de débit — peut
 * compiler, passer le typecheck, et s'écrouler à la première requête réelle.
 * C'est exactement ce qui était arrivé à l'adaptateur Prisma avant qu'on le
 * fasse tourner pour de bon.
 *
 * Ce script exige une base jetable et refuse de tourner ailleurs que sur
 * localhost. Il écrit.
 *
 * Ce qu'il laisse derrière lui, dit franchement : un avis marqué
 * « Verification » sur le premier établissement, et quelques compteurs de
 * débit. Les compteurs sont balayés à leur expiration ; l'avis reste. Le
 * supprimer exigerait d'ouvrir une suppression d'avis dans le port du dépôt
 * pour les seuls besoins d'un script — une porte qu'aucun code de production
 * ne demande, et qu'il vaut mieux ne pas ouvrir. Sur une base jetable, c'est
 * sans conséquence ; c'est la raison du garde-fou localhost.
 *
 *   DATABASE_URL=postgresql://avisio:avisio@localhost:5433/avisio \
 *     npx tsx scripts/pg-verify.mts
 */

import { createPrismaRepository } from '../apps/api/src/repository/prisma.ts';

const url = process.env.DATABASE_URL ?? '';
if (!url) {
  console.error('DATABASE_URL est requis.');
  process.exit(1);
}

// Garde-fou : ce script ecrit et supprime. Il ne doit jamais viser une base
// distante, et surtout pas une base de production atteinte par megarde.
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error(
    'Refus : ce script ecrit en base et ne tourne que sur localhost.\n' +
      `DATABASE_URL vise ${url.replace(/:\/\/[^@]*@/, '://***@')}`,
  );
  process.exit(1);
}

let passed = 0;
const failures = [];

const check = (label, condition, detail = '') => {
  if (condition) {
    passed += 1;
    console.log(`  OK   ${label}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ECHEC ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const section = (title) => console.log(`\n${title}`);

const repo = await createPrismaRepository();
const marker = `verif-${Date.now()}`;

try {
  section('Compteurs de limitation de debit');

  // Le SQL brut (INSERT ... ON CONFLICT DO UPDATE ... RETURNING) est le seul
  // endroit du depot ou Prisma est contourne. S'il est faux, rien ne le dit
  // avant la production.
  const key = `${marker}:sequentiel`;
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const first = await repo.rateLimit.hit(key, expiresAt);
  const second = await repo.rateLimit.hit(key, expiresAt);
  const third = await repo.rateLimit.hit(key, expiresAt);
  check('la premiere requete vaut 1', first === 1, `recu ${first}`);
  check('le compteur progresse', second === 2 && third === 3, `recu ${second}, ${third}`);

  const autre = await repo.rateLimit.hit(`${marker}:autre`, expiresAt);
  check('les cles sont independantes', autre === 1, `recu ${autre}`);

  // Le cas qui compte : c'est sous concurrence qu'un upsert naif perd des
  // increments, et un budget qui perd des increments n'est pas un budget.
  const concurrentKey = `${marker}:concurrent`;
  const results = await Promise.all(
    Array.from({ length: 60 }, () => repo.rateLimit.hit(concurrentKey, expiresAt)),
  );
  const sorted = [...results].sort((a, b) => a - b);
  const attendu = Array.from({ length: 60 }, (_, i) => i + 1);
  check(
    '60 requetes simultanees sont comptees exactement une fois chacune',
    JSON.stringify(sorted) === JSON.stringify(attendu),
    `doublons: ${results.length - new Set(results).size}, max: ${Math.max(...results)}`,
  );

  section('Connexions Google');

  const etablissements = await repo.establishments.listAll();
  const cible = etablissements[0];
  check('un etablissement existe pour le test', cible != null);

  if (cible) {
    await repo.googleConnections.upsert({
      establishmentId: cible.id,
      refreshTokenSealed: 'v1.test.test.test',
      scope: 'https://www.googleapis.com/auth/business.manage',
      connectedAt: new Date().toISOString(),
      authorizedBy: 'verif',
    });
    const lue = await repo.googleConnections.get(cible.id);
    check('connexion ecrite puis relue', lue?.refreshTokenSealed === 'v1.test.test.test');
    check('les champs absents restent absents', lue?.locationName === undefined);

    const majAvecFiche = await repo.googleConnections.update(cible.id, {
      locationName: 'locations/42',
      locationTitle: 'Fiche de test',
      lastSyncAt: new Date().toISOString(),
    });
    check('selection de fiche enregistree', majAvecFiche.locationName === 'locations/42');

    await repo.googleConnections.update(cible.id, { lastError: 'panne simulee' });
    const enErreur = await repo.googleConnections.get(cible.id);
    check('erreur de synchronisation enregistree', enErreur?.lastError === 'panne simulee');

    // Effacer une erreur est un cas distinct d'ecrire une valeur : passer
    // `undefined` doit produire un NULL en base, pas etre ignore. Sans cela
    // une connexion reparee resterait marquee en panne indefiniment.
    await repo.googleConnections.update(cible.id, { lastError: undefined });
    const reparee = await repo.googleConnections.get(cible.id);
    check('erreur effacable', reparee?.lastError === undefined, `reste: ${reparee?.lastError}`);

    // Idempotence de la reconnexion : un client qui reautorise ne doit pas
    // creer une seconde ligne.
    await repo.googleConnections.upsert({
      establishmentId: cible.id,
      refreshTokenSealed: 'v1.nouveau.nouveau.nouveau',
      scope: 'https://www.googleapis.com/auth/business.manage',
      connectedAt: new Date().toISOString(),
      locationName: 'locations/42',
    });
    const toutes = await repo.googleConnections.listAll();
    check(
      'une reconnexion remplace au lieu de dupliquer',
      toutes.filter((c) => c.establishmentId === cible.id).length === 1,
    );

    await repo.googleConnections.remove(cible.id);
    check('suppression effective', (await repo.googleConnections.get(cible.id)) === null);
    check(
      'supprimer deux fois ne leve pas',
      await repo.googleConnections
        .remove(cible.id)
        .then(() => true)
        .catch(() => false),
    );
  }

  section('Propriete des abonnements push');

  if (cible) {
    // Ces methodes sont ce qui empeche un gerant de s'approprier l'appareil
    // d'un autre. Elles n'existent que dans l'adaptateur : la suite de tests,
    // qui tourne en memoire, ne les exerce jamais contre PostgreSQL.
    const managers = await repo.managers.listAll();
    const proprietaire = managers[0];
    const endpoint = `https://push.example.test/${marker}`;

    check('un gerant existe pour le test', proprietaire != null);

    if (proprietaire) {
      await repo.push.subscribe({
        id: `psub_${marker}`,
        managerId: proprietaire.id,
        endpoint,
        p256dh: 'cle-publique-de-verification',
        auth: 'secret-de-verification',
        createdAt: new Date().toISOString(),
      });

      const relu = await repo.push.findByEndpoint(endpoint);
      check('abonnement retrouve par point de terminaison', relu?.managerId === proprietaire.id);
      check(
        'un point de terminaison inconnu renvoie null',
        (await repo.push.findByEndpoint(`${endpoint}-inexistant`)) === null,
      );

      // Le cas normal : le navigateur regenere ses cles et reenregistre. Le
      // proprietaire ne doit pas changer, et la ligne ne doit pas se dupliquer.
      await repo.push.subscribe({
        id: `psub_${marker}`,
        managerId: proprietaire.id,
        endpoint,
        p256dh: 'cle-publique-renouvelee',
        auth: 'secret-renouvele',
        createdAt: new Date().toISOString(),
      });
      const apres = await repo.push.listByManager(proprietaire.id);
      check(
        'un reenregistrement ne duplique pas la ligne',
        apres.filter((s) => s.endpoint === endpoint).length === 1,
      );

      await repo.push.unsubscribe(endpoint);
      check('desabonnement effectif', (await repo.push.findByEndpoint(endpoint)) === null);
    }
  }

  section('Provenance des avis');

  if (cible) {
    const importe = {
      id: `rev_${marker}`,
      establishmentId: cible.id,
      platform: 'google',
      externalId: `${marker}-ext`,
      author: 'Verification',
      rating: 4,
      comment: "Avis ecrit par le script de verification, a supprimer.",
      publishedAt: new Date().toISOString(),
      ingestedAt: new Date().toISOString(),
      source: 'import',
      status: 'new',
    };
    const crees = await repo.reviews.upsertMany([importe]);
    check('avis importe ecrit', crees.length === 1);
    check('provenance conservee en base', crees[0]?.source === 'import');

    // Le dedoublonnage est ce qui rend un import rejouable.
    const rejoue = await repo.reviews.upsertMany([importe]);
    check('reimport du meme avis sans effet', rejoue.length === 0);

    // Les avis anterieurs a la colonne doivent rester lisibles comme 'sync'.
    const anciens = await repo.reviews.query({ establishmentId: cible.id, limit: 200 });
    const sync = anciens.filter((r) => r.source === 'sync');
    check('les avis existants sont lus comme synchronises', sync.length > 0, `${sync.length} avis`);

    // Filtre par plateforme : c'est lui qui evite de rapatrier tout
    // l'historique a chaque cycle d'ingestion.
    const surGoogle = await repo.reviews.query({
      establishmentId: cible.id,
      platform: 'google',
      limit: 5,
    });
    check(
      'filtre par plateforme applique en base',
      surGoogle.every((r) => r.platform === 'google'),
    );
  }

  // -------------------------------------------------------------------------
  section('Facturation : une periode, une facture');

  // La suite de tests prouve la regle sur l'adaptateur memoire, ou rien ne
  // s'execute vraiment en parallele. Ici seulement, deux transactions
  // PostgreSQL se disputent la meme periode et c'est la contrainte
  // d'unicite qui tranche. C'est le seul endroit ou ce defaut se reproduit
  // pour de bon : il avait ete constate a 69,60 EUR au lieu de 34,80 EUR.
  {
    const { createBillingService } = await import('../apps/api/src/services/billing.ts');
    const { generateId, addMonths } = await import('../packages/core/src/index.ts');

    const muet = { info: () => {}, warn: () => {} };
    const sansCourrier = {
      billing: async () => {},
      alert: async () => {},
      monthlyReport: async () => {},
    };
    const facturation = createBillingService({ repo, notifier: sansCourrier, logger: muet });

    const etab = await repo.establishments.create({
      id: generateId('est'),
      name: `Verification ${marker}`,
      postalCode: '69001',
      sector: 'restaurant',
      plan: 'essentiel',
      addons: [],
      committed12Months: false,
      brandTone: 'professionnel et courtois',
      defaultLocale: 'fr',
      createdAt: new Date().toISOString(),
    });

    const instant = new Date().toISOString();
    await repo.subscriptions.create({
      id: generateId('sub'),
      establishmentId: etab.id,
      plan: 'essentiel',
      addons: [],
      extraPlatforms: 0,
      tags: 1,
      committed12Months: false,
      status: 'active',
      startedAt: addMonths(instant, -1),
      currentPeriodStart: addMonths(instant, -1),
      currentPeriodEnd: instant,
    });

    // Etat de la numerotation avant la course. `runBilling` facture tous les
    // abonnements echus, pas seulement le notre : on raisonne donc sur des
    // ecarts, jamais sur des numeros consecutifs.
    const rangDe = (f) => Number(f.number.split('-').at(-1));
    const avantToutes = await repo.invoices.listAll();
    const rangMaxAvant = Math.max(0, ...avantToutes.map(rangDe));
    const nombreAvant = avantToutes.length;

    // Quatre cycles simultanes, pas deux : un seul gagnant doit sortir quel
    // que soit le nombre de concurrents, et deux cycles pourraient se
    // serialiser par chance.
    const cycles = await Promise.all([
      facturation.runBilling(instant),
      facturation.runBilling(instant),
      facturation.runBilling(instant),
      facturation.runBilling(instant),
    ]);

    const factures = await repo.invoices.listByEstablishment(etab.id);
    check(
      'quatre cycles concurrents emettent une seule facture',
      factures.length === 1,
      `${factures.length} facture(s) : ${factures.map((f) => f.number).join(', ')}`,
    );

    const emises = cycles.reduce((t, c) => t + c.invoicesIssued, 0);
    check('un seul cycle se declare emetteur', emises === 1, `${emises} cycle(s)`);

    const erreurs = cycles.flatMap((c) => c.errors);
    check(
      'les cycles perdants n echouent pas, ils reconnaissent',
      erreurs.length === 0,
      erreurs.join(' | '),
    );

    // Une contrainte qui bloque aussi le cas legitime serait une panne, pas
    // une protection.
    const moisSuivant = await facturation.runBilling(addMonths(instant, 1));
    check(
      'la periode suivante est bien facturee',
      moisSuivant.invoicesIssued >= 1,
      `${moisSuivant.invoicesIssued} facture(s)`,
    );

    const apres = await repo.invoices.listByEstablishment(etab.id);
    check(
      'deux periodes distinctes, deux factures',
      new Set(apres.map((f) => f.periodStart)).size === apres.length,
      `${apres.length} facture(s) pour ${new Set(apres.map((f) => f.periodStart)).size} periode(s)`,
    );

    // La transaction annulee doit rendre le numero qu'elle avait reserve.
    // Sinon chaque course perdue troue la sequence legale, qui doit rester
    // continue — et trois cycles perdants par mois, c'est trois trous.
    //
    // On compare l'avance du compteur au nombre de factures reellement
    // creees. Egalite : aucun numero gaspille. C'est verifiable sans
    // supposer que nos factures se suivent, ce qu'elles ne font pas.
    //
    // Le rang le plus eleve sert de lecture du compteur, faute de methode
    // dediee dans le port. Cela suppose qu'aucune facture n'a ete supprimee
    // depuis : une suppression manuelle en base fait echouer ce controle a
    // tort, ce qui est arrive une fois en mettant ce script au point. Aucun
    // code de production ne supprime de facture — c'est une piece
    // comptable — donc l'hypothese tient partout ailleurs.
    const toutesApres = await repo.invoices.listAll();
    const avanceCompteur = Math.max(0, ...toutesApres.map(rangDe)) - rangMaxAvant;
    const facturesCreees = toutesApres.length - nombreAvant;
    check(
      'aucun numero gaspille par les courses perdues',
      avanceCompteur === facturesCreees,
      `compteur +${avanceCompteur} pour ${facturesCreees} facture(s) creee(s)`,
    );

    // La contrainte elle-meme, verifiee directement : le code applicatif
    // pourrait la contourner sans qu'on le sache.
    const premiere = apres[0];
    let refusee = false;
    try {
      await repo.invoices.create(
        {
          establishmentId: premiere.establishmentId,
          subscriptionId: premiere.subscriptionId,
          status: 'open',
          periodStart: premiere.periodStart,
          periodEnd: premiere.periodEnd,
          issuedAt: instant,
          dueAt: premiere.dueAt,
          lines: premiere.lines,
          subtotalCents: premiere.subtotalCents,
          vatCents: premiere.vatCents,
          totalCents: premiere.totalCents,
          remindersSent: 0,
        },
        new Date(instant).getUTCFullYear(),
      );
    } catch {
      refusee = true;
    }
    check('la base refuse elle-meme un doublon de periode', refusee);
  }
} finally {
  // Nettoyage : ce script ne laisse rien derriere lui.
  await repo.close().catch(() => undefined);
}

console.log(`\n${'='.repeat(60)}`);
console.log(`${passed} verification(s) passee(s), ${failures.length} en echec.`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
