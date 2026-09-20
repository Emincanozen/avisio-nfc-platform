# État des lieux — ce qui marche, ce qui ne marche pas

Document de vérité sur l'état réel du logiciel au 19 septembre 2026.
Chaque ligne est **vérifiée**, pas déclarée : la méthode de vérification est
indiquée, et les commandes sont reproductibles.

---

## 1. La question qui compte

> « Si un client note un établissement, le gérant reçoit-il vraiment une
> notification ? »

**Réponse courte : la machine fonctionne, mais elle n'est pas encore branchée
sur le monde réel.**

La chaîne complète comporte six maillons. Cinq sont opérationnels et vérifiés.
Le premier — lire les avis réellement déposés sur Google — attend une
autorisation de Google qui n'a pas encore été demandée.

```
1. Le client scanne et tape                    ✅ fonctionne
2. Il dépose son avis sur Google               ✅ fonctionne (c'est Google)
3. Avisio lit cet avis                         ⚠️  import manuel OUI · Google NON
4. Avisio l'analyse et crée une alerte         ✅ vérifié
5. Avisio pousse la notification               ✅ vérifié
6. Le gérant la reçoit sur son téléphone       ⚠️  vérifié en local, pas sur un vrai appareil
```

**Conclusion honnête, mise à jour le 19 septembre 2026 :**

- Un avis **importé** déclenche bien une alerte et une notification. C'est
  vérifié de bout en bout, sans simulation, contre PostgreSQL
  (`node scripts/push-selftest.mjs`). L'import est un chemin de production,
  pas un pis-aller de démonstration.
- Un avis déposé sur Google **n'entre toujours pas tout seul**. Le
  consentement par établissement est implémenté ; l'accès à l'API Google
  n'est pas accordé, et un projet non approuvé a un quota de 0 requête par
  minute. Voir `docs/google.md`.

Autrement dit : la machine fonctionne et on peut l'alimenter dès aujourd'hui,
mais la synchronisation automatique avec Google attend Google.

---

## 2. Vérification du maillon 3 — la lecture des avis

C'est le seul blocage, et il est administratif, pas technique.

| | |
|---|---|
| **Ce qui est écrit** | Le connecteur Google Business Profile complet : rafraîchissement du jeton OAuth, pagination, arrêt sur le dernier avis connu, lecture des compteurs, publication des réponses. |
| **Ce qui manque** | L'autorisation d'accès à l'API, à demander à Google. Délai annoncé : 4 à 8 semaines. |
| **Ce qui tourne en attendant** | **Rien.** Depuis le 20 septembre 2026, une plateforme non connectée est muette. Le connecteur simulé ne tourne plus que sous `AVISIO_DEMO_MODE=true`, hors production, et ses avis portent `source: 'demo'` — exclus de toute métrique. |
| **Comment le savoir** | `GET /health` et le journal de démarrage annoncent `Google: connecté` ou `Google: non connecté`, et `données réelles` ou `MODE DÉMONSTRATION`. |

Le jour où l'accès est accordé, il suffit de renseigner trois variables
(`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`) et de
redémarrer. Aucune ligne de code à changer : le choix du connecteur se fait sur
la présence de ces variables.

---

## 3. Vérification des maillons 4 et 5 — alerte et notification

Reproductible en deux commandes :

```bash
NODE_TLS_REJECT_UNAUTHORIZED=0 npx tsx apps/api/src/server.ts
node scripts/push-selftest.mjs
```

Le script joue le navigateur du gérant **et** le service de push du
constructeur, en local et en TLS. Résultat obtenu :

```
PHASE 1 — une notification part-elle réellement ?
  OK   Requête reçue par le service de push
  OK   Corps chiffré non vide
  OK   Chiffrement AES128GCM
  OK   Signature VAPID présente
  OK   Clé publique du serveur transmise
  OK   Jeton JWT signé transmis
  OK   Durée de vie définie
  → 240 octets chiffrés livrés (delivered=1).

PHASE 2 — un avis négatif notifie-t-il le gérant ?
  OK   Avis négatif détecté et alerte créée (1 cycle d'ingestion)
  OK   Notification poussée sur l'appareil du gérant
```

Ce que cela prouve : l'API détecte l'avis négatif, crée l'alerte, signe la
notification au format VAPID, la chiffre en AES128GCM et la livre au point de
terminaison de l'appareil.

Ce que cela ne prouve pas : que Google ou Mozilla acceptent la requête. Leurs
services exigent un abonnement créé par un vrai navigateur sur un domaine
HTTPS. C'est le seul point à revérifier au premier déploiement.

