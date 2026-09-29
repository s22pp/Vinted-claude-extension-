import { LATE_DAYS, type ParcelStage, parcelStage } from './parcels';
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
  return `${LABEL_FOLDER}/${new Date(soldAt).toISOString().slice(0, 10)}_${fileSlug(title)}.pdf`;
}

/** A title as a file name part: plain letters, digits and dashes, 60 characters at most. */
export function fileSlug(title: string): string {
  return (
    title
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/, '') || 'commande'
  );
}

/* ── Parcels on their way ───────────────────────────────── */

export type ParcelState = 'SHIPPED' | 'AT_PICKUP' | 'DELIVERED';

export interface ParcelAlert {
  saleId: string;
  state: ParcelState;
  /** Days in this state: since ERA saw the status appear, else since the sale (a lower bound). */
  days: number;
  since: 'STATUS' | 'SALE';
}

const ALERT_STATE: Partial<Record<ParcelStage, ParcelState>> = { SENT: 'SHIPPED', IN_TRANSIT: 'SHIPPED', AT_PICKUP: 'AT_PICKUP', DELIVERED: 'DELIVERED' };

/**
 * Sales whose parcel seems stuck, read from Vinted's own status words (UNVERIFIED wording) with the same reading
 * and the same delays as the Colis screen: sent or on its way for too long, waiting at the pickup point without
 * the buyer collecting it, delivered and still not completed.
 */
export function parcelAlerts(
  sales: readonly { id: string; status: string; soldAt: number; vintedStatus?: string | null; vintedStatusSince?: number | null; needsAction?: boolean }[],
  now: number,
): ParcelAlert[] {
  const out: ParcelAlert[] = [];
  for (const s of sales) {
    if (s.status === 'REFUNDED' || s.needsAction || !s.vintedStatus) continue;
    const stage = parcelStage(s.vintedStatus);
    const state = ALERT_STATE[stage];
    const limit = LATE_DAYS[stage]?.OUT;
    if (!state || limit === undefined) continue;
    const from = s.vintedStatusSince ?? s.soldAt;
    const days = Math.floor((now - from) / 86_400_000);
    if (days >= limit) out.push({ saleId: s.id, state, days, since: s.vintedStatusSince ? 'STATUS' : 'SALE' });
  }
  return out.sort((a, b) => b.days - a.days);
}

/* ── Photos of your listings ────────────────────────────── */

export const PHOTO_FOLDER = 'ERA-photos';

/** "ERA-photos/chemise-oxford-ralph-lauren-l_4242/01.jpg": one folder per listing, photos in their order. */
export function photoFileName(title: string, listingId: string, index: number, url: string): string {
  const slug = fileSlug(title);
  const ext = /\.(png|webp|jpe?g)(?:$|\?)/i.exec(url)?.[1]?.toLowerCase().replace('jpeg', 'jpg') ?? 'jpg';
  return `${PHOTO_FOLDER}/${slug}_${listingId}/${String(index + 1).padStart(2, '0')}.${ext}`;
}
