import { type MoneyMetric, sumMetric } from '@/domain/money';
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

const euros = (c: number | null) => (c === null ? '' : (c / 100).toFixed(2).replace('.', ','));
const day = (ts: number | null) => (ts === null ? '' : new Date(ts).toISOString().slice(0, 10));

export function toCsv(head: string[], rows: Cell[][]): string {
  const cell = (v: Cell) => {
    const s = v === null ? '' : String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `﻿${[head, ...rows].map((r) => r.map(cell).join(';')).join('\r\n')}\r\n`;
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
