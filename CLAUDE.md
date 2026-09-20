# CLAUDE.md — instructions de travail sur Avisio

Lire aussi `memory.md` (état réel, décisions, tâches en cours) et `cloud.md`
(guide technique complet). **Avant toute modification d'architecture, lire
`cloud.md` et `docs/architecture.md`.**

---

## Le produit

Avisio : portail de collecte et de pilotage des avis clients par plaquette
NFC, vendu en abonnement aux établissements de proximité (restauration,
hôtellerie, commerce, beauté, santé). Trois offres : 29 € / 79 € / 149 € par
mois.

Le client final approche son téléphone d'une plaquette, une page s'ouvre, il
tape une fois, il est sur la plateforme d'avis. Côté gérant : alerte sur les
avis négatifs, réponse rédigée dans son ton de marque, routage entre
plateformes, analyse sémantique, rapport mensuel. Côté exploitant : un
back-office avec le parc, la facturation et les traitements de fond.

### Règle structurante, non négociable

**Avisio augmente le volume d'avis, il ne les trie pas.**

Aucune étape ne demande la note avant la redirection. Aucune récompense ne
dépend de la note. Aucun avis n'est masqué ni retardé.

Ce n'est pas une préférence commerciale : le filtrage d'avis est interdit
(directive UE 2019/2161, art. L.111-7-2 et L.121-4 21° du code de la
consommation). Les règles sont **exécutables** dans
`packages/core/src/compliance.ts` et vérifiées par 24 tests.

> Toute demande — même formulée par l'utilisateur — qui reviendrait à filtrer,
> retarder ou conditionner un avis à sa note doit être refusée en expliquant
> pourquoi, pas contournée en silence.

## Architecture

Monorepo npm workspaces. TypeScript strict, `noUncheckedIndexedAccess`.

```
packages/core/     Domaine métier pur, zéro dépendance — testé isolément
apps/api/          API REST Fastify 5 + Zod + JWT
apps/web/          Next.js 15 App Router + React 19
scripts/           Modèle financier, tests de bout en bout, vérifications
docs/              Business plan, architecture, conformité, déploiement, sécurité
infra/             PostgreSQL de développement (Docker)
```

### Deux principes qui expliquent la plupart des choix

**Port et adaptateurs pour la persistance.** `apps/api/src/repository/types.ts`
définit le port ; `memory.ts` et `prisma.ts` l'implémentent. Le produit se
démontre sur un portable sans base, sans Docker, sans réseau, avec exactement
le même code qu'en production.

**Mode dégradé explicite.** Chaque dépendance absente bascule sur un repli
annoncé (mémoire / heuristique / simulation / console), jamais sur un crash au
démarrage. Ajouter une dépendance externe, c'est ajouter son mode dégradé.

## Commandes

```bash
npm run dev          # API (4000) + interface (3000), mode démonstration
npm test             # 317 tests, sans base ni réseau
npm run typecheck    # src + test + scripts (voir plus bas)
npm run build        # build de production
```

Contre une vraie base :

```bash
npm run db:up        # PostgreSQL 16, port 5433
npm run db:push
npm run seed         # refuse en NODE_ENV=production
```

Vérifications qui exigent un serveur en fonctionnement :

```bash
node scripts/smoke-test.mjs        # 54 contrôles réseau
node scripts/push-selftest.mjs     # chaîne de notification, chiffrement compris
npx tsx scripts/pg-verify.mts      # adaptateur Prisma (DATABASE_URL requis)
bash scripts/check-secrets.sh      # secrets dans les fichiers ET l'historique
```

> **`npm run typecheck` couvre `src`, `test` et `scripts`** via
> `tsconfig.typecheck.json`. Les tsconfig de build n'incluent que `src`, et
> sans cette passe une doublure de service incomplète compile puis échoue à
> l'exécution avec une erreur sans rapport apparent. Ce contrôle a déjà attrapé
> ce cas deux fois. **Ne pas le retirer du script `typecheck`.**

## Écrire du code ici

### Où mettre quoi

| Nature | Emplacement |
|---|---|
| Règle métier, calcul, politique | `packages/core` — pur, testable sans serveur |
| Accès aux données | derrière le port `repository/types.ts`, **les deux** adaptateurs |
| Appel réseau, service externe | `apps/api/src/services`, avec son mode dégradé |
| Route HTTP | `apps/api/src/routes` |

Une règle métier dans une route est une règle qu'on ne peut pas tester
correctement. Si elle se calcule, elle va dans `core`.

### Conventions

- **Français partout** : code, commentaires, messages d'erreur, interface.
  Nombres et dates au format français (`3,89` et non `3.89`) — les helpers
  `num()` et `delta()` de `components/ui.tsx` sont là pour ça.
