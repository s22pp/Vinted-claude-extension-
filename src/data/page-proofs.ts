/**
 * What ERA does inside Vinted's own pages (the marks on listings, the replies written into a conversation) leaves no
 * trace in the journal: the content script notes here the first time — and the last time — it worked on this device.
 * That, and only that, takes the EXPERIMENTAL label off these two features.
 */
export const PAGE_PROOF_KEYS = { marks: 'eraMarksSeen', vreplies: 'eraRepliesSeen' } as const;
export type PageProof = keyof typeof PAGE_PROOF_KEYS;

export async function notePageProof(kind: PageProof): Promise<void> {
  const key = PAGE_PROOF_KEYS[kind];
  try {
    const cur = ((await browser.storage.local.get(key))[key] as { first: number; last: number } | undefined) ?? null;
    const now = Date.now();
    // At most once an hour: a page full of marks writes nothing more.
    if (cur && now - cur.last < 3_600_000) return;
    await browser.storage.local.set({ [key]: { first: cur?.first ?? now, last: now } });
  } catch {
    /* a proof never breaks the page */
  }
}
