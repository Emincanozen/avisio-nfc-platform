# Passation — Avisio

> **Nouveau sur ce projet ?** Lis [`INDEX.md`](INDEX.md) d'abord : il dit
> quoi lire selon ce que tu viens faire, et surtout quoi ne pas lire. La
> documentation complète pèse ~36 500 jetons ; tu en as rarement besoin de plus
> de 3 000.

**À l'IA ou au développeur qui reprend ce projet.** Lis ce fichier en entier
avant de toucher au code. Il tient en dix minutes et t'évitera de refaire ce
qui est fait, ou de défaire ce qui est voulu.

Rédigé le 20 septembre 2026, sur le commit `4e5b14b`, branche `main`.

---

## 1. En une minute

**Avisio** est un SaaS français : les établissements de proximité
(restauration, hôtellerie, commerce, beauté, santé) posent une plaquette NFC
au comptoir, le client tape une fois sur son téléphone et dépose son avis. Le
gérant est alerté des avis négatifs, on lui rédige une réponse dans son ton de
marque, et le routage répartit les clients entre les plateformes où il est le
plus en retard.

Abonnement : 29 € / 79 € / 149 € par mois. Propriétaire : **@OZEN**. Dépôt
**privé** — il contient la tarification, le modèle financier complet et
l'argumentaire commercial.

**État du logiciel : il fonctionne et se vérifie. Il n'est pas déployé.**

| Ce qui est vrai | Preuve |
|---|---|
| 399 tests verts | `npm test` |
| Typecheck complet (`src` + `test` + `scripts`) | `npm run typecheck` |
| Build de production propre | `npm run build` |
| 54/54 de bout en bout **sur PostgreSQL réel**, quatre fois de suite | `node scripts/smoke-test.mjs` |
| 18/18 sur l'adaptateur Prisma, SQL brut sous 60 requêtes simultanées | `npx tsx scripts/pg-verify.mts` |
| Chaîne de notification complète, sans simulation | `node scripts/push-selftest.mjs` |
| Aucun secret, ni dans les fichiers ni dans l'historique Git | `bash scripts/check-secrets.sh` |

## 2. Ce que tu dois lire, et dans quel ordre

1. **`memory.md`** — état réel, décisions structurantes avec leur raison,
   travail restant. C'est le fichier qui évite de reprendre une piste déjà
   abandonnée.
2. **`CLAUDE.md`** (identique à `AGENTS.md`) — conventions, pièges du dépôt,
   critères de qualité.
3. **`cloud.md`** — guide technique complet, schémas des flux réels.
4. Selon le sujet : `docs/google.md`, `docs/deploiement.md`,
   `docs/securite.md`, `docs/etat-des-lieux.md`.

> `CLAUDE.md` et `AGENTS.md` ont le même contenu, pour que différents agents
> trouvent leurs instructions. **Si tu modifies l'un, modifie l'autre** —
> sinon ils divergent en silence.

## 3. Les cinq choses à savoir avant d'écrire une ligne

### 3.1 La règle qui ne se négocie pas

**Avisio augmente le volume d'avis, il ne les trie pas.** Aucune étape ne
demande la note avant la redirection, aucune récompense ne dépend de la note,
aucun avis n'est masqué ni retardé.

Ce n'est pas une préférence commerciale : le filtrage d'avis est **interdit**
(directive UE 2019/2161, art. L.111-7-2 et L.121-4 21° du code de la
consommation). Les règles sont exécutables dans
`packages/core/src/compliance.ts`, vérifiées par 24 tests, et l'API ne reçoit
jamais la note pressentie d'un client — le routage **ne peut pas** en dépendre,
même par erreur de programmation.

Si @OZEN te demande un jour de filtrer, retarder ou conditionner un avis à sa
note : explique pourquoi c'est refusé, ne contourne pas en silence.

### 3.2 La suite de tests ne touche jamais PostgreSQL

Les 399 tests tournent sur l'adaptateur mémoire. **Tout le code Prisma peut
compiler, passer le typecheck, et s'écrouler à la première requête réelle.**
C'est arrivé deux fois dans ce dépôt.

Après toute modification de `apps/api/src/repository/prisma.ts` :

```bash
npm run db:up
export DATABASE_URL=postgresql://avisio:avisio@localhost:5433/avisio
npm run db:push && npm run seed
npx tsx scripts/pg-verify.mts
```

### 3.3 Deux adaptateurs, toujours

`apps/api/src/repository/types.ts` est le port ; `memory.ts` et `prisma.ts`
l'implémentent. **Toute table ajoutée doit l'être dans les deux**, sinon le
mode démonstration diverge de la production sans que rien ne le signale.

