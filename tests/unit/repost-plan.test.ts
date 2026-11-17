import { describe, expect, it } from 'vitest';
import { type RepostCandidate, repostQueue } from '@/intelligence/repost-plan';

const c = (p: Partial<RepostCandidate>): RepostCandidate => ({ itemId: 'i', title: 'Veste', status: 'LISTED', live: true, listedAtKnown: true, daysListed: 40, favourites: 0, pending: false, ...p });

describe('which listing the autopilot reposts', () => {
  it('online 30 days or more, no favourite at all, live, its date known; the oldest first', () => {
    const q = repostQueue([
      c({ itemId: 'a', daysListed: 35 }),
      c({ itemId: 'b', daysListed: 80 }),
      c({ itemId: 'c', favourites: 1 }),
      c({ itemId: 'd', favourites: null }),
      c({ itemId: 'e', daysListed: 20 }),
      c({ itemId: 'f', status: 'RESERVED' }),
      c({ itemId: 'g', live: false }),
      c({ itemId: 'h', listedAtKnown: false }),
      c({ itemId: 'i', pending: true }),
    ]);
    expect(q.map((x) => x.itemId)).toEqual(['b', 'a']);
  });
});
