import { describe, expect, it } from 'vitest';
import { rotateBackups, saleBackupName } from '@/data/auto-backup';

describe('a copy at each new sale, the last 7 kept', () => {
  it('the 7 newest kept, the older ones to delete', () => {
    const list = Array.from({ length: 9 }, (_, i) => ({ id: i + 1, file: `f${i}`, at: 1000 + i }));
    const r = rotateBackups(list);
    expect(r.keep.map((x) => x.id)).toEqual([3, 4, 5, 6, 7, 8, 9]);
    expect(r.drop.map((x) => x.id)).toEqual([1, 2]);
    expect(rotateBackups(list.slice(0, 3)).drop).toEqual([]);
  });

  it('one dated file per copy, in ERA-sauvegardes', () => {
    expect(saleBackupName(new Date(2026, 10, 25, 14, 5).getTime())).toBe('ERA-sauvegardes/era-vente-2026-11-25-14h05.json');
  });
});
