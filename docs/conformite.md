# Conformité — avis en ligne et données personnelles

> Ce document décrit les règles appliquées par le produit et la façon dont elles
> sont rendues exécutables. Il ne remplace pas un avis juridique : avant la
> commercialisation, faire relire les CGV, la politique de confidentialité et le
> registre des traitements par un avocat spécialisé.

---

## 1. Le cadre applicable

### 1.1 Droit de la consommation français et européen

**Directive (UE) 2019/2161 dite « Omnibus »**, transposée en droit français aux
articles **L.111-7-2** et **L.121-4 21°** du code de la consommation :

- Toute personne qui publie des avis en ligne doit indiquer si et comment elle
  contrôle leur authenticité.
- Il est interdit d'affirmer que des avis sont publiés par des consommateurs
  ayant réellement utilisé le produit sans avoir pris de mesures raisonnables
  pour le vérifier.
- **Il est interdit de publier des avis de manière sélective en laissant croire
  qu'ils sont tous restitués.** C'est une pratique commerciale trompeuse.
- L'existence d'une **contrepartie** à la rédaction d'un avis doit être indiquée.

**Norme AFNOR NF Z74-501 / ISO 20488** — référentiel de traitement des avis en
ligne : pas de sélection selon le contenu, traçabilité, délai de publication
maîtrisé.

### 1.2 Règles des plateformes

**Google — règles relatives au contenu publié par les utilisateurs** :

- Interdiction de solliciter des avis de manière sélective (« review gating ») :
  demander la satisfaction d'abord, puis n'orienter vers la fiche publique que
  les clients contents.
- Interdiction d'offrir une contrepartie en échange d'un avis positif ou d'une
  note minimale.
- Sanctions possibles : suppression des avis concernés, suspension de la fiche
  d'établissement.

Facebook, TripAdvisor et Yelp appliquent des règles équivalentes, Yelp étant le
plus strict (il décourage toute sollicitation, même neutre).

---

## 2. Les quatre règles produit

### Règle 1 — Aucun tri par note avant redirection

Le parcours NFC comporte **un seul écran et un seul bouton**. Le client tape, il
arrive sur la plateforme. Il n'existe aucune étape intermédiaire demandant sa
note, son niveau de satisfaction, ou quoi que ce soit qui permettrait de router
différemment un client mécontent.

**Mise en œuvre :** `packages/core/src/compliance.ts` expose
`checkLandingConfig()`, qui rejette trois configurations :

| Configuration | Motif |
|---|---|
| `askRatingBeforeRedirect` | Demander la note avant la redirection |
| `routeByPrefilledRating` | Router selon une note pré-saisie |
| `privateFeedbackInsteadOfPublic` | Détourner les mécontents vers un formulaire privé |

La route `POST /establishments/:id/landing-config` refuse ces configurations avec
le motif réglementaire en clair. Le moteur de routage lui-même ne peut pas
enfreindre la règle : `selectPlatform()` n'accepte aucun paramètre de note.

### Règle 2 — Aucune contrepartie conditionnée à la note

Les points de fidélité sont accordés **pour le fait d'avoir déposé un avis**,
quel qu'en soit le sens.

**Mise en œuvre :** la fonction `earnPoints()` ne reçoit jamais la note — elle ne
figure pas dans sa signature. `checkLoyaltyRule()` rejette tout barème comportant
une note minimale ou un bonus indexé sur la note.

**Conséquence assumée :** les points sont crédités au moment de la redirection,
pas après vérification du dépôt effectif de l'avis. Vérifier le dépôt supposerait
de relier l'avis publié à l'identité du client, ce que les plateformes
n'autorisent pas et que le RGPD rendrait disproportionné. Le risque est un client
qui encaisse les points sans écrire ; la carence de 24 heures par contact limite
l'abus.

### Règle 3 — Aucun avis masqué, filtré ou retardé

Avisio **lit** les avis déjà publiés via les API officielles. Il n'est jamais sur
le chemin entre le client et la plateforme : le client écrit directement chez
Google, TripAdvisor ou Facebook, et l'avis est public à la seconde où il le
publie, indépendamment de nous.

Il n'existe dans tout le code aucune fonction permettant de masquer, retarder ou
supprimer un avis. Les avis 1 à 3 étoiles sont **signalés** au gérant, jamais
traités différemment dans leur publication.

### Règle 4 — Transparence sur les contreparties

La landing page affiche une mention adaptée au contexte :

- Sans fidélité active : « Votre avis est publié directement sur la plateforme,
  sans relecture ni filtrage de notre part. »
- Avec fidélité active : « Les points sont accordés pour le dépôt d'un avis,
  quelle que soit la note. Votre avis est publié directement sur la plateforme. »

La seconde formulation répond à l'obligation d'information sur l'existence d'une
contrepartie (art. L.111-7-2), dans la langue du client.

