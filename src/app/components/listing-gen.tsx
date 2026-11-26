import { useEffect, useState } from 'react';
import type { Category, Condition } from '@/domain/entities';
import type { EraMessage, TextEditResult } from '@/data/adapters/vinted/protocol';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import { type GenFacts, generatedDescription, generatedPrice, generatedTitle, hashtags, listingBundle } from '@/intelligence/listing-generator';
import { useErrorToast, useToast } from '@/ui/components/overlays';
import { Button, Field, Input, Select } from '@/ui/components/primitives';
import { go, useEra } from '../state';
import { CategorySelect, ConditionSelect } from './forms';
import { CopyButton } from './tools';
import { vintedIdOf } from './vinted-price';

interface Form {
  category: Category;
  brand: string;
  model: string;
  size: string;
  condition: Condition | '';
  hook: string;
  vibe: string;
  fit: string;
}
const EMPTY: Form = { category: 'JACKET', brand: '', model: '', size: '', condition: '', hook: '', vibe: '', fit: '' };

/**
 * Outils → Générateur d'annonces: an article of the stock (or typed freely), its words (hook, style, cut), and the
 * listing at once — title, description, 10 to 15 hashtags, the price at the market's median + 10 %. « Copier tout »,
 * or « Injecter sur Vinted »: a listing online gets its title and description replaced (read back on Vinted); an
 * article not online yet gets the text in its Atelier sheet, where its Vinted draft is made.
 */
