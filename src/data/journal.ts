import { type AutoLogRow, db, uid } from './db';

/**
 * The local journal of what ERA sent to Vinted (or simulated), and what Vinted answered. It is the only proof that a
 * route works on this account: kept short, but never at the cost of that proof.
 */

export const JOURNAL_MAX = 600;
export const JOURNAL_KEEP = 500;

/** Sent and accepted, but not shown back by Vinted (rows before 0.31.1 said it only in their detail). */
export const isUnconfirmed = (r: Pick<AutoLogRow, 'unconfirmed' | 'detail'>) => r.unconfirmed === true || /non (vérifié|confirmé)/.test(r.detail);

/** Accepted by Vinted and shown back, for real (a simulation never proves anything). */
export const isVerified = (r: Pick<AutoLogRow, 'ok' | 'dryRun' | 'unconfirmed' | 'detail'>) => r.ok && !r.dryRun && !isUnconfirmed(r);

export async function journal(row: Omit<AutoLogRow, 'id' | 'at'>, at = Date.now()): Promise<void> {
  await db.autoLog.put({ id: uid('al'), at, ...row });
  await pruneJournal();
}

/**
 * Past JOURNAL_MAX lines, the oldest go down to JOURNAL_KEEP — except, for each route, its latest verified success and
 * its latest failure: what the Integrations card and the flags next to each action stand on.
 */
export async function pruneJournal(): Promise<void> {
  const n = await db.autoLog.count();
  if (n <= JOURNAL_MAX) return;
  const rows = await db.autoLog.orderBy('at').toArray();
  const keep = new Set<string>();
  const proved = new Set<string>();
  const failed = new Set<string>();
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]!;
    if (r.dryRun) continue;
    if (isVerified(r) && !proved.has(r.kind)) {
      proved.add(r.kind);
      keep.add(r.id);
    } else if (!r.ok && !failed.has(r.kind)) {
      failed.add(r.kind);
      keep.add(r.id);
    }
  }
  const drop = rows.slice(0, n - JOURNAL_KEEP).filter((r) => !keep.has(r.id));
  if (drop.length) await db.autoLog.bulkDelete(drop.map((r) => r.id));
}
