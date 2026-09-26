import { useI18n } from '@/i18n';
import { parcelAlerts } from '@/intelligence/shipping';
import { Badge, Button, Card, Flag } from '@/ui/components/primitives';
import { go, useEra } from '../state';

/** Parcels that seem stuck, from Vinted's status words: open the conversation, keep the dispute file at hand. */
export function ParcelsCard() {
  const { t } = useI18n();
  const era = useEra();
  const alerts = parcelAlerts(
    era.sales.filter((x) => !x.sale.isDemo || era.mode === 'demo').map((x) => ({ ...x.sale })),
    era.now,
  );
  if (!alerts.length) return null;
  const byId = new Map(era.sales.map((x) => [x.sale.id, x]));
  return (
    <Card title={t('parcels.title', { n: alerts.length })} hint={t('parcels.hint')} icon="box" tone="amber" actions={<Flag kind="UNVERIFIED" title={t('parcels.unverified')} />}>
      <div className="stack-3" data-testid="parcels">
        {alerts.map((a) => {
          const x = byId.get(a.saleId)!;
          return (
            <div key={a.saleId} className="row-between" style={{ gap: 12, flexWrap: 'wrap', borderTop: '1px solid var(--line)', paddingTop: 10 }}>
              <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                <a href={`#/item/${x.item.id}`} className="clamp-1" style={{ fontWeight: 600 }}>
                  {x.item.title}
                </a>
                <span className="t-small">
                  <Badge tone={a.state === 'SHIPPED' ? 'amber' : 'cyan'}>{x.sale.vintedStatus}</Badge> {t(`parcels.${a.state}`, { n: a.days })}
                  {a.since === 'SALE' ? ` ${t('parcels.atLeast')}` : ''}
                </span>
                <span className="t-small t-faint">{t(`parcels.do.${a.state}`)}</span>
              </div>
              <div className="row" style={{ gap: 8 }}>
                {x.sale.vintedConversationId && (
                  <Button size="sm" variant="ghost" icon="external" onClick={() => window.open(`https://www.vinted.fr/inbox/${x.sale.vintedConversationId}`, '_blank', 'noopener')}>
                    {t('parcels.conversation')}
                  </Button>
                )}
                <Button size="sm" variant="ghost" icon="book" onClick={() => go(`dossier/${x.sale.id}`)}>
                  {t('dossier.open')}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
