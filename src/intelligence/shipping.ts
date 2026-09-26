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

/** Folder, under the browser's downloads, where ERA saves the labels Vinted issues. */
export const LABEL_FOLDER = 'ERA-bordereaux';

/**
 * The file name of a label: sale date then the article, readable and safe on every system
 * ("ERA-bordereaux/2026-09-20_sweat-nike-vintage-l.pdf"). Two identical names are numbered by the browser.
 */
export function labelFileName(title: string, soldAt: number): string {
  const day = new Date(soldAt).toISOString().slice(0, 10);
  const slug =
    title
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/, '') || 'commande';
  return `${LABEL_FOLDER}/${day}_${slug}.pdf`;
}
