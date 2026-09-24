import type { MarketplaceErrorCode } from '../marketplace';
import type { PageItem } from './parse';

/** Read-only GET paths ERA may call. Anything else is refused by the content script. */
export const ALLOWED_API = ['/api/v2/users/current', '/api/v2/wardrobe/', '/api/v2/catalog/items', '/api/v2/my_orders', '/api/v2/item_upload/items/'];

/** A search endpoint observed on Vinted's own search page is allowed too: GET, /api/, with a search_text param. */
export function isAllowedApi(path: string): boolean {
  return ALLOWED_API.some((p) => path.startsWith(p)) || (path.startsWith('/api/') && /[?&]search_text=/.test(path));
}

export type EraMessage =
  | { type: 'era:ping' }
  | { type: 'era:page' }
  | { type: 'era:api'; path: string }
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
export type ImportResult = { ok: true; items: number; updated: number; sales: number } | { ok: false; code: MarketplaceErrorCode; detail?: string };

export type ApiResult = { ok: true; json: unknown } | { ok: false; code: MarketplaceErrorCode; status?: number; detail?: string };
export type ReserveResult = { ok: true; wait: number } | { ok: false; code: MarketplaceErrorCode };
export interface BudgetStatus {
  remaining: number;
  halted: MarketplaceErrorCode | null;
  haltedUntil: number | null;
}
export type PageResult = { item: PageItem | null; isItemPage: boolean };
