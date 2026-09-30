import { useMemo } from 'react';
import { useI18n } from '@/i18n';
import { salesRecords } from '@/intelligence/records';
import { Badge, Card } from '@/ui/components/primitives';
import { useEra } from '../state';

/** Records and steps crossed, from the sales ERA holds (refunds excluded). Facts only: what ERA cannot tell is absent. */
export function RecordsCard() {
  const { t, money, dateYear, locale } = useI18n();
  const era = useEra();
  const r = useMemo(() => salesRecords(era.sales, era.now), [era.sales, era.now]);
  if (r.count === 0) return null;
  const monthYear = (ts: number) => new Date(ts).toLocaleDateString(locale === 'en' ? 'en-GB' : 'fr-FR', { month: 'long', year: 'numeric' });
  const when = (at: number | null) => (at === null ? t('records.noDate') : dateYear(at));
  const step = (kind: 'COUNT' | 'REVENUE', value: number) => (kind === 'COUNT' ? t('records.countStep', { n: value }) : t('records.revenueStep', { amount: money(value) }));
  const rows = [
    r.bestSale && { k: 'bestSale', value: money(r.bestSale.cents), sub: `${r.bestSale.title} · ${when(r.bestSale.at)}` },
    r.bestProfit && { k: 'bestProfit', value: money(r.bestProfit.cents), sub: `${r.bestProfit.title} · ${when(r.bestProfit.at)}` },
    r.bestMonth && { k: 'bestMonth', value: money(r.bestMonth.revenue), sub: t('records.monthSub', { month: monthYear(r.bestMonth.start), n: r.bestMonth.count }) },
    r.fastest && { k: 'fastest', value: t('records.days', { n: r.fastest.days }), sub: `${r.fastest.title} · ${when(r.fastest.at)}` },
    r.streak.longest > 0 && { k: 'streak', value: t('records.months', { n: r.streak.longest }), sub: r.streak.current > 0 ? t('records.streakNow', { n: r.streak.current }) : t('records.streakOver') },
  ].filter((x): x is { k: string; value: string; sub: string } => !!x);
  return (
    <Card title={t('records.title')} hint={t('records.hint')} icon="trendUp" tone="emerald">
      <div className="stack-3" data-testid="records">
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
          {rows.map((x) => (
            <div key={x.k} className="stack" style={{ gap: 2, minWidth: 0 }}>
              <span className="t-caption">{t(`records.k.${x.k}`)}</span>
              <b className="num" style={{ fontSize: 18 }}>
                {x.value}
              </b>
              <span className="t-small t-muted" style={{ overflowWrap: 'anywhere' }}>
                {x.sub}
              </span>
            </div>
          ))}
        </div>
        {r.reached.length > 0 && (
          <div className="row wrap" style={{ gap: 6 }} aria-label={t('records.reached')}>
            {[...r.reached].reverse().map((m) => (
              <Badge key={`${m.kind}-${m.value}`} tone={m.kind === 'COUNT' ? 'violet' : 'emerald'} title={when(m.at)}>
                {step(m.kind, m.value)} · {when(m.at)}
              </Badge>
            ))}
          </div>
        )}
        <p className="t-small t-muted">
          {[
            r.next.count && t('records.nextCount', { n: r.next.count.value, left: r.next.count.left }),
            r.next.revenue && t('records.nextRevenue', { amount: money(r.next.revenue.value), left: money(r.next.revenue.left) }),
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {r.undated > 0 && <p className="t-small t-faint">{t('records.undated', { n: r.undated })}</p>}
      </div>
    </Card>
  );
}
