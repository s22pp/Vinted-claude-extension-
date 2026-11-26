import { useEffect, useRef, useState } from 'react';
import type { Condition, Prep } from '@/domain/entities';
import { newPrep } from '@/domain/entities';
import type { DraftInput, DraftResult, EraMessage, PublishResult } from '@/data/adapters/vinted/protocol';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import { buildPrediction } from '@/intelligence/precision';
import type { RefundGuard } from '@/intelligence/refunds';
import { personalEvidence } from '@/intelligence/seller-model';
import { skuOf, titleIssues } from '@/intelligence/listing';
import type { ItemView } from '@/intelligence/portfolio';
import { withWord } from '@/intelligence/title-words';
import { type CheckKey, type PackageSize, brandWarning, draftDescription, draftTitle, measureFields, readiness, suggestPrice, suggestedPackage } from '@/intelligence/workshop';
import { type GenFacts, generatedDescription, generatedPrice, generatedTitle, listingBundle } from '@/intelligence/listing-generator';
import { Ring } from '@/ui/charts/ring';
import { Icon } from '@/ui/components/icons';
import { useErrorToast, useToast } from '@/ui/components/overlays';
import { Badge, Button, Input, Money, QualityTag, Segmented } from '@/ui/components/primitives';
import { Thumb } from '@/ui/components/Thumb';
import { analyzeItem } from '../market-run';
import { go, useEra } from '../state';
import { DescTemplatePicker, useDescTemplates } from './desc-templates';
import { CategorySelect, ConditionSelect, useMoneyField } from './forms';
import { TitleWords } from './title-words';
import { GeminiRewrite } from './gemini';
import type { DraftFacts } from '@/intelligence/ai-draft';
import { CopyButton } from './tools';

const IDLE_MS = 120_000;

/** Measured time with the sheet open: counts only while the window is visible and the seller is active. */
function usePrepTimer(itemId: string | null) {
  const [live, setLive] = useState(0);
  const lastActivity = useRef(Date.now());
  useEffect(() => {
    if (!itemId) return;
    setLive(0);
    let pending = 0;
    const mark = () => (lastActivity.current = Date.now());
    const events = ['pointerdown', 'keydown', 'input', 'scroll'] as const;
    for (const e of events) window.addEventListener(e, mark, { passive: true });
    const tick = setInterval(() => {
      if (document.visibilityState === 'visible' && Date.now() - lastActivity.current < IDLE_MS) {
        pending += 1;
        setLive((x) => x + 1);
      }
    }, 1000);
    const flush = setInterval(() => {
      if (pending) void repo.addPrepTime(itemId, pending);
      pending = 0;
    }, 10_000);
    return () => {
      for (const e of events) window.removeEventListener(e, mark);
      clearInterval(tick);
      clearInterval(flush);
      if (pending) void repo.addPrepTime(itemId, pending);
    };
  }, [itemId]);
  return live;
}

/** Time spent on the sheet: ticks every second on its own, so the sheet itself is not redrawn each second. */
function PrepClock({ itemId, stored }: { itemId: string; stored: number }) {
  const { t } = useI18n();
  const live = usePrepTimer(itemId);
  const total = stored + live;
  return (
    <span className="t-small t-faint num">
      <Icon name="clock" size={12} /> {t('workshop.timer', { m: Math.floor(total / 60), s: String(total % 60).padStart(2, '0') })}
    </span>
  );
}

function Step({ n, title, hint, children, done }: { n: number; title: string; hint?: string; children: React.ReactNode; done?: boolean }) {
  return (
    <section className={`wstep ${done ? 'is-done' : ''}`}>
      <span className="wstep__n num" aria-hidden="true">
        {n}
      </span>
      <div className="wstep__body">
        <div className="wstep__title">{title}</div>
        {hint && <div className="wstep__hint">{hint}</div>}
        <div className="wstep__content">{children}</div>
      </div>
    </section>
  );
}

