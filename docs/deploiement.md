# Déploiement et exploitation

Écrit pour une personne seule. Chaque procédure est donnée pour être exécutée
sous pression, sans relire le reste du document.

**Rien n'est déployé à ce jour.** Ce document décrit une cible vérifiée
localement, pas une installation en fonctionnement. La section 9 dit ce qui
n'a pas pu être vérifié.

---

## 1. Ce qu'il faut

| Élément | Minimum | Pourquoi |
|---|---|---|
| Machine | 2 vCPU, 4 Go | Node + PostgreSQL + Next.js tiennent largement |
| PostgreSQL | 16 | Le schéma utilise des tableaux et `ON CONFLICT` |
| Node | 22 LTS | Exigé par `engines` |
| Domaine + TLS | oui | Le push web ne fonctionne qu'en HTTPS. Sans lui, pas d'alertes sur téléphone |
| Sauvegarde | quotidienne hors machine | Voir §6 |

Un seul serveur suffit pour les premières dizaines de clients. Le passage à
plusieurs instances est prévu : les compteurs de limitation de débit sont en
base, pas en mémoire, précisément pour cela.

## 2. Variables d'environnement

Partir de `.env.example`. Les cinq qui comptent en production :

```bash
DATABASE_URL=postgresql://avisio:MOTDEPASSE@localhost:5432/avisio
JWT_SECRET=<32+ caractères aléatoires>
SECRETS_KEY=<32+ caractères aléatoires, DIFFÉRENTS de JWT_SECRET>
PUBLIC_WEB_URL=https://app.votre-domaine.fr
PUBLIC_API_URL=https://api.votre-domaine.fr
TRUST_PROXY=1
```

Les générer :

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

> **`SECRETS_KEY` séparé de `JWT_SECRET`.** Le premier scelle les jetons Google
> des clients, le second signe les sessions. Confondus, faire tourner le
> secret des sessions — opération banale — rendrait illisibles tous les jetons
> Google et obligerait chaque client à réautoriser sa fiche.

> **`TRUST_PROXY=1` seulement s'il y a réellement un reverse proxy devant.**
> C'est l'IP qui sert de clé à toute la limitation de débit. La renseigner
> sans proxy laisse n'importe qui se donner une adresse neuve à chaque requête
> et annule tous les budgets. Le nombre de sauts est préférable à une liste
> d'adresses : il ne se périme pas quand l'hébergeur change ses plages.

Ne jamais mettre ces valeurs dans le dépôt. `bash scripts/check-secrets.sh`
le vérifie, et tourne aussi en intégration continue.

## 3. Installation

```bash
git clone <dépôt> avisio && cd avisio
npm ci
cp .env.example .env && $EDITOR .env      # renseigner la section 2

npx prisma db push --schema apps/api/prisma/schema.prisma
npx prisma generate --schema apps/api/prisma/schema.prisma
npm run build
```

Créer le premier compte administrateur. `npm run seed` **refuse** de tourner
avec `NODE_ENV=production` : il créerait `admin@avisio.fr / admin1234`, des
identifiants publiés dans ce dépôt.

```bash
node -e "
const { createPrismaRepository } = require('./apps/api/dist/repository/prisma.js');
const { hashPassword } = require('./apps/api/dist/auth.js');
(async () => {
  const repo = await createPrismaRepository();
  await repo.managers.create({
    id: 'mgr_admin',
    email: process.env.ADMIN_EMAIL,
    passwordHash: hashPassword(process.env.ADMIN_PASSWORD),
    name: 'Exploitation',
    role: 'admin',
    establishmentIds: [],
    createdAt: new Date().toISOString(),
  });
  await repo.close();
  console.log('Compte administrateur créé.');
})();
"
```

Le mot de passe passe par une variable d'environnement, jamais par l'historique
du shell. `ADMIN_EMAIL=... ADMIN_PASSWORD=... node -e "..."`, précédé d'une
espace si le shell est configuré pour ignorer ces lignes.

## 4. Démarrage

Deux processus : l'API (port 4000) et l'interface (port 3000).

`systemd` suffit et évite d'ajouter une technologie pour rien.

