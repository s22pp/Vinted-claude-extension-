/**
 * The shop ERA opens on (pure: what the WebGL scene draws and how its camera moves, no browser API).
 *
 * The metaphor, adapted to a clothes reseller rather than copied: the extension is a shop, each page a room, each room
 * behind a doorway of light in its page's own colour (the colour of its icon in the menu). Opening ERA, the camera comes
 * down into the shop; changing page, it walks to that room in one continuous move — interrupted by another click, it
 * turns to the new room without a cut (a critically damped spring keeps both position and speed continuous).
 */

/** The rooms, in the order of the menu (going down the menu = walking forward). */
export const ROOMS = ['today', 'automations', 'stock', 'market', 'buy', 'sales', 'insights', 'tools', 'settings'] as const;
export type Room = (typeof ROOMS)[number];

/** Each room's colour: the CSS token of its menu icon (« colour on top, meaning something »). */
export const ROOM_TONE: Record<Room, string> = {
  today: '--violet',
  automations: '--violet',
  stock: '--cobalt',
  market: '--cobalt',
  buy: '--violet',
  sales: '--emerald',
  insights: '--cyan',
  tools: '--pink',
  settings: '--text-2',
};

/** Pages that live inside a room (an article is in the stock room, a parcel in the sales room). */
const INSIDE: Record<string, Room> = { item: 'stock', capital: 'stock', workshop: 'stock', accounting: 'sales', parcels: 'sales' };

/** The room a route belongs to; null for pages outside the shop (onboarding, printable documents). */
export function roomOf(route: string): Room | null {
  if ((ROOMS as readonly string[]).includes(route)) return route as Room;
  return INSIDE[route] ?? null;
}

/** World units between two rooms along the shop's floor. */
export const ROOM_GAP = 10;
/** Where the camera stands in front of a room's doorway (the doorway frames the page). */
export const DOOR_AHEAD = 4;
export const roomZ = (room: Room) => ROOMS.indexOf(room) * ROOM_GAP;
export const doorZ = (index: number) => index * ROOM_GAP + DOOR_AHEAD;

/** Camera height once in the shop, and where the opening flight starts (high above, further back, invisible). */
export const EYE = 1.15;
export const OPENING = { dz: -26, height: 6.5, alpha: 0 } as const;
/** Spring stiffness (rad/s): the opening is slower (about 1.1 s), walking between rooms about 0.7 s. */
export const OMEGA_OPEN = 4.6;
export const OMEGA_WALK = 6.8;

export interface Spring {
  x: number;
  v: number;
}

/**
 * A critically damped spring, solved exactly (stable whatever the frame time): x(t) = target + (c1 + c2·t)·e^(−ωt).
 * Re-targeted mid-flight it keeps its position and speed: no jump, no cut.
 */
export function stepSpring(s: Spring, target: number, dt: number, omega: number): Spring {
  const c1 = s.x - target;
  const c2 = s.v + omega * c1;
  const e = Math.exp(-omega * dt);
  return { x: target + (c1 + c2 * dt) * e, v: (c2 - omega * (c1 + c2 * dt)) * e };
}

/** Settled: close enough that a further frame would not move a pixel. */
export const settled = (s: Spring, target: number, eps = 1e-3) => Math.abs(s.x - target) < eps && Math.abs(s.v) < eps * 4;

/** A CSS colour as the scene needs it (0–1 RGB). Hex (#rgb, #rrggbb) and rgb()/rgba(); null if unreadable. */
export function parseColor(css: string): [number, number, number] | null {
  const c = css.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(c);
  if (m) return [0, 1, 2].map((i) => parseInt(m![1]![i]! + m![1]![i]!, 16) / 255) as [number, number, number];
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(c);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1]!.slice(i, i + 2), 16) / 255) as [number, number, number];
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(c);
  if (m) return [m[1], m[2], m[3]].map((x) => Math.min(1, Number(x) / 255)) as [number, number, number];
  return null;
}

/**
 * How the page changes, as a walk in the shop: forward or back along the menu, into a room (the stock → an article) or
 * back out of it. Null: no walk (the same page, or a page outside the shop) — the page simply changes.
 */
export type Walk = 'fwd' | 'back' | 'in' | 'out';
export function walkOf(from: string, to: string): Walk | null {
  if (from === to) return null;
  const a = roomOf(from);
  const b = roomOf(to);
  if (!a || !b) return null;
  if (a === b) return to === b ? 'out' : 'in';
  return ROOMS.indexOf(b) > ROOMS.indexOf(a) ? 'fwd' : 'back';
}

/** The opening: the page's first blocks come up from the depth one after the other (at most this many, then together). */
export const OPENING_BLOCKS = 6;
export const openingDelay = (i: number) => 80 + Math.min(i, OPENING_BLOCKS - 1) * 55;
