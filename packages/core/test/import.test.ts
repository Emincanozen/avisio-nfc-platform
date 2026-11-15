/**
 * Import manuel d'avis.
 *
 * Les cas testés ici viennent tous de ce que produisent réellement les exports
 * de plateformes et les tableurs : virgules dans les commentaires, guillemets
 * doublés, retours à la ligne encadrés, point-virgule français, BOM d'Excel.
 * Ce sont exactement les cas où un analyseur naïf tronque un avis sans rien
 * signaler — et un avis tronqué fausse une analyse de sentiment.
 */

import { describe, expect, it } from 'vitest';
import {
  IMPORT_MAX_ROWS,
  describeImport,
  importedToReview,
  parseCsv,
  parseImportDate,
  parseImportRating,
  parseReviewImport,
} from '../src/import.js';

const HEADER = 'externalId,author,rating,comment,publishedAt,replyText';

describe('analyse CSV', () => {
  it('garde les virgules contenues dans un champ entre guillemets', () => {
    const rows = parseCsv('a,b\n"un, deux",trois');
    expect(rows[1]).toEqual(['un, deux', 'trois']);
  });

  it('rend les guillemets doublés tels quels', () => {
    const rows = parseCsv('a\n"il a dit ""bonjour"""');
    expect(rows[1]).toEqual(['il a dit "bonjour"']);
  });

  it('accepte un retour à la ligne à l’intérieur d’un commentaire', () => {
    const rows = parseCsv('a,b\n"première ligne\nseconde ligne",x');
    expect(rows).toHaveLength(2);
    expect(rows[1]![0]).toBe('première ligne\nseconde ligne');
  });

  it('devine le point-virgule des exports Excel français', () => {
    const rows = parseCsv('nom;note\nMarie;5');
    expect(rows[1]).toEqual(['Marie', '5']);
  });

  it('avale le BOM que pose Excel en tête de fichier', () => {
    const rows = parseCsv('﻿externalId,author\nx,y');
    expect(rows[0]![0]).toBe('externalId');
  });

  it('ignore les lignes vides de fin de fichier', () => {
    expect(parseCsv('a,b\n1,2\n\n\n')).toHaveLength(2);
  });
});

describe('lecture des notes', () => {
  it('accepte les entiers et la virgule décimale', () => {
    expect(parseImportRating('4')).toBe(4);
    expect(parseImportRating('4,0')).toBe(4);
    expect(parseImportRating('3.7')).toBe(4);
  });

  it('accepte les libellés Google trouvés tels quels dans les exports', () => {
    expect(parseImportRating('FIVE')).toBe(5);
    expect(parseImportRating('one')).toBe(1);
  });

  it('refuse ce qui sort de l’échelle plutôt que de le ramener dedans', () => {
    // Écraser un 9 en 5 inventerait une donnée : mieux vaut le signaler.
    expect(parseImportRating('9')).toBeNull();
    expect(parseImportRating('0')).toBeNull();
    expect(parseImportRating('excellent')).toBeNull();
  });
});

describe('lecture des dates', () => {
  it('lit l’ISO 8601 avec ou sans heure', () => {
    expect(parseImportDate('2026-03-14')).toBe('2026-03-14T00:00:00.000Z');
    expect(parseImportDate('2026-03-14T09:30:00')).toBe('2026-03-14T09:30:00.000Z');
  });

  it('lit le format français jour/mois/année', () => {
    expect(parseImportDate('14/03/2026')).toBe('2026-03-14T00:00:00.000Z');
  });

  it('refuse un mois impossible plutôt que de deviner l’ordre', () => {
    // 14/03 est sans ambiguïté, 03/14 ne l'est pas : on refuse au lieu
    // d'inventer une date qui fausserait toutes les périodes du rapport.
    expect(parseImportDate('03/14/2026')).toBeNull();
    expect(parseImportDate('hier')).toBeNull();
  });
});

