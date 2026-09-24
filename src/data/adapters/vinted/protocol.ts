import type { MarketplaceErrorCode } from '../marketplace';
import type { PageItem } from './parse';

/** Read-only GET paths ERA may call. Anything else is refused by the content script. */
export const ALLOWED_API = ['/api/v2/users/current', '/api/v2/wardrobe/', '/api/v2/catalog/items', '/api/v2/my_orders'];

export type EraMessage =
  | { type: 'era:ping' }
  | { type: 'era:page' }
  | { type: 'era:api'; path: string }
  | { type: 'era:budget:reserve' }
  | { type: 'era:budget:report'; status: number }
  | { type: 'era:budget:status' }
  | { type: 'era:import' }
  | { type: 'era:import:stage'; stage: ImportStage };

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
