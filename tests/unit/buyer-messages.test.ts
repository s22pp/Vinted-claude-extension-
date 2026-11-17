import { describe, expect, it } from 'vitest';
import { messageTopic, planReply, readConversation, replyKey, replyVerdict } from '@/intelligence/buyer-messages';

const NOW = Date.UTC(2026, 10, 17, 12);
const H = 3_600_000;
const conv = (msgs: [string, number, string][], tx: object | null = null) =>
  readConversation({ conversation: { messages: msgs.map(([who, hoursAgo, body], i) => ({ id: 100 + i, entity_type: 'message', entity: { body, user_id: who === 'me' ? 7 : 99 }, created_at_ts: (NOW - hoursAgo * H) / 1000 })), transaction: tx, item: { id: 555 } } }, '7');

describe('buyer messages: read, sorted, answered only when sure', () => {
  it('a conversation as Vinted returns it: messages in order, who wrote them, the listing', () => {
    const c = conv([['them', 5, 'Bonjour'], ['me', 4, 'Bonjour !'], ['them', 1, 'Elle taille comment ?']]);
    expect(c.messages.map((m) => [m.fromMe, m.body])).toEqual([[false, 'Bonjour'], [true, 'Bonjour !'], [false, 'Elle taille comment ?']]);
    expect(c.itemVintedId).toBe('555');
    expect(c.messages[2]!.at).toBe(NOW - H);
  });

  it('what is never answered by a machine: a problem with an order, contact off Vinted, an amount', () => {
    expect(messageTopic('Bonjour, l’article est arrivé abîmé, je veux un remboursement')).toBe('SENSITIVE');
    expect(messageTopic('Je ne l’ai jamais reçu')).toBe('SENSITIVE');
    expect(messageTopic('Vous avez WhatsApp ?')).toBe('CONTACT');
    expect(messageTopic('Je vous propose 30 €')).toBe('OFFER');
    expect(messageTopic('Vous faites un lot avec le pull ?')).toBe('OFFER');
    expect(messageTopic('Elle taille comment ? Je l’ai trouvé super')).toBe('QUESTION');
    expect(messageTopic('Elle est attachée comment, la capuche ?')).toBe('QUESTION');
  });

  it('answered: the buyer wrote last, recently, a plain question, once', () => {
    const c = conv([['me', 5, 'Bonjour !'], ['them', 2, 'Bonjour'], ['them', 1, 'Quelle est la taille exacte ?']]);
    const p = planReply(c, 'cv1', new Set(), NOW);
    expect(p).toEqual({ send: true, buyerText: 'Bonjour\nQuelle est la taille exacte ?', messageId: '102' });
    expect(planReply(c, 'cv1', new Set([replyKey('cv1', c.messages[2]!)]), NOW)).toEqual({ send: false, reason: 'ANSWERED' });
  });

  it('left to the seller: they wrote last, too old, sensitive, an order under way', () => {
    expect(planReply(conv([['them', 2, 'Taille ?'], ['me', 1, 'M']]), 'c', new Set(), NOW)).toEqual({ send: false, reason: 'SELLER_LAST' });
    expect(planReply(conv([['them', 80, 'Taille ?']]), 'c', new Set(), NOW)).toEqual({ send: false, reason: 'TOO_OLD' });
    expect(planReply(conv([['them', 1, 'Le colis est perdu ?']]), 'c', new Set(), NOW)).toEqual({ send: false, reason: 'SENSITIVE' });
    expect(planReply(conv([['them', 1, 'Vous l’envoyez quand ?']], { id: 1, status_title: 'Payé, à envoyer' }), 'c', new Set(), NOW)).toEqual({ send: false, reason: 'ORDER' });
  });

  it('a drafted answer leaves only when it says nothing unsure and promises nothing', () => {
    expect(replyVerdict('Bonjour ! Elle est en taille M, en très bon état.', [])).toBe('OK');
    expect(replyVerdict('Bonjour, je vérifie et je reviens vers vous.', [])).toBe('DEFER');
    expect(replyVerdict('Bonjour, elle mesure 70 cm.', [{ kind: 'NUMBER' }])).toBe('UNSURE');
  });
});

describe('messages waiting for the seller, in ERA', () => {
  const p = (conv: string, at: number, buyer = 'Taille ?'): import('@/intelligence/buyer-messages').PendingReply => ({ key: `${conv}:${at}`, conversationId: conv, at, title: 'Veste', buyer, draft: null, why: 'SENSITIVE' });
  it('one per conversation, the latest; none older than 7 days', async () => {
    const { mergePending } = await import('@/intelligence/buyer-messages');
    const l = mergePending([p('a', NOW - 2 * H), p('b', NOW - 8 * 24 * H)], p('a', NOW - H, 'Et la couleur ?'), NOW);
    expect(l.map((x) => [x.conversationId, x.buyer])).toEqual([['a', 'Et la couleur ?']]);
  });
  it('gone once the seller wrote in the conversation since', async () => {
    const { prunePending } = await import('@/intelligence/buyer-messages');
    const inbox = new Map([['a', { updatedAt: NOW - H, fromOther: false }], ['b', { updatedAt: NOW - H, fromOther: true }]]);
    expect(prunePending([p('a', NOW - 2 * H), p('b', NOW - 2 * H), p('c', NOW - 2 * H)], inbox, NOW).map((x) => x.conversationId)).toEqual(['b', 'c']);
  });
});
