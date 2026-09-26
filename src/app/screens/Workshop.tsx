import { useEffect, useMemo, useRef, useState } from 'react';
import type { Condition, Prep } from '@/domain/entities';
import { PrepSchema } from '@/domain/entities';
import { errorCode } from '@/data/adapters/marketplace';
import type { DraftInput, DraftResult, EraMessage } from '@/data/adapters/vinted/protocol';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import { buildPrediction } from '@/intelligence/precision';
import type { RefundGuard } from '@/intelligence/refunds';
import { personalEvidence } from '@/intelligence/seller-model';
import { skuOf, titleIssues } from '@/intelligence/listing';
import type { ItemView } from '@/intelligence/portfolio';
import {
  type CheckKey,
  type PackageSize,
  brandWarning,
  draftDescription,
  draftTitle,
  measureFields,
  prepStats,
  readiness,
  suggestPrice,
  suggestedPackage,
} from '@/intelligence/workshop';
import { Ring } from '@/ui/charts/charts';
import { Icon, IconTile } from '@/ui/components/icons';
import { IllustrationDone } from '@/ui/components/illustrations';
import { useErrorToast, useToast } from '@/ui/components/overlays';
import { Badge, Button, Card, EmptyState, Input, Metric, MetricValue, Money, QualityTag, Segmented } from '@/ui/components/primitives';
import { Thumb } from '@/ui/components/Thumb';
import { sumMetric } from '@/domain/money';
import { CategorySelect, ConditionSelect, useMoneyField } from '../components/forms';
import { CopyButton } from '../components/tools';
import { VintedImportButton } from '../components/vinted-import';
import { analyzeItem } from '../market-run';
import { PageHead } from '../Shell';
import { go, type Route, useEra } from '../state';
import { StockTabs } from './Stock';

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

export function Workshop({ route }: { route: Route }) {
  const { t } = useI18n();
  const era = useEra();
  const { toList, awaitingImport } = era.workshop;
  const selectedId = route.id && era.viewById.get(route.id) ? route.id : (toList[0]?.item.id ?? null);
  const v = selectedId ? era.viewById.get(selectedId)! : null;
  const stats = useMemo(() => prepStats([...era.preps.values()], era.now), [era.preps, era.now]);
  const idle = sumMetric(toList.map((x) => x.cost));
  const guards = era.refunds.guards.map((g) => g.guard);

  return (
    <>
      <PageHead
        title={t('workshop.title')}
        sub={t('workshop.subtitle')}
        tabs={<StockTabs active="workshop" />}
        actions={
          <>
            <Button icon="layers" onClick={() => go('stock?lot=1')}>
              {t('lot.button')}
            </Button>
            <VintedImportButton />
          </>
        }
      />
      <div className="stack-4">
        <section className="kpi-strip" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }} aria-label={t('workshop.title')}>
          <div className="kpi">
            <Metric small label={t('workshop.kToList')} icon="upload" tone="violet" value={<span className="num">{toList.length}</span>} foot={awaitingImport.length ? t('workshop.awaitingN', { n: awaitingImport.length }) : null} />
          </div>
          <div className="kpi">
            <Metric small label={t('workshop.kIdle')} icon="capital" tone="amber" value={<MetricValue metric={idle} />} foot={t('workshop.kIdleHint')} />
          </div>
          <div className="kpi">
            <Metric
              small
              label={t('workshop.kTime')}
              icon="clock"
              tone="cyan"
              value={<span className="num">{stats.medianMinutes === null ? '—' : t('workshop.minutes', { n: Math.max(1, Math.round(stats.medianMinutes)) })}</span>}
              foot={stats.timed ? t('workshop.kTimeHint', { n: stats.timed }) : t('workshop.kTimeNone')}
            />
          </div>
          <div className="kpi">
            <Metric small label={t('workshop.kPublished')} icon="check" tone="emerald" value={<span className="num">{stats.published7}</span>} foot={t('workshop.kPublished30', { n: stats.published30 })} />
          </div>
        </section>

        {era.refunds.guards.length > 0 && (
          <div className="guard-banner">
            <IconTile name="alert" tone="coral" size="sm" />
            <span>
              <b>{t('workshop.guardsTitle')}</b>{' '}
              {era.refunds.guards.map((g) => t(`workshop.guard.${g.guard}`, { n: g.n })).join(' · ')}
            </span>
          </div>
        )}

        {toList.length === 0 && awaitingImport.length === 0 ? (
          <Card>
            <EmptyState art={<IllustrationDone />} title={t('workshop.empty')} why={t('workshop.emptyWhy')} action={<Button icon="plus" onClick={() => go('stock?add=1')}>{t('stock.add')}</Button>} />
          </Card>
        ) : (
          <div className="grid-12 workshop">
            <div className="span-4 stack-3">
              <Card title={t('workshop.queue')} hint={t('workshop.queueHint')} icon="rows" tone="violet" flush>
                <div className="wq">
                  {toList.map((x) => (
                    <QueueRow key={x.item.id} v={x} active={x.item.id === selectedId} prep={era.preps.get(x.item.id) ?? null} guards={guards} />
                  ))}
                  {toList.length === 0 && <p className="t-muted" style={{ padding: 16 }}>{t('workshop.queueEmpty')}</p>}
                </div>
              </Card>
              {awaitingImport.length > 0 && (
                <Card title={t('workshop.awaiting')} hint={t('workshop.awaitingHint')} icon="clock" tone="cyan" flush>
                  <div className="wq">
                    {awaitingImport.map((x) => (
                      <a key={x.item.id} className="wq__row" href={`#/item/${x.item.id}`}>
                        <Thumb photoUrl={x.item.photoUrl} category={x.item.category} alt="" size="sm" />
                        <span className="wq__main">
                          <span className="clamp-1 wq__title">{x.item.title}</span>
                          <span className="t-small t-faint">
                            {t('workshop.ref')} <code>{skuOf(x.item.id)}</code>
                          </span>
                        </span>
                      </a>
                    ))}
                  </div>
                </Card>
              )}
            </div>
            <div className="span-8">{v && toList.some((x) => x.item.id === v.item.id) ? <Sheet key={v.item.id} v={v} guards={guards} /> : v ? <Card><p className="t-muted">{t('workshop.pickOne')}</p></Card> : null}</div>
          </div>
        )}
        <p className="t-small t-faint">{t('workshop.footnote')}</p>
      </div>
    </>
  );
}

