import type { EraDatabase } from './db';

/**
 * A complete copy of ERA's local data, as one JSON file the seller keeps. ERA stores everything in this
 * browser only: a new computer, a reinstall or a cleared profile would lose it without a backup.
 * Restoring REPLACES the current data (after the seller's confirmation), all tables at once or nothing.
 */

export const BACKUP_FORMAT = 'era-intelligence-backup';
export const BACKUP_VERSION = 1;

/** Every table, in the order they are restored. */
export const BACKUP_TABLES = ['items', 'listings', 'observations', 'sales', 'events', 'analyses', 'predictions', 'decisions', 'activation', 'settings', 'purchases', 'preps', 'invoices', 'autoLog'] as const;
type TableName = (typeof BACKUP_TABLES)[number];

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  at: number;
  app: string;
  counts: Partial<Record<TableName, number>>;
  tables: Partial<Record<TableName, unknown[]>>;
}

export async function exportBackup(db: EraDatabase, appVersion: string, now = Date.now()): Promise<Backup> {
  const tables: Backup['tables'] = {};
  const counts: Backup['counts'] = {};
  await db.transaction('r', BACKUP_TABLES.map((t) => db.table(t)), async () => {
    for (const t of BACKUP_TABLES) {
      const rows = await db.table(t).toArray();
      tables[t] = rows;
      counts[t] = rows.length;
    }
  });
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, at: now, app: appVersion, counts, tables };
}

/** Reads a file's text as a backup; null with the reason when it is not one ERA can restore. */
export function parseBackup(text: string): { ok: true; backup: Backup } | { ok: false; reason: 'NOT_JSON' | 'NOT_ERA' | 'NEWER' } {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'NOT_JSON' };
  }
  const b = j as Partial<Backup>;
  if (!b || b.format !== BACKUP_FORMAT || typeof b.tables !== 'object' || b.tables === null) return { ok: false, reason: 'NOT_ERA' };
  if ((b.version ?? 0) > BACKUP_VERSION) return { ok: false, reason: 'NEWER' };
  return { ok: true, backup: b as Backup };
}

/** Replaces all local data with the backup's, in one transaction: all of it, or nothing if anything fails. */
export async function restoreBackup(db: EraDatabase, b: Backup): Promise<number> {
  let n = 0;
  await db.transaction('rw', BACKUP_TABLES.map((t) => db.table(t)), async () => {
    for (const t of BACKUP_TABLES) {
      await db.table(t).clear();
      const rows = Array.isArray(b.tables[t]) ? (b.tables[t] as unknown[]) : [];
      if (rows.length) await db.table(t).bulkPut(rows);
      n += rows.length;
    }
  });
  return n;
}
