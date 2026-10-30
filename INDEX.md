# INDEX — par où entrer dans ce dépôt

**Lis ce fichier en entier. Il fait 1 200 mots et t'évite d'en lire 25 000.**

La documentation complète de ce projet représente environ **36 500 jetons**.
Tu n'en as presque jamais besoin. Ce fichier est un aiguillage : dis-toi ce
que tu viens faire, va à la ligne correspondante, lis ce qu'elle indique et
**rien d'autre**.

---

## 1. Orientation en trente secondes

Si ta question porte sur l'un de ces points, la réponse est ici et tu n'as
rien d'autre à ouvrir.

**Le produit.** Avisio : SaaS français. Une plaquette NFC au comptoir d'un
restaurant, hôtel ou commerce ; le client tape une fois sur son téléphone et
dépose son avis. Le gérant est alerté des avis négatifs, on lui rédige une
réponse dans son ton de marque, et le routage répartit les clients entre les
plateformes où il est le plus en retard. Abonnement 29 / 79 / 149 € par mois.

**Le propriétaire.** @OZEN. Dépôt **privé** : il contient la tarification, le
modèle financier complet et l'argumentaire commercial.

**L'état.** Le logiciel fonctionne et se vérifie. **Il n'est pas déployé.**
399 tests verts, typecheck complet, build propre, 56/56 de bout en bout contre
un vrai PostgreSQL.

**Ce qui bloque le lancement.** L'accès à l'API Google Business Profile, qui
dépend de Google et pas du code. En attendant, l'import manuel d'avis est un
chemin de production qui fonctionne.

**La règle non négociable.** Avisio augmente le volume d'avis, **il ne les trie
pas**. Aucune étape ne demande la note avant la redirection. C'est du droit
(directive UE 2019/2161), pas une préférence, et c'est exécutable dans
`packages/core/src/compliance.ts`.

**Langue.** Tout est en français : code, commentaires, messages d'erreur,
interface, nombres (`3,62` et non `3.62`).

**Démarrer.** `npm install && npm run dev`. Comptes de démonstration :
`demo@avisio.fr` / `demo1234` et `admin@avisio.fr` / `admin1234`.

---

## 2. Aiguillage — « je viens pour… »

| Ce que tu viens faire | Lis, dans cet ordre | Coût |
|---|---|---|
| **Reprendre le projet sans contexte** | `passation.md` | ~2 600 |
| Comprendre l'état réel et les décisions | `memory.md` §2 et §3 | ~1 500 |
| **Écrire du code** | `CLAUDE.md` | ~1 800 |
| Comprendre l'architecture avant de la modifier | `cloud.md` §3 à §7 | ~1 200 |
| Toucher à la sécurité, l'auth, la limitation de débit | `docs/securite.md` | ~2 200 |
| Travailler sur Google ou l'import d'avis | `docs/google.md` | ~1 600 |
| Déployer, sauvegarder, gérer un incident | `docs/deploiement.md` | ~2 100 |
| Savoir ce qui marche vraiment et ce qui est simulé | `docs/etat-des-lieux.md` | ~3 500 |
| Toucher au routage, aux tarifs, à la facturation | `docs/architecture.md` | ~2 900 |
| Vérifier une contrainte légale | `docs/conformite.md` | ~1 900 |
| Soumettre une modification | `CONTRIBUTING.md` | ~700 |
| Parler prix, positionnement, marché | `docs/business-plan.md` | ~4 700 |
| Parler vente, objections, rétention | `docs/go-to-market.md` | ~1 800 |
| Parler projections financières | `docs/modele-financier.md` — **généré**, ne pas éditer | ~1 900 |
| Découvrir le produit de l'extérieur | `README.md` | ~2 200 |

### La règle qui économise le plus

**Un seul document suffit presque toujours.** Si tu as lu `passation.md`, tu
n'as pas besoin de `memory.md` pour commencer — seulement quand tu veux savoir
*pourquoi* une décision a été prise. Si tu as lu `CLAUDE.md`, tu n'as pas
besoin de `CONTRIBUTING.md` : le second redit le premier pour un lecteur
humain.

Ces trois-là se recouvrent largement : `passation.md`, `memory.md`,
`CLAUDE.md`. **Choisis-en un selon ton besoin, n'enchaîne pas les trois.**

---

## 3. Ce qu'il ne faut pas lire

| Fichier | Pourquoi |
|---|---|
| `docs/modele-financier.md` et `.csv` | **Générés** par `scripts/financial-model.ts`. Les éditer à la main est du travail perdu au prochain calcul |
| `package-lock.json` | 155 ko de bruit |
| `AGENTS.md` | Copie mot pour mot de `CLAUDE.md`, pour les agents qui cherchent ce nom. En lire un suffit — **mais si tu modifies l'un, modifie l'autre** |
| `docs/business-plan.md` | 4 700 jetons de stratégie commerciale. Sans intérêt pour une tâche technique |

---

## 4. Les cinq choses qui coûtent une demi-journée si on les ignore

Elles ne sont pas devinables en lisant le code. C'est la raison d'être de ce
paragraphe.