Pourquoi ce coût est accepté : le produit se démontre sur un portable sans
base, sans Docker et sans réseau, avec exactement le même code qu'en
production. C'est l'outil de vente.

### 3.4 Le typecheck couvre les fichiers de test

`npm run typecheck` inclut `tsconfig.typecheck.json`, qui couvre `src`, `test`
**et** `scripts`. Les tsconfig de build n'incluent que `src`.

**Ne le retire pas.** Il a déjà attrapé trois fois une doublure de service
incomplète ou un jeu de données faux — des tests qui passaient en vert tout en
testant autre chose que ce qu'ils prétendaient.

### 3.5 L'encodage

Les fichiers sont en UTF-8 accentué. `perl -pi` les corrompt silencieusement
(ça m'est arrivé). Utilise les outils d'édition, ou Node avec un encodage
explicite. Vérification : `file <chemin>` doit dire « UTF-8 ».

Deux autres pièges : **PDFKit encode en WinAnsi** (pas de `→`, pas d'emoji
dans les PDF) et **ne jamais lancer `npm run build` pendant que le serveur de
développement tourne** — le cache `.next` se corrompt et l'erreur suivante n'a
aucun rapport avec la cause.

## 4. Ce qui est bloqué, et par qui

### Google — bloqué par Google, pas par le code

Le parcours complet est **écrit et typé** : URL de consentement, état signé,
échange du code, scellement AES-256-GCM du jeton, renouvellement, liste et
sélection des fiches, révocation, diagnostic étape par étape.

**Aucune requête n'a jamais atteint Google.** Un projet Google Cloud dont la
demande d'accès n'est pas approuvée dispose d'un quota de **0 requête par
minute** : tous les appels échouent. Ce n'est pas un défaut d'implémentation,
c'est l'état par défaut, et c'est ce qui trompe le plus de monde.

Aucune doublure ne peut prouver que ça marche — elle prouverait seulement
qu'on a bien deviné la forme des réponses. Procédure pour débloquer :
`docs/google.md` §3. C'est à @OZEN, et le délai se compte en semaines.

**En attendant, l'import manuel fonctionne et c'est un chemin de production** :
espace gérant → onglet *Sources d'avis*. Les avis importés portent
`source: 'import'` jusqu'en base — ils ne sont jamais présentés comme le fruit
d'une connexion en direct.

### Autres

- **TripAdvisor, Facebook, Yelp** : accès partenaires non demandés.
- **Encaissement automatique** : non implémenté. La facturation est complète
  (émission, numérotation légale, PDF, relances, suspension) mais le règlement
  est constaté à la main. Brancher GoCardless ou Stripe revient à écrire un
  second adaptateur `PaymentProvider`.
- **SMS** : journalisé faute d'opérateur. L'e-mail fonctionne.
- **Plaquettes physiques** : **hors périmètre, sur décision explicite de
  @OZEN.** Il traite fournisseurs et fabrication lui-même. **N'entreprends
  rien là-dessus.**

## 5. Ce qui n'a pas été vérifié

Ce projet distingue partout « implémenté » de « vérifié ». Garde cette
distinction : une affirmation invérifiée présentée comme acquise fait plus de
dégâts qu'une fonctionnalité manquante.

| Point | Pourquoi |
|---|---|
| Aucun déploiement réel | Les unités systemd et nginx de `docs/deploiement.md` sont écrites, jamais exécutées |
| Sauvegarde / restauration jamais jouée | Une sauvegarde non restaurée est une hypothèse |
| Push jamais reçu sur un vrai téléphone | Exige un domaine en HTTPS |
| E-mails réels jamais envoyés | Pas de clé Resend ; seul le repli console a tourné |
| Aucune mesure de montée en charge | Les besoins annoncés sont une estimation |

## 6. Travail restant, par priorité

### Priorité 1 — dépend de @OZEN, bloque le lancement

1. **Créer le dépôt GitHub privé et pousser.** Rien n'est poussé.
   `gh` est absent de l'environnement et aucun jeton n'y est disponible.
   Procédure au §7.
2. **Demander l'accès à l'API Google Business Profile.** Long délai : à lancer
   en premier. `docs/google.md` §3.
3. **Premier déploiement.** `docs/deploiement.md`. Dans cet ordre : installer,
   restaurer une sauvegarde de test, recevoir une notification sur un vrai
   téléphone.

### Priorité 2 — avant les premiers clients payants

4. **Encaissement** : adaptateur `PaymentProvider` (GoCardless pour le SEPA,
   ou Stripe Billing). L'interface existe déjà côté service de facturation.
5. **Second facteur sur le back-office.**
6. **Journal d'audit des actions administrateur.**
7. **En-têtes de sécurité HTTP** (CSP, HSTS) au niveau du proxy.

### Priorité 3 — dette identifiée

8. `npm audit` dans l'intégration continue.
9. Opérateur SMS pour les invitations de caisse.
10. Mesure de montée en charge.

## 7. GitHub — état exact

**Rien n'est poussé. Aucun remote configuré.**

Le dépôt local est prêt : branche `main`, arbre propre, 15 commits, 1,8 Mo,
~140 fichiers, aucun binaire lourd, **aucun secret ni dans les fichiers suivis
ni dans l'historique** (vérifié par `scripts/check-secrets.sh`).

Ce que @OZEN doit faire :

1. github.com/new → nom `avisio` → **Private** → ni README ni .gitignore.
2. Donner l'URL.

Puis :

```bash
git remote add origin <URL>
git push -u origin main
```

> **Le dépôt doit rester privé.** Il contient la tarification, le modèle
> financier complet (CAC, LTV, projections, besoin de financement) et
> l'argumentaire commercial.

## 8. Les décisions à ne pas renverser par distraction

Chacune est détaillée dans `memory.md` §3, avec sa raison **et** l'alternative
écartée. Les trois qu'on est le plus tenté de défaire :

**Les compteurs de limitation de débit vivent en base, pas en mémoire.** Un
compteur par processus diviserait le budget réel par le nombre d'instances et
se remettrait à zéro à chaque redéploiement — exactement le moment où un
attaquant persistant reprend la main. Redis a été écarté : une dépendance de
plus à administrer, pour un produit exploité par une personne seule.

**Une connexion réussie remet le compteur à zéro.** Le budget existe pour
ralentir qui devine un mot de passe ; un mot de passe correct est la
démonstration du contraire. Sans cette remise à zéro, un gérant se verrouille
sur ses propres succès — téléphone, ordinateur, tablette, gestionnaire de mots
de passe. Cela n'ouvre rien : qui sait déjà se connecter n'a plus rien à
deviner.

**La landing d'une plaquette non configurée répond 200, pas 409.** Celui qui
reçoit cette réponse est un client debout au comptoir, pas un opérateur. Une
erreur technique lui ferait croire que l'établissement est en panne. Le dépôt
de scan, lui, reste en 409 : il n'existe réellement aucune URL vers laquelle
rediriger. (Un audit précédent avait fait l'inverse — juste vu de
l'exploitation, faux vu du client.)

## 9. Les quatre règles de sécurité qui s'appliquent à chaque ligne

Détail dans `docs/securite.md`.

1. **Un identifiant venu du client n'est jamais une preuve d'autorisation.**
   Charger la ressource, **puis** `assertAccess` sur l'établissement
   propriétaire. Trois failles de ce type ont été trouvées ici — dont une où
   un gérant pouvait couper les notifications d'un concurrent, donc l'aveugler
   sur ses avis négatifs.
2. **Toute route nouvelle est couverte par la limitation de débit**, qui
   retombe sur un budget par défaut. Pour un budget particulier, ajouter une
   entrée dans `SCOPES` (`apps/api/src/ratelimit.ts`).
3. **Un avis client est une donnée, jamais une consigne.** Tout texte
   extérieur entrant dans un prompt passe par `fenceUntrusted`.
4. **Aucun secret dans le dépôt.** Variables d'environnement, et
   `check-secrets.sh` avant de pousser.

## 10. Démarrer en trois commandes

```bash
npm install
npm run dev
```

Sans aucune configuration, l'API démarre en mode démonstration (données en
mémoire, jeu de données chargé) et l'interface est disponible.

| Compte | Accès |
|---|---|
| `demo@avisio.fr` / `demo1234` | Espace gérant, 3 établissements |
| `admin@avisio.fr` / `admin1234` | Back-office, tout le parc |

- http://localhost:3000 — vitrine et simulateur de devis
- http://localhost:3000/admin — back-office
- http://localhost:3000/s/k7m2p9qa — landing NFC (restaurant, Premium)
- http://localhost:4000/health — état et modes dégradés actifs

Ces identifiants sont ceux du jeu de démonstration. `npm run seed` **refuse**
de tourner avec `NODE_ENV=production`, précisément pour ne pas les créer sur
une vraie base.

## 11. Avant de dire qu'un travail est terminé

- [ ] `npm test` et `npm run typecheck` passent
- [ ] Le comportement corrigé a un test de non-régression **qui échouerait
      sans le correctif** — vérifie-le en cassant volontairement le code
- [ ] Un changement d'adaptateur Prisma est vérifié contre une vraie base
- [ ] `memory.md` et `docs/etat-des-lieux.md` sont à jour
- [ ] **Ce qui n'a pas pu être vérifié est dit**, pas passé sous silence

Le dernier point est le plus important. C'est ce qui rend la documentation de
ce projet utilisable, et c'est une exigence répétée de @OZEN.
