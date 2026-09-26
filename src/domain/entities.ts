import { z } from 'zod';
import { PROVENANCES } from './provenance';

const cents = z.number().int();
const maybeCents = cents.nullable();
const ts = z.number().int().nonnegative();

export const ConditionSchema = z.enum(['NEW_WITH_TAGS', 'NEW_WITHOUT_TAGS', 'VERY_GOOD', 'GOOD', 'SATISFACTORY']);
export type Condition = z.infer<typeof ConditionSchema>;
export const CONDITIONS = ConditionSchema.options;

export const CategorySchema = z.enum([
  'JACKET',
  'COAT',
  'SWEATSHIRT',
  'KNIT',
  'SHIRT',
  'POLO',
  'TSHIRT',
  'JEANS',
  'TROUSERS',
  'SHORTS',
  'SHOES',
  'ACCESSORY',
  'OTHER',
]);
export type Category = z.infer<typeof CategorySchema>;
export const CATEGORIES = CategorySchema.options;

export const GenderSchema = z.enum(['MEN', 'WOMEN', 'UNISEX', 'KIDS']);
export type Gender = z.infer<typeof GenderSchema>;

const FieldMetaSchema = z.object({ p: z.enum(PROVENANCES), at: ts, q: z.number().min(0).max(1).optional() });

/** DRAFT = not posted · LISTED = posted · RESERVED = buyer reserved · HIDDEN = posted but hidden · SOLD · ARCHIVED. */
export const ItemStatusSchema = z.enum(['DRAFT', 'LISTED', 'RESERVED', 'HIDDEN', 'SOLD', 'ARCHIVED']);
export type ItemStatus = z.infer<typeof ItemStatusSchema>;

/** A physical article the seller owns (or owned). One item can have many successive listings. */
export const InventoryItemSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  brand: z.string().min(1),
  /** Model / line within the brand, e.g. "Harrington", "Detroit", "501". Key for niches and comparables. */
  model: z.string().nullable(),
  category: CategorySchema,
  gender: GenderSchema.nullable(),
  size: z.string().nullable(),
  condition: ConditionSchema.nullable(),
  material: z.string().nullable(),
  era: z.string().nullable(),
  photoUrl: z.string().nullable(),
  /** Total known cost (what the engines use). With a costDetail whose shipping is unknown, it EXCLUDES shipping. */
  purchasePriceCents: maybeCents,
  /** Breakdown when known (Vinted purchases): item price, buyer protection, shipping (null = unknown, never 0). */
  costDetail: z
    .object({ itemCents: cents, protectionCents: cents.nullable(), shippingCents: cents.nullable() })
    .nullable()
    .default(null),
  purchaseDate: ts.nullable(),
  purchaseSource: z.string().nullable(),
  status: ItemStatusSchema,
  createdAt: ts,
  updatedAt: ts,
  /** Provenance of important fields. */
  meta: z.record(z.string(), FieldMetaSchema).default({}),
  /** DEMO data is never mixed silently with real data. */
  isDemo: z.boolean().default(false),
});
export type InventoryItem = z.infer<typeof InventoryItemSchema>;

export const ListingStatusSchema = z.enum(['ACTIVE', 'RESERVED', 'HIDDEN', 'REMOVED', 'SOLD']);
export type ListingStatus = z.infer<typeof ListingStatusSchema>;

/** A marketplace listing. A republish is a NEW listing for the SAME item. */
export const ListingSchema = z.object({
  id: z.string(),
  inventoryItemId: z.string(),
  platform: z.literal('vinted'),
  platformListingId: z.string().nullable(),
  url: z.string().nullable(),
  title: z.string(),
  priceCents: cents,
  views: z.number().int().nonnegative().nullable(),
  favorites: z.number().int().nonnegative().nullable(),
  listedAt: ts,
  /**
   * false when Vinted gave no publication date (no photo timestamp): listedAt is then only when ERA first
   * saw the listing, a bound, never a date to compute selling speed from. Missing on older imported rows.
   */
  listedAtKnown: z.boolean().optional(),
  /** What the listing shows, as Vinted returned it (absent = not read): photo count, description. */
  photoCount: z.number().int().nonnegative().nullable().optional(),
  description: z.string().nullable().optional(),
  removedAt: ts.nullable(),
  soldAt: ts.nullable(),
  status: ListingStatusSchema,
  lastObservedAt: ts.nullable(),
  isDemo: z.boolean().default(false),
});
export type Listing = z.infer<typeof ListingSchema>;

