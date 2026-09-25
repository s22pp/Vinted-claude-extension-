import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import type { ActivationEventName, DomainEvent, InventoryItem } from '@/domain/entities';
import { db } from '@/data/db';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import type { Coded, Recommendation } from '@/intelligence/decision';
import type { PricingResult } from '@/intelligence/pricing';
import type { StagnationDiagnosis } from '@/intelligence/stagnation';
import { Ring } from '@/ui/charts/charts';
import { Icon, type IconName, IconTile, type TileTone } from '@/ui/components/icons';
import { useToast } from '@/ui/components/overlays';
import { Badge, type BadgeTone, Button, ConfidenceMeter, Tooltip } from '@/ui/components/primitives';
import { Thumb } from '@/ui/components/Thumb';
import { buildPrediction } from '@/intelligence/precision';
import { condenseEngagement } from '@/intelligence/timeline';
import { go, useEra } from '../state';

export function ItemCell({ item, sub }: { item: InventoryItem; sub?: React.ReactNode }) {
  return (
    <span className="row" style={{ gap: 10, minWidth: 0 }}>
      <Thumb photoUrl={item.photoUrl} category={item.category} alt={item.title} size="sm" />
      <span style={{ minWidth: 0 }}>
        <span className="clamp-1" style={{ display: 'block', fontWeight: 550, maxWidth: 280 }}>
          {item.title}
        </span>
        <span className="t-faint t-small clamp-1" style={{ display: 'block' }}>
          {sub ?? item.brand}
        </span>
      </span>
    </span>
  );
}

const TONE_COLOR: Record<Recommendation['tone'], string> = {
  risk: 'var(--coral)',
  warning: 'var(--amber)',
  info: 'var(--cyan)',
  positive: 'var(--emerald)',
};
const ACTION_ICON: Record<Recommendation['action'], IconName> = {
  SET_PRICE: 'price',
  SMALL_DROP: 'heart',
  RAISE_PRICE: 'trendUp',
  FREE_CAPITAL: 'capital',
  REPOST: 'repost',
  REVIEW_LISTING: 'eye',
  HOLD: 'hourglass',
  ADD_COST: 'edit',
  ANALYZE: 'market',
};
const TONE_TILE: Record<Recommendation['tone'], TileTone> = { risk: 'coral', warning: 'amber', info: 'cyan', positive: 'emerald' };

export function useRecoText() {
  const { t } = useI18n();
  return {
    action: (r: Recommendation) => t(`reco.a.${r.action}`, r.actionParams),
    coded: (c: Coded) => {
      const [ns, key] = c.code.split('.');
      const map: Record<string, string> = { why: 'reco.w', impact: 'reco.i', alt: 'reco.alt' };
      return t(`${map[ns!] ?? ns}.${key}`, c.params);
    },
  };
}

export function RecoIcon({ r }: { r: Recommendation }) {
  return <IconTile name={ACTION_ICON[r.action]} tone={TONE_TILE[r.tone]} />;
}

