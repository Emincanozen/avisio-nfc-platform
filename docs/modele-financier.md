# Modèle financier — Avisio

> Généré par `scripts/financial-model.ts`. Ne pas éditer à la main :
> modifier les hypothèses dans le script et relancer `npx tsx scripts/financial-model.ts`.
> Montants en euros HT.

## 1. Revenu moyen par établissement (ARPU)

| Composante | Montant mensuel |
|---|---:|
| Abonnement moyen (mix 50 % / 35 % / 15 %) | 65 € |
| Add-on Analytics (30 % des clients Pro) | 4 € |
| Add-on Fidélité (20 % hors Premium) | 2 € |
| Plateformes supplémentaires (25 % hors quota) | 3 € |
| **ARPU mensuel** | **74 €** |

Recette ponctuelle à la signature : **35 €** (mise en service hors
engagement + plaquettes supplémentaires et premium), pour un coût matériel de
11 €.

## 2. Économie unitaire

| Indicateur | Valeur | Lecture |
|---|---:|---|
| Marge brute par client | 71 €/mois | 96 % de l'ARPU |
| Coût d'acquisition (CAC) | 271 € | coût commercial ÷ 14 signatures/mois |
| Durée de vie moyenne | 33 mois | attrition 3 %/mois |
| Valeur vie client (LTV) | 2 355 € | marge brute × durée de vie |
| **LTV / CAC** | **8.7×** | seuil de viabilité : 3× |
| **Retour sur CAC** | **3.8 mois** | seuil de confort : < 12 mois |

Le modèle tient parce que le coût variable est faible : l'analyse d'un avis par
un modèle de langage coûte moins d'un centime, et l'essentiel du prix paie le
logiciel, pas la consommation.

## 3. Projection à 3 ans

| | Année 1 | Année 2 | Année 3 |
|---|---:|---:|---:|
| Parc en fin d'année | 135 | 507 | 1064 |
| MRR en fin d'année | 9 966 € | 37 428 € | 78 547 € |
| ARR en fin d'année | 119 592 € | 449 136 € | 942 566 € |
| CA récurrent | 43 924 € | 258 896 € | 679 019 € |
| CA ponctuel (matériel, mise en service) | 5 388 € | 16 803 € | 29 353 € |
| **CA total** | **49 313 €** | **275 699 €** | **708 372 €** |
| Charges totales | 76 732 € | 243 197 € | 371 295 € |
| **EBITDA** | **-27 420 €** | **32 502 €** | **337 077 €** |
| Trésorerie en fin d'année | 12 580 € | 45 082 € | 382 159 € |

## 4. Points de passage

- **Équilibre durable atteint au mois 16** (227 établissements) : à partir de là, l'EBITDA ne repasse plus négatif.
- **Trésorerie au plus bas : 8 036 € au mois 15.** C'est
  ce creux qui dimensionne le besoin de financement, pas la perte cumulée.
- Apport initial modélisé : 40 000 €. Suffisant pour absorber le creux sans financement externe.

## 5. Détail mensuel

