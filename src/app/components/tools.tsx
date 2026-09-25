import { useState } from 'react';
import { errorCode } from '@/data/adapters/marketplace';
import { useI18n } from '@/i18n';
import type { ItemIntel } from '@/intelligence/decision';
import { buildDescription, buildTitle, type ShieldIssue, shieldCheck, skuOf, titleIssues } from '@/intelligence/listing';
import { evaluateOffer, offerLadder } from '@/intelligence/offer';
import { stagnationThreshold } from '@/intelligence/stagnation';
import { Icon } from '@/ui/components/icons';
import { useErrorToast, useToast } from '@/ui/components/overlays';
import { Badge, Button, Field, Input, Money } from '@/ui/components/primitives';
import { analyzeItem } from '../market-run';
import { useEra } from '../state';
import { useMoneyField } from './forms';

/* ── Offer calculator ─────────────────────────────────────── */

export function OfferCalculator({ intel, compact }: { intel: ItemIntel; compact?: boolean }) {
  const { t, money, pct } = useI18n();
  const era = useEra();
  const offer = useMoneyField(null);
  const v = intel.view;
  if (v.askPrice === null) return null;
  const ctx = {
    ask: v.askPrice,
    cost: v.cost,
    pricing: intel.pricing,
    daysListed: intel.stagnation?.daysListed ?? v.daysListed,
    favorites: v.current?.favorites ?? null,
    thresholdDays: stagnationThreshold(era.model),
  };
  const ladder = offerLadder(ctx);
  const decision = offer.cents !== null && !offer.invalid ? evaluateOffer(offer.cents, ctx) : null;
  const tone = decision?.verdict === 'ACCEPT' ? 'emerald' : decision?.verdict === 'COUNTER' ? 'amber' : 'coral';

  return (
    <div className="stack-3">
      {/* The ladder: readable at a glance, before any offer arrives. */}
      <div className="offer-ladder" role="img" aria-label={`${t('offer.acceptFrom')} ${money(ladder.acceptFrom)}, ${t('offer.floor')} ${money(ladder.floor)}`}>
        <div className="offer-ladder__seg offer-ladder__seg--no" style={{ flex: Math.max(1, ladder.floor / ladder.ask) }}>
          <span>{t('offer.declineBelow')}</span>
          <b className="num">{money(ladder.floor)}</b>
        </div>
        <div className="offer-ladder__seg offer-ladder__seg--counter" style={{ flex: Math.max(0.6, (ladder.acceptFrom - ladder.floor) / ladder.ask * 4) }}>
          <span>{t('offer.counterZone')}</span>
        </div>
        <div className="offer-ladder__seg offer-ladder__seg--yes" style={{ flex: Math.max(0.8, (ladder.ask - ladder.acceptFrom) / ladder.ask * 4) }}>
          <span>{t('offer.acceptFrom')}</span>
          <b className="num">{money(ladder.acceptFrom)}</b>
        </div>
      </div>
      <p className="t-small t-faint">{t(`offer.basis.${ladder.floorBasis}`)}</p>
      <div className="row" style={{ alignItems: 'flex-end', gap: 12 }}>
        <Field label={t('offer.received')} htmlFor={`offer-${v.item.id}`} error={offer.invalid ? t('add.invalidAmount') : null}>
          <Input id={`offer-${v.item.id}`} money value={offer.raw} onChange={(e) => offer.setRaw(e.target.value)} placeholder={String(Math.round(ladder.floor / 100))} style={{ width: compact ? 110 : 140 }} />
        </Field>
        {decision && (
          <div className="grow" aria-live="polite" style={{ animation: 'reveal var(--t-normal) var(--ease) both' }}>
            <Badge tone={tone}>{t(`offer.verdict.${decision.verdict}`, { price: decision.counter })}</Badge>
            <p className="t-small t-muted" style={{ marginTop: 4 }}>
              {t(`offer.reason.${decision.reason}`)}
            </p>
          </div>
        )}
      </div>
      {decision && (
        <div className="row t-small" style={{ gap: 16 }}>
          <span className="t-muted">{t('offer.profitAt')}</span>
          <Money cents={decision.profit} sign unknownLabel={t('data.notProvided')} />
          {decision.roi !== null && <span className="num t-faint">ROI {pct(decision.roi)}</span>}
        </div>
      )}
    </div>
  );
}

