import { parseItemJsonLd } from '@/data/adapters/vinted/parse';
import { type Mark, OVERLAY_KEY, OVERLAY_ON_KEY, type OverlayNiche, markFor, priceFromText } from '@/intelligence/overlay';

/**
 * ERA's marks on vinted.fr pages (EXPERIMENTAL: depends on how Vinted builds its pages). For each listing card the
 * page shows, and for the item page itself: whether it is in one of YOUR niches and what it would leave you.
 * Reads only what the page shows (link title, price text, the item's JSON-LD): no request, nothing clicked,
 * nothing changed on Vinted — a small label is added next to the card, that's all. Your own listings are skipped.
 */
export default defineContentScript({
  matches: ['https://www.vinted.fr/*'],
  runAt: 'document_idle',
  main() {
    let niches: OverlayNiche[] = [];
    let own = new Set<string>();
    let on = true;
    let timer: number | undefined;

    const eur = (c: number) => `${(c / 100).toFixed(c % 100 === 0 ? 0 : 2).replace('.', ',')} €`;
    const label = (m: Mark) => (m.kind === 'DEAL' ? `ERA ✓ marge ~${eur(m.marginCents)}` : m.kind === 'AVOID' ? 'ERA ⚠ niche à éviter' : `ERA · votre max ${eur(m.maxVintedPriceCents)}`);
    const tip = (m: Mark) =>
      `ERA — ${m.niche} : vendu ${m.sold} fois par vous. Coût tout compris ~${eur(m.landedCents)} (protection acheteur incluse, port en plus). Prix max conseillé ${eur(m.maxVintedPriceCents)}.${m.kind === 'AVOID' ? ' Cette niche se vend mal pour vous.' : ''}`;
    const COLORS: Record<Mark['kind'], string> = { DEAL: '#047857', ABOVE_MAX: '#475569', AVOID: '#b45309' };
    const style = (m: Mark) =>
      `position:absolute;top:6px;left:6px;z-index:5;pointer-events:auto;max-width:calc(100% - 12px);padding:3px 7px;border-radius:999px;font:600 11px/1.3 system-ui,sans-serif;color:#fff;background:${COLORS[m.kind]};box-shadow:0 1px 4px rgba(0,0,0,.25);white-space:nowrap;overflow:hidden;text-overflow:ellipsis`;

    const clear = () => {
      for (const el of document.querySelectorAll('[data-era-mark]')) el.remove();
      for (const el of document.querySelectorAll('[data-era-seen]')) el.removeAttribute('data-era-seen');
    };

    const scan = () => {
      if (!on || !niches.length) return;
      // Listing cards: every link to an item, once per card.
      for (const a of document.querySelectorAll<HTMLAnchorElement>('a[href*="/items/"]:not([data-era-seen])')) {
        a.setAttribute('data-era-seen', '1');
        const id = /\/items\/(\d+)/.exec(a.getAttribute('href') ?? '')?.[1];
        if (!id || own.has(id) || location.pathname.startsWith(`/items/${id}`)) continue;
        const card = (a.closest('[data-testid*="item"], [class*="feed-grid__item"], [class*="item-box"]') as HTMLElement | null) ?? a.parentElement;
        if (!card || card.querySelector('[data-era-mark]')) continue;
        const text = a.getAttribute('title') || a.getAttribute('aria-label') || card.textContent || '';
        const m = markFor(text, priceFromText(text) ?? priceFromText(card.textContent ?? ''), niches);
        if (!m) continue;
        if (getComputedStyle(card).position === 'static') card.style.position = 'relative';
        const b = document.createElement('span');
        b.setAttribute('data-era-mark', m.kind);
        b.textContent = label(m);
        b.title = tip(m);
        b.style.cssText = style(m);
        card.appendChild(b);
      }
      // The item page itself: a chip in the corner, from the page's own product data.
      const itemId = /^\/items\/(\d+)/.exec(location.pathname)?.[1];
      if (itemId && !own.has(itemId) && !document.querySelector('[data-era-mark="PAGE"]')) {
        const blocks: unknown[] = [];
        for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
          try {
            blocks.push(JSON.parse(s.textContent ?? ''));
          } catch {
            /* malformed block */
          }
        }
        const it = parseItemJsonLd(blocks, location.href);
        const m = it ? markFor(`${it.brand ?? ''} ${it.title}`, it.priceCents, niches) : null;
        if (m) {
          const b = document.createElement('div');
          b.setAttribute('data-era-mark', 'PAGE');
          b.textContent = label(m);
          b.title = tip(m);
          b.style.cssText = `${style(m).replace('position:absolute;top:6px;left:6px', 'position:fixed;bottom:16px;left:16px')};z-index:2147483000;font-size:13px;padding:8px 12px`;
          document.body.appendChild(b);
        }
      }
    };
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(scan, 250);
    };

    const load = async () => {
      const got = (await browser.storage.local.get([OVERLAY_KEY, OVERLAY_ON_KEY, 'eraOwnListings'])) as Record<string, unknown>;
      niches = Array.isArray(got[OVERLAY_KEY]) ? (got[OVERLAY_KEY] as OverlayNiche[]) : [];
      own = new Set(Array.isArray(got.eraOwnListings) ? (got.eraOwnListings as string[]) : []);
      on = got[OVERLAY_ON_KEY] !== false;
      clear();
      scan();
    };
    void load();
    browser.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && (OVERLAY_KEY in changes || OVERLAY_ON_KEY in changes || 'eraOwnListings' in changes)) void load();
    });
    // Infinite scroll and page changes inside Vinted's app: look again, a little later.
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  },
});
