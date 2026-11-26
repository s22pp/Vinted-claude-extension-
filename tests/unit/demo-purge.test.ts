import { describe, expect, it } from 'vitest';
import { exportBackup } from '@/data/backup';
import { EraDatabase } from '@/data/db';
import { EraRepository } from '@/data/repo';
import { STORAGE_MAX, cleanStorage, validItem } from '@/domain/entities';

const real = { title: 'Veste Carhartt M', brand: 'Carhartt', model: null, category: 'JACKET' as const, gender: null, size: 'M', condition: 'GOOD' as const, purchasePriceCents: 2000, purchaseDate: null, purchaseSource: null, priceCents: 6000, listedAt: null, views: 3, favorites: 1, url: null };

/** A demo article and its sale, as the demo writes them (marked isDemo). */
async function withDemo(db: EraDatabase, repo: EraRepository) {
  const id = await repo.addItem({ ...real, title: 'Veste Harrington (démo)' });
  const it = (await db.items.get(id))!;
  await db.items.put({ ...it, isDemo: true });
  for (const l of await db.listings.where('inventoryItemId').equals(id).toArray()) await db.listings.put({ ...l, isDemo: true });
  await repo.recordSale(id, 4500);
  for (const s of await db.sales.where('inventoryItemId').equals(id).toArray()) await db.sales.put({ ...s, isDemo: true });
  await repo.savePrep(id, { defects: 'aucun' });
  return id;
}

describe('demo → real account: never mixed', () => {
  it('every demo record goes, with what was made from it (lots, Radar scans of the demo market); the seller’s own stay', async () => {
    const db = new EraDatabase(`t-${Math.random()}`);
    const repo = new EraRepository(db);
    const mine = await repo.addItem(real);
    const demo = await withDemo(db, repo);
    await repo.setSetting('dataMode', 'demo');
    await repo.setSetting('saleLots', [{ id: 'l1', itemIds: [demo, mine] }, { id: 'l2', itemIds: [mine] }]);
    await repo.setSetting('radarLast', { a: { demo: true, deals: [] }, b: { deals: [] } });
    expect(await repo.demoCount()).toBe(2);

    await repo.clearDemo();
    expect(await repo.demoCount()).toBe(0);
    expect((await db.items.toArray()).map((i) => i.id)).toEqual([mine]);
    expect(await db.sales.filter((s) => s.inventoryItemId === demo).count()).toBe(0);
    expect(await db.listings.filter((l) => l.inventoryItemId === demo).count()).toBe(0);
    expect(await db.preps.get(demo)).toBeUndefined();
    expect(await repo.getSetting('saleLots', [])).toEqual([{ id: 'l2', itemIds: [mine] }]);
    expect(await repo.getSetting('radarLast', {})).toEqual({ b: { deals: [] } });
    expect(await repo.getSetting('dataMode', 'empty')).toBe('real');
  });

  it('the automatic backups never hold a demo record', async () => {
    const db = new EraDatabase(`t-${Math.random()}`);
    const repo = new EraRepository(db);
    await repo.addItem(real);
    await withDemo(db, repo);
    const all = await exportBackup(db, '2.1.0', 1);
    const realOnly = await exportBackup(db, '2.1.0', 1, { realOnly: true });
    expect(all.counts.items).toBe(2);
    expect(realOnly.counts.items).toBe(1);
    expect(realOnly.counts.sales).toBe(0);
    expect(JSON.stringify(realOnly.tables)).not.toContain('"isDemo":true');
  });
});

describe('storage place (« Bac A »)', () => {
  it('typed with the article, tidied; changed or removed in place; never longer than 40 characters', async () => {
    const db = new EraDatabase(`t-${Math.random()}`);
    const repo = new EraRepository(db);
    const id = await repo.addItem({ ...real, storageLocation: '  Bac   A ' });
    expect((await db.items.get(id))!.storageLocation).toBe('Bac A');
    await repo.setStorageLocation(id, 'Penderie 2');
    expect((await db.items.get(id))!.storageLocation).toBe('Penderie 2');
    await repo.setStorageLocation(id, '   ');
    expect((await db.items.get(id))!.storageLocation).toBeNull();
    // An article without one (every article of earlier versions) stays valid.
    const plain = await repo.addItem(real);
    expect((await db.items.get(plain))!.storageLocation).toBeUndefined();
    expect(cleanStorage('x'.repeat(60))).toHaveLength(STORAGE_MAX);
    const stored = (await db.items.get(plain))!;
    expect(() => validItem({ ...stored, storageLocation: 'x'.repeat(41) })).toThrow('emplacement invalide');
  });
});