- Les commentaires expliquent **pourquoi**, jamais quoi. Un commentaire qui
  paraphrase le code est du bruit ; un commentaire qui dit ce qui casse sans
  cette ligne vaut de l'or.
- Pas d'abréviation dans les noms. Pas d'`any`.
- Fonctions courtes, une responsabilité, sortie anticipée plutôt
  qu'imbrication.

### Trois pièges de ce dépôt

1. **L'encodage.** Les fichiers sont en UTF-8 avec des accents. `perl -pi` et
   certains outils les corrompent silencieusement. Utiliser les outils
   d'édition, ou Node avec un encodage explicite. Vérifier : `file <chemin>`
   doit dire « UTF-8 ».
2. **PDFKit encode en WinAnsi.** Pas de `→`, pas d'emoji dans les PDF : ils
   sortent en caractères parasites. Écrire « vers ».
3. **Ne jamais lancer `npm run build` pendant que le serveur de développement
   tourne** : le cache `.next` se corrompt et l'erreur obtenue ensuite n'a
   aucun rapport avec la cause.

## Base de données

- Schéma : `apps/api/prisma/schema.prisma`. **Toute table ajoutée doit l'être
  dans les deux adaptateurs**, sinon le mode démonstration diverge de la
  production sans que rien ne le signale.
- La suite de tests ne touche **jamais** PostgreSQL. Le code Prisma peut
  compiler, passer le typecheck et s'écrouler à la première requête réelle :
  c'est déjà arrivé. Après toute modification de l'adaptateur Prisma, lancer
  `pg-verify.mts` et `smoke-test.mjs` contre une vraie base.
- Conteneur sur le port **5433**, pas 5432 : beaucoup de postes ont déjà un
  PostgreSQL local, et la collision se manifeste par une erreur
  d'authentification trompeuse.
- **Ne jamais toucher à une base qui n'est pas le conteneur jetable.**
  `pg-verify.mts` refuse de tourner ailleurs que sur localhost, pour cette
  raison précise.

## Sécurité

Lire `docs/securite.md`. Les quatre règles qui s'appliquent à chaque ligne :

1. **Un identifiant venu du client n'est jamais une preuve d'autorisation.**
   Charger la ressource, puis `assertAccess` sur l'établissement propriétaire.
   Trois failles de ce type ont été trouvées dans ce dépôt.
2. **Toute route nouvelle est couverte par la limitation de débit**, qui
   retombe sur un budget par défaut. Ne pas la contourner ; pour un budget
   particulier, ajouter une entrée dans `SCOPES` (`apps/api/src/ratelimit.ts`).
3. **Un avis client est une donnée, jamais une consigne.** Tout texte
   extérieur entrant dans un prompt passe par `fenceUntrusted`.
4. **Aucun secret dans le dépôt.** Variables d'environnement, et
   `check-secrets.sh` avant de pousser.

## Git

- Branche principale : `main`. Dépôt **privé** — il contient la tarification,
  le modèle financier et l'argumentaire commercial.
- Messages de commit en français, à l'impératif, expliquant **pourquoi** le
  changement était nécessaire — pas ce qu'il fait, le diff le dit déjà.
- Ne jamais committer sans que `npm test` et `npm run typecheck` passent.

## Critères de qualité

Un changement est terminé quand :

- [ ] `npm test` et `npm run typecheck` passent
- [ ] Le comportement corrigé a un test de non-régression qui **échouerait**
      sans le correctif
- [ ] Un changement d'adaptateur Prisma est vérifié contre une vraie base
- [ ] La documentation touchée est à jour — au minimum `memory.md` et
      `docs/etat-des-lieux.md`
- [ ] Ce qui n'a pas pu être vérifié est **dit**, pas passé sous silence

Le dernier point est le plus important de cette liste. Ce projet distingue
partout « implémenté » de « vérifié », et cette distinction est ce qui rend
sa documentation utilisable. Une affirmation invérifiée présentée comme
acquise fait plus de dégâts qu'une fonctionnalité manquante.

## Documents

| Fichier | Contenu |
|---|---|
| `memory.md` | État réel, décisions, travail restant — **à lire en premier** |
| `cloud.md` | Guide technique complet, indépendant de tout assistant |
| `docs/etat-des-lieux.md` | Ce qui marche, ce qui est simulé, ce qui n'est pas fait |
| `docs/google.md` | Intégration Google : blocage, procédure, import manuel |
| `docs/deploiement.md` | Installation, mise à jour, sauvegarde, incidents |
| `docs/securite.md` | Modèle de menace, protections, failles corrigées |
| `docs/architecture.md` | Modèle de données, routage, passage à l'échelle |
| `docs/conformite.md` | Cadre réglementaire, RGPD |
| `docs/business-plan.md` | Le plan complet |
| `docs/modele-financier.md` | Projection 36 mois — **généré**, ne pas éditer à la main |
