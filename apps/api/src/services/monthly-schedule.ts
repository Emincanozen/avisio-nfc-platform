/**
 * Un démarrage le premier du mois ne doit pas désactiver l'envoi du mois.
 * Le verrou ne dure que le temps du traitement ; un échec reste réessayable.
 * Ce garde-fou est local au processus, pas une déduplication persistante.
 */
export function createMonthlySchedule(
  send: () => Promise<{ errors: string[] }>,
  now: () => Date = () => new Date(),
): () => Promise<void> {
  let lastPeriod: string | undefined;
  let running = false;
  return async () => {
    const date = now();
    const period = `${date.getUTCFullYear()}-${date.getUTCMonth()}`;
    if (date.getUTCDate() !== 1 || lastPeriod === period || running) return;
    running = true;
    try {
      const result = await send();
      if (result.errors.length > 0) {
        throw new Error(`Rapports mensuels incomplets : ${result.errors.length} échec(s).`);
      }
      lastPeriod = period;
    } finally {
      running = false;
    }
  };
}