| Mois | Parc | MRR | CA total | Coût total | EBITDA | Trésorerie |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 0 | 0 € | 0 € | 550 € | -550 € | 39 450 € |
| 2 | 4 | 295 € | 289 € | 605 € | -315 € | 39 135 € |
| 3 | 10 | 738 € | 729 € | 645 € | 85 € | 39 219 € |
| 4 | 19 | 1 403 € | 1 389 € | 3 305 € | -1 916 € | 37 304 € |
| 5 | 30 | 2 215 € | 2 197 € | 7 172 € | -4 974 € | 32 329 € |
| 6 | 43 | 3 174 € | 3 154 € | 7 234 € | -4 080 € | 28 249 € |
| 7 | 57 | 4 208 € | 4 186 € | 7 289 € | -3 103 € | 25 146 € |
| 8 | 71 | 5 241 € | 5 218 € | 7 344 € | -2 126 € | 23 020 € |
| 9 | 85 | 6 275 € | 6 252 € | 7 389 € | -1 137 € | 21 883 € |
| 10 | 100 | 7 382 € | 7 356 € | 11 657 € | -4 301 € | 17 582 € |
| 11 | 117 | 8 637 € | 8 608 € | 11 733 € | -3 124 € | 14 457 € |
| 12 | 135 | 9 966 € | 9 934 € | 11 811 € | -1 877 € | 12 580 € |
| 13 | 155 | 11 442 € | 11 407 € | 11 895 € | -488 € | 12 092 € |
| 14 | 176 | 12 993 € | 12 955 € | 15 783 € | -2 829 € | 9 264 € |
| 15 | 199 | 14 691 € | 14 650 € | 15 878 € | -1 228 € | 8 036 € |
| 16 | 227 | 16 758 € | 16 708 € | 16 030 € | 678 € | 8 714 € |
| 17 | 256 | 18 899 € | 18 846 € | 16 143 € | 2 703 € | 11 417 € |
| 18 | 286 | 21 113 € | 21 058 € | 19 160 € | 1 898 € | 13 315 € |
| 19 | 317 | 23 402 € | 23 343 € | 23 079 € | 264 € | 13 579 € |
| 20 | 349 | 25 764 € | 25 703 € | 23 202 € | 2 501 € | 16 080 € |
| 21 | 383 | 28 274 € | 28 210 € | 23 331 € | 4 878 € | 20 958 € |
| 22 | 424 | 31 301 € | 31 225 € | 23 546 € | 7 679 € | 28 637 € |
| 23 | 465 | 34 327 € | 34 249 € | 27 497 € | 6 751 € | 35 388 € |
| 24 | 507 | 37 428 € | 37 346 € | 27 652 € | 9 694 € | 45 082 € |
| 25 | 550 | 40 602 € | 40 518 € | 27 810 € | 12 708 € | 57 790 € |
| 26 | 593 | 43 777 € | 43 689 € | 27 968 € | 15 721 € | 73 511 € |
| 27 | 637 | 47 025 € | 46 934 € | 28 129 € | 18 805 € | 92 317 € |
| 28 | 682 | 50 347 € | 50 253 € | 28 293 € | 21 960 € | 114 277 € |
| 29 | 728 | 53 743 € | 53 646 € | 28 461 € | 25 186 € | 139 462 € |
| 30 | 774 | 57 139 € | 57 039 € | 32 428 € | 24 611 € | 164 073 € |
| 31 | 821 | 60 608 € | 60 506 € | 32 599 € | 27 907 € | 191 981 € |
| 32 | 868 | 64 078 € | 63 973 € | 32 769 € | 31 203 € | 223 184 € |
| 33 | 916 | 67 621 € | 67 513 € | 32 943 € | 34 570 € | 257 754 € |
| 34 | 965 | 71 239 € | 71 128 € | 33 120 € | 38 007 € | 295 761 € |
| 35 | 1014 | 74 856 € | 74 742 € | 33 297 € | 41 445 € | 337 206 € |
| 36 | 1064 | 78 547 € | 78 430 € | 33 477 € | 44 953 € | 382 159 € |

## 6. Sensibilité

Les trois hypothèses qui font basculer le modèle, testées isolément :

| Scénario | ARR fin année 3 | EBITDA année 3 | Écart |
|---|---:|---:|---:|
| Référence | 942 566 € | 337 077 € | — |
| Attrition à 5 %/mois au lieu de 3 % | 785 767 € | 238 182 € | -98 895 € |
| Mix tiré vers le bas (70 % Essentiel, 25 % Pro, 5 % Premium) | 718 423 € | 179 228 € | -157 849 € |
| Productivité commerciale à 9 signatures/mois au lieu de 14 | 942 566 € | 207 877 € | -129 200 € |

## 7. Ce que le modèle ne dit pas

- Il suppose un cycle de vente court (une visite, une signature). Sur les
  chaînes et les franchises, comptez 3 à 6 mois et un interlocuteur siège.
- Il ne modélise pas la saisonnalité : un restaurant signe mal en août et en
  janvier. Sur l'année, l'effet se compense ; sur un trimestre, non.
- Il ignore le coût d'un accès partenaire TripAdvisor, encore inconnu à ce
  stade. Si cet accès devient payant au volume, l'add-on multi-plateformes doit
  être reprixé.
- L'attrition retenue (3 %/mois) est une hypothèse,
  pas une mesure. C'est le premier chiffre à confirmer sur les pilotes.
