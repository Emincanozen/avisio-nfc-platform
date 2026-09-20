# memory.md — mémoire du projet

Mémoire structurée et durable, destinée à toute intelligence artificielle
reprenant Avisio. Ce n'est pas une transcription de conversations : c'est
l'état, les décisions et ce qui reste.

**Dernière mise à jour : 19 septembre 2026, commit `4e5b14b`.**

---

## Règles de continuité

À lire avant d'intervenir, et à appliquer en sortant.

1. **Lire ce fichier en premier**, puis `CLAUDE.md` et `cloud.md`.
2. **Vérifier l'état réel du code avant d'agir.** Ce fichier peut avoir
   vieilli. Un commit postérieur à la date ci-dessus l'emporte sur ce qui est
   écrit ici.
3. **Ne pas traiter cette mémoire comme une preuve.** Elle dit ce qui a été
   constaté à une date, pas ce qui est vrai maintenant. Une affirmation
   importante se revérifie en lançant la commande correspondante.
4. **Mettre ce fichier à jour après toute modification structurante** :
   état, décisions, travail restant.
5. **Ne pas effacer l'historique des décisions.** Une décision renversée se
   barre et se date ; elle ne disparaît pas. Savoir pourquoi une piste a été
   écartée évite de la reprendre.
6. **Aucun secret, aucune donnée personnelle ici.** Ce fichier est committé.

---

## 1. Identité du projet

**Nom** : Avisio.

**Ce que c'est** : un portail SaaS de collecte et de pilotage des avis clients
par plaquette NFC, vendu en abonnement.

**Pour qui** : établissements de proximité en France — restauration,
hôtellerie, commerce, beauté, santé. Cible initiale : Toulouse et sa région.

**Le problème résolu** : un établissement vit de ses avis en ligne et n'a ni
le temps ni l'outillage pour s'en occuper. Trop peu d'avis, une réaction trop
lente aux avis négatifs, une présence déséquilibrée entre plateformes.

**Propriétaire** : @OZEN. Dépôt **privé** — il contient la tarification, le
modèle financier complet (CAC, LTV, projections, besoin de financement) et
l'argumentaire commercial.

**Offres** : 29 € / 79 € / 149 € par mois, plus options.

---

## 2. État actuel

### Chiffres vérifiables

| Indicateur | Valeur | Commande |
|---|---|---|
| Tests | 317, tous verts | `npm test` |
| Typecheck | passe, `src` + `test` + `scripts` | `npm run typecheck` |
| Build de production | passe | `npm run build` |
| Bout en bout sur PostgreSQL | 54 / 54 | `node scripts/smoke-test.mjs` |
| Adaptateur Prisma | 18 / 18 | `npx tsx scripts/pg-verify.mts` |
| Chaîne de notification | complète | `node scripts/push-selftest.mjs` |
| Secrets dans le dépôt | aucun | `bash scripts/check-secrets.sh` |

### Terminé et vérifié

Parcours NFC six langues · routage multi-plateformes · analyse sémantique avec
repli heuristique · alertes avis négatifs · suggestions de réponse ·
notifications e-mail et push · tendances thématiques · benchmark sectoriel
(k-anonymat, 5 pairs minimum) · fidélité · rapport mensuel HTML et PDF ·
abonnements et numérotation légale de factures · intégration caisse (webhook
HMAC) · back-office d'exploitation · **import manuel d'avis** · **limitation
de débit** · **sonde de santé profonde**.

### Implémenté mais jamais exécuté

**Le consentement Google par établissement.** Le parcours complet est écrit —
URL de consentement, état signé, échange du code, scellement AES-256-GCM du
jeton, renouvellement, liste et sélection des fiches, révocation, diagnostic
étape par étape. Aucune requête n'a jamais atteint Google. Aucune doublure ne
peut en tenir lieu : elle prouverait seulement qu'on a bien deviné la forme
des réponses.

**L'envoi d'e-mails réels** (Resend). Le code existe, le repli console est ce
qui a été exercé.

### Bloqué par un tiers

**La lecture d'avis Google réels.** Un projet Google Cloud dont la demande
d'accès n'est pas approuvée a un quota de **0 requête par minute** : tous les
appels échouent. Ce n'est pas un défaut d'implémentation, c'est l'état par
défaut. Délai d'instruction : plusieurs semaines. Procédure complète dans
`docs/google.md`.

