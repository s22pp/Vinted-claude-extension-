import { type ContactRow, REPLY_WINDOW_MS, SOLD_WINDOW_MS, inboxActivity, repliedIn, saleAfter } from '@/intelligence/outcomes';
import { db, uid } from './db';

/**
 * The contacts database: one row per message, offer or answer ERA really sent (never a simulation), settled later
 * with what followed. Local only, like the rest of ERA's data (and in the backups).
 */
export async function recordContact(c: Omit<ContactRow, 'id' | 'repliedAt' | 'soldAt' | 'soldCents'>): Promise<void> {
  await db.contacts.put({ id: uid('ct'), repliedAt: null, soldAt: null, soldCents: null, ...c, variant: c.variant ? c.variant.trim().slice(0, 400) : null });
}

/** The inbox last read by an automation (page 1), kept for this worker's life: answers are read from it, no extra call. */
let lastInbox: { at: number; json: unknown; me: string | null } | null = null;
export function noteInbox(json: unknown, me: string | null, now = Date.now()): void {
  lastInbox = { at: now, json, me };
}
/** The inbox read less than `maxAgeMs` ago, if any. */
export const recentInbox = (now: number, maxAgeMs = 30 * 60_000) => (lastInbox && now - lastInbox.at <= maxAgeMs ? lastInbox : null);

/** Contacts still waiting for an answer (young enough to get one). */
export async function awaitingReply(now = Date.now()): Promise<number> {
  return db.contacts.where('at').above(now - 7 * 86_400_000).filter((c) => c.repliedAt === null && !!c.conversationId).count();
}

/**
 * Settles what can be: a sale of the article (from the sales ERA holds, no call), an answer (from an inbox read, when
 * one is given). Returns how many contacts got an outcome now.
 */
export async function settleContacts(inbox: { json: unknown; me: string | null } | null, now = Date.now()): Promise<{ replied: number; sold: number }> {
  const open = await db.contacts.where('at').above(now - Math.max(SOLD_WINDOW_MS, REPLY_WINDOW_MS) - 7 * 86_400_000).filter((c) => c.soldAt === null || c.repliedAt === null).toArray();
  if (!open.length) return { replied: 0, sold: 0 };
  const sales = await db.sales.filter((s) => !s.isDemo).toArray();
  const activity = inbox ? inboxActivity(inbox.json, inbox.me) : null;
  let replied = 0;
  let sold = 0;
  for (const c of open) {
    const patch: Partial<ContactRow> = {};
    if (c.soldAt === null) {
      const s = saleAfter(c, sales);
      if (s) {
        patch.soldAt = s.soldAt;
        patch.soldCents = s.cents;
        sold++;
      }
    }
    if (c.repliedAt === null && activity && repliedIn(c, activity)) {
      patch.repliedAt = activity.get(c.conversationId!)!.updatedAt;
      replied++;
    }
    if (Object.keys(patch).length) await db.contacts.update(c.id, patch);
  }
  return { replied, sold };
}

/** An answer read in the conversation itself (a reply ERA prepared reads it anyway): settles that contact for sure. */
export async function markReplied(conversationId: string, at: number): Promise<void> {
  const rows = await db.contacts.where('conversationId').equals(conversationId).filter((c) => c.repliedAt === null && c.at < at - 60_000).toArray();
  for (const r of rows) await db.contacts.update(r.id, { repliedAt: at });
}
