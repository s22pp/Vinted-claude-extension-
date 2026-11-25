import { notePageProof } from '@/data/page-proofs';
import { parseItemJsonLd } from '@/data/adapters/vinted/parse';
import { type Mark, OVERLAY_KEY, OVERLAY_ON_KEY, type OverlayNiche, coteText, markFor, priceFromText, signedEur } from '@/intelligence/overlay';
import { eurText } from '@/domain/money';
import type { EraMessage } from '@/data/adapters/vinted/protocol';
import { querySelectorResilient } from '@/lib/dom-resilient';

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
    // The item page read for the chip: its JSON-LD is parsed once per page and data, not at every change of the page.
    let pageDone: string | null = null;

    const eur = (c: number) => eurText(c);
    const label = (m: Mark) => (m.kind === 'DEAL' ? `ERA ✓ marge ~${eur(m.marginCents)}` : m.kind === 'AVOID' ? 'ERA ⚠ niche à éviter' : `ERA · votre max ${eur(m.maxVintedPriceCents)}`);
    /** The item page's line: « Cote ERA : 24–35 € · Marge est. +18,80 € » — your price range in the niche, what this one would leave. */
    const barLabel = (m: Mark) => `Cote ERA : ${coteText(m)} · ${m.kind === 'AVOID' ? 'niche à éviter' : `Marge est. ${signedEur(m.marginCents)}`}`;
    const maxText = (m: Mark) => (m.kind === 'DEAL' ? `✓ sous votre max ${eur(m.maxVintedPriceCents)}` : m.kind === 'ABOVE_MAX' ? `au-dessus de votre max ${eur(m.maxVintedPriceCents)}` : `max ${eur(m.maxVintedPriceCents)}`);
    const tip = (m: Mark) =>
      `ERA — ${m.niche} : vendu ${m.sold} fois par vous. Coût tout compris ~${eur(m.landedCents)} (protection acheteur incluse, port en plus). Prix max conseillé ${eur(m.maxVintedPriceCents)}.${m.kind === 'AVOID' ? ' Cette niche se vend mal pour vous.' : ''}`;
    // ERA's own marks live in a shadow root: Vinted's styles never reach them, theirs never leak onto the page. The text
    // stays in the light DOM (slotted), so it is what assistive tools and the tests read.
    const DOT: Record<Mark['kind'], string> = { DEAL: '#34D399', ABOVE_MAX: '#94A3B8', AVOID: '#FBBF24' };
    const MONO = `'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace`;
    const CHIP_CSS = `:host{all:initial;position:absolute;top:6px;left:6px;z-index:5;max-width:calc(100% - 12px)}
      .chip{display:inline-flex;align-items:center;gap:6px;max-width:100%;height:20px;padding:0 7px;border-radius:2px;background:#080C12;border:1px solid rgba(255,255,255,.16);color:#F8FAFC;font:500 10.5px/1 ${MONO};letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-sizing:border-box}
      .dot{width:6px;height:6px;border-radius:50%;flex:none}`;
    const chip = (m: Mark, tag: 'era-mark') => {
      const host = document.createElement(tag);
      host.setAttribute('data-era-mark', m.kind);
      host.textContent = label(m);
      host.title = tip(m);
      const root = host.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>${CHIP_CSS}</style><span class="chip"><i class="dot" style="background:${DOT[m.kind]}"></i><slot></slot></span>`;
      return host;
    };
    /** The item page's bar: 36 px under Vinted's price (or in the corner when the price is not found). */
    const bar = (m: Mark, it: { title: string; brand: string | null; priceCents: number | null }, under: Element | null) => {
      const host = document.createElement('era-bar');
      host.setAttribute('data-era-mark', 'PAGE');
      host.textContent = barLabel(m);
      host.title = tip(m);
      const root = host.attachShadow({ mode: 'open' });
      const place = under ? ':host{all:initial;display:block;margin:10px 0}' : ':host{all:initial;position:fixed;left:16px;bottom:16px;z-index:2147483000}';
      root.innerHTML = `<style>${place}
        .bar{display:flex;align-items:center;gap:0;height:36px;padding:0 4px 0 0;border-radius:4px;background:#080C12;border:1px solid rgba(255,255,255,.14);color:#F8FAFC;font:500 12px/1 ${MONO};box-sizing:border-box;width:max-content;max-width:100%}
        .seg{display:inline-flex;align-items:center;gap:6px;height:100%;padding:0 12px;border-left:1px solid rgba(255,255,255,.09);white-space:nowrap}
        .e{font:500 18px/1 'Bodoni Moda', 'Bodoni 72', Didot, serif;padding:0 12px;border-left:0}
        .dot{width:6px;height:6px;border-radius:50%}
        .muted{color:#94A3B8}
        button{all:unset;margin-left:8px;height:26px;padding:0 10px;border-radius:3px;background:#E2E8F0;color:#080C12;font:600 11.5px/26px system-ui,sans-serif;cursor:pointer}
        button:hover{background:#fff}</style>
        <div class="bar" role="group" aria-label="ERA">
          <span class="seg e" aria-hidden="true">E</span>
          <span class="seg"><i class="dot" style="background:${DOT[m.kind]}"></i><slot></slot></span>
          <span class="seg muted">${maxText(m)}</span>
          <span class="seg muted">vendu ${m.sold}× par vous</span>
          <button type="button">Analyser dans ERA</button>
        </div>`;
      root.querySelector('button')!.addEventListener('click', (e) => {
        e.preventDefault();
        const q = new URLSearchParams({ vinted: '1', title: it.title, brand: it.brand ?? '', url: location.href.split('?')[0]! });
        if (it.priceCents !== null) q.set('price', String(it.priceCents));
        void browser.runtime.sendMessage({ type: 'era:open', path: `buy?${q.toString()}` } satisfies EraMessage).catch(() => undefined);
      });
      return host;
    };
    /** Vinted's price on an item page (EXPERIMENTAL: these selectors are not verified on the real site yet). */
    const priceEl = () =>
      querySelectorResilient(document, [
        { kind: 'testid', value: 'item-price' },
        { kind: 'testid', value: 'item-price', partial: true },
        { kind: 'css', value: '[itemprop="price"]' },
        { kind: 'aria', value: /^prix/i },
      ])?.el ?? null;

    const clear = () => {
      for (const el of document.querySelectorAll('[data-era-mark]')) el.remove();
      for (const el of document.querySelectorAll('[data-era-seen]')) el.removeAttribute('data-era-seen');
      pageDone = null;
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
        card.appendChild(chip(m, 'era-mark'));
        void notePageProof('marks');
      }
      // The item page itself: a chip in the corner, from the page's own product data.
      const itemId = /^\/items\/(\d+)/.exec(location.pathname)?.[1];
      const scripts = itemId ? [...document.querySelectorAll('script[type="application/ld+json"]')] : [];
      // Same page, same product data: already read (Vinted changes pages without reloading, data can arrive late).
      const sig = `${location.pathname}|${scripts.map((x) => x.textContent ?? '').join('')}`;
      if (sig !== pageDone) document.querySelector('[data-era-mark="PAGE"]')?.remove();
      if (itemId && !own.has(itemId) && scripts.length && sig !== pageDone) {
        pageDone = sig;
        const blocks: unknown[] = [];
        for (const s of scripts) {
          try {
            blocks.push(JSON.parse(s.textContent ?? ''));
          } catch {
            /* malformed block */
          }
        }
        const it = parseItemJsonLd(blocks, location.href);
        const m = it ? markFor(`${it.brand ?? ''} ${it.title}`, it.priceCents, niches) : null;
        if (m && it) {
          const under = priceEl();
          const b = bar(m, { title: it.title, brand: it.brand, priceCents: it.priceCents }, under);
          if (under) under.insertAdjacentElement('afterend', b);
          else document.body.appendChild(b);
        }
      }
    };
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(scan, 250);
    };
    // Only changes made by the page count: ERA's own labels never trigger another look.
    const byPage = (records: MutationRecord[]) =>
      records.some((r) => [...r.addedNodes].some((n) => !(n instanceof Element) || !n.hasAttribute('data-era-mark')));

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
    new MutationObserver((records) => {
      if (on && niches.length && byPage(records)) schedule();
    }).observe(document.documentElement, { childList: true, subtree: true });
  },
});