`NODE_TLS_REJECT_UNAUTHORIZED=0` ne sert qu'à ce test, parce que le certificat
du service de push simulé est auto-signé. **À ne jamais utiliser en production.**

---

## 4. Tableau complet

### Opérationnel et vérifié

| Fonctionnalité | Vérifié par |
|---|---|
| Parcours NFC : scan, page traduite, redirection | Parcours réel dans le navigateur + 35 tests |
| Routage multi-plateformes pondéré | 9 tests + simulation sur 1 000 scans |
| Refus du tri par note (conformité) | 24 tests dédiés |
| Programme de fidélité, points inconditionnels | Parcours réel (points crédités) + tests |
| Détection des avis négatifs et création d'alerte | `push-selftest.mjs` phase 2 |
| Notification push signée et chiffrée | `push-selftest.mjs` phase 1 |
| Préférences de notification, heures calmes | Bascule réelle dans l'interface, persistée |
| Analyse sémantique et thèmes | 22 tests + tableau de bord réel |
| Détection de tendance | Tendance « attente » visible sur la démo |
| Suggestion de réponse et publication | Parcours réel dans l'interface |
| Tableau de bord et indicateurs | Parcours réel |
| Benchmark anonymisé (k-anonymat) | 12 tests, refus sous 5 pairs vérifié |
| Facturation : émission, numérotation, prorata | 37 tests + back-office réel ; une période une facture et un prorata porté une seule fois, prouvés contre PostgreSQL réel |
| PDF de facture et de rapport | PDF générés et relus page par page |
| Relances et suspension | Déclenchement réel depuis le back-office |
| Intégration caisse (webhook signé) | Appel externe réel via `pos-webhook-demo.mjs` |
| Onboarding complet | Établissement créé de bout en bout dans l'interface |
| Back-office et séparation des rôles | 45 tests + parcours réel (403 pour un gérant) |

### Simulé faute d'accès externe

| Fonctionnalité | Ce qui manque | Conséquence aujourd'hui |
|---|---|---|
| **Lecture des avis Google** | Autorisation API Google Business Profile | **Les vrais avis n'entrent pas.** Plus rien n'est fabriqué à la place : la plateforme est muette et l'interface le dit |
| Lecture TripAdvisor / Facebook / Yelp | Accès partenaires | Compteurs non synchronisés, routage par rotation de scans |
| Envoi des e-mails | Clé Resend | Les e-mails sont écrits dans le journal, avec leur contenu |
| Réception push sur un vrai téléphone | Domaine HTTPS + appareil réel | Vérifié en local seulement |
| Réponses rédigées par l'IA | Clé API Anthropic | Modèle de secours local, qualité moindre mais fonctionnel |

### Non développé

| Fonctionnalité | Pourquoi | Effort estimé |
|---|---|---|
| Encaissement automatique (mandat SEPA) | Demande un contrat prestataire | 1 à 2 semaines |
| Envoi de SMS | Demande un contrat opérateur | 3 à 5 jours |
| Résumé hebdomadaire | Canal prévu, contenu à composer | 2 à 3 jours |
| Plaquettes physiques | Hors périmètre logiciel, traité séparément | — |

---

## 5. Ce qu'il faut brancher pour une mise en service réelle

Dans l'ordre, avec ce que chaque branchement débloque :

| # | À faire | Débloque | Délai |
|---|---|---|---|
| 1 | Demander l'accès à l'API Google Business Profile | **Toute la chaîne d'alerte sur de vrais avis** | 4 à 8 semaines (administratif) |
| 2 | Créer un compte Resend, renseigner `RESEND_API_KEY` | Les e-mails partent pour de vrai | 1 heure |
| 3 | Déployer sur un domaine en HTTPS | Le push sur de vrais téléphones, la PWA installable | 1 jour |
| 4 | Renseigner `ANTHROPIC_API_KEY` | Réponses IA de qualité au lieu du modèle de secours | 1 heure |
| 5 | Contrat GoCardless ou Stripe | Prélèvement automatique | 1 à 2 semaines |

Les points 2, 3 et 4 se font dans la journée. **Le point 1 est le chemin
critique : il conditionne la promesse principale du produit et il ne dépend pas
de nous.** À déposer immédiatement.

---

## 6. Ce qu'on peut démontrer à un client dès aujourd'hui

Sans aucun des branchements ci-dessus, sur un ordinateur portable et sans
connexion :

- le parcours NFC complet, plaquette en main, sur le téléphone du gérant ;
- le tableau de bord avec une tendance négative détectée ;
- une réponse suggérée puis publiée sur un avis ;
- le rapport mensuel en PDF ;
- la facturation et le back-office.

