import { describe, expect, it } from 'vitest';
import { exportBackup, parseBackup, restoreBackup } from '@/data/backup';
import { EraDatabase } from '@/data/db';
import { EraRepository } from '@/data/repo';

describe('backup', () => {
  it('a full copy, restored identically into an empty browser; anything else is refused', async () => {
    const a = new EraDatabase(`t-${Math.random()}`);
    const repo = new EraRepository(a);
    const id = await repo.addItem({ title: 'Veste Carhartt M', brand: 'Carhartt', model: null, category: 'JACKET', gender: null, size: 'M', condition: 'GOOD', purchasePriceCents: 2000, purchaseDate: null, purchaseSource: null, priceCents: 6000, listedAt: null, views: 3, favorites: 1, url: null });
    await repo.recordSale(id, 5500);
    await repo.setSetting('automations', { enabled: true });
    const b = await exportBackup(a, '0.21.0', 1000);
    const text = JSON.stringify(b);

    const fresh = new EraDatabase(`t-${Math.random()}`);
    const parsed = parseBackup(text);
    expect(parsed.ok).toBe(true);
    await restoreBackup(fresh, (parsed as { backup: typeof b }).backup);
    expect(await fresh.items.count()).toBe(1);
    expect((await fresh.sales.toArray())[0]!.salePriceCents).toBe(5500);
    expect((await fresh.settings.get('automations'))?.value).toEqual({ enabled: true });

    expect(parseBackup('pas du json')).toEqual({ ok: false, reason: 'NOT_JSON' });
    expect(parseBackup('{"a":1}')).toEqual({ ok: false, reason: 'NOT_ERA' });
    expect(parseBackup(JSON.stringify({ ...b, version: 99 }))).toEqual({ ok: false, reason: 'NEWER' });
  });
});
