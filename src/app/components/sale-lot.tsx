import { useState } from 'react';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import type { ItemView } from '@/intelligence/portfolio';
import { type LotCandidate, LOT_DISCOUNT_PCT, LOT_MAX, LOT_MIN, lotListing, lotProblem, planSaleLot } from '@/intelligence/sale-lot';
import { Modal, useToast } from '@/ui/components/overlays';
import { Button } from '@/ui/components/primitives';

/** The lots made, kept on this device: which articles went together, at what price, when. */
export const SALE_LOTS_KEY = 'saleLots';
export interface SaleLotRecord {
  id: string;
  itemIds: string[];
  lotCents: number;
  totalAskCents: number;
  createdAt: number;
}

const candidate = (v: ItemView): LotCandidate => ({ itemId: v.item.id, title: v.current?.title ?? v.item.title, askCents: v.askPrice, costCents: v.cost, daysListed: v.daysListed, inStock: v.inStock });

/**
 * « Créer un lot » for 2 to 5 ticked articles: the sum of their prices −15 %, the sum of their costs beside it; once
 * made, each article is set aside (« Réservé · En lot ») and the lot's listing text is copied for Vinted.
 */
export function SaleLotButton({ views, onDone }: { views: readonly ItemView[]; onDone: () => void }) {
  const { t, money } = useI18n();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (views.length < LOT_MIN || views.length > LOT_MAX) return null;
  const items = views.map(candidate);
  const problem = lotProblem(items);
  const plan = planSaleLot(items);
  const create = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      const now = Date.now();
      for (const id of plan.itemIds) await repo.setReserved(id, true, now);
      const lots = (await repo.getSetting<SaleLotRecord[]>(SALE_LOTS_KEY, [])) ?? [];
      await repo.setSetting(SALE_LOTS_KEY, [...lots, { id: `lot_${now.toString(36)}`, itemIds: plan.itemIds, lotCents: plan.lotCents, totalAskCents: plan.totalAskCents, createdAt: now } satisfies SaleLotRecord]);
      const text = lotListing(items, plan, (c) => money(c));
      await navigator.clipboard.writeText(`${text.title}\n\n${text.description}`).catch(() => undefined);
      toast('success', t('saleLot.done', { n: plan.itemIds.length, price: money(plan.lotCents) }), t('saleLot.doneHint'));
      setOpen(false);
      onDone();
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button size="sm" icon="layers" onClick={() => setOpen(true)} data-testid="sale-lot">
        {t('saleLot.button', { n: views.length })}
      </Button>
      <Modal open={open} onClose={() => !busy && setOpen(false)} title={t('saleLot.title', { n: views.length })}>
        <div className="stack-3" data-testid="sale-lot-dialog">
          <table className="dt dt--compact">
            <tbody>
              {items.map((i) => (
                <tr key={i.itemId}>
                  <td>{i.title}</td>
                  <td className="num">{i.askCents !== null ? money(i.askCents) : '—'}</td>
                  <td className="num t-muted">{i.costCents !== null ? t('saleLot.cost', { cost: money(i.costCents) }) : t('saleLot.costUnknown')}</td>
                  <td className="num t-faint">{i.daysListed !== null ? t('saleLot.days', { n: i.daysListed }) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {problem ? (
            <p className="t-small t-warn">{t(`saleLot.problem.${problem}`)}</p>
          ) : plan ? (
            <div className="offer-tiers" data-testid="sale-lot-plan">
              <div className="offer-tiers__cell">
                <span className="t-caption">{t('saleLot.total')}</span>
                <b className="num">{money(plan.totalAskCents)}</b>
              </div>
              <div className="offer-tiers__cell">
                <span className="t-caption">{t('saleLot.price', { pct: LOT_DISCOUNT_PCT })}</span>
                <b className="num">{money(plan.lotCents)}</b>
              </div>
              <div className="offer-tiers__cell">
                <span className="t-caption">{t('saleLot.costs')}</span>
                <b className="num">{plan.costComplete ? money(plan.costCents) : `≥ ${money(plan.costCents)}`}</b>
                <span className="t-small t-muted">{plan.profitCents !== null ? t('saleLot.profit', { profit: money(plan.profitCents, { sign: true }) }) : t('saleLot.profitUnknown')}</span>
              </div>
            </div>
          ) : null}
          {plan?.atCost && <p className="t-small t-muted">{t('saleLot.atCost')}</p>}
          <p className="t-small t-faint">{t('saleLot.how')}</p>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" icon="check" loading={busy} disabled={!plan} onClick={() => void create()}>
              {t('saleLot.create')}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
