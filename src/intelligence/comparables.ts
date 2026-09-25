import type { Category, Condition, Gender, MarketCandidate } from '@/domain/entities';
import type { ComparableQuery, SearchResult } from '@/data/adapters/marketplace';
import {
  EXCLUDED_TERMS,
  brandKey,
  categoriesInTitle,
  categoryAffinity,
  conditionAffinity,
  genderAffinity,
  genderFromTitle,
  jaccard,
  modelTokens,
  normalizeText,
  sizeAffinity,
  isUnknownBrand,
  titleHasBrand,
  titleKeywords,
} from './normalize';
import { clamp, effectiveSampleSize, percentileRank, weightedQuantile } from './stats';

export interface ComparableSubject {
  title: string;
  brand: string;
  model: string | null;
  category: Category;
  gender: Gender | null;
  size: string | null;
  condition: Condition | null;
  material: string | null;
  era: string | null;
  /** Current asking price, when the subject is listed. */
  priceCents: number | null;
}

export type ExclusionReason =
  | 'DUPLICATE'
  | 'BRAND_MISMATCH'
  | 'EXCLUDED_TERM'
  | 'CATEGORY_MISMATCH'
  | 'GENDER_MISMATCH'
  | 'LOW_SIMILARITY'
  | 'OUTLIER_LOW'
  | 'OUTLIER_HIGH';

export const EXCLUSION_REASONS: ExclusionReason[] = [
  'DUPLICATE',
  'BRAND_MISMATCH',
  'EXCLUDED_TERM',
  'CATEGORY_MISMATCH',
  'GENDER_MISMATCH',
  'LOW_SIMILARITY',
  'OUTLIER_LOW',
  'OUTLIER_HIGH',
];

export interface SimilarityBreakdown {
  model: number;
  category: number;
  size: number;
  condition: number;
  gender: number;
  material: number;
  era: number;
}

export interface ScoredComparable {
  candidate: MarketCandidate;
  similarity: number;
  dims: SimilarityBreakdown | null;
  kept: boolean;
  reason: ExclusionReason | null;
}

export interface Distribution {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  min: number;
  max: number;
  /** p90 / p10 — above ~4 the catalogue is mixing different products. */
  spread: number;
}

export type ComparableQuality = 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';

export type AnalysisNote = 'SMALL_SAMPLE' | 'MIXED_CATALOG' | 'SUPPLY_CAPPED' | 'LOW_MEAN_SIMILARITY' | 'CONDITION_MIX';

export interface ComparableAnalysis {
  version: 1;
  at: number;
  source: 'DEMO' | 'VINTED';
  subject: ComparableSubject;
  queries: string[];
  collected: number;
  totalEntries: number | null;
  totalCapped: boolean;
  comparables: ScoredComparable[];
  keptCount: number;
  effectiveSample: number;
  meanSimilarity: number;
  distribution: Distribution | null;
  quality: ComparableQuality;
  exclusions: Record<ExclusionReason, number>;
  position: { priceCents: number; deltaPct: number; percentile: number } | null;
  notes: AnalysisNote[];
  /** Search endpoint learned at runtime (structure never verified on a real account). */
  via?: 'LEARNED' | null;
}

const WEIGHTS: SimilarityBreakdown = {
  model: 0.3,
  category: 0.2,
  size: 0.15,
  condition: 0.15,
  gender: 0.1,
  material: 0.05,
  era: 0.05,
};

export const MIN_SIMILARITY = 0.5;
export const MIN_SAMPLE = 8;
/** Below this price, listings are overwhelmingly broken items, empty boxes or lots. */
const FLOOR_CENTS = 300;

/** Queries: brand + model, then brand + category term. Never a colour — colours don't narrow a market. */
export function buildQueries(subject: ComparableSubject): ComparableQuery[] {
  const base = {
    brand: subject.brand,
    category: subject.category,
    gender: subject.gender,
    size: subject.size,
    condition: subject.condition,
  };
  const texts = new Set<string>();
  if (isUnknownBrand(subject.brand)) {
    // No brand known: search with what the title says about the article — never "inconnue chemise".
    const words = titleKeywords(subject.title);
    const cat = CATEGORY_QUERY_WORD[subject.category];
    texts.add(words ? (cat && !` ${words} `.includes(` ${normalizeText(cat)} `) ? `${cat} ${words}` : words) : cat);
    return [...texts].filter(Boolean).map((text) => ({ ...base, brand: '', text }));
  }
  if (subject.model) texts.add(`${subject.brand} ${subject.model}`);
  texts.add(`${subject.brand} ${CATEGORY_QUERY_WORD[subject.category]}`.trim());
  return [...texts].map((text) => ({ ...base, text }));
}

