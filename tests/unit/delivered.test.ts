import { describe, expect, it } from 'vitest';
import { DEFAULT_DELIVERED, deliveredText, isDelivered, planDelivered } from '@/intelligence/delivered';

const DAY = 86_400_000;
const NOW = new Date(2026, 9, 1, 20, 30).getTime();
const order = (status: string | null, x: Partial<{ title: string; date: number | null; conversationId: string | null; transactionId: string | null }> = {}) => ({ title: 'Veste Harrington Ralph Lauren M', status, date: NOW - 3 * DAY, conversationId: '9301', transactionId: '7301', ...x });

describe('parcel delivered → one message to the buyer', () => {
  it('delivered read strictly: "livré", "livrée", "récupéré"; never on its way, planned, cancelled or already validated', () => {
    for (const s of ['Colis livré', 'Commande livrée', 'Livré, en attente de confirmation de l’acheteur', 'Colis récupéré par l’acheteur', 'Delivered']) expect(isDelivered(s)).toBe(true);
    for (const s of ['En cours de livraison', 'Livraison prévue le 3 oct.', 'Colis non livré', 'Commande terminée', 'Annulée', 'Remboursée', 'En attente d’envoi', 'Envoyé', null]) expect(isDelivered(s)).toBe(false);
  });

  it('once per order: an order already messaged is left out; one without a conversation is said, never sent', () => {
    const orders = [order('Colis livré'), order('Colis livré', { conversationId: null, transactionId: null, title: 'Jean Levi’s' }), order('Envoyé', { conversationId: '9302' })];
    const plan = planDelivered(orders, new Set(), NOW);
    expect(plan.map((p) => [p.order.title, p.send])).toEqual([
      ['Veste Harrington Ralph Lauren M', true],
      ['Jean Levi’s', false],
    ]);
    expect(plan[1]).toMatchObject({ reason: 'NO_CONVERSATION' });
    expect(planDelivered(orders, new Set(['c:9301']), NOW).filter((p) => p.send)).toEqual([]);
  });

  it('an old order is never messaged, whatever its status says', () => {
    expect(planDelivered([order('Colis livré', { date: NOW - 30 * DAY })], new Set(), NOW)).toMatchObject([{ send: false, reason: 'TOO_OLD' }]);
  });

  it('the seller’s message: good evening after 18 h, good day before; {article} filled', () => {
    expect(deliveredText(DEFAULT_DELIVERED, { title: 'Veste' }, NOW)).toMatch(/Bonne soirée !$/);
    expect(deliveredText(DEFAULT_DELIVERED, { title: 'Veste' }, new Date(2026, 9, 1, 9, 0).getTime())).toMatch(/Bonne journée !$/);
    expect(deliveredText('Votre {article} est arrivé ! {salutation}', { title: 'Veste Harrington' }, NOW)).toBe('Votre Veste Harrington est arrivé ! Bonne soirée');
    expect(DEFAULT_DELIVERED).toMatch(/valider la commande/);
    expect(DEFAULT_DELIVERED).toMatch(/évaluation/);
    expect(DEFAULT_DELIVERED).toMatch(/abonner à mon compte/);
  });
});