/** The single recommendation component: ACTION · WHY · CONFIDENCE · EXPECTED IMPACT · ALTERNATIVE. */
export function RecommendationCard({ r, onAddCost, onAnalyze, compact }: { r: Recommendation; onAddCost?: () => void; onAnalyze?: () => void; compact?: boolean }) {
  const { t } = useI18n();
  const text = useRecoText();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const priceAction = ['SET_PRICE', 'SMALL_DROP', 'RAISE_PRICE', 'FREE_CAPITAL'].includes(r.action);
  const era = useEra();

  const accept = async () => {
    setBusy(true);
    try {
      if (r.action === 'ADD_COST') return onAddCost?.();
      if (r.action === 'ANALYZE') return onAnalyze?.();
      if (priceAction && r.itemId && typeof r.actionParams.price === 'number') {
        await repo.updatePrice(r.itemId, r.actionParams.price);
        // The accepted price becomes a forecast, confronted with the real sale later (Précision ERA).
        const intel = era.intelById.get(r.itemId);
        const pred =
          intel?.analysis && intel.pricing
            ? buildPrediction({
                itemId: r.itemId,
                at: Date.now(),
                analysis: intel.analysis,
                pricing: intel.pricing,
                personal: intel.personal,
                askCents: intel.view.askPrice,
                correction: era.learning.priceCorrection,
                kind: 'RECOMMENDATION',
                isDemo: intel.view.item.isDemo,
                suggestedCents: r.actionParams.price,
              })
            : null;
        if (pred) await repo.storePrediction(pred);
      }
      await repo.recordDecision(r.key, r.itemId, r.action, 'ACCEPTED');
      toast('success', t('reco.applied'), priceAction ? t('reco.appliedHint') : undefined);
    } finally {
      setBusy(false);
    }
  };
  const dismiss = async (outcome: 'DISMISSED' | 'SNOOZED') => {
    await repo.recordDecision(r.key, r.itemId, r.action, outcome);
    toast('info', t('reco.dismissed'));
  };

  return (
    <article className={`reco reco--${r.tone}`} aria-label={text.action(r)}>
      <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
        <RecoIcon r={r} />
        <div className="grow">
          <div className="t-caption" style={{ marginBottom: 4 }}>
            {t('reco.action')} · {t(`reco.evidence.${r.evidence}`)}
          </div>
          <div className="reco__action">{text.action(r)}</div>
        </div>
      </div>
      <dl className="reco__grid" style={{ margin: 0, marginTop: 16 }}>
        <dt className="reco__k">{t('reco.why')}</dt>
        <dd className="reco__v" style={{ margin: 0 }}>
          {r.why.length === 1 ? (
            text.coded(r.why[0]!)
          ) : (
            <ul>
              {r.why.map((w) => (
                <li key={w.code}>{text.coded(w)}</li>
              ))}
            </ul>
          )}
        </dd>
        <dt className="reco__k">{t('reco.confidence')}</dt>
        <dd className="reco__v" style={{ margin: 0 }}>
          <ConfidenceMeter level={r.confidence} tone={TONE_COLOR[r.tone]} />
        </dd>
        <dt className="reco__k">{t('reco.impact')}</dt>
        <dd className="reco__v" style={{ margin: 0 }}>
          {text.coded(r.impact)}
        </dd>
        {r.alternative && !compact && (
          <>
            <dt className="reco__k">{t('reco.alternative')}</dt>
            <dd className="reco__v t-muted" style={{ margin: 0 }}>
              {text.coded(r.alternative)}
            </dd>
          </>
        )}
      </dl>
      <div className="reco__foot">
        <Button size="sm" variant="primary" icon={r.action === 'ADD_COST' ? 'edit' : r.action === 'ANALYZE' ? 'market' : 'check'} loading={busy} onClick={accept}>
          {r.action === 'ADD_COST' ? t('item.editCost') : r.action === 'ANALYZE' ? t('item.analyze') : t('reco.accept')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => dismiss('SNOOZED')}>
          {t('reco.snooze')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => dismiss('DISMISSED')}>
          {t('reco.dismiss')}
        </Button>
      </div>
    </article>
  );
}

/** Compact one-line reco for tables and lists. */
export function RecoChip({ r }: { r: Recommendation | null }) {
  const text = useRecoText();
  if (!r) return <span className="t-faint">—</span>;
  const tone: BadgeTone = r.tone === 'risk' ? 'coral' : r.tone === 'warning' ? 'amber' : r.tone === 'positive' ? 'emerald' : 'cyan';
  return (
    <Tooltip content={r.why.map((w) => text.coded(w)).join(' ')}>
      <Badge tone={tone} dot>
        {text.action(r)}
      </Badge>
    </Tooltip>
  );
}

const STAG_TONE: Record<StagnationDiagnosis['state'], BadgeTone> = {
  HEALTHY: 'emerald',
  TOO_EARLY: 'neutral',
  LOW_VISIBILITY: 'amber',
  HIGH_VISIBILITY_LOW_INTEREST: 'coral',
  FAVORITES_NO_CONVERSION: 'amber',
  PRICE_MISALIGNED: 'coral',
  LOW_DEMAND: 'amber',
  INSUFFICIENT_DATA: 'neutral',
};

const STATUS_TONE: Record<InventoryItem['status'], BadgeTone> = {
  DRAFT: 'neutral',
  LISTED: 'cobalt',
  RESERVED: 'amber',
  HIDDEN: 'neutral',
  SOLD: 'emerald',
  ARCHIVED: 'neutral',
};

/** Article status (posted / reserved / sold…) — text + dot, never colour alone. */
export function StatusBadge({ status }: { status: InventoryItem['status'] }) {
  const { t } = useI18n();
  return (
    <Badge tone={STATUS_TONE[status]} dot title={t(`statusHint.${status}`)}>
      {t(`status.${status}`)}
    </Badge>
  );
}

export function StagnationBadge({ d }: { d: StagnationDiagnosis }) {
  const { t } = useI18n();
  return (
    <Badge tone={STAG_TONE[d.state]} dot>
      {t(`stagnation.${d.state}`)}
    </Badge>
  );
}

