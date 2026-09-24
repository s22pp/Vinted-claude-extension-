import { useEffect, useState } from 'react';
import type { EraMessage, PriceEditResult, PriceStage } from '@/data/adapters/vinted/protocol';
import { useI18n } from '@/i18n';
import type { ItemView } from '@/intelligence/portfolio';
import { Modal, useErrorToast, useToast } from '@/ui/components/overlays';
import { Button, Field, Input, Stages } from '@/ui/components/primitives';
import { useMoneyField } from './forms';

/** The Vinted listing id of an item's live listing, when it came from Vinted. */
export function vintedIdOf(v: ItemView | undefined): string | null {
  const id = v?.current?.platformListingId ?? null;
  return id && /^\d+$/.test(id) ? id : null;
}

export function useVintedPriceEdit() {
  const { t, money } = useI18n();
  const toast = useToast();
  const errorToast = useErrorToast();
  const [stage, setStage] = useState<PriceStage | null>(null);
  useEffect(() => {
    const on = (msg: EraMessage) => {
      if (msg.type === 'era:price:stage') setStage(msg.stage);
    };
    browser.runtime.onMessage.addListener(on);
    return () => browser.runtime.onMessage.removeListener(on);
  }, []);
  const run = async (v: ItemView, cents: number): Promise<boolean> => {
    const id = vintedIdOf(v);
    if (!id) return false;
    setStage('OPENING');
    let r: PriceEditResult;
    try {
      r = (await browser.runtime.sendMessage({ type: 'era:price:edit', platformListingId: id, cents, itemId: v.item.id } satisfies EraMessage)) as PriceEditResult;
    } catch (e) {
      r = { ok: false, code: 'UNAVAILABLE', detail: `service worker : ${e instanceof Error ? e.message : String(e)}` };
    }
    setStage(null);
    if (r.ok) toast('success', t('vintedPrice.success', { price: r.after }), t('vintedPrice.verified', { from: r.before ?? v.askPrice ?? 0, to: r.after }));
    else errorToast(r);
    void money;
    return r.ok;
  };
  return { stage, busy: stage !== null, run };
}

/** Confirm → edit on Vinted → verify. One listing, one click, never in bulk. */
export function ApplyPriceModal({ v, cents, open, onClose }: { v: ItemView; cents: number | null; open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const edit = useVintedPriceEdit();
  const price = useMoneyField(cents);
  useEffect(() => {
    if (open) price.setRaw(cents === null ? '' : String(cents / 100).replace('.', ','));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cents]);
  const target = price.cents;
  return (
    <Modal open={open} onClose={() => !edit.busy && onClose()} title={t('vintedPrice.confirmTitle')}>
      <p className="t-small t-muted">{v.item.title}</p>
      <Field label={t('vintedPrice.newPrice')} htmlFor="vp-price" error={price.invalid ? t('add.invalidAmount') : null}>
        <Input id="vp-price" money value={price.raw} onChange={(e) => price.setRaw(e.target.value)} disabled={edit.busy} style={{ width: 140 }} />
      </Field>
      <p className="t-small">{t('vintedPrice.confirmBody', { from: v.askPrice ?? 0, to: target ?? 0 })}</p>
      <ul className="t-small t-faint stack" style={{ margin: 0, paddingLeft: 18 }}>
        <li>{t('vintedPrice.safe1')}</li>
        <li>{t('vintedPrice.safe2')}</li>
        <li>{t('vintedPrice.safe3')}</li>
      </ul>
      {edit.stage && <Stages stages={['OPENING', 'FILLING', 'SAVING', 'VERIFYING', 'DONE'] as PriceStage[]} current={edit.stage} labelKey={(s) => t(`vintedPrice.stage${s}`)} />}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Button variant="ghost" onClick={onClose} disabled={edit.busy}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="primary"
          icon="check"
          loading={edit.busy}
          disabled={target === null || price.invalid || target === v.askPrice}
          onClick={async () => {
            if (target !== null && (await edit.run(v, target))) onClose();
          }}
        >
          {t('vintedPrice.apply')}
        </Button>
      </div>
    </Modal>
  );
}

export function PriceOnVintedButton({ v, suggested, label, variant = 'default', size = 'md' }: { v: ItemView; suggested: number | null; label?: string; variant?: 'default' | 'primary' | 'ghost'; size?: 'sm' | 'md' }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const id = vintedIdOf(v);
  return (
    <>
      <Button variant={variant} size={size} icon="price" disabled={!id} title={id ? undefined : t('vintedPrice.onlyVinted')} onClick={() => setOpen(true)}>
        {label ?? t('vintedPrice.button')}
      </Button>
      {id && <ApplyPriceModal v={v} cents={suggested ?? v.askPrice} open={open} onClose={() => setOpen(false)} />}
    </>
  );
}