function QueueRow({ v, active, prep, guards }: { v: ItemView; active: boolean; prep: Prep | null; guards: readonly RefundGuard[] }) {
  const { t } = useI18n();
  const era = useEra();
  const title = draftTitle(v.item, prep);
  const intel = era.intelById.get(v.item.id);
  const price = prep?.priceCents ?? suggestPrice(intel?.analysis ?? null, intel?.pricing ?? null, intel?.personal ?? null)?.cents ?? prep?.template?.soldCents ?? null;
  const r = readiness(v.item, prep, title, price, guards);
  const days = v.item.purchaseDate ? Math.floor((era.now - v.item.purchaseDate) / 86_400_000) : null;
  return (
    <a className="wq__row" href={`#/workshop/${v.item.id}`} aria-current={active ? 'true' : undefined}>
      <Thumb photoUrl={v.item.photoUrl} category={v.item.category} alt="" size="sm" />
      <span className="wq__main">
        <span className="clamp-1 wq__title">{v.item.title}</span>
        <span className="t-small t-faint">
          {v.item.brand}
          {v.item.size ? ` · ${v.item.size}` : ''}
          {days !== null ? ` · ${t('workshop.bought', { n: days })}` : ''}
          {v.item.status === 'DRAFT' && v.current ? ` · ${t('workshop.vintedDraft')}` : ''}
        </span>
        <span className="wq__bar" aria-label={t('workshop.readiness', { done: r.done, total: r.total })}>
          <span style={{ width: `${(r.done / r.total) * 100}%` }} className={r.ready ? 'is-ready' : ''} />
        </span>
      </span>
      <span className="wq__side">
        <Money cents={v.cost} compact />
        <span className="t-small t-faint num">
          {r.done}/{r.total}
        </span>
      </span>
    </a>
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

function Sheet({ v, guards }: { v: ItemView; guards: readonly RefundGuard[] }) {
  const { t, date } = useI18n();
  const era = useEra();
  const toast = useToast();
  const errorToast = useErrorToast();
  const item = v.item;
  const stored = era.preps.get(item.id) ?? null;
  const prep = stored ?? PrepSchema.parse({ itemId: item.id, startedAt: era.now });
  const live = usePrepTimer(item.id);
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
  const description = draftDescription(item, prep, guards, (k) => t(`workshop.m.${k}`));
  const issues = titleIssues(title, item.brand);
  const warn = brandWarning(item.brand, item.title);
  const pkg: PackageSize = prep.packageSize ?? suggestedPackage(item.category);
  const r = readiness(item, prep, title, chosen, guards);
  const done = (k: string) => r.items.find((x) => x.key === k)?.done ?? false;
  const save = (patch: Partial<Prep>) => repo.savePrep(item.id, patch);
  const toggle = (k: CheckKey) => save({ checks: prep.checks.includes(k) ? prep.checks.filter((x) => x !== k) : [...prep.checks, k] });
  const fields = measureFields(item.category);
  const totalSeconds = (stored?.seconds ?? 0) + live;

  const analyze = async () => {
    setAnalyzing(true);
    try {
      await analyzeItem(v, era.mode, era.model, era.learning, undefined, era.mode === 'demo');
    } catch (e) {
      void errorCode(e);
      errorToast(e);
    } finally {
      setAnalyzing(false);
    }
  };

  // A Vinted DRAFT prefilled from the sheet: the seller adds the photos and publishes on Vinted (EXPERIMENTAL).
  const [drafting, setDrafting] = useState(false);
  const createDraft = async () => {
    if (chosen === null) return;
    setDrafting(true);
    try {
      await repo.savePrep(item.id, { priceCents: chosen, packageSize: pkg });
      const tpl = prep.template?.listingId ? { listingId: prep.template.listingId, sameSize: (prep.template.size ?? '') === (item.size ?? '') } : null;
      const input: DraftInput = { itemId: item.id, title, description, priceCents: chosen, brand: item.brand, size: item.size, condition: item.condition, packageSize: pkg, template: tpl };
      const res = (await browser.runtime.sendMessage({ type: 'era:draft:create', input } satisfies EraMessage)) as DraftResult;
      if (!res.ok) {
        errorToast(res);
        return;
      }
      const todo = res.missing.map((k) => t(`workshop.draftField.${k}`)).join(', ');
      toast('success', t('workshop.draftDone'), res.missing.length ? t('workshop.draftTodo', { fields: todo }) : t('workshop.draftAllSet'));
      window.open(`https://www.vinted.fr/items/${res.draftId}/edit`, '_blank', 'noopener');
    } finally {
      setDrafting(false);
    }
  };

  const publish = async () => {
    await repo.markPrepPublished(item.id, chosen);
    // The asking price becomes a forecast, confronted with the real sale later.
    if (intel?.analysis && intel.pricing?.status === 'OK' && chosen) {
      const pred = buildPrediction({ itemId: item.id, at: Date.now(), analysis: intel.analysis, pricing: intel.pricing, personal, askCents: chosen, correction: era.learning.priceCorrection, kind: 'RECOMMENDATION', isDemo: item.isDemo, suggestedCents: chosen });
      if (pred) await repo.storePrediction(pred);
    }
    toast('success', t('workshop.published'), t('workshop.publishedHint', { ref: skuOf(item.id) }));
    const next = era.workshop.toList.find((x) => x.item.id !== item.id);
    go(next ? `workshop/${next.item.id}` : 'workshop');
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
            <span className="t-small t-faint num">
              <Icon name="clock" size={12} /> {t('workshop.timer', { m: Math.floor(totalSeconds / 60), s: String(totalSeconds % 60).padStart(2, '0') })}
            </span>
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
          <CategorySelect value={item.category} onChange={(c) => repo.updateItemFacts(item.id, { category: c })} />
        </Step>

        <Step n={2} title={t('workshop.s.brand')} hint={t('workshop.h.brand')} done={done('brand')}>
          <div className="row wrap" style={{ gap: 8 }}>
            <FactInput value={item.brand} onSave={(x) => repo.updateItemFacts(item.id, { brand: x })} width={200} />
            <CopyButton text={item.brand} />
          </div>
          {warn && <p className="t-small t-neg">{t(`workshop.sensitive.${warn.note}`, { brand: warn.brand })}</p>}
          <Check k="brandExact" prep={prep} onToggle={toggle} />
        </Step>

        <Step n={3} title={t('workshop.s.size')} hint={t('workshop.h.size')} done={done('size') && prep.checks.includes('sizeLabel')}>
          <FactInput value={item.size ?? ''} placeholder="M" onSave={(x) => repo.updateItemFacts(item.id, { size: x || null })} width={120} />
          <Check k="sizeLabel" prep={prep} onToggle={toggle} />
        </Step>

        <Step n={4} title={t('workshop.s.measures')} hint={guards.includes('MEASURES_REQUIRED') ? t('workshop.h.measuresRequired') : t('workshop.h.measures')} done={done('measures') && prep.checks.includes('measureZero')}>
          <div className="wmeasures">
            {fields.map((k) => (
              <label key={k} className="wmeasure">
                <span className="t-small t-muted">{t(`workshop.m.${k}`)}</span>
                <span className="row" style={{ gap: 4 }}>
                  <MeasureInput value={prep.measures[k] ?? ''} onSave={(x) => save({ measures: { ...prep.measures, [k]: x } })} />
                  <span className="t-small t-faint">cm</span>
                </span>
              </label>
            ))}
          </div>
          <Check k="measureZero" prep={prep} onToggle={toggle} />
        </Step>

        <Step n={5} title={t('workshop.s.condition')} done={!!item.condition}>
          <ConditionSelect value={item.condition ?? ''} onChange={(c) => repo.updateItemFacts(item.id, { condition: (c || null) as Condition | null })} />
          <div style={{ marginTop: 8 }}>
            <FactInput value={prep.defects} placeholder={t('workshop.defectsPh')} onSave={(x) => save({ defects: x })} width={360} />
          </div>
          <Check k="photoDefects" prep={prep} onToggle={toggle} />
        </Step>

        <Step n={6} title={t('workshop.s.colors')} hint={t('workshop.h.colors')} done={!!prep.colors.trim()}>
          <FactInput value={prep.colors} placeholder={t('workshop.colorsPh')} onSave={(x) => save({ colors: x })} width={220} />
          {guards.includes('DESCRIPTION_CHECK') && <Check k="colorDaylight" prep={prep} onToggle={toggle} />}
        </Step>

        <Step n={7} title={t('workshop.s.material')} hint={t('workshop.h.material')} done={!!(prep.material.trim() || item.material)}>
          <div className="row wrap" style={{ gap: 8 }}>
            <FactInput value={prep.material || item.material || ''} placeholder="100 % coton" onSave={(x) => save({ material: x })} width={220} />
            <Button size="sm" variant="ghost" onClick={() => save({ material: t('workshop.unreadable') })}>
              {t('workshop.unreadable')}
            </Button>
          </div>
        </Step>

        <Step n={8} title={t('workshop.s.title')} hint={t('workshop.h.title')} done={done('title')}>
          <div className="row wrap" style={{ gap: 8, marginBottom: 8 }}>
            <span className="t-small t-muted">{t('workshop.productRef')}</span>
            <FactInput value={prep.productRef} placeholder="FZ6700-121" onSave={(x) => save({ productRef: x })} width={180} />
          </div>
          {editTitle ? (
            <FactInput value={title} onSave={(x) => { void save({ titleOverride: x || null }); setEditTitle(false); }} width="100%" autoFocus />
          ) : (
            <div className="wcopy">
              <span className="wcopy__text">{title}</span>
              <span className="t-small t-faint num">{title.length}/60</span>
              <CopyButton text={title} />
              <Button size="sm" variant="ghost" icon="edit" onClick={() => setEditTitle(true)} aria-label={t('common.edit')} />
            </div>
          )}
          {prep.titleOverride && !title.includes(skuOf(item.id)) && <p className="t-small t-warn">{t('workshop.refMissing', { ref: skuOf(item.id) })}</p>}
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
          {editDesc ? (
            <textarea
              className="input wdesc"
              defaultValue={description}
              rows={12}
              onBlur={(e) => {
                void save({ descriptionOverride: e.target.value === draftDescription(item, { ...prep, descriptionOverride: null }, guards, (k) => t(`workshop.m.${k}`)) ? null : e.target.value });
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
            <Button variant="ghost" size="sm" icon="external" onClick={() => window.open(`https://www.vinted.fr/items/${prep.vintedDraftId}/edit`, '_blank', 'noopener')}>
              {t('workshop.draftOpen')}
            </Button>
          ) : (
            <Button variant="ghost" size="sm" icon="upload" loading={drafting} disabled={chosen === null || !title.trim()} onClick={createDraft}>
              {t('workshop.draftCreate')}
            </Button>
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
function FactInput({ value, onSave, placeholder, width, autoFocus }: { value: string; onSave: (v: string) => void; placeholder?: string; width?: number | string; autoFocus?: boolean }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <Input
      value={v}
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

function MeasureInput({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  return <FactInput value={value} onSave={onSave} placeholder="—" width={72} />;
}