C'est ce que permet le mode démonstration : chaque dépendance absente bascule
sur un mode dégradé explicite plutôt que d'empêcher le démarrage.

Ce qu'il ne faut **pas** promettre en démonstration : que les avis affichés
viennent de la vraie fiche Google du client. Ils n'en viennent pas encore.

---

## 7. Audit du 19 septembre 2026

Passe de vérification systématique : audit des contrôles d'accès route par
route, exécution de l'adaptateur PostgreSQL contre une vraie base, sondage des
cas limites. **Sept défauts trouvés, tous corrigés et couverts par un test.**

### Sécurité — deux failles de cloisonnement

| Défaut | Portée | Correctif |
|---|---|---|
| `POST /ops/ingest` et `/ops/trends` ouverts à tout gérant | Un client pouvait déclencher l'ingestion de **tout le parc** : appels aux API des plateformes et dépenses de modèle de langage de tous les autres établissements | Routes supprimées ; seules les versions `/admin/ops/*` subsistent, derrière `requireAdmin` |
| `POST /alerts/:id/read` sans contrôle d'appartenance | L'identifiant d'une alerte suffisait à la marquer lue chez un autre établissement | Lecture préalable de l'alerte puis `assertAccess` |

### Exploitabilité — trois défauts

| Défaut | Conséquence | Correctif |
|---|---|---|
| Toute saisie invalide renvoyait **500 « Erreur interne »** | Les alertes d'exploitation se déclenchaient sur de la simple mauvaise saisie ; un intégrateur caisse réessayait une requête qui ne passerait jamais | 400 avec le nom du champ fautif et `code: "validation"` |
| Plaquette sans plateforme active : **500** | Une configuration incomplète ressemblait à une panne, sur la page vue par le client | 409 avec `code: "not_configured"` et le motif |
| Refus de conformité en **500** | Idem : une règle métier appliquée passait pour un bug | 422, requête bien formée mais refusée |

### Données — deux incohérences

| Défaut | Conséquence | Correctif |
|---|---|---|
| Le script d'amorçage ignorait abonnements, factures, préférences et tickets | Sur PostgreSQL, le back-office affichait **0 € de MRR** et aucune facture | Amorçage complété ; les factures repassent par le compteur légal |
| L'Hôtel Garonne (offre Essentiel, quota 1 plateforme) avait **deux** plateformes actives | Le jeu de démonstration contredisait sa propre règle de quota ; réactiver Google était ensuite refusé | TripAdvisor désactivée, ses avis restent affichés dans la répartition |

### Outillage

Les fichiers de test n'étaient **pas typecheckés** : les `tsconfig` de build
n'incluent que `src`. Une doublure de service à laquelle il manquait une méthode
passait la compilation et n'échouait qu'à l'exécution, avec une erreur sans
rapport apparent. `tsconfig.typecheck.json` couvre désormais `src`, `test` et
`scripts` — il a immédiatement trouvé ce cas et quatre erreurs de typage
latentes dans le modèle financier.

Formatage : le tableau de bord affichait « 3.89 » à l'anglaise alors que les PDF
étaient en français. Uniformisé en « 3,89 ».

### Ce qui a été vérifié contre une vraie base PostgreSQL

L'adaptateur Prisma n'avait jamais été exécuté — la suite de tests tourne sur
l'adaptateur mémoire. Il l'est maintenant :

- schéma appliqué (16 tables), jeu de démonstration chargé ;
- **54 contrôles de bout en bout** passés par le réseau (`scripts/smoke-test.mjs`) ;
- **12 onboardings simultanés** : 24 factures, aucun doublon, aucun trou dans la
  numérotation légale. Le compteur transactionnel tient sous concurrence ;
- interface web vérifiée sur cette base : back-office, tableau de bord, factures.

Un conflit de port a été corrigé au passage : le conteneur écoutait sur 5432,
déjà pris par un PostgreSQL local sur beaucoup de postes. La collision se
manifestait par une erreur d'authentification trompeuse. Il écoute désormais sur
**5433**.

### Ce que cet audit ne prouve pas

- Qu'il n'y a plus aucun bug. Un audit trouve des défauts, il n'en démontre pas
  l'absence.
- Que les notifications arrivent sur un vrai téléphone : il y faut un domaine
  HTTPS et un appareil réel (§3).
- Que les vrais avis Google entrent : l'accès API reste à obtenir (§2).
- ~~Il n'y a aucune limitation de débit sur les routes publiques.~~
  **Corrigé le 19 septembre 2026** (commit `7a68f2b`) : limitation sur toute
  l'API, comptage partagé en base, 18 tests. Voir `docs/securite.md` §4.

