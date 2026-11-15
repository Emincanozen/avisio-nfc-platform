/**
 * Scellement des secrets stockés en base.
 *
 * Un jeton de rafraîchissement Google donne accès à la fiche d'un client
 * jusqu'à révocation : le lire, c'est pouvoir répondre en son nom. Il ne doit
 * donc jamais reposer en clair dans une table, où une sauvegarde égarée, un
 * export de support ou une injection SQL le livrerait tel quel.
 *
 * AES-256-GCM : chiffrement et authentification en une passe. Le vecteur
 * d'initialisation est tiré au hasard à chaque scellement et transporté avec
 * le message ; l'étiquette d'authentification garantit qu'un enregistrement
 * modifié en base est refusé au déchiffrement plutôt que d'être interprété.
 *
 * La clé vient de `SECRETS_KEY`. À défaut, elle est dérivée de `JWT_SECRET` :
 * moins bien — les deux usages devraient être séparables — mais le produit
 * doit démarrer sans configuration, et un repli explicite vaut mieux qu'un
 * plantage au boot ou, pire, qu'un stockage en clair silencieux.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { env } from '../env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // taille recommandée pour GCM
const TAG_BYTES = 16;
const VERSION = 'v1';

let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;
  const material = env.secretsKey || env.jwtSecret;
  // Sel fixe : la dérivation doit être reproductible d'un redémarrage à
  // l'autre, sinon tous les jetons déjà scellés deviendraient illisibles.
  cachedKey = scryptSync(material, 'avisio.secrets.v1', 32);
  return cachedKey;
}

/**
 * Scelle une valeur. Le résultat est transportable en base en tant que texte :
 * `v1.<iv base64url>.<étiquette base64url>.<chiffré base64url>`.
 */
export function seal(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, b64(iv), b64(tag), b64(encrypted)].join('.');
}

/**
 * Ouvre une valeur scellée.
 *
 * Renvoie `null` plutôt que de lever : en pratique, un jeton illisible veut
 * dire que la clé a changé, et le bon comportement produit est de traiter la
 * connexion comme rompue — donc de redemander l'autorisation au client — pas
 * de faire tomber le cycle d'ingestion de tout le parc.
 */
export function open(sealed: string): string | null {
  try {
    const parts = sealed.split('.');
    if (parts.length !== 4 || parts[0] !== VERSION) return null;
    const iv = unb64(parts[1]!);
    const tag = unb64(parts[2]!);
    const payload = unb64(parts[3]!);
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;

    const decipher = createDecipheriv(ALGORITHM, key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(payload), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Vrai si la valeur a la forme d'un secret scellé par cette version. */
export function isSealed(value: string): boolean {
  return value.startsWith(`${VERSION}.`) && value.split('.').length === 4;
}

/**
 * Comparaison à durée constante de deux chaînes.
 *
 * Utilisée pour les jetons d'état OAuth : comparer avec `===` laisse fuir, par
 * le temps de réponse, la longueur du préfixe commun.
 */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

const b64 = (buffer: Buffer): string => buffer.toString('base64url');
const unb64 = (value: string): Buffer => Buffer.from(value, 'base64url');
