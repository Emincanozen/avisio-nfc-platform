# cloud.md — guide technique d'Avisio

Guide autonome, destiné à n'importe quel assistant ou développeur reprenant le
projet. Il décrit le code **tel qu'il est**. Ce qui est prévu mais non
implémenté est signalé comme tel.

Dernière révision : 19 septembre 2026, commit `939888a`.

---

## 1. Vision du produit

Un établissement de proximité vit de ses avis en ligne, et n'a ni le temps ni
l'outillage pour s'en occuper. Avisio résout trois problèmes à la fois :

- **Le volume.** Une plaquette NFC au comptoir : le client approche son
  téléphone, tape une fois, dépose son avis. Pas d'application, pas de compte.
- **Le délai de réaction.** Un avis négatif alerte le gérant en quelques
  minutes, avec une réponse déjà rédigée dans son ton de marque.
- **La répartition.** Le moteur de routage envoie chaque client vers la
  plateforme où l'établissement est le plus en retard.

Modèle : abonnement mensuel, 29 € / 79 € / 149 €, plus des options.

**Contrainte fondatrice** : le produit augmente le volume d'avis, il ne les
trie pas. Le filtrage est interdit par la directive UE 2019/2161. Cette règle
est exécutable, pas seulement écrite : voir §11.

## 2. Fonctionnalités existantes

| Domaine | État | Où |
|---|---|---|
| Parcours NFC, 6 langues | fonctionnel | `routes/public.ts`, `app/s/[slug]` |
| Routage multi-plateformes | fonctionnel | `core/routing.ts` |
| Analyse sémantique | fonctionnel (LLM + repli heuristique) | `core/nlp.ts`, `services/anthropic.ts` |
| Alertes avis négatifs | fonctionnel | `services/ingest.ts` |
| Suggestions de réponse | fonctionnel | `services/anthropic.ts` |
| Notifications e-mail + push | fonctionnel, vérifié jusqu'à la requête chiffrée | `services/notify.ts`, `push.ts` |
| Tendances thématiques | fonctionnel | `core/trends.ts` |
| Benchmark sectoriel (k-anonymat) | fonctionnel | `core/benchmark.ts` |
| Fidélité | fonctionnel | `core/loyalty.ts` |
| Rapport mensuel HTML + PDF | fonctionnel | `core/report.ts`, `services/pdf.ts` |
| Abonnements, factures, relances | fonctionnel | `core/billing.ts`, `services/billing.ts` |
| Intégration caisse (webhook HMAC) | fonctionnel | `routes/integrations.ts`, `core/pos.ts` |
| Back-office d'exploitation | fonctionnel | `routes/admin.ts`, `app/admin` |
| Import manuel d'avis | fonctionnel | `core/import.ts`, `routes/google.ts` |
| Consentement Google par établissement | **implémenté, jamais exécuté** | `services/google-oauth.ts` |
| Lecture d'avis Google réels | **bloqué** — accès API non accordé | `services/google.ts` |
| Encaissement automatique | **non implémenté** | — |
| Envoi de SMS | **non implémenté** (journalisé) | `services/pos.ts` |

## 3. Architecture

```mermaid
graph TB
    subgraph Public
        NFC[Plaquette NFC]
        Client[Client final]
        Caisse[Caisse du client]
    end

    subgraph "apps/web — Next.js 15"
        Landing["/s/:slug — rendu serveur"]
        Dash["/dashboard — espace gérant"]
        Admin["/admin — back-office"]
        Widget["/widget/:id — embarquable"]
    end

    subgraph "apps/api — Fastify 5"
        RL[Limitation de débit]
        Routes[Routes]
        Services[Services]
        Jobs[Traitements de fond]
    end

    subgraph "packages/core — domaine pur"
        Core[Tarification · Facturation · Routage<br/>Conformité · NLP · Import]
    end

    subgraph Externe
        Google[Google Business Profile]
        Claude[API Claude]
        Push[Service de push navigateur]
        Mail[Resend]
    end

    DB[(PostgreSQL)]

    Client --> NFC --> Landing
    Landing --> RL
    Dash --> RL
    Admin --> RL
    Widget --> RL
    Caisse -->|webhook signé HMAC| RL
    RL --> Routes --> Services
    Routes --> Core
    Services --> Core
    Services --> DB
    Jobs --> Services
    Services -.OAuth par établissement.-> Google
    Services -.repli heuristique.-> Claude
    Services -.VAPID.-> Push
    Services -.repli console.-> Mail
```

### Le choix central : port et adaptateurs

`apps/api/src/repository/types.ts` définit **le** port de persistance. Deux
implémentations :