**TripAdvisor, Facebook, Yelp** : même situation, accès partenaires non
demandés.

### Non implémenté, assumé

1. **Encaissement automatique.** La facturation est complète — émission,
   numérotation légale, PDF, relances, suspension — mais le règlement est
   constaté à la main. Brancher GoCardless ou Stripe revient à écrire un
   second adaptateur `PaymentProvider`.
2. **Envoi de SMS.** Journalisé faute d'opérateur. Le canal e-mail fonctionne.
3. **Plaquettes physiques.** **Hors périmètre logiciel, sur décision explicite
   du propriétaire** : fabrication, matériaux et fournisseurs sont traités
   séparément par @OZEN. Ne rien entreprendre là-dessus. Le produit gère déjà
   les URL, le contrôle de capacité NTAG213 et le comptage par emplacement.

### Défauts connus et non corrigés

| Défaut | Gravité | Note |
|---|---|---|
| Pas de second facteur sur le back-office | moyenne | À prévoir avant d'ouvrir l'admin à plusieurs personnes |
| Pas de journal d'audit des actions admin | moyenne | Journaux applicatifs seulement |
| Pas de rotation automatique des secrets | moyenne | Manuelle, documentée |
| `npm audit` absent de l'intégration continue | faible | À ajouter |
| En-têtes de sécurité HTTP (CSP, HSTS) | faible | À poser au niveau du proxy |
| Aucune montée en charge mesurée | faible | Les besoins annoncés sont une estimation |

---

## 3. Décisions structurantes

Chacune avec sa raison et l'alternative écartée. **Ne pas les renverser sans
lire la raison.**

### D1 — Port et adaptateurs pour la persistance

Un port (`repository/types.ts`), deux implémentations (mémoire, Prisma).

*Pourquoi* : faire la démonstration commerciale sur un portable sans base,
sans Docker et sans réseau, avec exactement le même code qu'en production.

*Écarté* : Prisma partout, avec SQLite en développement. Deux dialectes SQL
donnent deux comportements, et les écarts apparaissent en production.

*Ce que ça coûte* : toute table s'ajoute dans les deux adaptateurs, et les
tests n'exercent que celui en mémoire. D'où D7.

### D2 — Domaine métier pur, sans dépendance

Tout ce qui se calcule vit dans `packages/core` : tarification, facturation,
routage, conformité, NLP, import.

*Pourquoi* : ces règles se testent sans monter de serveur, et ce sont elles
qui portent les exigences légales.

### D3 — Mode dégradé explicite, jamais de crash au démarrage

Chaque dépendance absente bascule sur un repli annoncé.

*Pourquoi* : le produit doit démarrer sur n'importe quelle machine, en
démonstration, sans configuration.

*Conséquence* : ajouter une dépendance externe, c'est ajouter son mode
dégradé et son annonce dans `/health`.

### D4 — Conformité exécutable, pas déclarative

Les règles anti-filtrage sont du code testé (`compliance.ts`, 24 tests), pas
une clause de CGV.

*Pourquoi* : c'est le risque juridique principal (directive UE 2019/2161), et
c'est aussi l'argument de vente. Une règle qu'on peut contourner par
distraction n'est pas une règle.

*Conséquence* : l'API ne reçoit jamais la note pressentie d'un client. Le
routage **ne peut pas** en dépendre, même par erreur de programmation.

### D5 — Consentement Google par établissement, pas de jeton global

*Pourquoi* : une fiche appartient à l'établissement. Personne ne peut
consentir à la place d'un autre. Un jeton unique couvrant tout le parc ne peut
pas exister chez Google.

