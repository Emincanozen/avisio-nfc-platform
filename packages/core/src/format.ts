/**
 * Écriture française des nombres.
 *
 * Un seul endroit, parce que l'incohérence est le vrai défaut : un tableau de
 * bord qui affiche « 3,62 » à côté d'une alerte qui dit « 1.4/5 » et d'un PDF
 * qui écrit « 3,89 » donne l'impression de trois logiciels différents
 * assemblés à la hâte. Le lecteur ne sait plus lequel croire.
 *
 * `toFixed` produit toujours un point décimal, quelle que soit la locale du
 * serveur : ce n'est donc pas une question de configuration d'environnement,
 * c'est une fonction qu'il ne faut pas utiliser pour du texte destiné à un
 * francophone.
 */

/** Nombre au format français : `3,62`, `1 516,00`. */
export const fr = (value: number, digits = 2): string =>
  value.toLocaleString('fr-FR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

/**
 * Nombre signé, avec le vrai signe moins typographique (U+2212).
 *
 * Le trait d'union du clavier est plus court et se confond avec une césure en
 * fin de ligne. La distinction se voit, sur un écart de note affiché en gras.
 */
export const frSigned = (value: number, digits = 2): string =>
  `${value > 0 ? '+' : value < 0 ? '−' : ''}${fr(Math.abs(value), digits)}`;

/** Pourcentage au format français, à partir d'une part entre 0 et 1. */
export const frPercent = (ratio: number, digits = 1): string =>
  `${fr(ratio * 100, digits)} %`;
