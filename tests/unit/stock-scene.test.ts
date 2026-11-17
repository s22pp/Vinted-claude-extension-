import { describe, expect, it } from 'vitest';
import { GARMENT_Y, RACK_MAX, type SceneSource, inFilter, layoutRacks, nextAction, sceneItems, sceneState } from '@/intelligence/stock-scene';

const NOW = Date.UTC(2026, 10, 17);
const src = (p: Partial<SceneSource>): SceneSource => ({ itemId: 'i', title: 'Veste', category: 'JACKETS', status: 'LISTED', inStock: true, priceCents: 4000, views: 10, favourites: 0, daysListed: 5, photoUrl: null, needsShip: false, soldAt: null, cut: null, ...p });

describe('the stock as a shop: every garment knows who it is', () => {
  it('one state per article, the most urgent first', () => {
    expect(sceneState(src({ needsShip: true, inStock: false, status: 'SOLD' }), 30)).toBe('TO_SHIP');
    expect(sceneState(src({ cut: { from: 4000, to: 3600 }, daysListed: 40 }), 30)).toBe('CUT_DUE');
    expect(sceneState(src({ daysListed: 40 }), 30)).toBe('STALE');
    expect(sceneState(src({}), 30)).toBe('LIVE');
    expect(sceneState(src({ status: 'RESERVED' }), 30)).toBe('RESERVED');
    expect(sceneState(src({ status: 'DRAFT' }), 30)).toBeNull();
    expect(sceneState(src({ inStock: false, status: 'SOLD' }), 30)).toBe('SOLD');
  });

  it('in the shop: listed stock, and what sold in the last 30 days', () => {
    const items = sceneItems([src({ itemId: 'a' }), src({ itemId: 'b', inStock: false, status: 'SOLD', soldAt: NOW - 3 * 86_400_000 }), src({ itemId: 'c', inStock: false, status: 'SOLD', soldAt: NOW - 60 * 86_400_000 }), src({ itemId: 'd', status: 'DRAFT' })], 30, NOW);
    expect(items.map((i) => [i.itemId, i.state])).toEqual([
      ['a', 'LIVE'],
      ['b', 'SOLD'],
    ]);
  });

  it('the shop: a rack per category (the biggest first), the urgent first on the rail, then « À envoyer » and « Vendus »', () => {
    const items = sceneItems(
      [
        src({ itemId: 'a', category: 'TOPS', title: 'B' }),
        src({ itemId: 'b', category: 'TOPS', title: 'A', cut: { from: 4000, to: 3600 } }),
        src({ itemId: 'c', category: 'TOPS', title: 'C' }),
        src({ itemId: 'd', category: 'JEANS' }),
        src({ itemId: 'e', needsShip: true, inStock: false, status: 'SOLD' }),
        src({ itemId: 'f', inStock: false, status: 'SOLD', soldAt: NOW - 86_400_000 }),
      ],
      30,
      NOW,
    );
    const { hung, racks } = layoutRacks(items);
    expect(racks.map((r) => [r.kind, r.category, r.count])).toEqual([
      ['CATEGORY', 'TOPS', 3],
      ['CATEGORY', 'JEANS', 1],
      ['TO_SHIP', null, 1],
      ['SOLD', null, 1],
    ]);
    // The cut due hangs first on its rail; every garment keeps its rack and place, at hanger height, on its rack's rail.
    expect(hung.filter((h) => h.rack === 0).map((h) => [h.itemId, h.slot])).toEqual([
      ['b', 1],
      ['a', 2],
      ['c', 3],
    ]);
    for (const h of hung) {
      const r = racks[h.rack]!;
      expect(h.y).toBe(GARMENT_Y);
      expect(h.x).toBeGreaterThan(r.x0);
      expect(h.x).toBeLessThan(r.x1);
      expect(h.z).toBe(r.z);
    }
    // Three racks a row, the fourth behind.
    expect(racks[3]!.z).toBeLessThan(racks[0]!.z);
  });

  it('a big category takes several racks, never more than RACK_MAX garments each', () => {
    const many = sceneItems(Array.from({ length: RACK_MAX * 2 + 3 }, (_, i) => src({ itemId: `t${i}`, title: `T${String(i).padStart(2, '0')}` })), 30, NOW);
    const { racks } = layoutRacks(many);
    expect(racks.map((r) => [r.part, r.count])).toEqual([
      [1, RACK_MAX],
      [2, RACK_MAX],
      [3, 3],
    ]);
    expect(layoutRacks([]).hung).toEqual([]);
  });

  it('filters and the next action: never a repost with favourites', () => {
    const [stale0, stale2] = sceneItems([src({ itemId: 'a', daysListed: 45, favourites: 0 }), src({ itemId: 'b', daysListed: 45, favourites: 2 })], 30, NOW);
    expect(inFilter(stale0!, 'REPOST')).toBe(true);
    expect(inFilter(stale2!, 'REPOST')).toBe(false);
    expect(nextAction(stale0!)).toBe('REPOST');
    expect(nextAction(stale2!)).toBe('WAIT_FAVS');
  });
});
