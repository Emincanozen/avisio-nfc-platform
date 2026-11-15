# Contribuer à Avisio

Dépôt privé, propriétaire. Ces règles valent pour Avisio, pour un futur
développeur, et pour tout assistant intervenant sur le code.

Lire d'abord [`CLAUDE.md`](CLAUDE.md) (conventions et pièges) et
[`memory.md`](memory.md) (état réel et décisions).

---

## Branches

`main` est la branche de référence. Elle doit toujours être déployable.

Une branche par sujet, préfixée par sa nature :

```
correctif/plaquette-sans-plateforme
fonctionnalite/import-tripadvisor
securite/journal-audit-admin
docs/procedure-restauration
```

Pas de branche de longue durée : au-delà de quelques jours, la fusion coûte
plus cher que le travail lui-même.

## Avant de pousser

```bash
npm run typecheck            # src, test ET scripts
npm test
npm run build
bash scripts/check-secrets.sh
```

Si l'adaptateur Prisma a changé, la suite de tests **ne le couvre pas** :

```bash
npm run db:up
export DATABASE_URL=postgresql://avisio:avisio@localhost:5433/avisio
npm run db:push
npx tsx scripts/pg-verify.mts
```

## Commits

En français, à l'impératif, expliquant **pourquoi** — le diff dit déjà quoi.

Un bon message de ce dépôt ressemble à :

> Le désabonnement push agissait sur le seul point de terminaison : un gérant
> qui connaissait celui d'un autre pouvait couper ses notifications, donc
> l'aveugler sur ses avis négatifs, ce que le produit vend précisément.

Un mauvais :

> ~~Fix push unsubscribe~~

Un commit par idée. Un correctif et une refonte de mise en forme dans le même
commit rendent la relecture — et le retour arrière — inutilement pénibles.

## Relecture avant fusion

À vérifier, dans cet ordre :

1. **L'intégration continue passe** (typecheck, tests, build, PostgreSQL,
   secrets).
2. **Le correctif a un test qui échouerait sans lui.** Un test qui passe dans
   les deux cas ne prouve rien et donne une fausse assurance — c'est pire que
   pas de test.
3. **Le cloisonnement tient.** Toute route touchant une ressource d'un
   établissement charge la ressource puis appelle `assertAccess`. Un
   identifiant venu du client n'est jamais une preuve d'autorisation ; trois
   failles de ce type ont déjà été trouvées ici.
4. **Une table ajoutée l'est dans les deux adaptateurs** (mémoire et Prisma),
   sinon le mode démonstration diverge de la production sans que rien ne le
   signale.
5. **Aucun secret**, aucune donnée personnelle réelle.
6. **La documentation touchée est à jour** — au minimum `memory.md`.
7. **Ce qui n'a pas pu être vérifié est dit**, pas passé sous silence.

Le dernier point est le plus important. Ce projet distingue partout
« implémenté » de « vérifié », et c'est ce qui rend sa documentation
utilisable. Une affirmation invérifiée présentée comme acquise fait plus de
dégâts qu'une fonctionnalité manquante.

## Ce qu'on ne fait pas ici

- **Filtrer, retarder ou conditionner un avis à sa note.** C'est interdit
  (directive UE 2019/2161), les règles sont exécutables dans
  `packages/core/src/compliance.ts`, et c'est l'argument de vente du produit.
  Une demande allant dans ce sens se refuse en expliquant pourquoi, elle ne
  se contourne pas.
- **Supprimer un test qui échoue** pour obtenir du vert. Si le test est
  incorrect, le corriger en conservant son intention métier, et dire laquelle.
- **Remplacer une fonctionnalité réelle par une simulation** pour faire passer
  la suite.
- **Toucher à une base qui n'est pas le conteneur jetable.**
- **Retirer le typecheck des fichiers de test.** Il a déjà attrapé deux fois
  une doublure incomplète qui compilait et n'échouait qu'à l'exécution.

## Signaler une faille

Ne pas ouvrir de ticket public. Voir [`docs/securite.md`](docs/securite.md) §10.
