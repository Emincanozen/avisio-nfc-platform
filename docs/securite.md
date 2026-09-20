# Sécurité

Ce que le produit protège, comment, et ce qui reste ouvert. Les défauts
trouvés et corrigés sont nommés : ils disent mieux que n'importe quelle
déclaration d'intention où se situent les vrais risques.

---

## 1. Modèle de menace

Trois adversaires plausibles, par ordre de vraisemblance.

**Un client curieux.** Il a un compte légitime et essaie de voir les données
d'un autre établissement — un concurrent, souvent. C'est la menace la plus
probable et la plus coûteuse en réputation : un seul incident de ce type
détruit l'argument de vente.

**Un script automatique.** Il balaie les URL publiques : forçage de mots de
passe, gonflage des compteurs de scan, énumération de contacts par la route
de fidélité.

**Un avis malveillant.** Le seul texte libre qui traverse le système et entre
dans un prompt de modèle de langage. Il est écrit par un inconnu.

Hors périmètre à ce stade : un attaquant ayant un accès au serveur, et les
attaques ciblées par déni de service distribué (affaire de l'hébergeur).

## 2. Cloisonnement entre établissements

Le point le plus sensible du produit.

Toute route portant un identifiant d'établissement passe par `assertAccess`
(`apps/api/src/app.ts`), qui vérifie la liste du jeton. Les routes portant
l'identifiant d'une **ressource** — un avis, une alerte, une facture —
chargent d'abord la ressource, puis appliquent `assertAccess` sur
l'établissement propriétaire : l'identifiant transmis par le client n'est
jamais une preuve d'autorisation.

Un compte `admin` traverse la garde. C'est délibéré, et c'est le propre du
back-office.

### Cinq failles trouvées, toutes corrigées

| Faille | Portée | Corrigée |
|---|---|---|
| **`PATCH /establishments/:id` acceptait `plan` et `addons`** | **Intégrité commerciale.** Les droits lisaient `establishment.plan`, la facturation lisait `subscription.plan`. Une requête suffisait à passer en Premium en restant facturé Essentiel — sans erreur, sans journal | Champs retirés, schéma `strict()`. Et surtout §2 bis : les droits viennent de l'abonnement |
| **`POST /push/subscribe` réattribuait un point de terminaison** | Un gérant connaissant celui d'un autre se l'appropriait en une requête ; l'autre cessait de recevoir ses alertes sans rien remarquer | `findByEndpoint` puis refus en 409 si le propriétaire diffère. Réenregistrer le sien reste normal |
| `/ops/ingest` ouvert à tout gérant | Déclenchait l'ingestion de **tout le parc** : un client provoquait les appels d'API tierces et les dépenses de modèle de langage de tous les autres | Routes supprimées, seules subsistent `/admin/ops/*` |
| `/alerts/:id/read` sans contrôle | L'identifiant suffisait à marquer lue l'alerte d'un concurrent | Lecture puis `assertAccess` |
| `/push/unsubscribe` sans contrôle | Couper les notifications d'un autre gérant, donc l'aveugler sur ses avis négatifs | Restreint aux abonnements du compte |

Chacune a son test de non-régression, et chacun de ces tests **échoue sans son
correctif** — vérifié en réintroduisant la faille. `/push/unsubscribe` répond
volontairement de la même façon dans les deux cas : sinon la route deviendrait
un oracle d'existence.

## 2 bis. Les droits suivent la facture

`packages/core/src/entitlements.ts`. Une seule fonction répond à « ce client
a-t-il droit à ceci ? », et elle lit **l'abonnement**.

`establishment.plan` et `subscription.plan` étaient deux copies de la même
vérité, lues par deux parties du système qui ne se parlaient pas. Corriger la
seule route qui permettait de les faire diverger aurait laissé la structure
intacte — et la prochaine route étourdie aurait rouvert la faille.

| Situation | Droits accordés |
|---|---|
| Abonnement `active` ou `trialing` | Ceux de l'abonnement |
| Abonnement `past_due` | Ceux de l'abonnement. C'est le **délai de grâce** : couper au premier jour de retard ferait fuir un client qui a changé de carte, et les relances existent pour occuper ce temps |
| Abonnement `suspended` ou `canceled` | **Fonctions facturées coupées.** Consultation et factures restent ouvertes : retirer ses factures à un client suspendu pour impayé lui ôterait le document dont il a besoin pour payer |
| Aucun abonnement | Ceux de l'établissement. Cas nommé explicitement — il n'y a rien d'autre à lire |

Un désaccord entre l'abonnement et l'établissement — écriture partielle,
changement d'offre interrompu — est **signalé dans le back-office**
(`entitlementDrift`), plutôt que découvert six mois plus tard en comparant une
facture à un usage.

`hasFeature` existe toujours, mais ne sert plus qu'à décrire le catalogue
(« que contient Premium ? »). **Il ne doit plus autoriser quoi que ce soit.**

## 2 ter. Les données fabriquées ne peuvent plus contaminer une base réelle

C'était le défaut le plus insidieux du produit, et il ne ressemblait pas à une
faille. Sans accès Google — c'est-à-dire dans l'état actuel — le connecteur
**simulé** tournait quand même, y compris sur une base PostgreSQL de
production. Il y écrivait de faux avis, de fausses alertes, de fausses
statistiques. Le client voyait son tableau de bord se remplir d'avis qui
n'existaient pas, et la note moyenne qu'on lui facturait était inventée.

Trois barrières, indépendantes :

1. **Les simulateurs n'existent que sous `AVISIO_DEMO_MODE=true`.** Partout
   ailleurs, une plateforme non connectée utilise un connecteur *inactif* :
   il ne renvoie rien, et `live` est faux, ce dont l'interface se sert pour
   afficher « source non connectée ».
2. **Le contrôle de configuration refuse le démarrage** si `AVISIO_DEMO_MODE`
   est actif avec `NODE_ENV=production`.
3. **`capabilities.demoMode` exige aussi `NODE_ENV !== 'production'`**, ce qui
   ferme le contournement d'une instance lancée hors du chemin normal — un
   script, un binaire exécuté à la main.

Tout avis produit par un simulateur porte `source: 'demo'` **jusqu'en base**,
et `computeMetrics` l'écarte d'entrée. Le filtrage est dans le calcul, pas
chez chaque appelant : aucun n'oubliera.

## 2 quater. Aucun serveur de production ne démarre mal configuré

`packages/core/src/config-guard.ts`, appelé avant toute connexion. Sortie
`78` (EX_CONFIG) et refus net.

| Refusé en production | Ce que produisait le démarrage silencieux |
|---|---|
| `DATABASE_URL` absente | Adaptateur mémoire : jeu de démonstration, identifiants publiés dans ce dépôt, perte totale au redémarrage |
| `JWT_SECRET` absent, égal au secret de `.env.example`, ou < 32 caractères | Quiconque a lu le dépôt forge un jeton valide, rôle administrateur compris |
| `SECRETS_KEY` identique à `JWT_SECRET` | Faire tourner le secret des sessions rendrait illisibles tous les jetons Google des clients |
| `PUBLIC_WEB_URL` / `PUBLIC_API_URL` non HTTPS | Le push web l'exige ; sans lui, aucune alerte n'atteint le téléphone du gérant |
| `AVISIO_DEMO_MODE` actif | Voir §2 ter |

Les fournisseurs manquants (Resend, VAPID, Google, Anthropic) produisent des
**avertissements**, pas un refus : exploiter sans e-mail transactionnel est une
décision commerciale, pas une faute de configuration. Mais elle est dite, au
démarrage, en clair.

## 2 quinquies. Une réponse non publiée n'est jamais marquée « répondu »

Un avis passait en `answered` dès que le gérant validait son texte — même
quand la plateforme n'était pas connectée et que rien n'était parti. Le gérant
croyait avoir répondu publiquement, son client ne voyait jamais la réponse, et
le **taux de réponse affiché** — un indicateur vendu — comptait des réponses
inexistantes.

Cinq états désormais, et `answered` signifie *publié et confirmé par la
plateforme*, rien de moins : `new`, `draft_ready`, `reply_pending`,
`answered`, `reply_failed`. Le texte du gérant est conservé dans tous les
cas — le perdre parce que Google est injoignable serait le punir d'une panne
qui n'est pas la sienne.

## 3. Authentification

- Mots de passe hachés en **scrypt** (`apps/api/src/auth.ts`).
- Session par JWT, 12 heures, signé avec `JWT_SECRET`. Jamais un cookie : rien
  à renvoyer automatiquement, donc pas de CSRF sur les routes authentifiées.
- Message d'échec identique que le compte existe ou non.

### Deux budgets, pas un

| Périmètre | Budget | Rôle |
|---|---|---|
| Par compte | 10 / 15 min | C'est **lui** qui protège un mot de passe : deviner exige d'insister sur le même compte, et aucune rotation d'adresse ne le contourne |
| Par adresse | 100 / 15 min | Volontairement large : un siège de chaîne ou un hôtel sortent par une seule IP publique, et serrer là enfermerait dehors des clients légitimes sans gêner un attaquant, qui dispose de bien plus d'une adresse |

Le budget par compte est consommé **avant** la vérification, y compris sur un
compte inexistant : sinon l'énumération des comptes resterait gratuite.

Les deux budgets sont séparés dans la clé de comptage : matraquer l'adresse
d'un gérant ne doit pas l'empêcher de se connecter, ce qui offrirait un déni
de service.

## 4. Limitation de débit

Politique dans `packages/core/src/ratelimit.ts`, comptage derrière le port
dépôt.

Un périmètre par **ressource protégée**, pas par chemin d'URL : ce qu'on
protège est un mot de passe, un quota d'API tierce, une dépense de modèle —
pas une adresse.

| Périmètre | Budget | Protège |
|---|---|---|
| `login` / `login_ip` | 10 / 15 min · 100 / 15 min | Les mots de passe |
| `scan` | 60 / h | L'intégrité des compteurs de scan |
| `loyalty` | 20 / h | Les contacts contre l'énumération |
| `public_read` | 300 / min | La bande passante |
| `pos` | 600 / min | Large : une caisse légitime est bavarde |
| `llm` | 30 / h | La dépense de modèle de langage |
| `ops` | 60 / h | Le double clic et le script emballé. Réservé aux admins : ce n'est pas ce budget qui protège la dépense, mais le plafond d'appels au modèle |
| `authenticated` | 600 / min | Tout le reste |

Deux décisions à connaître :

**Le comptage est en base, pas en mémoire.** Un compteur par processus
diviserait le budget réel par le nombre d'instances et se remettrait à zéro à
chaque redéploiement — exactement le moment où un attaquant persistant
reprend la main. L'adaptateur PostgreSQL incrémente par
`INSERT ... ON CONFLICT DO UPDATE`, atomique côté serveur. Vérifié sous
60 requêtes simultanées : aucun incrément perdu.

**Une route inconnue retombe sur un budget par défaut**, jamais sur l'absence
de limite. Une route ajoutée demain est protégée sans qu'on y pense.

`/health` est exclu : le mettre en 429 ferait redémarrer le service en boucle
au moment où il est déjà sous pression.

### `TRUST_PROXY`

Par défaut, `X-Forwarded-For` **n'est pas cru**. C'est l'IP qui sert de clé à
toute la limitation : la croire sur parole sans proxy devant revient à offrir
une identité neuve à chaque requête et à annuler tous les budgets.

Derrière un proxy : `TRUST_PROXY=1` (nombre de sauts). Le nombre est
préférable à une liste d'adresses — il ne se périme pas quand l'hébergeur
change ses plages.

## 5. Secrets

| Secret | Où | Protection |
|---|---|---|
| Mots de passe des gérants | base | scrypt |
| Jetons de rafraîchissement Google | base | **AES-256-GCM** (`services/secrets.ts`) |
| Clés d'API de caisse | base | condensat ; la clé n'est montrée qu'une fois |
| Contacts de fidélité | base | SHA-256, jamais en clair |
| `JWT_SECRET`, `SECRETS_KEY` | environnement | jamais dans le dépôt |

Un jeton Google donne accès à la fiche d'un client jusqu'à révocation : le
lire, c'est pouvoir répondre en son nom. En clair dans une table, une
sauvegarde égarée suffirait à le livrer. L'étiquette d'authentification GCM
fait refuser un enregistrement modifié en base plutôt que de l'interpréter.

`SECRETS_KEY` doit être **distinct** de `JWT_SECRET` : faire tourner le secret
des sessions est banal, et ne doit pas rendre illisibles tous les jetons
Google.

`bash scripts/check-secrets.sh` fouille les fichiers suivis **et
l'historique** : un `.gitignore` ne protège que l'avenir, un secret déjà
committé reste accessible à quiconque clone. Ce contrôle tourne en intégration
continue.

## 6. Entrées non fiables

### Validation

Toute entrée passe par un schéma Zod. Un échec produit un **400** nommant le
champ fautif, jamais un 500 : en 500, les alertes d'exploitation se
déclencheraient à chaque formulaire mal rempli, et un intégrateur réessaierait
en boucle une requête qui ne passera jamais.

### Injection de prompt

Un avis client est une **donnée**, jamais une consigne. Il est écrit par un
inconnu et son analyse finit lue — voire publiée — par le gérant.

Quatre protections, aucune suffisante seule :

1. La clôture du bloc est neutralisée. Un avis contenant `"""` refermerait le
   bloc et la suite passerait pour une instruction : c'est l'évasion la moins
   coûteuse à tenter.
2. Le texte est borné à 4 000 caractères — au-delà, on noie les consignes, ou
   on fait simplement exploser la facture.
3. Le bloc est annoncé comme du contenu non fiable, et la règle est **rappelée
   après** la donnée : le dernier mot du prompt doit l'emporter sur ce que
   l'avis raconte.
4. La sortie est analysée strictement : thèmes en liste blanche, score borné,
   JSON malformé rejeté au profit du moteur heuristique local.

Et la garantie de fond : **aucune réponse n'est publiée sans validation
humaine**. Le texte suggéré ne part jamais seul.

### Webhook de caisse

Signature HMAC-SHA256 sur `<horodatage>.<corps brut>`, avec fenêtre de rejeu.
Le corps brut est conservé avant l'analyse JSON : re-sérialiser changerait
l'ordre des clés et invaliderait la signature.

## 7. Dépense

| Garde-fou | Valeur | Effet |
|---|---|---|
| Plafond horaire d'appels au modèle | 500 / h / processus | Repli sur le moteur heuristique |
| Délai de garde | 30 s | Un appel qui ne revient pas bloquerait tout le cycle d'ingestion |
| Reprises | 1 | Au-delà, on paie pour un service qui ne répond pas |
| Périmètre `llm` | 30 / h / IP | Borne la dépense déclenchable depuis l'extérieur |

Le dépassement ne fait échouer personne : un avis analysé approximativement
reste exploitable, un avis non analysé disparaît du tableau de bord.

La consommation est exposée dans le back-office. Un plafond qu'on ne voit pas
ne se règle jamais correctement.

## 8. Données personnelles

- Contacts de fidélité : SHA-256 dès la réception, jamais stockés en clair.
- Aucun traceur, aucun cookie sur la landing NFC.
- Les avis sont publics par nature ; seul le nom d'affichage est repris.
- Suppression d'un établissement : cascade sur toutes ses données
  (`onDelete: Cascade`).

Voir `docs/conformite.md` pour le cadre réglementaire.

## 8 bis. Dépendances vulnérables

Relevé du 20 septembre 2026, `npm audit`. **Les deux entrées critiques sont
corrigées.** Les sept restantes sont analysées ici plutôt que masquées : une
gravité annoncée n'est pas une exploitabilité.

### Corrigé

| Paquet | Gravité | Correctif |
|---|---|---|
| `@fastify/jwt` 9.1.0 → **10.2.2** | **critique** | Montée de version majeure, `fast-jwt` 6.3.3 |
| `fast-jwt` ≤ 6.2.3 | **critique** | Entraîné par le précédent |

Six avis concernaient `fast-jwt`. Seul le contournement d'authentification par
secret HMAC vide aurait pu nous toucher, et encore : `env.jwtSecret` a toujours
une valeur de repli, il n'est jamais vide. Les autres visaient des
configurations que nous n'utilisons pas — clés RSA (nous signons en HMAC),
cache `cacheKeyBuilder` (non activé), expressions régulières dans `allowedIss`
et consorts (non renseignés). **La montée de version a quand même été faite :
c'est la dépendance qui porte l'authentification, le doute n'y est pas
acceptable.** Vérifiée par 323 tests, le démarrage de l'API compilée et
54 contrôles de bout en bout.

### Restant, sans correctif applicable

| Paquets | Gravité | Exploitabilité ici | Pourquoi pas corrigé |
|---|---|---|---|
| `prisma`, `@prisma/config`, `deepmerge-ts` | haute | **Nulle.** Épuisement de pile en fusionnant un graphe récursif, au chargement de configuration par la **CLI Prisma**. Notre `schema.prisma` est statique et versionné | Aucune version corrigée n'existe : l'avis couvre tout Prisma 6 et 7, le correctif est annoncé pour 8.1.0, non publié |
| `postcss`, `next` | haute / modérée | **Nulle.** Lecture de fichiers `.map` via un `sourceMappingURL` contrôlé par l'attaquant, **à la compilation**. Notre CSS est écrit par nous et vit dans le dépôt : il faudrait déjà pouvoir y committer | Correctif = `next@16`, montée majeure. Risque de régression réel pour une menace qui n'existe pas dans ce montage |
| `vitest`, `@vitest/mocker` | modérée | **Nulle.** Traversée de chemin via le serveur de développement de Vitest. Dépendance de développement, jamais livrée | Correctif = `vitest@5`, montée majeure |

### Ce que cela implique

Aucune de ces sept entrées n'est atteignable depuis le réseau en production :
ce sont des outils de compilation, de ligne de commande ou de test. Elles
méritent d'être suivies, pas d'être corrigées dans l'urgence au prix d'une
montée majeure non testée.

**À refaire** : `npm audit` à chaque revue de dépendances, et relire ce tableau.
Si une de ces entrées devient atteignable à l'exécution, elle change de
catégorie. L'ajout de `npm audit` à l'intégration continue reste à faire (§9).

## 9. Ce qui reste ouvert

Nommé, pas caché.

| Point | Gravité | État |
|---|---|---|
| Aucun audit externe | — | Tout ce document est une auto-évaluation |
| Pas de rotation automatique des secrets | moyenne | Manuelle, documentée au §5 |
| Pas de verrouillage de compte durable | faible | Le budget par compte ralentit, il ne bloque pas définitivement |
| Pas de second facteur | moyenne | À prévoir avant d'ouvrir le back-office à plusieurs personnes |
| Pas de journal d'audit des actions admin | moyenne | Les journaux applicatifs existent, pas de piste dédiée |
| Dépendances non auditées en continu | faible | Ajouter `npm audit` à l'intégration continue |
| En-têtes de sécurité HTTP | faible | À poser au niveau du proxy (CSP, HSTS) |
| `scryptSync` bloque la boucle d'événements | **moyenne** | Mesuré, non corrigé — voir ci-dessous |

### La vérification de mot de passe gèle tout le serveur

`verifyPassword` (`apps/api/src/auth.ts`) appelle `scryptSync`. Le nom dit
l'essentiel : l'appel est **synchrone**, et Node n'a qu'une boucle
d'événements. Pendant la dérivation, le processus entier ne répond plus — ni
aux scans clients, ni à la sonde de santé, ni au limiteur de débit lui-même.

Mesure du 21 septembre 2026, dix tentatives simultanées avec un mauvais mot
de passe, réponses en millisecondes :

```
135  252  369  485  602  716  833  948  1066  1189
```

Parfaitement sérialisées, ~117 ms d'écart : c'est la boucle bloquée, une
dérivation à la fois. Dix mauvais mots de passe figent l'API 1,2 s.

Portée réelle :

- **Un attaquant n'a besoin d'aucun compte valide.** Des mots de passe faux
  suffisent, et ils coûtent exactement le même calcul qu'un vrai.
- **Le limiteur de débit ne protège pas de ceci**, parce qu'il s'exécute sur
  la boucle déjà bloquée. Le budget par adresse (100 / 15 min) plafonne une
  source unique, pas un ensemble d'adresses — ni un simple parc derrière NAT.
- **L'usage légitime souffre aussi** : les connexions du matin se mettent en
  file au lieu de se croiser.

Correctif connu : la variante asynchrone de `scrypt`, qui s'exécute sur le
groupe de fils libuv au lieu de la boucle. Le coût CPU ne change pas, mais il
cesse d'être exclusif. Non appliqué à ce jour — trouvé en instruisant un test
intermittent, hors du périmètre en cours, signalé plutôt que corrigé en
silence.

## 10. Signaler une faille

Écrire à l'adresse de contact du dépôt, sans publier. Réponse visée sous
48 heures.
