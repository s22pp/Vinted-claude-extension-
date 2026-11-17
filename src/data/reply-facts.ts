import { createI18n } from '@/i18n';
import { type DraftFacts, factLines } from '@/intelligence/ai-draft';
import { measureFields } from '@/intelligence/workshop';
import { db } from './db';

/**
 * What ERA knows for sure about one of the seller's listings, by its Vinted id — the only facts a reply may use: the
 * title, the brand, the size on the label, the condition, the defects and measures the seller entered in the workshop,
 * the material, the asking price, and the listing's own description. Null when ERA does not hold the listing.
 */
export async function replyFacts(vintedId: string): Promise<{ facts: DraftFacts; known: string; priced: string } | null> {
  const listing = await db.listings.filter((l) => !l.isDemo && l.platformListingId === vintedId).first();
  if (!listing) return null;
  const item = await db.items.get(listing.inventoryItemId);
  if (!item) return null;
  const prep = await db.preps.get(item.id);
  const { t, money } = createI18n('fr');
  const measures =
    measureFields(item.category)
      .filter((k) => prep?.measures[k]?.trim())
      .map((k) => `${t(`workshop.m.${k}`).toLowerCase()} ${prep!.measures[k]!.trim()} cm`)
      .join(' · ') || null;
  const facts: DraftFacts = {
    title: listing.title,
    brand: item.brand,
    size: item.size,
    condition: item.condition ? t(`condition.${item.condition}`).toLowerCase() : null,
    defects: prep?.defects.trim() || null,
    material: prep?.material.trim() || item.material || null,
    measures,
    price: money(listing.priceCents),
  };
  const lines = factLines(facts).join('\n');
  return { facts, known: [lines, listing.description ?? ''].join('\n'), priced: lines };
}
