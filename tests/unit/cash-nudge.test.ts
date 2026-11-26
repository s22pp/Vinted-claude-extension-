import { describe, expect, it } from 'vitest';
import { DEFAULT_NUDGE, nudgeCandidates } from '@/intelligence/cash-nudge';

const H = 3_600_000;
const now = 1_000 * H;
const sale = (id: string, status: string | null, sinceH: number | null, over: Record<string, unknown> = {}) => ({
  id,
  title: `Article ${id}`,
  status: 'COMPLETED',
  vintedStatus: status,
  vintedStatusSince: sinceH === null ? null : now - sinceH * H,
  vintedConversationId: `c${id}`,
  ...over,
});

describe('« Relance déblocage trésorerie »', () => {
  it('delivered 24 h ago or more, not validated, not nudged yet: the longest waiting first', () => {
    const r = nudgeCandidates([sale('a', 'Colis livré', 30), sale('b', 'Colis livré', 80), sale('c', 'Colis livré', 10)], new Set(), now);
    expect(r).toEqual([
      { saleId: 'b', title: 'Article b', conversationId: 'cb', hours: 80 },
      { saleId: 'a', title: 'Article a', conversationId: 'ca', hours: 30 },
    ]);
  });

  it('never: validated or closed, a claim open, on its way, a delivery time unknown, already nudged, refunded, too old', () => {
    const r = nudgeCandidates(
      [
        sale('done', 'Commande terminée', 50),
        sale('claim', 'Livré · réclamation en cours', 50),
        sale('way', 'En cours de livraison', 50),
        sale('unknown', 'Colis livré', null),
        sale('sent', 'Colis livré', 50),
        sale('refund', 'Colis livré', 50, { status: 'REFUNDED' }),
        sale('old', 'Colis livré', 24 * 20),
      ],
      new Set(['sent']),
      now,
    );
    expect(r).toEqual([]);
  });

  it('the message asks, kindly, to validate the order: no price, no pressure, no link off Vinted', () => {
    expect(DEFAULT_NUDGE).toContain('valider la commande');
    expect(DEFAULT_NUDGE).not.toMatch(/€|http|whatsapp|paypal/i);
  });
});
