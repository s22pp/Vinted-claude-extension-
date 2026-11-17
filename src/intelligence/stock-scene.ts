/**
 * The stock as a stadium (skill « era-visuel »): every article a seat that knows who it is — its stand (category), row,
 * seat, state and next action. Pure: which articles, their state, where they sit, their colour, the filters. The scene
 * only shows this; it invents nothing (an unknown price has no invented height: it is flagged unknown).
 */

export type SceneState = 'TO_SHIP' | 'CUT_DUE' | 'STALE' | 'LIVE' | 'RESERVED' | 'HIDDEN' | 'SOLD';

export interface SceneItem {
  itemId: string;
  title: string;
  category: string;
  state: SceneState;
  priceCents: number | null;
  views: number | null;
  favourites: number | null;
  daysListed: number | null;
  photoUrl: string | null;
  /** The plan's cut due: from → to (cents). */
  cut: { from: number; to: number } | null;
}

export interface SceneSource {
  itemId: string;
  title: string;
  category: string;
  /** The article's status in ERA: LISTED, RESERVED, HIDDEN, DRAFT, SOLD… */
  status: string;
  inStock: boolean;
  priceCents: number | null;
  views: number | null;
  favourites: number | null;
  daysListed: number | null;
  photoUrl: string | null;
  /** Sold and waiting to be shipped by the seller. */
  needsShip: boolean;
  soldAt: number | null;
  cut: { from: number; to: number } | null;
}

const DAY = 86_400_000;
/** Sold articles stay in the stadium this long (green seats: what sold lately). */
export const SOLD_SHOWN_DAYS = 30;

/** One state per article, the most urgent first: to ship, a cut due, stale, then as Vinted shows it. */
export function sceneState(s: SceneSource, staleDays: number): SceneState | null {
  if (s.needsShip) return 'TO_SHIP';
  if (!s.inStock) return s.status === 'SOLD' ? 'SOLD' : null;
  if (s.status === 'RESERVED') return 'RESERVED';
  if (s.status === 'HIDDEN') return 'HIDDEN';
  if (s.status !== 'LISTED') return null;
  if (s.cut) return 'CUT_DUE';
  if (s.daysListed !== null && s.daysListed >= staleDays) return 'STALE';
  return 'LIVE';
}

/** The articles in the stadium: in stock and listed (not drafts), and those sold in the last 30 days. */
export function sceneItems(sources: readonly SceneSource[], staleDays: number, now: number): SceneItem[] {
  const out: SceneItem[] = [];
  for (const s of sources) {
    const state = sceneState(s, staleDays);
    if (!state) continue;
    if (state === 'SOLD' && (s.soldAt === null || now - s.soldAt > SOLD_SHOWN_DAYS * DAY)) continue;
    out.push({ itemId: s.itemId, title: s.title, category: s.category, state, priceCents: s.priceCents, views: s.views, favourites: s.favourites, daysListed: s.daysListed, photoUrl: s.photoUrl, cut: s.cut });
  }
  return out;
}

export interface Placed extends SceneItem {
  stand: number;
  row: number;
  seat: number;
  x: number;
  y: number;
  z: number;
  /** Facing the pitch (radians around Y). */
  rotY: number;
  /** Card height: the price, relative to the others; null price → the middle height, flagged. */
  h: number;
  unknownPrice: boolean;
}

export interface Stand {
  index: number;
  category: string;
  count: number;
  /** Middle angle of the stand (radians), for its label. */
  angle: number;
  /** Rows it fills (its sign stands above the last one). */
  rows: number;
}

const ORDER: SceneState[] = ['TO_SHIP', 'CUT_DUE', 'STALE', 'LIVE', 'RESERVED', 'HIDDEN', 'SOLD'];
/** The bowl: an arc of 300°, open on one side like a stadium entrance. */
export const ARC = (300 / 180) * Math.PI;
export const ARC_START = -Math.PI / 2 + (Math.PI * 2 - ARC) / 2;
export const RADIUS = 9;
export const ROW_STEP = 1.1;
export const ROW_RISE = 0.7;