- `memory.ts` — jeu de démonstration chargé au démarrage, aucune dépendance.
- `prisma.ts` — PostgreSQL, chargé dynamiquement.

Ce que cela achète : une démonstration commerciale sur un portable sans base,
sans Docker et sans réseau, avec **exactement le même code** qu'en production.

Ce que cela coûte, et qu'il faut savoir : toute table ajoutée doit l'être dans
les deux adaptateurs, et la suite de tests n'exerce que celui en mémoire. Le
code Prisma peut compiler, passer le typecheck et s'écrouler à la première
requête réelle — c'est déjà arrivé, d'où `scripts/pg-verify.mts`.

### Mode dégradé

Le client Prisma est importé dynamiquement et typé par une interface
structurelle minimale, parce que `@prisma/client` n'est typé qu'après
`prisma generate`, qui exige une `DATABASE_URL`.

| Variable absente | Conséquence |
|---|---|
| `DATABASE_URL` | Mémoire + jeu de démonstration |
| `ANTHROPIC_API_KEY` | Moteur heuristique local (lexique français) |
| `GOOGLE_CLIENT_ID` / `_SECRET` | Connecteur simulé, import manuel proposé |
| `RESEND_API_KEY` | E-mails en console |
| `VAPID_*` | Push en console |

`GET /health` annonce l'état réel dans `capabilities`.

## 4. Frontend et backend

### Frontend — `apps/web`

Next.js 15 App Router, React 19. Aucune bibliothèque d'interface : CSS écrit à
la main dans `globals.css`, variables CSS pour le thème.

| Route | Rendu | Notes |
|---|---|---|
| `/` | serveur | Vitrine, tarifs, simulateur de devis |
| `/login` | client | Jeton en `localStorage` |
| `/s/[slug]` | **serveur** | Landing NFC. Budget : moins d'une seconde en 4G médiocre. Pas de police distante, pas d'image, pas de JS bloquant |
| `/dashboard/[id]/*` | client | 7 onglets |
| `/admin/*` | client | 5 pages, réservé au rôle `admin` |
| `/widget/[id]` | serveur | Embarquable sur le site du client |

PWA installable (`public/sw.js`, `manifest.json`) : c'est ce qui permet au
gérant de recevoir les notifications sur son téléphone.

La session vit en `localStorage`, jamais en cookie : l'espace gérant est une
application monopage derrière l'API, et un jeton porté par un en-tête ne
souffre pas de CSRF.

### Backend — `apps/api`

Fastify 5, validation Zod, JWT via `@fastify/jwt`.

`buildApp(deps)` construit une instance complète à partir d'un dépôt injecté.
Aucun singleton, aucune dépendance globale : le serveur l'appelle avec
l'adaptateur choisi, les tests avec l'adaptateur mémoire.

Ordre de traitement d'une requête :

```mermaid
sequenceDiagram
    participant C as Client
    participant H as Crochet global
    participant A as Garde de route
    participant R as Route
    participant D as Dépôt

    C->>H: requête
    H->>D: compteur de débit (par IP)
    alt budget dépassé
        H-->>C: 429 + retry-after
    else
        H->>A: authenticate / requireAdmin
        alt jeton invalide
            A-->>C: 401
        else
            A->>R: requête authentifiée
            R->>R: parse Zod → 400 si invalide
            R->>R: assertAccess → 403 si hors périmètre
            R->>D: lecture / écriture
            R-->>C: 200
        end
    end
```

Le limiteur est un crochet **global**, enregistré avant les routes : un déluge
de tentatives de connexion est refusé avant d'atteindre le calcul de condensat
du mot de passe, qui est volontairement lent.

## 5. Base de données

18 tables. `apps/api/prisma/schema.prisma`.

```mermaid
erDiagram
    Manager }o--o{ Establishment : gère
    Establishment ||--o{ PlatformLink : "liens plateformes"
    Establishment ||--o{ NfcTag : plaquettes
    Establishment ||--o{ ScanEvent : scans
    Establishment ||--o{ Review : avis
    Establishment ||--o{ Alert : alertes
    Establishment ||--o{ LoyaltyMember : fidélité
    Establishment ||--o| Subscription : abonnement
    Establishment ||--o{ Invoice : factures
    Establishment ||--o| NotificationPreference : préférences
    Establishment ||--o{ PosTicket : tickets
    Establishment ||--o| GoogleConnection : "autorisation OAuth"
    Review ||--o{ Alert : déclenche
    Manager ||--o{ PushSubscription : appareils
```

Tables sans relation : `InvoiceCounter` (numérotation légale), `PendingPush`
(file des heures calmes), `RateCounter` (limitation de débit).

