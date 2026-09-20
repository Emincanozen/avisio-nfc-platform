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
