import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef } from 'react';
import { repo } from '@/data/repo';
import type { Prep } from '@/domain/entities';
import type { ItemIntel } from '@/intelligence/decision';
import { offerLadder } from '@/intelligence/offer';
import { DEFAULT_REPLIES, REPLY_KEYS, REPLY_KIT_KEY, type ReplyContext, type ReplyKey, type ReplyKit } from '@/intelligence/replies';
import type { SellerModel } from '@/intelligence/seller-model';
import { stagnationThreshold } from '@/intelligence/stagnation';
import { measureFields } from '@/intelligence/workshop';

interface Fmt {
  t: (key: string, params?: Record<string, string | number>) => string;
  money: (cents: number) => string;
}

/** What ERA knows of a listing to fill a reply: measures and defects from its sheet, the counter-offer from its ladder. */
export function replyContextOf(intel: ItemIntel, preps: Map<string, Prep>, model: SellerModel, { t, money }: Fmt): ReplyContext {
  const v = intel.view;
  const prep = preps.get(v.item.id);
  const measures = prep
    ? measureFields(v.item.category)
        .filter((k) => prep.measures[k]?.trim())
        .map((k) => `${t(`workshop.m.${k}`).toLowerCase()} ${prep.measures[k]!.trim()} cm`)
        .join(' · ') || null
    : null;
  const ladder =
    v.askPrice !== null ? offerLadder({ ask: v.askPrice, cost: v.cost, pricing: intel.pricing, daysListed: v.daysListed, favorites: v.current?.favorites ?? null, thresholdDays: stagnationThreshold(model) }) : null;
  return {
    title: v.item.title,
    size: v.item.size,
    condition: v.item.condition ? t(`condition.${v.item.condition}`).toLowerCase() : null,
    defects: prep?.defects.trim() || null,
    measures,
    price: v.askPrice !== null ? money(v.askPrice) : null,
    counter: ladder ? money(ladder.acceptFrom) : null,
  };
}

export function useCustomReplies(): Partial<Record<ReplyKey, string>> | undefined {
  return useLiveQuery(() => repo.getSetting<Partial<Record<ReplyKey, string>>>('replyTemplates', {}), []);
}

/**
 * Hands the vinted.fr pages what the "Réponses ERA" button needs (chrome.storage.local): your templates, and
 * — real data only — each live listing's context. Demo listings never reach real Vinted pages.
 */
export function useReplyKitPublisher(x: { ready: boolean; real: boolean; intel: ItemIntel[]; preps: Map<string, Prep>; model: SellerModel }, fmt: Fmt) {
  const custom = useCustomReplies();
  const last = useRef('');
  useEffect(() => {
    if (!x.ready || custom === undefined) return;
    const items: ReplyKit['items'] = {};
    if (x.real) {
      for (const i of x.intel) {
        const id = i.view.current?.platformListingId;
        if (i.view.inStock && id && /^\d+$/.test(id)) items[id] = replyContextOf(i, x.preps, x.model, fmt);
      }
    }
    const kit: ReplyKit = { templates: REPLY_KEYS.map((key) => ({ key, label: fmt.t(`replies.k.${key}`), text: custom[key] ?? DEFAULT_REPLIES[key] })), items };
    const json = JSON.stringify(kit);
    if (json === last.current) return;
    last.current = json;
    void browser.storage.local.set({ [REPLY_KIT_KEY]: kit }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x.ready, x.real, x.intel, x.preps, x.model, custom]);
}
