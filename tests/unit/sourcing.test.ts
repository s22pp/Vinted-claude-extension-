import { describe, expect, it } from 'vitest';
import { parseOrder } from '@/data/adapters/vinted/parse';
import { buyRouteFor, productFromPage } from '@/intelligence/sourcing';

const page = (over: Partial<Parameters<typeof productFromPage>[0]> = {}) => ({ jsonld: [], meta: {}, title: '', url: 'https://www.shop.example/p/1', ...over });

describe('productFromPage (sourcing on any shop)', () => {
  it('reads a schema.org Product, even nested in @graph, with its EUR offer', () => {
    const ld = JSON.stringify({ '@context': 'https://schema.org', '@graph': [{ '@type': 'WebPage' }, { '@type': 'Product', name: 'Veste Harrington', brand: { '@type': 'Brand', name: 'Baracuta' }, image: ['https://img/1.jpg'], offers: { '@type': 'Offer', price: '24.90', priceCurrency: 'EUR' } }] });
    expect(productFromPage(page({ jsonld: ['{bad json', ld] }))).toEqual({ title: 'Veste Harrington', brand: 'Baracuta', priceCents: 2490, image: 'https://img/1.jpg', url: 'https://www.shop.example/p/1', host: 'shop.example' });
  });

  it('keeps a price in another currency unknown instead of converting it', () => {
    const ld = JSON.stringify({ '@type': 'Product', name: 'Hoodie', offers: [{ price: 30, priceCurrency: 'GBP' }] });
    expect(productFromPage(page({ jsonld: [ld] }))?.priceCents).toBeNull();
  });

  it('falls back to OpenGraph product tags, then to nothing', () => {
    const p = productFromPage(page({ meta: { 'og:title': 'Pull Shetland', 'product:brand': 'Ralph Lauren', 'product:price:amount': '19,50', 'product:price:currency': 'EUR' } }));
    expect(p).toMatchObject({ title: 'Pull Shetland', brand: 'Ralph Lauren', priceCents: 1950 });
    expect(productFromPage(page())).toBeNull();
    expect(productFromPage(page({ url: 'not a url', title: 'x' }))).toBeNull();
  });

  it('opens the Buy Analyzer prefilled, price in cents, source kept', () => {
    const r = buyRouteFor({ title: 'Veste & co', brand: null, priceCents: 1200, image: null, url: 'https://a.fr/x', host: 'a.fr' }, 'JACKET');
    const q = new URLSearchParams(r.slice('buy?'.length));
    expect(q.get('title')).toBe('Veste & co');
    expect(q.get('price')).toBe('1200');
    expect(q.get('source')).toBe('a.fr');
    expect(q.get('category')).toBe('JACKET');
  });
});

describe('parseOrder — orders waiting for the seller', () => {
  it('flags transaction_user_status needs_action, nothing else', () => {
    expect(parseOrder({ title: 'Veste', price: '20', transaction_user_status: 'needs_action' })?.needsAction).toBe(true);
    expect(parseOrder({ title: 'Veste', price: '20', transaction_user_status: 'completed' })?.needsAction).toBe(false);
    expect(parseOrder({ title: 'Veste', price: '20' })?.needsAction).toBe(false);
  });

  it('keeps the order’s conversation and transaction when the entry carries them', () => {
    expect(parseOrder({ title: 'Veste', price: '20', conversation_id: 9200, transaction_id: '7200' })).toMatchObject({ conversationId: '9200', transactionId: '7200' });
    expect(parseOrder({ title: 'Veste', price: '20', conversation: { id: 1 }, transaction: { id: 2 } })).toMatchObject({ conversationId: '1', transactionId: '2' });
    expect(parseOrder({ title: 'Veste', price: '20' })).toMatchObject({ conversationId: null, transactionId: null });
  });
});