/** Point-in-time snapshot of a listing's public signals. */
export const ListingObservationSchema = z.object({
  id: z.string(),
  listingId: z.string(),
  inventoryItemId: z.string(),
  at: ts,
  priceCents: cents,
  views: z.number().int().nonnegative().nullable(),
  favorites: z.number().int().nonnegative().nullable(),
  provenance: z.enum(PROVENANCES),
});
export type ListingObservation = z.infer<typeof ListingObservationSchema>;

export const SaleStatusSchema = z.enum(['PENDING', 'COMPLETED', 'REFUNDED']);
export type SaleStatus = z.infer<typeof SaleStatusSchema>;

export const SaleSchema = z.object({
  id: z.string(),
  inventoryItemId: z.string(),
  listingId: z.string().nullable(),
  soldAt: ts,
  salePriceCents: cents,
  /** Seller-side costs (fees, packaging, shipping not paid by buyer). null = unknown, 0 = known none. */
  extraCostsCents: maybeCents,
  status: SaleStatusSchema,
  /** Why the buyer was refunded — entered by the seller in one click (Vinted does not expose it). */
  refundReason: z.enum(['SIZE', 'DEFECT', 'CONDITION', 'DESCRIPTION', 'AUTHENTICITY', 'SHIPPING', 'BUYER', 'OTHER']).nullable().optional(),
  /** Order status text as Vinted shows it, refreshed at each import (UNVERIFIED field). */
  vintedStatus: z.string().nullable().optional(),
  /** When ERA first saw the current Vinted status (a change of status restarts it); absent = not seen change. */
  vintedStatusSince: z.number().nullable().optional(),
  /** Vinted waits for the seller (e.g. to ship): `transaction_user_status: "needs_action"` (UNVERIFIED field). */
  needsAction: z.boolean().optional(),
  /** The Vinted order this sale came from (listing id, else title|date|price): re-imports update, never duplicate. */
  orderKey: z.string().nullable().optional(),
  /** false when the Vinted order carried no date: soldAt is then the import day, not the sale day. */
  dateKnown: z.boolean().optional(),
  /** The order's Vinted conversation (for its shipping label), when the order carries it. */
  vintedConversationId: z.string().nullable().optional(),
  isDemo: z.boolean().default(false),
});
export type Sale = z.infer<typeof SaleSchema>;
export type RefundReason = NonNullable<Sale['refundReason']>;
export const REFUND_REASONS: RefundReason[] = ['SIZE', 'DEFECT', 'CONDITION', 'DESCRIPTION', 'AUTHENTICITY', 'SHIPPING', 'BUYER', 'OTHER'];

/**
 * Listing preparation sheet (Atelier de mise en ligne): everything the seller reads on the item
 * before publishing it by hand on Vinted. Nothing here is sent to Vinted.
 */
export const PrepSchema = z.object({
  itemId: z.string(),
  /** Measures read with the tape's zero visible, in cm, as typed ("54", "non lisible"). */
  measures: z.record(z.string(), z.string()).default({}),
  colors: z.string().default(''),
  material: z.string().default(''),
  /** Product reference read on a label (style code, SKU…): a very low-competition search term. */
  productRef: z.string().default(''),
  defects: z.string().default(''),
  packageSize: z.enum(['SMALL', 'MEDIUM', 'LARGE']).nullable().default(null),
  /** Checklist keys ticked by the seller. */
  checks: z.array(z.string()).default([]),
  titleOverride: z.string().nullable().default(null),
  descriptionOverride: z.string().nullable().default(null),
  priceCents: z.number().int().nonnegative().nullable().default(null),
  startedAt: z.number(),
  /** Seconds with the sheet open and the window visible (measured, idle capped). */
  seconds: z.number().nonnegative().default(0),
  readyAt: z.number().nullable().default(null),
  /** The seller says it is published on Vinted; the next import links the listing via the reference. */
  publishedAt: z.number().nullable().default(null),
  /** The Vinted draft ERA created from this sheet (photos and publication stay with the seller). */
  vintedDraftId: z.string().nullable().optional(),
  /**
   * "Remettre en vente un similaire": the article this sheet was copied from. Its Vinted listing gives the draft
   * Vinted's own ids; its sale price is a real reference. Measures, defects, colours, material: never copied.
   */
  template: z
    .object({ itemId: z.string(), title: z.string(), listingId: z.string().nullable(), size: z.string().nullable(), soldCents: z.number().int().nullable(), soldAt: z.number().nullable() })
    .nullable()
    .optional(),
});
export type Prep = z.infer<typeof PrepSchema>;

