import { describe, expect, it } from 'vitest';
import { whatIsNew } from '@/data/refresh';

describe('what an import brought', () => {
  it('only NEW orders to ship and new sales, never the ones already known', () => {
    const before = { toShip: new Map([['s1', 'Pull Lacoste M']]), sales: new Set(['s1', 's0']) };
    const after = { toShip: new Map([['s1', 'Pull Lacoste M'], ['s2', 'Sweat Nike L']]), sales: new Set(['s0', 's1', 's2', 's3']) };
    expect(whatIsNew(before, after)).toEqual({ toShip: ['Sweat Nike L'], sold: 2 });
    expect(whatIsNew(after, after)).toEqual({ toShip: [], sold: 0 });
  });
});
