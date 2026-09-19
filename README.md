# Avisio

**Portail de collecte et de pilotage des avis clients par plaquette NFC.**

Le client approche son téléphone d'une plaquette posée au comptoir, une page
s'ouvre, il tape une fois et il est sur la plateforme d'avis. Côté gérant :
alerte immédiate sur les avis négatifs, réponse rédigée dans son ton de marque,
routage entre plateformes, rapport mensuel et lecture automatique de ce que
disent les clients. Côté exploitant : un back-office avec le parc, la
facturation et les traitements de fond.

> **Règle structurante : Avisio augmente le volume d'avis, il ne les trie pas.**
> Aucune étape ne demande la note avant la redirection, aucune récompense ne
> dépend de la note, aucun avis n'est masqué ni retardé. Ces règles sont
> implémentées dans `packages/core/src/compliance.ts` et vérifiées par les
> tests — pas seulement écrites dans les CGV.

---

## Démarrage

```bash
npm install
npm run dev
```

C'est tout. Sans aucune configuration, l'API démarre en mode démonstration
(données en mémoire, jeu de démonstration chargé) et l'interface est disponible.

| Compte | Accès |
|---|---|
| `demo@avisio.fr` / `demo1234` | Espace gérant — 3 établissements |
| `admin@avisio.fr` / `admin1234` | Back-office d'exploitation, tout le parc |

| Adresse | Contenu |
|---|---|
| http://localhost:3000 | Site vitrine, tarifs, simulateur de devis |
| http://localhost:3000/login | Connexion |
| http://localhost:3000/admin | Back-office : parc, factures, onboarding, comptes |
| http://localhost:3000/s/k7m2p9qa | Landing NFC (restaurant, offre Premium) |
| http://localhost:3000/s/z2q7v4kh | Landing NFC (hôtel, offre Essentiel) |
| http://localhost:3000/widget/est_comptoir | Widget avis embarquable |
| http://localhost:4000/health | État de l'API et mode d'exécution |

La landing NFC détecte la langue du téléphone :

```bash
curl -H 'accept-language: it-IT,it;q=0.9' http://localhost:4000/public/tag/k7m2p9qa
```

## Ce que fait le produit

| Domaine | Détail |
|---|---|
| **Parcours NFC** | Une plaquette, un tap, une plateforme choisie par le moteur de routage. Page rendue côté serveur, traduite en six langues. |
| **Avis négatifs** | Ingestion périodique, analyse sémantique, alerte e-mail et push, réponse suggérée dans le ton de marque, contrôle des formulations à risque. |
| **Multi-plateformes** | Routage pondéré par déficit de présence entre Google, TripAdvisor, Facebook, Yelp et TheFork. |
| **Analytics** | Tableau de bord, thèmes récurrents, alertes de tendance, benchmark sectoriel anonymisé (k-anonymat). |
| **Fidélité** | Points accordés pour le dépôt d'un avis, jamais pour sa note. Contacts stockés en condensat. |
| **Notifications** | E-mail et push web (PWA installable), préférences par événement, heures calmes qui diffèrent le push sans retenir l'e-mail. |
| **Rapport mensuel** | Envoyé le 1er du mois aux offres éligibles, en HTML et en PDF. |
| **Intégration caisse** | Webhook signé HMAC, invitation différée de 2 h, carence de 30 jours par client, URL à imprimer sur le ticket. |
| **Facturation** | Abonnements, numérotation légale continue, PDF avec mentions obligatoires, prorata au changement d'offre, relances et suspension. |
| **Back-office** | MRR/ARR, attrition mesurée, impayés, onboarding complet en un écran, gestion des comptes, déclenchement des traitements. |

## Tests

```bash
npm test
```

236 tests : 150 sur le domaine métier (tarification, facturation, routage,
conformité, NLP, tendances, benchmark, fidélité, notifications, rapport, caisse)
et 86 tests d’intégration de l’API. Ils tournent sans base de données, sans
Docker et sans réseau.

```bash
npm run typecheck   # TypeScript strict, fichiers de test et scripts compris
npm run build       # build de production
```

Deux vérifications supplémentaires, contre un serveur en fonctionnement :

```bash
node scripts/smoke-test.mjs     # 54 contrôles de bout en bout, par le réseau
node scripts/push-selftest.mjs  # chaîne de notification, signature et chiffrement
```

`smoke-test.mjs` est le seul à exercer l'adaptateur PostgreSQL : la suite de
tests, elle, tourne sur l'adaptateur mémoire.

## Traitements de fond

