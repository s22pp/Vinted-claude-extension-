import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import type { SellerIdentity } from '@/data/db';
import { repo } from '@/data/repo';
import { addMonths, startOfMonth } from '@/domain/time';
import { useI18n } from '@/i18n';
import type { MonthlyGoal } from '@/intelligence/goal';
import { type PeriodStats, monthReport } from '@/intelligence/review';
import { Button } from '@/ui/components/primitives';
import { go, useEra } from '../state';

/** "2026-09" → the first day of that month (local time); anything else → this month. */
function monthFrom(id: string | null, now: number): number {
  const m = /^(\d{4})-(\d{2})$/.exec(id ?? '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, 1).getTime() : startOfMonth(now);
}
const monthId = (ts: number) => `${new Date(ts).getFullYear()}-${String(new Date(ts).getMonth() + 1).padStart(2, '0')}`;

/**
 * Rapport du mois: one printable page (print, or save as PDF from the print dialog) — the month's figures against
 * the month before, the goal, the best sales, the refunds and their reasons, and the stock when the month is the
 * current one. Only the seller's own rows; a demo is written as such on the page.
 */
export function Report({ id }: { id: string | null }) {
  const { t, money, pct } = useI18n();
  const era = useEra();
  const start = monthFrom(id, era.now);
  const r = useMemo(() => monthReport(era.sales, era.views, start, era.now), [era.sales, era.views, start, era.now]);
  const identity = useLiveQuery(() => repo.getSetting<SellerIdentity | null>('sellerIdentity', null), []);
  const goal = useLiveQuery(() => repo.getSetting<MonthlyGoal | null>('monthlyGoal', null), []);
  if (identity === undefined || goal === undefined) return null;

  const long = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
  const day = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const next = addMonths(start, 1);
  const { month: m, previous: p } = r;
  const goalValue = goal ? (goal.kind === 'REVENUE' ? m.revenueCents : m.profitCents) : 0;
  const stock = era.views.filter((v) => v.inStock);
  const old = stock.filter((v) => (v.daysHeld ?? 0) >= 60).length;

  const lines: { label: string; now: string; before: string; diff: string }[] = [
    line(t('review.row.sales'), m.sales, p.sales, String),
    line(t('review.row.revenue'), m.revenueCents, p.revenueCents, (c) => money(c)),
    line(t('review.row.profit'), m.profitCents, p.profitCents, (c) => money(c), m.profitPartial, p.profitPartial),
    { label: t('review.row.basket'), now: m.basketCents === null ? '—' : money(m.basketCents), before: p.basketCents === null ? '—' : money(p.basketCents), diff: '' },
    { label: t('review.row.refunds'), now: refunds(m), before: refunds(p), diff: signed(m.refunds - p.refunds, String) },
    line(t('review.row.listed'), m.listed, p.listed, String),
    { label: t('review.row.bought'), now: `${m.bought} · ${money(m.spentCents)}${m.spentPartial ? ' ◐' : ''}`, before: `${p.bought} · ${money(p.spentCents)}${p.spentPartial ? ' ◐' : ''}`, diff: signed(m.bought - p.bought, String) },
    { label: t('review.row.speed'), now: m.daysToSell === null ? '—' : t('kpi.days', { n: m.daysToSell }), before: p.daysToSell === null ? '—' : t('kpi.days', { n: p.daysToSell }), diff: '' },
  ];

  function refunds(x: PeriodStats) {
    return x.refunds ? `${x.refunds} (${pct(x.refundRate ?? 0)})` : '0';
  }

  return (
    <div className="invoice-shell">
      <div className="invoice-bar no-print">
        <Button variant="ghost" icon="chevronLeft" onClick={() => go('insights')}>
          {t('report.back')}
        </Button>
        <span className="grow" />
        <Button variant="ghost" onClick={() => go(`report/${monthId(addMonths(start, -1))}`)}>
          ← {t('report.prev')}
        </Button>
        {r.running ? null : (
          <Button variant="ghost" onClick={() => go(`report/${monthId(next)}`)}>
            {t('report.next')} →
          </Button>
        )}
        <Button variant="primary" icon="download" onClick={() => window.print()}>
          {t('report.print')}
        </Button>
      </div>
      <article className="invoice" data-testid="report" aria-label={t('report.title', { month: long.format(start) })}>
        <header className="invoice__head">
          <div>
            <div className="invoice__title">{t('report.title', { month: long.format(start) })}</div>
            <div className="invoice__small">{identity?.name || t('report.seller')}</div>
            {era.mode === 'demo' && <div className="invoice__small" style={{ color: '#b91c1c', fontWeight: 700 }}>{t('report.demo')}</div>}
          </div>
          <div className="invoice__meta">
            <div>{r.running ? t('report.running', { date: day.format(era.now) }) : t('report.closed')}</div>
            <div className="invoice__small">{t('report.made', { date: day.format(era.now) })}</div>
          </div>
        </header>

        <section className="dossier__section">
          <h2 className="dossier__h">{t('report.figures')}</h2>
          <table className="report__table">
            <thead>
              <tr>
                <th scope="col" />
                <th scope="col">{long.format(start)}</th>
                <th scope="col">{long.format(addMonths(start, -1))}</th>
                <th scope="col">{t('report.diff')}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.label}>
                  <th scope="row">{l.label}</th>
                  <td>{l.now}</td>
                  <td>{l.before}</td>
                  <td>{l.diff}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {r.running && <p className="invoice__small">{t('report.runningNote')}</p>}
        </section>

        {goal && (
          <section className="dossier__section">
            <h2 className="dossier__h">{t('report.goal')}</h2>
            <div className="dossier__row">
              <span className="invoice__label">{t(`goal.kind.${goal.kind}`)}</span>
              <span>
                {t('report.goalLine', { done: money(goalValue), goal: money(goal.cents), pct: pct(goal.cents > 0 ? goalValue / goal.cents : 0) })}
                {goal.kind === 'PROFIT' && m.profitPartial ? ' ◐' : ''}
              </span>
            </div>
          </section>
        )}

        <section className="dossier__section">
          <h2 className="dossier__h">{t('report.top')}</h2>
          {r.top.length ? (
            <table className="report__table">
              <thead>
                <tr>
                  <th scope="col">{t('report.article')}</th>
                  <th scope="col">{t('report.date')}</th>
                  <th scope="col">{t('report.price')}</th>
                  <th scope="col">{t('report.profit')}</th>
                </tr>
              </thead>
              <tbody>
                {r.top.map((s) => (
                  <tr key={s.sale.id}>
                    <th scope="row">{s.item.title}</th>
                    <td>{day.format(s.sale.soldAt)}</td>
                    <td>{money(s.sale.salePriceCents)}</td>
                    <td>{s.profit === null ? t('report.costUnknown') : money(s.profit, { sign: true })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>{t('report.noSale')}</p>
          )}
        </section>

        <section className="dossier__section">
          <h2 className="dossier__h">{t('report.refunds')}</h2>
          {r.refunds.length ? (
            <ul className="dossier__events">
              {r.refunds.map((s) => (
                <li key={s.sale.id}>
                  {day.format(s.sale.soldAt)} · {s.item.title} · {money(s.sale.salePriceCents)} · {s.sale.refundReason ? t(`refunds.r.${s.sale.refundReason}`) : t('report.noReason')}
                </li>
              ))}
            </ul>
          ) : (
            <p>{t('report.noRefund')}</p>
          )}
        </section>

        {r.running && (
          <section className="dossier__section">
            <h2 className="dossier__h">{t('report.stock')}</h2>
            <div className="dossier__row">
              <span className="invoice__label">{t('review.inStock')}</span>
              <span>{t('report.stockLine', { n: stock.length, online: stock.filter((v) => v.current && (v.item.status === 'LISTED' || v.item.status === 'RESERVED')).length, old })}</span>
            </div>
            <div className="dossier__row">
              <span className="invoice__label">{t('review.capital')}</span>
              <span>
                {money(stock.reduce((a, v) => a + (v.cost ?? 0), 0))}
                {stock.some((v) => v.cost === null) ? ` ${t('review.capitalUnknown', { n: stock.filter((v) => v.cost === null).length })}` : ''}
              </span>
            </div>
          </section>
        )}

        <footer className="dossier__section invoice__small">{t('report.foot')}</footer>
      </article>
    </div>
  );
}

function signed(d: number, f: (n: number) => string): string {
  return d === 0 ? '=' : `${d > 0 ? '+' : '−'}${f(Math.abs(d))}`;
}

function line(label: string, now: number, before: number, f: (n: number) => string, partialNow = false, partialBefore = false) {
  return { label, now: `${f(now)}${partialNow ? ' ◐' : ''}`, before: `${f(before)}${partialBefore ? ' ◐' : ''}`, diff: partialNow || partialBefore ? '' : signed(now - before, f) };
}
