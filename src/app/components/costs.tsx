import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useRef, useState } from 'react';
import { db } from '@/data/db';
import { repo } from '@/data/repo';
import { parseMoneyInput } from '@/domain/money';
import { useI18n } from '@/i18n';
import { purchaseByItem, withBuyerProtection } from '@/intelligence/purchase-match';
import { Drawer, useToast } from '@/ui/components/overlays';
import { Badge, Button, Input, Money } from '@/ui/components/primitives';
import { useEra } from '../state';

/**
 * "Coûts manquants": every article whose cost is unknown, sold ones first (their profit is unknown), then the
 * biggest asking prices. The matching Vinted purchase, when ERA finds one, is used in one click (price + buyer
 * protection, shipping still to add); otherwise type the amount, Enter, and the next one is ready.
 */
export function CostsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, date } = useI18n();
  const era = useEra();
  const toast = useToast();
  const purchases = useLiveQuery(() => db.purchases.filter((p) => !p.linkedItemId && !p.dismissed).toArray(), []) ?? [];
  const missing = useMemo(
    () =>
      era.views
        .filter((v) => !v.item.isDemo && v.cost === null && (v.inStock || v.item.status === 'SOLD'))
        .sort((a, b) => Number(b.item.status === 'SOLD') - Number(a.item.status === 'SOLD') || (b.sale?.salePriceCents ?? b.askPrice ?? 0) - (a.sale?.salePriceCents ?? a.askPrice ?? 0)),
    [era.views],
  );
  const matches = useMemo(() => purchaseByItem(purchases, missing.map((v) => v.item)), [purchases, missing]);
  const [raw, setRaw] = useState<Record<string, string>>({});
  const [done, setDone] = useState(0);
  const inputs = useRef(new Map<string, HTMLInputElement>());

  const focusNext = (id: string) => {
    const ids = missing.map((v) => v.item.id);
    const next = ids[ids.indexOf(id) + 1];
    if (next) requestAnimationFrame(() => inputs.current.get(next)?.focus());
  };
  const save = async (id: string) => {
    const cents = parseMoneyInput(raw[id] ?? '');
    if (cents === undefined || cents === null) return;
    focusNext(id);
    await repo.setPurchasePrice(id, cents);
    setDone((n) => n + 1);
  };

  return (
    <Drawer open={open} onClose={onClose} title={t('costs.title', { n: missing.length })}>
      <div className="stack-3" data-testid="costs">
        <p className="t-small t-muted">{t('costs.intro')}</p>
        {done > 0 && <Badge tone="emerald">{t('costs.saved', { n: done })}</Badge>}
        {missing.length === 0 && <p className="t-pos">{t('costs.none')}</p>}
        {missing.map((v) => {
          const m = matches.get(v.item.id);
          const id = v.item.id;
          return (
            <div key={id} className="stack" style={{ borderTop: '1px solid var(--line)', paddingTop: 10, gap: 6 }}>
              <div className="row-between" style={{ gap: 10 }}>
                <a href={`#/item/${id}`} className="clamp-1" style={{ fontWeight: 600 }}>
                  {v.item.title}
                </a>
                <span className="t-small t-muted num">
                  {v.item.status === 'SOLD' ? (
                    <>
                      {t('costs.soldFor')} <Money cents={v.sale?.salePriceCents ?? null} />
                    </>
                  ) : (
                    <Money cents={v.askPrice} />
                  )}
                </span>
              </div>
              {m && (
                <div className="row t-small" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <Badge tone={m.sure ? 'emerald' : 'amber'}>{t(m.sure ? 'costs.matchSure' : 'costs.matchMaybe')}</Badge>
                  <span className="grow">
                    « {m.purchase.title} » · <Money cents={m.purchase.priceCents} />
                    {m.purchase.date !== null ? ` · ${date(m.purchase.date)}` : ''} → <Money cents={withBuyerProtection(m.purchase.priceCents)} /> {t('costs.withProtection')}
                  </span>
                  <Button
                    size="sm"
                    variant="primary"
                    icon="check"
                    onClick={async () => {
                      await repo.linkPurchase(m.purchase.id, id);
                      setDone((n) => n + 1);
                      toast('success', t('costs.linked'), t('costs.linkedHint'));
                    }}
                  >
                    {t('costs.use')}
                  </Button>
                </div>
              )}
              <form
                className="row"
                style={{ gap: 8 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  void save(id);
                }}
              >
                <Input
                  ref={(el) => {
                    if (el) inputs.current.set(id, el);
                  }}
                  money
                  aria-label={t('costs.input', { title: v.item.title })}
                  placeholder={t('costs.placeholder')}
                  value={raw[id] ?? ''}
                  onChange={(e) => setRaw((r) => ({ ...r, [id]: e.target.value }))}
                  style={{ width: 120 }}
                />
                <Button size="sm" type="submit" disabled={!raw[id]?.trim() || parseMoneyInput(raw[id] ?? '') == null}>
                  {t('costs.save')}
                </Button>
              </form>
            </div>
          );
        })}
      </div>
    </Drawer>
  );
}
