import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { db } from '@/data/db';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import { suggestMatches, withBuyerProtection } from '@/intelligence/purchase-match';
import { IconTile } from '@/ui/components/icons';
import { Drawer, useToast } from '@/ui/components/overlays';
import { Badge, Button, Select } from '@/ui/components/primitives';
import { useEra } from '../state';

function usePending() {
  return useLiveQuery(() => db.purchases.filter((p) => !p.linkedItemId && !p.dismissed).reverse().sortBy('date'), []) ?? [];
}

export function PurchasesBanner() {
  const { t } = useI18n();
  const pending = usePending();
  const [open, setOpen] = useState(false);
  if (pending.length === 0) return null;
  return (
    <>
      <div className="card row wrap" style={{ marginBottom: 12, padding: '12px 16px', gap: 12 }}>
        <IconTile name="tag" tone="violet" />
        <div className="grow">
          <div className="t-h3">{t('purchases.banner', { n: pending.length })}</div>
          <div className="t-small t-muted">{t('purchases.bannerHint')}</div>
        </div>
        <Button variant="primary" icon="check" onClick={() => setOpen(true)}>
          {t('purchases.open')}
        </Button>
      </div>
      <PurchasesDrawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function PurchasesDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, money, date } = useI18n();
  const era = useEra();
  const toast = useToast();
  const pending = usePending();
  const [protection, setProtection] = useState(true);
  const [choice, setChoice] = useState<Record<string, string>>({});
  // Candidates: items still owned or sold, preferring those whose cost is unknown.
  const items = useMemo(() => era.views.map((v) => v.item).filter((i) => !i.isDemo), [era.views]);
  const suggestions = useMemo(
    () => new Map(pending.map((p) => [p.id, suggestMatches(p, items.filter((i) => i.purchasePriceCents === null).length ? items.filter((i) => i.purchasePriceCents === null) : items)])),
    [pending, items],
  );
  const sure = pending.filter((p) => suggestions.get(p.id)?.sure);
  const link = async (purchaseId: string, itemId: string) => {
    await repo.linkPurchase(purchaseId, itemId, protection);
  };
  return (
    <Drawer open={open} onClose={onClose} title={t('purchases.title')}>
      <div className="stack-3">
        <p className="t-small t-muted">{t('purchases.intro')}</p>
        <label className="row t-small" style={{ cursor: 'pointer' }}>
          <input type="checkbox" className="checkbox" checked={protection} onChange={(e) => setProtection(e.target.checked)} />
          {t('purchases.protection')}
        </label>
        {sure.length > 0 && (
          <Button
            variant="primary"
            icon="check"
            onClick={async () => {
              for (const p of sure) await link(p.id, suggestions.get(p.id)!.best!.itemId);
              toast('success', t('purchases.linkedN', { n: sure.length }));
            }}
          >
            {t('purchases.acceptSure', { n: sure.length })}
          </Button>
        )}
        <div className="list">
          {pending.map((p) => {
            const s = suggestions.get(p.id);
            const selected = choice[p.id] ?? s?.best?.itemId ?? '';
            const options = [s?.best, ...(s?.others ?? [])].filter(Boolean).map((m) => items.find((i) => i.id === m!.itemId)!).filter(Boolean);
            const rest = items.filter((i) => !options.includes(i));
            return (
              <div key={p.id} className="stack" style={{ padding: '12px 0', borderTop: '1px solid var(--border)' }}>
                <div className="row-between">
                  <span style={{ fontWeight: 600 }} className="clamp-1">
                    {p.title}
                  </span>
                  <span className="num" style={{ fontWeight: 600 }}>
                    {money(p.priceCents)}
                  </span>
                </div>
                <div className="t-small t-faint">
                  {date(p.date)} · {t('purchases.cost', { price: protection ? withBuyerProtection(p.priceCents) : p.priceCents })}
                  {s?.sure && (
                    <>
                      {' '}
                      · <Badge tone="emerald">{t('purchases.sure')}</Badge>
                    </>
                  )}
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <Select
                    aria-label={t('purchases.itemFor', { title: p.title })}
                    value={selected}
                    onChange={(e) => setChoice((c) => ({ ...c, [p.id]: e.target.value }))}
                    options={[
                      { value: '', label: t('purchases.pick') },
                      ...options.map((i) => ({ value: i.id, label: `★ ${i.title}` })),
                      ...rest.map((i) => ({ value: i.id, label: i.title })),
                    ]}
                  />
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={!selected}
                    onClick={async () => {
                      await link(p.id, selected);
                      toast('success', t('purchases.linked'), p.title);
                    }}
                  >
                    {t('purchases.link')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => repo.dismissPurchase(p.id)}>
                    {t('purchases.dismiss')}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Drawer>
  );
}
