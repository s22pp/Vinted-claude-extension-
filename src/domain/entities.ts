import type { FieldMeta, Provenance } from './provenance';

/*
 * The shapes ERA stores (IndexedDB) and reasons about. Plain types: nothing here runs, except the few
 * constructors at the end that fill defaults and refuse what must never be stored (a title-less article,
 * money that is not whole cents).
 */

export const CONDITIONS = ['NEW_WITH_TAGS', 'NEW_WITHOUT_TAGS', 'VERY_GOOD', 'GOOD', 'SATISFACTORY'] as const;
export type Condition = (typeof CONDITIONS)[number];

export const CATEGORIES = ['JACKET', 'COAT', 'SWEATSHIRT', 'KNIT', 'SHIRT', 'POLO', 'TSHIRT', 'JEANS', 'TROUSERS', 'SHORTS', 'SHOES', 'ACCESSORY', 'OTHER'] as const;
export type Category = (typeof CATEGORIES)[number];

export const GENDERS = ['MEN', 'WOMEN', 'UNISEX', 'KIDS'] as const;
export type Gender = (typeof GENDERS)[number];

/** DRAFT = not posted · LISTED = posted · RESERVED = buyer reserved · HIDDEN = posted but hidden · SOLD · ARCHIVED. */
export type ItemStatus = 'DRAFT' | 'LISTED' | 'RESERVED' | 'HIDDEN' | 'SOLD' | 'ARCHIVED';

/** A physical article the seller owns (or owned). One item can have many successive listings. */
export interface InventoryItem {
  id: string;
  title: string;
  brand: string;
  /** Model / line within the brand, e.g. "Harrington", "Detroit", "501". Key for niches and comparables. */
  model: string | null;
  category: Category;
  gender: Gender | null;
  size: string | null;
  condition: Condition | null;
  material: string | null;
  era: string | null;
  photoUrl: string | null;
  /** Total known cost (what the engines use). With a costDetail whose shipping is unknown, it EXCLUDES shipping. */
  purchasePriceCents: number | null;
  /** Breakdown when known (Vinted purchases): item price, buyer protection, shipping (null = unknown, never 0). */
  costDetail: { itemCents: number; protectionCents: number | null; shippingCents: number | null } | null;
  purchaseDate: number | null;
  purchaseSource: string | null;
  status: ItemStatus;
  createdAt: number;
  updatedAt: number;
  /** Provenance of important fields. */
  meta: Record<string, FieldMeta>;
  /** DEMO data is never mixed silently with real data. */
  isDemo: boolean;
}

export type ListingStatus = 'ACTIVE' | 'RESERVED' | 'HIDDEN' | 'REMOVED' | 'SOLD';

/** A marketplace listing. A republish is a NEW listing for the SAME item. */
export interface Listing {
  id: string;
  inventoryItemId: string;
  platform: 'vinted';
  platformListingId: string | null;
  url: string | null;
  title: string;
  priceCents: number;
  views: number | null;
  favorites: number | null;
  listedAt: number;
  /**
   * false when Vinted gave no publication date (no photo timestamp): listedAt is then only when ERA first
   * saw the listing, a bound, never a date to compute selling speed from. Missing on older imported rows.
   */
  listedAtKnown?: boolean;
  /** What the listing shows, as Vinted returned it (absent = not read): photo count, description. */
  photoCount?: number | null;
  description?: string | null;
  /** Its photos on Vinted's image servers, as last read (for "download my photos"). */
  photoUrls?: string[];
  removedAt: number | null;
  soldAt: number | null;
  status: ListingStatus;
  lastObservedAt: number | null;
  isDemo: boolean;
}

/** Point-in-time snapshot of a listing's public signals. */
export interface ListingObservation {
  id: string;
  listingId: string;
  inventoryItemId: string;
  at: number;
  priceCents: number;
  views: number | null;
  favorites: number | null;
  provenance: Provenance;
}

export type SaleStatus = 'PENDING' | 'COMPLETED' | 'REFUNDED';

export const REFUND_REASONS = ['SIZE', 'DEFECT', 'CONDITION', 'DESCRIPTION', 'AUTHENTICITY', 'SHIPPING', 'BUYER', 'OTHER'] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];

