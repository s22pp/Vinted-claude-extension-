import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import type { Category, Condition } from '@/domain/entities';
import { errorInfo } from '@/data/adapters/marketplace';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import { TITLE_WORD } from '@/intelligence/listing';
import { RADAR_KEY, RADAR_LAST_KEY, type RadarDeal, type RadarScan, type SavedSearch, newSearch, scoreScan } from '@/intelligence/radar';
import { Thumb } from '@/ui/components/Thumb';
import { useErrorToast, useToast } from '@/ui/components/overlays';
import { Button, Card, Field, Input, Select } from '@/ui/components/primitives';
import { marketAdapter } from '../market-run';
import { go, useEra } from '../state';
import { ConditionSelect, useMoneyField } from './forms';
import { MarginBadge } from './margin-badge';

/** Stops every scan at once: Vinted asked for a pause, or the session is out. */
const STOP = new Set(['NETWORK_403', 'RATE_LIMITED', 'NOT_LOGGED_IN', 'BUDGET_EXHAUSTED']);

/**
 * Marché → Radar de sourcing: the seller's saved searches, scanned on their click (one search on Vinted each, within
 * the request pacing; a 403/429 stops everything). Each listing found carries its estimated margin against the local
 * median, with « Ouvrir sur Vinted » and « Ajouter aux achats » (the article created with its cost, protection included).
 */
