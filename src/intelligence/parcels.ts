/**
 * Parcels on their way — to the seller (purchases) and from the seller (sales) — read from what ERA really has:
 * Vinted's own status words (UNVERIFIED wording), the day each status appeared, and, when the seller asks for it,
 * the places Vinted's order data gives (a pickup point, a destination) with their coordinates. ERA never guesses
 * where a parcel is: no position without coordinates from Vinted, no dot moving along a made-up route.
 */

export type ParcelStage = 'TO_SHIP' | 'SENT' | 'IN_TRANSIT' | 'AT_PICKUP' | 'DELIVERED' | 'DONE' | 'CANCELLED' | 'UNKNOWN';
/** The steps shown as a progress line, in order. */
export const PARCEL_STEPS: ParcelStage[] = ['TO_SHIP', 'SENT', 'IN_TRANSIT', 'AT_PICKUP', 'DELIVERED'];

/** The step a Vinted status text describes. Most specific words first ("en cours de livraison" is not delivered). */
export function parcelStage(status: string | null | undefined, needsAction = false): ParcelStage {
  if (needsAction) return 'TO_SHIP';
  if (!status) return 'UNKNOWN';
  const s = status.toLowerCase();
  if (/annul|rembours|cancel|refund/.test(s)) return 'CANCELLED';
  if (/termin|complet|finalis|completed/.test(s)) return 'DONE';
  if (/en cours de livraison|en transit|transit|en route|achemin|out for delivery/.test(s)) return 'IN_TRANSIT';
  if (/point relais|disponible|à retirer|a retirer|à récupérer|a recuperer|pick.?up|locker|consigne/.test(s)) return 'AT_PICKUP';
  if (/livr|delivered|récupér|recuper/.test(s)) return 'DELIVERED';
  if (/envoy|expédi|expedi|déposé|depose|pris en charge|shipped|sent/.test(s)) return 'SENT';
  if (/bordereau|à envoyer|a envoyer|attente d.envoi|en attente|paiement|payé|paye/.test(s)) return 'TO_SHIP';
  return 'UNKNOWN';
}

export interface Parcel {
  key: string;
  direction: 'IN' | 'OUT';
  /** The sale or purchase it belongs to. */
  refId: string;
  title: string;
  status: string | null;
  stage: ParcelStage;
  /** Days at this step: since ERA saw the status appear, else since the order (a lower bound). */
  days: number | null;
  sinceStatus: boolean;
  late: boolean;
  conversationId: string | null;
}

interface SaleLike {
  id: string;
  title: string;
  status: string;
  soldAt: number;
  vintedStatus?: string | null;
  vintedStatusSince?: number | null;
  needsAction?: boolean;
  vintedConversationId?: string | null;
}
interface PurchaseLike {
  id: string;
  title: string;
  date: number | null;
  status: string | null;
  statusSince?: number | null;
  conversationId?: string | null;
  dismissed?: boolean;
}

/** After this many days at a step, the parcel is flagged (the seller should look at the conversation). */
const LATE_DAYS: Partial<Record<ParcelStage, { IN: number; OUT: number }>> = {
  TO_SHIP: { IN: 5, OUT: 2 },
  SENT: { IN: 7, OUT: 7 },
  IN_TRANSIT: { IN: 7, OUT: 7 },
  // A parcel waiting at a pickup point goes back after a while: collect it (IN); the buyer has not (OUT).
  AT_PICKUP: { IN: 4, OUT: 5 },
  DELIVERED: { IN: 3, OUT: 3 },
};

const DAY = 86_400_000;

export function parcelsInProgress(sales: readonly SaleLike[], purchases: readonly PurchaseLike[], now: number): Parcel[] {
  const out: Parcel[] = [];
  const push = (p: Omit<Parcel, 'days' | 'late' | 'sinceStatus'>, since: number | null, orderAt: number | null) => {
    if (p.stage === 'DONE' || p.stage === 'CANCELLED' || p.stage === 'UNKNOWN') return;
    const from = since ?? orderAt;
    const days = from === null ? null : Math.max(0, Math.floor((now - from) / DAY));
    const limit = LATE_DAYS[p.stage]?.[p.direction];
    out.push({ ...p, days, sinceStatus: since !== null, late: days !== null && limit !== undefined && days >= limit });
  };
  for (const s of sales) {
    if (s.status === 'REFUNDED') continue;
    push(
      { key: `out:${s.id}`, direction: 'OUT', refId: s.id, title: s.title, status: s.vintedStatus ?? null, stage: parcelStage(s.vintedStatus, !!s.needsAction), conversationId: s.vintedConversationId ?? null },
      s.vintedStatusSince ?? null,
      s.soldAt,
    );
  }
  for (const p of purchases) {
    if (p.dismissed) continue;
    push({ key: `in:${p.id}`, direction: 'IN', refId: p.id, title: p.title, status: p.status, stage: parcelStage(p.status), conversationId: p.conversationId ?? null }, p.statusSince ?? null, p.date);
  }
  const order = (x: Parcel) => (x.late ? 0 : 1) * 10 + PARCEL_STEPS.indexOf(x.stage);
  return out.sort((a, b) => order(a) - order(b) || (b.days ?? 0) - (a.days ?? 0));
}