Points à connaître :

- `Review` a une contrainte d'unicité sur `(establishmentId, platform,
  externalId)`. C'est elle qui rend l'ingestion et l'import **idempotents**.
- `Review.source` vaut `sync` ou `import`. La distinction existe pour qu'aucun
  chiffre ne laisse croire à une connexion en direct qui n'existe pas.
- `InvoiceCounter` est incrémenté **dans la même transaction** que la création
  de facture. C'est ce qui garantit une séquence sans trou, exigée par
  l'art. 242 nonies A du CGI. Vérifié sous 12 onboardings simultanés.
- `RateCounter` est incrémenté par `INSERT ... ON CONFLICT DO UPDATE ...
  RETURNING`, seul endroit du dépôt où Prisma est contourné : un `upsert`
  ferait deux allers-retours et laisserait deux requêtes simultanées ne se
  compter qu'une fois.
- `GoogleConnection.refreshTokenSealed` est chiffré en AES-256-GCM.

## 6. Authentification

```mermaid
sequenceDiagram
    participant N as Navigateur
    participant A as API
    participant D as Base

    N->>A: POST /auth/login
    A->>A: budget par compte (10 / 15 min)
    Note over A: consommé AVANT vérification,<br/>y compris sur un compte inexistant
    A->>D: managers.findByEmail
    A->>A: scrypt
    A-->>N: JWT 12 h {sub, role, establishmentIds}
    N->>N: localStorage
    N->>A: Authorization: Bearer ...
    A->>A: jwtVerify → request.role, establishmentIds
    A->>A: assertAccess(establishmentId)
```

Deux rôles : `owner` (ses établissements) et `admin` (tout le parc, traverse
`assertAccess` — c'est le propre du back-office).

## 7. Cloisonnement multi-établissements

Le point le plus sensible du produit. Deux formes :

**Route portant un identifiant d'établissement** → `assertAccess(request, id)`
directement.

**Route portant l'identifiant d'une ressource** (avis, alerte, facture) →
charger la ressource, **puis** `assertAccess` sur l'établissement
propriétaire. L'identifiant transmis par le client n'est jamais une preuve
d'autorisation.

Trois failles de la seconde forme ont été trouvées et corrigées, chacune avec
son test de non-régression. Voir `docs/securite.md` §2.

## 8. Ingestion

```mermaid
flowchart LR
    A[Toutes les 20 min] --> B[Pour chaque établissement]
    B --> C{Lien actif ?}
    C -->|non| B
    C -->|oui| D[Dernier avis connu<br/>SUR cette plateforme]
    D --> E[connector.fetchReviews]
    E -->|NotConnectedError| B
    E -->|erreur| F[Inscrite sur la connexion]
    E -->|avis| G[upsertMany — dédoublonnage]
    G --> H[llm.analyze]
    H --> I{note ≤ 3 ?}
    I -->|oui| J[Alerte + notification]
    I -->|non| K[Stocké]
```

Trois détails qui comptent :

- **Le dernier avis connu est filtré par plateforme en base.** Prendre les 200
  avis les plus récents toutes plateformes confondues faisait perdre la borne
  temporelle sur les plateformes peu actives, et rapatriait tout l'historique
  à chaque cycle — du quota d'API tierce brûlé à chaque passage.
- **Une fiche non connectée n'est pas un incident**, c'est un onboarding en
  cours : `NotConnectedError` est traitée à part, sans polluer les journaux.
- **Une connexion rompue est enregistrée et affichée.** Une synchronisation
  qui s'éteint en silence est pire que pas de synchronisation : le gérant se
  croit couvert sans l'être.

## 9. Analyse par modèle de langage

`services/anthropic.ts`. Modèle Claude Opus 5. Effort `low` pour l'analyse
(classification courte), `medium` pour la rédaction de réponse (elle engage
l'image de l'établissement).

Garde-fous :

| Protection | Valeur |
|---|---|
| Plafond horaire | 500 appels / processus, puis repli heuristique |
| Délai de garde | 30 s |
| Reprises | 1 |
| Texte d'avis borné | 4 000 caractères |
| Clôture de bloc neutralisée | oui |
| Consigne rappelée après la donnée | oui |
| Sortie en liste blanche | thèmes, score borné |
| Publication automatique | **jamais** |

Le repli est systématique : erreur, quota, sortie illisible ou plafond
atteint renvoient au moteur heuristique local (lexique français,
`core/nlp.ts`). Un avis analysé approximativement reste exploitable ; un avis
non analysé disparaît du tableau de bord.

**Un avis client est une donnée, jamais une consigne.** Voir `docs/securite.md`
§6.

## 10. Abonnements et factures

```mermaid
stateDiagram-v2
    [*] --> active: onboarding
    active --> active: facture mensuelle
    active --> past_due: échéance dépassée
    past_due --> active: règlement constaté
    past_due --> suspended: 30 jours
    suspended --> active: régularisation
    active --> cancelled: résiliation
    cancelled --> [*]