export function RadarCard() {
  const { t, money, date } = useI18n();
  const era = useEra();
  const toast = useToast();
  const errorToast = useErrorToast();
  const searches = useLiveQuery(() => repo.getSetting<SavedSearch[]>(RADAR_KEY, []), []) ?? [];
  const last = useLiveQuery(() => repo.getSetting<Record<string, RadarScan>>(RADAR_LAST_KEY, {}), []) ?? {};
  const [brand, setBrand] = useState('');
  const [category, setCategory] = useState<Category | ''>('');
  const [size, setSize] = useState('');
  const max = useMoneyField(null);
  const [minCondition, setMinCondition] = useState<Condition | ''>('');
  const [scanning, setScanning] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [lastAdded, setLastAdded] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const s = newSearch({ brand, category: category || null, size, maxPriceCents: max.invalid ? null : max.cents, minCondition: minCondition || null }, Date.now());
    if (!s) return;
    await repo.setSetting(RADAR_KEY, [...searches, s]);
    setBrand('');
    setSize('');
    max.setRaw('');
  };
  const remove = async (id: string) => {
    await repo.setSetting(RADAR_KEY, searches.filter((s) => s.id !== id));
    const { [id]: _gone, ...rest } = last;
    await repo.setSetting(RADAR_LAST_KEY, rest);
  };

  /** One search, or all of them one after the other; a block stops the rest. */
  const scan = async (list: SavedSearch[]) => {
    const own = new Set(era.views.map((v) => v.current?.platformListingId).filter((x): x is string => !!x));
    const adapter = await marketAdapter(era.mode, false, true);
    const next = { ...last };
    try {
      for (const s of list) {
        setScanning(s.id);
        try {
          const r = await adapter.searchComparables({ text: [s.brand, s.category ? TITLE_WORD[s.category] : ''].filter(Boolean).join(' '), brand: s.brand, category: s.category, gender: null, size: s.size, condition: null });
          next[s.id] = scoreScan(s, r.candidates, era.model, own, Date.now());
          await repo.setSetting(RADAR_LAST_KEY, next);
        } catch (e) {
          errorToast(e);
          if (STOP.has(errorInfo(e).code)) break;
        }
      }
    } finally {
      setScanning(null);
    }
  };

  const addToPurchases = async (s: SavedSearch, d: RadarDeal) => {
    const id = await repo.addItem({
      title: d.title,
      brand: s.brand,
      model: null,
      category: s.category ?? 'OTHER',
      gender: null,
      size: d.size,
      condition: d.condition,
      purchasePriceCents: d.landedCents,
      purchaseDate: Date.now(),
      purchaseSource: 'Vinted',
      priceCents: null,
      listedAt: null,
      views: null,
      favorites: null,
      url: d.url,
    });
    setAdded((a) => new Set(a).add(d.id));
    setLastAdded(id);
    toast('success', t('radar.added', { price: money(d.landedCents) }), t('radar.addedHint'));
  };

  const summary = (s: SavedSearch) =>
    [s.brand, s.category ? t(`category.${s.category}`) : null, s.size ? t('radar.size', { size: s.size }) : null, s.maxPriceCents !== null ? t('radar.max', { price: money(s.maxPriceCents) }) : null, s.minCondition ? t('radar.minCondition', { c: t(`condition.${s.minCondition}`) }) : null]
      .filter(Boolean)
      .join(' · ');

  return (
    <Card
      title={t('radar.title')}
      hint={t('radar.hint')}
      icon="target"
      tone="emerald"
      actions={
        searches.length > 1 ? (
          <Button size="sm" icon="search" loading={scanning !== null} onClick={() => void scan(searches)}>
            {t('radar.scanAll', { n: searches.length })}
          </Button>
        ) : null
      }
    >
      <div className="stack-3" data-testid="radar">
        {era.mode === 'demo' && <p className="t-small t-warn">{t('radar.demo')}</p>}
        {lastAdded && (
          <p className="t-small">
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => go(`item/${lastAdded}`)}>
              {t('radar.openItem')}
            </button>
          </p>
        )}
        <form className="radar__form" onSubmit={save}>
          <Field label={t('buy.fBrand')} htmlFor="rd-brand">
            <Input id="rd-brand" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Ralph Lauren" />
          </Field>
          <Field label={t('buy.fCategory')} htmlFor="rd-cat" optional>
            <Select id="rd-cat" value={category} onChange={(e) => setCategory(e.target.value as Category | '')} options={[{ value: '', label: t('radar.anyCategory') }, ...(['JACKET', 'COAT', 'SWEATSHIRT', 'KNIT', 'SHIRT', 'POLO', 'TSHIRT', 'JEANS', 'TROUSERS', 'SHORTS', 'SHOES', 'ACCESSORY'] as Category[]).map((c) => ({ value: c, label: t(`category.${c}`) }))]} />
          </Field>
          <Field label={t('buy.fSize')} htmlFor="rd-size" optional>
            <Input id="rd-size" value={size} onChange={(e) => setSize(e.target.value)} placeholder={t('radar.sizePh')} style={{ width: 80 }} />
          </Field>
          <Field label={t('radar.maxPrice')} htmlFor="rd-max" optional error={max.invalid ? t('add.invalidAmount') : null}>
            <Input id="rd-max" money value={max.raw} onChange={(e) => max.setRaw(e.target.value)} placeholder={t('radar.maxPh')} style={{ width: 90 }} />
          </Field>
          <Field label={t('radar.minConditionLabel')} htmlFor="rd-cond" optional>
            <ConditionSelect id="rd-cond" value={minCondition} onChange={setMinCondition} />
          </Field>
          <Button type="submit" icon="plus" disabled={!brand.trim() || max.invalid}>
            {t('radar.save')}
          </Button>
        </form>
        {searches.length === 0 ? (
          <p className="t-small t-faint">{t('radar.empty')}</p>
        ) : (
          searches.map((s) => {
            const r = last[s.id];
            return (
              <section key={s.id} className="radar__search" data-testid="radar-search">
                <div className="radar__head">
                  <b>{summary(s)}</b>
                  {r && <span className="t-small t-faint">{t('radar.scanned', { when: date(r.at), n: r.deals.length, seen: r.seen })}{r.excluded ? ` · ${t('radar.excluded', { n: r.excluded })}` : ''}</span>}
                  <span className="row" style={{ gap: 6, marginLeft: 'auto' }}>
                    <Button size="sm" variant="primary" icon="search" loading={scanning === s.id} disabled={scanning !== null && scanning !== s.id} onClick={() => void scan([s])}>
                      {t('radar.scan')}
                    </Button>
                    <Button size="sm" variant="ghost" icon="x" aria-label={t('radar.remove', { what: s.brand })} onClick={() => void remove(s.id)} />
                  </span>
                </div>
                {r && (
                  <>
                    <p className="t-small t-muted">
                      {r.median ? t(`radar.median.${r.median.basis}`, { price: money(r.median.cents), n: r.median.n }) : t('radar.median.none')}
                    </p>
                    {r.deals.length === 0 ? (
                      <p className="t-small t-faint">{t('radar.noDeal')}</p>
                    ) : (
                      <ul className="radar__deals">
                        {r.deals.slice(0, 12).map((d) => (
                          <li key={d.id} className="radar__deal" data-testid="radar-deal">
                            <Thumb photoUrl={d.photoUrl} category={s.category ?? 'OTHER'} alt="" size="sm" />
                            <span className="radar__deal-title">{d.title}</span>
                            <span className="num">{money(d.priceCents)}</span>
                            <span className="num t-small t-faint">{t('radar.landed', { price: money(d.landedCents) })}</span>
                            {d.marginCents !== null ? <MarginBadge cents={d.marginCents} /> : <span />}
                            <span className="row" style={{ gap: 6 }}>
                              <a className="btn btn--sm btn--ghost" href={d.url} target="_blank" rel="noopener noreferrer">
                                {t('radar.open')}
                              </a>
                              <Button size="sm" icon={added.has(d.id) ? 'check' : 'plus'} disabled={added.has(d.id)} onClick={() => void addToPurchases(s, d)}>
                                {added.has(d.id) ? t('radar.inPurchases') : t('radar.add')}
                              </Button>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </section>
            );
          })
        )}
      </div>
    </Card>
  );
}