Ils tournent automatiquement dès que l'API démarre, et se déclenchent aussi à la
main depuis le back-office (onglet **Vue d'ensemble**) :

| Tâche | Cadence | Rôle |
|---|---|---|
| Ingestion des avis | 20 min | Interroge les plateformes connectées, analyse et alerte |
| Tendances | 24 h | Détecte les thèmes qui montent |
| Facturation + relances | 6 h | Émet les factures échues, relance, suspend au-delà de 30 jours |
| Push différés | 5 min | Vide la file retenue par les heures calmes |
| Rapports mensuels | le 1er du mois | Envoie le rapport aux offres éligibles |

## Simuler une caisse

```bash
node scripts/pos-webhook-demo.mjs <clé>
```

La clé se génère depuis l'espace gérant, onglet **Caisse** (offre Premium). Le
script reproduit exactement la signature HMAC qu'un éditeur de caisse doit
produire.

## Avec une vraie base de données

```bash
npm run db:up                                                    # PostgreSQL 16 via Docker, port 5433
echo 'DATABASE_URL=postgresql://avisio:avisio@localhost:5433/avisio' >> .env
npm run db:push                                                  # schéma
npm run seed                                                     # jeu de démonstration
npm run dev
```

L'API bascule automatiquement sur l'adaptateur Prisma dès que `DATABASE_URL` est
renseignée, et l'annonce au démarrage.

## Configuration

Toutes les variables sont facultatives. Chaque dépendance absente bascule sur un
mode dégradé explicite plutôt que de faire échouer le démarrage — voir
`.env.example`.

| Variable | Absente ⇒ |
|---|---|
| `DATABASE_URL` | Données en mémoire + jeu de démonstration |
| `ANTHROPIC_API_KEY` | Analyse et réponses par le moteur heuristique local |
| `GOOGLE_CLIENT_ID` / `GOOGLE_REFRESH_TOKEN` | Connecteur Google simulé |
| `RESEND_API_KEY` | E-mails journalisés en console |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Push journalisés en console |

C'est ce qui permet de faire une démonstration commerciale sur un ordinateur
portable, sans connexion, avec exactement le même code qu'en production.

Pour activer réellement le push :

```bash
npx web-push generate-vapid-keys
```

## Structure

```
packages/core/     Domaine métier pur, sans dépendance — 150 tests
apps/api/          API REST Fastify + Prisma — 86 tests d'intégration
apps/web/          Next.js : landing NFC, espace gérant, back-office, vitrine, widget, PWA
docs/              Business plan, modèle financier, architecture, conformité, GTM
scripts/           Modèle financier, tests de bout en bout, simulateur de caisse
infra/             PostgreSQL de développement
```

## Documentation

| Document | Contenu |
|---|---|
| [`docs/etat-des-lieux.md`](docs/etat-des-lieux.md) | **Ce qui marche, ce qui est simulé, ce qui n'est pas fait** — vérifié ligne par ligne |
| [`docs/business-plan.md`](docs/business-plan.md) | Le plan complet : problème, offre, conformité, économie, lancement, risques |
| [`docs/modele-financier.md`](docs/modele-financier.md) | Projection 36 mois, économie unitaire, sensibilité — **généré** par `scripts/financial-model.ts` |
| [`docs/architecture.md`](docs/architecture.md) | Architecture, modèle de données, moteur de routage, exploitation, passage à l'échelle |
| [`docs/conformite.md`](docs/conformite.md) | Cadre réglementaire, RGPD, mise en œuvre exécutable des règles |
| [`docs/go-to-market.md`](docs/go-to-market.md) | Cible, argumentaire, objections, processus de vente, rétention |

Le modèle financier se régénère :

```bash
npx tsx scripts/financial-model.ts
```

## Est-ce que ça marche vraiment ?

Question légitime, réponse précise dans [`docs/etat-des-lieux.md`](docs/etat-des-lieux.md).
En résumé : **la chaîne de notification fonctionne et se vérifie**, mais elle
n'est pas encore branchée sur les vrais avis Google.

```
1. Le client scanne et tape                    ✅
2. Il dépose son avis sur Google               ✅
3. Avisio lit cet avis                         ❌ accès API Google à demander
4. Avisio l'analyse et crée une alerte         ✅ vérifié
5. Avisio pousse la notification               ✅ vérifié
6. Le gérant la reçoit sur son téléphone       ⚠️ vérifié en local
```

Pour le vérifier vous-même :

```bash
node scripts/push-selftest.mjs
```

Le script joue le navigateur du gérant et le service de push, en local et en
TLS. Il vérifie que la notification part réellement — signée VAPID, chiffrée
AES128GCM — puis qu'un avis négatif entrant déclenche bien une alerte et une
notification. L'API doit tourner avec `NODE_TLS_REJECT_UNAUTHORIZED=0` le temps
du test, le certificat du service simulé étant auto-signé.

## Ce qui n'est pas fait

Par honnêteté, et par ordre de priorité :

1. **Encaissement automatique.** La facturation est complète — émission,
   numérotation légale, PDF, relances, suspension — mais le règlement est
   constaté à la main depuis le back-office. Brancher un prestataire (mandat
   SEPA via GoCardless, ou Stripe Billing) revient à écrire un second adaptateur
   `PaymentProvider` ; rien d'autre ne change.
2. **Accès API Google Business Profile.** Le connecteur est écrit et testé,
   l'accès partenaire est à demander (4 à 8 semaines de délai). D'ici là, le
   connecteur simulé produit des avis à la cadence réelle.
3. **Accès partenaires TripAdvisor / Facebook / Yelp.** Même situation.
4. **Envoi de SMS.** Les invitations de caisse par SMS sont journalisées : il
   manque un opérateur (Brevo, OVH SMS). Le canal e-mail, lui, fonctionne.
5. **Plaquettes physiques.** Hors périmètre logiciel : fabrication, matériaux et
   fournisseurs sont traités séparément. Le produit gère déjà les URL, le
   contrôle de capacité NTAG213 et le comptage par emplacement.

## Licence

Propriétaire — @OZEN, 2026.
