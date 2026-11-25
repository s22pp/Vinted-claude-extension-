/**
 * The stock as a shop (skill « era-visuel »): every article a garment on a rack that knows who it is — its rack
 * (category), its place on the rail, its state and its next action. Pure: which articles, their state, where they hang,
 * their tag's colour, the filters. The scene only shows this; it invents nothing.
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
  /** Price minus cost, when the cost is known (null: unknown, never zero). */
  marginCents?: number | null;
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
  marginCents?: number | null;
}

const DAY = 86_400_000;
/** Sold articles stay on the « Vendus ce mois » rack this long. */
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

/** The articles in the shop: in stock and listed (not drafts), to ship, and those sold in the last 30 days. */
export function sceneItems(sources: readonly SceneSource[], staleDays: number, now: number): SceneItem[] {
  const out: SceneItem[] = [];
  for (const s of sources) {
    const state = sceneState(s, staleDays);
    if (!state) continue;
    if (state === 'SOLD' && (s.soldAt === null || now - s.soldAt > SOLD_SHOWN_DAYS * DAY)) continue;
    out.push({ itemId: s.itemId, title: s.title, category: s.category, state, priceCents: s.priceCents, views: s.views, favourites: s.favourites, daysListed: s.daysListed, photoUrl: s.photoUrl, cut: s.cut, marginCents: s.marginCents ?? null });
  }
  return out;
}

/** Where a hanger hangs: its rack, its place on the rail, and its position in the shop. */
export interface Hung extends SceneItem {
  rack: number;
  slot: number;
  x: number;
  y: number;
  z: number;
}

export type RackKind = 'CATEGORY' | 'TO_SHIP' | 'SOLD';
export interface Rack {
  index: number;
  kind: RackKind;
  /** The category (CATEGORY racks), null for the shipping and sold racks. */
  category: string | null;
  /** 1, 2… when a category needs more than one rack. */
  part: number;
  count: number;
  x0: number;
  x1: number;
  z: number;
}

/** Room for one garment on a rail, garments per rack, racks per row of the shop, and the spacing between them. */
export const SLOT = 0.62;
export const RACK_MAX = 10;
export const RACKS_PER_ROW = 3;
const RACK_PAD = 0.3;
const RACK_GAP = 1.1;
const ROW_DEPTH = 3.4;
/** Height of a garment's centre (a hanger on a rail at about 1.6). */
export const GARMENT_Y = 1.15;

const URGENT: SceneState[] = ['TO_SHIP', 'CUT_DUE', 'STALE', 'LIVE', 'RESERVED', 'HIDDEN', 'SOLD'];

/**
 * The shop: one rack per category (the biggest first; more than RACK_MAX garments → several racks), what needs action
 * first on each rail, then a rack « À envoyer » and a rack « Vendus ce mois ». Racks stand in rows of RACKS_PER_ROW,
 * front to back, centred. Every garment keeps its rack and its place on the rail.
 */
export function layoutRacks(items: readonly SceneItem[]): { hung: Hung[]; racks: Rack[] } {
  const byUrgency = (a: SceneItem, b: SceneItem) => URGENT.indexOf(a.state) - URGENT.indexOf(b.state) || a.title.localeCompare(b.title);
  const groups: { kind: RackKind; category: string | null; list: SceneItem[] }[] = [];
  const byCat = new Map<string, SceneItem[]>();
  for (const it of items) if (it.state !== 'TO_SHIP' && it.state !== 'SOLD') byCat.set(it.category, [...(byCat.get(it.category) ?? []), it]);
  for (const [category, list] of [...byCat.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) groups.push({ kind: 'CATEGORY', category, list: list.sort(byUrgency) });
  const toShip = items.filter((i) => i.state === 'TO_SHIP').sort(byUrgency);
  const sold = items.filter((i) => i.state === 'SOLD').sort(byUrgency);
  if (toShip.length) groups.push({ kind: 'TO_SHIP', category: null, list: toShip });
  if (sold.length) groups.push({ kind: 'SOLD', category: null, list: sold });

  // Racks of RACK_MAX at most.
  const chunks: { kind: RackKind; category: string | null; part: number; list: SceneItem[] }[] = [];
  for (const g of groups) for (let i = 0, part = 1; i < g.list.length; i += RACK_MAX, part++) chunks.push({ kind: g.kind, category: g.category, part, list: g.list.slice(i, i + RACK_MAX) });

  const racks: Rack[] = [];
  const hung: Hung[] = [];
  for (let row = 0; row * RACKS_PER_ROW < chunks.length; row++) {
    const inRow = chunks.slice(row * RACKS_PER_ROW, (row + 1) * RACKS_PER_ROW);
    const widths = inRow.map((c) => c.list.length * SLOT + RACK_PAD * 2);
    let x = -(widths.reduce((a, b) => a + b, 0) + RACK_GAP * (inRow.length - 1)) / 2;
    const z = -row * ROW_DEPTH;
    inRow.forEach((c, k) => {
      const index = racks.length;
      racks.push({ index, kind: c.kind, category: c.category, part: c.part, count: c.list.length, x0: x, x1: x + widths[k]!, z });
      c.list.forEach((it, slot) => hung.push({ ...it, rack: index, slot: slot + 1, x: x + RACK_PAD + (slot + 0.5) * SLOT, y: GARMENT_Y, z }));
      x += widths[k]! + RACK_GAP;
    });
  }
  return { hung, racks };
}

/**
 * The tags' colours by state, in the house's state tones (coral: to ship, amber: stalls, emerald: sold, glacier: a price
 * cut due); a listing simply online stays neutral. A filter lights its own tags and dims the rest (the « mask »).
 */
export const STATE_COLOR: Record<SceneState, number> = {
  TO_SHIP: 0xf87171,
  CUT_DUE: 0xe2e8f0,
  STALE: 0xfbbf24,
  LIVE: 0x8e9bae,
  RESERVED: 0x64748b,
  HIDDEN: 0x334155,
  SOLD: 0x34d399,
};
export const HIGHLIGHT = 0xf4f2ec;

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