export const DomainEventTypeSchema = z.enum([
  'ITEM_ACQUIRED',
  'COST_ENTERED',
  'LISTING_PUBLISHED',
  'PRICE_CHANGED',
  'ENGAGEMENT_OBSERVED',
  'LISTING_REMOVED',
  'LISTING_REPUBLISHED',
  'ITEM_SOLD',
  'STATUS_CHANGED',
  'SALE_REFUNDED',
  'LISTING_PREPARED',
  'MARKET_ANALYZED',
  'PREDICTION_MADE',
  'PREDICTION_RESOLVED',
]);
export type DomainEventType = z.infer<typeof DomainEventTypeSchema>;

export const DomainEventSchema = z.object({
  id: z.string(),
  type: DomainEventTypeSchema,
  at: ts,
  inventoryItemId: z.string().nullable(),
  listingId: z.string().nullable(),
  /** Small, typed-by-convention payload (prices in cents). */
  data: z.record(z.string(), z.union([z.number(), z.string(), z.boolean(), z.null()])).default({}),
  provenance: z.enum(PROVENANCES),
  isDemo: z.boolean().default(false),
});
export type DomainEvent = z.infer<typeof DomainEventSchema>;

export const ConfidenceSchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const StrategySchema = z.enum(['FAST', 'BALANCED', 'MAX_MARGIN']);
export type Strategy = z.infer<typeof StrategySchema>;

/** A stored prediction — later confronted with reality. */
export const PricePredictionSchema = z.object({
  id: z.string(),
  inventoryItemId: z.string(),
  at: ts,
  strategy: StrategySchema,
  priceMinCents: cents,
  priceMaxCents: cents,
  daysMin: z.number().nonnegative(),
  daysMax: z.number().nonnegative(),
  confidence: ConfidenceSchema,
  sampleSize: z.number().nonnegative(),
  /** Where the forecast came from: a market analysis, an accepted recommendation, or a price the seller set. */
  kind: z.enum(['ANALYSIS', 'RECOMMENDATION']).default('ANALYSIS'),
  /** The single price ERA suggested (the forecast is judged against it). Null on legacy records → range mid. */
  suggestedCents: cents.nullable().default(null),
  /** The data the forecast was built on, frozen at prediction time. */
  basis: z
    .object({
      comparables: z.number().nonnegative(),
      p25: cents.nullable(),
      p50: cents.nullable(),
      p75: cents.nullable(),
      source: z.enum(['DEMO', 'VINTED']).nullable(),
      quality: z.string().nullable(),
      personalN: z.number().nonnegative(),
      personalMedianCents: cents.nullable(),
      personalMedianDays: z.number().nullable(),
      askCents: cents.nullable(),
      correction: z.number(),
    })
    .nullable()
    .default(null),
  resolved: z
    .object({
      at: ts,
      salePriceCents: cents,
      days: z.number().nonnegative(),
      priceError: z.number(),
      timeErrorDays: z.number(),
      priceInRange: z.boolean(),
      timeInRange: z.boolean(),
    })
    .nullable(),
  isDemo: z.boolean().default(false),
});
export type PricePrediction = z.infer<typeof PricePredictionSchema>;

/** What the seller did with a recommendation. Feeds the learning loop. */
export const DecisionSchema = z.object({
  id: z.string(),
  recommendationKey: z.string(),
  inventoryItemId: z.string().nullable(),
  action: z.string(),
  outcome: z.enum(['ACCEPTED', 'DISMISSED', 'SNOOZED']),
  at: ts,
  until: ts.nullable(),
});
export type Decision = z.infer<typeof DecisionSchema>;

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
export const MarketCandidateSchema = z.object({
  id: z.string(),
  title: z.string(),
  brand: z.string().nullable(),
  priceCents: cents,
  size: z.string().nullable(),
  condition: ConditionSchema.nullable(),
  category: CategorySchema.nullable(),
  gender: GenderSchema.nullable(),
  url: z.string().nullable(),
  photoUrl: z.string().nullable(),
  favorites: z.number().int().nonnegative().nullable(),
  listedAt: ts.nullable(),
  promoted: z.boolean().default(false),
  sellerId: z.string().nullable(),
});
export type MarketCandidate = z.infer<typeof MarketCandidateSchema>;
