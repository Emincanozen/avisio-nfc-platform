/**
 * Test de bout en bout sur une API en fonctionnement.
 *
 * Contrairement à la suite de tests, qui tourne sur l'adaptateur mémoire, ce
 * script interroge un serveur réel par le réseau. Il sert surtout à exercer
 * l'adaptateur PostgreSQL, que les tests ne touchent jamais.
 *
 *   node scripts/smoke-test.mjs [apiUrl]
 */

const apiUrl = process.argv[2] ?? 'http://localhost:4000';

let passed = 0;
const failures = [];

const call = async (path, options = {}) => {
  const { body, token, ...rest } = options;
  const response = await fetch(`${apiUrl}${path}`, {
    ...rest,
    headers: {
      ...(body == null ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(rest.headers ?? {}),
    },
    ...(body == null ? {} : { body: JSON.stringify(body) }),
  });
  const contentType = response.headers.get('content-type') ?? '';
  return {
    status: response.status,
    contentType,
    body: contentType.includes('json') ? await response.json().catch(() => null) : null,
    bytes: contentType.includes('json') ? 0 : (await response.arrayBuffer()).byteLength,
  };
};

const check = (label, condition, detail = '') => {
  if (condition) {
    passed += 1;
    console.log(`  OK   ${label}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`  KO   ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const section = (title) => console.log(`\n${title}`);

// ---------------------------------------------------------------------------

section('Santé');
const health = await call('/health');
check('/health répond', health.status === 200);
check(
  `persistance : ${health.body?.persistence}`,
  health.body?.persistence === 'prisma' || health.body?.persistence === 'memory',
);
const onPostgres = health.body?.persistence === 'prisma';

section('Authentification et rôles');
const owner = await call('/auth/login', {
  method: 'POST',
  body: { email: 'demo@avisio.fr', password: 'demo1234' },
});
check('connexion gérant', owner.status === 200 && owner.body?.token);
check('rôle owner', owner.body?.manager?.role === 'owner');
const ownerToken = owner.body?.token;

const admin = await call('/auth/login', {
  method: 'POST',
  body: { email: 'admin@avisio.fr', password: 'admin1234' },
});
check('connexion exploitant', admin.status === 200);
check('rôle admin', admin.body?.manager?.role === 'admin');
const adminToken = admin.body?.token;

/**
 * Adresse unique à chaque passage, et non celle du compte de démonstration.
 *
 * La limitation de débit verrouille un compte au bout de dix tentatives
 * ratées — c'est son travail. En tapant sur `demo@avisio.fr`, ce contrôle
 * finissait par verrouiller le compte dont tout le reste du test a besoin :
 * le passage suivant échouait partout, et le symptôme désignait n'importe
 * quoi sauf la cause.
 *
 * Une adresse inexistante prouve exactement la même chose — le refus en 401
 * sans révéler si le compte existe — sans effet de bord.
 */
const wrong = await call('/auth/login', {
  method: 'POST',
  body: { email: `inconnu-${Date.now()}@controle.test`, password: 'faux12345678' },
});
check('mot de passe invalide rejeté en 401', wrong.status === 401, `reçu ${wrong.status}`);

// Sans jeton, tout ce qui suit échouerait en cascade et le rapport final
// désignerait vingt défauts là où il n'y en a qu'un.
if (!ownerToken || !adminToken) {
  console.log('\nArrêt : impossible d’obtenir un jeton de session.');
  console.log(`  gérant : ${owner.status} · exploitant : ${admin.status}`);
  if (owner.status === 429 || admin.status === 429) {
    console.log('  Cause probable : budget de connexion épuisé. Réessayez dans 15 minutes.');
  }
  process.exit(1);
}

section('Cloisonnement');
check(
  'back-office refusé au gérant',
  (await call('/admin/overview', { token: ownerToken })).status === 403,
);
check(
  'back-office ouvert à l’exploitant',
  (await call('/admin/overview', { token: adminToken })).status === 200,
);
check(
  'établissement hors périmètre refusé',
  (await call('/establishments/est_inconnu/overview', { token: ownerToken })).status === 403,
);
check('sans jeton : refusé', (await call('/establishments')).status === 401);

section('Parcours NFC public');
const landing = await call('/public/tag/k7m2p9qa', {
  headers: { 'accept-language': 'es-ES,es;q=0.9' },
});
check('landing servie', landing.status === 200);
check('langue négociée en espagnol', landing.body?.locale === 'es');
check('mention de non-filtrage présente', Boolean(landing.body?.disclosure));
check('plaquette inconnue : 404', (await call('/public/tag/nexistepas')).status === 404);

const scan = await call('/public/tag/k7m2p9qa/scan', { method: 'POST' });
check('scan enregistré', scan.status === 200 && String(scan.body?.redirectUrl).startsWith('http'));

const loyalty = await call('/public/tag/k7m2p9qa/loyalty', {
  method: 'POST',
  body: { contact: `smoke.${Date.now()}@test.fr`, channel: 'email' },
});
check('points fidélité crédités', loyalty.status === 200 && loyalty.body?.balance === 10);

const widget = await call('/public/widget/est_comptoir');
check('widget avis servi', widget.status === 200 && Array.isArray(widget.body?.reviews));

section('Espace gérant');
const detail = await call('/establishments/est_comptoir', { token: ownerToken });
check('fiche établissement', detail.status === 200 && detail.body?.establishment?.name);
check('droits calculés', typeof detail.body?.features?.loyalty === 'boolean');

const overview = await call('/establishments/est_comptoir/overview', { token: ownerToken });
check('vue d’ensemble', overview.status === 200 && overview.body?.metrics?.total > 0);
check('courbe de scans sur 30 jours', overview.body?.scans?.byDay?.length === 30);
check('thèmes extraits', Array.isArray(overview.body?.themes) && overview.body.themes.length > 0);

const reviews = await call('/establishments/est_comptoir/reviews?maxRating=3&limit=5', {
  token: ownerToken,
});
check('avis négatifs listés', reviews.status === 200 && Array.isArray(reviews.body));

const tags = await call('/establishments/est_comptoir/tags', { token: ownerToken });
check('plaquettes listées', tags.status === 200 && tags.body?.length > 0);
check('URL encodable sur NTAG213', tags.body?.[0]?.fitsOnNtag213 === true);

const gating = await call('/establishments/est_comptoir/landing-config', {
  method: 'POST',
  token: ownerToken,
  body: { askRatingBeforeRedirect: true },
});
check(
  'tri par note refusé (conformité)',
  gating.status === 422 && gating.body?.code === 'compliance',
  `reçu ${gating.status}`,
);

section('Avis et réponses');

/**
 * Le test fournit lui-même l'avis qu'il va traiter.
 *
 * Il se contentait de chercher un avis négatif non traité dans le jeu de
 * données. Chaque passage en consomme un : le deuxième passage dans la même
 * base échouait donc en annonçant un défaut inexistant. Un test de
 * vérification qui dépend de l'état laissé par le précédent ne vérifie pas
 * grand-chose, et son échec fait chercher la panne au mauvais endroit.
 */
const besoin = await call('/establishments/est_hotel/reviews?maxRating=3&status=new&limit=1', {
  token: ownerToken,
});
if (!besoin.body?.[0]) {
  const aujourdhui = new Date().toISOString().slice(0, 10);
  await call('/establishments/est_hotel/reviews/import', {
    method: 'POST',
    token: ownerToken,
    body: {
      platform: 'google',
      csv: [
        'externalId,author,rating,comment,publishedAt',
        `smoke-${Date.now()},Contrôle,2,"Chambre bruyante et accueil expéditif.",${aujourdhui}`,
      ].join('\n'),
    },
  });
}

const negatives = await call('/establishments/est_hotel/reviews?maxRating=3&status=new&limit=1', {
  token: ownerToken,
});
const target = negatives.body?.[0];
if (target) {
  const suggestion = await call(`/reviews/${target.id}/suggest-reply`, {
    method: 'POST',
    token: ownerToken,
    body: {},
  });
  check('suggestion de réponse produite', suggestion.status === 200 && suggestion.body?.text);

  const published = await call(`/reviews/${target.id}/reply`, {
    method: 'POST',
    token: ownerToken,
    body: { text: suggestion.body?.text ?? 'Merci de votre retour, nous en tenons compte.' },
  });
  check('réponse publiée', published.status === 200 && published.body?.review?.status === 'answered');
} else {
  check('un avis négatif non traité existe', false, 'aucun avis à traiter trouvé');
}

section('Notifications');
const prefs = await call('/establishments/est_comptoir/notifications', { token: ownerToken });
check('préférences lues', prefs.status === 200 && prefs.body?.channels);

const saved = await call('/establishments/est_comptoir/notifications', {
  method: 'PUT',
  token: ownerToken,
  body: {
    channels: {
      negative_review: ['email'],
      theme_trend: ['email'],
      weekly_digest: ['email'],
      monthly_report: ['email'],
      billing: ['email'],
    },
    quietHours: { start: 22, end: 8 },
    utcOffsetHours: 2,
  },
});
check('préférences enregistrées', saved.status === 200);
const reread = await call('/establishments/est_comptoir/notifications', { token: ownerToken });
check(
  'préférences persistées',
  JSON.stringify(reread.body?.channels?.negative_review) === JSON.stringify(['email']),
);

section('Facturation');
const invoices = await call('/establishments/est_comptoir/invoices', { token: ownerToken });
check('factures listées', invoices.status === 200 && invoices.body?.length > 0);
check('montant formaté', String(invoices.body?.[0]?.totalLabel ?? '').includes('€'));

const pdf = await call(`/invoices/${invoices.body?.[0]?.id}/pdf`, { token: ownerToken });
check('PDF de facture généré', pdf.status === 200 && pdf.contentType.includes('pdf') && pdf.bytes > 1000);

const subscription = await call('/establishments/est_comptoir/subscription', { token: ownerToken });
check('abonnement lu', subscription.status === 200 && subscription.body?.monthlyCents > 0);

const report = await call('/establishments/est_comptoir/report.pdf', { token: ownerToken });
check('PDF du rapport généré', report.status === 200 && report.bytes > 1000);

section('Back-office');
const adminOverview = await call('/admin/overview', { token: adminToken });
check('indicateurs consolidés', adminOverview.status === 200);
check(
  `MRR non nul (${adminOverview.body?.mrrLabel})`,
  (adminOverview.body?.mrrCents ?? 0) > 0,
  'aucun abonnement chargé ?',
);
// Au moins les trois établissements du jeu de démonstration. Sur PostgreSQL,
// les exécutions précédentes de ce script en ont laissé d'autres : c'est la
// preuve que la persistance fonctionne, pas une anomalie.
check(
  `parc compté (${adminOverview.body?.establishments})`,
  (adminOverview.body?.establishments ?? 0) >= 3,
);

const parc = await call('/admin/establishments', { token: adminToken });
check(
  'parc listé avec MRR',
  parc.status === 200 && Array.isArray(parc.body) && parc.body.every((r) => r.mrrCents > 0),
);

const adminInvoices = await call('/admin/invoices', { token: adminToken });
check(
  'factures consolidées',
  adminInvoices.status === 200 && Array.isArray(adminInvoices.body) && adminInvoices.body.length > 0,
);

// `Array.isArray` plutôt qu'un simple `?? []` : une réponse d'erreur est un
// objet, et `.map` dessus faisait tomber le script d'un coup — on perdait
// alors tous les contrôles restants, y compris ceux qui auraient réussi.
const numbers = (Array.isArray(adminInvoices.body) ? adminInvoices.body : [])
  .map((i) => Number(String(i.number).slice(-6)))
  .sort((a, b) => a - b);
const gapless = numbers.every((n, i) => i === 0 || n === numbers[i - 1] + 1);
check('numérotation continue, sans trou', gapless, numbers.join(', '));

section('Traitements de fond');
for (const job of ['ingest', 'trends', 'billing', 'dunning', 'reports', 'push']) {
  const res = await call(`/admin/ops/${job}`, { method: 'POST', token: adminToken });
  const errors = res.body?.errors ?? [];
  check(`traitement « ${job} »`, res.status === 200 && errors.length === 0, errors.join(' | '));
}

section('Onboarding complet');
const suffix = Date.now();
const created = await call('/admin/establishments', {
  method: 'POST',
  token: adminToken,
  body: {
    establishment: {
      name: `Test Smoke ${suffix}`,
      sector: 'retail',
      postalCode: '31000',
      brandTone: 'sobre et direct',
      defaultLocale: 'fr',
    },
    subscription: {
      plan: 'premium',
      addons: [],
      extraPlatforms: 0,
      tags: 2,
      committed12Months: true,
    },
    manager: {
      name: 'Testeur',
      email: `smoke.${suffix}@test.fr`,
      password: 'motdepasse1',
    },
    googleReviewUrl: 'https://g.page/r/smoke/review',
    tagLabels: ['Caisse'],
  },
});
check('établissement créé', created.status === 200 && created.body?.establishment?.id);
check('facture initiale émise', String(created.body?.invoice?.number ?? '').startsWith('AVS-'));
check('plaquettes générées', created.body?.tags?.length === 2);

const newSlug = created.body?.tags?.[0]?.url?.split('/s/')?.[1];
check(
  'plaquette immédiatement scannable',
  newSlug ? (await call(`/public/tag/${newSlug}/scan`, { method: 'POST' })).status === 200 : false,
);
check(
  'nouveau gérant peut se connecter',
  (
    await call('/auth/login', {
      method: 'POST',
      body: { email: `smoke.${suffix}@test.fr`, password: 'motdepasse1' },
    })
  ).status === 200,
);

// ---------------------------------------------------------------------------

console.log(`\n${'='.repeat(60)}`);
console.log(`Persistance testée : ${onPostgres ? 'PostgreSQL (Prisma)' : 'mémoire'}`);
console.log(`${passed} vérification(s) passée(s), ${failures.length} en échec.`);
if (failures.length > 0) {
  console.log('\nÉchecs :');
  for (const failure of failures) console.log(`  - ${failure}`);
}
process.exit(failures.length === 0 ? 0 : 1);