/**
 * Stands = categories (the biggest first), each a sector of the bowl in proportion to its articles; rows go up and
 * back; what needs action sits in the front rows. Every seat keeps its stand, row and seat number.
 */
export function layoutArena(items: readonly SceneItem[]): { placed: Placed[]; stands: Stand[] } {
  if (!items.length) return { placed: [], stands: [] };
  const byCat = new Map<string, SceneItem[]>();
  for (const it of items) byCat.set(it.category, [...(byCat.get(it.category) ?? []), it]);
  const cats = [...byCat.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const known = items.map((i) => i.priceCents).filter((p): p is number => p !== null);
  const lo = known.length ? Math.min(...known) : 0;
  const hi = known.length ? Math.max(...known) : 0;
  const gap = 0.06;
  const total = items.length;
  let start = ARC_START;
  const placed: Placed[] = [];
  const stands: Stand[] = [];
  cats.forEach(([category, list], index) => {
    const width = Math.max(ARC * (list.length / total) - gap, 0.12);
    const sorted = [...list].sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state) || a.title.localeCompare(b.title));
    const rows = Math.min(8, Math.max(1, Math.ceil(Math.sqrt(sorted.length / 3))));
    const perRow = Math.ceil(sorted.length / rows);
    sorted.forEach((it, i) => {
      const row = Math.floor(i / perRow);
      const seat = i % perRow;
      const angle = start + ((seat + 0.5) / perRow) * width;
      const r = RADIUS + row * ROW_STEP;
      const unknownPrice = it.priceCents === null;
      const h = unknownPrice ? 1 : hi > lo ? 0.6 + ((it.priceCents! - lo) / (hi - lo)) * 1.0 : 1;
      placed.push({ ...it, stand: index, row: row + 1, seat: seat + 1, x: Math.cos(angle) * r, y: row * ROW_RISE + h / 2, z: Math.sin(angle) * r, rotY: -angle - Math.PI / 2, h, unknownPrice });
    });
    stands.push({ index, category, count: list.length, angle: start + width / 2, rows });
    start += width + gap;
  });
  return { placed, stands };
}

/** Sober base colours by state; a filter paints its own seats orange over them (the « mask »). */
export const STATE_COLOR: Record<SceneState, number> = {
  TO_SHIP: 0x8b5cf6,
  CUT_DUE: 0x3b82f6,
  STALE: 0x64748b,
  LIVE: 0x2563eb,
  RESERVED: 0x94a3b8,
  HIDDEN: 0x334155,
  SOLD: 0x10b981,
};
export const HIGHLIGHT = 0xf97316;

export type SceneFilter = 'ALL' | 'CUT_DUE' | 'REPOST' | 'TO_SHIP' | 'SOLD' | 'STALE';

/** REPOST: online 30 days or more, no favourite (never a listing with favourites: a repost would lose them). */
export function inFilter(it: SceneItem, f: SceneFilter): boolean {
  switch (f) {
    case 'ALL':
      return false;
    case 'CUT_DUE':
      return it.state === 'CUT_DUE';
    case 'TO_SHIP':
      return it.state === 'TO_SHIP';
    case 'SOLD':
      return it.state === 'SOLD';
    case 'STALE':
      return it.state === 'STALE';
    case 'REPOST':
      return (it.state === 'STALE' || it.state === 'LIVE' || it.state === 'CUT_DUE') && it.favourites === 0 && (it.daysListed ?? 0) >= 30;
  }
}

/** The « ticket »'s suggestion: the next thing to do for this article (a key the screen words). */
export function nextAction(it: SceneItem): 'SHIP' | 'CUT' | 'REPOST' | 'WAIT_FAVS' | 'NONE' | 'SOLD' {
  if (it.state === 'TO_SHIP') return 'SHIP';
  if (it.state === 'SOLD') return 'SOLD';
  if (it.state === 'CUT_DUE') return 'CUT';
  if (inFilter(it, 'REPOST')) return 'REPOST';
  if (it.state === 'STALE') return 'WAIT_FAVS';
  return 'NONE';
}
