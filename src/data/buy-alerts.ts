import { OVERLAY_KEY, type OverlayNiche, markFor } from '@/intelligence/overlay';
import { errorInfo } from './adapters/marketplace';
import { VintedTabAdapter } from './adapters/vinted/vinted-adapter';
import { repo } from './repo';

/**
 * Buy alerts: after each scheduled refresh, your best niches (at most 3) are searched once each on Vinted
 * (read-only, in the call budget). A listing under your max price that ERA has not shown you before is kept,
 * and announced. Never your own listings; each listing only once.
 */
export const BUY_ALERTS_KEY = 'buyAlerts';
export const BUY_SEEN_KEY = 'buyAlertSeen';
export const BUY_LAST_KEY = 'buyAlertLast';
export const ALERT_NICHES = 3;

export interface AlertDeal {
  id: string;
  title: string;
  niche: string;
  priceCents: number;
  landedCents: number;
  marginCents: number;
  url: string;
  photoUrl: string | null;
}

export interface BuyAlertsLast {
  at: number;
  deals: AlertDeal[];
  /** Absent in alerts saved before 0.31.1. */
  via?: 'PAGE' | 'LEARNED' | null;
}

export async function runBuyAlerts(now = Date.now()): Promise<{ deals: AlertDeal[]; stopped: string | null; via: BuyAlertsLast['via'] }> {
  const got = (await browser.storage.local.get([OVERLAY_KEY, 'eraOwnListings'])) as Record<string, unknown>;
  const niches = (Array.isArray(got[OVERLAY_KEY]) ? (got[OVERLAY_KEY] as OverlayNiche[]) : []).filter((n) => !n.avoid).slice(0, ALERT_NICHES);
  const own = new Set(Array.isArray(got.eraOwnListings) ? (got.eraOwnListings as string[]) : []);
  const seen = new Set(await repo.getSetting<string[]>(BUY_SEEN_KEY, []));
  const adapter = new VintedTabAdapter();
  const fresh: AlertDeal[] = [];
  let stopped: string | null = null;
  // Listings read on the search page, or through an address learned from it: never verified, said with the alert.
  let via: 'PAGE' | 'LEARNED' | null = null;
  for (const n of niches) {
    try {
      const r = await adapter.searchComparables({ text: n.label, brand: n.brand, category: n.category ?? 'OTHER', gender: null, size: null, condition: null });
      if (r.via) via = via === 'PAGE' ? via : r.via;
      for (const c of r.candidates) {
        if (own.has(c.id) || seen.has(c.id)) continue;
        const m = markFor(`${c.brand ?? ''} ${c.title}`, c.priceCents, [n]);
        if (m?.kind !== 'DEAL') continue;
        seen.add(c.id);
        fresh.push({ id: c.id, title: c.title, niche: n.label, priceCents: c.priceCents, landedCents: m.landedCents, marginCents: m.marginCents, url: c.url ?? `https://www.vinted.fr/items/${c.id}`, photoUrl: c.photoUrl });
      }
    } catch (e) {
      const { code, detail } = errorInfo(e);
      stopped = `${code}${detail ? ` · ${detail}` : ''}`;
      if (['NETWORK_403', 'RATE_LIMITED', 'NOT_LOGGED_IN', 'BUDGET_EXHAUSTED'].includes(code)) break;
    }
  }
  fresh.sort((a, b) => b.marginCents - a.marginCents);
  await repo.setSetting(BUY_SEEN_KEY, [...seen].slice(-1000));
  if (fresh.length) await repo.setSetting(BUY_LAST_KEY, { at: now, deals: fresh.slice(0, 12), via } satisfies BuyAlertsLast);
  return { deals: fresh, stopped, via };
}
