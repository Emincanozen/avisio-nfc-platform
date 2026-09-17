# Business plan — Avisio

**Portail de collecte et de pilotage des avis clients par plaquette NFC**
Version 1.0 — 17 septembre 2026 — @OZEN

---

## 1. Résumé opérationnel

Un commerçant de proximité perd ses avis pour une raison simple : le client
satisfait repart sans rien dire, et le client mécontent, lui, écrit. Le résultat
est une note publique qui sous-estime la réalité de l'établissement, sur une
plateforme — Google — qui décide d'une part croissante de sa fréquentation.

Avisio corrige ce déséquilibre par un geste : une plaquette NFC posée au
comptoir ou sur l'addition. Le client l'approche de son téléphone, une page
s'ouvre, il tape une fois, il est sur la plateforme d'avis. Puis le produit
prend le relais côté gérant : alerte immédiate sur les avis négatifs, réponse
rédigée dans son ton de marque et validée par lui, répartition intelligente
entre plateformes, et lecture automatique de ce que les clients reprochent ou
saluent.

**Le positionnement tient en une phrase : Avisio augmente le volume d'avis
sincères, il ne trie pas les avis.** Cette contrainte n'est pas un slogan, elle
est inscrite dans le code (`packages/core/src/compliance.ts`) et vérifiée par
les tests : toute configuration qui reviendrait à filtrer les clients selon leur
satisfaction est rejetée par l'API.

| Indicateur | Valeur |
|---|---:|
| Offres | 29 € / 79 € / 149 € par mois et par établissement |
| Revenu moyen par établissement (ARPU) | 74 € / mois |
| Marge brute sur le récurrent | 96 % |
| Coût d'acquisition | 271 € |
| Retour sur acquisition | 3,8 mois |
| LTV / CAC | 8,7× |
| Besoin de financement | 40 000 € |
| Équilibre durable | mois 16 |
| ARR fin d'année 3 | 943 k€ (1 064 établissements) |

Le détail et les hypothèses sont dans [`modele-financier.md`](modele-financier.md),
généré par un script exécutable — pas par un tableur figé.

---

## 2. Le problème, chiffré

Trois faits structurent le marché :

1. **L'asymétrie de motivation.** Un client mécontent a une raison d'écrire ; un
   client satisfait n'en a aucune. Sans sollicitation, les avis spontanés
   sur-représentent l'insatisfaction.
2. **Le poids de la note locale.** Pour un restaurant ou un commerce de quartier,
   la fiche Google est devenue la vitrine principale. Un dixième de point sur la
   note moyenne se lit directement dans le flux de clients poussés par la
   recherche locale et Maps.
3. **L'absence de réponse.** La majorité des commerces indépendants ne répondent
   pas à leurs avis négatifs, faute de temps et faute de savoir quoi écrire.
   L'avis négatif reste donc en haut de la fiche, seul, sans contradiction.

