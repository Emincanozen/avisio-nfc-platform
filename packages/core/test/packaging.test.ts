/**
 * Contrat d'empaquetage de `@avisio/core`.
 *
 * Ce fichier existe à cause d'une panne réelle. `exports` pointait sur
 * `./src/index.ts` alors que `main` pointait sur `./dist/index.js` — et dans
 * la résolution ESM de Node, **`exports` gagne**. L'API compilée chargeait
 * donc du TypeScript, ce qui casse de deux façons selon la version de Node :
 *
 *  - avant 22.18 : `ERR_UNKNOWN_FILE_EXTENSION` sur le `.ts` ;
 *  - à partir de 22.18, Node dépouille les types tout seul, franchit
 *    `index.ts`, puis échoue sur `export * from './types.js'` — il n'existe
 *    pas de `src/types.js`, seulement `src/types.ts`. D'où le
 *    `ERR_MODULE_NOT_FOUND` observé en intégration continue.
 *
 * Rien dans la suite de tests ne pouvait l'attraper : Vitest lit la source, et
 * la panne ne se manifeste qu'en exécutant le JavaScript compilé. Le défaut a
 * donc voyagé jusqu'en intégration continue avec 317 tests verts.
 *
 * Ces contrôles lisent le manifeste tel qu'il est écrit. Ils ne remplacent pas
 * l'exécution réelle de l'API compilée — c'est le rôle du job PostgreSQL —
 * mais ils rendent la régression impossible à committer sans la voir.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const racine = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const manifeste = JSON.parse(readFileSync(join(racine, 'package.json'), 'utf8')) as {
  main?: string;
  types?: string;
  exports?: Record<string, Record<string, string>>;
};

describe('manifeste du paquet', () => {
  it('expose du JavaScript compilé par défaut', () => {
    // LE contrôle. Un consommateur qui n'active aucune condition — c'est le
    // cas de Node en production — doit recevoir du .js exécutable.
    const defaut = manifeste.exports?.['.']?.default;
    expect(defaut).toBe('./dist/index.js');
    expect(defaut).not.toMatch(/\.ts$/);
  });

  it('expose les déclarations de types depuis dist', () => {
    expect(manifeste.exports?.['.']?.types).toBe('./dist/index.d.ts');
  });

  it('garde la source accessible sous la condition development', () => {
    // Sans elle, tsx et Vitest exigeraient une compilation préalable : on
    // modifierait le domaine et on testerait l'ancien code compilé.
    expect(manifeste.exports?.['.']?.development).toBe('./src/index.ts');
  });

  it('accorde main et exports sur la même cible', () => {
    // Leur désaccord est précisément ce qui a produit la panne : `main`
    // annonçait dist, `exports` livrait src, et seul `exports` compte.
    expect(manifeste.main).toBe(manifeste.exports?.['.']?.default);
  });

  it('ne laisse aucune entrée publique pointer vers du TypeScript hors development', () => {
    for (const [chemin, conditions] of Object.entries(manifeste.exports ?? {})) {
      for (const [condition, cible] of Object.entries(conditions)) {
        if (condition === 'development' || condition === 'types') continue;
        expect(cible, `${chemin} → ${condition}`).not.toMatch(/\.ts$/);
      }
    }
  });
});

describe('convention des imports internes', () => {
  it('importe les modules voisins avec une extension .js', () => {
    // TypeScript en ESM veut l'extension de la sortie, pas celle de l'entrée :
    // `./types.js` et non `./types.ts`. C'est ce qui rend le JavaScript
    // compilé exécutable — et ce qui rend la source inexécutable telle quelle,
    // donc ce qui impose que `exports` livre bien `dist`.
    const src = join(racine, 'src');
    const fautifs: string[] = [];

    for (const nom of readdirSync(src).filter((f) => f.endsWith('.ts'))) {
      const contenu = readFileSync(join(src, nom), 'utf8');
      for (const ligne of contenu.split('\n')) {
        const relatif = /from '(\.[^']*)'/.exec(ligne);
        if (!relatif) continue;
        const cible = relatif[1]!;
        // Un import de type pur disparaît à la compilation : il échappe à la
        // règle sans conséquence à l'exécution.
        if (/^\s*import type /.test(ligne) || /^\s*export type /.test(ligne)) continue;
        if (!cible.endsWith('.js')) fautifs.push(`${nom} — ${cible}`);
      }
    }

    expect(fautifs).toEqual([]);
  });
});
