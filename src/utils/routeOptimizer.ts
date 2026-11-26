/**
 * The drop-off round: the parcels « À envoyer », grouped by carrier and by the seller's favourite drop-off point, the
 * stops ordered by nearest neighbour from home (Haversine), the loop's distance, and the official Google Maps URLs
 * (Directions and Search: no API key, nothing sent by ERA — the seller's click opens Google Maps). Pure.
 */

export const CARRIERS = ['Mondial Relay', 'Vinted Go', 'Chronopost', 'Colissimo', 'Relais Colis', 'UPS', 'Autre'] as const;
export type Carrier = (typeof CARRIERS)[number];

export interface DropOffPoint {
  id: string;
  carrier: Carrier;
  name: string;
  address: string;
  lat?: number;
  lng?: number;
  hours?: string;
}

export interface LatLng {
  lat: number;
  lng: number;
}

export type TravelMode = 'driving' | 'walking';

/** Google Maps shows at most this many intermediate stops in a Directions URL. */
export const MAX_WAYPOINTS = 9;

/** The carrier a status or tracking text names (« Mondial Relay », « mondialrelay », « Vinted Go »…), else null. */
export function carrierOf(text: string | null | undefined): Carrier | null {
  const s = (text ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (!s.trim()) return null;
  if (/mondial\s*-?\s*relay/.test(s)) return 'Mondial Relay';
  if (/vinted\s*-?\s*go/.test(s)) return 'Vinted Go';
  if (/chrono\s*-?\s*post/.test(s)) return 'Chronopost';
  if (/colissimo|la\s*poste/.test(s)) return 'Colissimo';
  if (/relais\s*colis/.test(s)) return 'Relais Colis';
  if (/\bups\b/.test(s)) return 'UPS';
  return null;
}

const R = 6371;
const rad = (d: number) => (d * Math.PI) / 180;
/** Great-circle distance in km. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const located = (p: Partial<LatLng> | null | undefined): p is LatLng => !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng);

export interface ParcelToDrop {
  saleId: string;
  title: string;
  /** null: the carrier is not known yet (the seller chooses it). */
  carrier: Carrier | null;
  storageLocation?: string | null;
}

export interface Stop {
  key: string;
  carrier: Carrier | null;
  /** The favourite point for this carrier (the one the seller chose, else the first saved), null when none is saved. */
  point: DropOffPoint | null;
  parcels: ParcelToDrop[];
}

/**
 * One stop per carrier: its favourite point (`chosen[carrier]` when the seller picked one among several), the parcels
 * to drop there. Parcels whose carrier is unknown form their own group (no point: the seller assigns a carrier).
 */
export function groupByStop(parcels: readonly ParcelToDrop[], points: readonly DropOffPoint[], chosen: Partial<Record<Carrier, string>> = {}): Stop[] {
  const byCarrier = new Map<string, ParcelToDrop[]>();
  for (const p of parcels) {
    const k = p.carrier ?? '?';
    byCarrier.set(k, [...(byCarrier.get(k) ?? []), p]);
  }
  return [...byCarrier.entries()].map(([k, list]) => {
    const carrier = k === '?' ? null : (k as Carrier);
    const mine = carrier ? points.filter((x) => x.carrier === carrier) : [];
    const point = (carrier && mine.find((x) => x.id === chosen[carrier])) ?? mine[0] ?? null;
    return { key: carrier ? `${carrier}:${point?.id ?? '-'}` : '?', carrier, point, parcels: list };
  });
}

export interface Round {
  /** The stops in visiting order: located ones by nearest neighbour from home, then the others as they came. */
  stops: Stop[];
  /** Home → stops → home over the located stops, in km; null when home or no stop is located. */
  km: number | null;
}

/** Nearest neighbour from home over the stops whose point has coordinates; the loop closes at home. */
export function orderStops(home: LatLng | null, stops: readonly Stop[]): Round {
  const withPlace = stops.filter((s) => located(s.point));
  const without = stops.filter((s) => !located(s.point));
  if (!located(home) || withPlace.length === 0) return { stops: [...withPlace, ...without], km: null };
  const left = [...withPlace];
  const ordered: Stop[] = [];
  let here: LatLng = home;
  let km = 0;
  while (left.length) {
    let best = 0;
    for (let i = 1; i < left.length; i++) if (haversineKm(here, left[i]!.point as LatLng) < haversineKm(here, left[best]!.point as LatLng)) best = i;
    const next = left.splice(best, 1)[0]!;
    km += haversineKm(here, next.point as LatLng);
    here = next.point as LatLng;
    ordered.push(next);
  }
  km += haversineKm(here, home);
  return { stops: [...ordered, ...without], km: Math.round(km * 10) / 10 };
}

/** A place as Google Maps reads it: its coordinates when known (exact), else its address. */
export const placeParam = (p: { lat?: number; lng?: number; address?: string }): string => (located(p) ? `${p.lat},${p.lng}` : (p.address ?? '').trim());

/**
 * The official Directions URL (maps/dir/?api=1): from home back to home through the stops, in order, by car or on foot.
 * Each value URL-encoded, the waypoints joined by « | » (%7C); at most 9 waypoints (Google Maps' own limit).
 */
export function mapsDirectionsUrl(origin: string, waypoints: readonly string[], mode: TravelMode, destination = origin): string {
  const w = waypoints.filter((x) => x.trim()).slice(0, MAX_WAYPOINTS);
  const q = [`api=1`, `origin=${encodeURIComponent(origin)}`, `destination=${encodeURIComponent(destination)}`, ...(w.length ? [`waypoints=${w.map(encodeURIComponent).join('%7C')}`] : []), `travelmode=${mode}`];
  return `https://www.google.com/maps/dir/?${q.join('&')}`;
}

/** « Trouver sur Google Maps »: the carrier's open relay points around home. */
export function mapsSearchUrl(carrier: Carrier, home: LatLng | null): string {
  const what = `${carrier} point relais ouvert`.replace(/\s+/g, '+');
  return `https://www.google.com/maps/search/${what}${located(home) ? `/@${home.lat},${home.lng},14z` : ''}`;
}

/** « 46.0345, 4.0721 » as copied from Google Maps (right click on a place) → coordinates; anything else → null. */
export function parseLatLng(text: string): LatLng | null {
  const m = /^\s*(-?\d{1,2}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/.exec(text);
  if (!m) return null;
  const lat = Number(m[1]!.replace(',', '.'));
  const lng = Number(m[2]!.replace(',', '.'));
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}
