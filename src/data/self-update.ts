import { isNewer } from '@/intelligence/version';

/**
 * ERA updating itself, for the install loaded from a folder that the seller's updater keeps current (scripts/mac):
 * the folder gets the new version, ERA sees it and reloads itself — only when nothing runs (no Vinted operation, no
 * round) and none of its pages is open (a reload closes them); else the dashboard offers « Redémarrer ERA ».
 */

export const UPDATE_ALARM = 'era-update';
/** Set just before the reload: the version left and the one coming, and whether to open the dashboard again. */
export const UPDATED_KEY = 'eraUpdated';

export interface Updated {
  from: string;
  to: string;
  at: number;
  reopen: boolean;
}

/** ERA loaded from a folder (Chrome's "unpacked"): the only install whose files change under it. */
export async function fromFolder(): Promise<boolean> {
  try {
    return (await browser.management.getSelf()).installType === 'development';
  } catch {
    return false;
  }
}

/** The version in ERA's folder now (the updater may have replaced it); null when unreadable. */
export async function versionOnDisk(): Promise<string | null> {
  try {
    const r = await fetch(`${(browser.runtime.getURL as (p: string) => string)('/manifest.json')}?t=${Date.now()}`, { cache: 'no-store' });
    const m = (await r.json()) as { version?: unknown };
    return typeof m.version === 'string' ? m.version : null;
  } catch {
    return null;
  }
}

/** One of ERA's pages is open (dashboard tab, side panel, popup): an automatic reload would close it. */
export async function pagesOpen(): Promise<boolean> {
  const rt = browser.runtime as unknown as { getContexts?: (f: { contextTypes: string[] }) => Promise<unknown[]> };
  if (!rt.getContexts) return true;
  return (await rt.getContexts({ contextTypes: ['TAB', 'SIDE_PANEL', 'POPUP'] })).length > 0;
}

export interface UpdateState {
  running: string;
  onDisk: string | null;
  /** A newer version waits in the folder: a reload takes it. */
  ready: boolean;
}

export async function updateState(): Promise<UpdateState> {
  const running = browser.runtime.getManifest().version;
  if (!(await fromFolder())) return { running, onDisk: null, ready: false };
  const onDisk = await versionOnDisk();
  return { running, onDisk, ready: isNewer(onDisk, running) };
}

/** Reloads ERA on the new version, remembering it to say so once restarted. */
export async function reloadOnto(s: UpdateState, reopen: boolean): Promise<void> {
  await browser.storage.local.set({ [UPDATED_KEY]: { from: s.running, to: s.onDisk!, at: Date.now(), reopen } satisfies Updated });
  browser.runtime.reload();
}

/** At the worker's start: the update just taken, if any (said once, then forgotten). */
export async function justUpdated(): Promise<Updated | null> {
  const got = ((await browser.storage.local.get(UPDATED_KEY)) as Record<string, Updated | undefined>)[UPDATED_KEY];
  if (!got) return null;
  await browser.storage.local.remove(UPDATED_KEY);
  return got.to === browser.runtime.getManifest().version ? got : null;
}
