# Avisio — revue privée du 30 octobre 2026

## Présentation

Avisio est un portail de collecte et de suivi des avis clients par plaquettes NFC. Le visiteur rejoint une plateforme d'avis ; le gérant suit les avis, les alertes, les suggestions de réponse et ses factures. L'exploitant dispose d'une administration du parc. Le produit ne trie pas les clients selon la note qu'ils pourraient donner.

Le cœur métier est dans `packages/core`, l'API Fastify dans `apps/api`, l'interface Next.js dans `apps/web`. Deux adaptateurs de persistance, mémoire et PostgreSQL, permettent une démonstration locale et une exploitation persistante. Les modes simulés doivent rester identifiables.

## Correction du planificateur mensuel

Au démarrage, le planificateur initialisait le dernier mois envoyé avec le mois courant. Un serveur lancé le premier du mois considérait donc le rapport comme déjà traité et sautait son envoi. Il marquait aussi la période avant de connaître le résultat.

Un garde-fou dédié suit maintenant la période avec l'année, marque une réussite après traitement, empêche les chevauchements et permet une nouvelle tentative après rejet ou résultat incomplet. Trois tests couvrent démarrage le premier, année suivante, erreurs et concurrence.

**Limite conservée :** le suivi reste local au processus. Un redémarrage le premier peut provoquer un nouvel envoi et une reprise après échec partiel peut renvoyer aux destinataires déjà servis. Une garantie par destinataire exige un journal persistant et une stratégie de reprise, à traiter avant une exploitation multi-instance.

## Dépendances

Les correctifs compatibles ont été appliqués. Vitest a été migré vers 5 et Zod vers 4 pour corriger des alertes nécessitant un changement de version majeure ; les tests et le typage ont été relancés. Next.js reste sur sa branche 15 avec le correctif disponible, sans migration précipitée de framework.

L'audit final conserve des alertes, notamment la chaîne Prisma/configuration et PostCSS/Next. Elles sont documentées dans le rapport de session ; « build réussi » ne signifie pas « aucune vulnérabilité ».

## Vérifications réalisées

- 399 tests passent, dont trois nouvelles régressions.
- Vérification TypeScript, incluant tests et scripts.
- Build de production API et interface.
- 36 contrôles de l'adaptateur Prisma sur PostgreSQL 16 jetable.
- 56 contrôles HTTP sur l'API utilisant cette base.
- Recherche de secrets selon le scanner du projet sur les fichiers et l'historique disponible localement. La copie est superficielle : ce résultat ne constitue pas un audit de tout l'historique distant.

L'autotest push n'a pas été validé dans la première exécution : aucune requête n'a atteint le faux service HTTPS, faute de configuration VAPID et/ou de confiance dans le certificat local. Aucune vérification TLS n'a été désactivée. Les fournisseurs réels ne sont pas couverts par ces résultats.

## Avant tout lancement

L'accès Google Business Profile, les e-mails réels, les paiements automatisés, le second facteur administrateur, la rotation des secrets et la charge demandent encore leurs validations ou implémentations dédiées. Voir [l'état des lieux](docs/etat-des-lieux.md) et [les limites documentées](memory.md).

Le dépôt reste privé, en particulier parce qu'il contient le modèle financier et les informations commerciales. Aucun service n'est déployé et aucune branche de revue n'est fusionnée.
