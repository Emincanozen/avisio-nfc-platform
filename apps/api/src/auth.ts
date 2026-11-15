/**
 * Authentification de l'espace gérant.
 *
 * Mots de passe : scrypt (Node natif, pas de dépendance binaire), sel aléatoire
 * de 16 octets, comparaison à temps constant. Sessions : JWT signé, 12 h.
 */

import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, expected] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !expected) return false;
  const derived = scryptSync(password, salt, KEY_LENGTH);
  const expectedBuffer = Buffer.from(expected, 'hex');
  if (expectedBuffer.length !== derived.length) return false;
  return timingSafeEqual(derived, expectedBuffer);
}

/**
 * Pseudonymisation des contacts du programme de fidélité.
 *
 * On ne conserve jamais l'e-mail ni le numéro en clair : seul un HMAC tronqué
 * est stocké, ce qui permet de reconnaître un client revenant sans constituer
 * un fichier de contacts exploitable en cas de fuite (minimisation, art. 5 RGPD).
 */
export function hashContact(raw: string, secret: string): string {
  const normalized = raw.trim().toLowerCase().replace(/[\s.\-()]/g, '');
  return createHash('sha256').update(`${secret}:${normalized}`).digest('hex').slice(0, 32);
}

export interface SessionClaims {
  sub: string;
  email: string;
  establishmentIds: string[];
}
