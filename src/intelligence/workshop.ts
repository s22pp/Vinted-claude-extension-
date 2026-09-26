import type { Category, Prep } from '@/domain/entities';
import { type Cents, roundToEuro } from '@/domain/money';
import { DAY } from '@/domain/time';
import type { ComparableAnalysis } from './comparables';
import { CONDITION_TEXT, TITLE_MAX, TITLE_WORD, skuOf, titleIssues } from './listing';
import type { ItemView } from './portfolio';
import type { PricingResult } from './pricing';
import type { RefundGuard } from './refunds';
import type { SegmentStats } from './seller-model';
import { median } from './stats';
import { cleanTitle } from './fav-messages';

/**
 * Atelier de mise en ligne: one sheet per article, in the exact order of the Vinted form.
 * ERA prepares and checks; the seller publishes by hand. Nothing is sent to Vinted.
 */

export type PackageSize = 'SMALL' | 'MEDIUM' | 'LARGE';

/** The Vinted form order. Changing the category first resets brand, size, condition and price. */
export const FORM_STEPS = ['category', 'brand', 'size', 'measures', 'condition', 'colors', 'material', 'title', 'description', 'price', 'package'] as const;
export type FormStep = (typeof FORM_STEPS)[number];

const TOPS: Category[] = ['JACKET', 'COAT', 'SWEATSHIRT', 'KNIT', 'SHIRT', 'POLO', 'TSHIRT'];

/** Flat measures that matter for this kind of item. */
export function measureFields(c: Category): string[] {
  if (TOPS.includes(c)) return ['length', 'pitToPit', 'shoulders', 'sleeve'];
  if (c === 'JEANS' || c === 'TROUSERS') return ['waist', 'inseam', 'length'];
  if (c === 'SHORTS') return ['waist', 'length'];
  if (c === 'SHOES') return ['insole'];
  return ['width', 'height', 'depth'];
}

/** Smallest parcel that fits: cheaper shipping converts better (the buyer already pays the fees). */
export function suggestedPackage(c: Category): PackageSize {
  if (c === 'TSHIRT' || c === 'SHIRT' || c === 'POLO' || c === 'SHORTS' || c === 'ACCESSORY') return 'SMALL';
  if (c === 'COAT' || c === 'SHOES') return 'LARGE';
  return 'MEDIUM';
}

export type CheckKey = 'sizeLabel' | 'brandExact' | 'photoLogo' | 'photoComposition' | 'photoSizeLabel' | 'photoDefects' | 'measureZero' | 'colorDaylight' | 'packagingProtected';

/** Always required: the authenticity trio and the facts read on labels, never guessed. */
const BASE_CHECKS: CheckKey[] = ['sizeLabel', 'brandExact', 'photoLogo', 'photoComposition', 'photoSizeLabel', 'photoDefects', 'measureZero'];

export function checksFor(guards: readonly RefundGuard[]): CheckKey[] {
  const out = [...BASE_CHECKS];
  if (guards.includes('DESCRIPTION_CHECK')) out.push('colorDaylight');
  if (guards.includes('PACKAGING')) out.push('packagingProtected');
  return out;
}

/** Brands that must be entered exactly: a wrong brand gets the listing banned. */
const SENSITIVE: { re: RegExp; brand: string; note: string }[] = [{ re: /marlboro/i, brand: 'Marlboro', note: 'marlboro' }];

export function brandWarning(brand: string, title: string): { brand: string; note: string } | null {
  const hit = SENSITIVE.find((s) => s.re.test(brand) || s.re.test(title));
  return hit && brand.trim().toLowerCase() !== hit.brand.toLowerCase() ? { brand: hit.brand, note: hit.note } : null;
}

export interface PriceSuggestion {
  cents: Cents;
  basis: 'MARKET' | 'PERSONAL';
  strategy: PricingResult['recommended'];
  range: { min: Cents; max: Cents } | null;
  /** Comparables (market) or your sales (personal) behind it. */
  n: number;
  /** Cash expected after the usual negotiation, when known. */
  expectedCents: Cents | null;
}

