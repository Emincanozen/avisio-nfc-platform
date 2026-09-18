# État des lieux — ce qui marche, ce qui ne marche pas

Document de vérité sur l'état réel du logiciel au 18 septembre 2026.
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
3. Avisio lit cet avis                         ❌ ACCÈS GOOGLE MANQUANT
4. Avisio l'analyse et crée une alerte         ✅ vérifié
5. Avisio pousse la notification               ✅ vérifié
6. Le gérant la reçoit sur son téléphone       ⚠️  vérifié en local, pas sur un vrai appareil
```

**Conclusion honnête : en l'état, un vrai avis Google ne déclenche pas de
notification, parce que le produit ne peut pas encore lire les avis Google.**
Tout le reste derrière est prêt et testé.

---

## 2. Vérification du maillon 3 — la lecture des avis

C'est le seul blocage, et il est administratif, pas technique.

| | |
|---|---|
| **Ce qui est écrit** | Le connecteur Google Business Profile complet : rafraîchissement du jeton OAuth, pagination, arrêt sur le dernier avis connu, lecture des compteurs, publication des réponses. |
| **Ce qui manque** | L'autorisation d'accès à l'API, à demander à Google. Délai annoncé : 4 à 8 semaines. |
| **Ce qui tourne en attendant** | Un connecteur simulé, même interface et mêmes cadences, qui produit des avis avec une distribution de notes réaliste. |
| **Comment le savoir** | `GET /health` et le journal de démarrage annoncent `Google: simulé` ou `Google: connecté`. |

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
| Facturation : émission, numérotation, prorata | 27 tests + back-office réel |
| PDF de facture et de rapport | PDF générés et relus page par page |
| Relances et suspension | Déclenchement réel depuis le back-office |
| Intégration caisse (webhook signé) | Appel externe réel via `pos-webhook-demo.mjs` |
| Onboarding complet | Établissement créé de bout en bout dans l'interface |
| Back-office et séparation des rôles | 45 tests + parcours réel (403 pour un gérant) |

### Simulé faute d'accès externe

| Fonctionnalité | Ce qui manque | Conséquence aujourd'hui |
|---|---|---|
| **Lecture des avis Google** | Autorisation API Google Business Profile | **Les vrais avis n'entrent pas.** Avis simulés à la place |
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

## 7. Reproduire les vérifications

```bash
npm test                              # 230 tests, sans base ni réseau
npm run typecheck                     # TypeScript strict
node scripts/push-selftest.mjs        # chaîne de notification, 2 phases
node scripts/pos-webhook-demo.mjs <clé>  # webhook caisse signé
npx tsx scripts/financial-model.ts    # régénère le modèle financier
```

Pour `push-selftest.mjs`, l'API doit tourner avec
`NODE_TLS_REJECT_UNAUTHORIZED=0` (certificat de test auto-signé) et `openssl`
doit être disponible — il est livré avec Git sous Windows.