const CATEGORY_QUERY_WORD: Record<Category, string> = {
  JACKET: 'veste',
  COAT: 'manteau',
  SWEATSHIRT: 'sweat',
  KNIT: 'pull',
  SHIRT: 'chemise',
  POLO: 'polo',
  TSHIRT: 't-shirt',
  JEANS: 'jean',
  TROUSERS: 'pantalon',
  SHORTS: 'short',
  SHOES: 'chaussures',
  ACCESSORY: '',
  OTHER: '',
};

function similarity(subject: ComparableSubject, c: MarketCandidate, subjTokens: Set<string>): SimilarityBreakdown {
  const nt = normalizeText(c.title);
  const tokens = modelTokens(nt);
  let model = jaccard(subjTokens, tokens);
  if (subject.model) {
    const modelNorm = normalizeText(subject.model);
    if (` ${nt} `.includes(` ${modelNorm} `)) model = Math.max(model, 0.9);
  }
  // Tokens overlap is noisy on short titles: soften towards a neutral value.
  model = clamp(0.25 + model * 1.1);
  const cCats = c.category ? [c.category] : categoriesInTitle(nt);
  const category = cCats.length === 0 ? 0.6 : Math.max(...cCats.map((k) => categoryAffinity(subject.category, k)));
  const gender = genderAffinity(subject.gender, c.gender ?? genderFromTitle(nt));
  const material = subject.material ? (nt.includes(normalizeText(subject.material)) ? 1 : 0.4) : 0.5;
  const era = subject.era ? (nt.includes(normalizeText(subject.era)) ? 1 : 0.4) : 0.5;
  return {
    model,
    category,
    size: sizeAffinity(subject.size, c.size),
    condition: conditionAffinity(subject.condition, c.condition),
    gender,
    material,
    era,
  };
}

function weighted(d: SimilarityBreakdown): number {
  let s = 0;
  for (const k of Object.keys(WEIGHTS) as (keyof SimilarityBreakdown)[]) s += WEIGHTS[k] * d[k];
  return s;
}

function dedupeKey(c: MarketCandidate): string {
  return `${c.sellerId ?? '?'}|${normalizeText(c.title)}|${c.priceCents}`;
}

/**
 * Comparable pipeline: collection → normalization → dedup → hard filters → similarity
 * → outlier rejection → effective sample → robust (weighted) distribution → explanation.
 * Pure: no I/O, deterministic for a given input.
 */
