import { describe, expect, it } from 'vitest';
import { type ContactRow, MIN_SAMPLE, bestOf, delayTable, inboxActivity, messageTable, offerTable, rateOf, repliedIn, repostTable, saleAfter } from '@/intelligence/outcomes';

const H = 3_600_000;
const D = 24 * H;
const NOW = Date.UTC(2026, 10, 17, 12);
let n = 0;
const c = (p: Partial<ContactRow>): ContactRow => ({ id: `c${n++}`, at: NOW - 20 * D, kind: 'FAV_MESSAGE', conversationId: 'cv1', itemId: 'i1', title: 'Veste', variant: 'Bonjour {pseudo}', askCents: 4000, offerCents: null, delayMs: null, repliedAt: null, soldAt: null, soldCents: null, ...p });

describe('outcomes: what followed a contact', () => {
  it('a sale of the article within 14 days after the contact, never before it nor long after', () => {
    const sales = [
      { inventoryItemId: 'i1', soldAt: NOW - 30 * D, salePriceCents: 3000 },
      { inventoryItemId: 'i1', soldAt: NOW - 15 * D, salePriceCents: 3600 },
      { inventoryItemId: 'i2', soldAt: NOW - 19 * D, salePriceCents: 1000 },
    ];
    expect(saleAfter(c({}), sales)).toEqual({ soldAt: NOW - 15 * D, cents: 3600 });
    expect(saleAfter(c({ at: NOW - 50 * D }), sales)).toBeNull();
    expect(saleAfter(c({ at: NOW - 10 * D }), sales)).toBeNull();
    expect(saleAfter(c({ itemId: null }), sales)).toBeNull();
  });

  it('an answer read in the inbox: a later message of the buyer, or an unread conversation when the author is unknown', () => {
    const inbox = inboxActivity(
      {
        conversations: [
          { id: 1, updated_at: new Date(NOW - 10 * D).toISOString(), last_message: { user_id: 99 } },
          { id: 2, updated_at: new Date(NOW - 10 * D).toISOString(), last_message: { user_id: 7 } },
          { id: 3, updated_at: new Date(NOW - 10 * D).toISOString(), is_unread: true },
          { id: 4, updated_at: new Date(NOW - 20 * D + 30_000).toISOString(), last_message: { user_id: 99 } },
        ],
      },
      '7',
    );
    expect(repliedIn(c({ conversationId: '1' }), inbox)).toBe(true);
    expect(repliedIn(c({ conversationId: '2' }), inbox)).toBe(false); // the seller wrote last
    expect(repliedIn(c({ conversationId: '3' }), inbox)).toBe(true);
    expect(repliedIn(c({ conversationId: '4' }), inbox)).toBe(false); // ERA's own message, not an answer
    expect(repliedIn(c({ conversationId: '5' }), inbox)).toBe(false);
  });
});

describe('outcomes: rates only on enough settled contacts', () => {
  it('young contacts wait; below the minimum a count, never a rate', () => {
    const r = rateOf([c({ repliedAt: NOW - 19 * D }), c({}), c({ at: NOW - H })], NOW);
    expect(r).toMatchObject({ n: 3, replyN: 2, replied: 1, replyPct: null });
    const many = [...Array.from({ length: 3 }, () => c({ repliedAt: NOW - 19 * D, soldAt: NOW - 18 * D })), ...Array.from({ length: 3 }, () => c({}))];
    expect(rateOf(many, NOW)).toMatchObject({ replyN: 6, replied: 3, replyPct: 50, soldPct: 50 });
    expect(MIN_SAMPLE).toBe(5);
  });

  it('messages compared wording by wording; the best only when it rests on enough and beats the others', () => {
    const a = Array.from({ length: 5 }, (_, i) => c({ variant: 'A', repliedAt: i < 4 ? NOW - 19 * D : null }));
    const b = Array.from({ length: 5 }, (_, i) => c({ variant: 'B', repliedAt: i < 1 ? NOW - 19 * D : null }));
    const t = messageTable([...a, ...b, c({ kind: 'FAV_OFFER', variant: null })], NOW);
    expect(t.map((x) => [x.variant, x.replyPct])).toEqual([
      ['A', 80],
      ['B', 20],
    ]);
    expect(bestOf(t, 'replyPct')?.variant).toBe('A');
    expect(bestOf(t.slice(0, 1), 'replyPct')).toBeNull();
  });

  it('offers by depth: 90 % of the price is not 80 %', () => {
    const t = offerTable([c({ kind: 'FAV_OFFER', offerCents: 3800 }), c({ kind: 'FAV_OFFER', offerCents: 3000, soldAt: NOW - 18 * D }), c({ kind: 'OFFER_COUNTER', offerCents: 3400 })], NOW);
    expect(t.map((x) => [x.kind, x.bracket, x.n, x.sold])).toEqual([
      ['FAV_OFFER', 'ge95', 1, 0],
      ['FAV_OFFER', 'lt80', 1, 1],
      ['OFFER_COUNTER', 'ge85', 1, 0],
    ]);
  });

  it('delays from the favourite to the message, in buckets', () => {
    const t = delayTable([c({ delayMs: 20 * 60_000 }), c({ delayMs: 3 * H }), c({ delayMs: 2 * D }), c({ kind: 'DELIVERED', delayMs: H })], NOW);
    expect(t.map((x) => [x.bucket, x.n])).toEqual([
      ['h1', 1],
      ['h6', 1],
      ['d3', 1],
    ]);
  });

  it('reposts: how long the previous listing was online, and whether the new one sold within 14 days', () => {
    const l = (item: string, listedDaysAgo: number, soldDaysAgo: number | null, known = true) => ({ inventoryItemId: item, listedAt: NOW - listedDaysAgo * D, listedAtKnown: known, soldAt: soldDaysAgo === null ? null : NOW - soldDaysAgo * D });
    const t = repostTable([l('a', 100, null), l('a', 80, 77), l('b', 60, null), l('b', 20, null), l('c', 50, null), l('c', 5, null), l('d', 90, null, false), l('d', 30, null)], NOW);
    expect(t).toEqual([
      { bucket: 'd30', n: 1, sold: 1, soldPct: null, medianDays: 3 },
      { bucket: 'd60', n: 1, sold: 0, soldPct: null, medianDays: null },
    ]);
  });
});
