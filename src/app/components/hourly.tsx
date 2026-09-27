import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import { TIME_DEFAULTS, TIME_KEY, type TimeCosts, hourlyReport } from '@/intelligence/hourly';
import { Badge, Card, Input, Money } from '@/ui/components/primitives';
import { useEra } from '../state';

/** What an hour of your work brings, overall and by niche; your time estimates next to it, editable. */
export function HourlyCard() {
  const { t } = useI18n();
  const era = useEra();
  const stored = useLiveQuery(() => repo.getSetting<Partial<TimeCosts> | null>(TIME_KEY, null), []);
  const [local, setLocal] = useState<TimeCosts | null>(null);
  if (stored === undefined) return null;
  const tc: TimeCosts = local ?? { ...TIME_DEFAULTS, ...stored };
  const r = hourlyReport(era.sales, era.preps, tc);
  const set = (k: keyof TimeCosts, v: string) => {
    const n = Math.max(0, Math.min(240, Math.round(Number(v) || 0)));
    const next = { ...tc, [k]: n };
    setLocal(next);
    void repo.setSetting(TIME_KEY, next);
  };
  const field = (k: keyof TimeCosts) => (
    <label className="row t-small" style={{ gap: 6 }}>
      {t(`hourly.${k}`)}
      <Input type="number" min={0} max={240} value={tc[k]} onChange={(e) => set(k, e.target.value)} style={{ width: 64 }} aria-label={t(`hourly.${k}`)} />
      min
    </label>
  );
  return (
    <Card title={t('hourly.title')} hint={t('hourly.hint')} icon="clock" tone="emerald">
      <div className="stack-3" data-testid="hourly">
        {r.perHourCents === null ? (
          <p className="t-muted">{t('hourly.none')}</p>
        ) : (
          <p>
            <span className="t-h2 num">
              <Money cents={r.perHourCents} />
            </span>{' '}
            {t('hourly.perHour')} · <span className="t-small t-muted">{t('hourly.basis', { n: r.sales, hours: Math.round(r.minutes / 6) / 10 })}</span>{' '}
            <Badge tone={r.listBasis === 'MEASURED' ? 'emerald' : 'amber'}>{t(`hourly.list.${r.listBasis}`, { n: r.measured })}</Badge>
          </p>
        )}
        {r.byNiche.length > 0 && (
          <table className="dt dt--compact">
            <thead>
              <tr>
                <th>{t('hourly.niche')}</th>
                <th className="num">{t('hourly.sales')}</th>
                <th className="num">{t('hourly.perHourCol')}</th>
              </tr>
            </thead>
            <tbody>
              {r.byNiche.slice(0, 8).map((x) => (
                <tr key={x.key}>
                  <td>
                    {x.brand} · {t(`category.${x.category}`)}
                  </td>
                  <td className="num">{x.sales}</td>
                  <td className="num">
                    <Money cents={x.perHourCents} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="row wrap" style={{ gap: 14 }}>
          {field('shipMin')}
          {field('sourceMin')}
          {field('listMin')}
        </div>
        <p className="t-small t-faint">{t('hourly.note')}</p>
      </div>
    </Card>
  );
}
