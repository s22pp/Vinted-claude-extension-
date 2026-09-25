import { useState } from 'react';
import type { InventoryItem } from '@/domain/entities';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import { useToast } from '@/ui/components/overlays';
import { Button, Field, Input, Money, QualityTag } from '@/ui/components/primitives';
import { useMoneyField } from './forms';

/** Buyer protection on a Vinted purchase (buyer side, published fee): 0,70 € + 5 % of the item price. */
export const protectionOf = (itemCents: number) => 70 + Math.round(itemCents * 0.05);

/**
 * PRIX ARTICLE / PROTECTION ACHETEUR / PORT / TOTAL PAYÉ.
 * Unknown shipping is never 0: the total then reads "Total connu hors port".
 */
export function CostLines({ itemCents, protectionCents, shippingCents }: { itemCents: number; protectionCents: number | null; shippingCents: number | null }) {
  const { t } = useI18n();
  const known = itemCents + (protectionCents ?? 0) + (shippingCents ?? 0);
  const complete = protectionCents !== null && shippingCents !== null;
  return (
    <dl className="costlines">
      <dt>{t('cost.item')}</dt>
      <dd>
        <Money cents={itemCents} />
      </dd>
      <dt>
        {t('cost.protection')} <QualityTag quality="INFERRED" text={t('cost.protectionRule')} />
      </dt>
      <dd>
        <Money cents={protectionCents} />
      </dd>
      <dt>{t('cost.shipping')}</dt>
      <dd>{shippingCents === null ? <span className="costlines__unknown">{t('cost.shippingUnknown')}</span> : <Money cents={shippingCents} />}</dd>
      <dt className="costlines__total">{complete ? t('cost.totalPaid') : t('cost.totalExShipping')}</dt>
      <dd className="costlines__total">
        <Money cents={known} />
      </dd>
    </dl>
  );
}

export function CostBreakdown({ item, onEdit }: { item: InventoryItem; onEdit: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const d = item.costDetail;
  const ship = useMoneyField(d?.shippingCents ?? null);
  const [editShip, setEditShip] = useState(false);
  if (!d) {
    return (
      <div className="stack-3">
        <dl className="costlines">
          <dt className="costlines__total">{t('cost.total')}</dt>
          <dd className="costlines__total">
            <Money cents={item.purchasePriceCents} unknownLabel={t('data.notProvided')} />
          </dd>
        </dl>
        <p className="t-small t-faint">{item.purchasePriceCents === null ? t('cost.noneHint') : t('cost.totalOnlyHint')}</p>
        <Button size="sm" icon="edit" onClick={onEdit}>
          {item.purchasePriceCents === null ? t('cost.add') : t('item.editCost')}
        </Button>
      </div>
    );
  }
  return (
    <div className="stack-3">
      <CostLines itemCents={d.itemCents} protectionCents={d.protectionCents} shippingCents={d.shippingCents} />
      {editShip || d.shippingCents === null ? (
        <form
          className="row"
          style={{ alignItems: 'flex-end' }}
          onSubmit={async (e) => {
            e.preventDefault();
            if (ship.invalid) return;
            await repo.setShipping(item.id, ship.cents);
            setEditShip(false);
            toast('success', t('common.saved'));
          }}
        >
          <Field label={t('cost.shippingPaid')} htmlFor={`ship-${item.id}`} optional>
            <Input id={`ship-${item.id}`} money value={ship.raw} onChange={(e) => ship.setRaw(e.target.value)} placeholder="—" style={{ width: 110 }} />
          </Field>
          <Button type="submit" size="sm" variant="primary" disabled={ship.cents === null || ship.invalid}>
            {t('common.save')}
          </Button>
        </form>
      ) : (
        <Button size="sm" variant="ghost" icon="edit" onClick={() => setEditShip(true)}>
          {t('cost.editShipping')}
        </Button>
      )}
    </div>
  );
}

/** Manual Vinted purchase: item price → protection derived, shipping optional (unknown ≠ 0). */
export function VintedCostForm({ itemId, onDone }: { itemId: string; onDone?: () => void }) {
  const { t, money } = useI18n();
  const toast = useToast();
  const price = useMoneyField(null);
  const ship = useMoneyField(null);
  const valid = price.cents !== null && !price.invalid && !ship.invalid;
  return (
    <form
      className="stack-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid) return;
        await repo.setCostBreakdown(itemId, price.cents!, ship.cents);
        toast('success', t('common.saved'));
        onDone?.();
      }}
    >
      <div className="row wrap" style={{ alignItems: 'flex-end', gap: 12 }}>
        <Field label={t('cost.item')} htmlFor={`vc-${itemId}`}>
          <Input id={`vc-${itemId}`} money value={price.raw} onChange={(e) => price.setRaw(e.target.value)} placeholder="18" style={{ width: 110 }} />
        </Field>
        <Field label={t('cost.shipping')} htmlFor={`vs-${itemId}`} optional>
          <Input id={`vs-${itemId}`} money value={ship.raw} onChange={(e) => ship.setRaw(e.target.value)} placeholder="—" style={{ width: 110 }} />
        </Field>
        <Button type="submit" variant="primary" disabled={!valid}>
          {t('item.saveCost')}
        </Button>
      </div>
      {price.cents !== null && !price.invalid && (
        <p className="t-small t-muted">
          {t('cost.preview', { p: money(protectionOf(price.cents)), total: money(price.cents + protectionOf(price.cents) + (ship.cents ?? 0)) })}
          {ship.cents === null ? ` · ${t('cost.totalExShipping')}` : ''}
        </p>
      )}
    </form>
  );
}
