/**
 * Autotest des notifications.
 *
 * Répond à une question précise : « quand un client note l'établissement,
 * le gérant est-il réellement notifié ? »
 *
 * Le script joue à la fois le navigateur du gérant et le service de push du
 * constructeur (FCM, Mozilla…), en local :
 *
 *   Phase 1 — transport : une notification de test part-elle réellement,
 *   signée VAPID et chiffrée AES128GCM ?
 *   Phase 2 — bout en bout : un avis négatif qui arrive déclenche-t-il une
 *   alerte, puis une notification sur l'appareil du gérant ?
 *
 * Ce que ça ne vérifie pas : que Google ou Mozilla acceptent la requête. Cela
 * demande un vrai appareil, un vrai abonnement et un domaine en HTTPS.
 *
 *   node scripts/push-selftest.mjs [apiUrl]
 *
 * Le certificat local est auto-signé : l'API doit tourner avec
 * NODE_TLS_REJECT_UNAUTHORIZED=0 le temps du test, et seulement pour ce test.
 */

import { createServer } from 'node:https';
import { createECDH, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const apiUrl = process.argv[2] ?? 'http://localhost:4000';

// --- Certificat auto-signé pour le service de push local ------------------
const certDir = mkdtempSync(join(tmpdir(), 'avisio-push-'));
const keyPath = join(certDir, 'key.pem');
const certPath = join(certDir, 'cert.pem');

// Sous Windows, openssl est livré avec Git mais hors du PATH système, et il ne
// trouve pas sa configuration tout seul : on essaie les emplacements connus.
const OPENSSL_CANDIDATES = [
  'openssl',
  'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe',
  'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
  '/usr/bin/openssl',
];
const OPENSSL_CONFS = [
  process.env.OPENSSL_CONF,
  'C:\\Program Files\\Git\\usr\\ssl\\openssl.cnf',
  'C:\\Program Files\\Git\\mingw64\\ssl\\openssl.cnf',
  '/etc/ssl/openssl.cnf',
].filter(Boolean);

const generated = OPENSSL_CANDIDATES.some((binary) =>
  [...OPENSSL_CONFS, null].some((conf) => {
    try {
      execFileSync(
        binary,
        [
          'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
          '-keyout', keyPath, '-out', certPath,
          '-days', '1', '-subj', '/CN=127.0.0.1',
          '-addext', 'subjectAltName=IP:127.0.0.1',
        ],
        {
          stdio: 'ignore',
          env: conf ? { ...process.env, OPENSSL_CONF: conf } : process.env,
        },
      );
      return true;
    } catch {
      return false;
    }
  }),
);

if (!generated) {
  console.error(
    'openssl est requis pour ce test : il génère le certificat du service de push simulé.\n' +
      'Sous Windows, il est livré avec Git (C:\\Program Files\\Git\\mingw64\\bin).',
  );
  process.exit(1);
}

// --- Le « navigateur » du gérant fabrique ses clés d'abonnement -----------
const ecdh = createECDH('prime256v1');
ecdh.generateKeys();
const p256dh = ecdh.getPublicKey().toString('base64url');
const auth = randomBytes(16).toString('base64url');

// --- Le service de push simulé, en TLS comme l'exige la spécification -----
const received = [];
const pushService = createServer(
  { key: readFileSync(keyPath), cert: readFileSync(certPath) },
  (req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      received.push({
        method: req.method,
        headers: req.headers,
        bodyLength: Buffer.concat(chunks).length,
        at: new Date().toISOString(),
      });
      res.writeHead(201).end();
    });
  },
);

await new Promise((resolve) => pushService.listen(0, '127.0.0.1', resolve));
const endpoint = `https://127.0.0.1:${pushService.address().port}/push/appareil-de-test`;

const finish = (code) => {
  pushService.close();
  rmSync(certDir, { recursive: true, force: true });
  process.exit(code);
};

const call = async (path, options = {}) => {
  const response = await fetch(`${apiUrl}${path}`, options);
  return { status: response.status, body: await response.json().catch(() => null) };
};

// --- Connexion et enregistrement de l'appareil ----------------------------
const login = await call('/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'demo@avisio.fr', password: 'demo1234' }),
});
if (login.status !== 200) {
  console.error(`Connexion refusée (${login.status}). L'API tourne-t-elle sur ${apiUrl} ?`);
  finish(1);
}
const token = login.body.token;
const authHeader = { authorization: `Bearer ${token}` };

// Le déclenchement manuel de l'ingestion est réservé à l'exploitation : le
// jeton du gérant y reçoit un 403, et c'est le comportement attendu.
const adminLogin = await call('/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'admin@avisio.fr', password: 'admin1234' }),
});
if (adminLogin.status !== 200) {
  console.error("Le compte d'exploitation est introuvable : impossible de déclencher l'ingestion.");
  finish(1);
}
const adminHeader = { authorization: `Bearer ${adminLogin.body.token}` };

await call('/push/subscribe', {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...authHeader },
  body: JSON.stringify({ endpoint, keys: { p256dh, auth } }),
});

// S'assurer que le canal push est bien activé pour les avis négatifs.
await call('/establishments/est_comptoir/notifications', {
  method: 'PUT',
  headers: { 'content-type': 'application/json', ...authHeader },
  body: JSON.stringify({
    channels: {
      negative_review: ['email', 'push'],
      theme_trend: ['email'],
      weekly_digest: ['email'],
      monthly_report: ['email'],
      billing: ['email'],
    },
    // Heures calmes désactivées : sinon le push serait légitimement différé
    // et le test échouerait pour une bonne raison.
    quietHours: null,
    utcOffsetHours: 2,
  }),
});

