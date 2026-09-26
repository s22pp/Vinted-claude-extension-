import { useMemo, useState } from 'react';
import type { EraMessage, LabelResult } from '@/data/adapters/vinted/protocol';
import { useI18n } from '@/i18n';
import type { ItemView, SaleView } from '@/intelligence/portfolio';
import { purchaseByItem } from '@/intelligence/purchase-match';
import { parcelAlerts } from '@/intelligence/shipping';
import { type IconName, IconTile, type TileTone } from '@/ui/components/icons';
import { useErrorToast, useToast } from '@/ui/components/overlays';
import { Badge, Button, Card } from '@/ui/components/primitives';
import { go, useEra } from '../state';
import { CostRow, missingCosts, usePendingPurchases } from './costs';
import { RecommendationCard } from './domain';
import { SaleModal } from './forms';
import { RepostButton } from './repost';
import { PriceOnVintedButton } from './vinted-price';

/**
 * "Tournée du jour": everything that waits for the seller, in one queue, one task at a time, each with its own
 * action right there — parcels first, then reservations, unknown costs, ERA's advice, sheets to list.
 * "Passer" puts a task aside for this session; a task that gets done leaves the queue by itself.
 */
type Task =
  | { key: string; kind: 'SHIP'; s: SaleView }
  | { key: string; kind: 'PARCEL'; s: SaleView; days: number; state: 'SHIPPED' | 'DELIVERED' }
  | { key: string; kind: 'RESERVED'; v: ItemView }
  | { key: string; kind: 'COST'; v: ItemView }
  | { key: string; kind: 'RECO'; v: ItemView }
  | { key: string; kind: 'LIST'; v: ItemView };

const KIND: Record<Task['kind'], { icon: IconName; tone: TileTone }> = {
  SHIP: { icon: 'box', tone: 'coral' },
  PARCEL: { icon: 'clock', tone: 'amber' },
  RESERVED: { icon: 'check', tone: 'emerald' },
  COST: { icon: 'edit', tone: 'cyan' },
  RECO: { icon: 'target', tone: 'amber' },
  LIST: { icon: 'upload', tone: 'violet' },
};