### Le cas du widget avis

Le widget embarqué sur le site du commerçant affiche une **sélection** d'avis
4-5 étoiles. C'est licite — un commerçant a le droit de mettre en avant des
témoignages sur son propre site — à condition de ne pas laisser croire qu'il
s'agit de l'ensemble des avis. Le widget porte donc systématiquement la mention
« Sélection d'avis publiés sur nos plateformes. Consultez-les tous sur Google. »

---

## 3. Vérification

Les quatre règles sont couvertes par **24 tests** dans
`packages/core/test/compliance.test.ts` et par des tests d'intégration côté API.

```bash
npm test
```

Un développeur qui tenterait de réintroduire un tri par note, un barème indexé
sur la note ou un paramètre de satisfaction dans le routage casserait la suite de
tests avant d'atteindre la production. **C'est le point : la conformité n'est pas
une clause contractuelle, c'est une propriété du logiciel.**

---

## 4. RGPD

### 4.1 Traitements et bases légales

| Traitement | Données | Base légale | Conservation |
|---|---|---|---|
| Compte gérant | E-mail, nom, mot de passe haché | Exécution du contrat | Durée du contrat + 3 ans |
| Avis ingérés | Pseudonyme public, note, texte, date | Intérêt légitime (gestion de la relation client du commerçant) | 3 ans après publication |
| Scans NFC | Horodatage, plateforme, langue du navigateur | Intérêt légitime (mesure d'audience du support) | 13 mois |
| Fidélité | **Condensat** du contact, solde de points | Consentement (saisie volontaire du contact) | 3 ans sans activité |

### 4.2 Minimisation

Trois décisions concrètes, prises pour réduire la surface de données :

1. **Le programme de fidélité ne stocke jamais l'e-mail ni le téléphone en
   clair.** Seul un condensat SHA-256 salé et tronqué est conservé, ce qui permet
   de reconnaître un client qui revient sans constituer un fichier de contacts
   exploitable en cas de fuite.
2. **Aucun cookie, aucun traceur sur la landing NFC.** Pas de bandeau de
   consentement à afficher, donc pas de friction sur le seul écran qui compte.
3. **L'en-tête `Accept-Language` est lu, utilisé, oublié.** Il n'est ni stocké ni
   associé au scan autrement que par la langue retenue.

### 4.3 Les avis et les données personnelles

Un avis contient un pseudonyme public et un texte librement rédigé, qui peut
comporter des données personnelles (« le serveur roux du samedi »). Deux
conséquences :

- Le commerçant est **responsable de traitement**, Avisio est **sous-traitant**.
  Un contrat de sous-traitance conforme à l'article 28 RGPD doit figurer en
  annexe des CGV.
- Une demande d'effacement d'un auteur d'avis se traite **auprès de la
  plateforme**, qui est l'éditeur. Avisio répercute la suppression à la
  synchronisation suivante ; l'avis disparaît du dashboard sans action manuelle.

### 4.4 Benchmark sectoriel

Le benchmark compare un établissement à ses pairs. Deux garde-fous :

- **k-anonymat** : aucun résultat n'est restitué en dessous de **cinq
  établissements comparables**, le demandeur exclu. La maille s'élargit
  automatiquement — commune, puis département, puis national — jusqu'à atteindre
  le seuil ; si le seuil n'est jamais atteint, le benchmark est refusé avec ce
  motif explicite.
- **Aucune donnée nominative ne sort de la fonction** : uniquement des agrégats
  (médiane, quartiles, rang centile). Un test vérifie que les identifiants des
  pairs n'apparaissent pas dans la réponse.

### 4.5 Localisation des données

Hébergement dans l'Union européenne — OVHcloud Gravelines ou AWS eu-west-3
(Paris). Aucun avis ni contact ne quitte l'UE dans le fonctionnement nominal.

**Point de vigilance à documenter** : les appels au modèle de langage sortent
vers un prestataire américain. À traiter dans le registre des traitements et la
politique de confidentialité, avec les clauses contractuelles types
correspondantes. Le contenu transmis se limite au texte d'un avis **déjà public**
et au ton de marque de l'établissement — aucune donnée du gérant ni du programme
de fidélité n'est envoyée.

---

## 5. Documents à produire avant commercialisation

- [ ] CGV incluant l'annexe de sous-traitance RGPD (art. 28)
- [ ] Politique de confidentialité (site public et landing NFC)
- [ ] Registre des traitements
- [ ] Analyse d'impact (AIPD) — probablement non requise au vu de la
      minimisation, à confirmer au regard du volume et du benchmark
- [ ] Mentions légales
- [ ] Procédure de réponse aux demandes d'exercice des droits
- [ ] Relecture de l'ensemble par un avocat en droit du numérique
