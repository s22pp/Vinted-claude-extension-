import type { ItemStatus, ListingStatus } from './entities';
import type { FieldMeta, Provenance } from './provenance';

/** Statuses where the article is still owned: capital is still invested. */
export const IN_STOCK: readonly ItemStatus[] = ['DRAFT', 'LISTED', 'RESERVED', 'HIDDEN'];
/** Listing statuses that still describe the live announcement (price, views, favourites). */
export const LIVE_LISTING: readonly ListingStatus[] = ['ACTIVE', 'RESERVED', 'HIDDEN'];

export const isInStock = (s: ItemStatus) => IN_STOCK.includes(s);
export const isLiveListing = (s: ListingStatus) => LIVE_LISTING.includes(s);

/** Status of a listing as read from the marketplace. */
export type SnapshotStatus = 'ACTIVE' | 'RESERVED' | 'HIDDEN' | 'DRAFT' | 'SOLD' | 'REMOVED';

export function listingStatusOf(item: ItemStatus): ListingStatus {
  switch (item) {
    case 'RESERVED':
      return 'RESERVED';
    case 'HIDDEN':
      return 'HIDDEN';
    case 'SOLD':
      return 'SOLD';
    case 'LISTED':
      return 'ACTIVE';
    default:
      return 'REMOVED';
  }
}

/**
 * Item status after an import. What Vinted says wins, with one exception: when Vinted does not expose
 * the reservation flag (`reservedKnown` false), a reservation the seller marked by hand is kept.
 */
export function resolveImportedStatus(
  prev: { status: ItemStatus; meta: Record<string, FieldMeta | undefined> } | null,
  snap: SnapshotStatus,
  reservedKnown: boolean,
): { status: ItemStatus; p: Provenance } {
  switch (snap) {
    case 'SOLD':
      return { status: 'SOLD', p: 'OBSERVED' };
    case 'RESERVED':
      return { status: 'RESERVED', p: 'OBSERVED' };
    case 'HIDDEN':
      return { status: 'HIDDEN', p: 'OBSERVED' };
    case 'DRAFT':
      return { status: 'DRAFT', p: 'OBSERVED' };
    case 'REMOVED':
      return { status: prev?.status === 'SOLD' ? 'SOLD' : 'ARCHIVED', p: 'OBSERVED' };
    case 'ACTIVE':
      if (!reservedKnown && prev?.status === 'RESERVED' && prev.meta.status?.p === 'USER_PROVIDED') return { status: 'RESERVED', p: 'USER_PROVIDED' };
      return { status: 'LISTED', p: 'OBSERVED' };
  }
}
