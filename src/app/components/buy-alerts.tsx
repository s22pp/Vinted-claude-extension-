import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import type { EraMessage } from '@/data/adapters/vinted/protocol';
import { ALERT_NICHES, type AlertDeal, BUY_ALERTS_KEY, BUY_LAST_KEY } from '@/data/buy-alerts';
import { REFRESH_KEY, type RefreshConfig } from '@/data/refresh';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import { useToast } from '@/ui/components/overlays';
import { Button, Card, Money } from '@/ui/components/primitives';
import { go, useEra } from '../state';

/** Buy alerts: switch, "check now", and the last listings found under your max. */
export function BuyAlertsCard() {
  const { t, relative } = useI18n();
  const era = useEra();
  const toast = useToast();
  const cfg = useLiveQuery(() => repo.getSetting<{ enabled?: boolean } | null>(BUY_ALERTS_KEY, null), []);
  const refresh = useLiveQuery(() => repo.getSetting<Partial<RefreshConfig> | null>(REFRESH_KEY, null), []);
  const last = useLiveQuery(() => repo.getSetting<{ at: number; deals: AlertDeal[] } | null>(BUY_LAST_KEY, null), []);
  const [local, setLocal] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  if (cfg === undefined || era.mode !== 'real') return null;
  const on = local ?? !!cfg?.enabled;
  const check = async () => {
    setBusy(true);
    try {
      const r = (await browser.runtime.sendMessage({ type: 'era:alerts:run' } satisfies EraMessage)) as { deals: AlertDeal[]; stopped: string | null };
      toast(r.stopped ? 'warning' : 'success', t('alerts.checked', { n: r.deals.length }), r.stopped ?? undefined);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title={t('alerts.title')} hint={t('alerts.hint', { n: ALERT_NICHES })} icon="heart" tone="pink">
      <div className="stack-3" data-testid="buy-alerts">
        <label htmlFor="al-on" className="row" style={{ gap: 10, cursor: 'pointer' }}>
          <input
            id="al-on"
            type="checkbox"
            className="checkbox"
            checked={on}
            onChange={(e) => {
              setLocal(e.target.checked);
              void repo.setSetting(BUY_ALERTS_KEY, { enabled: e.target.checked });
            }}
          />
          <span style={{ fontWeight: 600 }}>{t('alerts.enable')}</span>
        </label>
        {on && !refresh?.enabled && (
          <p className="t-small t-warn">
            {t('alerts.needRefresh')}{' '}
            <button type="button" className="linklike" onClick={() => go('settings')}>
              {t('nav.settings')} →
            </button>
          </p>
        )}
        <div>
          <Button size="sm" icon="search" loading={busy} onClick={check}>
            {t('alerts.checkNow')}
          </Button>
        </div>
        {last && last.deals.length > 0 && (
          <div className="stack" style={{ gap: 6 }}>
            <span className="t-caption">{t('alerts.last', { when: relative(last.at, era.now) })}</span>
            {last.deals.map((d) => (
              <div key={d.id} className="row-between t-small" style={{ gap: 10, borderTop: '1px solid var(--border)', paddingTop: 6 }}>
                <a href={d.url} target="_blank" rel="noopener noreferrer" className="clamp-1">
                  {d.title}
                </a>
                <span className="num" style={{ whiteSpace: 'nowrap' }}>
                  <Money cents={d.priceCents} /> → {t('alerts.margin')} <Money cents={d.marginCents} />
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
