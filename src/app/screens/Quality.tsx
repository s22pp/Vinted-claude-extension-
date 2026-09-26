import { useMemo, useState } from 'react';
import type { DetailsResult, EraMessage } from '@/data/adapters/vinted/protocol';
import { useI18n } from '@/i18n';
import { qualityReport } from '@/intelligence/listing-quality';
import { useToast } from '@/ui/components/overlays';
import { Badge, Button, Card, EmptyState, Money } from '@/ui/components/primitives';
import { PageHead } from '../Shell';
import { useEra } from '../state';
import { StockTabs } from './Stock';

/** Live listings ranked by what holds them back × the money waiting on them. Fixes are made on Vinted. */
export function Quality() {
  const { t } = useI18n();
  const era = useEra();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const report = useMemo(() => qualityReport(era.intel), [era.intel]);
  const unreadIds = useMemo(
    () =>
      era.intel
        .filter((x) => x.view.inStock && x.view.current && x.view.current.description == null && /^\d+$/.test(x.view.current.platformListingId ?? ''))
        .sort((a, b) => (b.view.current!.priceCents ?? 0) - (a.view.current!.priceCents ?? 0))
        .map((x) => x.view.current!.platformListingId!)
        .slice(0, 10),
    [era.intel],
  );

  const readDetails = async () => {
    setBusy(true);
    try {
      const r = (await browser.runtime.sendMessage({ type: 'era:details:read', ids: unreadIds } satisfies EraMessage)) as DetailsResult;
      toast(r.stopped ? 'warning' : 'success', t('lq.readDone', { n: r.read }), r.stopped ?? undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead title={t('lq.title')} sub={t('lq.sub', { n: report.checked })} tabs={<StockTabs active="quality" />} />
      <div className="stack-4">
        {era.mode === 'real' && report.unreadDesc > 0 && (
          <Card>
            <div className="row wrap" style={{ gap: 12 }}>
              <p className="t-small grow">{t('lq.unread', { n: report.unreadDesc })}</p>
              <Button icon="eye" loading={busy} onClick={readDetails} disabled={!unreadIds.length}>
                {t('lq.read', { n: unreadIds.length })}
              </Button>
            </div>
          </Card>
        )}
        {report.rows.length === 0 ? (
          <Card>
            <EmptyState title={t('lq.none')} why={t('lq.noneWhy')} />
          </Card>
        ) : (
          <Card flush>
            <div className="table-wrap" style={{ border: 0 }}>
              <table className="dt" data-testid="quality">
                <thead>
                  <tr>
                    <th>{t('lq.colListing')}</th>
                    <th>{t('lq.colIssues')}</th>
                    <th className="num">{t('lq.colPrice')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((q) => (
                    <tr key={q.itemId}>
                      <td style={{ maxWidth: 280 }}>
                        <a href={`#/item/${q.itemId}`} className="clamp-1" style={{ fontWeight: 600 }}>
                          {q.title}
                        </a>
                        {q.unread.length > 0 && <div className="t-small t-faint">{t('lq.notRead', { what: q.unread.map((u) => t(`lq.u.${u}`)).join(', ') })}</div>}
                      </td>
                      <td>
                        <div className="stack" style={{ gap: 4 }}>
                          {q.issues.map((i) => (
                            <span key={i.code} className="t-small">
                              <Badge tone={['FEW_PHOTOS', 'PRICE_HIGH'].includes(i.code) ? 'coral' : 'amber'}>{t(`lq.i.${i.code}`)}</Badge> {t(`lq.fix.${i.code}`, i.params)}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="num">
                        <Money cents={q.priceCents} />
                      </td>
                      <td>
                        {q.platformListingId && /^\d+$/.test(q.platformListingId) && (
                          <Button size="sm" variant="ghost" icon="external" onClick={() => window.open(`https://www.vinted.fr/items/${q.platformListingId}/edit`, '_blank', 'noopener')}>
                            {t('lq.edit')}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
        <p className="t-small t-faint">{t('lq.rules')}</p>
      </div>
    </>
  );
}
