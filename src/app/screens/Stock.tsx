import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '@/i18n';
import type { ItemIntel } from '@/intelligence/decision';
import type { ItemView } from '@/intelligence/portfolio';
import { Icon } from '@/ui/components/icons';
import { IllustrationStock } from '@/ui/components/illustrations';
import { useErrorToast, useToast } from '@/ui/components/overlays';
import { Badge, Button, Card, EmptyState, Money, SearchInput, Segmented } from '@/ui/components/primitives';
import { Thumb } from '@/ui/components/Thumb';
import { RecoChip, StatusBadge } from '../components/domain';
import { VintedImportButton } from '../components/vinted-import';
import { PurchasesBanner } from '../components/purchases';
import { AddItemDrawer, ImportCsvModal } from '../components/forms';
import { LotDrawer } from '../components/lot';
import { CostsDrawer } from '../components/costs';
import { analyzeItem } from '../market-run';
import { errorCode } from '@/data/adapters/marketplace';
import { PageHead } from '../Shell';
import { go, type Route, useEra } from '../state';
import type { CapitalPosition } from '@/intelligence/capital';
import type { TodayPriority } from '@/intelligence/decision';
import { nicheKey } from '@/intelligence/seller-model';
import { stockCsv } from '@/intelligence/accounting';
import { downloadText } from '@/lib/download';
import { IconTile } from '@/ui/components/icons';
import { PRIO, usePriorityTitle } from '../components/priorities';

type Filter = 'all' | 'listed' | 'reserved' | 'hidden' | 'draft' | 'sold' | 'attention' | 'nocost';
type ColKey = 'brand' | 'size' | 'cost' | 'price' | 'margin' | 'roi' | 'yield' | 'views' | 'favorites' | 'age' | 'listings' | 'status' | 'reco';
type SortKey = 'title' | ColKey;

interface Row {
  v: ItemView;
  intel: ItemIntel | null;
}

const ALL_COLS: ColKey[] = ['brand', 'size', 'cost', 'price', 'margin', 'roi', 'yield', 'views', 'favorites', 'age', 'listings', 'status', 'reco'];
const STATUS_ORDER = ['RESERVED', 'LISTED', 'HIDDEN', 'DRAFT', 'SOLD', 'ARCHIVED'];
const DEFAULT_COLS: ColKey[] = ['status', 'cost', 'price', 'margin', 'views', 'favorites', 'age', 'reco'];
const NUMERIC = new Set<ColKey>(['cost', 'price', 'margin', 'roi', 'yield', 'views', 'favorites', 'age', 'listings']);

function sortValue(r: Row, k: SortKey, pos?: CapitalPosition): number | string | null {
  const v = r.v;
  switch (k) {
    case 'title':
      return v.item.title.toLowerCase();
    case 'brand':
      return v.item.brand.toLowerCase();
    case 'size':
      return v.item.size ?? null;
    case 'cost':
      return v.cost;
    case 'price':
      return v.askPrice ?? v.sale?.salePriceCents ?? null;
    case 'margin':
      return v.potentialProfit;
    case 'roi':
      return pos?.potentialRoi ?? null;
    case 'yield':
      return pos?.efficiency30 ?? null;
    case 'views':
      return v.current?.views ?? null;
    case 'favorites':
      return v.current?.favorites ?? null;
    case 'age':
      return v.daysHeld;
    case 'listings':
      return v.listings.length;
    case 'status':
      return STATUS_ORDER.indexOf(v.item.status);
    case 'reco':
      return r.intel?.recommendation?.priority ?? null;
  }
}

function loadPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function savePref(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* per-viewer convenience only */
  }
}