export function StrategyCards({ pricing, current }: { pricing: PricingResult; current?: number | null }) {
  const { t, money } = useI18n();
  return (
    <div className="strategies">
      {pricing.options.map((o, i) => {
        const rec = pricing.recommended === o.strategy;
        return (
          <div key={o.strategy} className={`strategy ${rec ? 'is-recommended' : ''}`} style={{ animationDelay: `${i * 70}ms` }}>
            <div className="row-between">
              <span className="t-caption">{t(`strategy.${o.strategy}`)}</span>
              {rec && <Badge tone="violet">{t('strategy.recommended')}</Badge>}
            </div>
            <div className="strategy__price num">
              {o.range.min === o.range.max ? money(o.range.min) : `${money(o.range.min).replace(/\s?€/, '')}–${money(o.range.max)}`}
            </div>
            <div className="t-small t-muted">{t(`strategy.${o.strategy}_hint`)}</div>
            <div className="row t-small t-faint" style={{ marginTop: 8 }}>
              <Icon name="clock" size={13} />
              <span className="num">{t('strategy.days', { lo: o.days.min, hi: o.days.max })}</span>
            </div>
            {current !== null && current !== undefined && (
              <div className="t-small" style={{ marginTop: 4, color: current > o.range.max ? 'var(--amber)' : 'var(--text-3)' }}>
                {current > o.range.max ? `+${money(current - o.range.max)}` : current < o.range.min ? `−${money(o.range.min - current)}` : '✓'}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Timeline — built from real DomainEvents ─────────────── */

const EV_ICON: Record<DomainEvent['type'], { icon: IconName; tone: TileTone }> = {
  ITEM_ACQUIRED: { icon: 'tag', tone: 'violet' },
  COST_ENTERED: { icon: 'edit', tone: 'violet' },
  LISTING_PUBLISHED: { icon: 'arrowUpRight', tone: 'cobalt' },
  PRICE_CHANGED: { icon: 'price', tone: 'amber' },
  ENGAGEMENT_OBSERVED: { icon: 'eye', tone: 'cyan' },
  LISTING_REMOVED: { icon: 'x', tone: 'neutral' },
  LISTING_REPUBLISHED: { icon: 'repost', tone: 'cobalt' },
  ITEM_SOLD: { icon: 'check', tone: 'emerald' },
  STATUS_CHANGED: { icon: 'dot', tone: 'amber' },
  SALE_REFUNDED: { icon: 'alert', tone: 'coral' },
  LISTING_PREPARED: { icon: 'layers', tone: 'pink' },
  MARKET_ANALYZED: { icon: 'market', tone: 'cobalt' },
  PREDICTION_MADE: { icon: 'target', tone: 'pink' },
  PREDICTION_RESOLVED: { icon: 'scale', tone: 'pink' },
};

export function Timeline({ itemId }: { itemId: string }) {
  const { t, date, money, pct } = useI18n();
  const raw = useLiveQuery(() => db.events.where('inventoryItemId').equals(itemId).sortBy('at'), [itemId]);
  if (!raw) return null;
  const events = condenseEngagement(raw);
  if (events.length === 0) return <p className="t-muted">{t('timeline.empty')}</p>;
  const num = (v: unknown) => (typeof v === 'number' ? v : null);
  return (
    <ol className="timeline">
      {events.map((e, i) => {
        const d = e.data;
        let detail: string | null = null;
        let value: string | null = null;
        switch (e.type) {
          case 'ITEM_ACQUIRED':
            value = num(d.cost) !== null ? money(num(d.cost)) : null;
            detail = num(d.cost) === null ? t('data.notProvided') : null;
            break;
          case 'COST_ENTERED':
          case 'LISTING_PUBLISHED':
          case 'ITEM_SOLD':
          case 'SALE_REFUNDED':
            value = money(num(d.price) ?? num(d.cost));
            break;
          case 'LISTING_REPUBLISHED':
            // Same article, new announcement: what Vinted reset stays visible here.
            value = money(num(d.price));
            detail = d.basis === 'SKU' || d.basis === 'TITLE' || d.basis === 'ERA' ? t('timeline.repostDetail', { basis: t(`timeline.basis${d.basis}`), views: num(d.viewsLost), favorites: num(d.favoritesLost) }) : null;
            break;
          case 'PRICE_CHANGED':
            value = money(num(d.to));
            detail = t('timeline.priceDetail', { from: num(d.from), to: num(d.to) });
            break;
          case 'ENGAGEMENT_OBSERVED':
          case 'LISTING_REMOVED':
            detail =
              d.views === undefined
                ? null
                : t(e.type === 'LISTING_REMOVED' && e.provenance === 'INFERRED' ? 'timeline.removedInferred' : 'timeline.engagementDetail', { views: num(d.views), favorites: num(d.favorites) });
            break;
          case 'MARKET_ANALYZED':
            detail = t('timeline.analysisDetail', { quality: t(`compQuality.${String(d.quality)}`), n: num(d.n) });
            value = num(d.median) !== null ? money(num(d.median)) : null;
            break;
          case 'PREDICTION_MADE':
            detail = t('timeline.predictionDetail', { min: num(d.min), max: num(d.max) });
            break;
          case 'STATUS_CHANGED':
            detail = t('timeline.statusDetail', { a: t(`status.${String(d.from)}`), b: t(`status.${String(d.to)}`) });
            break;
          case 'PREDICTION_RESOLVED':
            detail = t('timeline.errorDetail', { pct: pct(num(d.error), { sign: true }) });
            break;
        }
        const ic = EV_ICON[e.type];
        return (
          <li key={e.id} className="tl" style={{ animationDelay: `${Math.min(i * 45, 700)}ms` }}>
            <span className="tl__date num">{date(e.at)}</span>
            <span className="tl__node">
              <IconTile name={ic.icon} tone={ic.tone} size="sm" />
            </span>
            <span>
              <span className="tl__title" style={{ display: 'block' }}>
                {t(`timeline.${e.type}`)}
              </span>
              {detail && <span className="tl__detail">{detail}</span>}
              <span className="tl__prov" style={{ display: 'block' }}>
                {t(`data.${provKey(e.provenance)}`)}
              </span>
              {e.type === 'LISTING_REPUBLISHED' && d.basis === 'TITLE' && !e.isDemo && <SplitRepost eventId={e.id} />}
            </span>
            <span className="tl__value num">{value}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** A repost recognised by its title only can be wrong (two units, one title): one click puts it apart. */
function SplitRepost({ eventId }: { eventId: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const [armed, setArmed] = useState(false);
  if (!armed)
    return (
      <Button size="sm" variant="ghost" onClick={() => setArmed(true)}>
        {t('timeline.splitAsk')}
      </Button>
    );
  return (
    <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
      <Button
        size="sm"
        variant="primary"
        onClick={async () => {
          const id = await repo.splitRepost(eventId);
          if (!id) return;
          toast('success', t('timeline.splitDone'), t('timeline.splitDoneHint'));
          go(`item/${id}`);
        }}
      >
        {t('timeline.splitConfirm')}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setArmed(false)}>
        {t('common.cancel')}
      </Button>
    </span>
  );
}

function provKey(p: DomainEvent['provenance']): string {
  return { USER_PROVIDED: 'userProvided', OBSERVED: 'observed', DERIVED: 'derived', INFERRED: 'inferred', PREDICTED: 'predicted', UNKNOWN: 'unknown' }[p];
}

/* ── Activation ──────────────────────────────────────────── */

export const ACTIVATION_STEPS: { name: ActivationEventName; href: string }[] = [
  { name: 'inventory_imported', href: 'onboarding' },
  { name: 'first_cost_entered', href: 'stock?filter=nocost' },
  { name: 'first_market_analysis', href: 'market' },
  { name: 'first_buy_analysis', href: 'buy' },
  { name: 'first_sale_tracked', href: 'stock' },
];

export function ActivationProgress({ done }: { done: Set<ActivationEventName> }) {
  const { t } = useI18n();
  const n = ACTIVATION_STEPS.filter((s) => done.has(s.name)).length;
  // Steps completed while this view is open get a short celebratory pop.
  const prev = useRef<Set<ActivationEventName> | null>(null);
  const [fresh, setFresh] = useState<Set<ActivationEventName>>(new Set());
  useEffect(() => {
    if (prev.current) {
      const f = new Set([...done].filter((d) => !prev.current!.has(d)));
      if (f.size) {
        setFresh(f);
        const id = setTimeout(() => setFresh(new Set()), 1600);
        prev.current = new Set(done);
        return () => clearTimeout(id);
      }
    }
    prev.current = new Set(done);
  }, [done]);
  return (
    <section className="card activation" aria-label={t('activation.title')}>
      <Ring value={n} max={ACTIVATION_STEPS.length} size={64}>
        <span className="num" style={{ fontWeight: 650, fontSize: 15 }}>
          {n}/{ACTIVATION_STEPS.length}
        </span>
      </Ring>
      <div>
        <div className="t-h3">{t('activation.title')}</div>
        <div className="activation__steps">
          {ACTIVATION_STEPS.map((s) => (
            <button key={s.name} type="button" className={`activation__step ${done.has(s.name) ? 'is-done' : ''} ${fresh.has(s.name) ? 'is-new' : ''}`} onClick={() => go(s.href)}>
              <span className="activation__check" aria-hidden="true">
                {done.has(s.name) && <Icon name="check" size={11} strokeWidth={3} />}
              </span>
              <span>{t(`activation.${s.name}`)}</span>
              <span className="sr-only">{done.has(s.name) ? '✓' : '○'}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