Les outils existants adressent mal ce marché : ils sont soit trop chers et
pensés pour des chaînes (plateformes de gestion de réputation à plusieurs
centaines d'euros par mois), soit des gadgets — une carte NFC vendue une fois,
sans service derrière. Entre les deux, il y a la place d'un abonnement à
29-149 €, vendu en face-à-face, qui fait le travail à la place du gérant.

### Le piège à éviter

Une partie des acteurs du secteur pratique le **review gating** : la plaquette
demande d'abord une note, envoie les clients satisfaits sur Google et redirige
les mécontents vers un formulaire privé. C'est efficace à court terme et
sanctionnable à trois titres :

- **Règles Google** : la sollicitation sélective d'avis positifs est un motif de
  suppression des avis, voire de la fiche.
- **Directive (UE) 2019/2161 « Omnibus »**, transposée aux articles L.111-7-2 et
  L.121-4 21° du code de la consommation : laisser croire que tous les avis sont
  publiés alors qu'un tri a eu lieu est une pratique commerciale trompeuse.
- **Norme AFNOR NF Z74-501 / ISO 20488** : pas de sélection selon le contenu.

Construire là-dessus, c'est construire sur une base que la DGCCRF ou Google
peuvent faire tomber du jour au lendemain — en emportant le portefeuille clients
avec elle. **Avisio prend la position inverse et en fait un argument de vente.**

---

## 3. La solution — quatre axes

### Axe 1 — Gestion des avis négatifs

*Vendu seul : 25 €/mois. Inclus à partir de l'offre Pro.*

- Alerte e-mail et push dès qu'un avis 1 à 3 étoiles est publié sur une
  plateforme connectée.
- Suggestion de réponse générée par un modèle de langage, adaptée au ton de
  marque du commerce, validée en un clic avant publication.
- Contrôle automatique des formulations à risque : demander le retrait d'un avis,
  conditionner un geste à la note ou mettre en cause la véracité d'un avis
  déclenche un avertissement avant publication.
- Workflow de récupération de service : le geste commercial est proposé au
  client **en parallèle** de l'avis public, jamais à la place.
- Suivi du taux de réponse et du délai médian, avec un seuil de retard à 24 h.

**État d'avancement : implémenté.** Ingestion, analyse, alerte, suggestion,
publication et mesure fonctionnent de bout en bout.

### Axe 2 — Multi-plateformes

*Vendu seul : 15 €/mois par plateforme supplémentaire.*

Une même plaquette route vers Google, TripAdvisor, Facebook, Yelp ou TheFork.
La destination n'est pas un choix laissé au client — un menu dilue l'effort et
fait abandonner — mais une décision du serveur : **la plateforme où
l'établissement est le plus en retard par rapport à la cible de son secteur**
gagne le scan.

Concrètement, pour un restaurant avec 412 avis Google, 38 TripAdvisor et 0
TheFork, le moteur envoie une série continue de clients vers TheFork jusqu'à ce
que sa part rejoigne la cible du secteur — et le dashboard explique ce choix au
gérant en une phrase.

**État d'avancement : implémenté**, avec des connecteurs simulés pour les
plateformes dont l'accès API partenaire reste à obtenir.

### Axe 3 — Analytics et intelligence business

*Vendu seul : 39 €/mois. Inclus en Premium.*

- Tableau de bord : note moyenne et sa variation, volume d'avis, taux de réponse,
  délai médian, conversion scan → avis, répartition par plateforme.
- Extraction automatique des thèmes récurrents : attente, accueil, qualité
  produit, propreté, prix, ambiance, service, réservation.
- Alerte de tendance : un thème qui monte nettement sur 7 jours par rapport aux
  semaines précédentes déclenche une notification, classée selon la note moyenne
  des avis concernés.
- Benchmark anonymisé face aux établissements comparables du même secteur et de
  la même zone, avec un seuil d'anonymat : pas de restitution sous cinq pairs.

**État d'avancement : implémenté.**

### Axe 4 — Expérience client NFC et fidélité

*Plaquette premium personnalisée : 35 € à l'achat. Module fidélité : 12 €/mois.*

- Support imprimé sur mesure à la marque du commerce plutôt qu'un sticker
  générique, avec une puce NTAG213 (144 octets utiles — l'URL est contrôlée à la
  création pour tenir dessus).
- Programme de fidélité déclenché par le même scan. **Les points sont accordés
  pour le dépôt d'un avis, jamais pour sa note** : le module n'a aucun paramètre
  de note, et la fonction qui crédite les points ne reçoit jamais cette
  information.
- Détection de la langue du téléphone du client (en-tête `Accept-Language`) et
  page traduite en six langues — un vrai sujet en zone touristique.
- Anti-abus : un même contact ne peut créditer qu'une fois par 24 heures.

**État d'avancement : implémenté.**

---

## 4. Packaging commercial

### Les trois offres

| | Essentiel | Pro | Premium |
|---|---:|---:|---:|
| **Prix mensuel HT** | 29 € | 79 € | 149 € |
| Plaquettes incluses | 1 | 3 | 5 + design personnalisé |
| NFC vers Google | ✓ | ✓ | ✓ |
| Notifications temps réel | ✓ | ✓ | ✓ |
| Widget avis sur site | ✓ | ✓ | ✓ |
| Alertes avis négatifs | — | ✓ | ✓ |
| Réponses suggérées par IA | — | ✓ | ✓ |
| Multi-plateformes | — | Google + 1 | illimité |
| Dashboard analytics | — | de base | avancé |
| Thèmes NLP | — | — | ✓ |
| Benchmark sectoriel | — | — | ✓ |
| Programme de fidélité | — | — | ✓ |
| Intégration caisse / POS | — | — | ✓ |

Plaquette supplémentaire : 15 € à l'achat. Plaquette premium personnalisée :
35 €. Mise en service : offerte avec un engagement 12 mois, sinon 49 €.

### Add-ons vendables séparément

| Add-on | Prix | Cible |
|---|---:|---|
| Gestion des avis négatifs | 25 €/mois | Commerces déjà équipés d'un autre outil de collecte |
| Plateforme supplémentaire | 15 €/mois/plateforme | Restaurants et hôtels multi-présence |
| Analytics & intelligence business | 39 €/mois | Argument principal de montée en gamme |
| Module fidélité | 12 €/mois | Commerces à clientèle récurrente |

**Règle de facturation appliquée par le moteur de devis** : un add-on déjà
compris dans l'offre n'est jamais refacturé. Il apparaît explicitement comme
« déjà inclus » dans le devis, ce qui évite la conversation gênante trois mois
après la signature.

### Pourquoi ces prix

- **29 €** est sous le seuil de décision d'un gérant : c'est un arbitrage
  personnel, pas un dossier. Il finance la plaquette, l'hébergement et le
  support, et sert d'entrée de gamme pour installer le parc.
- **79 €** est le prix de la tranquillité : ne plus jamais laisser un avis
  négatif sans réponse. C'est l'offre visée par le discours commercial.
- **149 €** s'adresse à ceux pour qui la réputation est un poste de gestion —
  hôtels, restaurants à forte rotation, petits groupes.

---

## 5. Conformité — un choix de conception, pas une clause

Le détail juridique complet est dans [`conformite.md`](conformite.md). Les quatre
règles structurantes, et la façon dont elles sont rendues **exécutables** :

| Règle | Mise en œuvre |
|---|---|
| Pas de tri par note avant redirection | `checkLandingConfig()` rejette toute configuration de gating ; l'API renvoie une erreur avec le motif réglementaire |
| Aucune récompense conditionnée à la note | `earnPoints()` ne reçoit jamais la note ; `checkLoyaltyRule()` rejette tout barème indexé dessus |
| Aucun avis masqué ou retardé | Le produit lit les avis **déjà publiés** via les API officielles ; il n'est jamais sur le chemin entre le client et la plateforme |
| Transparence sur les contreparties | La landing page affiche une mention adaptée selon que la fidélité est active ou non (art. L.111-7-2) |

Ces règles sont couvertes par 24 tests dédiés. Un développeur qui tenterait de
réintroduire un tri par note casserait la suite de tests avant d'arriver en
production.

**Sur le plan commercial, c'est un actif.** Face à un concurrent qui pratique le
gating, l'argument est direct : « leur solution peut faire supprimer vos avis et
votre fiche ; la nôtre est conçue pour que ça n'arrive pas. »

---

## 6. Architecture technique

Le détail est dans [`architecture.md`](architecture.md). En résumé :

```
Scan NFC → Landing page → Moteur de routage → Plateforme d'avis
                                                     ↓
                          Base ← Ingestion périodique (API officielles)
                            ↓
          ┌─────────────────┼──────────────────┐
          ↓                 ↓                  ↓
    Pipeline NLP      Alertes gérant      Module fidélité
          ↓                 ↓
    Dashboard          E-mail / push
```

- **Backend** : API REST Fastify (TypeScript), PostgreSQL via Prisma.
- **Front** : Next.js — landing NFC rendue côté serveur, espace gérant en
  application cliente, widget avis embarquable.
- **Domaine** : un paquet `@avisio/core` sans dépendance, qui contient la
  tarification, le routage, la conformité, le NLP et les métriques. La même
  fonction `quote()` alimente le simulateur commercial et la facturation : il
  n'y a pas deux barèmes à maintenir.
- **Modes dégradés** : sans base de données, sans clé LLM, sans accès Google et
  sans service e-mail, l'application démarre quand même et annonce son mode.
  C'est ce qui permet de faire une démonstration terrain sans connexion fiable.
- **Souveraineté** : hébergement France (OVHcloud Gravelines ou AWS eu-west-3).
  Aucun avis ni contact ne sort de l'UE.

### État du code

| Périmètre | État |
|---|---|
| Domaine métier (`@avisio/core`) | 150 tests, couverture des règles de gestion et de conformité |
| API (auth, routage, avis, analytics, fidélité, plaquettes, facturation, caisse, back-office) | 80 tests d'intégration |
| Landing NFC multilingue | fonctionnelle |
| Espace gérant (6 écrans) | fonctionnel |
| Back-office d'exploitation | fonctionnel — parc, factures, onboarding, comptes, traitements |
| Site vitrine + simulateur de devis | fonctionnel |
| Facturation | fonctionnelle — numérotation légale, PDF, prorata, relances, suspension |
| Notifications push (PWA) | fonctionnelles — préférences par événement, heures calmes |
| Rapport mensuel HTML + PDF | fonctionnel, envoi automatique le 1er du mois |
| Intégration caisse (webhook signé) | fonctionnelle |
| Connecteur Google Business Profile | écrit, en attente de l'accès partenaire |
| Connecteurs TripAdvisor / Facebook / Yelp / TheFork | simulés, à brancher |
| Encaissement automatique (mandat SEPA) | **non développé** — règlement constaté manuellement, voir §10 |
| Envoi de SMS | **non développé** — les invitations partent par e-mail |

---

## 7. Modèle économique

### Sources de revenu

- **Récurrent** : abonnements mensuels par établissement et add-ons. C'est
  l'essentiel de la valeur.
- **Ponctuel** : vente de plaquettes NFC au-delà du quota, plaquettes premium,
  frais de mise en service hors engagement. Recette utile pour financer le
  matériel, sans stratégie de marge dessus.

### Structure de coûts

| Poste | Montant | Nature |
|---|---:|---|
| Hébergement et infrastructure | 1,10 €/établissement/mois | variable |
| Appels au modèle de langage | 0,90 €/établissement/mois | variable |
| E-mail transactionnel | 0,15 €/établissement/mois | variable |
| Commissions d'encaissement | 1,4 % du CA | variable |
| Plaquette sticker / chevalet / premium | 0,90 € / 5,50 € / 14 € | matériel |
| Commercial terrain | 3 800 €/mois chargé | fixe par poste |
| Développement, support, outillage, assurance | voir modèle | fixe |

Le poste LLM mérite un mot : l'analyse d'un avis coûte moins d'un centime, et la
rédaction d'une réponse quelques centimes. Même avec une marge de sécurité de
quatre, la ligne reste sous 1 € par établissement et par mois. **Le prix ne paie
pas la consommation, il paie le logiciel** — c'est ce qui rend la marge brute de
96 % soutenable.

### Économie unitaire

| Indicateur | Valeur |
|---|---:|
| ARPU | 74 €/mois |
| Marge brute par client | 71 €/mois (96 %) |
| CAC | 271 € |
| Durée de vie moyenne | 33 mois |
| LTV | 2 355 € |
| LTV / CAC | 8,7× |
| Retour sur CAC | 3,8 mois |

Un ratio LTV/CAC de 8,7 est élevé. Il tient à deux hypothèses à confirmer sur le
terrain : une attrition de 3 % par mois et une productivité commerciale de 14
signatures par mois. Le scénario dégradé (5 % d'attrition, 9 signatures) reste
rentable — voir la table de sensibilité du modèle financier.

### Projection

| | Année 1 | Année 2 | Année 3 |
|---|---:|---:|---:|
| Parc fin d'année | 135 | 507 | 1 064 |
| ARR fin d'année | 120 k€ | 449 k€ | 943 k€ |
| CA total | 49 k€ | 276 k€ | 708 k€ |
| EBITDA | −27 k€ | +33 k€ | +337 k€ |

**Besoin de financement : 40 000 €**, dimensionné par le creux de trésorerie du
mois 15 (8 k€ restants), pas par la perte cumulée. Composition envisagée :
15 000 € d'apport personnel, 25 000 € en prêt d'honneur et prêt bancaire adossé.

---

## 8. Plan de lancement

| Phase | Période | Contenu | Objectif de sortie |
|---|---|---|---|
| **1 — MVP** | mois 1-2 | Offre Essentiel : NFC vers Google, widget, notifications | 5-10 pilotes à Toulouse, usage terrain validé |
| **2 — Axe 1** | mois 2-3 | Alertes avis négatifs, réponses IA, lancement de l'offre Pro | Premier taux de réponse mesuré chez les pilotes |
| **3 — Axes 2 et 3** | mois 4-6 | Multi-plateformes, dashboard analytics, offre Premium | 1er commercial recruté, 50 établissements |
| **4 — Axe 4** | mois 6-8 | Plaquettes personnalisées, module fidélité | Panier moyen en hausse, mix Pro/Premium > 50 % |
| **5 — Échelle** | mois 9+ | Métropoles voisines, partenariats agences de communication | 135 établissements fin d'année 1 |

### Ce qui est déjà fait

Les phases 1 à 4 sont **développées et testées**. Le plan de lancement porte donc
sur la mise en marché, pas sur la construction du produit — ce qui change le
profil de risque : le risque résiduel est commercial et réglementaire, pas
technique.

### Les pilotes, mode d'emploi

Dix établissements toulousains, gratuits pendant deux mois, en échange de trois
choses : le droit de citer le nom en référence, un point hebdomadaire de
quinze minutes, et l'autorisation de mesurer. Ce qu'il faut en sortir :

1. **Le taux de scan réel** par emplacement de plaquette (comptoir, addition,
   terrasse). C'est le chiffre qui décide du discours commercial.
2. **La conversion scan → avis publié.** Le produit la mesure déjà.
3. **L'attrition à 3 mois**, première vraie donnée sur l'hypothèse la plus
   sensible du modèle.
4. **Le temps d'onboarding réel**, qui détermine si le support tient à un poste.

### Canaux

- **Terrain, en direct.** Le commerce de proximité s'achète en face-à-face, avec
  la plaquette dans la main. C'est le canal principal et le seul modélisé.
- **Partenariats agences de communication locales**, en revente avec commission
  récurrente. Levier de la phase 5, non modélisé — c'est un bonus, pas un pari.
- **Prescription entre commerçants.** Un gérant convaincu en parle à ses voisins ;
  prévoir un mois offert par parrainage.

---

## 9. Risques et ce qu'on fait contre

| Risque | Gravité | Réponse |
|---|---|---|
| **Accès API Google Business Profile refusé ou retardé** | Élevée | Le produit fonctionne sans : les avis sont saisis à la main ou lus par le gérant, et la valeur NFC + routage reste entière. Demande d'accès à déposer dès le mois 1, c'est le chemin critique. |
| **Accès partenaire TripAdvisor payant au volume** | Moyenne | L'add-on multi-plateformes est reprixé avant d'être vendu à grande échelle ; la rotation par scans fonctionne sans API de lecture. |
| **Google fait évoluer ses règles sur la sollicitation d'avis** | Moyenne | Position déjà conservatrice : aucun tri, aucune contrepartie conditionnée. C'est le concurrent qui pratique le gating qui tombe en premier. |
| **Attrition supérieure à l'hypothèse** | Élevée | Engagement 12 mois incité par la gratuité de la mise en service ; le dashboard et les alertes créent un usage hebdomadaire, ce qui est le meilleur anti-churn. À mesurer sur les pilotes avant d'accélérer le recrutement commercial. |
| **Productivité commerciale en dessous du plan** | Élevée | Le recrutement du 2e et du 3e commercial est conditionné aux chiffres du précédent, pas au calendrier. |
| **Encaissement non automatisé** | Moyenne | La facturation est développée ; seul le prélèvement manque. Mandat SEPA via GoCardless ou Stripe Billing à brancher sur le port `PaymentProvider`. Sous 20 clients, le règlement constaté à la main tient. |
| **Dépendance à un fournisseur de LLM** | Faible | Le moteur heuristique local prend le relais automatiquement ; la qualité baisse, le service ne tombe pas. |
| **Concurrence d'un acteur national** | Moyenne | La barrière est le terrain, pas la technique. Un an d'avance sur un maillage local vaut plus qu'une fonctionnalité. |

---

## 10. Ce qu'il reste à construire

Par ordre de priorité, et avec une estimation honnête :

1. **Accès API Google Business Profile** (administratif, 4-8 semaines de délai) —
   à lancer immédiatement, c'est le chemin critique. Le connecteur est écrit et
   testé ; d'ici là, le connecteur simulé produit des avis à la cadence réelle.
2. **Encaissement automatique** (1-2 semaines) — la facturation est complète
   (émission, numérotation légale, PDF, prorata, relances, suspension), mais le
   règlement est constaté à la main. Brancher GoCardless pour le mandat SEPA ou
   Stripe Billing revient à écrire un second adaptateur `PaymentProvider` :
   aucune autre partie du code ne change. Tenable manuellement sous 20 clients.
3. **Envoi de SMS** (3-5 jours) — les invitations de caisse par SMS sont
   journalisées faute d'opérateur (Brevo, OVH SMS). Le canal e-mail fonctionne.
4. **Accès partenaires TripAdvisor / Facebook / Yelp** (administratif) — les
   connecteurs sont écrits, il manque les autorisations.
5. **Résumé hebdomadaire** (2-3 jours) — le canal est en place dans les
   préférences, le contenu reste à composer.

Le reste du périmètre annoncé aux trois offres est développé et testé :
notifications push, rapport mensuel, intégration caisse, facturation,
onboarding autonome et back-office d'exploitation.

---

## Annexes

- [`modele-financier.md`](modele-financier.md) — projection à 36 mois, économie
  unitaire, sensibilité. Généré par `scripts/financial-model.ts`.
- [`architecture.md`](architecture.md) — architecture technique détaillée,
  schéma de données, exploitation, passage à l'échelle.
- [`conformite.md`](conformite.md) — analyse réglementaire, RGPD, traitement des
  données personnelles.
- [`go-to-market.md`](go-to-market.md) — argumentaire, objections, script de
  visite, kit de démonstration.
- [`../README.md`](../README.md) — installation et exécution du logiciel.