describe('import complet', () => {
  it('importe les lignes valides et explique chaque refus', () => {
    const csv = [
      HEADER,
      'r1,Marie D.,5,"Parfait, merci !",2026-03-01,',
      'r2,Paul T.,zero,Bof,2026-03-02,',
      'r3,Léa M.,4,Très bien,pas-une-date,',
      'r4,Yanis B.,2,"Trop d\'attente",02/03/2026,"Désolé."',
    ].join('\n');

    const result = parseReviewImport(csv);

    expect(result.rows.map((r) => r.externalId)).toEqual(['r1', 'r4']);
    expect(result.rejected).toHaveLength(2);
    expect(result.rejected[0]!.line).toBe(3);
    expect(result.rejected[0]!.reason).toContain('Note illisible');
    expect(result.rejected[1]!.reason).toContain('Date illisible');
  });

  it('livre ce qui est bon même quand une partie du fichier est mauvaise', () => {
    // C'est la différence entre un outil utilisable et un outil qu'on
    // abandonne : un fichier de mille lignes dont trois sont fausses doit
    // rendre neuf cent quatre-vingt-dix-sept avis, pas un message d'erreur.
    const lines = [HEADER];
    for (let i = 0; i < 50; i += 1) {
      lines.push(`r${i},Client ${i},${(i % 5) + 1},Commentaire ${i},2026-02-01,`);
    }
    lines.push('mauvais,Client X,nan,Texte,2026-02-01,');

    const result = parseReviewImport(lines.join('\n'));
    expect(result.rows).toHaveLength(50);
    expect(result.rejected).toHaveLength(1);
  });

  it('reconnaît les en-têtes français et les variantes', () => {
    const csv = ['Auteur;Note;Commentaire;Date', 'Marie;5;Parfait;01/02/2026'].join('\n');
    const result = parseReviewImport(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.author).toBe('Marie');
  });

  it('nomme les colonnes manquantes au lieu de refuser sans motif', () => {
    const result = parseReviewImport('auteur,note\nMarie,5');
    expect(result.rows).toHaveLength(0);
    expect(result.rejected[0]!.reason).toContain('comment');
    expect(result.rejected[0]!.reason).toContain('publishedAt');
  });

  it('dérive un identifiant stable quand le fichier n’en fournit pas', () => {
    // Sans identifiant stable, réimporter le même fichier créerait des
    // doublons. L'identifiant dérivé du contenu rend l'import rejouable.
    const csv = 'author,rating,comment,publishedAt\nMarie,5,Parfait,2026-01-01';
    const first = parseReviewImport(csv);
    const second = parseReviewImport(csv);
    expect(first.rows[0]!.externalId).toBe(second.rows[0]!.externalId);
    expect(first.rows[0]!.externalId).toMatch(/^imp-/);
  });

  it('refuse un doublon interne au fichier', () => {
    const csv = [HEADER, 'r1,A,5,Bien,2026-01-01,', 'r1,B,4,Bien aussi,2026-01-02,'].join('\n');
    const result = parseReviewImport(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.rejected[0]!.reason).toContain('Doublon');
  });

  it('refuse une date future, presque toujours une confusion jour/mois', () => {
    const future = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
    const result = parseReviewImport(`${HEADER}\nr1,A,5,Bien,${future},`);
    expect(result.rows).toHaveLength(0);
    expect(result.rejected[0]!.reason).toContain('futur');
  });

  it('borne le volume accepté', () => {
    const lines = [HEADER];
    for (let i = 0; i < IMPORT_MAX_ROWS + 10; i += 1) {
      lines.push(`r${i},Client,5,Bien,2026-01-01,`);
    }
    const result = parseReviewImport(lines.join('\n'));
    expect(result.rows).toHaveLength(IMPORT_MAX_ROWS);
    expect(result.rejected.at(-1)!.reason).toContain(String(IMPORT_MAX_ROWS));
  });

  it('refuse un fichier vide avec un motif lisible', () => {
    expect(parseReviewImport('').rejected[0]!.reason).toBe('Fichier vide.');
  });
});

describe('conversion en avis', () => {
  it('marque la provenance comme import, jamais comme synchronisation', () => {
    // C'est l'engagement de fond : aucun chiffre du produit ne doit laisser
    // croire à une connexion en direct qui n'existe pas.
    const [row] = parseReviewImport(`${HEADER}\nr1,Marie,5,Parfait,2026-01-01,`).rows;
    const review = importedToReview(row!, 'est_1', 'google', 'rev_1', '2026-02-01T00:00:00.000Z');
    expect(review.source).toBe('import');
  });

  it('considère comme répondu un avis qui porte déjà une réponse', () => {
    const [row] = parseReviewImport(`${HEADER}\nr1,Marie,2,Bof,2026-01-01,"Merci."`).rows;
    const review = importedToReview(row!, 'est_1', 'google', 'rev_1', '2026-02-01T00:00:00.000Z');
    expect(review.status).toBe('answered');
    expect(review.replyText).toBe('Merci.');
  });
});

describe('restitution', () => {
  it('résume un import en une phrase utilisable', () => {
    const text = describeImport({
      platform: 'google',
      platformLabel: 'Google',
      read: 12,
      imported: 9,
      duplicates: 2,
      rejected: [{ line: 5, reason: 'Note illisible' }],
    });
    expect(text).toContain('9 avis importés sur Google');
    expect(text).toContain('2 déjà connus');
    expect(text).toContain('1 ligne(s) refusée(s)');
  });
});