/** The listing sheet of one article, in Vinted's form order: every field to type, check or copy, then publish. */
export function WorkshopSheet({ v, guards }: { v: ItemView; guards: readonly RefundGuard[] }) {
  const i18n = useI18n();
  const { t, date } = i18n;
  const era = useEra();
  const toast = useToast();
  const errorToast = useErrorToast();
  const item = v.item;
  const stored = era.preps.get(item.id) ?? null;
  const prep = stored ?? newPrep(item.id, era.now);
  const [analyzing, setAnalyzing] = useState(false);
  const [editTitle, setEditTitle] = useState(false);
  const [editDesc, setEditDesc] = useState(false);
  const intel = era.intelById.get(item.id) ?? null;
  const personal = intel?.personal ?? personalEvidence(era.model, item);
  const suggestion = suggestPrice(intel && !intel.analysisStale ? intel.analysis : null, intel && !intel.analysisStale ? intel.pricing : null, personal);
  // Copied from a similar article: its real sale price is the reference when nothing better exists.
  const price = useMoneyField(prep.priceCents ?? suggestion?.cents ?? prep.template?.soldCents ?? null);
  const chosen = price.invalid ? null : price.cents;
  const title = draftTitle(item, prep);
  const templates = useDescTemplates();
  const description = draftDescription(item, prep, guards, (k) => t(`workshop.m.${k}`), templates);
  const issues = titleIssues(title, item.brand);
  const warn = brandWarning(item.brand, item.title);
  const pkg: PackageSize = prep.packageSize ?? suggestedPackage(item.category);
  const r = readiness(item, prep, title, chosen, guards);
  const done = (k: string) => r.items.find((x) => x.key === k)?.done ?? false;
  const save = (patch: Partial<Prep>) => repo.savePrep(item.id, patch);
  const toggle = (k: CheckKey) => save({ checks: prep.checks.includes(k) ? prep.checks.filter((x) => x !== k) : [...prep.checks, k] });
  const fields = measureFields(item.category);

  const analyze = async () => {
    setAnalyzing(true);
    try {
      await analyzeItem(v, era.mode, era.model, era.learning, undefined, era.mode === 'demo');
    } catch (e) {
      errorToast(e);
    } finally {
      setAnalyzing(false);
    }
  };

  // A Vinted DRAFT prefilled from the sheet, with the seller's own photos when chosen here; published from ERA on the
  // seller's click (EXPERIMENTAL).
  const [drafting, setDrafting] = useState(false);
  const [photos, setPhotos] = useState<File[]>([]);
  const [publishing, setPublishing] = useState(false);
  const asBase64 = (f: File) =>
    new Promise<{ base64: string; mime: string }>((done, fail) => {
      const r = new FileReader();
      r.onload = () => done({ base64: String(r.result).split(',')[1] ?? '', mime: f.type || 'image/jpeg' });
      r.onerror = () => fail(r.error);
      r.readAsDataURL(f);
    });
  // The listing generator: the house's title, a structured description with hashtags, the market's median + 10 %.
  const measures = fields
    .map((k) => (prep.measures[k]?.trim() ? `${t(`workshop.m.${k}`)} ${/^\d+([.,]\d+)?$/.test(prep.measures[k]!.trim()) ? `${prep.measures[k]!.trim()} cm` : prep.measures[k]!.trim()}` : null))
    .filter(Boolean)
    .join(' · ');
  // What Gemini may draw on when it rewords the description: ERA's facts only.
  const aiFacts: DraftFacts = {
    title,
    brand: item.brand,
    size: item.size,
    condition: item.condition ? t(`condition.${item.condition}`) : null,
    defects: prep.defects.trim() || null,
    material: prep.material.trim() || item.material || null,
    measures: measures || null,
    price: chosen !== null ? i18n.money(chosen) : null,
  };
  const generate = async () => {
    const facts: GenFacts = {
      category: item.category,
      brand: item.brand,
      model: item.model,
      size: item.size,
      era: item.era,
      condition: item.condition,
      gender: item.gender,
      hook: prep.hook || null,
      vibe: prep.vibe || null,
      fit: prep.fit || null,
      colors: prep.colors || null,
      material: prep.material || item.material || null,
      defects: prep.defects || null,
      measureValues: prep.measures,
    };
    const genPrice = generatedPrice(intel && !intel.analysisStale ? intel.analysis : null);
    await save({ titleOverride: generatedTitle(facts), descriptionOverride: generatedDescription(facts), ...(genPrice !== null ? { priceCents: genPrice } : {}) });
    if (genPrice !== null) price.setRaw(String(genPrice / 100).replace('.', ','));
    toast('success', t('workshop.generated'), genPrice !== null ? t('workshop.generatedPrice', { price: i18n.money(genPrice) }) : t('workshop.generatedNoPrice'));
  };

  const createDraft = async (): Promise<string | null> => {
    if (chosen === null) return null;
    setDrafting(true);
    try {
      await repo.savePrep(item.id, { priceCents: chosen, packageSize: pkg });
      const tpl = prep.template?.listingId ? { listingId: prep.template.listingId, sameSize: (prep.template.size ?? '') === (item.size ?? '') } : null;
      const input: DraftInput = { itemId: item.id, title, description, priceCents: chosen, brand: item.brand, size: item.size, condition: item.condition, packageSize: pkg, template: tpl, photos: await Promise.all(photos.map(asBase64)) };
      const res = (await browser.runtime.sendMessage({ type: 'era:draft:create', input } satisfies EraMessage)) as DraftResult;
      if (!res.ok) {
        errorToast(res);
        return null;
      }
      const todo = res.missing.map((k) => t(`workshop.draftField.${k}`)).join(', ');
      toast('success', t('workshop.draftDone'), res.missing.length ? t('workshop.draftTodo', { fields: todo }) : t('workshop.draftAllSet'));
      // Without the seller's photos, the draft is completed on Vinted; with them, it can be published from here.
      if (!photos.length) window.open(`https://www.vinted.fr/items/${res.draftId}/edit`, '_blank', 'noopener');
      return res.draftId;
    } finally {
      setDrafting(false);
    }
  };

  /** « Publier sur Vinted maintenant »: the draft made with the chosen photos, then published — one click. */
  const publishNow = async () => {
    const draftId = await createDraft();
    if (!draftId) return;
    setPublishing(true);
    try {
      const res = (await browser.runtime.sendMessage({ type: 'era:draft:publish', draftId, itemId: item.id } satisfies EraMessage)) as PublishResult;
      if (!res.ok) {
        errorToast(res);
        return;
      }
      toast('success', t('workshop.publishedOnVinted'), res.verified ? t('workshop.publishedVerified') : t('workshop.publishedUnconfirmed'));
      await publish();
    } finally {
      setPublishing(false);
    }
  };

  const publishOnVinted = async () => {
    if (!prep.vintedDraftId) return;
    setPublishing(true);
    try {
      const res = (await browser.runtime.sendMessage({ type: 'era:draft:publish', draftId: prep.vintedDraftId, itemId: item.id } satisfies EraMessage)) as PublishResult;
      if (!res.ok) {
        errorToast(res);
        return;
      }
      toast('success', t('workshop.publishedOnVinted'), res.verified ? t('workshop.publishedVerified') : t('workshop.publishedUnconfirmed'));
      await publish();
    } finally {
      setPublishing(false);
    }
  };

  const publish = async () => {
    // Where the seller is now: if they move to another screen while this is saved, they stay there.
    const from = location.hash;
    await repo.markPrepPublished(item.id, chosen);
    // The asking price becomes a forecast, confronted with the real sale later.
    if (intel?.analysis && intel.pricing?.status === 'OK' && chosen) {
      const pred = buildPrediction({ itemId: item.id, at: Date.now(), analysis: intel.analysis, pricing: intel.pricing, personal, askCents: chosen, correction: era.learning.priceCorrection, kind: 'RECOMMENDATION', isDemo: item.isDemo, suggestedCents: chosen });
      if (pred) await repo.storePrediction(pred);
    }
    toast('success', t('workshop.published'), t('workshop.publishedHint', { ref: skuOf(item.id) }));
    const next = era.workshop.toList.find((x) => x.item.id !== item.id);
    if (location.hash === from) go(next ? `workshop/${next.item.id}` : 'workshop');
  };

  return (
    <article className="card sheet">
      <header className="sheet__head">
        <Thumb photoUrl={item.photoUrl} category={item.category} alt={item.title} size="md" />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row wrap" style={{ gap: 6 }}>
            <Badge tone="violet">
              {t('workshop.ref')} {skuOf(item.id)}
            </Badge>
            {item.status === 'DRAFT' && v.current && <Badge tone="cobalt">{t('workshop.vintedDraft')}</Badge>}
            <PrepClock itemId={item.id} stored={stored?.seconds ?? 0} />
          </div>
          <h2 className="t-h2 clamp-1" style={{ marginTop: 6 }}>
            {item.title}
          </h2>
          <p className="t-small t-muted">
            {t('capital.invested')} <Money cents={v.cost} compact /> · <a href={`#/item/${item.id}`}>{t('workshop.openItem')}</a>
          </p>
        </div>
        <Ring value={r.done} max={r.total} size={64} stroke={6}>
          <span className="num" style={{ fontWeight: 650, fontSize: 13 }}>
            {r.done}/{r.total}
          </span>
        </Ring>
      </header>

      <p className="sheet__rule t-small">
        <Icon name="info" size={13} /> {t('workshop.orderRule')}
      </p>

      <div className="wsteps">
        <Step n={1} title={t('workshop.s.category')} hint={t('workshop.h.category')} done={done('category')}>
          <CategorySelect aria-label={t('workshop.s.category')} value={item.category} onChange={(c) => repo.updateItemFacts(item.id, { category: c })} />
        </Step>

        <Step n={2} title={t('workshop.s.brand')} hint={t('workshop.h.brand')} done={done('brand')}>
          <div className="row wrap" style={{ gap: 8 }}>
            <FactInput value={item.brand} label={t('workshop.s.brand')} onSave={(x) => repo.updateItemFacts(item.id, { brand: x })} width={200} />
            <CopyButton text={item.brand} />
          </div>
          {warn && <p className="t-small t-neg">{t(`workshop.sensitive.${warn.note}`, { brand: warn.brand })}</p>}
          <Check k="brandExact" prep={prep} onToggle={toggle} />
        </Step>

        <Step n={3} title={t('workshop.s.size')} hint={t('workshop.h.size')} done={done('size') && prep.checks.includes('sizeLabel')}>
          <FactInput value={item.size ?? ''} label={t('workshop.s.size')} placeholder="M" onSave={(x) => repo.updateItemFacts(item.id, { size: x || null })} width={120} />
          <Check k="sizeLabel" prep={prep} onToggle={toggle} />
        </Step>

        <Step n={4} title={t('workshop.s.measures')} hint={guards.includes('MEASURES_REQUIRED') ? t('workshop.h.measuresRequired') : t('workshop.h.measures')} done={done('measures') && prep.checks.includes('measureZero')}>
          <div className="wmeasures">
            {fields.map((k) => (
              <label key={k} className="wmeasure">
                <span className="t-small t-muted">{t(`workshop.m.${k}`)}</span>
                <span className="row" style={{ gap: 4 }}>
                  <MeasureInput value={prep.measures[k] ?? ''} label={t(`workshop.m.${k}`)} onSave={(x) => save({ measures: { ...prep.measures, [k]: x } })} />
                  <span className="t-small t-faint">cm</span>
                </span>
              </label>
            ))}
          </div>
          <Check k="measureZero" prep={prep} onToggle={toggle} />
        </Step>

        <Step n={5} title={t('workshop.s.condition')} done={!!item.condition}>
          <ConditionSelect aria-label={t('workshop.s.condition')} value={item.condition ?? ''} onChange={(c) => repo.updateItemFacts(item.id, { condition: (c || null) as Condition | null })} />
          <div style={{ marginTop: 8 }}>
            <FactInput value={prep.defects} label={t('workshop.s.condition')} placeholder={t('workshop.defectsPh')} onSave={(x) => save({ defects: x })} width={360} />
          </div>
          <Check k="photoDefects" prep={prep} onToggle={toggle} />
        </Step>

        <Step n={6} title={t('workshop.s.colors')} hint={t('workshop.h.colors')} done={!!prep.colors.trim()}>
          <FactInput value={prep.colors} label={t('workshop.s.colors')} placeholder={t('workshop.colorsPh')} onSave={(x) => save({ colors: x })} width={220} />
          {guards.includes('DESCRIPTION_CHECK') && <Check k="colorDaylight" prep={prep} onToggle={toggle} />}
        </Step>

        <Step n={7} title={t('workshop.s.material')} hint={t('workshop.h.material')} done={!!(prep.material.trim() || item.material)}>
          <div className="row wrap" style={{ gap: 8 }}>
            <FactInput value={prep.material || item.material || ''} label={t('workshop.s.material')} placeholder="100 % coton" onSave={(x) => save({ material: x })} width={220} />
            <Button size="sm" variant="ghost" onClick={() => save({ material: t('workshop.unreadable') })}>
              {t('workshop.unreadable')}
            </Button>
          </div>
        </Step>

        <Step n={8} title={t('workshop.s.title')} hint={t('workshop.h.title')} done={done('title')}>
          <div className="row wrap" style={{ gap: 8, marginBottom: 8 }}>
            <FactInput value={prep.hook ?? ''} label={t('workshop.hook')} placeholder={t('workshop.hookPh')} onSave={(x) => save({ hook: x })} width={130} />
            <FactInput value={prep.vibe ?? ''} label={t('workshop.vibe')} placeholder={t('workshop.vibePh')} onSave={(x) => save({ vibe: x })} width={200} />
            <FactInput value={prep.fit ?? ''} label={t('workshop.fit')} placeholder={t('workshop.fitPh')} onSave={(x) => save({ fit: x })} width={120} />
          </div>
          <div className="row wrap" style={{ gap: 8, marginBottom: 8 }}>
            <Button size="sm" variant="primary" icon="edit" onClick={() => void generate()} data-testid="generate-listing">
              {t('workshop.generate')}
            </Button>
            <CopyButton text={listingBundle(title, description, chosen !== null ? i18n.money(chosen) : null)} label={t('workshop.copyAll')} />
            <span className="t-small t-faint">{t('workshop.generateHint')}</span>
          </div>
          <div className="row wrap" style={{ gap: 8, marginBottom: 8 }}>
            <span className="t-small t-muted">{t('workshop.productRef')}</span>
            <FactInput value={prep.productRef} label={t('workshop.productRef')} placeholder="FZ6700-121" onSave={(x) => save({ productRef: x })} width={180} />
          </div>
          {editTitle ? (
            <FactInput value={title} label={t('workshop.s.title')} onSave={(x) => { void save({ titleOverride: x || null }); setEditTitle(false); }} width="100%" autoFocus />
          ) : (
            <div className="wcopy">
              <span className="wcopy__text">{title}</span>
              <span className="t-small t-faint num">{title.length}/60</span>
              <CopyButton text={title} />
              <Button size="sm" variant="ghost" icon="edit" onClick={() => setEditTitle(true)} aria-label={t('common.edit')} />
            </div>
          )}
          {prep.titleOverride && !title.includes(skuOf(item.id)) && <p className="t-small t-warn">{t('workshop.refMissing', { ref: skuOf(item.id) })}</p>}
          <div style={{ marginTop: 8 }}>
            <TitleWords intel={intel} title={title} brand={item.brand} withWordFn={(w) => withWord(title, w, skuOf(item.id))} onAdd={(w) => void save({ titleOverride: withWord(title, w, skuOf(item.id)) })} onAnalyze={() => void analyze()} analyzing={analyzing} />
          </div>
          {issues.length > 0 && (
            <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
              {issues.map((x) => (
                <Badge key={x.code + x.match} tone={x.severity === 'block' ? 'coral' : 'amber'}>
                  {t(`listing.issue.${x.code}`, { match: x.match })}
                </Badge>
              ))}
            </div>
          )}
        </Step>

        <Step n={9} title={t('workshop.s.description')} hint={description.includes('__') ? t('workshop.h.descriptionBlanks') : undefined} done={!description.includes('__')}>
          <DescTemplatePicker item={item} prep={prep} description={description} templates={templates} onPick={(id) => void save({ descTemplateId: id })} />
          {editDesc ? (
            <textarea
              className="input wdesc"
              defaultValue={description}
              rows={12}
              onBlur={(e) => {
                void save({ descriptionOverride: e.target.value === draftDescription(item, { ...prep, descriptionOverride: null }, guards, (k) => t(`workshop.m.${k}`), templates) ? null : e.target.value });
                setEditDesc(false);
              }}
              autoFocus
            />
          ) : (
            <pre className="wdesc">{description}</pre>
          )}
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <CopyButton text={description} />
            <Button size="sm" variant="ghost" icon="edit" onClick={() => setEditDesc(true)}>
              {t('common.edit')}
            </Button>
            {prep.descriptionOverride && (
              <Button size="sm" variant="ghost" onClick={() => save({ descriptionOverride: null })}>
                {t('workshop.regenerate')}
              </Button>
            )}
          </div>
          <GeminiRewrite facts={aiFacts} text={description} brand={item.brand} onUse={(x) => void save({ descriptionOverride: x })} />
        </Step>

        <Step n={10} title={t('workshop.s.price')} hint={t('workshop.h.price')} done={done('price')}>
          <div className="row wrap" style={{ gap: 10, alignItems: 'center' }}>
            <Input
              money
              value={price.raw}
              onChange={(e) => price.setRaw(e.target.value)}
              onBlur={() => !price.invalid && save({ priceCents: price.cents })}
              style={{ width: 110 }}
              aria-label={t('workshop.s.price')}
            />
            {chosen !== null && <CopyButton text={String(Math.round(chosen / 100))} />}
            {suggestion ? (
              <span className="t-small t-muted">
                {suggestion.basis === 'MARKET'
                  ? t('workshop.priceMarket', { price: suggestion.cents, n: suggestion.n, min: suggestion.range!.min, max: suggestion.range!.max })
                  : t('workshop.pricePersonal', { price: suggestion.cents, n: suggestion.n })}
                {suggestion.expectedCents !== null && ` · ${t('workshop.expected', { price: suggestion.expectedCents })}`}
              </span>
            ) : (
              <Button size="sm" variant="primary" icon="market" loading={analyzing} onClick={analyze}>
                {t('workshop.analyze')}
              </Button>
            )}
            {suggestion && intel?.analysisStale && (
              <Button size="sm" variant="ghost" icon="market" loading={analyzing} onClick={analyze}>
                {t('item.reanalyze')}
              </Button>
            )}
          </div>
          {chosen !== null && v.cost !== null && (
            <p className="t-small" style={{ marginTop: 6 }}>
              {t('workshop.margin', { profit: chosen - v.cost })} {v.cost !== null && !v.costComplete ? <QualityTag quality="PARTIAL" text={t('cost.exShippingShort')} /> : null}
            </p>
          )}
          {prep.template && (
            <p className="t-small t-muted" data-testid="relist-ref">
              {prep.template.soldCents !== null && prep.template.soldAt !== null
                ? t('relist.priceRef', { price: prep.template.soldCents, date: date(prep.template.soldAt), title: prep.template.title })
                : t('relist.from', { title: prep.template.title })}
            </p>
          )}
          <p className="t-small t-faint">{t('workshop.priceChallenge')}</p>
        </Step>

        <Step n={11} title={t('workshop.s.package')} hint={t('workshop.h.package')} done>
          <Segmented
            label={t('workshop.s.package')}
            value={pkg}
            onChange={(x) => save({ packageSize: x })}
            options={(['SMALL', 'MEDIUM', 'LARGE'] as PackageSize[]).map((x) => ({ value: x, label: `${t(`workshop.pkg.${x}`)}${x === suggestedPackage(item.category) ? ' ★' : ''}` }))}
          />
        </Step>
      </div>

      <section className="wphotos">
        <div className="t-caption" style={{ marginBottom: 8 }}>
          {t('workshop.photos')}
        </div>
        {(['photoLogo', 'photoComposition', 'photoSizeLabel', ...(guards.includes('PACKAGING') ? (['packagingProtected'] as CheckKey[]) : [])] as CheckKey[]).map((k) => (
          <Check key={k} k={k} prep={prep} onToggle={toggle} />
        ))}
        <p className="t-small t-faint">{t('workshop.photosRule')}</p>
      </section>

      <footer className="sheet__foot">
        <div className="grow t-small">
          {r.ready ? (
            <span className="t-pos">{t('workshop.ready')}</span>
          ) : (
            <span className="t-muted">
              {t('workshop.remaining', { n: r.total - r.done })} : {r.items.filter((x) => !x.done).map((x) => t(`workshop.r.${x.key}`)).join(' · ')}
            </span>
          )}
        </div>
        {era.mode === 'real' &&
          (prep.vintedDraftId ? (
            <>
              <Button variant="ghost" size="sm" icon="external" onClick={() => window.open(`https://www.vinted.fr/items/${prep.vintedDraftId}/edit`, '_blank', 'noopener')}>
                {t('workshop.draftOpen')}
              </Button>
              <Button variant="primary" size="sm" icon="upload" loading={publishing} disabled={publishing} onClick={() => void publishOnVinted()}>
                {t('workshop.publishOnVinted')}
              </Button>
            </>
          ) : (
            <>
              <label className="btn btn--sm btn--ghost" style={{ cursor: 'pointer' }}>
                <input type="file" accept="image/jpeg,image/png,image/webp,image/heic" multiple aria-label={t('workshop.photosPick')} style={{ display: 'none' }} onChange={(e) => setPhotos([...(e.target.files ?? [])].slice(0, 20))} />
                {photos.length ? t('workshop.photosChosen', { n: photos.length }) : t('workshop.photosPick')}
              </label>
              <Button variant="ghost" size="sm" icon="upload" loading={drafting && !publishing} disabled={chosen === null || !title.trim()} onClick={() => void createDraft()}>
                {t('workshop.draftCreate')}
              </Button>
              <Button variant="primary" size="sm" icon="upload" loading={publishing} disabled={chosen === null || !title.trim() || !photos.length || drafting} title={photos.length ? undefined : t('workshop.publishNowNeedsPhotos')} onClick={() => void publishNow()} data-testid="publish-now">
                {t('workshop.publishNow')}
              </Button>
            </>
          ))}
        {!r.ready && (
          <Button variant="ghost" size="sm" onClick={publish}>
            {t('workshop.publishAnyway')}
          </Button>
        )}
        <Button variant="primary" icon="check" disabled={!r.ready} onClick={publish}>
          {t('workshop.publish')}
        </Button>
      </footer>
      <p className="t-small t-faint" style={{ marginTop: 8 }}>
        {t('workshop.publishNote', { ref: skuOf(item.id) })}
      </p>
    </article>
  );
}

function Check({ k, prep, onToggle }: { k: CheckKey; prep: Prep; onToggle: (k: CheckKey) => void }) {
  const { t } = useI18n();
  return (
    <label className="wcheck">
      <input type="checkbox" className="checkbox" checked={prep.checks.includes(k)} onChange={() => onToggle(k)} />
      <span>{t(`workshop.c.${k}`)}</span>
    </label>
  );
}

/** Saves on blur / Enter: no save per keystroke. */
function FactInput({ value, onSave, placeholder, width, autoFocus, label }: { value: string; onSave: (v: string) => void; placeholder?: string; width?: number | string; autoFocus?: boolean; label: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <Input
      value={v}
      aria-label={label}
      placeholder={placeholder}
      autoFocus={autoFocus}
      style={{ width, maxWidth: '100%' }}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v.trim() !== value && onSave(v.trim())}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function MeasureInput({ value, onSave, label }: { value: string; onSave: (v: string) => void; label: string }) {
  return <FactInput value={value} onSave={onSave} placeholder="—" width={72} label={label} />;
}
