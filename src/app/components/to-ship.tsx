import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import type { EraMessage, LabelResult } from '@/data/adapters/vinted/protocol';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import type { SaleView } from '@/intelligence/portfolio';
import { shippingChecklist } from '@/intelligence/shipping';
import { useErrorToast, useToast } from '@/ui/components/overlays';
import { Badge, Button, Card, Flag, Money } from '@/ui/components/primitives';
import { VINTED_ORDERS_URL } from './priorities';
import { useEra } from '../state';

/**
 * Orders Vinted says wait for the seller: a checklist before closing the parcel (learned from past refunds)
 * and the printable label in one click (EXPERIMENTAL), one order at a time.
 */
export function ToShipCard({ highlight }: { highlight: boolean }) {
  const { t, date } = useI18n();
  const era = useEra();
  const toast = useToast();
  const errorToast = useErrorToast();
  const stored = useLiveQuery(() => repo.getSetting<Record<string, string[]>>('shipChecks', {}), []);
  // Ticks show at once; the stored copy follows.
  const [local, setLocal] = useState<Record<string, string[]> | null>(null);
  const saved = local ?? stored ?? {};
  const [busy, setBusy] = useState<string | null>(null);
  const orders = era.sales.filter((x) => x.sale.needsAction && x.sale.status !== 'REFUNDED');
  if (!orders.length) return null;
  const { checks, learned } = shippingChecklist(era.refunds.guards.map((g) => g.guard));

  const toggle = (saleId: string, k: string) => {
    const cur = saved[saleId] ?? [];
    const next = { ...saved, [saleId]: cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k] };
    setLocal(next);
    void repo.setSetting('shipChecks', next);
  };
  const label = async (x: SaleView) => {
    setBusy(x.sale.id);
    try {
      const r = (await browser.runtime.sendMessage({ type: 'era:label:get', conversationId: x.sale.vintedConversationId!, title: x.item.title } satisfies EraMessage)) as LabelResult;
      if (!r.ok) return errorToast(r);
      toast('success', t('ship.labelDone'), t(r.ordered ? 'ship.labelOrdered' : 'ship.labelReady'));
      window.open(r.url, '_blank', 'noopener');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card id="to-ship" className={highlight ? 'card--highlight' : ''} title={t('ship.title', { n: orders.length })} hint={t('ship.hint')} icon="box" tone="coral">
      <div className="stack-4" data-testid="to-ship">
        {orders.map((x) => {
          const done = saved[x.sale.id] ?? [];
          return (
            <div key={x.sale.id} className="stack" style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
              <div className="row-between" style={{ gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{x.item.title}</div>
                  <div className="t-small t-muted">
                    <Money cents={x.sale.salePriceCents} /> · {date(x.sale.soldAt)}
                    {x.sale.vintedStatus ? ` · ${x.sale.vintedStatus}` : ''}
                  </div>
                </div>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  {era.mode === 'real' && x.sale.vintedConversationId && (
                    <Button size="sm" variant="primary" icon="upload" loading={busy === x.sale.id} disabled={busy !== null} onClick={() => label(x)}>
                      {t('ship.label')}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" icon="external" onClick={() => window.open(VINTED_ORDERS_URL, '_blank', 'noopener')}>
                    {t('ship.openVinted')}
                  </Button>
                </div>
              </div>
              <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
                {checks.map((k) => (
                  <label key={k} className="row t-small" style={{ gap: 6, cursor: 'pointer' }}>
                    <input type="checkbox" className="checkbox" checked={done.includes(k)} onChange={() => toggle(x.sale.id, k)} />
                    {t(`ship.c.${k}`)}
                    {learned.includes(k) && <Badge tone="amber">{t('ship.learned')}</Badge>}
                  </label>
                ))}
              </div>
            </div>
          );
        })}
        <p className="t-small t-faint row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Flag kind="EXPERIMENTAL" /> {t('ship.note')}
        </p>
      </div>
    </Card>
  );
}
