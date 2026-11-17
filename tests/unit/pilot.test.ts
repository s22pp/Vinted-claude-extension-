import { describe, expect, it } from 'vitest';
import { addPilotHour, nextPilotAt, pilotConfig, pilotNotice, runLateRound } from '@/intelligence/pilot';

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime();
const round = { hour: 12, stopped: null, imported: { listings: 18, sold: 3 }, offers: 0, favourites: 0, delivered: 0, deals: 0, labels: 0, labelsNotSaved: 0, backup: false, toShip: 0, late: 0, toCollect: 0 };

describe('autopilot: two rounds a day at the seller’s hours', () => {
  it('the next round: later today at one of the hours, else tomorrow at the first', () => {
    expect(nextPilotAt(at(16, 9, 30), [12, 21])).toBe(at(16, 12));
    expect(nextPilotAt(at(16, 12, 0), [12, 21])).toBe(at(16, 21));
    expect(nextPilotAt(at(16, 21, 5), [12, 21])).toBe(at(17, 12));
    expect(nextPilotAt(at(16, 22), [21, 12])).toBe(at(17, 12));
  });

  it('settings: off by default, 9 h, 13 h and 21 h, hours kept valid and ordered, four at the most', () => {
    expect(pilotConfig(null)).toEqual({ enabled: false, hours: [9, 13, 21], labels: false, v: 2 });
    expect(pilotConfig({ enabled: true, hours: [21, 8, 8, 30], labels: true, v: 2 })).toEqual({ enabled: true, hours: [8, 21], labels: true, v: 2 });
    expect(pilotConfig({ hours: [] }).hours).toEqual([9, 13, 21]);
    expect(pilotConfig({ hours: [23, 7, 9, 11, 13, 15], v: 2 }).hours).toEqual([7, 9, 11, 13]);
  });

  it('the former default (12 h + 21 h, never chosen since) becomes the three rounds; a choice made since is kept', () => {
    expect(pilotConfig({ enabled: true, hours: [12, 21] }).hours).toEqual([9, 13, 21]);
    expect(pilotConfig({ enabled: true, hours: [12, 21], v: 2 }).hours).toEqual([12, 21]);
    expect(pilotConfig({ enabled: true, hours: [10, 21] }).hours).toEqual([10, 21]);
  });

  it('a round added: the daytime hour farthest from the others; none past four', () => {
    expect(addPilotHour([9, 13, 21])).toEqual([9, 13, 17, 21]);
    expect(addPilotHour([12, 21])).toEqual([8, 12, 21]);
    expect(addPilotHour([9, 13, 17, 21])).toBeNull();
  });

  it('a late round (Chrome closed at its hour): run within 3 h, unless the next round is less than an hour away', () => {
    expect(runLateRound(at(16, 9), at(16, 9, 0) + 20_000, at(16, 13))).toBe(true);
    expect(runLateRound(at(16, 9), at(16, 10, 30), at(16, 13))).toBe(true);
    expect(runLateRound(at(16, 9), at(16, 12, 30), at(16, 13))).toBe(false);
    expect(runLateRound(at(16, 13), at(16, 16, 30), at(16, 21))).toBe(false);
  });

  it('the notice: what was done, then what only the seller can do', () => {
    const n = pilotNotice({ ...round, offers: 2, delivered: 1, backup: true, toShip: 3, toCollect: 1 });
    expect(n.title).toBe('Tournée de 12 h faite');
    expect(n.lines).toEqual(['Stock lu : 18 annonces, 3 ventes', 'Fait : 2 offres traitées · 1 message colis livré · sauvegarde faite', 'Pour vous : 3 colis à envoyer (bordereaux dans Ventes) · 1 colis à retirer']);
    expect(pilotNotice(round).lines.slice(1)).toEqual(['Fait : rien à traiter', 'Pour vous : rien d’urgent']);
    expect(pilotNotice({ ...round, priceCuts: 2, toList: 1 }).lines[2]).toBe('Pour vous : 2 baisses de prix prévues (Stock → « Baisse à faire », un clic chacune) · 1 article à mettre en ligne (Atelier)');
    expect(pilotNotice({ ...round, labels: 2, labelsNotSaved: 1, toShip: 3 }).lines.slice(1)).toEqual([
      'Fait : 2 bordereaux enregistrés (Téléchargements/ERA-bordereaux)',
      'Pour vous : 1 bordereau à télécharger depuis Ventes · 3 colis à envoyer (bordereaux dans Ventes)',
    ]);
    const stopped = pilotNotice({ ...round, imported: null, stopped: 'NOT_LOGGED_IN · session expirée' });
    expect(stopped.title).toBe('Tournée de 12 h arrêtée');
    expect(stopped.lines[0]).toBe('Arrêt : NOT_LOGGED_IN · session expirée');
  });
});
