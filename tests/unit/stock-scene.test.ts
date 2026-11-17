import { describe, expect, it } from 'vitest';
import { RADIUS, type SceneSource, inFilter, layoutArena, nextAction, sceneItems, sceneState } from '@/intelligence/stock-scene';

const NOW = Date.UTC(2026, 10, 17);
const src = (p: Partial<SceneSource>): SceneSource => ({ itemId: 'i', title: 'Veste', category: 'JACKETS', status: 'LISTED', inStock: true, priceCents: 4000, views: 10, favourites: 0, daysListed: 5, photoUrl: null, needsShip: false, soldAt: null, cut: null, ...p });

describe('the stock as a stadium: every seat knows who it is', () => {
  it('one state per article, the most urgent first', () => {
    expect(sceneState(src({ needsShip: true, inStock: false, status: 'SOLD' }), 30)).toBe('TO_SHIP');
    expect(sceneState(src({ cut: { from: 4000, to: 3600 }, daysListed: 40 }), 30)).toBe('CUT_DUE');
    expect(sceneState(src({ daysListed: 40 }), 30)).toBe('STALE');
    expect(sceneState(src({}), 30)).toBe('LIVE');
    expect(sceneState(src({ status: 'RESERVED' }), 30)).toBe('RESERVED');
    expect(sceneState(src({ status: 'DRAFT' }), 30)).toBeNull();
    expect(sceneState(src({ inStock: false, status: 'SOLD' }), 30)).toBe('SOLD');
  });

  it('in the stadium: listed stock, and what sold in the last 30 days', () => {
    const items = sceneItems([src({ itemId: 'a' }), src({ itemId: 'b', inStock: false, status: 'SOLD', soldAt: NOW - 3 * 86_400_000 }), src({ itemId: 'c', inStock: false, status: 'SOLD', soldAt: NOW - 60 * 86_400_000 }), src({ itemId: 'd', status: 'DRAFT' })], 30, NOW);
    expect(items.map((i) => [i.itemId, i.state])).toEqual([
      ['a', 'LIVE'],
      ['b', 'SOLD'],
    ]);
  });

  it('stands are categories, the biggest first; what needs action sits in front; every seat numbered', () => {
    const items = sceneItems(
      [src({ itemId: 'a', category: 'TOPS' }), src({ itemId: 'b', category: 'TOPS', needsShip: true }), src({ itemId: 'c', category: 'TOPS', priceCents: null }), src({ itemId: 'd', category: 'JEANS', priceCents: 9000 })],
      30,
      NOW,
    );
    const { placed, stands } = layoutArena(items);
    expect(stands.map((s) => [s.category, s.count])).toEqual([
      ['TOPS', 3],
      ['JEANS', 1],
    ]);
    const b = placed.find((p) => p.itemId === 'b')!;
    expect([b.stand, b.row, b.seat]).toEqual([0, 1, 1]);
    // On the bowl, facing the pitch; an unknown price has the middle height and is flagged, never invented.
    expect(Math.hypot(b.x, b.z)).toBeCloseTo(RADIUS, 5);
    const c = placed.find((p) => p.itemId === 'c')!;
    expect(c.unknownPrice).toBe(true);
    expect(c.h).toBe(1);
    // The dearest article stands tallest.
    expect(placed.find((p) => p.itemId === 'd')!.h).toBeGreaterThan(placed.find((p) => p.itemId === 'a')!.h);
    expect(new Set(placed.map((p) => `${p.stand}:${p.row}:${p.seat}`)).size).toBe(placed.length);
  });

  it('filters and the next action: never a repost with favourites', () => {
    const [stale0, stale2] = sceneItems([src({ itemId: 'a', daysListed: 45, favourites: 0 }), src({ itemId: 'b', daysListed: 45, favourites: 2 })], 30, NOW);
    expect(inFilter(stale0!, 'REPOST')).toBe(true);
    expect(inFilter(stale2!, 'REPOST')).toBe(false);
    expect(nextAction(stale0!)).toBe('REPOST');
    expect(nextAction(stale2!)).toBe('WAIT_FAVS');
    expect(layoutArena([]).placed).toEqual([]);
  });
});