export function ListingGenerator() {
  const { t, money } = useI18n();
  const era = useEra();
  const toast = useToast();
  const errorToast = useErrorToast();
  const stock = era.views.filter((v) => v.inStock).sort((a, b) => a.item.title.localeCompare(b.item.title));
  const [itemId, setItemId] = useState<string>('');
  const [f, setF] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const v = itemId ? era.viewById.get(itemId) : undefined;
  const prep = itemId ? era.preps.get(itemId) : undefined;
  useEffect(() => {
    if (!v) return setF(EMPTY);
    setF({ category: v.item.category, brand: v.item.brand, model: v.item.model ?? '', size: v.item.size ?? '', condition: v.item.condition ?? '', hook: prep?.hook ?? '', vibe: prep?.vibe ?? (v.item.era === 'vintage' ? 'Vintage' : ''), fit: prep?.fit ?? '' });
    // Only when another article is chosen: what the seller types is not reset by a data refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);
  const set = <K extends keyof Form>(k: K, x: Form[K]) => setF((cur) => ({ ...cur, [k]: x }));

  const facts: GenFacts = {
    category: f.category,
    brand: f.brand.trim() || null,
    model: f.model.trim() || null,
    size: f.size.trim() || null,
    era: v?.item.era ?? (/vintage/i.test(f.vibe) ? 'vintage' : null),
    condition: f.condition || null,
    gender: v?.item.gender ?? null,
    hook: f.hook,
    vibe: f.vibe,
    fit: f.fit,
    colors: prep?.colors || null,
    material: prep?.material || v?.item.material || null,
    defects: prep?.defects || null,
    measureValues: prep?.measures ?? {},
  };
  const title = generatedTitle(facts);
  const description = generatedDescription(facts);
  const tags = hashtags(facts);
  const intel = itemId ? era.intelById.get(itemId) : undefined;
  const price = generatedPrice(intel && !intel.analysisStale ? intel.analysis : null);
  const listingId = vintedIdOf(v);
  const canInject = !!v && !v.item.isDemo && era.mode === 'real' && !!f.brand.trim();

  const inject = async () => {
    if (!v) return;
    setBusy(true);
    try {
      if (listingId) {
        for (const [field, text] of [['title', title], ['description', description]] as const) {
          const r = (await browser.runtime.sendMessage({ type: 'era:text:edit', platformListingId: listingId, field, op: { kind: 'set', text } } satisfies EraMessage)) as TextEditResult;
          if (!r.ok) return errorToast(r);
        }
        toast('success', t('gen.injected'), t('gen.injectedHint'));
      } else {
        // Not online yet: the text goes into the Atelier sheet, where the Vinted draft is made with the photos.
        await repo.savePrep(v.item.id, { titleOverride: title, descriptionOverride: description, hook: f.hook, vibe: f.vibe, fit: f.fit, ...(price !== null ? { priceCents: price } : {}) });
        toast('success', t('gen.toWorkshop'), t('gen.toWorkshopHint'));
        go(`workshop/${v.item.id}`);
      }
    } catch (e) {
      errorToast(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack-3" data-testid="listing-gen">
      <Field label={t('gen.item')} htmlFor="gen-item">
        <Select id="gen-item" value={itemId} onChange={(e) => setItemId(e.target.value)} options={[{ value: '', label: t('gen.free') }, ...stock.map((x) => ({ value: x.item.id, label: x.item.title }))]} />
      </Field>
      <div className="gen__fields">
        <Field label={t('buy.fCategory')} htmlFor="gen-cat">
          <CategorySelect id="gen-cat" value={f.category} onChange={(c) => set('category', c)} />
        </Field>
        <Field label={t('buy.fBrand')} htmlFor="gen-brand">
          <Input id="gen-brand" value={f.brand} onChange={(e) => set('brand', e.target.value)} placeholder="Ralph Lauren" />
        </Field>
        <Field label={t('buy.fModel')} htmlFor="gen-model" optional>
          <Input id="gen-model" value={f.model} onChange={(e) => set('model', e.target.value)} placeholder="Harrington" />
        </Field>
        <Field label={t('buy.fSize')} htmlFor="gen-size" optional>
          <Input id="gen-size" value={f.size} onChange={(e) => set('size', e.target.value)} placeholder="M" />
        </Field>
        <Field label={t('buy.fCondition')} htmlFor="gen-cond">
          <ConditionSelect id="gen-cond" value={f.condition} onChange={(c) => set('condition', c)} />
        </Field>
        <Field label={t('workshop.hook')} htmlFor="gen-hook" optional>
          <Input id="gen-hook" value={f.hook} onChange={(e) => set('hook', e.target.value)} placeholder={t('workshop.hookPh')} />
        </Field>
        <Field label={t('workshop.vibe')} htmlFor="gen-vibe" optional>
          <Input id="gen-vibe" value={f.vibe} onChange={(e) => set('vibe', e.target.value)} placeholder={t('workshop.vibePh')} />
        </Field>
        <Field label={t('workshop.fit')} htmlFor="gen-fit" optional>
          <Input id="gen-fit" value={f.fit} onChange={(e) => set('fit', e.target.value)} placeholder={t('workshop.fitPh')} />
        </Field>
      </div>
      <div className="gen__out">
        <div className="gen__line">
          <span className="t-caption">{t('gen.title')}</span>
          <span className="gen__title" data-testid="gen-title">{title}</span>
          <span className={`num t-small ${title.length > 60 ? 't-warn' : 't-faint'}`}>{title.length}/60</span>
        </div>
        <div className="gen__line">
          <span className="t-caption">{t('gen.description')}</span>
          <pre className="wdesc" tabIndex={0} aria-label={t('gen.description')} data-testid="gen-description">{description}</pre>
        </div>
        <div className="gen__line">
          <span className="t-caption">{t('gen.hashtags', { n: tags.length })}</span>
          <pre className="wdesc gen__tags" tabIndex={0} aria-label={t('gen.hashtags', { n: tags.length })} data-testid="gen-hashtags">{tags.join(' ')}</pre>
        </div>
        <div className="gen__line">
          <span className="t-caption">{t('gen.price')}</span>
          <b className="num" data-testid="gen-price">{price !== null ? money(price) : '—'}</b>
          <span className="t-small t-faint">{price !== null ? t('gen.priceBasis') : t('gen.priceNone')}</span>
        </div>
      </div>
      <div className="row wrap" style={{ gap: 8 }}>
        <CopyButton text={listingBundle(title, description, price !== null ? money(price) : null)} label={t('workshop.copyAll')} />
        <CopyButton text={tags.join(' ')} label={t('gen.copyTags')} />
        <Button size="sm" variant="primary" icon="external" loading={busy} disabled={!canInject} onClick={() => void inject()} data-testid="gen-inject">
          {t('gen.inject')}
        </Button>
        {!canInject && <span className="t-small t-faint">{v?.item.isDemo || era.mode !== 'real' ? t('gen.injectDemo') : t('gen.injectPick')}</span>}
        {canInject && <span className="t-small t-faint">{listingId ? t('gen.injectLive') : t('gen.injectDraft')}</span>}
      </div>
    </div>
  );
}
