import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/i18n';
import type { CapitalPosition } from '@/intelligence/capital';
import type { ItemIntel } from '@/intelligence/decision';
import type { ItemView } from '@/intelligence/portfolio';
import { Icon } from '@/ui/components/icons';
import { Money } from '@/ui/components/primitives';
import { Thumb } from '@/ui/components/Thumb';
import { go } from '../state';
import { RecoChip, StatusBadge } from './domain';

export type ColKey = 'brand' | 'size' | 'cost' | 'price' | 'margin' | 'roi' | 'yield' | 'views' | 'favorites' | 'age' | 'listings' | 'status' | 'reco';
export type SortKey = 'title' | ColKey;
export interface Sort {
  key: SortKey;
  dir: 1 | -1;
}

export interface Row {
  v: ItemView;
  intel: ItemIntel | null;
}

export const ALL_COLS: ColKey[] = ['brand', 'size', 'cost', 'price', 'margin', 'roi', 'yield', 'views', 'favorites', 'age', 'listings', 'status', 'reco'];
export const DEFAULT_COLS: ColKey[] = ['status', 'cost', 'price', 'margin', 'views', 'favorites', 'age', 'reco'];
const STATUS_ORDER = ['RESERVED', 'LISTED', 'HIDDEN', 'DRAFT', 'SOLD', 'ARCHIVED'];
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

/** Sorts in place. Unknown values always sink to the bottom, whatever the direction. */
export function sortRows(rows: Row[], sort: Sort, positions: ReadonlyMap<string, CapitalPosition>): Row[] {
  return rows.sort((a, b) => {
    const x = sortValue(a, sort.key, positions.get(a.v.item.id));
    const y = sortValue(b, sort.key, positions.get(b.v.item.id));
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
  });
}

/** A click on a column: the same one flips the direction; another starts high-first for numbers, A→Z for text. */
export function nextSort(s: Sort, key: SortKey): Sort {
  return s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: NUMERIC.has(key as ColKey) || key === 'reco' ? -1 : 1 };
}

interface Props {
  rows: Row[];
  cols: ColKey[];
  density: 'compact' | 'comfortable';
  sort: Sort;
  onSort: (key: SortKey) => void;
  positions: ReadonlyMap<string, CapitalPosition>;
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
}

/**
 * The stock table, virtualised: fixed row height, only the rows in view (and a few around) are drawn, so a stock of
 * hundreds of articles scrolls as smoothly as ten.
 */
export function StockTable({ rows, cols, density, sort, onSort, positions, selected, onToggle, onToggleAll }: Props) {
  const i18n = useI18n();
  const { t } = i18n;
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
  const end = Math.min(rows.length, Math.ceil((scrollTop + viewportH) / rowH) + overscan);
  const windowRows = rows.slice(start, end);
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.v.item.id));

  const header = (key: SortKey, label: string) => {
    const active = sort.key === key;
    return (
      <th key={key} className={NUMERIC.has(key as ColKey) ? 'is-num' : ''} aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} scope="col">
        <button type="button" onClick={() => onSort(key)}>
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

  return (
    <div className="table-wrap" ref={scrollRef} style={{ maxHeight: 'calc(100vh - 250px)', minHeight: 320 }} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
      <table className={`dt dt--${density}`} aria-rowcount={rows.length + 1}>
        <thead>
          <tr>
            <th className="col-check" scope="col">
              <input type="checkbox" className="checkbox" checked={allSelected} onChange={onToggleAll} aria-label="Tout sélectionner" />
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
                    onToggle(id);
                  }
                }}
              >
                <td className="col-check" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" className="checkbox" checked={selected.has(id)} onChange={() => onToggle(id)} aria-label={r.v.item.title} />
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
          {end < rows.length && (
            <tr aria-hidden="true" style={{ height: (rows.length - end) * rowH }}>
              <td colSpan={cols.length + 2} style={{ padding: 0, border: 0 }} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