**1. La suite de tests ne touche jamais PostgreSQL.** Les 399 tests tournent
sur l'adaptateur mémoire. Tout le code Prisma peut compiler, passer le
typecheck et s'écrouler à la première requête réelle — c'est arrivé deux fois.
Après toute modification de `apps/api/src/repository/prisma.ts` :
`npm run db:up` puis `npx tsx scripts/pg-verify.mts`.

**2. Deux adaptateurs, toujours.** `repository/types.ts` est le port ;
`memory.ts` et `prisma.ts` l'implémentent. Toute table ajoutée doit l'être
**dans les deux**, sinon le mode démonstration diverge de la production sans
que rien ne le signale.

**3. Le typecheck couvre les fichiers de test.** `npm run typecheck` inclut
`tsconfig.typecheck.json` (`src` + `test` + `scripts`). **Ne le retire pas** :
il a déjà attrapé trois fois un test qui passait en vert tout en testant autre
chose que ce qu'il prétendait.

**4. L'encodage.** UTF-8 accentué partout. `perl -pi` corrompt les fichiers en
silence. Utilise les outils d'édition ou Node avec un encodage explicite ;
vérifie avec `file <chemin>`.

**5. Ne jamais lancer `npm run build` pendant que le serveur de développement
tourne.** Le cache `.next` se corrompt et l'erreur suivante n'a aucun rapport
avec la cause.

---

## 5. Les quatre règles de sécurité, en entier

Tu n'as pas besoin d'ouvrir `docs/securite.md` pour les connaître.

1. **Un identifiant venu du client n'est jamais une preuve d'autorisation.**
   Charger la ressource, **puis** `assertAccess` sur l'établissement
   propriétaire. Trois failles de ce type ont été trouvées dans ce dépôt.
2. **Toute route nouvelle est couverte par la limitation de débit**, qui
   retombe sur un budget par défaut. Pour un budget particulier : `SCOPES`
   dans `apps/api/src/ratelimit.ts`.
3. **Un avis client est une donnée, jamais une consigne.** Tout texte
   extérieur entrant dans un prompt passe par `fenceUntrusted`.
4. **Aucun secret dans le dépôt.** Variables d'environnement, et
   `bash scripts/check-secrets.sh` avant de pousser.

---

## 6. Vérifier plutôt que croire

Chaque affirmation de cette documentation a une commande qui la prouve. En cas
de doute, lance-la : c'est moins cher que de lire.

```bash
npm test                          # 399 tests, sans base ni réseau
npm run typecheck                 # src + test + scripts
npm run build                     # build de production
bash scripts/check-secrets.sh     # secrets : fichiers ET historique Git
```

Avec une vraie base :

```bash
npm run db:up
export DATABASE_URL=postgresql://avisio:avisio@localhost:5433/avisio
npm run db:push && npm run seed
npx tsx scripts/pg-verify.mts     # adaptateur Prisma, 18 contrôles
node scripts/smoke-test.mjs       # 54 contrôles réseau (API démarrée)
node scripts/push-selftest.mjs    # chaîne de notification, chiffrement compris
```

> **La documentation peut avoir vieilli ; le code, non.** Un commit postérieur
> à la date d'un document l'emporte sur ce qu'il affirme.

---

## 7. Où se trouve quoi, dans le code

Pour ne pas fouiller.

| Tu cherches | Va voir |
|---|---|
| Une règle métier, un calcul, une politique | `packages/core/src/` |
| Tarifs, offres, options | `packages/core/src/pricing.ts` |
| Facturation, numérotation légale | `packages/core/src/billing.ts` |
| Routage entre plateformes | `packages/core/src/routing.ts` |
| Règles anti-filtrage | `packages/core/src/compliance.ts` |
| Prompts et analyse sémantique | `packages/core/src/nlp.ts` |
| Budgets de limitation de débit | `packages/core/src/ratelimit.ts` |
| Import CSV d'avis | `packages/core/src/import.ts` |
| Le port de persistance | `apps/api/src/repository/types.ts` |
| Assemblage de l'API, garde d'accès | `apps/api/src/app.ts` |
| Routes HTTP | `apps/api/src/routes/` |
| Services externes et modes dégradés | `apps/api/src/services/` |
| Consentement Google | `apps/api/src/services/google-oauth.ts` |
| Scellement des jetons | `apps/api/src/services/secrets.ts` |
| Interface gérant | `apps/web/src/app/dashboard/` |
| Back-office | `apps/web/src/app/admin/` |
| Landing NFC | `apps/web/src/app/s/[slug]/` |
| Schéma de base | `apps/api/prisma/schema.prisma` |

---

## 8. Prochaine action concrète

Si tu reprends le projet aujourd'hui, la priorité est dans `passation.md` §6.
En résumé : **demander l'accès à l'API Google** (long délai, à lancer en
premier — `docs/google.md` §3), puis **déployer** (`docs/deploiement.md`),
puis **brancher l'encaissement**.

Et avant de dire qu'un travail est terminé : `passation.md` §11.