const SKIP_KEY = 'era.run.skipped';
const readSkipped = (): string[] => {
  try {
    return JSON.parse(sessionStorage.getItem(SKIP_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
};

export function DailyRun() {
  const { t } = useI18n();
  const era = useEra();
  const toast = useToast();
  const errorToast = useErrorToast();
  const purchases = usePendingPurchases();
  const [skipped, setSkipped] = useState<string[]>(readSkipped);
  const [saleFor, setSaleFor] = useState<ItemView | null>(null);
  const [busy, setBusy] = useState(false);

  const tasks = useMemo((): Task[] => {
    const out: Task[] = [];
    for (const s of era.sales) if (s.sale.needsAction && s.sale.status !== 'REFUNDED') out.push({ key: `ship:${s.sale.id}`, kind: 'SHIP', s });
    const byId = new Map(era.sales.map((x) => [x.sale.id, x]));
    for (const a of parcelAlerts(era.sales.map((x) => x.sale), era.now)) out.push({ key: `parcel:${a.saleId}:${a.state}`, kind: 'PARCEL', s: byId.get(a.saleId)!, days: a.days, state: a.state });
    for (const v of era.views) if (v.item.status === 'RESERVED') out.push({ key: `res:${v.item.id}`, kind: 'RESERVED', v });
    // Unknown costs: every sold one, and the five dearest in stock (the rest waits in "Coûts manquants").
    const costs = missingCosts(era.views);
    for (const v of [...costs.filter((x) => x.item.status === 'SOLD'), ...costs.filter((x) => x.item.status !== 'SOLD').slice(0, 5)]) out.push({ key: `cost:${v.item.id}`, kind: 'COST', v });
    const recos = era.intel
      .filter((x) => x.recommendation && !['HOLD', 'ADD_COST'].includes(x.recommendation.action) && x.recommendation.priority >= 50 && x.view.inStock)
      .sort((a, b) => b.recommendation!.priority - a.recommendation!.priority);
    for (const x of recos.slice(0, 10)) out.push({ key: `reco:${x.recommendation!.key}`, kind: 'RECO', v: x.view });
    for (const v of era.workshop.toList.slice(0, 5)) out.push({ key: `list:${v.item.id}`, kind: 'LIST', v });
    return out;
  }, [era.sales, era.views, era.intel, era.workshop, era.now]);

  const queue = tasks.filter((x) => !skipped.includes(x.key));
  const matches = useMemo(() => purchaseByItem(purchases, queue.filter((x) => x.kind === 'COST').map((x) => (x as { v: ItemView }).v.item)), [purchases, queue]);
  if (!tasks.length) return null;
  const task = queue[0] ?? null;
  const skip = (key: string) => {
    const next = [...skipped, key];
    setSkipped(next);
    try {
      sessionStorage.setItem(SKIP_KEY, JSON.stringify(next));
    } catch {
      /* private window: the skip lasts until reload */
    }
  };
  const reset = () => {
    setSkipped([]);
    try {
      sessionStorage.removeItem(SKIP_KEY);
    } catch {
      /* ignore */
    }
  };

  const label = async (s: SaleView) => {
    setBusy(true);
    try {
      const r = (await browser.runtime.sendMessage({ type: 'era:label:get', conversationId: s.sale.vintedConversationId!, title: s.item.title, soldAt: s.sale.soldAt } satisfies EraMessage)) as LabelResult;
      if (!r.ok) return errorToast(r);
      toast('success', t('ship.labelDone'), r.file ? t('ship.saved', { file: r.file }) : t('ship.notSaved', { detail: r.saveError ?? '' }));
      window.open(r.url, '_blank', 'noopener');
    } finally {
      setBusy(false);
    }
  };

  const body = (x: Task) => {
    switch (x.kind) {
      case 'SHIP':
        return (
          <div className="row wrap" style={{ gap: 8 }}>
            {era.mode === 'real' && x.s.sale.vintedConversationId && (
              <Button size="sm" variant="primary" icon="download" loading={busy} onClick={() => label(x.s)}>
                {t('ship.label')}
              </Button>
            )}
            <Button size="sm" icon="check" onClick={() => go('sales?ship=1')}>
              {t('run.checklist')}
            </Button>
            <Button size="sm" variant="ghost" icon="book" onClick={() => go(`dossier/${x.s.sale.id}`)}>
              {t('dossier.open')}
            </Button>
          </div>
        );
      case 'PARCEL':
        return (
          <div className="stack" style={{ gap: 6 }}>
            <span className="t-small">
              {x.s.sale.vintedStatus} · {t(`parcels.${x.state}`, { n: x.days })}
            </span>
            <div className="row wrap" style={{ gap: 8 }}>
              {x.s.sale.vintedConversationId && (
                <Button size="sm" icon="external" onClick={() => window.open(`https://www.vinted.fr/inbox/${x.s.sale.vintedConversationId}`, '_blank', 'noopener')}>
                  {t('parcels.conversation')}
                </Button>
              )}
              <Button size="sm" variant="ghost" icon="book" onClick={() => go(`dossier/${x.s.sale.id}`)}>
                {t('dossier.open')}
              </Button>
            </div>
          </div>
        );
      case 'RESERVED':
        return (
          <Button size="sm" variant="primary" icon="sales" onClick={() => setSaleFor(x.v)}>
            {t('item.recordSale')}
          </Button>
        );
      case 'COST':
        return <CostRow v={x.v} match={matches.get(x.v.item.id) ?? null} />;
      case 'RECO': {
        const r = era.intelById.get(x.v.item.id)?.recommendation;
        if (!r) return null;
        const price = typeof r.actionParams.price === 'number' ? r.actionParams.price : null;
        return (
          <div className="stack-3">
            <RecommendationCard r={r} compact onAnalyze={() => go(`item/${x.v.item.id}`)} />
            {era.mode === 'real' && (
              <div className="row wrap" style={{ gap: 8 }}>
                {price !== null && <PriceOnVintedButton v={x.v} suggested={price} size="sm" />}
                {r.action === 'REPOST' && <RepostButton v={x.v} />}
              </div>
            )}
          </div>
        );
      }
      case 'LIST':
        return (
          <Button size="sm" variant="primary" icon="upload" onClick={() => go(`workshop/${x.v.item.id}`)}>
            {t('run.openSheet')}
          </Button>
        );
    }
  };
  const title = (x: Task) => (x.kind === 'SHIP' || x.kind === 'PARCEL' ? x.s.item.title : x.v.item.title);
  const itemHref = (x: Task) => `item/${x.kind === 'SHIP' || x.kind === 'PARCEL' ? x.s.item.id : x.v.item.id}`;

  return (
    <Card
      title={t('run.title')}
      hint={t('run.hint', { n: queue.length })}
      icon="rows"
      tone="violet"
      actions={skipped.length > 0 ? <Button size="sm" variant="ghost" onClick={reset}>{t('run.reset', { n: skipped.length })}</Button> : null}
    >
      <div className="stack-3" data-testid="daily-run">
        {task ? (
          <>
            <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
              <IconTile name={KIND[task.kind].icon} tone={KIND[task.kind].tone} />
              <div className="grow stack" style={{ gap: 4, minWidth: 0 }}>
                <span className="t-caption">
                  {t(`run.kind.${task.kind}`)} · <span data-testid="run-pos" data-n={queue.length}>{t('run.pos', { i: 1, n: queue.length })}</span>
                </span>
                <a href={`#/${itemHref(task)}`} className="clamp-1" style={{ fontWeight: 650 }} data-testid="run-item">
                  {title(task)}
                </a>
              </div>
              <Button size="sm" variant="ghost" onClick={() => skip(task.key)}>
                {t('run.skip')}
              </Button>
            </div>
            {body(task)}
            {queue.length > 1 && (
              <div className="t-small t-faint">
                {t('run.next')} {queue.slice(1, 4).map((x) => `${t(`run.kind.${x.kind}`)} · ${title(x)}`).join(' — ')}
                {queue.length > 4 ? ` — ${t('run.more', { n: queue.length - 4 })}` : ''}
              </div>
            )}
          </>
        ) : (
          <p className="t-muted">
            {t('run.allSkipped')} <Badge tone="neutral">{skipped.length}</Badge>
          </p>
        )}
      </div>
      {saleFor && <SaleModal open onClose={() => setSaleFor(null)} itemId={saleFor.item.id} suggested={saleFor.askPrice} />}
    </Card>
  );
}
