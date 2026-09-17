# Avisio

**Portail de collecte et de pilotage des avis clients par plaquette NFC.**

Le client approche son téléphone d'une plaquette posée au comptoir, une page
s'ouvre, il tape une fois et il est sur la plateforme d'avis. Côté gérant :
alerte immédiate sur les avis négatifs, réponse rédigée dans son ton de marque,
routage entre plateformes et lecture automatique de ce que disent les clients.

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
(données en mémoire, jeu de démonstration chargé) et l'interface est disponible :

| Adresse | Contenu |
|---|---|
| http://localhost:3000 | Site vitrine, tarifs, simulateur de devis |
| http://localhost:3000/login | Espace gérant — `demo@avisio.fr` / `demo1234` |
| http://localhost:3000/s/k7m2p9qa | Landing NFC (restaurant, offre Premium) |
| http://localhost:3000/s/z2q7v4kh | Landing NFC (hôtel, offre Essentiel) |
| http://localhost:3000/widget/est_comptoir | Widget avis embarquable |
| http://localhost:4000/health | État de l'API et mode d'exécution |

La landing NFC détecte la langue du téléphone. Pour l'essayer :

```bash
curl -H 'accept-language: it-IT,it;q=0.9' http://localhost:4000/public/tag/k7m2p9qa
```

## Tests

```bash
npm test
```

126 tests : 91 sur le domaine métier (tarification, routage, conformité, NLP,
tendances, benchmark, fidélité, i18n) et 35 tests d'intégration de l'API. Ils
tournent sans base de données, sans Docker et sans réseau.

```bash
npm run typecheck   # TypeScript strict sur les trois paquets
npm run build       # build de production
```

## Avec une vraie base de données

```bash
npm run db:up                                                    # PostgreSQL 16 via Docker
echo 'DATABASE_URL=postgresql://avisio:avisio@localhost:5432/avisio' >> .env
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

C'est ce qui permet de faire une démonstration commerciale sur un ordinateur
portable, sans connexion, avec exactement le même code qu'en production.

## Structure

```
packages/core/     Domaine métier pur, sans dépendance — 91 tests
apps/api/          API REST Fastify + Prisma — 35 tests d'intégration
apps/web/          Next.js : landing NFC, espace gérant, vitrine, widget
docs/              Business plan, modèle financier, architecture, conformité, GTM
scripts/           Modèle financier exécutable
infra/             PostgreSQL de développement
```

## Documentation

| Document | Contenu |
|---|---|
| [`docs/business-plan.md`](docs/business-plan.md) | Le plan complet : problème, offre, conformité, économie, lancement, risques |
| [`docs/modele-financier.md`](docs/modele-financier.md) | Projection 36 mois, économie unitaire, sensibilité — **généré** par `scripts/financial-model.ts` |
| [`docs/architecture.md`](docs/architecture.md) | Architecture, modèle de données, moteur de routage, exploitation, passage à l'échelle |
| [`docs/conformite.md`](docs/conformite.md) | Cadre réglementaire, RGPD, mise en œuvre exécutable des règles |
| [`docs/go-to-market.md`](docs/go-to-market.md) | Cible, argumentaire, objections, processus de vente, rétention |

Le modèle financier se régénère :

```bash
npx tsx scripts/financial-model.ts
```

## Ce qui n'est pas fait

Par honnêteté, et par ordre de priorité :

1. **Facturation et encaissement** — bloquant au-delà d'une vingtaine de clients.
2. **Accès API Google Business Profile** — le connecteur est écrit, l'accès
   partenaire est à demander (4 à 8 semaines de délai).
3. **Onboarding autonome** — un établissement se crée aujourd'hui en base.
4. **Notifications push** — les alertes passent par e-mail.
5. **Export PDF du rapport mensuel**.
6. **Accès partenaires TripAdvisor / Facebook / Yelp** — connecteurs simulés.

## Licence

Propriétaire — @OZEN, 2026.