```ini
# /etc/systemd/system/avisio-api.service
[Unit]
Description=Avisio API
After=network.target postgresql.service

[Service]
Type=simple
User=avisio
WorkingDirectory=/opt/avisio
EnvironmentFile=/opt/avisio/.env
ExecStart=/usr/bin/node apps/api/dist/server.js
Restart=always
RestartSec=5
# Redémarrage en boucle : on abandonne plutôt que de marteler la base.
StartLimitBurst=5
StartLimitIntervalSec=120

[Install]
WantedBy=multi-user.target
```

```ini
# /etc/systemd/system/avisio-web.service
[Unit]
Description=Avisio interface
After=network.target avisio-api.service

[Service]
Type=simple
User=avisio
WorkingDirectory=/opt/avisio/apps/web
EnvironmentFile=/opt/avisio/.env
ExecStart=/usr/bin/npx next start -p 3000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now avisio-api avisio-web
```

### Reverse proxy

```nginx
server {
    server_name api.votre-domaine.fr;
    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        # Sans ces deux lignes, toutes les requêtes semblent venir de
        # 127.0.0.1 et la limitation de débit devient un compteur unique
        # pour la terre entière — donc inutilisable.
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    server_name app.votre-domaine.fr;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

TLS par `certbot --nginx`. Ce n'est pas optionnel : le push web l'exige, et
c'est lui qui porte les alertes.

## 5. Mise à jour

```bash
cd /opt/avisio
sudo systemctl stop avisio-web                      # l'interface d'abord
git pull
npm ci
npx prisma db push --schema apps/api/prisma/schema.prisma
npm run build
sudo systemctl restart avisio-api
sudo systemctl start avisio-web
curl -sf https://api.votre-domaine.fr/health | jq
```

**Toujours sauvegarder avant `prisma db push`** (§6). La commande peut
demander une suppression de données si le schéma a changé de façon
incompatible ; dans ce cas, s'arrêter et lire, jamais forcer.

Retour arrière : `git checkout <commit précédent> && npm ci && npm run build`
puis redémarrer. Une migration de schéma, elle, ne se défait pas ainsi — d'où
la sauvegarde.

## 6. Sauvegarde et restauration

Tout l'état est dans PostgreSQL. Les fichiers sont reconstructibles depuis le
dépôt.

```bash
# /etc/cron.daily/avisio-backup
#!/bin/sh
set -e
DEST=/var/backups/avisio
mkdir -p "$DEST"
pg_dump -Fc -U avisio avisio > "$DEST/avisio-$(date +%F).dump"
# 30 jours sur place. Une sauvegarde qui vit sur la machine sauvegardée ne
# sauvegarde rien : la copier hors de la machine est la partie qui compte.
find "$DEST" -name 'avisio-*.dump' -mtime +30 -delete
rclone copy "$DEST" distant:avisio-sauvegardes
```

**Sauvegarder aussi `.env`**, séparément et chiffré. Sans `SECRETS_KEY`, une
restauration rend tous les jetons Google illisibles et oblige chaque client à
réautoriser sa fiche.

### Restauration

```bash
sudo systemctl stop avisio-api avisio-web
createdb -U avisio avisio_restore
pg_restore -U avisio -d avisio_restore /var/backups/avisio/avisio-2026-09-19.dump

# Vérifier AVANT de basculer : une restauration qu'on découvre incomplète
# après avoir supprimé l'originale n'est pas une restauration.
psql -U avisio -d avisio_restore -c "SELECT count(*) FROM establishments;"
psql -U avisio -d avisio_restore -c "SELECT count(*) FROM invoices;"
psql -U avisio -d avisio_restore -c \
  "SELECT year, value FROM invoice_counters;"

