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
