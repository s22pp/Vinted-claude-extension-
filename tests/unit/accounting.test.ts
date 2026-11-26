import { EraDatabase } from '@/data/db';
import { EraRepository } from '@/data/repo';
import type { InventoryItem, Listing, Sale } from '@/domain/entities';
import { DAC7, EXPENSE_PRESETS, accountingCsv, allSalesCsv, archiveRefs, expenseSummary, itemsCsv, presetAmount, purchasesRegister, salesCsv, salesLedger, toCsv, yearSummary } from '@/intelligence/accounting';
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

  it('full exports: every sale (refunds said so, with their reason) and every article, with French labels', () => {
    const { views, sv } = world([
      { id: 'a', soldAt: at(1, 9), cents: 2550 },
      { id: 'b', soldAt: at(0, 3), cents: 4000, status: 'REFUNDED' },
    ]);
    sv.find((x) => x.sale.id === 'sb')!.sale.refundReason = 'SIZE';
    const labels = { category: (c: string) => `cat:${c}`, condition: (c: string) => `cond:${c}`, status: (x: string) => `st:${x}`, refund: (r: string) => `motif:${r}` };
    const sales = allSalesCsv(sv, labels).split('\r\n');
    expect(sales[0]).toContain('Date;Référence;Article');
    expect(sales[1]).toMatch(/;40,00;.*;Remboursée;motif:SIZE$/);
    expect(sales[2]).toMatch(/;25,50;10,00;15,50;Vendue;$/);
    const items = itemsCsv(views, labels).split('\r\n');
    expect(items).toHaveLength(4);
    expect(items[1]).toContain(';cat:SWEATSHIRT;M;cond:VERY_GOOD;st:SOLD;');
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
  it('expenses: summed for the year, by category and month, taken off the margin (unknown stays unknown)', () => {
    const ex = [
      { date: at(0, 10), amountCents: 1250, category: 'PACKAGING' as const },
      { date: at(0, 20), amountCents: 300, category: 'BOOST' as const },
      { date: at(4, 2), amountCents: 2000, category: 'PACKAGING' as const },
      { date: Date.UTC(Y - 1, 11, 1, 12), amountCents: 9999, category: 'TRAVEL' as const },
    ];
    const s = expenseSummary(ex, Y, { status: 'known', value: 10000, count: 3 });
    expect(s.totalCents).toBe(3550);
    expect(s.count).toBe(3);
    expect(s.byCategory).toEqual([
      { category: 'PACKAGING', cents: 3250 },
      { category: 'BOOST', cents: 300 },
    ]);
    expect(s.byMonth[0]).toBe(1550);
    expect(s.byMonth[4]).toBe(2000);
    expect(s.net).toEqual({ status: 'known', value: 6450, count: 3 });
    expect(expenseSummary(ex, Y, { status: 'partial', value: 5000, count: 2, missing: 1 }).net).toEqual({ status: 'partial', value: 1450, count: 2, missing: 1 });
    expect(expenseSummary(ex, Y, { status: 'unknown', missing: 2 }).net).toEqual({ status: 'unknown', missing: 2 });
  });
});

describe('the accountant’s CSV and the 1-click expenses', () => {
  const lines = (csv: string) => csv.replace(/^\uFEFF/, '').trimEnd().split('\r\n').map((l) => l.split(';'));

  it('archive numbers: every completed sale from the first one ever, refunds left out, stable over the years', () => {
    const { sv } = world([
      { id: 'b', soldAt: at(3, 2), cents: 4000 },
      { id: 'old', soldAt: Date.UTC(Y - 1, 5, 1), cents: 1500 },
      { id: 'r', soldAt: at(2, 1), cents: 9900, status: 'REFUNDED' },
      { id: 'a', soldAt: at(1, 9), cents: 2500 },
    ]);
    expect([...archiveRefs(sv)]).toEqual([['sold', '#001'], ['sa', '#002'], ['sb', '#003']]);
  });

  it('one line per sale (cost, fees, price, net profit, running total, DAC7), the expenses, then the totals; UTF-8 BOM', () => {
    const { sv } = world([
      { id: 'a', soldAt: at(1, 9), cents: 2500, item: { purchasePriceCents: 1225, costDetail: { itemCents: 1000, protectionCents: 125, shippingCents: 100 } } },
      { id: 'b', soldAt: at(3, 2), cents: 4000, item: { purchasePriceCents: null } },
    ]);
    const csv = accountingCsv(sv, Y, [{ date: at(2, 3), amountCents: 450, category: 'PACKAGING', note: 'Lot de cartons' }], (c) => (c === 'PACKAGING' ? 'Emballage' : c));
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const [head, a, b, ex, total] = lines(csv);
    expect(head).toEqual(['Date', 'Référence Archive', 'Article', 'Marque', 'Coût d’achat (€)', 'Frais annexes (€)', 'Prix de vente (€)', 'Profit net (€)', 'Cumul annuel (€)', 'Seuil DAC7 (30 ventes ou 2000 €)']);
    expect(a).toEqual([`${Y}-02-09`, '#001', 'Article a', 'Nike', '10,00', '2,25', '25,00', '12,75', '25,00', '1/30 ventes · 25/2000 €']);
    // A cost unknown: its cells empty, never 0.
    expect(b).toEqual([`${Y}-04-02`, '#002', 'Article b', 'Nike', '', '', '40,00', '', '65,00', '2/30 ventes · 65/2000 €']);
    expect(ex).toEqual([`${Y}-03-03`, 'Dépense', 'Emballage · Lot de cartons', '', '', '4,50', '', '-4,50', '65,00', '']);
    expect(total).toEqual([`Total ${Y}`, '', '2 ventes · 1 dépenses', '', '10,00', '6,75', '65,00', '8,25 (partiel : coûts inconnus)', '65,00', 'sous le seuil DAC7']);
  });

  it('the DAC7 column says when the threshold is reached in the year', () => {
    const { sv } = world(Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, soldAt: at(5, 1 + (i % 27)), cents: 500 })));
    const rows = lines(accountingCsv(sv, Y, [], (c) => c));
    expect(rows[29]![9]).toBe('29/30 ventes · 145/2000 €');
    expect(rows[30]![9]).toBe('atteint (30 ventes · 150 €)');
    expect(rows.at(-1)![9]).toBe('seuil DAC7 atteint');
  });

  it('1-click expenses: the last amount the seller entered for it comes back; the first time, none is made up', () => {
    const boxes = EXPENSE_PRESETS.find((p) => p.key === 'BOXES')!;
    expect(presetAmount([], boxes)).toBeNull();
    expect(presetAmount([{ date: 1, amountCents: 900, note: 'Lot de cartons' }, { date: 5, amountCents: 1200, note: 'Lot de cartons' }, { date: 9, amountCents: 300, note: 'Scotch' }], boxes)).toBe(1200);
    expect(EXPENSE_PRESETS.map((p) => p.category)).toEqual(['PACKAGING', 'PACKAGING', 'TRAVEL', 'CLEANING', 'BOOST']);
  });
});

