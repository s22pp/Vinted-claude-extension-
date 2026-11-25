import { PROFILE_KEY, type VintedProfile, isAvatarData, isLogin, isVintedImage, mergeProfile, validProfile } from '@/intelligence/profile';
import { db } from './db';

/** The stored profile, validated (null when none). */
export async function storedProfile(): Promise<VintedProfile | null> {
  return validProfile((await db.settings.get(PROFILE_KEY))?.value);
}

/** Vinted's avatar fetched once (Vinted's image servers only) and kept as a small data URL; null when it fails. */
async function cacheAvatar(url: string): Promise<string | null> {
  if (!isVintedImage(url)) return null;
  try {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!/^image\/(png|jpe?g|webp|gif)$/.test(blob.type) || blob.size > 250_000) return null;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const data = `data:${blob.type};base64,${btoa(bin)}`;
    return isAvatarData(data) ? data : null;
  } catch {
    return null;
  }
}

/**
 * Background-only. A reading of the seller's identity (users/current on « Actualiser », or a Vinted page the seller
 * opened): merged with what is known, the avatar cached when new, written to Dexie only once validated.
 */
export async function syncProfile(next: { username: string | null; avatarUrl: string | null }, now = Date.now()): Promise<VintedProfile | null> {
  const clean = { username: isLogin(next.username) ? next.username : null, avatarUrl: isVintedImage(next.avatarUrl) ? next.avatarUrl : null };
  const prev = await storedProfile();
  const merged = mergeProfile(prev, clean, now);
  if (!merged) return prev;
  if (merged.avatarUrl && !merged.avatarData) merged.avatarData = await cacheAvatar(merged.avatarUrl);
  const ok = validProfile(merged);
  if (!ok) return prev;
  // Nothing new: no write (a passive reading on every page must not churn the database).
  if (prev && prev.username === ok.username && prev.avatarUrl === ok.avatarUrl && prev.avatarData === ok.avatarData) return prev;
  await db.settings.put({ key: PROFILE_KEY, value: ok });
  await db.settings.put({ key: 'vintedLogin', value: ok.username });
  return ok;
}
