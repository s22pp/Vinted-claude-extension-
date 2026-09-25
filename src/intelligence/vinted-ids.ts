import type { Condition } from '@/domain/entities';
import { normalizeText } from './normalize';
import type { PackageSize } from './workshop';

/**
 * From ERA's words to Vinted's ids, for a draft: pure pickers over the answers of Vinted's own upload helpers
 * (category suggestion, brand search, size groups, package sizes). Nothing is guessed: no match → null, and
 * the field is left for the seller to fill on Vinted.
 */

type Json = Record<string, unknown>;
const isObj = (x: unknown): x is Json => typeof x === 'object' && x !== null && !Array.isArray(x);
const idOf = (x: unknown): number | null => (typeof x === 'number' && Number.isInteger(x) && x > 0 ? x : typeof x === 'string' && /^\d+$/.test(x) ? Number(x) : null);

/** Condition → status_id (verified mapping, GET /api/v2/statuses). */
export const STATUS_ID_OF: Record<Condition, number> = { NEW_WITH_TAGS: 6, NEW_WITHOUT_TAGS: 1, VERY_GOOD: 2, GOOD: 3, SATISFACTORY: 4 };

/** package_size_id as on the upload form: 1 Petit · 2 Moyen · 3 Grand. */
const PACKAGE_ID_OF: Record<PackageSize, number> = { SMALL: 1, MEDIUM: 2, LARGE: 3 };

export function pickCatalogId(json: unknown): number | null {
  if (!isObj(json)) return null;
  const list = (k: string) => (Array.isArray(json[k]) ? (json[k] as unknown[]) : []);
  return idOf(json.suggested_category_id) ?? idOf(list('suggested_category_ids')[0]) ?? idOf(list('catalog_ids')[0]) ?? (isObj(list('suggestions')[0]) ? idOf((list('suggestions')[0] as Json).id) : null);
}

/** The brand whose title is ours (normalised); the first result only when it contains our brand's words. */
export function pickBrandId(json: unknown, brand: string): { id: number; title: string } | null {
  const brands = isObj(json) && Array.isArray(json.brands) ? json.brands.filter(isObj) : [];
  const want = normalizeText(brand);
  const rows = brands.map((b) => ({ id: idOf(b.id), title: typeof b.title === 'string' ? b.title : '' })).filter((b): b is { id: number; title: string } => b.id !== null && !!b.title);
  return rows.find((b) => normalizeText(b.title) === want) ?? rows.find((b) => ` ${normalizeText(b.title)} `.includes(` ${want} `)) ?? null;
}

const sizeNorm = (s: string) => normalizeText(s).replace(/\s+/g, '').replace(/^taille/, '');

/** The size whose title is exactly ours ("M", "W32", "42") in the category's size groups. */
export function pickSizeId(json: unknown, size: string): number | null {
  const groups = isObj(json) && Array.isArray(json.size_groups) ? json.size_groups.filter(isObj) : [];
  const want = sizeNorm(size);
  if (!want) return null;
  for (const g of groups) {
    for (const s of Array.isArray(g.sizes) ? g.sizes.filter(isObj) : []) {
      const title = typeof s.title === 'string' ? s.title : '';
      // "M", "M / 38 / 10": the size is the first part of Vinted's title.
      const first = sizeNorm(title.split('/')[0] ?? '');
      if (first === want || sizeNorm(title) === want) return idOf(s.id);
    }
  }
  return null;
}

/** The package size we want when this category allows it; else none (Vinted will ask). */
export function pickPackageId(json: unknown, want: PackageSize): number | null {
  const list = isObj(json) && Array.isArray(json.package_sizes) ? json.package_sizes : [];
  const ids = list.map((p) => (isObj(p) ? idOf(p.id) : idOf(p))).filter((x): x is number => x !== null);
  const id = PACKAGE_ID_OF[want];
  return ids.length === 0 || ids.includes(id) ? id : null;
}

/* ── Repost as a draft copy ─────────────────────────────── */

export interface RepostSource {
  title: string;
  photoUrls: string[];
  favorites: number | null;
  /** The draft fields copied as they are, ids included (Vinted's own values for this listing). */
  fields: Record<string, unknown>;
}

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x)) ? Number(x) : null);

/**
 * From one of MY listings as Vinted's upload data returns it, what a copy needs: its own ids and texts, its photos
 * (to upload again), and its favourites (a listing with favourites is never reposted: they would be lost).
 */
export function repostSource(json: unknown): RepostSource | null {
  const it = isObj(json) && isObj(json.item) ? json.item : isObj(json) ? json : null;
  if (!it || typeof it.title !== 'string') return null;
  const photos = (Array.isArray(it.photos) ? it.photos.filter(isObj) : [])
    .map((p) => (typeof p.full_size_url === 'string' ? p.full_size_url : typeof p.url === 'string' ? p.url : null))
    .filter((u): u is string => !!u && /^https:\/\//.test(u));
  const price = isObj(it.price) ? num(it.price.amount) : num(it.price);
  const colors = Array.isArray(it.color_ids) ? it.color_ids.map(idOf).filter((x): x is number => x !== null) : [idOf(it.color1_id), idOf(it.color2_id)].filter((x): x is number => x !== null);
  return {
    title: it.title,
    photoUrls: photos,
    favorites: num(it.favourite_count),
    fields: {
      title: it.title,
      description: typeof it.description === 'string' ? it.description : '',
      price: price === null ? null : price.toFixed(2),
      currency: typeof it.currency === 'string' ? it.currency : 'EUR',
      brand_id: idOf(it.brand_id),
      brand: typeof it.brand === 'string' ? it.brand : isObj(it.brand) && typeof it.brand.title === 'string' ? it.brand.title : null,
      size_id: idOf(it.size_id),
      catalog_id: idOf(it.catalog_id),
      status_id: idOf(it.status_id),
      package_size_id: idOf(it.package_size_id),
      color_ids: colors,
      is_unisex: it.is_unisex === true,
      measurement_length: num(it.measurement_length),
      measurement_width: num(it.measurement_width),
      item_attributes: Array.isArray(it.item_attributes) ? it.item_attributes : [],
    },
  };
}
