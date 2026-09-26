import { useState } from 'react';
import type { Condition } from '@/domain/entities';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import type { ItemView } from '@/intelligence/portfolio';
import { Modal, useToast } from '@/ui/components/overlays';
import { Button, Field, Input } from '@/ui/components/primitives';
import { go } from '../state';
import { ConditionSelect, useMoneyField } from './forms';

/**
 * "Remettre en vente un similaire": one or several new sheets in the workshop, copied from this article (brand,
 * model, category, parcel; on Vinted, the listing's own ids). What belongs to the physical article is never copied.
 */
export function RelistButton({ v }: { v: ItemView }) {
  const { t } = useI18n();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState('1');
  const [size, setSize] = useState(v.item.size ?? '');
  const [condition, setCondition] = useState<Condition | ''>(v.item.condition ?? '');
  const [bought, setBought] = useState('');
  const cost = useMoneyField(null);
  const [busy, setBusy] = useState(false);
  const n = Math.max(1, Math.min(20, Math.round(Number(count) || 1)));
  const sold = v.sale && v.sale.status !== 'REFUNDED' ? v.sale : null;

  const create = async () => {
    setBusy(true);
    try {
      const ids = await repo.relistSimilar(v.item.id, { count: n, size: size.trim() || null, condition: condition || null, costCents: cost.cents, purchaseDate: bought ? new Date(`${bought}T12:00:00`).getTime() : null });
      setOpen(false);
      toast('success', t('relist.done', { n: ids.length }), t('relist.doneHint'));
      go(`workshop/${ids[0]}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button icon="plus" onClick={() => setOpen(true)}>
        {t('relist.button')}
      </Button>
      <Modal open={open} onClose={() => !busy && setOpen(false)} title={t('relist.title')}>
        <p className="t-small t-muted">
          {v.item.title}
          {sold ? ` · ${t('relist.soldFor', { price: sold.salePriceCents })}` : ''}
        </p>
        <p className="t-small">{t('relist.intro')}</p>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 10 }}>
          <Field label={t('relist.count')} htmlFor="rl-n">
            <Input id="rl-n" type="number" min={1} max={20} value={count} onChange={(e) => setCount(e.target.value)} />
          </Field>
          <Field label={t('relist.size')} htmlFor="rl-size">
            <Input id="rl-size" value={size} placeholder="M" onChange={(e) => setSize(e.target.value)} />
          </Field>
          <Field label={t('relist.condition')} htmlFor="rl-cond">
            <ConditionSelect id="rl-cond" value={condition} onChange={setCondition} />
          </Field>
          <Field label={t('relist.cost')} htmlFor="rl-cost" optional error={cost.invalid ? t('add.invalidAmount') : null}>
            <Input id="rl-cost" money value={cost.raw} onChange={(e) => cost.setRaw(e.target.value)} />
          </Field>
          <Field label={t('relist.bought')} htmlFor="rl-date" optional>
            <Input id="rl-date" type="date" value={bought} onChange={(e) => setBought(e.target.value)} />
          </Field>
        </div>
        <ul className="t-small t-faint stack" style={{ margin: 0, paddingLeft: 18 }}>
          <li>{t('relist.copied')}</li>
          <li>{t('relist.notCopied')}</li>
        </ul>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" icon="check" loading={busy} disabled={cost.invalid} onClick={create}>
            {t('relist.create', { n })}
          </Button>
        </div>
      </Modal>
    </>
  );
}
