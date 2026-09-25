import Dexie, { type EntityTable } from 'dexie';
import type {
  ActivationEvent,
  Decision,
  DomainEvent,
  InventoryItem,
  Listing,
  ListingObservation,
  PricePrediction,
  Prep,
  Sale,
} from '@/domain/entities';
import type { ComparableAnalysis } from '@/intelligence/comparables';

export interface StoredAnalysis {
  id: string;
  inventoryItemId: string | null;
  at: number;
  analysis: ComparableAnalysis;
  isDemo: boolean;
}

/** A sales invoice: numbered per year, sequential and gap-free (never deleted, never renumbered). */
export interface InvoiceRow {
  saleId: string;
  number: string;
  year: number;
  seq: number;
  issuedAt: number;
  /** Buyer name as the seller types it (Vinted does not expose it to ERA). */
  buyer: string;
}

/** Seller identity printed on invoices. Local only. */
export interface SellerIdentity {
  name: string;
  address: string;
  siret: string;
  email: string;
  /** Micro-entrepreneur under the VAT franchise: prints « TVA non applicable, art. 293 B du CGI ». */
  vatExempt: boolean;
}

/** An order the seller PAID for on Vinted (from "Mes commandes → Achats"): a real purchase price. */
export interface PurchaseRow {
  id: string;
  title: string;
  priceCents: number;
  date: number | null;
  status: string | null;
  /** The stock item this purchase was matched to (its cost comes from here). */
  linkedItemId: string | null;
  dismissed: boolean;
  importedAt: number;
}

export interface SettingRow {
  key: string;
  value: unknown;
}

/** One line per automated action (or simulated one): what, when, on what, and what Vinted answered. */
export interface AutoLogRow {
  id: string;
  at: number;
  kind: 'RUN' | 'FAV_MESSAGE' | 'FAV_OFFER' | 'OFFER_ACCEPT' | 'OFFER_REJECT' | 'OFFER_COUNTER' | 'SKIP' | 'STOP' | 'DRAFT' | 'LABEL' | 'HIDE' | 'UNHIDE' | 'REPOST' | 'DELETE';
  dryRun: boolean;
  ok: boolean;
  target: string;
  detail: string;
}

export class EraDatabase extends Dexie {
  items!: EntityTable<InventoryItem, 'id'>;
  listings!: EntityTable<Listing, 'id'>;
  observations!: EntityTable<ListingObservation, 'id'>;
  sales!: EntityTable<Sale, 'id'>;
  events!: EntityTable<DomainEvent, 'id'>;
  analyses!: EntityTable<StoredAnalysis, 'id'>;
  predictions!: EntityTable<PricePrediction, 'id'>;
  decisions!: EntityTable<Decision, 'id'>;
  activation!: EntityTable<ActivationEvent, 'name'>;
  settings!: EntityTable<SettingRow, 'key'>;
  purchases!: EntityTable<PurchaseRow, 'id'>;
  preps!: EntityTable<Prep, 'itemId'>;
  invoices!: EntityTable<InvoiceRow, 'saleId'>;
  autoLog!: EntityTable<AutoLogRow, 'id'>;

  constructor(name = 'era-intelligence') {
    super(name);
    this.version(1).stores({
      items: 'id, status, brand, category, updatedAt, isDemo',
      listings: 'id, inventoryItemId, status, listedAt, isDemo',
      observations: 'id, listingId, inventoryItemId, at',
      sales: 'id, inventoryItemId, soldAt, status, isDemo',
      events: 'id, inventoryItemId, type, at',
      analyses: 'id, inventoryItemId, at',
      predictions: 'id, inventoryItemId, at',
      decisions: 'id, recommendationKey, inventoryItemId, at',
      activation: 'name',
      settings: 'key',
    });
    this.version(2).stores({ purchases: 'id, date, linkedItemId' });
    this.version(3).stores({ preps: 'itemId, publishedAt' });
    this.version(4).stores({ invoices: 'saleId, year, seq' });
    this.version(5).stores({ autoLog: 'id, at, kind' });
  }
}

export const db = new EraDatabase();

export function uid(prefix = ''): string {
  const rnd = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return prefix ? `${prefix}_${rnd}` : rnd;
}
