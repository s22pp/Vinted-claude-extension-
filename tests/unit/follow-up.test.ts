import { describe, expect, it } from 'vitest';
import { followUpCandidates, followUpText, isDue, lastIsMine } from '@/intelligence/follow-up';
import type { ContactRow } from '@/intelligence/outcomes';

const H = 3_600_000;
const NOW = Date.UTC(2026, 10, 25, 12);
const row = (id: string, conv: string | null, hoursAgo: number, over: Partial<ContactRow> = {}): ContactRow => ({ id, at: NOW - hoursAgo * H, kind: 'FAV_OFFER', conversationId: conv, itemId: null, title: `Article ${id}`, variant: null, askCents: 5900, offerCents: 5400, delayMs: null, repliedAt: null, soldAt: null, soldCents: null, ...over });

describe('« Relance sans réponse »', () => {
  it('one per conversation (its latest contact), between 24 h and 72 h, unanswered, unsold, never twice', () => {
    const list = followUpCandidates(
      [row('a', '1', 30), row('a2', '1', 26), row('b', '2', 10), row('c', '3', 80), row('d', '4', 30, { repliedAt: NOW - H }), row('e', '5', 30, { soldAt: NOW }), row('f', '6', 30), row('g', null, 30), row('h', '7', 30, { kind: 'DELIVERED' })],
      new Set(['6']),
      NOW,
    );
    expect(list.map((f) => f.conversationId)).toEqual(['1', '2']);
    expect(list.find((f) => f.conversationId === '1')).toMatchObject({ title: 'Article a2' });
    expect(list.filter((f) => isDue(f, NOW)).map((f) => f.conversationId)).toEqual(['1']);
  });

  it('the offer said again when there was one, never a new price', () => {
    expect(followUpText({ title: 'Veste Harrington M', offerCents: 5400 })).toBe('Bonjour ! Je me permets de revenir vers vous pour « Veste Harrington M » : l’offre à 54 € tient toujours. Belle journée 🙂');
    expect(followUpText({ title: 'Pull', offerCents: null })).toContain('Toujours intéressé(e) par « Pull » ?');
  });

  it('only when the last message of the conversation is the seller’s own', () => {
    expect(lastIsMine([{ fromMe: false }, { fromMe: true }])).toBe(true);
    expect(lastIsMine([{ fromMe: true }, { fromMe: false }])).toBe(false);
    expect(lastIsMine([])).toBe(false);
  });
});

describe('human delay before a favourite is answered', () => {
  it('4 to 12 minutes by default, each favourite its own, the same at every pass', async () => {
    const { humanDelayMs } = await import('@/intelligence/automation');
    const delays = Array.from({ length: 200 }, (_, i) => humanDelayMs(`555:${i}`, 4) / 60_000);
    expect(Math.min(...delays)).toBeGreaterThanOrEqual(4);
    expect(Math.max(...delays)).toBeLessThanOrEqual(12);
    expect(new Set(delays).size).toBeGreaterThan(5);
    expect(humanDelayMs('555:101', 4)).toBe(humanDelayMs('555:101', 4));
  });
});
