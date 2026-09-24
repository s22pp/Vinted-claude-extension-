import { createContext, useContext } from 'react';
import { en } from './en';
import { type Dict, fr } from './fr';

export type Locale = 'fr' | 'en';
type Params = Record<string, string | number | null | undefined>;

/** Params whose values are integer cents and must be rendered as money. */
const MONEY_KEYS = new Set(['price', 'from', 'to', 'delta', 'cost', 'profit', 'amount', 'min', 'max', 'p25', 'p50', 'p75', 'realized']);

function lookup(dict: unknown, path: string): string | undefined {
  let cur: unknown = dict;
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === 'string' ? cur : undefined;
}

export function createI18n(locale: Locale) {
  const intlLocale = locale === 'fr' ? 'fr-FR' : 'en-GB';
  const nf0 = new Intl.NumberFormat(intlLocale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const nf2 = new Intl.NumberFormat(intlLocale, { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 });
  const num = new Intl.NumberFormat(intlLocale);
  const compact = new Intl.NumberFormat(intlLocale, { notation: 'compact', maximumFractionDigits: 1 });
  const dateFmt = new Intl.DateTimeFormat(intlLocale, { day: 'numeric', month: 'short' });
  const dateLong = new Intl.DateTimeFormat(intlLocale, { weekday: 'long', day: 'numeric', month: 'long' });
  const monthFmt = new Intl.DateTimeFormat(intlLocale, { month: 'short' });
  const dateYear = new Intl.DateTimeFormat(intlLocale, { day: 'numeric', month: 'short', year: 'numeric' });

  const money = (cents: number | null | undefined, opts: { sign?: boolean } = {}): string => {
    if (cents === null || cents === undefined || Number.isNaN(cents)) return '—';
    const f = cents % 100 === 0 ? nf0 : nf2;
    const s = f.format(Math.abs(cents) / 100);
    if (cents < 0) return `−${s}`;
    return opts.sign && cents > 0 ? `+${s}` : s;
  };

  const pct = (ratio: number | null | undefined, opts: { sign?: boolean; digits?: number } = {}): string => {
    if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return '—';
    const v = (ratio * 100).toFixed(opts.digits ?? 0);
    const n = Number(v);
    const body = `${Math.abs(n).toLocaleString(intlLocale)} %`;
    if (n < 0) return `−${body}`;
    return opts.sign && n > 0 ? `+${body}` : body;
  };

  const t = (key: string, params?: Params): string => {
    let s = lookup(locale === 'en' ? en : fr, key) ?? lookup(fr, key) ?? key;
    if (params) {
      if (typeof params.n === 'number' && params.n === 1) {
        const one = lookup(locale === 'en' ? en : fr, `${key}_one`) ?? lookup(fr, `${key}_one`);
        if (one) s = one;
      }
      s = s.replace(/\{(\w+)\}/g, (_, k: string) => {
        const v = params[k];
        if (v === null || v === undefined) return '—';
        if (typeof v === 'number' && MONEY_KEYS.has(k)) return money(v);
        if (typeof v === 'number') return num.format(v);
        return v;
      });
    }
    return s;
  };

  return {
    locale,
    t,
    money,
    pct,
    num: (n: number | null | undefined, digits = 0) =>
      n === null || n === undefined || !Number.isFinite(n) ? '—' : n.toLocaleString(intlLocale, { maximumFractionDigits: digits }),
    compact: (n: number) => compact.format(n),
    date: (ts: number | null | undefined) => (ts ? dateFmt.format(ts) : '—'),
    dateYear: (ts: number | null | undefined) => (ts ? dateYear.format(ts) : '—'),
    dateLong: (ts: number) => dateLong.format(ts),
    month: (ts: number) => monthFmt.format(ts).replace('.', ''),
    relative: (ts: number, now = Date.now()) => {
      const d = Math.floor((now - ts) / 86_400_000);
      return d <= 0 ? t('common.today') : t('common.daysAgo', { n: d });
    },
  };
}

export type I18n = ReturnType<typeof createI18n>;
export const I18nContext = createContext<I18n>(createI18n('fr'));
export const useI18n = () => useContext(I18nContext);
export type { Dict };