/**
 * The asking price is deduced, never asked: top of the recommended range from fresh comparables
 * (room for offers), else the median price you actually cashed on this niche.
 */
export function suggestPrice(analysis: ComparableAnalysis | null, pricing: PricingResult | null, personal: SegmentStats | null): PriceSuggestion | null {
  if (analysis && pricing?.status === 'OK' && pricing.recommended) {
    const o = pricing.options.find((x) => x.strategy === pricing.recommended)!;
    return { cents: roundToEuro(o.range.max), basis: 'MARKET', strategy: o.strategy, range: o.range, n: analysis.keptCount, expectedCents: pricing.expectedSaleCents };
  }
  if (personal?.medianSaleCents != null && personal.sold >= 3) {
    return { cents: roundToEuro(personal.medianSaleCents), basis: 'PERSONAL', strategy: null, range: null, n: personal.sold, expectedCents: personal.medianSaleCents };
  }
  return null;
}

type DraftItem = Pick<ItemView['item'], 'id' | 'brand' | 'model' | 'category' | 'size' | 'era' | 'condition'>;

export function draftTitle(item: DraftItem, prep: Pick<Prep, 'titleOverride' | 'productRef'> | null): string {
  if (prep?.titleOverride) return prep.titleOverride;
  const sku = skuOf(item.id);
  const parts = [TITLE_WORD[item.category], item.brand, item.model, item.era === 'vintage' ? 'vintage' : null, prep?.productRef?.trim() || null, item.size ? `taille ${item.size}` : null];
  let base = parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  // Keep the reference: it is what links the Vinted listing back to this item.
  if (`${base} · ${sku}`.length > TITLE_MAX && item.size) base = base.replace(` taille ${item.size}`, ` T${item.size}`);
  return `${base} · ${sku}`;
}

const cm = (v: string | undefined) => (v && v.trim() ? (/^\d+([.,]\d+)?$/.test(v.trim()) ? `${v.trim()} cm` : v.trim()) : '__');

export function draftDescription(item: DraftItem & { material: string | null }, prep: Prep | null, guards: readonly RefundGuard[], measureLabel: (k: string) => string): string {
  if (prep?.descriptionOverride) return prep.descriptionOverride;
  const m = prep?.measures ?? {};
  const defects = prep?.defects.trim();
  const material = prep?.material.trim() || item.material || '';
  const lines = [
    `${TITLE_WORD[item.category]} ${item.brand}${item.model ? ` ${item.model}` : ''}`.trim(),
    '',
    `• Taille : ${item.size ?? '__ (étiquette)'}`,
    `• État : ${item.condition ? CONDITION_TEXT[item.condition] : '__'}`,
    `• Défauts : ${defects ? defects : prep?.checks.includes('photoDefects') ? 'aucun défaut visible' : '__'}`,
    ...(prep?.colors.trim() ? [`• Couleur : ${prep.colors.trim()}`] : []),
    `• Composition : ${material || '__ (lire l’étiquette — sinon « non lisible »)'}`,
    ...(prep?.productRef.trim() ? [`• Référence : ${prep.productRef.trim()}`] : []),
    `• Mesures à plat : ${measureFields(item.category)
      .map((k) => `${measureLabel(k)} ${cm(m[k])}`)
      .join(' · ')}`,
  ];
  if (guards.includes('MEASURES_REQUIRED')) lines.push('Comparez ces mesures à un vêtement que vous portez : la taille d’étiquette varie selon les marques.');
  lines.push('', 'Envoi rapide et soigné. Photos non retouchées : l’article est tel que photographié.', `Réf. ${skuOf(item.id)}`);
  return lines.join('\n');
}

