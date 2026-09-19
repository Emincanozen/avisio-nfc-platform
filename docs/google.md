# Intégration Google Business Profile

Ce document dit trois choses : ce qui est écrit et testé, ce qui dépend de
Google et pas de nous, et la procédure exacte pour débloquer le reste.

**État au 19 septembre 2026 : le parcours complet est implémenté. La lecture
d'avis réels n'a jamais été exécutée, parce que l'accès API n'est pas accordé.**

---

## 1. Pourquoi ce n'est pas une simple clé d'API

Une fiche Google appartient à l'établissement, pas à Avisio. Personne ne peut
consentir à la place d'un autre. Il n'existe donc pas — et il ne peut pas
exister — de jeton unique qui donnerait accès aux fiches de tout le parc.

Le code d'origine partait de l'hypothèse inverse : un `GOOGLE_REFRESH_TOKEN`
global lu dans l'environnement. C'était bon pour une démonstration
mono-établissement et faux pour le produit. L'architecture actuelle stocke
**une autorisation par établissement**, obtenue par consentement OAuth du
propriétaire de la fiche.

## 2. Ce que Google exige

| Exigence | Qui la remplit | État |
|---|---|---|
| Projet Google Cloud, API Business Profile activée | @OZEN | à faire |
| Fiche vérifiée et active depuis plus de 60 jours | le client, ou @OZEN pour la fiche d'essai | à vérifier |
| Site web représentant l'établissement | idem | à vérifier |
| Demande d'accès approuvée par Google | @OZEN, formulaire | **bloquant** |
| Consentement OAuth du propriétaire de chaque fiche | chaque client, depuis Avisio | implémenté |

### Le point dur : le quota par défaut est zéro

Un projet Google Cloud dont la demande d'accès n'a pas été approuvée dispose de
**0 requête par minute**. Tous les appels échouent, y compris les plus
anodins. Ce n'est pas une erreur d'implémentation, c'est l'état par défaut, et
c'est ce qui trompe le plus de monde : on cherche un bug là où il n'y a qu'une
autorisation manquante.

Après approbation, le quota passe à **300 requêtes par minute**. La vérification
se fait dans la console Google Cloud, page *Quotas* : 0 QPM = non approuvé,
300 QPM = approuvé.

Le délai d'instruction se compte en semaines. Google ne s'engage sur aucun
délai.

## 3. Procédure — ce que @OZEN doit faire

1. **Créer le projet Cloud.** console.cloud.google.com → nouveau projet.
   Noter le **numéro** du projet (pas son identifiant textuel) : le formulaire
   le demande.

