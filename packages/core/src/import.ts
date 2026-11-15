/**
 * Import manuel d'avis.
 *
 * Raison d'être : l'accès aux API partenaires se demande et s'attend. Entre le
 * jour où un client signe et le jour où Google approuve, l'import d'un export
 * de la plateforme est le seul chemin honnête pour alimenter le produit.
 *
 * Il est volontairement tenu à l'écart de la synchronisation : les avis
 * importés portent `source: 'import'`, et rien dans l'interface ne les
 * présente comme le fruit d'une connexion en direct. Un chiffre de tableau de
 * bord doit pouvoir être remonté à son origine.
 *
 * L'analyse est faite ici, sans dépendance, pour la même raison que le reste
 * du domaine : elle se teste sans monter de serveur ni lire de fichier.
 */

import type { PlatformId, Review } from './types.js';
import { PLATFORM_LABELS } from './routing.js';

/** Ligne acceptée, prête à devenir un avis. */
export interface ImportedRow {
  externalId: string;
  author: string;
  rating: number;
  comment: string;
  publishedAt: string;
  replyText?: string;
}

/** Ligne refusée, avec de quoi la corriger. */
export interface ImportRejection {
  /** Numéro de ligne dans le fichier, en-tête compris : ce que voit l'humain. */
  line: number;
  reason: string;
}

export interface ImportParseResult {
  rows: ImportedRow[];
  rejected: ImportRejection[];
  /** Colonnes trouvées, dans l'ordre du fichier. */
  columns: string[];
}

/** Colonnes attendues, et leurs synonymes tolérés. */
const COLUMN_ALIASES: Record<string, string[]> = {
  externalId: ['externalid', 'id', 'review_id', 'identifiant', 'reviewid'],
  author: ['author', 'auteur', 'reviewer', 'nom', 'name'],
  rating: ['rating', 'note', 'stars', 'etoiles', 'étoiles', 'starrating'],
  comment: ['comment', 'commentaire', 'avis', 'text', 'texte', 'review'],
  publishedAt: ['publishedat', 'date', 'createtime', 'published', 'datetime', 'created_at'],
  replyText: ['replytext', 'reponse', 'réponse', 'reply', 'owner_reply'],
};

export const IMPORT_TEMPLATE_HEADER = 'externalId,author,rating,comment,publishedAt,replyText';

/** Limite volontairement basse : un import se relit, il ne se subit pas. */
export const IMPORT_MAX_ROWS = 2000;

/**
 * Analyseur CSV.
 *
 * Écrit à la main plutôt qu'emprunté : les exports de plateformes contiennent
 * des commentaires à virgules, à guillemets et à retours à la ligne, et c'est
 * exactement là que les analyseurs naïfs — `split(',')` en tête — produisent
 * des avis tronqués sans rien signaler. Gère les guillemets doublés (`""`),
 * les retours à la ligne encadrés, le séparateur point-virgule et le BOM des
 * exports Excel français.
 */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const delimiter = detectDelimiter(text);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;

  const endField = (): void => {
    row.push(field);
    field = '';
  };
  const endRow = (): void => {
    endField();
    // Une ligne vide n'est pas une ligne de données : les exports en
    // produisent en fin de fichier, et les compter fausserait le rapport.
    if (row.some((cell) => cell.trim() !== '')) rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const char = text[i]!;

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"' && field === '') {
      quoted = true;
      i += 1;
      continue;
    }
    if (char === delimiter) {
      endField();
      i += 1;
      continue;
    }
    if (char === '\r') {
      i += 1;
      continue;
    }
    if (char === '\n') {
      endRow();
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }

  if (field !== '' || row.length > 0) endRow();
  return rows;
}

/**
 * Séparateur du fichier.
 *
 * Excel en configuration française écrit des point-virgules. Le deviner évite
 * de renvoyer à l'utilisateur un « une seule colonne trouvée » qu'il ne saurait
 * pas corriger.
 */