/* ── Places given by Vinted ─────────────────────────────── */

export interface Place {
  lat: number;
  lng: number;
  label: string;
}
export interface ParcelPoint extends Place {
  /** PICKUP: a pickup point / locker; ADDRESS: a delivery address; OTHER: a place without more context. */
  kind: 'PICKUP' | 'ADDRESS' | 'OTHER';
}

type Json = Record<string, unknown>;
const isObj = (x: unknown): x is Json => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : typeof x === 'string' && /^-?\d+(\.\d+)?$/.test(x.trim()) ? Number(x) : null);
const text = (x: unknown): string | null => (typeof x === 'string' && x.trim() ? x.trim() : null);

/**
 * Every place with coordinates in a piece of Vinted's order data (read-only), wherever it sits: an object carrying
 * latitude/longitude (or lat/lng/lon). Its label is built from the fields next to it. Nothing found = nothing shown.
 */
export function pointsIn(json: unknown, depth = 8): ParcelPoint[] {
  const out: ParcelPoint[] = [];
  const seen = new Set<string>();
  const walk = (x: unknown, path: string, d: number) => {
    if (d < 0) return;
    if (Array.isArray(x)) return x.forEach((y, i) => walk(y, `${path}[${i}]`, d - 1));
    if (!isObj(x)) return;
    const lat = num(x.latitude ?? x.lat);
    const lng = num(x.longitude ?? x.lng ?? x.lon);
    if (lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)) {
      const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
      if (!seen.has(key)) {
        seen.add(key);
        const street = text(x.address_line) ?? text(x.line1) ?? text(x.address_line_1) ?? text(x.street) ?? text(x.address);
        const city = [text(x.postal_code) ?? text(x.zip) ?? text(x.postcode), text(x.city)].filter(Boolean).join(' ');
        const label = [text(x.name) ?? text(x.title), street, city || null].filter(Boolean).join(' · ') || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        const p = path.toLowerCase();
        out.push({ lat, lng, label, kind: /pick.?up|point|locker|relay|relais|drop/.test(p) ? 'PICKUP' : /address|adresse|destination|to_/.test(p) ? 'ADDRESS' : 'OTHER' });
      }
    }
    for (const [k, v] of Object.entries(x)) if (typeof v === 'object' && v !== null) walk(v, `${path}.${k}`, d - 1);
  };
  walk(json, '', depth);
  return out;
}

/** The carrier and tracking code, when the order data carries them (field names UNVERIFIED: read if present). */
export function trackingIn(json: unknown): { carrier: string | null; code: string | null; url: string | null } {
  let carrier: string | null = null;
  let code: string | null = null;
  let url: string | null = null;
  const walk = (x: unknown, d: number) => {
    if (d < 0 || !x || typeof x !== 'object') return;
    if (Array.isArray(x)) return x.forEach((y) => walk(y, d - 1));
    for (const [k, v] of Object.entries(x as Json)) {
      const key = k.toLowerCase();
      if (!code && /tracking_(code|number)|tracking_id/.test(key)) code = text(v);
      if (!url && /tracking_url/.test(key)) url = text(v)?.startsWith('https://') ? text(v) : null;
      if (!carrier && /^(carrier|carrier_name|carrier_title|transporter|shipping_carrier)$/.test(key)) carrier = text(v) ?? (isObj(v) ? (text(v.name) ?? text(v.title)) : null);
      if (typeof v === 'object') walk(v, d - 1);
    }
  };
  walk(json, 8);
  return { carrier, code, url };
}

/** Straight-line distance in km (haversine). */
export function distanceKm(a: Place | { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = (x: number) => (x * Math.PI) / 180;
  const dLat = r(b.lat - a.lat);
  const dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Home by default: Roanne (Loire), town centre. The seller can place it anywhere on the map. */
export const DEFAULT_HOME: Place = { lat: 46.0367, lng: 4.0683, label: 'Roanne' };
export const HOME_KEY = 'homePlace';
export const PARCEL_INFO_KEY = 'parcelInfo';

/** What "Localiser" found for one order (a conversation), kept locally. */
export interface ParcelInfo {
  at: number;
  points: ParcelPoint[];
  tracking: { carrier: string | null; code: string | null; url: string | null };
}
