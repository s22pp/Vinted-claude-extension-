import { describe, expect, it } from 'vitest';
import { DEFAULT_FAV_NO_OFFER, DEFAULT_FAV_OFFER, FAV_PRESETS, articleOf, cleanTitle, pickMessage } from '@/intelligence/fav-messages';
import { DEFAULT_AUTO, type PendingOffer, decideOffer, favoriteOffer, fillTemplate, floorFor, parseFavoriteNotifications, parseInboxOffers, planFavorite, withDefaults } from '@/intelligence/automation';

const NOW = Date.UTC(2026, 8, 25, 12);
const cfg = withDefaults({ fav: { ...DEFAULT_AUTO.fav, enabled: true }, offers: { ...DEFAULT_AUTO.offers, enabled: true } });

describe('new favourites', () => {
  const json = {
    code: 0,
    notifications: [
      { entry_type: 20, link: 'vintedfr://member?id=555', subject_id: 101, updated_at: new Date(NOW - 60 * 60_000).toISOString() },
      { entry_type: 5, link: 'x?id=1', subject_id: 1, updated_at: new Date(NOW).toISOString() }, // not a favourite
      { entry_type: 20, link: 'no-user', subject_id: 102, updated_at: new Date(NOW).toISOString() }, // unreadable member
    ],
  };

  it('reads only favourite notifications, with member and item', () => {
    expect(parseFavoriteNotifications(json)).toEqual([{ key: '555:101', userId: '555', itemId: '101', at: NOW - 60 * 60_000 }]);
    expect(parseFavoriteNotifications({})).toEqual([]);
  });

  it('waits a little, never twice, never late, within the daily cap', () => {
    const [n] = parseFavoriteNotifications(json);
    const item = { title: 'Veste', priceCents: 5900, costCents: 1800 };
    const ctx = { seen: new Set<string>(), sentToday: 0, now: NOW };
    expect(planFavorite(n!, item, cfg, ctx)).toEqual({ send: true, message: true, offerCents: 5400, note: null });
    expect(planFavorite(n!, item, cfg, { ...ctx, seen: new Set(['555:101']) })).toMatchObject({ send: false, reason: 'SEEN' });
    expect(planFavorite(n!, item, cfg, { ...ctx, now: n!.at + 5 * 60_000 })).toMatchObject({ send: false, reason: 'TOO_RECENT', final: false });
    expect(planFavorite(n!, item, cfg, { ...ctx, now: n!.at + 4 * 86_400_000 })).toMatchObject({ send: false, reason: 'TOO_OLD', final: true });
    expect(planFavorite(n!, item, cfg, { ...ctx, sentToday: cfg.fav.perDay })).toMatchObject({ send: false, reason: 'DAY_CAP' });
  });

  it('offers the discount, never under cost + margin, never without a known cost', () => {
    expect(favoriteOffer({ title: 'a', priceCents: 5900, costCents: 1800 }, cfg).cents).toBe(5400); // −10 % = 53,10 → 54 €
    expect(favoriteOffer({ title: 'a', priceCents: 2000, costCents: 1700 }, cfg).cents).toBeNull(); // floor 20 € = price
    expect(favoriteOffer({ title: 'a', priceCents: 2500, costCents: 1900 }, cfg).cents).toBe(2300); // floor 22 € beats −10 %
    expect(favoriteOffer({ title: 'a', priceCents: 5900, costCents: null }, cfg)).toMatchObject({ cents: null });
    expect(favoriteOffer(null, cfg).cents).toBeNull();
    expect(floorFor(null, cfg)).toBeNull();
  });

  it('fills the message, and a missing name leaves no hole', () => {
    expect(fillTemplate(FAV_PRESETS[0]!.text, { pseudo: 'alice', titre: 'Veste Harrington Ralph Lauren M', article: 'la veste Ralph Lauren', prix: 5900, prixOffre: 5400 })).toBe(
      'Hello ! J’ai vu ton favori sur la veste Ralph Lauren 🙂 Je te fais 54 € au lieu de 59 €, l’offre t’attend dans la conversation.',
    );
    expect(fillTemplate('Bonjour {pseudo} ! {titre}', { pseudo: null, titre: 'Veste', prix: null, prixOffre: null })).toBe('Bonjour ! Veste');
    // A sentence opened by a variable starts with a capital.
    expect(fillTemplate('{article} : toujours dispo !', { pseudo: null, titre: 'x', article: 'les baskets Nike', prix: null, prixOffre: null })).toBe('Les baskets Nike : toujours dispo !');
  });
});

