/**
 * Écriture française des nombres.
 *
 * Ce fichier existe pour une raison précise : l'incohérence se réinstalle
 * toute seule. `toFixed` est la fonction la plus naturelle sous la main, elle
 * produit toujours un point décimal, et rien dans le typage ne le signale.
 * Le défaut est revenu deux fois dans ce dépôt — d'abord sur le tableau de
 * bord (« 3.89 »), puis dans les messages de tendance (« 1.4/5 »).
 *
 * Le dernier test de ce fichier est le seul qui empêche la troisième fois.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fr, frPercent, frSigned } from '../src/format.js';
import { detectThemeTrends } from '../src/trends.js';
import { computeBenchmark } from '../src/benchmark.js';
import type { Review } from '../src/types.js';

describe('écriture des nombres', () => {
  it('sépare les décimales par une virgule', () => {
    expect(fr(3.62)).toBe('3,62');
    expect(fr(1.4, 1)).toBe('1,4');
  });

  it('groupe les milliers à la française', () => {
    // Espace insécable étroite (U+202F), pas une espace ordinaire.
    expect(fr(1516)).toMatch(/^1[\s  ]516,00$/);
  });

  it('utilise le vrai signe moins, pas le trait d’union', () => {
    // U+2212. Le trait d'union du clavier est plus court et se confond avec
    // une césure en fin de ligne, ce qui se voit sur un écart affiché en gras.
    expect(frSigned(-1.09)).toBe('−1,09');
    expect(frSigned(1.09)).toBe('+1,09');
    expect(frSigned(0)).toBe('0,00');
  });

  it('écrit les pourcentages avec une espace avant le signe', () => {
    expect(frPercent(0.1026, 2)).toBe('10,26 %');
  });
});

describe('textes destinés au gérant', () => {
  const review = (rating: number, comment: string, daysAgo: number): Review => ({
    id: `rev_${daysAgo}_${rating}_${comment.length}`,
    establishmentId: 'est_1',
    platform: 'google',
    externalId: `ext_${daysAgo}_${rating}_${comment.length}`,
    author: 'Client',
    rating,
    comment,
    publishedAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
    ingestedAt: new Date().toISOString(),
    status: 'new',
    analysis: {
      sentiment: rating >= 4 ? 'positive' : 'negative',
      score: rating >= 4 ? 0.7 : -0.7,
      themes: ['attente'],
      keywords: ['attente'],
      language: 'fr',
      engine: 'heuristic',
    },
  });

  it('écrit la note moyenne d’une tendance en français', () => {
    const reviews = [
      ...Array.from({ length: 6 }, (_, i) => review(1, `Attente trop longue ${i}`, i)),
      ...Array.from({ length: 12 }, (_, i) => review(5, `Service rapide ${i}`, 12 + i)),
    ];

    const trends = detectThemeTrends(reviews);
    const messages = trends.map((t) => t.message).join(' ');
    // Un message d'alerte lu à côté d'un tableau de bord en français ne doit
    // pas afficher « 1.4/5 ».
    expect(messages).not.toMatch(/\d+\.\d+\/5/);
  });

  it('écrit le résumé du benchmark en français', () => {
    const peers = Array.from({ length: 8 }, (_, i) => ({
      establishmentId: `est_peer_${i}`,
      sector: 'restaurant',
      postalCode: '31200',
      averageRating: 3.5 + i * 0.1,
      reviewCount: 40,
      monthlyReviews: 6,
      replyRate: 0.7,
    }));

    const result = computeBenchmark(
      {
        establishmentId: 'est_1',
        sector: 'restaurant',
        postalCode: '31200',
        averageRating: 4.21,
        reviewCount: 50,
        monthlyReviews: 8,
        replyRate: 0.9,
      },
      peers,
    );

    expect(result).not.toBeNull();
    expect(result!.summary).not.toMatch(/\d+\.\d+/);
  });
});

describe('garde-fou', () => {
  it("n'utilise pas toFixed dans du texte destiné à un francophone", () => {
    // Le test qui compte. `toFixed` produit toujours un point décimal, quelle
    // que soit la locale : ce n'est pas un problème de configuration, c'est
    // une fonction à ne pas employer pour du texte lisible par un client.
    //
    // Les usages légitimes restent possibles — arrondir avant `Number()`, ou
    // produire une valeur machine — et sont reconnus ci-dessous. Si ce test
    // gêne un usage réellement légitime, élargir l'exception plutôt que de
    // supprimer le contrôle.
    const dir = new URL('../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    const coupables: string[] = [];

    for (const nom of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const contenu = readFileSync(join(dir, nom), 'utf8');
      contenu.split('\n').forEach((ligne, index) => {
        if (!ligne.includes('.toFixed(')) return;

        // Valeur machine : convertie en nombre juste après, ou arrondi entier.
        const machine =
          /Number\(/.test(ligne) || /toFixed\(0\)/.test(ligne) || ligne.trim().startsWith('*');
        // Déjà rendu en français à la main.
        const corrige = /replace\('\.', ','\)/.test(ligne);

        if (!machine && !corrige) {
          coupables.push(`${nom}:${index + 1} — ${ligne.trim().slice(0, 90)}`);
        }
      });
    }

    expect(coupables).toEqual([]);
  });
});
