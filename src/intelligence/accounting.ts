import { type MoneyMetric, sumMetric, eurNumber } from '@/domain/money';
import { skuOf } from './listing';
import type { ItemView, SaleView } from './portfolio';

/**
 * Bookkeeping for a Vinted reseller: a sales ledger (cash actually received), a purchases register
 * (what was paid, split item / buyer protection / shipping), yearly totals and the DAC7 threshold.
 * Written from scratch for ERA; figures only come from the seller's own data. Not tax advice.
 */

/** DAC7 (EU directive 2021/514): a platform reports a seller unless < 30 sales AND ≤ 2 000 € in the year. */
export const DAC7 = { sales: 30, revenueCents: 200_000 } as const;

export function yearOf(ts: number): number {
  return new Date(ts).getFullYear();
}

export interface LedgerSale {
  saleId: string;
  itemId: string;
  date: number;
  title: string;
  brand: string;
  ref: string;
  amountCents: number;
  costCents: number | null;
  profitCents: number | null;
  invoice: string | null;
}

/** Livre des recettes: completed sales of the year, oldest first. Refunded sales are money given back: excluded. */
export function salesLedger(sales: readonly SaleView[], year: number, invoices: ReadonlyMap<string, string> = new Map()): LedgerSale[] {
  return sales
    .filter((s) => s.sale.status !== 'REFUNDED' && yearOf(s.sale.soldAt) === year)
    .sort((a, b) => a.sale.soldAt - b.sale.soldAt)
    .map((s) => ({
      saleId: s.sale.id,
      itemId: s.item.id,
      date: s.sale.soldAt,
      title: s.item.title,
      brand: s.item.brand,
      ref: skuOf(s.item.id),
      amountCents: s.sale.salePriceCents,
      costCents: s.cost,
      profitCents: s.profit,
      invoice: invoices.get(s.sale.id) ?? null,
    }));
}

export interface LedgerPurchase {
  itemId: string;
  date: number | null;
  title: string;
  source: string | null;
  itemCents: number | null;
  protectionCents: number | null;
  shippingCents: number | null;
  totalCents: number | null;
  /** Shipping known (or no breakdown): the total is what was really paid. */
  complete: boolean;
}

/** Registre des achats: items bought in the year. Items without a purchase date are counted apart, never guessed. */
export function purchasesRegister(views: readonly ItemView[], year: number): { rows: LedgerPurchase[]; undated: number } {
  const bought = views.filter((v) => v.item.purchasePriceCents !== null || v.item.purchaseDate !== null);
  const rows = bought
    .filter((v) => v.item.purchaseDate !== null && yearOf(v.item.purchaseDate) === year)
    .sort((a, b) => a.item.purchaseDate! - b.item.purchaseDate!)
    .map((v) => {
      const d = v.item.costDetail;
      return {
        itemId: v.item.id,
        date: v.item.purchaseDate,
        title: v.item.title,
        source: v.item.purchaseSource,
        itemCents: d ? d.itemCents : v.item.purchasePriceCents,
        protectionCents: d ? d.protectionCents : null,
        shippingCents: d ? d.shippingCents : null,
        totalCents: v.item.purchasePriceCents,
        complete: v.costComplete,
      };
    });
  const undated = bought.filter((v) => v.item.purchaseDate === null && v.item.purchasePriceCents !== null).length;
  return { rows, undated };
}

export interface YearSummary {
  year: number;
  sales: number;
  revenueCents: number;
  refunds: number;
  refundedCents: number;
  /** Cost of the goods sold, known part. */
  cogs: MoneyMetric;
  grossMargin: MoneyMetric;
  purchases: MoneyMetric;
  byMonth: { month: number; revenueCents: number; sales: number; profit: MoneyMetric }[];
  dac7: { salesRatio: number; revenueRatio: number; reportable: boolean };
}