/* ── Listing assistant ────────────────────────────────────── */

export function CopyButton({ text }: { text: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      icon={done ? 'check' : 'layers'}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      {done ? t('listing.copied') : t('listing.copy')}
    </Button>
  );
}

export function ShieldIssues({ issues }: { issues: ShieldIssue[] }) {
  const { t } = useI18n();
  if (issues.length === 0)
    return (
      <p className="row t-small" style={{ color: 'var(--emerald)', gap: 6 }}>
        <Icon name="check" size={14} strokeWidth={2.4} /> {t('listing.ok')}
      </p>
    );
  return (
    <ul className="stack" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
      {issues.map((i, k) => (
        <li key={k} className="row t-small" style={{ alignItems: 'flex-start', gap: 8 }}>
          <Badge tone={i.severity === 'block' ? 'coral' : i.severity === 'warn' ? 'amber' : 'cyan'}>{i.severity === 'block' ? '!' : i.severity === 'warn' ? '~' : 'i'}</Badge>
          <span>{t(`listing.issue.${i.code}`, { match: i.match })}</span>
        </li>
      ))}
    </ul>
  );
}

export function ListingAssistant({ intel }: { intel: ItemIntel }) {
  const { t } = useI18n();
  const item = intel.view.item;
  const title = buildTitle(item);
  const description = buildDescription(item);
  const current = intel.view.current?.title ?? item.title;
  const issues = titleIssues(current, item.brand);
  return (
    <div className="stack-3">
      <div className="stack" style={{ gap: 6 }}>
        <div className="row-between">
          <span className="field__label">{t('listing.titleLabel')}</span>
          <CopyButton text={title} />
        </div>
        <code className="listing-box">{title}</code>
        <p className="t-small t-faint">{t('listing.sku', { sku: skuOf(item.id) })}</p>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <div className="row-between">
          <span className="field__label">{t('listing.descLabel')}</span>
          <CopyButton text={description} />
        </div>
        <pre className="listing-box">{description}</pre>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <span className="field__label">
          {t('listing.shield')} · <span className="t-faint">« {current} »</span>
        </span>
        <ShieldIssues issues={issues} />
      </div>
    </div>
  );
}

export function ShieldChecker() {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [brand, setBrand] = useState('');
  const issues = text.trim() ? shieldCheck(text, brand.trim() || null) : [];
  return (
    <div className="stack-3">
      <div className="grid" style={{ gridTemplateColumns: '1fr 180px', gap: 12 }}>
        <Field label={t('listing.shieldHint')} htmlFor="shield-text">
          <textarea id="shield-text" className="input" rows={3} style={{ height: 'auto', padding: 10, resize: 'vertical' }} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('listing.placeholder')} />
        </Field>
        <Field label={t('buy.fBrand')} htmlFor="shield-brand" optional>
          <Input id="shield-brand" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Marlboro" />
        </Field>
      </div>
      {text.trim() && <ShieldIssues issues={issues} />}
    </div>
  );
}

/* ── Bulk analysis ────────────────────────────────────────── */

export function useBulkAnalyze() {
  const { t } = useI18n();
  const era = useEra();
  const toast = useToast();
  const errorToast = useErrorToast();
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const pending = era.intel.filter((i) => i.view.current && (!i.analysis || i.analysisStale));
  const run = async (ids?: string[]) => {
    const targets = (ids ? era.intel.filter((i) => ids.includes(i.view.item.id)) : pending).slice(0, era.mode === 'demo' ? 500 : 10);
    setBusy({ done: 0, total: targets.length });
    let n = 0;
    try {
      for (const i of targets) {
        await analyzeItem(i.view, era.mode, era.model, era.learning, undefined, true);
        n++;
        setBusy({ done: n, total: targets.length });
      }
      toast('success', t('bulk.done', { n }));
    } catch (e) {
      const code = errorCode(e);
      errorToast(e);
    } finally {
      setBusy(null);
    }
  };
  return { pending: pending.length, busy, run };
}
