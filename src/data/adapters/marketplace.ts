import type { Category, Condition, Gender, MarketCandidate } from '@/domain/entities';
import type { SnapshotStatus } from '@/domain/status';

export interface ComparableQuery {
  /** Free text sent to the marketplace. Brand + model/type — never a colour (colours don't narrow a market). */
  text: string;
  brand: string;
  category: Category | null;
  gender: Gender | null;
  size: string | null;
  condition: Condition | null;
}

export interface SearchResult {
  candidates: MarketCandidate[];
  /** Total announced by the marketplace. Vinted caps it (40 pages × 24 = 960): a capped value reads "≥ 960". */
  totalEntries: number | null;
  totalCapped: boolean;
  fetchedAt: number;
}

export interface InventorySnapshotItem {
  platformListingId: string;
  url: string | null;
  title: string;
  brand: string | null;
  size: string | null;
  condition: Condition | null;
  priceCents: number;
  views: number | null;
  favorites: number | null;
  photoUrl: string | null;
  listedAt: number | null;
  status: SnapshotStatus;
  /** false when the marketplace response carried no reservation flag: "not reserved" is then unknown. */
  reservedKnown: boolean;
}

export interface ListingObservationSnapshot {
  at: number;
  priceCents: number;
  views: number | null;
  favorites: number | null;
}

export type MarketplaceErrorCode = 'NETWORK_403' | 'RATE_LIMITED' | 'BUDGET_EXHAUSTED' | 'UNAVAILABLE' | 'NOT_IMPLEMENTED' | 'NOT_LOGGED_IN' | 'NO_VINTED_TAB';

export class MarketplaceError extends Error {
  constructor(
    readonly code: MarketplaceErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = 'MarketplaceError';
  }
}

export function errorCode(e: unknown): MarketplaceErrorCode {
  return e instanceof MarketplaceError ? e.code : 'UNAVAILABLE';
}

/** Code for the UI + the technical cause (HTTP status, path) for the "details" disclosure. */
export function errorInfo(e: unknown): { code: MarketplaceErrorCode; detail: string | null } {
  if (e instanceof MarketplaceError) return { code: e.code, detail: e.message !== e.code ? e.message : null };
  if (typeof e === 'object' && e !== null && 'code' in e) {
    const x = e as { code: MarketplaceErrorCode; detail?: string };
    return { code: x.code, detail: x.detail ?? null };
  }
  return { code: 'UNAVAILABLE', detail: e instanceof Error ? e.message : typeof e === 'string' ? e : null };
}

/**
 * Boundary between ERA and a marketplace. ERA's engines only ever see normalized data.
 * Implementations must be read-only: ERA decides, it never posts, reposts or messages.
 */
export interface MarketplaceAdapter {
  readonly id: 'demo' | 'vinted';
  /** Demo adapters produce fixtures that must be labelled as such in the UI. */
  readonly isDemo: boolean;
  getInventory(): Promise<InventorySnapshotItem[]>;
  getListing(platformListingId: string): Promise<InventorySnapshotItem | null>;
  getListingObservations(platformListingId: string): Promise<ListingObservationSnapshot[]>;
  searchComparables(query: ComparableQuery): Promise<SearchResult>;
}

/**
 * Request budget that any network adapter MUST go through.
 * Numbers come from real account blocks: 60 calls / session, 12 / minute, ≥1.2 s spacing.
 * A 403 or 429 halts everything for the session — no retry, no workaround.
 */
export class RequestBudget {
  private calls: number[] = [];
  private total = 0;
  private haltedCode: MarketplaceErrorCode | null = null;

  constructor(
    private readonly limits = { perSession: 60, perMinute: 12, minSpacingMs: 1200 },
    private readonly now: () => number = Date.now,
  ) {}

  get halted(): MarketplaceErrorCode | null {
    return this.haltedCode;
  }

  get remaining(): number {
    return Math.max(0, this.limits.perSession - this.total);
  }

  /** Returns ms to wait before the next call is allowed, or throws if the budget is exhausted / halted. */
  reserve(): number {
    if (this.haltedCode) throw new MarketplaceError(this.haltedCode);
    if (this.total >= this.limits.perSession) throw new MarketplaceError('BUDGET_EXHAUSTED');
    const t = this.now();
    this.calls = this.calls.filter((c) => t - c < 60_000);
    let wait = 0;
    const last = this.calls[this.calls.length - 1];
    if (last !== undefined) wait = Math.max(wait, last + this.limits.minSpacingMs - t);
    if (this.calls.length >= this.limits.perMinute) {
      const oldest = this.calls[this.calls.length - this.limits.perMinute]!;
      wait = Math.max(wait, oldest + 60_000 - t);
    }
    this.calls.push(t + wait);
    this.total++;
    return wait;
  }

  report(status: number): void {
    if (status === 403) this.haltedCode = 'NETWORK_403';
    else if (status === 429) this.haltedCode = 'RATE_LIMITED';
  }

  /** Serialisable state, so the budget survives a service-worker restart. */
  toJSON(): { calls: number[]; total: number; halted: MarketplaceErrorCode | null } {
    return { calls: this.calls, total: this.total, halted: this.haltedCode };
  }

  static fromJSON(
    s: { calls: number[]; total: number; halted: MarketplaceErrorCode | null } | undefined,
    now: () => number = Date.now,
  ): RequestBudget {
    const b = new RequestBudget(undefined, now);
    if (s) {
      b.calls = s.calls;
      b.total = s.total;
      b.haltedCode = s.halted;
    }
    return b;
  }
}

/** After a block, stay silent for hours: "it works again" does not mean the flag is lifted. */
export const HALT_COOLDOWN_MS = 6 * 3600_000;