export function yearSummary(sales: readonly SaleView[], views: readonly ItemView[], year: number): YearSummary {
  const inYear = sales.filter((s) => yearOf(s.sale.soldAt) === year);
  const done = inYear.filter((s) => s.sale.status !== 'REFUNDED');
  const refunded = inYear.filter((s) => s.sale.status === 'REFUNDED');
  const revenue = done.reduce((a, s) => a + s.sale.salePriceCents, 0);
  const reg = purchasesRegister(views, year);
  const byMonth = Array.from({ length: 12 }, (_, month) => {
    const m = done.filter((s) => new Date(s.sale.soldAt).getMonth() === month);
    return { month, revenueCents: m.reduce((a, s) => a + s.sale.salePriceCents, 0), sales: m.length, profit: sumMetric(m.map((s) => s.profit)) };
  });
  return {
    year,
    sales: done.length,
    revenueCents: revenue,
    refunds: refunded.length,
    refundedCents: refunded.reduce((a, s) => a + s.sale.salePriceCents, 0),
    cogs: sumMetric(done.map((s) => s.cost)),
    grossMargin: sumMetric(done.map((s) => s.profit)),
    purchases: sumMetric(reg.rows.map((r) => r.totalCents)),
    byMonth,
    dac7: {
      salesRatio: done.length / DAC7.sales,
      revenueRatio: revenue / DAC7.revenueCents,
      reportable: done.length >= DAC7.sales || revenue > DAC7.revenueCents,
    },
  };
}

/** Years with any sale or dated purchase, newest first; always includes the current year. */
export function ledgerYears(sales: readonly SaleView[], views: readonly ItemView[], now: number): number[] {
  const ys = new Set<number>([yearOf(now)]);
  for (const s of sales) ys.add(yearOf(s.sale.soldAt));
  for (const v of views) if (v.item.purchaseDate) ys.add(yearOf(v.item.purchaseDate));
  return [...ys].sort((a, b) => b - a);
}

/* ── CSV (French Excel: « ; » separator, decimal comma, UTF-8 BOM) ── */

export type Cell = string | number | null;

const euros = (c: number | null) => (c === null ? '' : eurNumber(c));
const day = (ts: number | null) => (ts === null ? '' : new Date(ts).toISOString().slice(0, 10));

