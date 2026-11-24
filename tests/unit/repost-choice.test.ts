import { describe, expect, it } from 'vitest';
import { type ChosenFacts, addChosen, lossOf, planChosen, removeChosen } from '@/intelligence/repost-choice';

const f = (p: Partial<ChosenFacts>): ChosenFacts => ({ itemId: 'a', title: 'Veste', status: 'LISTED', live: true, favourites: 0, views: 10, pending: false, ...p });

describe('the seller’s own « À republier » list', () => {
  it('any article the seller picks goes on it, with the favourites they accept to lose; picked again, the numbers update', () => {
    let list = addChosen([], [{ itemId: 'a', favourites: 9, views: 57 }, { itemId: 'b', favourites: null, views: null }], 100);
    expect(list).toEqual([
      { itemId: 'a', acceptFavourites: 9, views: 57, addedAt: 100 },
      { itemId: 'b', acceptFavourites: 0, views: null, addedAt: 100 },
    ]);
    list = addChosen(list, [{ itemId: 'a', favourites: 11, views: 60 }], 200);
    expect(list.find((c) => c.itemId === 'a')).toEqual({ itemId: 'a', acceptFavourites: 11, views: 60, addedAt: 100 });
    expect(removeChosen(list, 'a').map((c) => c.itemId)).toEqual(['b']);
  });

  it('says what a repost loses before the seller confirms', () => {
    expect(lossOf([f({ favourites: 9, views: 57 }), f({ favourites: 0, views: 12 }), f({ favourites: null, views: null })])).toEqual({ withFavourites: 1, favourites: 9, views: 69, unknown: 1 });
  });

  it('the round takes the first in the seller’s order — favourites accepted included', () => {
    const list = addChosen(addChosen([], [{ itemId: 'a', favourites: 9, views: 57 }], 1), [{ itemId: 'b', favourites: 0, views: 3 }], 2);
    const plan = planChosen(list, [f({ itemId: 'a', favourites: 9 }), f({ itemId: 'b' })]);
    expect(plan.pick).toMatchObject({ itemId: 'a', acceptFavourites: 9, title: 'Veste' });
    expect(plan.blocked).toEqual([]);
  });

  it('more favourites than accepted: kept, not reposted, said — the seller confirms again', () => {
    const list = addChosen([], [{ itemId: 'a', favourites: 2, views: 5 }, { itemId: 'b', favourites: 0, views: 1 }], 1);
    const plan = planChosen(list, [f({ itemId: 'a', favourites: 4 }), f({ itemId: 'b', title: 'Jean' })]);
    expect(plan.blocked).toEqual([{ itemId: 'a', title: 'Veste', why: 'MORE_FAVOURITES', favourites: 4 }]);
    expect(plan.pick?.itemId).toBe('b');
  });

  it('sold or gone: off the list; reserved or hidden: waits; a copy already waiting, or the article whose price was just cut: skipped', () => {
    const list = addChosen([], ['a', 'b', 'c', 'd', 'e'].map((itemId) => ({ itemId, favourites: 0, views: 0 })), 1);
    const plan = planChosen(list, [f({ itemId: 'a', status: 'SOLD' }), f({ itemId: 'b', status: 'RESERVED' }), f({ itemId: 'c', pending: true }), f({ itemId: 'd' }), f({ itemId: 'e', title: 'Pull' })], new Set(['d']));
    expect(plan.drop).toEqual(['a']);
    expect(plan.blocked).toEqual([{ itemId: 'b', title: 'Veste', why: 'NOT_LIVE' }]);
    expect(plan.pick?.itemId).toBe('e');
    expect(planChosen(list, []).drop).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});