export interface ReadinessItem {
  key: 'brand' | 'size' | 'category' | 'measures' | 'price' | 'title' | 'defects' | CheckKey;
  done: boolean;
}

/** Ready = every blocking fact is read or measured; nothing is left to guess on the Vinted form. */
export function readiness(
  item: DraftItem,
  prep: Prep | null,
  title: string,
  price: Cents | null,
  guards: readonly RefundGuard[],
): { items: ReadinessItem[]; done: number; total: number; ready: boolean } {
  const measures = measureFields(item.category).map((k) => prep?.measures[k]?.trim() ?? '');
  const filled = measures.filter(Boolean).length;
  const needMeasures = guards.includes('MEASURES_REQUIRED') ? measures.length : Math.min(2, measures.length);
  const checks = checksFor(guards);
  const items: ReadinessItem[] = [
    { key: 'category', done: item.category !== 'OTHER' },
    { key: 'brand', done: !!item.brand && item.brand !== 'Inconnue' && !brandWarning(item.brand, title) },
    { key: 'size', done: !!item.size || item.category === 'ACCESSORY' },
    { key: 'measures', done: filled >= needMeasures },
    { key: 'price', done: price !== null && price > 0 },
    { key: 'title', done: !titleIssues(title, item.brand).some((i) => i.severity === 'block') },
    ...(guards.includes('DEFECT_PHOTOS') || guards.includes('CONDITION_DETAIL') ? [{ key: 'defects' as const, done: !!prep?.defects.trim() || !!prep?.checks.includes('photoDefects') }] : []),
    ...checks.map((c) => ({ key: c, done: !!prep?.checks.includes(c) })),
  ];
  const done = items.filter((i) => i.done).length;
  return { items, done, total: items.length, ready: done === items.length };
}

/** Owned but not on Vinted yet: Vinted drafts and items never listed. */
export function workshopQueue(views: readonly ItemView[], preps: ReadonlyMap<string, Prep>): { toList: ItemView[]; awaitingImport: ItemView[] } {
  const candidates = views.filter((v) => v.inStock && (v.item.status === 'DRAFT' || !v.current));
  const toList = candidates.filter((v) => !preps.get(v.item.id)?.publishedAt);
  const awaitingImport = candidates.filter((v) => !!preps.get(v.item.id)?.publishedAt);
  // Oldest capital first: an item bought long ago and still not listed is money asleep.
  toList.sort((a, b) => (a.item.purchaseDate ?? a.item.createdAt) - (b.item.purchaseDate ?? b.item.createdAt));
  return { toList, awaitingImport };
}

export interface PrepStats {
  published7: number;
  published30: number;
  /** Median minutes per published sheet — measured with the sheet open, not estimated. */
  medianMinutes: number | null;
  timed: number;
}

export function prepStats(preps: readonly Prep[], now: number): PrepStats {
  const pub = preps.filter((p) => p.publishedAt);
  const timed = pub.filter((p) => p.seconds >= 20);
  return {
    published7: pub.filter((p) => p.publishedAt! >= now - 7 * DAY).length,
    published30: pub.filter((p) => p.publishedAt! >= now - 30 * DAY).length,
    medianMinutes: timed.length ? median(timed.map((p) => p.seconds)) / 60 : null,
    timed: timed.length,
  };
}

/**
 * The working title of a copy: the model's title without ERA's reference, its size swapped for the new one
 * when the title carries it ("… taille M", "… M"). The Vinted title itself is built by draftTitle.
 */
export function relistTitle(title: string, oldSize: string | null, newSize: string | null): string {
  const base = cleanTitle(title);
  if (!oldSize || !newSize || oldSize === newSize) return base;
  const esc = oldSize.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|\\s)(taille\\s+|T)?${esc}(?=\\s*$)`, 'i');
  return re.test(base) ? base.replace(re, (_m, sp: string, pre: string | undefined) => `${sp}${pre ?? ''}${newSize}`) : base;
}