export function toCsv(head: string[], rows: Cell[][]): string {
  const cell = (v: Cell) => {
    const s = v === null ? '' : String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `\uFEFF${[head, ...rows].map((r) => r.map(cell).join(';')).join('\r\n')}\r\n`;
}

export function salesCsv(rows: readonly LedgerSale[]): string {
  return toCsv(
    ['Date', 'N° facture', 'Référence', 'Article', 'Marque', 'Montant encaissé (€)', 'Coût d’achat (€)', 'Marge (€)', 'Mode de règlement'],
    rows.map((r) => [day(r.date), r.invoice, r.ref, r.title, r.brand, euros(r.amountCents), euros(r.costCents), euros(r.profitCents), 'Vinted']),
  );
}

export function purchasesCsv(rows: readonly LedgerPurchase[]): string {
  return toCsv(
    ['Date', 'Article', 'Source', 'Prix article (€)', 'Protection acheteur (€)', 'Port (€)', 'Total (€)', 'Total complet'],
    rows.map((r) => [day(r.date), r.title, r.source, euros(r.itemCents), euros(r.protectionCents), euros(r.shippingCents), euros(r.totalCents), r.complete ? 'oui' : 'hors port']),
  );
}

export function stockCsv(views: readonly ItemView[]): string {
  return toCsv(
    ['Référence', 'Article', 'Marque', 'Taille', 'Statut', 'Coût (€)', 'Prix demandé (€)', 'Marge potentielle (€)', 'Jours détenu', 'Vues', 'Favoris'],
    views.map((v) => [skuOf(v.item.id), v.item.title, v.item.brand, v.item.size, v.item.status, euros(v.cost), euros(v.askPrice), euros(v.potentialProfit), v.daysHeld, v.current?.views ?? null, v.current?.favorites ?? null]),
  );
}

/* ── Expenses ───────────────────────────────────────────── */

export const EXPENSE_CATEGORIES = ['PACKAGING', 'SHIPPING', 'BOOST', 'TRAVEL', 'SUBSCRIPTION', 'CLEANING', 'OTHER'] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export interface ExpenseSummary {
  totalCents: number;
  count: number;
  byCategory: { category: ExpenseCategory; cents: number }[];
  byMonth: number[];
  /** Gross margin of the year's sales minus the year's expenses (partial when some costs are unknown). */
  net: MoneyMetric;
}

export function expenseSummary(expenses: readonly { date: number; amountCents: number; category: ExpenseCategory }[], year: number, grossMargin: MoneyMetric): ExpenseSummary {
  const inYear = expenses.filter((e) => yearOf(e.date) === year);
  const total = inYear.reduce((a, e) => a + e.amountCents, 0);
  const byCategory = EXPENSE_CATEGORIES.map((category) => ({ category, cents: inYear.filter((e) => e.category === category).reduce((a, e) => a + e.amountCents, 0) }))
    .filter((c) => c.cents > 0)
    .sort((a, b) => b.cents - a.cents);
  const byMonth = Array.from({ length: 12 }, (_, m) => inYear.filter((e) => new Date(e.date).getMonth() === m).reduce((a, e) => a + e.amountCents, 0));
  const net: MoneyMetric = grossMargin.status === 'unknown' ? grossMargin : { ...grossMargin, value: grossMargin.value - total };
  return { totalCents: total, count: inYear.length, byCategory, byMonth, net };
}

/**
 * The recurring costs, one click each: the seller's last amount for it comes back (a box of cartons costs what it cost
 * last time); the first time, the form is filled for the seller to type the amount — never an amount made up.
 */
export const EXPENSE_PRESETS = [
  { key: 'BOXES', label: 'Lot de cartons', category: 'PACKAGING' },
  { key: 'TAPE', label: 'Scotch', category: 'PACKAGING' },
  { key: 'FUEL', label: 'Essence / trajet sourcing', category: 'TRAVEL' },
  { key: 'CLEANING', label: 'Pressing', category: 'CLEANING' },
  { key: 'BOOST', label: 'Boost Vinted', category: 'BOOST' },
] as const satisfies readonly { key: string; label: string; category: ExpenseCategory }[];
export type ExpensePreset = (typeof EXPENSE_PRESETS)[number];

/** The amount the seller last entered for this preset (its note is the preset's name), or null the first time. */
export function presetAmount(rows: readonly { date: number; amountCents: number; note: string }[], p: Pick<ExpensePreset, 'label'>): number | null {
  const last = rows.filter((r) => r.note.trim() === p.label).sort((a, b) => b.date - a.date)[0];
  return last ? last.amountCents : null;
}

/* ── The accountant's export: every sale of the year, the year's expenses, the DAC7 threshold ─────────────────── */

/** « #001 »: the sale's number in the archive, every completed sale counted from the first one ever (stable). */
export function archiveRefs(sales: readonly SaleView[]): Map<string, string> {
  const done = sales.filter((s) => s.sale.status !== 'REFUNDED').sort((a, b) => a.sale.soldAt - b.sale.soldAt || a.sale.id.localeCompare(b.sale.id));
  return new Map(done.map((s, i) => [s.sale.id, `#${String(i + 1).padStart(3, '0')}`]));
}

/** What a sale's article cost: its price, and the fees around it (buyer protection, shipping) when the breakdown is known. */
function costParts(s: SaleView): { itemCents: number | null; feesCents: number | null } {
  const d = s.item.costDetail;
  if (d) return { itemCents: d.itemCents, feesCents: d.protectionCents === null && d.shippingCents === null ? null : (d.protectionCents ?? 0) + (d.shippingCents ?? 0) };
  return { itemCents: s.cost, feesCents: null };
}

/**
 * The full accounting CSV of a year (UTF-8 with BOM, « ; », decimal comma: opens as is in Excel and Numbers): one line
 * per completed sale (date, archive number, article, brand, purchase cost, fees, sale price, net profit, the year's
 * running total and where it stands against DAC7), then one line per expense (taken off the profit), then the totals.
 * An unknown cost leaves its cells empty and the totals say « partiel » — never counted as 0.
 */
export function accountingCsv(sales: readonly SaleView[], year: number, expenses: readonly { date: number; amountCents: number; category: ExpenseCategory; note: string }[], categoryLabel: (c: ExpenseCategory) => string): string {
  const refs = archiveRefs(sales);
  const rows: Cell[][] = [];
  let cumul = 0;
  let count = 0;
  let costSum = 0;
  let feesSum = 0;
  let saleSum = 0;
  let profitSum = 0;
  let partial = false;
  const yearSales = sales.filter((s) => s.sale.status !== 'REFUNDED' && yearOf(s.sale.soldAt) === year).sort((a, b) => a.sale.soldAt - b.sale.soldAt || a.sale.id.localeCompare(b.sale.id));
  for (const s of yearSales) {
    const { itemCents, feesCents } = costParts(s);
    cumul += s.sale.salePriceCents;
    count++;
    saleSum += s.sale.salePriceCents;
    if (itemCents !== null) costSum += itemCents;
    if (feesCents !== null) feesSum += feesCents;
    if (s.profit === null) partial = true;
    else profitSum += s.profit;
    // The same rule as the DAC7 gauge: reported from 30 sales, or over 2 000 €.
    const reached = count >= DAC7.sales || cumul > DAC7.revenueCents;
    rows.push([
      day(s.sale.soldAt),
      refs.get(s.sale.id) ?? null,
      s.item.title,
      s.item.brand,
      euros(itemCents),
      euros(feesCents),
      euros(s.sale.salePriceCents),
      euros(s.profit),
      euros(cumul),
      reached ? `atteint (${count} ventes · ${eurNumber(cumul, 0)} €)` : `${count}/${DAC7.sales} ventes · ${eurNumber(cumul, 0)}/${eurNumber(DAC7.revenueCents, 0)} €`,
    ]);
  }
  const yearExpenses = expenses.filter((e) => yearOf(e.date) === year).sort((a, b) => a.date - b.date);
  for (const e of yearExpenses) {
    feesSum += e.amountCents;
    profitSum -= e.amountCents;
    rows.push([day(e.date), 'Dépense', [categoryLabel(e.category), e.note.trim()].filter(Boolean).join(' · '), null, null, euros(e.amountCents), null, euros(-e.amountCents), euros(cumul), null]);
  }
  rows.push([`Total ${year}`, null, `${count} ventes${yearExpenses.length ? ` · ${yearExpenses.length} dépenses` : ''}`, null, euros(costSum), euros(feesSum), euros(saleSum), `${eurNumber(profitSum)}${partial ? ' (partiel : coûts inconnus)' : ''}`, euros(cumul), count >= DAC7.sales || cumul > DAC7.revenueCents ? 'seuil DAC7 atteint' : 'sous le seuil DAC7']);
  return toCsv(['Date', 'Référence Archive', 'Article', 'Marque', 'Coût d’achat (€)', 'Frais annexes (€)', 'Prix de vente (€)', 'Profit net (€)', 'Cumul annuel (€)', `Seuil DAC7 (${DAC7.sales} ventes ou ${eurNumber(DAC7.revenueCents, 0)} €)`], rows);
}

/* ── Full exports: every sale, every article ─────────────── */

export interface CsvLabels {
  category: (c: string) => string;
  condition: (c: string) => string;
  status: (s: string) => string;
  refund: (r: string) => string;
}

/** Every sale ever recorded, oldest first — refunded ones included and said so. */
export function allSalesCsv(sales: readonly SaleView[], l: CsvLabels): string {
  return toCsv(
    ['Date', 'Référence', 'Article', 'Marque', 'Catégorie', 'Taille', 'Prix de vente (€)', 'Coût (€)', 'Marge (€)', 'Statut', 'Motif du remboursement'],
    [...sales]
      .sort((a, b) => a.sale.soldAt - b.sale.soldAt)
      .map((s) => [
        day(s.sale.soldAt),
        skuOf(s.item.id),
        s.item.title,
        s.item.brand,
        l.category(s.item.category),
        s.item.size,
        euros(s.sale.salePriceCents),
        euros(s.cost),
        euros(s.profit),
        s.sale.status === 'REFUNDED' ? 'Remboursée' : s.sale.status === 'PENDING' ? 'En cours' : 'Vendue',
        s.sale.refundReason ? l.refund(s.sale.refundReason) : null,
      ]),
  );
}

/** Every article, in stock or sold: what it is, what it cost, where it stands. */
export function itemsCsv(views: readonly ItemView[], l: CsvLabels): string {
  return toCsv(
    ['Référence', 'Article', 'Marque', 'Modèle', 'Catégorie', 'Taille', 'État', 'Statut', 'Date d’achat', 'Source', 'Coût (€)', 'Prix demandé (€)', 'Vues', 'Favoris', 'Lien Vinted'],
    views.map((v) => [
      skuOf(v.item.id),
      v.item.title,
      v.item.brand,
      v.item.model,
      l.category(v.item.category),
      v.item.size,
      v.item.condition ? l.condition(v.item.condition) : null,
      l.status(v.item.status),
      day(v.item.purchaseDate),
      v.item.purchaseSource,
      euros(v.cost),
      euros(v.askPrice),
      v.current?.views ?? null,
      v.current?.favorites ?? null,
      v.current?.url ?? null,
    ]),
  );
}
