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

/* ── Parcels on their way ───────────────────────────────── */

export type ParcelState = 'SHIPPED' | 'DELIVERED';

export interface ParcelAlert {
  saleId: string;
  state: ParcelState;
  /** Days in this state: since ERA saw the status appear, else since the sale (a lower bound). */
  days: number;
  since: 'STATUS' | 'SALE';
}

/**
 * Sales whose parcel seems stuck, read from Vinted's own status words (UNVERIFIED wording): sent and still not
 * delivered after `shippedDays`, delivered and still not completed after `deliveredDays`.
 */
export function parcelAlerts(
  sales: readonly { id: string; status: string; soldAt: number; vintedStatus?: string | null; vintedStatusSince?: number | null; needsAction?: boolean }[],
  now: number,
  o = { shippedDays: 7, deliveredDays: 3 },
): ParcelAlert[] {
  const out: ParcelAlert[] = [];
  for (const s of sales) {
    if (s.status === 'REFUNDED' || s.needsAction || !s.vintedStatus) continue;
    const st = s.vintedStatus.toLowerCase();
    if (/termin|complet|finalis|annul|rembours/.test(st)) continue;
    const state: ParcelState | null = /livr|delivered|récupér|recuper/.test(st) ? 'DELIVERED' : /envoy|expédi|expedi|en route|transit|shipped|en cours de livraison|déposé|depose/.test(st) ? 'SHIPPED' : null;
    if (!state) continue;
    const from = s.vintedStatusSince ?? s.soldAt;
    const days = Math.floor((now - from) / 86_400_000);
    if (days >= (state === 'SHIPPED' ? o.shippedDays : o.deliveredDays)) out.push({ saleId: s.id, state, days, since: s.vintedStatusSince ? 'STATUS' : 'SALE' });
  }
  return out.sort((a, b) => b.days - a.days);
}