2. **Activer l'API.** Bibliothèque d'API → activer, au minimum :
   - *Google My Business API* (c'est elle qui porte les avis, sur `v4`)
   - *My Business Account Management API*
   - *My Business Business Information API*

3. **Créer les identifiants OAuth.** Identifiants → créer → ID client OAuth →
   type *Application Web*. Déclarer comme URI de redirection autorisée
   exactement l'URL de retour de l'API :

   ```
   https://api.votre-domaine.fr/integrations/google/callback
   ```

   En développement : `http://localhost:4000/integrations/google/callback`.
   **Cette URL doit correspondre au caractère près**, sinon Google refuse
   l'échange avec `redirect_uri_mismatch`.

4. **Configurer l'écran de consentement.** Externe. Renseigner la politique de
   confidentialité et les conditions d'utilisation : Google les exige pour
   approuver une application qui demande `business.manage`.

5. **Demander l'accès API.** Formulaire de contact Business Profile API,
   motif *Application for Basic API Access*. Fournir le numéro de projet, le
   site d'Avisio et la description de l'usage. Décrire l'usage réel : lecture
   des avis et publication de réponses pour le compte d'établissements clients
   ayant donné leur consentement.

6. **Attendre.** Vérifier périodiquement le quota dans la console.

7. **Renseigner la configuration** d'Avisio :

   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   GOOGLE_REDIRECT_URI=https://api.votre-domaine.fr/integrations/google/callback
   SECRETS_KEY=<32 caractères aléatoires, distincts de JWT_SECRET>
   ```

   Ne jamais mettre ces valeurs dans le dépôt. Voir `docs/deploiement.md`.

> **`SECRETS_KEY`** scelle les jetons des clients. La changer rend **tous** les
> jetons illisibles et oblige chaque client à réautoriser. Elle se sauvegarde
> avec le même soin que la base.

## 4. Ce que fait le client, une fois l'accès obtenu

Depuis son espace, onglet **Plaquettes** :

1. *Connecter Google* → écran de consentement Google → retour dans Avisio.
2. Choisir sa fiche dans la liste de celles que son compte gère.
3. *Tester la connexion* → Avisio nomme l'étape qui bloque, s'il y en a une.

La synchronisation suit ensuite la cadence d'ingestion (20 minutes par défaut).

### Portée demandée

`https://www.googleapis.com/auth/business.manage` — la seule portée publiée
pour ces API. Elle couvre lecture **et** écriture : il n'existe pas de portée
en lecture seule. C'est une limite de Google, à annoncer au client avant le
consentement plutôt qu'à lui laisser découvrir.

## 5. Ce qui est implémenté et vérifié

| Élément | Où | Vérifié par |
|---|---|---|
| Génération de l'URL de consentement | `services/google-oauth.ts` | tests |
| État signé anti-rattachement abusif | `routes/google.ts` | tests |
| Échange du code contre les jetons | `services/google-oauth.ts` | non exécuté |
| Scellement AES-256-GCM des jetons | `services/secrets.ts` | tests |
| Renouvellement + cache du jeton d'accès | `services/google-tokens.ts` | non exécuté |
| Liste des fiches du compte | `services/google-oauth.ts` | non exécuté |
| Contrôle que la fiche appartient au compte | `routes/google.ts` | code lu |
| Pagination et arrêt sur avis connu | `services/google.ts` | non exécuté |
| Dédoublonnage (établissement, plateforme, id) | dépôt | tests |
| Détection d'une connexion rompue | `services/ingest.ts` | code lu |
| Révocation à la déconnexion | `routes/google.ts` | tests partiels |
| Diagnostic étape par étape | `routes/google.ts` | tests |

« Non exécuté » veut dire : le code existe, il compile, il est typé, mais
aucune requête n'a jamais atteint Google. Aucune doublure ne peut en tenir
lieu — une doublure prouverait seulement que j'ai bien deviné la forme des
réponses.

## 6. En attendant : l'import manuel

Il n'est pas un pis-aller temporaire. TripAdvisor, Facebook et Yelp ont des
accès partenaires au moins aussi difficiles à obtenir, et l'import restera le
seul chemin pour certains.

Espace gérant → **Plaquettes** → *Importer des avis*.

- Modèle CSV téléchargeable, avec BOM pour Excel français.
- En-têtes français ou anglais, séparateur virgule ou point-virgule.
- Dates ISO (`2026-03-14`) ou françaises (`14/03/2026`).
- Notes numériques ou libellés Google (`FIVE`).
- **Prévisualisation avant écriture** : on voit ce qui passerait et ce qui
  serait refusé, ligne par ligne, avant que rien ne touche la base.
- Rejouable : le même fichier importé deux fois n'ajoute rien.
- Les avis de plus de 14 jours n'alertent pas — un import rétroactif ne doit
  pas déclencher une avalanche de notifications.

Les avis importés portent `source: 'import'`. Ils ne sont jamais présentés
comme le fruit d'une connexion en direct.

## 7. Limites et pièges connus

**Pas de webhook.** Google ne pousse rien. L'ingestion interroge toutes les
20 minutes ; une alerte peut donc arriver jusqu'à 20 minutes après la
publication. Le raccourcir consomme du quota sans grand gain.

**Consentement à redonner.** Un jeton de rafraîchissement expire s'il n'est pas
utilisé pendant six mois, et le client peut retirer l'accès à tout moment
depuis son compte Google. Avisio enregistre alors l'échec sur la connexion et
l'interface le signale : une connexion rompue en silence est pire que pas de
connexion, le client se croit couvert sans l'être.

**Réponses publiées.** `publishReply` écrit sur la fiche du client. Rien n'est
publié sans validation explicite du gérant — le texte suggéré ne part jamais
seul.

**Conservation.** Les conditions d'utilisation des API Google encadrent la
conservation et l'affichage des données. À relire avant toute exploitation
commerciale : ce document décrit l'implémentation technique, il ne vaut pas
analyse juridique.