---

## 8. Reproduire les vérifications

```bash
npm test                                 # 306 tests, sans base ni réseau
npm run typecheck                        # TypeScript strict, tests et scripts compris
node scripts/smoke-test.mjs              # 54 contrôles de bout en bout, par le réseau
node scripts/push-selftest.mjs           # chaîne de notification, 2 phases
npx tsx scripts/pg-verify.mts            # adaptateur Prisma (DATABASE_URL requis)
bash scripts/check-secrets.sh            # secrets : fichiers suivis ET historique
node scripts/pos-webhook-demo.mjs <clé>  # webhook caisse signé
npx tsx scripts/financial-model.ts       # régénère le modèle financier
```

Pour exercer l'adaptateur PostgreSQL plutôt que la mémoire :

```bash
npm run db:up                            # conteneur sur le port 5433
export DATABASE_URL=postgresql://avisio:avisio@localhost:5433/avisio
npm run db:push && npm run seed
npx tsx apps/api/src/server.ts &
node scripts/smoke-test.mjs              # doit annoncer « PostgreSQL (Prisma) »
```

Pour `push-selftest.mjs`, l'API doit tourner avec
`NODE_TLS_REJECT_UNAUTHORIZED=0` (certificat de test auto-signé) et `openssl`
doit être disponible — il est livré avec Git sous Windows.

---

## 9. Audit du 19 septembre 2026 — finalisation

Quatre lots de travail, tous committés et vérifiés.

### Ce qui a été trouvé et corrigé

| Défaut | Gravité | Correctif |
|---|---|---|
| Aucune limitation de débit sur l'API | **haute** | Limitation complète, comptage partagé en base (`7a68f2b`) |
| `/push/unsubscribe` sans contrôle de propriété | **haute** | Un gérant pouvait couper les notifications d'un autre, donc l'aveugler sur ses avis négatifs. Restreint au compte authentifié |
| `trustProxy: true` sans proxy | **haute** | L'IP étant la clé de toute la limitation, la croire sur parole l'annulait. Désactivé par défaut, réglable par `TRUST_PROXY` |
| Connecteur Google mono-locataire | **haute** | Un jeton global ne peut pas exister : personne ne consent pour autrui. Consentement par établissement (`6d24386`) |
| Jetons OAuth prévus en clair | **haute** | Scellement AES-256-GCM |
| Prompts ouverts à l'injection | moyenne | Clôture neutralisée, texte borné, consigne rappelée après la donnée (`c22b4b4`) |
| Aucun plafond de dépense modèle | moyenne | Plafond horaire, délai de garde, repli heuristique |
| `/health` superficielle | moyenne | Interroge la base, répond 503 sinon |
| CORS reflétant toute origine | moyenne | Restreint hors routes publiques |
| Plaquette non configurée → 409 au client | moyenne | Page calme en six langues (`c22b4b4`) |
| Quota d'API tierce gaspillé | faible | `lastReviewDate` filtré par plateforme en base |
| 429 par compte sans `retry-after` | faible | Aligné sur celui du crochet global |
| Autotest annonçant une panne inexistante | faible | Rendu déterministe (`939888a`) |

### Ce qui a été vérifié contre une vraie base

PostgreSQL 16, conteneur jetable sur le port 5433 :

- 54 / 54 contrôles de bout en bout par le réseau.
- 18 / 18 sur l'adaptateur Prisma, dont le SQL brut de la limitation de débit
  sous **60 requêtes simultanées** : aucun incrément perdu.
- Chaîne de notification complète : 240 octets chiffrés livrés, alerte créée,
  notification poussée.
- Parcours d'import mené dans l'interface : prévisualisation nommant chaque
  ligne refusée, écriture, alerte sur l'avis 1★, provenance `import` en base.
- Plaquette sans plateforme active : page en français, sans erreur technique.

### Ce qui reste invérifié, et pourquoi

| Point | Raison |
|---|---|
| Lecture d'avis Google réels | Accès API non accordé. Aucune doublure ne peut en tenir lieu |
| Envoi d'e-mails réels | Pas de clé Resend ; le repli console est ce qui a été exercé |
| Réception d'un push sur un vrai téléphone | Demande un domaine en HTTPS |
| Déploiement, sauvegarde, restauration | Rien n'est déployé à ce jour |
| Montée en charge | Aucune mesure |

**Un audit trouve des défauts, il ne prouve pas leur absence.** Ce tableau
dit ce qui a été cherché et trouvé, pas que le reste est sain.