console.log('Appareil du gérant enregistré.\n');

// --- Phase 1 : le transport ----------------------------------------------
console.log('PHASE 1 — une notification part-elle réellement ?');
const test = await call('/push/test', { method: 'POST', headers: authHeader });
await new Promise((resolve) => setTimeout(resolve, 1500));

if (received.length === 0) {
  console.error(
    '\nÉCHEC : aucune requête reçue.\n' +
      "Si le journal de l'API mentionne un certificat, relancez-la avec\n" +
      'NODE_TLS_REJECT_UNAUTHORIZED=0 : le certificat de ce test est auto-signé.',
  );
  finish(1);
}

const request = received[0];
const authorization = String(request.headers.authorization ?? '');
const transport = [
  ['Requête reçue par le service de push', request.method === 'POST'],
  ['Corps chiffré non vide', request.bodyLength > 0],
  ['Chiffrement AES128GCM', request.headers['content-encoding'] === 'aes128gcm'],
  ['Signature VAPID présente', authorization.startsWith('vapid ')],
  ['Clé publique du serveur transmise', authorization.includes('k=')],
  ['Jeton JWT signé transmis', authorization.includes('t=')],
  ['Durée de vie définie', Number(request.headers.ttl) > 0],
];
for (const [label, ok] of transport) console.log(`  ${ok ? 'OK  ' : 'KO  '} ${label}`);
console.log(`  → ${request.bodyLength} octets chiffrés livrés (delivered=${test.body?.delivered}).\n`);

// --- Phase 2 : le scénario réel ------------------------------------------
console.log('PHASE 2 — un avis négatif notifie-t-il le gérant ?');

const countAlerts = async (establishmentId) => {
  const { body } = await call(`/establishments/${establishmentId}/alerts?limit=100`, {
    headers: authHeader,
  });
  return Array.isArray(body) ? body.length : 0;
};

/**
 * L'avis négatif est injecté, pas attendu.
 *
 * La version précédente déclenchait des cycles d'ingestion jusqu'à ce que le
 * connecteur simulé veuille bien produire un avis négatif. Deux défauts : le
 * résultat dépendait du hasard, et sur une base comptant plus que les trois
 * établissements de démonstration, l'alerte tombait sur n'importe lequel —
 * donc pas sur celui dont ce script surveille le gérant. Le test échouait
 * alors en annonçant une panne qui n'existait pas.
 *
 * L'import d'un avis réel est déterministe, vise l'établissement voulu, et
 * exerce le même chemin d'alerte et de notification.
 */
const TARGET = 'est_comptoir';
const alertsBefore = await countAlerts(TARGET);
const pushesBefore = received.length;

const today = new Date().toISOString().slice(0, 10);
const externalId = `selftest-${Date.now()}`;
const csv = [
  'externalId,author,rating,comment,publishedAt,replyText',
  `${externalId},Autotest,1,"Service catastrophique, attente interminable et personne pour nous renseigner.",${today},`,
].join('\n');

const imported = await call(`/establishments/${TARGET}/reviews/import`, {
  method: 'POST',
  headers: { ...authHeader, 'content-type': 'application/json' },
  body: JSON.stringify({ platform: 'google', csv }),
});
if (imported.status !== 200) {
  console.log(`  (import refusé : ${imported.status} — ${imported.body?.error ?? 'sans motif'})`);
}

// Laisse le temps à la notification de partir : elle suit la création de
// l'alerte, elle ne la précède pas.
await new Promise((resolve) => setTimeout(resolve, 1500));

const newAlerts = (await countAlerts(TARGET)) - alertsBefore;
const newPushes = received.length - pushesBefore;

const scenario = [
  ["Avis négatif ingéré et analysé", (imported.body?.summary?.imported ?? 0) === 1],
  [
    `Alerte créée sur l'établissement visé`,
    newAlerts > 0 && (imported.body?.alertsCreated ?? 0) > 0,
  ],
  [`Notification poussée sur l'appareil du gérant`, newPushes > 0],
];
for (const [label, ok] of scenario) console.log(`  ${ok ? 'OK  ' : 'KO  '} ${label}`);

const failures = [...transport, ...scenario].filter(([, ok]) => !ok);

console.log('');
if (failures.length === 0) {
  console.log(
    'VERDICT : la chaîne fonctionne. Un avis négatif entrant crée une alerte et\n' +
      "notifie le gérant sur son appareil.\n\n" +
      "Portée exacte : l'avis est entré par l'import manuel, qui est un chemin de\n" +
      "production. Ce qui est prouvé va donc de l'entrée d'un avis jusqu'à la\n" +
      "notification chiffrée, sans simulation.\n\n" +
      "Ce qui ne l'est pas : la synchronisation automatique depuis Google, qui\n" +
      "attend l'accès à l'API Business Profile (voir docs/google.md), et la\n" +
      'livraison par le service de push de Google ou Mozilla, qui demande un vrai\n' +
      'appareil et un domaine en HTTPS.',
  );
} else {
  console.log(`VERDICT : ${failures.length} vérification(s) en échec.`);
}

finish(failures.length === 0 ? 0 : 1);
