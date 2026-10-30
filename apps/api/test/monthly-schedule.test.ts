import { describe, expect, it } from 'vitest';
import { createMonthlySchedule } from '../src/services/monthly-schedule.js';

describe('Planification mensuelle', () => {
  it('envoie après un démarrage le premier, une seule fois par mois et année', async () => {
    let date = new Date('2026-11-01T00:00:00Z');
    let calls = 0;
    const run = createMonthlySchedule(async () => { calls++; return { errors: [] }; }, () => date);
    await run(); await run(); expect(calls).toBe(1);
    date = new Date('2026-11-02T00:00:00Z');
    await run(); expect(calls).toBe(1);
    date = new Date('2027-11-01T00:00:00Z');
    await run(); expect(calls).toBe(2);
  });

  it('réessaie après un rejet ou un rapport incomplet', async () => {
    let calls = 0;
    const run = createMonthlySchedule(async () => {
      calls++;
      if (calls === 1) throw new Error('Indisponible');
      return { errors: calls === 2 ? ['Échec'] : [] };
    }, () => new Date('2026-11-01T00:00:00Z'));
    await expect(run()).rejects.toThrow('Indisponible');
    await expect(run()).rejects.toThrow('incomplets');
    await run(); await run(); expect(calls).toBe(3);
  });

  it('empêche le chevauchement des envois', async () => {
    let calls = 0;
    let finish: () => void = () => {};
    const run = createMonthlySchedule(async () => {
      calls++;
      await new Promise<void>(resolve => { finish = resolve; });
      return { errors: [] };
    }, () => new Date('2026-11-01T00:00:00Z'));
    const first = run();
    await run(); expect(calls).toBe(1);
    finish(); await first;
  });
});