export interface Sale {
  id: string;
  inventoryItemId: string;
  listingId: string | null;
  soldAt: number;
  salePriceCents: number;
  /** Seller-side costs (fees, packaging, shipping not paid by buyer). null = unknown, 0 = known none. */
  extraCostsCents: number | null;
  status: SaleStatus;
  /** Why the buyer was refunded — entered by the seller in one click (Vinted does not expose it). */
  refundReason?: RefundReason | null;
  /** Order status text as Vinted shows it, refreshed at each import (UNVERIFIED field). */
  vintedStatus?: string | null;
  /** When ERA first saw the current Vinted status (a change of status restarts it); absent = not seen change. */
  vintedStatusSince?: number | null;
  /** Vinted waits for the seller (e.g. to ship): `transaction_user_status: "needs_action"` (UNVERIFIED field). */
  needsAction?: boolean;
  /** The Vinted order this sale came from (listing id, else title|date|price): re-imports update, never duplicate. */
  orderKey?: string | null;
  /** false when the Vinted order carried no date: soldAt is then the import day, not the sale day. */
  dateKnown?: boolean;
  /** The order's Vinted conversation (for its shipping label), when the order carries it. */
  vintedConversationId?: string | null;
  isDemo: boolean;
}

/**
 * Listing preparation sheet (Atelier de mise en ligne): everything the seller reads on the item
 * before publishing it by hand on Vinted. Nothing here is sent to Vinted.
 */
export interface Prep {
  itemId: string;
  /** Measures read with the tape's zero visible, in cm, as typed ("54", "non lisible"). */
  measures: Record<string, string>;
  colors: string;
  material: string;
  /** Product reference read on a label (style code, SKU…): a very low-competition search term. */
  productRef: string;
  defects: string;
  packageSize: 'SMALL' | 'MEDIUM' | 'LARGE' | null;
  /** Checklist keys ticked by the seller. */
  checks: string[];
  titleOverride: string | null;
  descriptionOverride: string | null;
  /** The seller's description template for this sheet: absent/null = the best match, 'ERA' = ERA's standard one. */
  descTemplateId?: string | null;
  priceCents: number | null;
  startedAt: number;
  /** Seconds with the sheet open and the window visible (measured, idle capped). */
  seconds: number;
  readyAt: number | null;
  /** The seller says it is published on Vinted; the next import links the listing via the reference. */
  publishedAt: number | null;
  /** The Vinted draft ERA created from this sheet (photos and publication stay with the seller). */
  vintedDraftId?: string | null;
  /**
   * "Remettre en vente un similaire": the article this sheet was copied from. Its Vinted listing gives the draft
   * Vinted's own ids; its sale price is a real reference. Measures, defects, colours, material: never copied.
   */
  template?: { itemId: string; title: string; listingId: string | null; size: string | null; soldCents: number | null; soldAt: number | null } | null;
}

export type DomainEventType =
  | 'ITEM_ACQUIRED'
  | 'COST_ENTERED'
  | 'LISTING_PUBLISHED'
  | 'PRICE_CHANGED'
  | 'ENGAGEMENT_OBSERVED'
  | 'LISTING_REMOVED'
  | 'LISTING_REPUBLISHED'
  | 'ITEM_SOLD'
  | 'STATUS_CHANGED'
  | 'SALE_REFUNDED'
  | 'LISTING_PREPARED'
  | 'MARKET_ANALYZED'
  | 'PREDICTION_MADE'
  | 'PREDICTION_RESOLVED';

export interface DomainEvent {
  id: string;
  type: DomainEventType;
  at: number;
  inventoryItemId: string | null;
  listingId: string | null;
  /** Small, typed-by-convention payload (prices in cents). */
  data: Record<string, number | string | boolean | null>;
  provenance: Provenance;
  isDemo: boolean;
}

export type Confidence = 'LOW' | 'MEDIUM' | 'HIGH';
export type Strategy = 'FAST' | 'BALANCED' | 'MAX_MARGIN';

