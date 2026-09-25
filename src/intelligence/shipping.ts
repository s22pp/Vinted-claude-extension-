import type { RefundGuard } from './refunds';

/**
 * Before closing the parcel: what to check, from the refunds the seller already had. Always the basics; then,
 * for each reason buyers were refunded, the check that would have prevented it. Nothing sent anywhere.
 */
export type ShipCheck = 'MATCHES_LISTING' | 'PHOTO_BEFORE' | 'DEFECTS_SHOWN' | 'MEASURES' | 'LABELS_VISIBLE' | 'PROTECTED' | 'PACKAGE_SIZE' | 'OLD_BARCODE';

const BASE: ShipCheck[] = ['MATCHES_LISTING', 'PHOTO_BEFORE', 'PACKAGE_SIZE', 'OLD_BARCODE'];

const FROM_GUARD: Record<RefundGuard, ShipCheck | null> = {
  DEFECT_PHOTOS: 'DEFECTS_SHOWN',
  CONDITION_DETAIL: 'DEFECTS_SHOWN',
  MEASURES_REQUIRED: 'MEASURES',
  AUTH_PHOTOS: 'LABELS_VISIBLE',
  PACKAGING: 'PROTECTED',
  DESCRIPTION_CHECK: null, // already MATCHES_LISTING
};

/** The checks for one parcel; `learned` are those added because of past refunds (shown as such). */
export function shippingChecklist(guards: readonly RefundGuard[]): { checks: ShipCheck[]; learned: ShipCheck[] } {
  const learned = [...new Set(guards.map((g) => FROM_GUARD[g]).filter((c): c is ShipCheck => c !== null))];
  return { checks: [...BASE.slice(0, 2), ...learned, ...BASE.slice(2)], learned };
}