```

- Numérotation `AVS-2026-000001`, continue et sans trou, réservée dans la
  transaction de création. Exigence légale, pas confort.
- PDF avec mentions obligatoires (`services/pdf.ts`). **PDFKit encode en
  WinAnsi : pas de `→`, pas d'emoji.**
- Prorata au changement d'offre, relances, suspension à 30 jours.
- **L'encaissement n'est pas automatisé.** Le règlement est constaté à la main
  depuis le back-office. Brancher un prestataire revient à écrire un second
  adaptateur `PaymentProvider` ; rien d'autre ne change.

## 11. Conformité, exécutable

`packages/core/src/compliance.ts`, 24 tests.

- `checkLandingConfig` refuse toute configuration demandant la note avant
  redirection.
- `checkLoyaltyRule` refuse toute récompense conditionnée à la note.
- `assertCompliant` lève une `ComplianceError` → **422**, pas 500 : la requête
  est bien formée, elle est refusée.

L'API ne reçoit jamais la note pressentie d'un client : le routage **ne peut
pas** en dépendre, même par erreur de programmation.

## 12. Intégrations externes

| Service | État | Détail |
|---|---|---|
| Google Business Profile | **bloqué** | OAuth par établissement implémenté ; accès API non accordé. Quota par défaut : 0 req/min. Voir `docs/google.md` |
| API Claude | fonctionnel | Repli heuristique |
| Web Push (VAPID) | fonctionnel | Requête chiffrée vérifiée ; livraison par Google/Mozilla non testée |
| Resend | implémenté, non testé | Repli console |
| TripAdvisor / Facebook / Yelp | simulés | Accès partenaires non demandés |
| SMS | **non implémenté** | Journalisé |

## 13. Infrastructure

Voir `docs/deploiement.md`. En résumé : deux processus Node derrière un
reverse proxy, PostgreSQL, TLS obligatoire (le push l'exige).

Traitements de fond, démarrés avec l'API :

| Tâche | Cadence |
|---|---|
| Ingestion | 20 min |
| Tendances | 24 h |
| Facturation et relances | 6 h |
| Push différés (heures calmes) | 5 min |
| Rapports mensuels | le 1er du mois |

Intégration continue (`.github/workflows/ci.yml`) : typecheck, tests, build ;
un job PostgreSQL séparé qui exerce l'adaptateur Prisma ; un job de recherche
de secrets dans l'historique.

## 14. Dépendances

Volontairement peu nombreuses.

| Paquet | Rôle |
|---|---|
| `fastify` 5 | API |
| `zod` 3 | Validation |
| `@fastify/jwt`, `@fastify/cors` | Sessions, CORS |
| `@prisma/client`, `prisma` 6 | PostgreSQL |
| `@anthropic-ai/sdk` | Modèle de langage |
| `pdfkit` | Factures et rapports |
| `web-push` | Notifications |
| `next` 15, `react` 19 | Interface |
| `vitest` 3, `typescript` 5.7, `tsx` | Outillage |

Aucune bibliothèque d'interface, aucun ORM au-dessus de Prisma, aucun
framework de tests au-delà de Vitest. L'analyseur CSV est écrit à la main :
les exports de plateformes contiennent des commentaires à virgules, guillemets
doublés et retours à la ligne, et c'est exactement là que les analyseurs naïfs
tronquent un avis sans rien signaler.

## 15. Valider une modification

Dans l'ordre, du moins cher au plus cher :

```bash
npm run typecheck    # couvre src, test ET scripts
npm test             # 306 tests
npm run build
```

Si l'adaptateur Prisma a changé :

```bash
npm run db:up
DATABASE_URL=postgresql://avisio:avisio@localhost:5433/avisio npm run db:push
DATABASE_URL=... npx tsx scripts/pg-verify.mts
# puis, API démarrée sur cette base :
node scripts/smoke-test.mjs
```

Si les notifications ont changé :

```bash
NODE_TLS_REJECT_UNAUTHORIZED=0 npm run dev -w @avisio/api
node scripts/push-selftest.mjs
```

Avant de pousser : `bash scripts/check-secrets.sh`.

> **Un test de non-régression doit échouer sans le correctif.** Un test qui
> passe dans les deux cas ne prouve rien et donne une fausse assurance, ce qui
> est pire que pas de test du tout.