/** A stored prediction — later confronted with reality. */
export interface PricePrediction {
  id: string;
  inventoryItemId: string;
  at: number;
  strategy: Strategy;
  priceMinCents: number;
  priceMaxCents: number;
  daysMin: number;
  daysMax: number;
  confidence: Confidence;
  sampleSize: number;
  /** Where the forecast came from: a market analysis, an accepted recommendation, or a price the seller set. */
  kind: 'ANALYSIS' | 'RECOMMENDATION';
  /** The single price ERA suggested (the forecast is judged against it). Null on legacy records → range mid. */
  suggestedCents: number | null;
  /** The data the forecast was built on, frozen at prediction time. */
  basis: {
    comparables: number;
    p25: number | null;
    p50: number | null;
    p75: number | null;
    source: 'DEMO' | 'VINTED' | null;
    quality: string | null;
    personalN: number;
    personalMedianCents: number | null;
    personalMedianDays: number | null;
    askCents: number | null;
    correction: number;
  } | null;
  resolved: {
    at: number;
    salePriceCents: number;
    days: number;
    priceError: number;
    timeErrorDays: number;
    priceInRange: boolean;
    timeInRange: boolean;
  } | null;
  isDemo: boolean;
}

/** What the seller did with a recommendation. Feeds the learning loop. */
export interface Decision {
  id: string;
  recommendationKey: string;
  inventoryItemId: string | null;
  action: string;
  outcome: 'ACCEPTED' | 'DISMISSED' | 'SNOOZED';
  at: number;
  until: number | null;
}

export const ACTIVATION_EVENTS = [
  'extension_installed',
  'dashboard_opened',
  'inventory_imported',
  'first_cost_entered',
  'first_market_analysis',
  'first_recommendation_viewed',
  'first_buy_analysis',
  'first_sale_tracked',
  'activation_completed',
] as const;
export type ActivationEventName = (typeof ACTIVATION_EVENTS)[number];

export interface ActivationEvent {
  name: ActivationEventName;
  at: number;
}

/** Market candidate as returned by a MarketplaceAdapter search, before any filtering. */
export interface MarketCandidate {
  id: string;
  title: string;
  brand: string | null;
  priceCents: number;
  size: string | null;
  condition: Condition | null;
  category: Category | null;
  gender: Gender | null;
  url: string | null;
  photoUrl: string | null;
  favorites: number | null;
  listedAt: number | null;
  promoted: boolean;
  sellerId: string | null;
}

/* ── Constructors ───────────────────────────────────────── */

/** An empty workshop sheet. */
export function newPrep(itemId: string, startedAt: number, over: Partial<Prep> = {}): Prep {
  return {
    itemId,
    measures: {},
    colors: '',
    material: '',
    productRef: '',
    defects: '',
    packageSize: null,
    checks: [],
    titleOverride: null,
    descriptionOverride: null,
    priceCents: null,
    startedAt,
    seconds: 0,
    readyAt: null,
    publishedAt: null,
    ...over,
  };
}

const isCents = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isTime = (v: unknown): v is number => isCents(v) && v >= 0;

/**
 * An article about to be stored: refused (Error) when it has no title or brand, an unknown category,
 * condition or gender, money that is not whole cents, or dates that are not timestamps.
 */
export function validItem(it: InventoryItem): InventoryItem {
  const bad = (what: string) => {
    throw new Error(`Article refusé : ${what}`);
  };
  if (!it.title) bad('titre vide');
  if (!it.brand) bad('marque vide');
  if (!(CATEGORIES as readonly string[]).includes(it.category)) bad(`catégorie inconnue (${it.category})`);
  if (it.condition !== null && !(CONDITIONS as readonly string[]).includes(it.condition)) bad(`état inconnu (${it.condition})`);
  if (it.gender !== null && !(GENDERS as readonly string[]).includes(it.gender)) bad(`genre inconnu (${it.gender})`);
  if (it.purchasePriceCents !== null && !isCents(it.purchasePriceCents)) bad('prix d’achat hors centimes');
  if (it.costDetail && (!isCents(it.costDetail.itemCents) || (it.costDetail.protectionCents !== null && !isCents(it.costDetail.protectionCents)) || (it.costDetail.shippingCents !== null && !isCents(it.costDetail.shippingCents))))
    bad('détail du coût hors centimes');
  if (it.purchaseDate !== null && !isTime(it.purchaseDate)) bad('date d’achat invalide');
  if (!isTime(it.createdAt) || !isTime(it.updatedAt)) bad('dates invalides');
  return it;
}