*Renversé le 19 septembre 2026* : le code partait de l'hypothèse inverse
(`GOOGLE_REFRESH_TOKEN` global lu dans l'environnement). Tenable pour une
démonstration mono-établissement, faux pour le produit. La variable subsiste
comme repli hérité ; ne pas s'en servir en multi-établissements.

### D6 — Compteurs de limitation de débit en base, pas en mémoire

*Pourquoi* : un compteur par processus divise le budget réel par le nombre
d'instances et se remet à zéro à chaque redéploiement — exactement le moment
où un attaquant persistant reprend la main.

*Écarté* : Redis. Une dépendance de plus à administrer pour un volume que
PostgreSQL absorbe sans effort, sur un produit exploité par une personne
seule.

### D7 — Typecheck étendu aux fichiers de test et aux scripts

`tsconfig.typecheck.json`, dans le script `npm run typecheck`.

*Pourquoi* : les tsconfig de build n'incluent que `src`. Une doublure de
service incomplète compilait et n'échouait qu'à l'exécution, avec une erreur
sans rapport apparent avec la cause. **Ce contrôle a attrapé ce cas deux
fois.** Ne pas le retirer.

### D8 — Deux budgets distincts à la connexion

Par compte (strict) et par adresse (large).

*Pourquoi* : un siège de chaîne, un hôtel, un espace de coworking sortent par
une seule adresse publique. Serrer là enferme dehors des clients légitimes
sans gêner un attaquant, qui dispose de bien plus d'une adresse. C'est le
budget par compte qui protège réellement un mot de passe.

*Découvert en cassant deux tests* : le premier budget, à 5 par minute et par
IP, faisait tomber la suite de tests, qui se connecte plusieurs fois depuis la
même adresse. Le symptôme disait quelque chose de vrai sur le produit.

### D9 — La landing d'une plaquette non configurée répond 200

*Pourquoi* : celui qui la reçoit est un client debout au comptoir, pas un
opérateur. Une erreur technique lui fait croire que l'établissement est en
panne.

*Renversé le 19 septembre 2026* : un audit précédent avait fait passer cette
route de 500 à 409, ce qui était juste vu de l'exploitation et faux vu du
client. Le dépôt de scan, lui, reste en 409 : il n'existe réellement aucune
URL vers laquelle rediriger.

### D10 — Import manuel d'avis, marqué comme tel

`Review.source` vaut `sync` ou `import`, jusqu'en base.

*Pourquoi* : c'est le seul chemin honnête pour alimenter le produit tant que
Google n'a pas approuvé l'accès — et il restera utile pour les plateformes
sans API ouverte. La distinction interdit qu'un chiffre du tableau de bord
laisse croire à une connexion en direct qui n'existe pas.

### D12 — Une connexion réussie remet le compteur à zéro

*Pourquoi* : le budget de connexion existe pour ralentir qui devine un mot de
passe. Un mot de passe correct est la démonstration du contraire. Sans cette
remise à zéro, un gérant se verrouille sur ses propres succès — téléphone,
ordinateur, tablette, gestionnaire de mots de passe.

*Ce que cela n'ouvre pas* : un attaquant capable de se connecter n'a plus rien
à deviner.

*Découvert* en exécutant le test de bout en bout quatre fois de suite.

### D11 — Analyseur CSV écrit à la main

*Pourquoi* : les exports de plateformes contiennent des commentaires à
virgules, à guillemets doublés et à retours à la ligne. C'est exactement là
qu'un analyseur naïf tronque un avis sans rien signaler — et un avis tronqué
fausse l'analyse de sentiment.

---

## 4. Travail effectué

### Session du 19 septembre 2026

Quatre commits, sur demande d'un audit complet et de la finalisation.

**`7a68f2b` — Limitation de débit, cloisonnement du push, CORS.**
Politique dans le domaine, comptage derrière le port. Deux budgets de
connexion (D8). `/push/unsubscribe` agissait sur le seul point de terminaison :
un gérant pouvait couper les notifications d'un autre, donc l'aveugler sur ses
avis négatifs. `trustProxy` passé de `true` à désactivé par défaut. CORS
restreint hors routes publiques. 17 tests.

**`6d24386` — Consentement Google par établissement et import manuel.**
Voir D5, D10, D11. Scellement AES-256-GCM des jetons. 45 tests.

**`c22b4b4` — Garde-fous IA, sonde de santé, plaquette non configurée.**
Voir D9. Neutralisation de la clôture de bloc dans les prompts, bornage,
consigne rappelée après la donnée. Plafond de dépense et délai de garde.
`/health` interroge réellement la base et répond 503 sinon. Correction d'un
gaspillage de quota d'API tierce (`lastReviewDate` non filtré par plateforme).
7 tests.

**`45cb760` — Documentation d'exploitation, intégration continue, mémoire.**
CLAUDE.md, cloud.md, memory.md, docs/deploiement.md, docs/securite.md,
`.github/workflows/ci.yml`, `scripts/check-secrets.sh`. Ce dernier fouille
aussi l'historique Git : un `.gitignore` ne protège que l'avenir.

**`07c21b7` — Écriture française des nombres.**
Une alerte de tendance affichait « 1.4/5 » à côté d'indicateurs écrits
« 3,62 ». Troisième occurrence de la même famille de défaut. Un test parcourt
maintenant les sources et échoue si `toFixed` apparaît dans du texte destiné à
un francophone ; vérifié qu'il échoue réellement sur une violation. La
consommation du modèle de langage est passée dans l'interface du back-office,
la documentation affirmant à tort qu'elle y était déjà.

**`939888a` — Vérification sur PostgreSQL.**
Le code Prisma des deux commits précédents n'avait jamais tourné.
`scripts/pg-verify.mts`, 18 contrôles : SQL brut sous 60 requêtes simultanées,
cycle complet d'une connexion Google, colonne de provenance. Autotest de
notification rendu déterministe — il supposait un jeu de démonstration neuf et
annonçait une panne inexistante sur une base plus fournie, ce qui est le pire
défaut possible pour un autotest.

**`3d1fc97` · `a31fc16` — Défauts trouvés en exploitant le produit.**
Trois défauts de la limitation de débit, invisibles pour la suite de tests et
apparus en lançant les scripts de vérification comme un exploitant le ferait,
plusieurs fois dans la même heure : une connexion réussie consommait le budget
du compte (verrouillage sur ses propres succès), le budget des traitements de
fond était trop serré pour une séance de support, et le test de bout en bout
verrouillait le compte dont il avait besoin. Voir D12.

### Sessions précédentes

- `bc8df5b` — Audit de fiabilité : sept défauts, dont deux failles de
  cloisonnement (`/ops/ingest` ouvert à tout gérant, `/alerts/:id/read` sans
  contrôle). Adaptateur PostgreSQL exécuté pour la première fois.
- `3fbcb24` — Refus d'amorcer le jeu de démonstration en production.
- `88ec97d` — État des lieux vérifié, autotest de la chaîne de notification.
- `fed9788` — Facturation, push, rapport PDF, caisse, back-office.
- `5fa25dc` — Fondations.

---

## 5. Travail restant

### Priorité 1 — dépend de @OZEN, bloque le lancement

1. **Demande d'accès à l'API Google Business Profile.** Rien ne remplace cette
   étape et elle prend des semaines : la lancer en premier. Procédure exacte
   dans `docs/google.md` §3.
2. **Premier déploiement.** `docs/deploiement.md`. Rien n'est déployé à ce
   jour. Trois choses à vérifier dans cet ordre au premier déploiement :
   installation, restauration d'une sauvegarde de test, réception d'une
   notification sur un vrai téléphone.

### Priorité 2 — avant les premiers clients payants

3. **Encaissement.** Écrire un adaptateur `PaymentProvider` (GoCardless pour
   le SEPA, ou Stripe Billing). L'interface existe déjà côté service de
   facturation.
4. **Second facteur sur le back-office.**
5. **Journal d'audit des actions administrateur.**
6. **En-têtes de sécurité HTTP** au niveau du proxy.

### Priorité 3 — dette identifiée

7. `npm audit` dans l'intégration continue.
8. Opérateur SMS pour les invitations de caisse.
9. Mesure de montée en charge.

### Prochaine action concrète

**Créer le dépôt GitHub privé et y pousser.** Le travail local est complet et
committé ; aucun outil `gh` ni identifiant n'est disponible dans
l'environnement de travail, la création revient donc à @OZEN.

Puis, dans l'ordre : demande d'accès Google (priorité 1.1, délai long),
déploiement (1.2), encaissement (2.3).

---

## 6. Contraintes imposées par le propriétaire

- **Dépôt privé.** Il contient la tarification, le modèle financier complet et
  l'argumentaire commercial.
- **Ne rien entreprendre sur les plaquettes physiques.** Fournisseurs et
  fabrication sont traités séparément par @OZEN. Instruction explicite.
- **Français partout** : code, commentaires, interface, messages d'erreur,
  format des nombres et des dates.
- **Honnêteté sur l'état réel.** Distinguer systématiquement « implémenté » de
  « vérifié », et nommer ce qui n'a pas pu être testé. C'est une exigence
  répétée, et c'est ce qui rend la documentation de ce projet utilisable : une
  affirmation invérifiée présentée comme acquise fait plus de dégâts qu'une
  fonctionnalité manquante.