describe('offers received', () => {
  const inbox = {
    conversations: [
      { id: 9100, transaction: { id: 7100, item_id: 101, item_title: 'Veste', item_price: { amount: '59.0' }, offer: { id: 8100, status: 'pending', price: { amount: '40.0' }, user_id: 556 } } },
      { id: 9101, transaction: { id: 7101, item_id: 102, item_price: { amount: '30.0' }, offer: { id: 8101, status: 'accepted', price: { amount: '28.0' } } } },
      { id: 9102, transaction: { id: 7102, item_id: 103, item_price: { amount: '30.0' }, offer: { id: 8102, status: 'pending', price: { amount: '25.0' }, user_id: 177293623 } } }, // mine
    ],
  };

  it('keeps only pending offers from buyers', () => {
    expect(parseInboxOffers(inbox, '177293623')).toEqual([{ offerId: '8100', conversationId: '9100', transactionId: '7100', itemId: '101', itemTitle: 'Veste', itemPriceCents: 5900, offerCents: 4000 }]);
  });

  const o = (offer: number, price = 5000): PendingOffer => ({ offerId: '1', conversationId: '2', transactionId: '3', itemId: '4', itemTitle: 't', itemPriceCents: price, offerCents: offer });
  it('accepts high, rejects low, counters once in between', () => {
    expect(decideOffer(o(4600), null, cfg, false).action).toBe('ACCEPT'); // 92 %
    expect(decideOffer(o(2500), null, cfg, false).action).toBe('REJECT'); // 50 %
    expect(decideOffer(o(4000), null, cfg, false)).toMatchObject({ action: 'COUNTER', counterCents: 4600 }); // 80 % → 92 %
    expect(decideOffer(o(4000), null, cfg, true).action).toBe('SKIP');
  });

  it('never accepts nor counters under the floor', () => {
    // 92 % of the price but under cost + margin: a counter at the floor, not an acceptance.
    expect(decideOffer(o(4600), 4800, cfg, false)).toMatchObject({ action: 'COUNTER', counterCents: 4800 });
    expect(decideOffer(o(4600), 4800, cfg, true).action).toBe('SKIP');
    // A counter that would not beat their offer: their offer is accepted (it is above the floor).
    expect(decideOffer(o(4400, 4700), 3000, cfg, false)).toMatchObject({ action: 'ACCEPT' });
  });
});

describe('favourite messages that read like a person', () => {
  it('names the article the way people say it, never with the size or ERA’s reference', () => {
    expect(articleOf('Veste Harrington Ralph Lauren M E1C4G', 'Ralph Lauren')).toBe('la veste Ralph Lauren');
    expect(articleOf('Pull col roulé laine L', 'Inconnue')).toBe('le pull');
    expect(articleOf('Écharpe cachemire', null)).toBe('l’écharpe');
    expect(articleOf('Baskets Nike Air Max 42', 'Nike')).toBe('les baskets Nike');
    expect(articleOf('Chemise Pierre Cardin L', 'Pierre Cardin')).toBe('la chemise Pierre Cardin');
    expect(articleOf('Lot de 3 bidules', 'Zara')).toBe('l’article Zara');
    expect(cleanTitle('Veste Harrington Ralph Lauren M E1C4G')).toBe('Veste Harrington Ralph Lauren M');
  });
  it('several messages chosen: each member gets one, always the same for a given favourite', () => {
    const list = ['a', 'b', 'c'];
    const got = new Set(Array.from({ length: 40 }, (_, i) => pickMessage(list, `fav-${i}`)));
    expect(got).toEqual(new Set(list));
    expect(pickMessage(list, 'fav-7')).toBe(pickMessage(list, 'fav-7'));
    expect(pickMessage(['  ', ''], 'k')).toBeNull();
  });
  it('presets never make a verb or a pronoun agree with {article}', () => {
    for (const p of FAV_PRESETS) {
      expect(p.text).not.toMatch(/\{article\} (est|sont|te plait|t’intéresse)/);
      expect(p.text).not.toMatch(/\b(te|vous) (le|la) (propose|fais)\b/);
      expect(p.offer).toBe(p.text.includes('{prix_offre}'));
    }
  });
  it('an old message the seller edited is kept; the old default is replaced by the new ones', () => {
    expect(withDefaults({ fav: { template: 'Mon message {prix_offre}' } as never }).fav.templates).toEqual(['Mon message {prix_offre}']);
    expect(withDefaults({ fav: { template: 'Bonjour {pseudo} ! Merci pour le favori sur « {titre} ». Je peux vous le faire à {prix_offre} au lieu de {prix} : l’offre est dans la conversation.' } as never }).fav.templates).toEqual(DEFAULT_FAV_OFFER);
    expect(withDefaults(null).fav.templatesNoOffer).toEqual(DEFAULT_FAV_NO_OFFER);
  });
});
