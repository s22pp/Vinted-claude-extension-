import { EraDatabase } from '@/data/db';
import { EraRepository } from '@/data/repo';
import type { InventoryItem, Listing, Sale } from '@/domain/entities';
import { DAY } from '@/domain/time';
import { DAC7, purchasesRegister, salesCsv, salesLedger, toCsv, yearSummary } from '@/intelligence/accounting';
import { buildItemViews, buildSaleViews } from '@/intelligence/portfolio';

const Y = 2026;
const at = (m: number, d: number) => Date.UTC(Y, m, d, 12);
const item = (id: string, over: Partial<InventoryItem> = {}): InventoryItem => ({
  id,
  title: `Article ${id}`,
  brand: 'Nike',
  model: null,
  category: 'SWEATSHIRT',
  gender: null,
  size: 'M',
  condition: 'VERY_GOOD',
  material: null,
  era: null,
  photoUrl: null,
  purchasePriceCents: 1000,
  costDetail: null,
  purchaseDate: at(0, 5),
  purchaseSource: 'Vinted',
  status: 'SOLD',
  createdAt: 0,
  updatedAt: 0,
  meta: {},
  isDemo: false,
  ...over,
});
const listing = (id: string, itemId: string): Listing => ({
  id,
  inventoryItemId: itemId,
  platform: 'vinted',
  platformListingId: null,
  url: null,
  title: 't',
  priceCents: 3000,
  views: 1,
  favorites: 0,
  listedAt: at(0, 6),
  removedAt: null,
  soldAt: null,
  status: 'SOLD',
  lastObservedAt: 0,
  isDemo: false,
});
const sale = (id: string, soldAt: number, cents: number, status: Sale['status'] = 'COMPLETED'): Sale => ({ id: `s${id}`, inventoryItemId: id, listingId: `l${id}`, soldAt, salePriceCents: cents, extraCostsCents: 0, status, isDemo: false });

function world(rows: { id: string; soldAt: number; cents: number; status?: Sale['status']; item?: Partial<InventoryItem> }[]) {
  const items = rows.map((r) => item(r.id, r.item));
  const sales = rows.map((r) => sale(r.id, r.soldAt, r.cents, r.status));
  const views = buildItemViews(items, rows.map((r) => listing(`l${r.id}`, r.id)), sales, Date.UTC(Y, 11, 31));
  return { views, sv: buildSaleViews(views, sales) };
}

describe('accounting', () => {
  it('sales ledger: cash received in the year, oldest first, refunds excluded', () => {
    const { sv } = world([
      { id: 'b', soldAt: at(3, 2), cents: 4000 },
      { id: 'a', soldAt: at(1, 9), cents: 2500 },
      { id: 'r', soldAt: at(2, 1), cents: 9900, status: 'REFUNDED' },
      { id: 'old', soldAt: Date.UTC(Y - 1, 11, 30), cents: 1500 },
    ]);
    const l = salesLedger(sv, Y, new Map([['sa', `${Y}-0001`]]));
    expect(l.map((x) => x.itemId)).toEqual(['a', 'b']);
    expect(l[0]).toMatchObject({ amountCents: 2500, costCents: 1000, profitCents: 1500, invoice: `${Y}-0001` });
  });

  it('DAC7: reported from 30 sales or more than 2 000 € in the calendar year', () => {
    const under = world(Array.from({ length: 29 }, (_, i) => ({ id: `u${i}`, soldAt: at(4, 1 + (i % 27)), cents: 6800 })));
    const s1 = yearSummary(under.sv, under.views, Y);
    expect(s1.sales).toBe(29);
    expect(s1.revenueCents).toBe(29 * 6800); // 1 972 €
    expect(s1.dac7.reportable).toBe(false);

    const thirty = world(Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, soldAt: at(5, 1 + (i % 27)), cents: 500 })));
    expect(yearSummary(thirty.sv, thirty.views, Y).dac7.reportable).toBe(true);

    const exact = world([{ id: 'x', soldAt: at(6, 1), cents: DAC7.revenueCents }]);
    expect(yearSummary(exact.sv, exact.views, Y).dac7.reportable).toBe(false); // not "more than" 2 000 €
    const above = world([{ id: 'y', soldAt: at(6, 1), cents: DAC7.revenueCents + 100 }]);
    expect(yearSummary(above.sv, above.views, Y).dac7.reportable).toBe(true);
  });

  it('purchases register: split costs, undated purchases counted apart, never guessed', () => {
    const { views } = world([
      { id: 'p', soldAt: at(3, 1), cents: 3000, item: { purchasePriceCents: 2170, costDetail: { itemCents: 2000, protectionCents: 170, shippingCents: null } } },
      { id: 'n', soldAt: at(3, 1), cents: 3000, item: { purchaseDate: null } },
    ]);
    const r = purchasesRegister(views, Y);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ itemCents: 2000, protectionCents: 170, shippingCents: null, totalCents: 2170, complete: false });
    expect(r.undated).toBe(1);
  });

  it('CSV for French spreadsheets: BOM, « ; », decimal comma, quoted text', () => {
    const csv = toCsv(['A', 'B'], [['Veste "Harrington"; M', 12.5]]);
    expect(csv.startsWith('﻿A;B\r\n')).toBe(true);
    expect(csv).toContain('"Veste ""Harrington""; M";12.5');
    const { sv } = world([{ id: 'a', soldAt: at(1, 9), cents: 2550 }]);
    expect(salesCsv(salesLedger(sv, Y))).toContain(';25,50;10,00;15,50;Vinted');
  });

  it('invoice numbers are sequential per year and never reused', async () => {
    const db = new EraDatabase(`t-${Math.random()}`);
    const repo = new EraRepository(db);
    await db.sales.bulkPut([sale('a', at(1, 1), 1000), sale('b', at(2, 1), 1000), sale('c', Date.UTC(Y + 1, 0, 3), 1000)]);
    expect((await repo.issueInvoice('sb')).number).toBe(`${Y}-0001`);
    expect((await repo.issueInvoice('sa')).number).toBe(`${Y}-0002`);
    expect((await repo.issueInvoice('sb')).number).toBe(`${Y}-0001`); // same sale → same invoice
    expect((await repo.issueInvoice('sc')).number).toBe(`${Y + 1}-0001`);
  });
});