export function analyzeComparables(
  subject: ComparableSubject,
  results: SearchResult[],
  opts: { queries: string[]; source: 'DEMO' | 'VINTED'; now: number },
): ComparableAnalysis {
  const subjBrand = isUnknownBrand(subject.brand) ? null : brandKey(subject.brand);
  const subjTokens = modelTokens(normalizeText(`${subject.model ?? ''} ${subject.title}`));
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  const scored: ScoredComparable[] = [];

  const all = results.flatMap((r) => r.candidates);
  for (const c of all) {
    const reject = (reason: ExclusionReason, dims: SimilarityBreakdown | null = null, sim = 0) =>
      scored.push({ candidate: c, similarity: sim, dims, kept: false, reason });

    const key = dedupeKey(c);
    if (seenIds.has(c.id) || seenKeys.has(key)) {
      // Same listing surfaced by several queries is not new evidence.
      if (!seenIds.has(c.id)) reject('DUPLICATE');
      continue;
    }
    seenIds.add(c.id);
    seenKeys.add(key);

    const nt = normalizeText(c.title);
    // Unknown brand: no brand filter (it would reject everything); similarity on the title does the sorting.
    const brandOk = subjBrand === null || (c.brand && brandKey(c.brand) === subjBrand) || titleHasBrand(c.title, subjBrand);
    if (!brandOk) {
      reject('BRAND_MISMATCH');
      continue;
    }
    if (EXCLUDED_TERMS.test(nt)) {
      reject('EXCLUDED_TERM');
      continue;
    }
    const cats = c.category ? [c.category] : categoriesInTitle(nt);
    if (cats.length > 0 && cats.every((k) => categoryAffinity(subject.category, k) === 0)) {
      reject('CATEGORY_MISMATCH');
      continue;
    }
    const dims = similarity(subject, c, subjTokens);
    if (dims.gender === 0) {
      reject('GENDER_MISMATCH', dims);
      continue;
    }
    const sim = weighted(dims);
    if (sim < MIN_SIMILARITY) {
      reject('LOW_SIMILARITY', dims, sim);
      continue;
    }
    if (c.priceCents < FLOOR_CENTS) {
      reject('OUTLIER_LOW', dims, sim);
      continue;
    }
    scored.push({ candidate: c, similarity: sim, dims, kept: true, reason: null });
  }

  // Outlier rejection on log-price (Tukey fences), only once we have enough to estimate spread.
  let kept = scored.filter((s) => s.kept);
  if (kept.length >= 5) {
    const logs = kept.map((s) => ({ v: Math.log(s.candidate.priceCents), w: 1 }));
    const q1 = weightedQuantile(logs, 0.25);
    const q3 = weightedQuantile(logs, 0.75);
    const iqr = Math.max(q3 - q1, 0.15);
    for (const s of kept) {
      const l = Math.log(s.candidate.priceCents);
      if (l < q1 - 1.5 * iqr) Object.assign(s, { kept: false, reason: 'OUTLIER_LOW' });
      else if (l > q3 + 1.5 * iqr) Object.assign(s, { kept: false, reason: 'OUTLIER_HIGH' });
    }
    kept = kept.filter((s) => s.kept);
  }

  const points = kept.map((s) => ({ v: s.candidate.priceCents, w: s.similarity }));
  const effectiveSample = effectiveSampleSize(points.map((p) => p.w));
  const meanSimilarity = kept.length ? kept.reduce((a, s) => a + s.similarity, 0) / kept.length : 0;

  let distribution: Distribution | null = null;
  if (kept.length >= 3) {
    // Market estimates are whole euros: cents would be false precision.
    const q = (x: number) => Math.round(weightedQuantile(points, x) / 100) * 100;
    const p10 = q(0.1);
    const p90 = q(0.9);
    distribution = {
      p10,
      p25: q(0.25),
      p50: q(0.5),
      p75: q(0.75),
      p90,
      min: Math.min(...points.map((p) => p.v)),
      max: Math.max(...points.map((p) => p.v)),
      spread: p10 > 0 ? p90 / p10 : Infinity,
    };
  }

  const notes: AnalysisNote[] = [];
  const totalCapped = results.some((r) => r.totalCapped);
  const totalEntries = results.reduce<number | null>((m, r) => (r.totalEntries === null ? m : Math.max(m ?? 0, r.totalEntries)), null);
  if (kept.length < MIN_SAMPLE) notes.push('SMALL_SAMPLE');
  if (distribution && distribution.spread > 4) notes.push('MIXED_CATALOG');
  if (totalCapped) notes.push('SUPPLY_CAPPED');
  if (kept.length > 0 && meanSimilarity < 0.62) notes.push('LOW_MEAN_SIMILARITY');
  const condMix = subject.condition ? kept.filter((s) => (s.dims?.condition ?? 1) < 0.75).length / (kept.length || 1) : 0;
  if (condMix > 0.4) notes.push('CONDITION_MIX');

  const quality = gradeQuality(kept.length, effectiveSample, meanSimilarity, distribution);

  let position: ComparableAnalysis['position'] = null;
  if (subject.priceCents !== null && distribution) {
    position = {
      priceCents: subject.priceCents,
      deltaPct: (subject.priceCents - distribution.p50) / distribution.p50,
      percentile: percentileRank(points, subject.priceCents),
    };
  }

  const exclusions = Object.fromEntries(EXCLUSION_REASONS.map((r) => [r, 0])) as Record<ExclusionReason, number>;
  for (const s of scored) if (s.reason) exclusions[s.reason]++;

  scored.sort((a, b) => Number(b.kept) - Number(a.kept) || b.similarity - a.similarity);

  return {
    version: 1,
    at: opts.now,
    source: opts.source,
    subject,
    queries: opts.queries,
    collected: all.length,
    totalEntries,
    totalCapped,
    comparables: scored,
    keptCount: kept.length,
    effectiveSample: Math.round(effectiveSample * 10) / 10,
    meanSimilarity,
    distribution,
    quality,
    exclusions,
    position,
    notes,
    via: results.some((r) => r.via === 'LEARNED') ? 'LEARNED' : null,
  };
}

export function gradeQuality(kept: number, nEff: number, meanSim: number, d: Distribution | null): ComparableQuality {
  if (kept < MIN_SAMPLE || !d) return 'INSUFFICIENT';
  if (kept >= 15 && nEff >= 12 && d.spread <= 3 && meanSim >= 0.7) return 'HIGH';
  if (nEff >= 6.5 && d.spread <= 5) return 'MEDIUM';
  return 'LOW';
}

/**
 * The brand of an article whose brand ERA does not know, learned from the market: a brand the search results
 * are sold under that is written in the article's own title. The most frequent wins; none → null.
 */
export function brandFromResults(title: string, results: readonly SearchResult[]): string | null {
  const counts = new Map<string, { n: number; name: string }>();
  for (const c of results.flatMap((r) => r.candidates)) {
    if (!c.brand || isUnknownBrand(c.brand)) continue;
    const key = brandKey(c.brand);
    if (!titleHasBrand(title, key) && !` ${normalizeText(title)} `.includes(` ${normalizeText(c.brand)} `)) continue;
    const prev = counts.get(key);
    counts.set(key, { n: (prev?.n ?? 0) + 1, name: prev?.name ?? c.brand });
  }
  let best: { n: number; name: string } | null = null;
  for (const v of counts.values()) if (!best || v.n > best.n) best = v;
  return best?.name ?? null;
}
