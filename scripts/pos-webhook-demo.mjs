/**
 * Simulateur de caisse.
 *
 * Reproduit exactement ce qu'un éditeur de logiciel de caisse doit implémenter :
 * signer le corps JSON avec la clé remise à l'installation, puis appeler le
 * webhook. Sert à vérifier l'intégration sans attendre le partenaire.
 *
 *   node scripts/pos-webhook-demo.mjs <clé> [establishmentId] [apiUrl]
 */

import { createHash, createHmac } from 'node:crypto';

const [secret, establishmentId = 'est_comptoir', apiUrl = 'http://localhost:4000'] =
  process.argv.slice(2);

if (!secret) {
  console.error(
    'Usage : node scripts/pos-webhook-demo.mjs <clé> [establishmentId] [apiUrl]\n' +
      'La clé est délivrée par POST /establishments/<id>/pos/credential.',
  );
  process.exit(1);
}

/**
 * Le serveur ne conserve pas la clé en clair : il stocke son condensat et
 * signe avec lui. La caisse fait donc la même dérivation avant de signer.
 */
const normalize = (value) => value.trim().toLowerCase().replace(/[\s.\-()]/g, '');
const secretHash = createHash('sha256')
  .update(`pos:${normalize(secret)}`)
  .digest('hex')
  .slice(0, 32);

const body = JSON.stringify({
  externalId: `TCK-${Date.now()}`,
  // Clôturé il y a trois heures : le délai d'attente de deux heures est passé,
  // l'invitation part immédiatement.
  closedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  totalCents: 6390,
  contact: `client.${Date.now()}@exemple.fr`,
  contactChannel: 'email',
  reference: 'Table 4',
});

const timestamp = String(Math.floor(Date.now() / 1000));
const signature = createHmac('sha256', secretHash)
  .update(`${timestamp}.${body}`)
  .digest('hex');

const response = await fetch(`${apiUrl}/integrations/pos/${establishmentId}`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-avisio-signature': signature,
    'x-avisio-timestamp': timestamp,
  },
  body,
});

console.log(`HTTP ${response.status}`);
console.log(JSON.stringify(await response.json(), null, 2));
