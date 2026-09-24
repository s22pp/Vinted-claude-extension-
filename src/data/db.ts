import Dexie, { type EntityTable } from 'dexie';
import type {
  ActivationEvent,
  Decision,
  DomainEvent,
  InventoryItem,
  Listing,
  ListingObservation,
  PricePrediction,
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
  }
}

export const db = new EraDatabase();

export function uid(prefix = ''): string {
  const rnd = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return prefix ? `${prefix}_${rnd}` : rnd;
}