# Puis seulement : renommer, et redémarrer.
```

> **Contrôle de la numérotation des factures.** Après restauration, vérifier
> que `invoice_counters` est cohérent avec la plus grande facture existante.
> Un compteur inférieur produirait des numéros en double, ce qui est une
> irrégularité comptable et pas seulement un bogue.

**Tester la restauration une fois par trimestre, sur une base de côté.** Une
sauvegarde jamais restaurée est une hypothèse, pas une sauvegarde.

## 7. Supervision

### Ce qu'il faut regarder

```bash
curl -sf https://api.votre-domaine.fr/health | jq
```

Répond **503** si PostgreSQL est injoignable — la sonde interroge réellement
la base, elle ne se contente pas de constater que le processus vit. Brancher
la supervision là-dessus, avec une alerte au bout de deux échecs consécutifs.

Le champ `capabilities` dit ce qui tourne en mode dégradé. En production,
`persistence` et `push` doivent être à `true`.

### Journaux

```bash
journalctl -u avisio-api -f
journalctl -u avisio-api --since "1 hour ago" -p warning
```

Ce qui mérite qu'on s'y arrête :

| Message | Ce que ça veut dire |
|---|---|
| `Débit dépassé (...)` | Normal en petit nombre. En rafale : abus ou budget trop bas |
| `Plafond d'appels au modèle atteint` | Quelque chose s'emballe, ou le plafond est sous-dimensionné |
| `Sonde de santé : persistance injoignable` | Base tombée — priorité absolue |
| `Jeton Google indisponible pour ...` | Un client a retiré son autorisation : à recontacter |
| `Envoi push en échec` | Abonnement périmé côté navigateur, le plus souvent bénin |

### Coûts

Back-office → **Vue d'ensemble**. Le bloc `llm` donne appels, jetons et appels
plafonnés sur l'heure en cours. `throttled` à zéro est le cas normal ; s'il
monte durablement, soit le plafond est trop bas pour l'usage réel, soit
quelque chose boucle.

## 8. Procédures d'incident

### L'API ne répond plus

```bash
systemctl status avisio-api
journalctl -u avisio-api -n 100 --no-pager
curl -sf http://127.0.0.1:4000/health        # court-circuite le proxy
pg_isready -U avisio -d avisio
```

Base tombée → la redémarrer ; l'API se reconnecte seule. Processus mort →
`systemctl restart avisio-api` puis chercher la cause dans les journaux,
plutôt que de redémarrer en boucle.

### Un client dit ne plus recevoir ses alertes

Dans l'ordre, du plus fréquent au plus rare :

1. Espace gérant → **Sources d'avis** → *Tester la connexion*. Le diagnostic
   nomme l'étape qui bloque.
2. Onglet **Notifications** : les préférences et les heures calmes.
3. `/push/test` depuis son espace : vérifie l'appareil.
4. Journaux : `journalctl -u avisio-api | grep -i push`.

### Le trafic explose

La limitation de débit répond déjà en 429. Si le volume est légitime (un
client vient d'équiper trente établissements), relever les budgets dans
`packages/core/src/ratelimit.ts` et redéployer. S'il ne l'est pas, bloquer
l'adresse au niveau du proxy : c'est là que ça coûte le moins cher.

### Ajouter un client

Back-office → **Nouvel établissement**. Un écran, un appel : établissement,
compte gérant, fiche Google, plaquettes, abonnement et première facture. Le
gérant se connecte ensuite et fait sa connexion Google lui-même.

## 9. Ce qui n'a pas été vérifié

Par honnêteté, et parce que ces points sont ceux qui surprennent :

- **Aucun déploiement réel n'a eu lieu.** Les fichiers `systemd` et nginx
  ci-dessus sont écrits, relus, jamais exécutés sur un serveur.
- **La sauvegarde et la restauration n'ont pas été jouées** sur une
  installation réelle. Les commandes sont standard, mais « standard » n'est
  pas « vérifié ».
- **Le push n'a pas été reçu sur un vrai téléphone.** La chaîne est prouvée
  jusqu'à la requête chiffrée sortante (`node scripts/push-selftest.mjs`) ;
  la livraison par Google ou Mozilla demande un domaine en HTTPS.
- **Aucune montée en charge n'a été mesurée.** Les 4 Go de la section 1 sont
  une estimation, pas un relevé.

À faire dans cet ordre au premier déploiement : installer, restaurer une
sauvegarde de test, recevoir une notification sur un téléphone réel.
