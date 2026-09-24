/**
 * Defensive parsers for Vinted JSON. Field names come ONLY from the verified API map
 * (wardrobe, catalog/items, my_orders, users/current, item page JSON-LD). Anything else is read
 * optionally and may be null — never assumed.
 */
import type { Condition, MarketCandidate } from '@/domain/entities';
import type { InventorySnapshotItem } from '../marketplace';

type Json = Record<string, unknown>;
const isObj = (x: unknown): x is Json => typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (x: unknown): string | null => (typeof x === 'string' && x.trim() !== '' ? x : typeof x === 'number' ? String(x) : null);
const int = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x) : typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x)) ? Math.round(Number(x)) : null);

/** Price may arrive as a number, a decimal string, or an {amount} object. */
export function priceCents(x: unknown): number | null {
  if (isObj(x)) return priceCents(x.amount);
  if (typeof x === 'number' && Number.isFinite(x)) return Math.round(x * 100);
  if (typeof x === 'string') {
    const n = Number(x.replace(',', '.').replace(/[^\d.]/g, ''));
    return Number.isFinite(n) && x.trim() !== '' ? Math.round(n * 100) : null;
  }
  return null;
}

/** Status ids from GET /api/v2/statuses (verified): 6, 1, 2, 3, 4. Labels as displayed in French. */
const STATUS_ID: Record<number, Condition> = { 6: 'NEW_WITH_TAGS', 1: 'NEW_WITHOUT_TAGS', 2: 'VERY_GOOD', 3: 'GOOD', 4: 'SATISFACTORY' };
export function conditionOf(label: unknown, id?: unknown): Condition | null {
  const n = int(id);
  if (n !== null && STATUS_ID[n]) return STATUS_ID[n]!;
  const s = str(label)?.toLowerCase() ?? '';
  if (s.includes('avec étiquette') || s.includes('avec etiquette')) return 'NEW_WITH_TAGS';
  if (s.includes('neuf')) return 'NEW_WITHOUT_TAGS';
  if (s.includes('très bon') || s.includes('tres bon')) return 'VERY_GOOD';
  if (s.includes('bon')) return 'GOOD';
  if (s.includes('satisf')) return 'SATISFACTORY';
  return null;
}

/** The array payload of a list endpoint, whatever its top-level key. */
export function firstArray(json: unknown, preferred: string[]): Json[] {
  if (Array.isArray(json)) return json.filter(isObj);
  if (!isObj(json)) return [];
  for (const k of preferred) if (Array.isArray(json[k])) return (json[k] as unknown[]).filter(isObj);
  for (const v of Object.values(json)) if (Array.isArray(v) && v.some(isObj)) return (v as unknown[]).filter(isObj);
  return [];
}

function firstPhoto(it: Json): { url: string | null; ts: number | null } {
  const photos = Array.isArray(it.photos) ? it.photos.filter(isObj) : isObj(it.photo) ? [it.photo] : [];
  const p = photos.find((x) => x.is_main === true) ?? photos[0];
  if (!p) return { url: null, ts: null };
  const hr = isObj(p.high_resolution) ? p.high_resolution : null;
  const ts = int(hr?.timestamp);
  // timestamp is seconds since epoch; a repost resets it (INFERRED "age since last publication").
  return { url: str(p.url), ts: ts === null ? null : ts < 1e12 ? ts * 1000 : ts };
}

export function parseWardrobeItem(it: Json): InventorySnapshotItem | null {
  const id = str(it.id);
  const title = str(it.title);
  const price = priceCents(it.price);
  if (!id || !title || price === null) return null;
  const photo = firstPhoto(it);
  const closed = it.is_closed === true;
  const hidden = it.is_hidden === true;
  return {
    platformListingId: id,
    url: str(it.url) ?? `https://www.vinted.fr/items/${id}`,
    title,
    brand: str(it.brand_title),
    size: str(it.size_title),
    condition: conditionOf(it.status, it.status_id),
    priceCents: price,
    views: int(it.view_count),
    favorites: int(it.favourite_count),
    photoUrl: photo.url,
    listedAt: photo.ts,
    status: closed ? 'SOLD' : hidden || it.is_draft === true ? 'REMOVED' : 'ACTIVE',
  };
}

export function isDraft(it: Json): boolean {
  return it.is_draft === true;
}

export function parseCatalogItem(it: Json): MarketCandidate | null {
  const id = str(it.id);
  const title = str(it.title);
  const price = priceCents(it.price);
  if (!id || !title || price === null) return null;
  const user = isObj(it.user) ? it.user : null;
  return {
    id,
    title,
    brand: str(it.brand_title),
    priceCents: price,
    size: str(it.size_title),
    condition: conditionOf(it.status, it.status_id),
    category: null,
    gender: null,
    url: str(it.url),
    photoUrl: firstPhoto(it).url,
    // Not in the verified map for catalog results: read if present, else unknown.
    favorites: int(it.favourite_count),
    listedAt: firstPhoto(it).ts,
    promoted: it.promoted === true,
    sellerId: str(user?.id),
  };
}

export function parseTotalEntries(json: unknown): { total: number | null; capped: boolean } {
  const pag = isObj(json) && isObj(json.pagination) ? json.pagination : null;
  const total = int(pag?.total_entries);
  // Vinted caps totals at 40 pages × 24: a value of 960 means "≥ 960".
  return { total, capped: total !== null && total >= 960 };
}

export interface SoldOrder {
  title: string;
  priceCents: number;
  /** A calendar date — compare as UTC dates, never as instants. */
  date: number | null;
  status: string | null;
}

export function parseOrder(o: Json): SoldOrder | null {
  const title = str(o.title);
  const price = priceCents(o.price);
  if (!title || price === null) return null;
  const d = str(o.date);
  const t = d ? Date.parse(d) : Number.NaN;
  return { title, priceCents: price, date: Number.isNaN(t) ? null : t, status: str(o.status) };
}

export function currentUserId(json: unknown): string | null {
  const u = isObj(json) && isObj(json.user) ? json.user : json;
  return isObj(u) ? str(u.id) : null;
}

/** Item page context from schema.org JSON-LD — read from the open page, zero network calls. */
export interface PageItem {
  platformListingId: string | null;
  url: string;
  title: string;
  brand: string | null;
  priceCents: number | null;
  condition: Condition | null;
  photoUrl: string | null;
}

export function parseItemJsonLd(blocks: unknown[], url: string): PageItem | null {
  const all = blocks.flatMap((b) => (Array.isArray(b) ? b : isObj(b) && Array.isArray(b['@graph']) ? (b['@graph'] as unknown[]) : [b]));
  const product = all.find((b) => isObj(b) && (b['@type'] === 'Product' || (Array.isArray(b['@type']) && (b['@type'] as unknown[]).includes('Product')))) as Json | undefined;
  if (!product) return null;
  const title = str(product.name);
  if (!title) return null;
  const offers = Array.isArray(product.offers) ? (product.offers.find(isObj) as Json | undefined) : isObj(product.offers) ? product.offers : undefined;
  const brand = isObj(product.brand) ? str(product.brand.name) : str(product.brand);
  const cond = str(offers?.itemCondition ?? product.itemCondition) ?? '';
  const condition: Condition | null = /NewCondition/i.test(cond) ? 'NEW_WITHOUT_TAGS' : null;
  const image = Array.isArray(product.image) ? str(product.image[0]) : str(product.image);
  const m = url.match(/\/items\/(\d+)/);
  return { platformListingId: m?.[1] ?? null, url, title, brand, priceCents: priceCents(offers?.price), condition, photoUrl: image };
}
