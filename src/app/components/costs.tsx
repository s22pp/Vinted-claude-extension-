import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useRef, useState } from 'react';
import { db } from '@/data/db';
import { repo } from '@/data/repo';
import { parseMoneyInput } from '@/domain/money';
import { useI18n } from '@/i18n';
import type { ItemView } from '@/intelligence/portfolio';
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
  const { t } = useI18n();
  const era = useEra();
  const purchases = usePendingPurchases();
  const missing = useMemo(() => missingCosts(era.views), [era.views]);
  const matches = useMemo(() => purchaseByItem(purchases, missing.map((v) => v.item)), [purchases, missing]);
  const [done, setDone] = useState(0);
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const focusNext = (id: string) => {
    const ids = missing.map((v) => v.item.id);
    const next = ids[ids.indexOf(id) + 1];
    if (next) requestAnimationFrame(() => inputs.current.get(next)?.focus());
  };

  return (
    <Drawer open={open} onClose={onClose} title={t('costs.title', { n: missing.length })}>
      <div className="stack-3" data-testid="costs">
        <p className="t-small t-muted">{t('costs.intro')}</p>
        {done > 0 && <Badge tone="emerald">{t('costs.saved', { n: done })}</Badge>}
        {missing.length === 0 && <p className="t-pos">{t('costs.none')}</p>}
        {missing.map((v) => (
          <div key={v.item.id} style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
            <CostRow
              v={v}
              match={matches.get(v.item.id) ?? null}
              inputRef={(el) => el && inputs.current.set(v.item.id, el)}
              onDone={(typed) => {
                setDone((n) => n + 1);
                if (typed) focusNext(v.item.id);
              }}
            />
          </div>
        ))}
      </div>
    </Drawer>
  );
}

/** Pending Vinted purchases (not linked, not dismissed). */
export function usePendingPurchases(): PendingPurchase[] {
  return useLiveQuery(() => db.purchases.filter((p) => !p.linkedItemId && !p.dismissed).toArray(), []) ?? [];
}

type PendingPurchase = { id: string; title: string; date: number | null; priceCents: number };

/** Articles whose cost is unknown: sold ones first (their profit is unknown), then the dearest. */
export function missingCosts(views: readonly ItemView[]): ItemView[] {
  return views
    .filter((v) => !v.item.isDemo && v.cost === null && (v.inStock || v.item.status === 'SOLD'))
    .sort((a, b) => Number(b.item.status === 'SOLD') - Number(a.item.status === 'SOLD') || (b.sale?.salePriceCents ?? b.askPrice ?? 0) - (a.sale?.salePriceCents ?? a.askPrice ?? 0));
}

/** One article without a cost: its Vinted purchase in one click when found, else type the amount + Enter. */
export function CostRow({
  v,
  match,
  onDone,
  inputRef,
}: {
  v: ItemView;
  match: { purchase: PendingPurchase; sure: boolean } | null;
  onDone?: (typed: boolean) => void;
  inputRef?: (el: HTMLInputElement | null) => void;
}) {
  const { t, date } = useI18n();
  const toast = useToast();
  const [raw, setRaw] = useState('');
  const id = v.item.id;
  const cents = parseMoneyInput(raw);
  return (
    <div className="stack" style={{ gap: 6 }}>
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
      {match && (
        <div className="row t-small" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Badge tone={match.sure ? 'emerald' : 'amber'}>{t(match.sure ? 'costs.matchSure' : 'costs.matchMaybe')}</Badge>
          <span className="grow">
            « {match.purchase.title} » · <Money cents={match.purchase.priceCents} />
            {match.purchase.date !== null ? ` · ${date(match.purchase.date)}` : ''} → <Money cents={withBuyerProtection(match.purchase.priceCents)} /> {t('costs.withProtection')}
          </span>
          <Button
            size="sm"
            variant="primary"
            icon="check"
            onClick={async () => {
              await repo.linkPurchase(match.purchase.id, id);
              toast('success', t('costs.linked'), t('costs.linkedHint'));
              onDone?.(false);
            }}
          >
            {t('costs.use')}
          </Button>
        </div>
      )}
      <form
        className="row"
        style={{ gap: 8 }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (cents === undefined || cents === null) return;
          onDone?.(true);
          await repo.setPurchasePrice(id, cents);
        }}
      >
        <Input ref={inputRef} money aria-label={t('costs.input', { title: v.item.title })} placeholder={t('costs.placeholder')} value={raw} onChange={(e) => setRaw(e.target.value)} style={{ width: 120 }} />
        <Button size="sm" type="submit" disabled={cents === undefined || cents === null}>
          {t('costs.save')}
        </Button>
      </form>
    </div>
  );
}
