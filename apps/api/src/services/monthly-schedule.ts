/**
 * Un démarrage le premier du mois ne doit pas désactiver l'envoi du mois.
 * Le verrou ne dure que le temps du traitement ; un échec reste réessayable.
 * Ce garde-fou est local au processus, pas une déduplication persistante.
 */
export function creerPlanificationMensuelle(
  envoyer: () => Promise<{ errors: string[] }>,
  maintenant: () => Date = () => new Date(),
): () => Promise<void> {
  let dernierePeriode: string | undefined;
  let enCours = false;
  return async () => {
    const date = maintenant();
    const periode = `${date.getUTCFullYear()}-${date.getUTCMonth()}`;
    if (date.getUTCDate() !== 1 || dernierePeriode === periode || enCours) return;
    enCours = true;
    try {
      const resultat = await envoyer();
      if (resultat.errors.length > 0) {
        throw new Error(`Rapports mensuels incomplets : ${resultat.errors.length} échec(s).`);
      }
      dernierePeriode = periode;
    } finally {
      enCours = false;
    }
  };
}
