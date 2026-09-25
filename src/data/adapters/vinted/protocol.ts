import type { MarketplaceErrorCode } from '../marketplace';
import type { PageItem } from './parse';

/** Read-only GET paths ERA may call. Anything else is refused by the content script. */
export const ALLOWED_API = [
  '/api/v2/users/current',
  '/api/v2/wardrobe/',
  '/api/v2/catalog/items',
  '/api/v2/my_orders',
  '/api/v2/item_upload/items/',
  // Automations (EXPERIMENTAL, read side): favourites notifications, inbox, one conversation.
  '/web/api/notifications/notifications',
  '/api/v2/inbox',
  '/api/v2/conversations/',
  // Prefilled draft (EXPERIMENTAL, read side): brand search and size groups of Vinted's upload form.
  '/api/v2/item_upload/brands',
  '/api/v2/item_upload/size_groups',
  // Shipping label: the seller's default address (the label's sender).
  '/api/v2/user_addresses/default_shipping_address',
];

/**
 * The ONLY writes ERA may send, each tied to one automation the seller switched on. Routes as read in
 * production tools on the same site — UNVERIFIED by ERA until the journal shows them working.
 */
const ALLOWED_WRITES: { method: 'POST' | 'PUT'; path: RegExp }[] = [
  { method: 'POST', path: /^\/api\/v2\/conversations$/ }, // open the conversation with a member who favourited an item
  { method: 'POST', path: /^\/api\/v2\/conversations\/\d+\/replies$/ }, // send a message
  { method: 'POST', path: /^\/api\/v2\/transactions\/\d+\/offers$/ }, // seller's offer / counter-offer
  { method: 'PUT', path: /^\/api\/v2\/transactions\/\d+\/offer_requests\/\d+\/(accept|reject)$/ }, // answer a buyer's offer
  { method: 'POST', path: /^\/api\/v2\/offers\/\d+\/(accept|reject)$/ }, // same, other route seen in production
  { method: 'POST', path: /^\/api\/v2\/item_upload\/suggestions\/categories$/ }, // category Vinted suggests for a title (a query)
  { method: 'POST', path: /^\/api\/v2\/item_upload\/drafts$/ }, // a DRAFT: never published, the seller adds photos and publishes
  { method: 'PUT', path: /^\/api\/v2\/transactions\/\d+\/shipment\/order$/ }, // "Obtenir le bordereau" (printable), on the seller's click
  { method: 'PUT', path: /^\/api\/v2\/items\/\d+\/is_hidden$/ }, // hide / show one of the seller's listings, on click
];

export function isAllowedWrite(method: string, path: string): boolean {
  return ALLOWED_WRITES.some((w) => w.method === method && w.path.test(path));
}

/** A search endpoint observed on Vinted's own search page is allowed too: GET, /api/, with a search_text param. */
export function isAllowedApi(path: string): boolean {
  return (
    ALLOWED_API.some((p) => path.startsWith(p)) ||
    (path.startsWith('/api/') && /[?&]search_text=/.test(path)) ||
    // an orders list observed on Vinted's own "Mes commandes" page (read-only GET)
    (path.startsWith('/api/v2/') && /order/i.test(path.split('?')[0]!)) ||
    // package sizes a category allows (upload form)
    /^\/api\/v2\/catalogs\/\d+\/package_sizes$/.test(path.split('?')[0]!) ||
    // the printable label of one shipment
    /^\/api\/v2\/shipments\/\d+\/label_url$/.test(path.split('?')[0]!)
  );
}

export type EraMessage =
  | { type: 'era:ping' }
  | { type: 'era:page' }
  | { type: 'era:api'; path: string }
  | { type: 'era:write'; method: 'POST' | 'PUT'; path: string; body: unknown }
  | { type: 'era:auto:run'; kind: 'FAV' | 'OFFERS'; dryRun: boolean }
  | { type: 'era:auto:schedule' }
  | { type: 'era:draft:create'; input: DraftInput }
  | { type: 'era:label:get'; conversationId: string; title: string }
  | { type: 'era:item:hide'; platformListingId: string; itemId: string; hidden: boolean }
  | { type: 'era:budget:reserve' }
  | { type: 'era:budget:report'; status: number }
  | { type: 'era:budget:status' }
  | { type: 'era:import' }
  | { type: 'era:import:stage'; stage: ImportStage }
  | { type: 'era:observe' }
  | { type: 'era:price:edit'; platformListingId: string; cents: number; itemId: string }
  | { type: 'era:price:stage'; stage: PriceStage }
  | { type: 'era:edit:form'; cents: number };

export type PriceStage = 'OPENING' | 'FILLING' | 'SAVING' | 'VERIFYING' | 'DONE';
export type EditFormResult = { ok: true; before: string } | { ok: false; detail: string };
export type PriceEditResult = { ok: true; before: number | null; after: number } | { ok: false; code: MarketplaceErrorCode; detail?: string };

export type ImportStage = 'CONNECTING' | 'READING' | 'MATCHING' | 'COMPLETE';
export type ImportResult =
  | { ok: true; items: number; updated: number; sales: number; linked?: number; reposts?: number; removed?: number }
  | { ok: false; code: MarketplaceErrorCode; detail?: string };

export type ApiResult = { ok: true; json: unknown } | { ok: false; code: MarketplaceErrorCode; status?: number; detail?: string };
export type ReserveResult = { ok: true; wait: number } | { ok: false; code: MarketplaceErrorCode };
export interface BudgetStatus {
  remaining: number;
  halted: MarketplaceErrorCode | null;
  haltedUntil: number | null;
}
export type PageResult = { item: PageItem | null; isItemPage: boolean };

export interface AutoRunResult {
  ok: boolean;
  kind: 'FAV' | 'OFFERS';
  dryRun: boolean;
  done: number;
  skipped: number;
  failed: number;
  /** Why the run stopped early (budget, block, not logged in…), if it did. */
  stopped: string | null;
}

/** What the workshop sheet hands over to create a Vinted draft. */
export interface DraftInput {
  itemId: string;
  title: string;
  description: string;
  priceCents: number;
  brand: string;
  size: string | null;
  condition: import('@/domain/entities').Condition | null;
  packageSize: 'SMALL' | 'MEDIUM' | 'LARGE';
}

export type DraftResult =
  | { ok: true; draftId: string; filled: string[]; missing: string[] }
  | { ok: false; code: MarketplaceErrorCode; detail?: string };

export type LabelResult = { ok: true; url: string; ordered: boolean } | { ok: false; code: MarketplaceErrorCode; detail?: string };
export type HideResult = { ok: true; verified: boolean | null } | { ok: false; code: MarketplaceErrorCode; detail?: string };