export function Stock({ route }: { route: Route }) {
  const i18n = useI18n();
  const { t } = i18n;
  const prioTitle = usePriorityTitle();
  const era = useEra();
  const toast = useToast();
  const errorToast = useErrorToast();
  const [q, setQ] = useState(route.query.get('q') ?? '');
  const [filter, setFilter] = useState<Filter>((route.query.get('filter') as Filter) ?? 'all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>(() => ({ key: (route.query.get('sort') as SortKey) ?? 'reco', dir: -1 }));
  const [density, setDensity] = useState<'compact' | 'comfortable'>(() => loadPref('era.stock.density', 'compact'));
  const [cols, setCols] = useState<ColKey[]>(() => loadPref('era.stock.cols.v3', DEFAULT_COLS));
  const [showCols, setShowCols] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const addOpen = route.query.get('add') === '1';
  const [importOpen, setImportOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => savePref('era.stock.density', density), [density]);
  useEffect(() => savePref('era.stock.cols.v3', cols), [cols]);
  useEffect(() => {
    const f = route.query.get('filter') as Filter | null;
    if (f) setFilter(f);
  }, [route.query.get('filter')]);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  const rows: Row[] = useMemo(() => era.views.map((v) => ({ v, intel: era.intelById.get(v.item.id) ?? null })), [era.views, era.intelById]);
  const positions = useMemo(() => new Map(era.capital.positions.map((p) => [p.itemId, p])), [era.capital.positions]);
  // A priority from Today (or an age slice) opens exactly the items it counts.
  const focus = route.query.get('focus');
  const focusSet = useMemo(() => {
    if (!focus) return null;
    const age = /^AGE(\d+)$/.exec(focus);
    if (age) return new Set(era.views.filter((v) => v.inStock && (v.daysHeld ?? 0) >= Number(age[1])).map((v) => v.item.id));
    if (focus.startsWith('NICHE:')) {
      const key = focus.slice(6);
      return new Set(era.views.filter((v) => v.inStock && nicheKey(v.item.brand, v.item.model, v.item.category) === key).map((v) => v.item.id));
    }
    return new Set(era.priorities.find((p) => p.code === focus)?.itemIds ?? []);
  }, [focus, era.views, era.priorities]);
  const focusPriority = focus ? (era.priorities.find((p) => p.code === focus) ?? null) : null;
  useEffect(() => {
    if (focus?.startsWith('AGE') || focus === 'CAPITAL_AGED' || focus === 'TRAPS') setSort({ key: 'age', dir: -1 });
  }, [focus]);
  const counts = useMemo(
    () => ({
      all: rows.length,
      listed: rows.filter((r) => r.v.item.status === 'LISTED').length,
      reserved: rows.filter((r) => r.v.item.status === 'RESERVED').length,
      hidden: rows.filter((r) => r.v.item.status === 'HIDDEN').length,
      draft: rows.filter((r) => r.v.item.status === 'DRAFT').length,
      sold: rows.filter((r) => r.v.item.status === 'SOLD').length,
      attention: rows.filter((r) => r.intel?.recommendation && r.intel.recommendation.tone !== 'info').length,
      nocost: rows.filter((r) => r.v.inStock && r.v.cost === null).length,
    }),
    [rows],
  );

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = rows.filter((r) => {
      if (focusSet) return focusSet.has(r.v.item.id) && (!needle || `${r.v.item.title} ${r.v.item.brand} ${r.v.item.model ?? ''}`.toLowerCase().includes(needle));
      const s = r.v.item.status;
      if (filter === 'listed' && s !== 'LISTED') return false;
      if (filter === 'reserved' && s !== 'RESERVED') return false;
      if (filter === 'hidden' && s !== 'HIDDEN') return false;
      if (filter === 'draft' && s !== 'DRAFT') return false;
      if (filter === 'sold' && s !== 'SOLD') return false;
      if (filter === 'attention' && !(r.intel?.recommendation && r.intel.recommendation.tone !== 'info')) return false;
      if (filter === 'nocost' && !(r.v.inStock && r.v.cost === null)) return false;
      if (needle && !`${r.v.item.title} ${r.v.item.brand} ${r.v.item.model ?? ''}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    return out.sort((a, b) => {
      const x = sortValue(a, sort.key, positions.get(a.v.item.id));
      const y = sortValue(b, sort.key, positions.get(b.v.item.id));
      // Unknown values always sink to the bottom, whatever the direction.
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [rows, filter, q, sort, focusSet, positions]);

  // Virtualisation: fixed row height, only the visible window is rendered.
  const rowH = density === 'compact' ? 42 : 58;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(800);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const overscan = 8;
  const start = Math.max(0, Math.floor(scrollTop / rowH) - overscan);
  const end = Math.min(visible.length, Math.ceil((scrollTop + viewportH) / rowH) + overscan);
  const windowRows = visible.slice(start, end);

  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: NUMERIC.has(key as ColKey) || key === 'reco' ? -1 : 1 }));
  const allSelected = visible.length > 0 && visible.every((r) => selected.has(r.v.item.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(visible.map((r) => r.v.item.id)));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const bulkAnalyze = async () => {
    setBulkBusy(true);
    let n = 0;
    try {
      // Real marketplace: 2 calls per item, so a bulk run is capped well inside the 60-call session budget.
      const ids = [...selected].slice(0, era.mode === 'demo' ? 200 : 10);
      for (const id of ids) {
        const v = era.viewById.get(id);
        if (!v || !v.inStock) continue;
        await analyzeItem(v, era.mode, era.model, era.learning, undefined, true);
        n++;
      }
      toast('success', t('bulk.done', { n }));
    } catch (e) {
      const code = errorCode(e);
      errorToast(e);
    } finally {
      setBulkBusy(false);
      setSelected(new Set());
    }
  };

  const header = (key: SortKey, label: string) => {
    const active = sort.key === key;
    return (
      <th key={key} className={NUMERIC.has(key as ColKey) ? 'is-num' : ''} aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} scope="col">
        <button type="button" onClick={() => toggleSort(key)}>
          {label}
          <Icon name={active && sort.dir === 1 ? 'arrowUp' : 'arrowDown'} size={11} style={{ opacity: active ? 1 : 0.25 }} />
        </button>
      </th>
    );
  };

  const cell = (r: Row, c: ColKey) => {
    const v = r.v;
    switch (c) {
      case 'brand':
        return <td key={c}>{v.item.brand}</td>;
      case 'size':
        return <td key={c}>{v.item.size ?? <span className="t-faint">—</span>}</td>;
      case 'cost':
        return (
          <td key={c} className="is-num" title={v.cost !== null && !v.costComplete ? t('capital.knownExShipping') : undefined}>
            <Money cents={v.cost} compact />
            {v.cost !== null && !v.costComplete && <sup className="t-warn" aria-label={t('capital.knownExShipping')}>+</sup>}
          </td>
        );
      case 'roi': {
        const p = positions.get(v.item.id);
        return <td key={c} className="is-num num">{p?.potentialRoi != null ? i18n.pct(p.potentialRoi) : <span className="t-faint">—</span>}</td>;
      }
      case 'yield': {
        const p = positions.get(v.item.id);
        return (
          <td key={c} className="is-num num">
            {p?.efficiency30 != null ? <span className={p.efficiency30 < 0.25 ? 't-warn' : p.efficiency30 >= 1 ? 't-pos' : ''}>{i18n.pct(p.efficiency30)}</span> : <span className="t-faint">—</span>}
          </td>
        );
      }
      case 'price':
        return (
          <td key={c} className="is-num">
            <Money cents={v.askPrice ?? v.sale?.salePriceCents ?? null} />
          </td>
        );
      case 'margin':
        return <td key={c} className="is-num">{v.inStock ? <Money cents={v.potentialProfit} sign compact /> : <span className="t-faint">—</span>}</td>;
      case 'views':
        return (
          <td key={c} className="is-num num">
            {v.current?.views ?? <span className="t-faint">—</span>}
          </td>
        );
      case 'favorites':
        return (
          <td key={c} className="is-num num">
            {v.current?.favorites ?? <span className="t-faint">—</span>}
          </td>
        );
      case 'age':
        return (
          <td key={c} className="is-num num" title={v.daysHeldInferred ? t('data.inferred') : undefined}>
            {v.daysHeld === null ? <span className="t-faint">—</span> : <span className={v.inStock && v.daysHeld >= 60 ? 't-warn' : ''}>{t('kpi.days', { n: v.daysHeld })}{v.daysHeldInferred ? '*' : ''}</span>}
          </td>
        );
      case 'listings':
        return (
          <td key={c} className="is-num num">
            {v.listings.length}
          </td>
        );
      case 'status':
        return (
          <td key={c}>
            <StatusBadge status={v.item.status} />
          </td>
        );
      case 'reco':
        return <td key={c}>{v.inStock ? <RecoChip r={r.intel?.recommendation ?? null} /> : null}</td>;
    }
  };

  const filters: { value: Filter; label: string }[] = [
    { value: 'all', label: t('stock.filterAll') },
    { value: 'listed', label: t('stock.filterListed') },
    { value: 'reserved', label: t('stock.filterReserved') },
    { value: 'sold', label: t('stock.filterSold') },
    { value: 'draft', label: t('stock.filterDraft') },
    ...(counts.hidden > 0 || filter === 'hidden' ? [{ value: 'hidden' as Filter, label: t('stock.filterHidden') }] : []),
    { value: 'attention', label: t('stock.filterAttention') },
    { value: 'nocost', label: t('stock.filterNoCost') },
  ];

  const inStock = rows.filter((r) => r.v.inStock).length;

  return (
    <>
      <PageHead
        title={t('stock.title')}
        sub={t('stock.subtitle', { n: inStock, listed: counts.listed, reserved: counts.reserved, sold: counts.sold })}
        tabs={<StockTabs active="stock" />}
        actions={
          <>
            <VintedImportButton />
            <Button icon="upload" onClick={() => setImportOpen(true)}>
              {t('stock.import')}
            </Button>
            <Button icon="rows" variant="ghost" onClick={() => downloadText(`era-stock-${new Date(era.now).toISOString().slice(0, 10)}.csv`, stockCsv(era.views.filter((v) => v.inStock)))}>
              {t('stock.exportCsv')}
            </Button>
            <Button icon="layers" onClick={() => go('stock?lot=1')}>
              {t('lot.button')}
            </Button>
            <Button variant="primary" icon="plus" onClick={() => go('stock?add=1')}>
              {t('stock.add')}
            </Button>
          </>
        }
      />
      {rows.length === 0 && era.ready ? (
        <Card>
          <EmptyState art={<IllustrationStock />} title={t('stock.empty')} why={t('stock.emptyWhy')} action={<VintedImportButton variant="primary" size="lg" />} />
        </Card>
      ) : (
        <>
          <PurchasesBanner />
          {focus && (
            <FocusBanner
              priority={focusPriority}
              title={
                focusPriority
                  ? prioTitle(focusPriority)
                  : /^AGE(\d+)$/.test(focus)
                    ? t('stock.focusAge', { n: Number(focus.slice(3)) })
                    : focus.startsWith('NICHE:')
                      ? t('stock.focusNiche', { label: route.query.get('label') ?? '' })
                      : t('stock.focusGone')
              }
              hint={focusPriority ? t(`today.P_${focusPriority.code}_hint`) : null}
              count={visible.length}
            />
          )}
          <div className="toolbar">
            <div style={{ width: 300, maxWidth: '100%' }}>
              <SearchInput value={q} onChange={setQ} placeholder={t('stock.search')} inputRef={searchRef} />
            </div>
            <div className="row wrap" role="group" aria-label="Filtres" style={{ gap: 6 }}>
              {filters.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  className="chip"
                  aria-pressed={!focus && filter === f.value}
                  onClick={() => {
                    if (focus) go(`stock?filter=${f.value}`);
                    setFilter(f.value);
                  }}
                >
                  {f.label}
                  <span className="chip__n num">{counts[f.value]}</span>
                </button>
              ))}
            </div>
            <span className="grow" />
            <Segmented
              label={t('stock.density')}
              value={density}
              onChange={setDensity}
              options={[
                { value: 'compact', label: <Icon name="rows" size={14} aria-label={t('stock.compact')} /> },
                { value: 'comfortable', label: <Icon name="layers" size={14} aria-label={t('stock.comfortable')} /> },
              ]}
            />
            <div style={{ position: 'relative' }}>
              <Button size="sm" icon="columns" onClick={() => setShowCols((s) => !s)} aria-expanded={showCols}>
                {t('stock.columns')}
              </Button>
              {showCols && (
                <div className="card" style={{ position: 'absolute', right: 0, top: 38, zIndex: 20, width: 220, padding: 12, boxShadow: 'var(--shadow-3)' }} role="menu">
                  {ALL_COLS.map((c) => (
                    <label key={c} className="row t-small" style={{ padding: '5px 4px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        className="checkbox"
                        checked={cols.includes(c)}
                        onChange={() => setCols((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : ALL_COLS.filter((x) => x === c || cs.includes(x))))}
                      />
                      {t(`stock.col.${c}`)}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          {visible.length === 0 ? (
            <Card>
              <EmptyState compact title={t('stock.noResults')} why={t('stock.noResultsWhy')} action={<Button onClick={() => { setFilter('all'); setQ(''); }}>{t('stock.noResultsCta')}</Button>} />
            </Card>
          ) : (
            <div className="table-wrap" ref={scrollRef} style={{ maxHeight: 'calc(100vh - 250px)', minHeight: 320 }} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
              <table className={`dt dt--${density}`} aria-rowcount={visible.length + 1}>
                <thead>
                  <tr>
                    <th className="col-check" scope="col">
                      <input type="checkbox" className="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Tout sélectionner" />
                    </th>
                    {header('title', t('stock.col.item'))}
                    {cols.map((c) => header(c, t(`stock.col.${c}`)))}
                  </tr>
                </thead>
                <tbody>
                  {start > 0 && (
                    <tr aria-hidden="true" style={{ height: start * rowH }}>
                      <td colSpan={cols.length + 2} style={{ padding: 0, border: 0 }} />
                    </tr>
                  )}
                  {windowRows.map((r, i) => {
                    const id = r.v.item.id;
                    return (
                      <tr
                        key={id}
                        aria-rowindex={start + i + 2}
                        aria-selected={selected.has(id)}
                        tabIndex={0}
                        onClick={() => go(`item/${id}`)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') go(`item/${id}`);
                          if (e.key === ' ') {
                            e.preventDefault();
                            toggle(id);
                          }
                        }}
                      >
                        <td className="col-check" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" className="checkbox" checked={selected.has(id)} onChange={() => toggle(id)} aria-label={r.v.item.title} />
                        </td>
                        <td style={{ maxWidth: 340 }}>
                          <span className="row" style={{ gap: 10 }}>
                            <Thumb photoUrl={r.v.item.photoUrl} category={r.v.item.category} alt="" size={density === 'compact' ? 'sm' : 'md'} />
                            <span className="clamp-1" style={{ fontWeight: 550 }}>
                              {r.v.item.title}
                            </span>
                          </span>
                        </td>
                        {cols.map((c) => cell(r, c))}
                      </tr>
                    );
                  })}
                  {end < visible.length && (
                    <tr aria-hidden="true" style={{ height: (visible.length - end) * rowH }}>
                      <td colSpan={cols.length + 2} style={{ padding: 0, border: 0 }} />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          {selected.size > 0 && (
            <div className="bulkbar" role="region" aria-label={t('stock.selected', { n: selected.size })}>
              <span className="t-small num">{t('stock.selected', { n: selected.size })}</span>
              <Button size="sm" variant="primary" icon="market" loading={bulkBusy} onClick={bulkAnalyze}>
                {t('stock.bulkAnalyze')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                {t('stock.bulkClear')}
              </Button>
            </div>
          )}
          <p className="t-small t-faint" style={{ marginTop: 10 }}>
            * {t('data.inferred')} — {t('stock.inferredAge')}
          </p>
        </>
      )}
      <AddItemDrawer open={addOpen} onClose={() => go('stock')} />
      <LotDrawer open={route.query.get('lot') === '1'} onClose={() => go('stock')} />
      <CostsDrawer open={route.query.get('costs') === '1'} onClose={() => go('stock')} />
      <ImportCsvModal open={importOpen} onClose={() => setImportOpen(false)} />
    </>
  );
}

function FocusBanner({ priority, title, hint, count }: { priority: TodayPriority | null; title: string; hint: string | null; count: number }) {
  const { t } = useI18n();
  const cfg = priority ? PRIO[priority.code] : { icon: 'capital' as const, tone: 'amber' as const };
  return (
    <div className="focus-banner" role="status">
      <IconTile name={cfg.icon} tone={cfg.tone} />
      <div className="grow">
        <div className="t-caption">{t('stock.focusTitle')}</div>
        <div className="focus-banner__title">{title}</div>
        {hint && <div className="t-small t-muted">{hint}</div>}
      </div>
      <span className="t-small t-muted num">{t('stock.focusCount', { n: count })}</span>
      <Button size="sm" variant="ghost" icon="x" onClick={() => go('stock')}>
        {t('stock.focusClear')}
      </Button>
    </div>
  );
}

export function StockTabs({ active }: { active: 'stock' | 'capital' | 'workshop' | 'quality' }) {
  const { t } = useI18n();
  const era = useEra();
  const n = era.workshop.toList.length;
  return (
    <nav className="subtabs" aria-label={t('stock.title')}>
      <a href="#/stock" aria-current={active === 'stock' ? 'page' : undefined}>
        <Icon name="stock" size={14} /> {t('stock.tabItems')}
      </a>
      <a href="#/workshop" aria-current={active === 'workshop' ? 'page' : undefined}>
        <Icon name="upload" size={14} /> {t('workshop.title')}
        {n > 0 && <span className="subtabs__n num">{n}</span>}
      </a>
      <a href="#/capital" aria-current={active === 'capital' ? 'page' : undefined}>
        <Icon name="capital" size={14} /> {t('capital.title')}
      </a>
      <a href="#/quality" aria-current={active === 'quality' ? 'page' : undefined}>
        <Icon name="target" size={14} /> {t('lq.tab')}
      </a>
    </nav>
  );
}
