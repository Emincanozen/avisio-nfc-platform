import { describe, expect, it } from 'vitest';
import { creerPlanificationMensuelle } from '../src/services/monthly-schedule.js';

describe('Planification mensuelle', () => {
  it('envoie après un démarrage le premier, une seule fois par mois et année', async () => {
    let date = new Date('2026-11-01T23:30:00Z');
    let appels = 0;
    const executer = creerPlanificationMensuelle(async () => { appels++; return { errors: [] }; }, () => date);
    await executer(); await executer(); expect(appels).toBe(1);
    date = new Date('2026-11-02T00:00:00Z');
    await executer(); expect(appels).toBe(1);
    date = new Date('2027-11-01T00:00:00Z');
    await executer(); expect(appels).toBe(2);
  });

  it('réessaie après un rejet ou un rapport incomplet', async () => {
    let appels = 0;
    const executer = creerPlanificationMensuelle(async () => {
      appels++;
      if (appels === 1) throw new Error('Indisponible');
      return { errors: appels === 2 ? ['Échec'] : [] };
    }, () => new Date('2026-11-01T23:30:00Z'));
    await expect(executer()).rejects.toThrow('Indisponible');
    await expect(executer()).rejects.toThrow('incomplets');
    await executer(); await executer(); expect(appels).toBe(3);
  });

  it('empêche le chevauchement des envois', async () => {
    let appels = 0;
    let terminer: () => void = () => {};
    const executer = creerPlanificationMensuelle(async () => {
      appels++;
      await new Promise<void>(resolve => { terminer = resolve; });
      return { errors: [] };
    }, () => new Date('2026-11-01T23:30:00Z'));
    const premier = executer();
    await executer(); expect(appels).toBe(1);
    terminer(); await premier;
  });
});