function detectDelimiter(text: string): string {
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'));
  const semicolons = (firstLine.match(/;/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  return semicolons > commas ? ';' : ',';
}

const normalize = (header: string): string =>
  header
    .trim()
    .toLowerCase()
    .replace(/[\s_-]/g, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/** Associe chaque champ attendu à son indice de colonne, ou -1. */
function mapColumns(header: string[]): Record<keyof typeof COLUMN_ALIASES, number> {
  const normalized = header.map(normalize);
  const mapping = {} as Record<string, number>;
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    mapping[field] = normalized.findIndex((h) => aliases.some((a) => normalize(a) === h));
  }
  return mapping;
}

/**
 * Lit une date d'export.
 *
 * Accepte l'ISO 8601 et le format français jour/mois/année, qui est ce que
 * produisent la plupart des exports destinés à un tableur. En cas de doute sur
 * l'ordre jour/mois, l'ISO l'emporte : on ne devine pas une date, on la refuse.
 */
export function parseImportDate(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})([T ](\d{2}):(\d{2})(:(\d{2}))?)?/.exec(value);
  if (iso) {
    const date = new Date(
      Date.UTC(
        Number(iso[1]),
        Number(iso[2]) - 1,
        Number(iso[3]),
        Number(iso[5] ?? 0),
        Number(iso[6] ?? 0),
        Number(iso[8] ?? 0),
      ),
    );
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  const fr = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})([ T](\d{1,2}):(\d{2}))?$/.exec(value);
  if (fr) {
    const day = Number(fr[1]);
    const month = Number(fr[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const date = new Date(
      Date.UTC(Number(fr[3]), month - 1, day, Number(fr[5] ?? 0), Number(fr[6] ?? 0)),
    );
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  return null;
}

/**
 * Lit une note.
 *
 * Tolère la virgule décimale et les libellés Google (`FIVE`, `FOUR`…) qu'on
 * retrouve tels quels dans les exports d'API.
 */
export function parseImportRating(raw: string): number | null {
  const value = raw.trim().toUpperCase();
  const words: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
  if (value in words) return words[value]!;

  const numeric = Number.parseFloat(value.replace(',', '.'));
  if (!Number.isFinite(numeric)) return null;
  const rounded = Math.round(numeric);
  return rounded >= 1 && rounded <= 5 ? rounded : null;
}

/**
 * Analyse un fichier d'import.
 *
 * Ne lève jamais : un fichier de mille lignes dont trois sont mauvaises doit
 * livrer neuf cent quatre-vingt-dix-sept avis et trois motifs de refus, pas un
 * message d'erreur global. C'est la différence entre un outil utilisable et un
 * outil qu'on abandonne.
 */
export function parseReviewImport(csv: string): ImportParseResult {
  const table = parseCsv(csv);
  if (table.length === 0) {
    return { rows: [], rejected: [{ line: 1, reason: 'Fichier vide.' }], columns: [] };
  }

  const header = table[0]!;
  const columns = header.map((h) => h.trim());
  const at = mapColumns(header);

  const missing = (['author', 'rating', 'comment', 'publishedAt'] as const).filter(
    (field) => at[field] === -1,
  );
  if (missing.length > 0) {
    return {
      rows: [],
      rejected: [
        {
          line: 1,
          reason: `Colonnes manquantes : ${missing.join(', ')}. En-tête attendu : ${IMPORT_TEMPLATE_HEADER}`,
        },
      ],
      columns,
    };
  }

  const rows: ImportedRow[] = [];
  const rejected: ImportRejection[] = [];
  const seen = new Set<string>();

  for (let index = 1; index < table.length; index += 1) {
    const line = index + 1;
    if (rows.length >= IMPORT_MAX_ROWS) {
      rejected.push({
        line,
        reason: `Au-delà de ${IMPORT_MAX_ROWS} lignes : découpez le fichier.`,
      });
      break;
    }

    const cells = table[index]!;
    const cell = (field: string): string => (at[field]! === -1 ? '' : (cells[at[field]!] ?? ''));

    const rating = parseImportRating(cell('rating'));
    if (rating === null) {
      rejected.push({ line, reason: `Note illisible : « ${cell('rating')} » (attendu 1 à 5).` });
      continue;
    }

    const publishedAt = parseImportDate(cell('publishedAt'));
    if (publishedAt === null) {
      rejected.push({
        line,
        reason: `Date illisible : « ${cell('publishedAt')} » (attendu AAAA-MM-JJ ou JJ/MM/AAAA).`,
      });
      continue;
    }

    // Une date future signale presque toujours une confusion jour/mois. Mieux
    // vaut la refuser que l'écrire : elle fausserait toutes les périodes.
    if (new Date(publishedAt).getTime() > Date.now() + 86_400_000) {
      rejected.push({ line, reason: `Date dans le futur : « ${cell('publishedAt')} ».` });
      continue;
    }

    const comment = cell('comment').trim();
    const author = cell('author').trim() || 'Client';

    // Un identifiant stable est ce qui rend l'import rejouable : sans lui, le
    // même fichier importé deux fois créerait deux fois les mêmes avis. À
    // défaut d'en fournir un, on en dérive un du contenu.
    const provided = cell('externalId').trim();
    const externalId = provided || syntheticId(author, publishedAt, comment);

    if (seen.has(externalId)) {
      rejected.push({ line, reason: `Doublon dans le fichier : identifiant « ${externalId} ».` });
      continue;
    }
    seen.add(externalId);

    const replyText = cell('replyText').trim();
    rows.push({
      externalId,
      author,
      rating,
      comment,
      publishedAt,
      ...(replyText ? { replyText } : {}),
    });
  }

  return { rows, rejected, columns };
}

/**
 * Identifiant dérivé du contenu.
 *
 * Condensat simple (FNV-1a) : il n'a pas besoin d'être cryptographique, juste
 * stable d'un import à l'autre pour que le dédoublonnage tienne.
 */
function syntheticId(author: string, publishedAt: string, comment: string): string {
  const seed = `${author}|${publishedAt}|${comment}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `imp-${hash.toString(36)}-${seed.length.toString(36)}`;
}

/** Convertit une ligne acceptée en avis du domaine. */
export function importedToReview(
  row: ImportedRow,
  establishmentId: string,
  platform: PlatformId,
  id: string,
  now: string,
): Review {
  return {
    id,
    establishmentId,
    platform,
    externalId: row.externalId,
    author: row.author,
    rating: row.rating,
    comment: row.comment,
    publishedAt: row.publishedAt,
    ingestedAt: now,
    // Le marquage est la raison d'être de ce champ : un avis importé ne doit
    // jamais pouvoir être présenté comme le produit d'une connexion en direct.
    source: 'import',
    status: row.replyText ? 'answered' : 'new',
    ...(row.replyText ? { replyText: row.replyText, repliedAt: row.publishedAt } : {}),
  };
}

/** Résumé d'un import, tel qu'il est rendu au gérant. */
export interface ImportSummary {
  platform: PlatformId;
  platformLabel: string;
  read: number;
  imported: number;
  duplicates: number;
  rejected: ImportRejection[];
}

export function describeImport(summary: ImportSummary): string {
  const parts = [`${summary.imported} avis importés sur ${summary.platformLabel}`];
  if (summary.duplicates > 0) {
    parts.push(`${summary.duplicates} déjà connus, ignorés`);
  }
  if (summary.rejected.length > 0) {
    parts.push(`${summary.rejected.length} ligne(s) refusée(s)`);
  }
  return `${parts.join(' · ')}.`;
}

export const platformLabel = (platform: PlatformId): string => PLATFORM_LABELS[platform];
