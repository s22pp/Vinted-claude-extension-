import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import type { EraMessage, LabelBatchResult, LabelResult } from '@/data/adapters/vinted/protocol';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import type { SaleView } from '@/intelligence/portfolio';
import { shippingChecklist } from '@/intelligence/shipping';
import { Modal, useErrorToast, useToast } from '@/ui/components/overlays';
import { Badge, Button, Card, Flag, Money } from '@/ui/components/primitives';
import { VINTED_ORDERS_URL } from './priorities';
import { go, useEra } from '../state';

/**
 * Orders Vinted says wait for the seller: a checklist before closing the parcel (learned from past refunds)
 * and the printable label Vinted issues (EXPERIMENTAL): for one order, or for all of them at once — each saved as a
 * PDF in the downloads folder (ERA-bordereaux). ERA never makes a label itself: only Vinted's carries a valid parcel.
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
  const [askAll, setAskAll] = useState(false);
  const [batch, setBatch] = useState<LabelBatchResult | null>(null);
  const orders = era.sales.filter((x) => x.sale.needsAction && x.sale.status !== 'REFUNDED');
  const withLabel = era.mode === 'real' ? orders.filter((x) => x.sale.vintedConversationId) : [];
  if (!orders.length) return null;
  const { checks, learned } = shippingChecklist(era.refunds.guards.map((g) => g.guard));

  const toggle = (saleId: string, k: string) => {
    const cur = saved[saleId] ?? [];
    const on = !cur.includes(k);
    const next = { ...saved, [saleId]: on ? [...cur, k] : cur.filter((x) => x !== k) };
    setLocal(next);
    void repo.setSetting('shipChecks', next);
    // When each check was ticked: the dispute file shows it (unticking forgets the time).
    void repo.getSetting<Record<string, Record<string, number>>>('shipChecksAt', {}).then((at) => {
      const mine = { ...(at[saleId] ?? {}) };
      if (on) mine[k] = Date.now();
      else delete mine[k];
      return repo.setSetting('shipChecksAt', { ...at, [saleId]: mine });
    });
  };
  const label = async (x: SaleView) => {
    setBusy(x.sale.id);
    try {
      const r = (await browser.runtime.sendMessage({ type: 'era:label:get', conversationId: x.sale.vintedConversationId!, title: x.item.title, soldAt: x.sale.soldAt } satisfies EraMessage)) as LabelResult;
      if (!r.ok) return errorToast(r);
      toast('success', t('ship.labelDone'), `${t(r.ordered ? 'ship.labelOrdered' : 'ship.labelReady')} ${r.file ? t('ship.saved', { file: r.file }) : t('ship.notSaved', { detail: r.saveError ?? '' })}`);
      window.open(r.url, '_blank', 'noopener');
    } finally {
      setBusy(null);
    }
  };
  const allLabels = async () => {
    setBusy('all');
    try {
      const r = (await browser.runtime.sendMessage({ type: 'era:label:all' } satisfies EraMessage)) as LabelBatchResult;
      setBatch(r);
      setAskAll(false);
      const saved = r.results.filter((x) => x.ok && x.file).length;
      toast(saved === r.results.length && !r.stopped ? 'success' : 'warning', t('ship.allDone', { n: saved }), r.stopped ? t('ship.allStopped', { detail: r.stopped, n: r.left }) : undefined);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card
      id="to-ship"
      className={highlight ? 'card--highlight' : ''}
      title={t('ship.title', { n: orders.length })}
      hint={t('ship.hint')}
      icon="box"
      tone="coral"
      actions={
        withLabel.length > 1 ? (
          <Button size="sm" icon="download" loading={busy === 'all'} disabled={busy !== null} onClick={() => setAskAll(true)}>
            {t('ship.all', { n: withLabel.length })}
          </Button>
        ) : null
      }
    >
      <div className="stack-4" data-testid="to-ship">
        {batch && (
          <div className="stack" data-testid="labels-batch">
            {batch.results.map((r) => (
              <div key={r.saleId} className="row t-small" style={{ gap: 8, flexWrap: 'wrap' }}>
                <Badge tone={r.ok && r.file ? 'emerald' : r.ok ? 'amber' : 'coral'}>{t(r.ok && r.file ? 'ship.rSaved' : r.ok ? 'ship.rOpen' : 'ship.rFailed')}</Badge>
                <span style={{ fontWeight: 600 }}>{r.title}</span>
                <span className="t-muted">{r.ok ? (r.file ?? r.saveError) : (r.detail ?? r.code)}</span>
                {r.ok && (
                  <Button size="sm" variant="ghost" icon="external" onClick={() => window.open(r.url, '_blank', 'noopener')}>
                    {t('ship.openPdf')}
                  </Button>
                )}
              </div>
            ))}
            {batch.stopped && <p className="t-small t-warn">{t('ship.allStopped', { detail: batch.stopped, n: batch.left })}</p>}
            {batch.results.some((r) => r.ok && r.file) && (
              <div>
                <Button size="sm" variant="ghost" icon="external" onClick={() => void browser.downloads.showDefaultFolder()}>
                  {t('ship.openFolder')}
                </Button>
              </div>
            )}
          </div>
        )}
        {orders.map((x) => {
          const done = saved[x.sale.id] ?? [];
          return (
            <div key={x.sale.id} className="stack" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
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
                    <Button size="sm" variant="primary" icon="download" loading={busy === x.sale.id} disabled={busy !== null} onClick={() => label(x)}>
                      {t('ship.label')}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" icon="external" onClick={() => window.open(VINTED_ORDERS_URL, '_blank', 'noopener')}>
                    {t('ship.openVinted')}
                  </Button>
                  <Button size="sm" variant="ghost" icon="book" onClick={() => go(`dossier/${x.sale.id}`)}>
                    {t('dossier.open')}
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
      <Modal open={askAll} onClose={() => busy === null && setAskAll(false)} title={t('ship.allTitle', { n: withLabel.length })}>
        <ul className="t-small stack" style={{ margin: 0, paddingLeft: 18 }}>
          {withLabel.map((x) => (
            <li key={x.sale.id}>{x.item.title}</li>
          ))}
        </ul>
        <p className="t-small">{t('ship.allBody')}</p>
        <p className="t-small t-faint">{t('ship.allFolder')}</p>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={() => setAskAll(false)} disabled={busy !== null}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" icon="download" loading={busy === 'all'} onClick={allLabels}>
            {t('ship.allGo')}
          </Button>
        </div>
      </Modal>
    </Card>
  );
}
