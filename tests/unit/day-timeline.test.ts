import { describe, expect, it } from 'vitest';
import { type JournalLike, dayTimeline, untilText } from '@/intelligence/day-timeline';

const at = (h: number, m = 0) => new Date(2026, 10, 17, h, m).getTime();
const row = (p: Partial<JournalLike>): JournalLike => ({ at: at(9, 5), kind: 'RUN', ok: true, dryRun: false, target: 'Pilote automatique', detail: '', ...p });

describe('the day of ERA: rounds and actions on one line', () => {
  it('a round is done only when the journal says so; the next one waits, a long-gone one is missed', () => {
    const { rounds, nowX } = dayTimeline([row({ detail: 'Tournée de 9 h faite · Stock à jour : 18 annonces · Fait pour vous : 2 offres traitées' })], [9, 13, 21], at(14, 0));
    expect(rounds.map((r) => [r.hour, r.status])).toEqual([
      [9, 'DONE'],
      [13, 'LATE'],
      [21, 'NEXT'],
    ]);
    expect(rounds[0]!.lines).toEqual(['Stock à jour : 18 annonces', 'Fait pour vous : 2 offres traitées']);
    expect(nowX).toBeCloseTo(14 / 24, 5);
    expect(dayTimeline([], [9, 13, 21], at(18, 0)).rounds.map((r) => r.status)).toEqual(['MISSED', 'MISSED', 'NEXT']);
  });

  it('an interrupted round is said so; a simulation is never a round nor an action', () => {
    const { rounds, events } = dayTimeline(
      [row({ kind: 'STOP', ok: false, detail: 'Tournée de 9 h interrompue · Vinted vous a déconnecté' }), row({ dryRun: true, detail: 'Simulation de tournée : rien n’a été envoyé' }), row({ kind: 'FAV_MESSAGE', dryRun: true, target: 'Veste' })],
      [9],
      at(10),
    );
    expect(rounds[0]!.status).toBe('STOPPED');
    expect(events).toEqual([]);
  });

  it('every real action today at its time, grouped; yesterday’s left out', () => {
    const { events } = dayTimeline(
      [row({ at: at(9, 6), kind: 'REPLY', target: 'Veste' }), row({ at: at(13, 2), kind: 'PRICE', target: '123' }), row({ at: at(9, 7), kind: 'OFFER_COUNTER', ok: false, target: 'Jean' }), row({ at: at(9, 7) - 86_400_000, kind: 'REPLY' })],
      [9, 13],
      at(15),
    );
    expect(events.map((e) => [e.group, e.ok, e.target])).toEqual([
      ['MESSAGE', true, 'Veste'],
      ['OFFER', false, 'Jean'],
      ['PRICE', true, '123'],
    ]);
    expect(events[2]!.x).toBeCloseTo((13 + 2 / 60) / 24, 5);
  });

  it('the wait until the next round, in words', () => {
    expect(untilText(at(13), at(10, 45))).toBe('dans 2 h 15');
    expect(untilText(at(13), at(12, 48))).toBe('dans 12 min');
    expect(untilText(at(13), at(11))).toBe('dans 2 h');
  });
});
