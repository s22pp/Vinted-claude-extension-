import { describe, expect, it } from 'vitest';
import { boxInitials, parcelBoard } from '@/intelligence/parcel-board';
import type { Parcel } from '@/intelligence/parcels';

const p = (q: Partial<Parcel>): Parcel => ({ key: 'k', direction: 'OUT', refId: 'r', title: 'Veste', status: null, stage: 'TO_SHIP', days: 1, sinceStatus: true, late: false, conversationId: null, ...q });

describe('the parcels’ conveyor: every box at its station', () => {
  it('two lanes, five stations; the late first, then the oldest', () => {
    const [out, inn] = parcelBoard([
      p({ key: 'a', stage: 'IN_TRANSIT', days: 2 }),
      p({ key: 'b', stage: 'IN_TRANSIT', days: 6, late: true }),
      p({ key: 'c', stage: 'IN_TRANSIT', days: 4 }),
      p({ key: 'd', stage: 'TO_SHIP' }),
      p({ key: 'e', direction: 'IN', stage: 'AT_PICKUP', late: true }),
      p({ key: 'f', stage: 'DONE' as Parcel['stage'] }),
    ]);
    expect(out!.stations.map((s) => s.stage)).toEqual(['TO_SHIP', 'SENT', 'IN_TRANSIT', 'AT_PICKUP', 'DELIVERED']);
    expect(out!.stations[2]!.parcels.map((x) => x.key)).toEqual(['b', 'c', 'a']);
    expect([out!.count, out!.late, inn!.count, inn!.late]).toEqual([4, 1, 1, 1]);
  });

  it('a box’s short name from the article’s first words', () => {
    expect(boxInitials('Veste Barbour M')).toBe('VB');
    expect(boxInitials('Jean Levi’s 501 W32')).toBe('JL');
    expect(boxInitials('—')).toBe('?');
  });
});
