import type { InventoryItem } from '@/domain/entities';
import { DAY } from '@/domain/time';
import { brandKey, categoriesInTitle, jaccard, modelTokens, normalizeText, titleHasBrand } from './normalize';

export interface PurchaseLike {
  id: string;
  title: string;
  date: number | null;
}

export interface Match {
  itemId: string;
  score: number;
}

/**
 * Suggest which stock item a Vinted purchase became. Titles are usually rewritten for resale, so the
 * score combines brand, category and model words, and the item must appear after the purchase.
 * A suggestion is "sure" only when it clearly beats the runner-up.
 */
export function suggestMatches(p: PurchaseLike, items: readonly InventoryItem[]): { best: Match | null; sure: boolean; others: Match[] } {
  const nt = normalizeText(p.title);
  const pTokens = modelTokens(nt);
  const pCats = categoriesInTitle(nt);
  const scored: Match[] = [];
  for (const it of items) {
    if (p.date !== null && it.createdAt < p.date - 2 * DAY && (it.purchaseDate ?? it.createdAt) < p.date - 2 * DAY) continue;
    const brand = titleHasBrand(p.title, brandKey(it.brand)) ? 1 : 0;
    if (!brand) continue;
    const cat = pCats.length === 0 ? 0.5 : pCats.includes(it.category) ? 1 : 0;
    const words = jaccard(pTokens, modelTokens(normalizeText(`${it.model ?? ''} ${it.title}`)));
    const size = it.size && new RegExp(`\\b${it.size.toLowerCase()}\\b`).test(nt) ? 1 : 0;
    scored.push({ itemId: it.id, score: 0.4 * brand + 0.25 * cat + 0.25 * words + 0.1 * size });
  }
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0] ?? null;
  const second = scored[1]?.score ?? 0;
  return { best, sure: !!best && best.score >= 0.7 && best.score - second >= 0.15, others: scored.slice(1, 5) };
}

/** Buyer protection on Vinted (verified): 0,70 € + 5 % of the item price. Shipping is not included. */
export function withBuyerProtection(priceCents: number): number {
  return priceCents + 70 + Math.round(priceCents * 0.05);
}
