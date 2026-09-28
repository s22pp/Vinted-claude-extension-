import { describe, expect, it } from 'vitest';
import { exportBackup, parseBackup, restoreBackup } from '@/data/backup';
import { backupDue, backupFileName, jsonDataUrl } from '@/data/auto-backup';
import { EraDatabase } from '@/data/db';
import { EraRepository } from '@/data/repo';

describe('backup', () => {
  it('a full copy, restored identically into an empty browser; anything else is refused', async () => {
    const a = new EraDatabase(`t-${Math.random()}`);
    const repo = new EraRepository(a);
    const id = await repo.addItem({ title: 'Veste Carhartt M', brand: 'Carhartt', model: null, category: 'JACKET', gender: null, size: 'M', condition: 'GOOD', purchasePriceCents: 2000, purchaseDate: null, purchaseSource: null, priceCents: 6000, listedAt: null, views: 3, favorites: 1, url: null });
    await repo.recordSale(id, 5500);
    await repo.setSetting('automations', { enabled: true });
    await a.expenses.put({ id: 'e1', date: 1000, amountCents: 1250, category: 'PACKAGING', note: 'cartons' });
    const b = await exportBackup(a, '0.21.0', 1000);
    const text = JSON.stringify(b);

    const fresh = new EraDatabase(`t-${Math.random()}`);
    const parsed = parseBackup(text);
    expect(parsed.ok).toBe(true);
    await restoreBackup(fresh, (parsed as { backup: typeof b }).backup);
    expect(await fresh.items.count()).toBe(1);
    expect((await fresh.sales.toArray())[0]!.salePriceCents).toBe(5500);
    expect((await fresh.settings.get('automations'))?.value).toEqual({ enabled: true });
    expect((await fresh.expenses.get('e1'))?.amountCents).toBe(1250);

    expect(parseBackup('pas du json')).toEqual({ ok: false, reason: 'NOT_JSON' });
    expect(parseBackup('{"a":1}')).toEqual({ ok: false, reason: 'NOT_ERA' });
    expect(parseBackup(JSON.stringify({ ...b, version: 99 }))).toEqual({ ok: false, reason: 'NEWER' });
  });
});

describe('automatic backup', () => {
  it('due when none was saved or the period has passed (an hour of slack); a dated file; a data URL that decodes back', () => {
    const day = 86_400_000;
    expect(backupDue(null, 7, 0)).toBe(true);
    expect(backupDue(0, 7, 6 * day)).toBe(false);
    expect(backupDue(0, 7, 7 * day - 1_800_000)).toBe(true);
    expect(backupDue(0, 1, day)).toBe(true);
    expect(backupFileName(Date.UTC(2026, 8, 28, 12))).toBe('ERA-sauvegardes/era-sauvegarde-2026-09-28.json');
    const text = JSON.stringify({ note: 'Veste « Harrington » — 59 €' });
    const url = jsonDataUrl(text);
    expect(url.startsWith('data:application/json;base64,')).toBe(true);
    const bin = atob(url.split(',')[1]!);
    expect(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))).toBe(text);
  });
});
