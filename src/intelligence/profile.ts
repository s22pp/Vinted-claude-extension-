/**
 * The seller's Vinted identity on this device: the login and the avatar, read where Vinted already gives them
 * (users/current, the page's __NEXT_DATA__, the header's avatar) — never asked for, never sent anywhere. Kept in Dexie
 * only (settings), the avatar image cached as a data URL so the sidebar draws it offline and without a request.
 */

export const PROFILE_KEY = 'vintedProfile';

export interface VintedProfile {
  username: string;
  /** Vinted's own image URL (*.vinted.net), null when none was found. */
  avatarUrl: string | null;
  /** The avatar, cached on this device (data:image/…), null until fetched. */
  avatarData: string | null;
  updatedAt: number;
}

type Json = Record<string, unknown>;
const isObj = (x: unknown): x is Json => typeof x === 'object' && x !== null && !Array.isArray(x);

/** A Vinted login as Vinted allows it: letters, digits, dot, dash, underscore, 1–40. */
export const isLogin = (x: unknown): x is string => typeof x === 'string' && /^[\w.-]{1,40}$/.test(x);

/** Only Vinted's own image servers, over https: anything else is ignored (never fetched). */
export function isVintedImage(x: unknown): x is string {
  if (typeof x !== 'string' || x.length > 600) return false;
  try {
    const u = new URL(x);
    return u.protocol === 'https:' && (u.hostname === 'vinted.net' || u.hostname.endsWith('.vinted.net'));
  } catch {
    return false;
  }
}

/** A cached avatar: a small base64 image, nothing else. */
export const isAvatarData = (x: unknown): x is string => typeof x === 'string' && x.length < 400_000 && /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(x);

/** The avatar of a Vinted user object: a thumbnail near 100 px when listed, else the photo's own URL. */
function avatarOf(u: Json): string | null {
  const photo = isObj(u.photo) ? u.photo : null;
  if (!photo) return null;
  const thumbs = Array.isArray(photo.thumbnails) ? photo.thumbnails.filter(isObj) : [];
  const sized = thumbs
    .map((t) => ({ url: t.url, w: typeof t.width === 'number' ? t.width : Number(String(t.type ?? '').replace(/\D/g, '')) || 0 }))
    .filter((t): t is { url: string; w: number } => isVintedImage(t.url))
    .sort((a, b) => Math.abs(a.w - 100) - Math.abs(b.w - 100));
  if (sized[0]) return sized[0].url;
  return isVintedImage(photo.url) ? photo.url : null;
}

/** From users/current ({ user: {…} } or the user itself). */
export function profileFromUser(json: unknown): { username: string; avatarUrl: string | null } | null {
  const u = isObj(json) && isObj(json.user) ? json.user : json;
  if (!isObj(u) || !isLogin(u.login)) return null;
  return { username: u.login, avatarUrl: avatarOf(u) };
}

/**
 * From the page's __NEXT_DATA__ (passive: the page Vinted already sent). The current user is looked for under the keys
 * a Next.js app keeps it in; a user object is only taken when it has a login AND is marked as the current one.
 */
export function profileFromNextData(json: unknown): { username: string; avatarUrl: string | null } | null {
  const seen = new Set<unknown>();
  const walk = (x: unknown, depth: number): { username: string; avatarUrl: string | null } | null => {
    if (!isObj(x) || depth > 8 || seen.has(x)) return null;
    seen.add(x);
    for (const k of ['currentUser', 'current_user', 'session']) {
      const v = x[k];
      const u = isObj(v) && isObj(v.user) ? v.user : v;
      if (isObj(u) && isLogin(u.login)) return { username: u.login, avatarUrl: avatarOf(u) };
    }
    for (const v of Object.values(x)) {
      const r = walk(v, depth + 1);
      if (r) return r;
    }
    return null;
  };
  return walk(json, 0);
}

/**
 * What a new reading changes: a new login replaces everything (another account); the same login keeps the cached
 * image unless the avatar URL changed. A reading with no login only brings an avatar to the account already known.
 */
export function mergeProfile(prev: VintedProfile | null, next: { username: string | null; avatarUrl: string | null }, now: number): VintedProfile | null {
  const username = next.username ?? prev?.username ?? null;
  if (!username || !isLogin(username)) return prev;
  const sameUser = !!prev && prev.username === username;
  const avatarUrl = next.avatarUrl ?? (sameUser ? prev.avatarUrl : null);
  const avatarData = sameUser && prev.avatarUrl === avatarUrl ? prev.avatarData : null;
  return { username, avatarUrl, avatarData, updatedAt: now };
}

/** A stored profile, validated before it is shown or written (Dexie holds what passes, nothing else). */
export function validProfile(x: unknown): VintedProfile | null {
  if (!isObj(x) || !isLogin(x.username) || typeof x.updatedAt !== 'number' || !Number.isFinite(x.updatedAt)) return null;
  return {
    username: x.username,
    avatarUrl: isVintedImage(x.avatarUrl) ? x.avatarUrl : null,
    avatarData: isAvatarData(x.avatarData) ? x.avatarData : null,
    updatedAt: x.updatedAt,
  };
}

/** The sidebar's header: the account once synced, else ERA's mark and « en attente d'import ». */
export function identity(p: VintedProfile | null): { name: string; avatar: string | null; synced: boolean } {
  return p ? { name: p.username, avatar: p.avatarData, synced: true } : { name: 'ERA', avatar: null, synced: false };
}
