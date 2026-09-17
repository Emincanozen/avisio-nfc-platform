/**
 * Identifiants publics des plaquettes.
 *
 * Contraintes : l'URL est gravée dans la puce NTAG213 (144 octets utiles), elle
 * doit donc rester courte ; elle est aussi lisible à l'œil sur le support
 * imprimé en cas de repli QR code, donc sans caractères ambigus (0/O, 1/l/I).
 */

const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';

export type RandomSource = (max: number) => number;

const defaultRandom: RandomSource = (max) => Math.floor(Math.random() * max);

/** Slug de plaquette : 8 caractères, ~2^39 combinaisons. */
export function generateSlug(length = 8, random: RandomSource = defaultRandom): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += ALPHABET[random(ALPHABET.length)];
  return out;
}

export function isValidSlug(slug: string): boolean {
  return /^[23456789abcdefghjkmnpqrstuvwxyz]{6,12}$/.test(slug);
}

/** URL encodée dans la puce. */
export function tagUrl(baseUrl: string, slug: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/s/${slug}`;
}

/**
 * Taille de l'URL en octets, comparée à la capacité utile d'un NTAG213.
 * Sert au contrôle qualité avant encodage d'un lot de plaquettes.
 */
export function fitsOnNtag213(url: string): boolean {
  // 144 octets utiles, moins ~7 octets d'en-tête NDEF pour un enregistrement URI.
  return new TextEncoder().encode(url).length <= 137;
}

/** Identifiant interne court et trié dans le temps (préfixe temporel). */
export function generateId(prefix: string, random: RandomSource = defaultRandom): string {
  const time = Date.now().toString(36);
  return `${prefix}_${time}${generateSlug(6, random)}`;
}
