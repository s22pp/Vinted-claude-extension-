import { describe, expect, it } from 'vitest';
import { nextPilotAt, pilotConfig, pilotNotice } from '@/intelligence/pilot';

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime();
const round = { hour: 12, stopped: null, imported: { listings: 18, sold: 3 }, offers: 0, favourites: 0, delivered: 0, deals: 0, backup: false, toShip: 0, late: 0, toCollect: 0 };

describe('autopilot: two rounds a day at the seller’s hours', () => {
  it('the next round: later today at one of the hours, else tomorrow at the first', () => {
    expect(nextPilotAt(at(16, 9, 30), [12, 21])).toBe(at(16, 12));
    expect(nextPilotAt(at(16, 12, 0), [12, 21])).toBe(at(16, 21));
    expect(nextPilotAt(at(16, 21, 5), [12, 21])).toBe(at(17, 12));
    expect(nextPilotAt(at(16, 22), [21, 12])).toBe(at(17, 12));
  });

  it('settings: off by default, 12 h and 21 h, hours kept valid and ordered', () => {
    expect(pilotConfig(null)).toEqual({ enabled: false, hours: [12, 21] });
    expect(pilotConfig({ enabled: true, hours: [21, 8, 8, 30] })).toEqual({ enabled: true, hours: [8, 21] });
    expect(pilotConfig({ hours: [] }).hours).toEqual([12, 21]);
  });

  it('the notice: what was done, then what only the seller can do', () => {
    const n = pilotNotice({ ...round, offers: 2, delivered: 1, backup: true, toShip: 3, toCollect: 1 });
    expect(n.title).toBe('Tournée de 12 h faite');
    expect(n.lines).toEqual(['Stock lu : 18 annonces, 3 ventes', 'Fait : 2 offres traitées · 1 message colis livré · sauvegarde faite', 'Pour vous : 3 colis à envoyer (bordereaux dans Ventes) · 1 colis à retirer']);
    expect(pilotNotice(round).lines.slice(1)).toEqual(['Fait : rien à traiter', 'Pour vous : rien d’urgent']);
    const stopped = pilotNotice({ ...round, imported: null, stopped: 'NOT_LOGGED_IN · session expirée' });
    expect(stopped.title).toBe('Tournée de 12 h arrêtée');
    expect(stopped.lines[0]).toBe('Arrêt : NOT_LOGGED_IN · session expirée');
  });
});
