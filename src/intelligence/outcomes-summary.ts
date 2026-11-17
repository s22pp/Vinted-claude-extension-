import { type ContactRow, bestOf, delayTable, messageTable, offerTable, repostTable } from './outcomes';

type T = (key: string, params?: Record<string, string | number>) => string;
type ListingLike = Parameters<typeof repostTable>[0][number];

const short = (s: string) => (s.length > 90 ? `${s.slice(0, 88)}…` : s);

/**
 * What worked, as sentences — only the conclusions resting on enough contacts and beating the others: the message that
 * gets the most answers, the offer that makes people buy, the delay after a favourite, the moment to repost.
 * Shared by the card and the week's task.
 */
export function bestLines(contacts: readonly ContactRow[], listings: readonly ListingLike[], now: number, t: T): string[] {
  const m = bestOf(messageTable(contacts, now), 'replyPct');
  const o = bestOf(offerTable(contacts, now), 'soldPct');
  const d = bestOf(delayTable(contacts, now), 'replyPct');
  const r = bestOf(repostTable(listings, now), 'soldPct');
  return [
    m && t('outcomes.bestMessage', { text: short(m.variant), pct: m.replyPct! }),
    o && t('outcomes.bestOffer', { kind: t(`outcomes.kind.${o.kind}`), depth: t(`outcomes.bracket.${o.bracket}`), pct: o.soldPct! }),
    d && t('outcomes.bestDelay', { delay: t(`outcomes.delay.${d.bucket}`), pct: d.replyPct! }),
    r && t('outcomes.bestRepost', { gap: t(`outcomes.gap.${r.bucket}`), pct: r.soldPct! }),
  ].filter((x): x is string => !!x);
}
