import { exportBackup } from './backup';
import { db } from './db';
import { saveFile } from './downloads';
import { repo } from './repo';

/**
 * Automatic backup: a full copy of ERA's data (articles, sales, costs, history, settings) written as a dated file
 * in Téléchargements/ERA-sauvegardes, every day or every week. Off until the seller switches it on; real data
 * only (the demo is never saved); nothing leaves the computer. A second copy the same day replaces the first.
 */

export const AUTO_BACKUP_KEY = 'autoBackup';
/** Shared with the manual backup: the last time a copy was saved, either way. */
export const LAST_BACKUP_KEY = 'lastBackupAt';

export interface AutoBackupConfig {
  enabled: boolean;
  everyDays: 1 | 7;
}
export const AUTO_BACKUP_DEFAULTS: AutoBackupConfig = { enabled: false, everyDays: 7 };

export async function loadAutoBackup(): Promise<AutoBackupConfig> {
  return { ...AUTO_BACKUP_DEFAULTS, ...(await repo.getSetting<Partial<AutoBackupConfig> | null>(AUTO_BACKUP_KEY, null)) };
}

/** A copy is due when none was saved, or the last one is older than the chosen period (an hour of slack). */
export function backupDue(last: number | null, everyDays: number, now: number): boolean {
  return last === null || now - last >= everyDays * 86_400_000 - 3_600_000;
}

export function backupFileName(now: number): string {
  return `ERA-sauvegardes/era-sauvegarde-${new Date(now).toISOString().slice(0, 10)}.json`;
}

/** Text as a data: URL (a service worker has no Blob URLs), UTF-8 safe, encoded in chunks. */
export function jsonDataUrl(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:application/json;base64,${btoa(bin)}`;
}

export type AutoBackupResult = { ok: true; file: string } | { ok: false; reason: 'OFF' | 'NOT_DUE' | 'NOT_REAL' | 'FAILED'; detail?: string };

export async function runAutoBackup(now = Date.now(), force = false): Promise<AutoBackupResult> {
  const cfg = await loadAutoBackup();
  if (!cfg.enabled && !force) return { ok: false, reason: 'OFF' };
  if ((await repo.getSetting('dataMode', 'empty')) !== 'real') return { ok: false, reason: 'NOT_REAL' };
  if (!force && !backupDue(await repo.getSetting<number | null>(LAST_BACKUP_KEY, null), cfg.everyDays, now)) return { ok: false, reason: 'NOT_DUE' };
  const backup = await exportBackup(db, browser.runtime.getManifest().version, now);
  const saved = await saveFile(jsonDataUrl(JSON.stringify(backup)), backupFileName(now), 30_000, 'overwrite');
  if (!saved.ok) return { ok: false, reason: 'FAILED', detail: saved.detail };
  await repo.setSetting(LAST_BACKUP_KEY, now);
  return { ok: true, file: saved.file };
}
