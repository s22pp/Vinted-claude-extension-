/**
 * Sourcing from any shop page: read the product the page itself publishes (schema.org JSON-LD, then
 * OpenGraph/product meta tags). Pure: the page text is collected by a one-shot script on the user's click,
 * with no network call. A price in another currency is not converted: it stays unknown.
 */
export interface ExternalProduct {
  title: string;
  brand: string | null;
  priceCents: number | null;
  image: string | null;
  url: string;
  host: string;
}

export interface PageSnapshot {
  jsonld: string[];
  meta: Record<string, string>;
  title: string;
  url: string;
}

type Json = Record<string, unknown>;
const isObj = (x: unknown): x is Json => typeof x === 'object' && x !== null && !Array.isArray(x);
const text = (x: unknown): string | null => (typeof x === 'string' && x.trim() ? x.trim() : typeof x === 'number' ? String(x) : null);

function cents(amount: unknown, currency: unknown): number | null {
  const c = text(currency);
  if (c && c.toUpperCase() !== 'EUR') return null;
  const s = text(amount);
  if (!s) return null;
  const n = Number(s.replace(/\s/g, '').replace(',', '.').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

function products(node: unknown, out: Json[]): void {
  if (Array.isArray(node)) return node.forEach((n) => products(n, out));
  if (!isObj(node)) return;
  const type = node['@type'];
  if (type === 'Product' || (Array.isArray(type) && type.includes('Product'))) out.push(node);
  if (Array.isArray(node['@graph'])) products(node['@graph'], out);
}

export function productFromPage(p: PageSnapshot): ExternalProduct | null {
  let host = '';
  try {
    host = new URL(p.url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
  const found: Json[] = [];
  for (const raw of p.jsonld) {
    try {
      products(JSON.parse(raw), found);
    } catch {
      /* a malformed block is skipped */
    }
  }
  const prod = found[0];
  if (prod) {
    const brandRaw = prod.brand;
    const brand = isObj(brandRaw) ? text(brandRaw.name) : text(brandRaw);
    const offers = Array.isArray(prod.offers) ? prod.offers[0] : prod.offers;
    const price = isObj(offers) ? (cents(offers.price, offers.priceCurrency) ?? cents(offers.lowPrice, offers.priceCurrency)) : null;
    const img = prod.image;
    const image = text(Array.isArray(img) ? img[0] : isObj(img) ? img.url : img);
    const title = text(prod.name);
    if (title) return { title, brand, priceCents: price, image, url: p.url, host };
  }
  const m = p.meta;
  const title = text(m['og:title']) ?? text(p.title);
  if (!title) return null;
  return {
    title,
    brand: text(m['product:brand']) ?? text(m['og:brand']),
    priceCents: cents(m['product:price:amount'] ?? m['og:price:amount'], m['product:price:currency'] ?? m['og:price:currency']),
    image: text(m['og:image']),
    url: p.url,
    host,
  };
}

/**
 * Runs INSIDE the shop page (serialized by chrome.scripting on the user's click): copies the product
 * markup the page already contains. Self-contained on purpose — no outer reference survives serialization.
 */
export function snapshotPage(): PageSnapshot {
  const jsonld = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
    .map((s) => s.textContent ?? '')
    .slice(0, 20);
  const meta: Record<string, string> = {};
  for (const m of Array.from(document.querySelectorAll('meta[property], meta[name]'))) {
    const k = m.getAttribute('property') ?? m.getAttribute('name');
    const v = m.getAttribute('content');
    if (k && v && /^(og:|product:)/.test(k)) meta[k] = v;
  }
  return { jsonld, meta, title: document.title, url: location.href };
}

/** The Buy Analyzer route prefilled from an external product (price in cents, shipping left to the user). */
export function buyRouteFor(p: ExternalProduct, category: string): string {
  const q = new URLSearchParams({ title: p.title, brand: p.brand ?? '', category, source: p.host, url: p.url });
  if (p.priceCents !== null) q.set('price', String(p.priceCents));
  return `buy?${q.toString()}`;
}
