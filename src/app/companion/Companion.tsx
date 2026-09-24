import { useCallback, useEffect, useState } from 'react';
import { errorCode } from '@/data/adapters/marketplace';
import type { PageItem } from '@/data/adapters/vinted/parse';
import { readPageContext } from '@/data/adapters/vinted/vinted-adapter';
import { db } from '@/data/db';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import { type BuyAnalysis, analyzeBuy, buySubject } from '@/intelligence/buy';
import { categoriesInTitle, normalizeText } from '@/intelligence/normalize';
import { personalEvidence } from '@/intelligence/seller-model';
import { Ring } from '@/ui/charts/charts';
import { Icon, IconTile } from '@/ui/components/icons';
import { LogoMark } from '@/ui/components/Logo';
import { Badge, Button, DemoBadge, ErrorState, Money, Sample, Stages } from '@/ui/components/primitives';
import { Thumb } from '@/ui/components/Thumb';
import { RecoChip, RecommendationCard, StatusBadge } from '../components/domain';
import { OfferCalculator } from '../components/tools';
import { VintedImportButton } from '../components/vinted-import';
import { marketAdapter } from '../market-run';
import { vintedLandedCost } from '../screens/Buy';
import { useEra } from '../state';

type Ctx = { status: 'loading' } | { status: 'none' } | { status: 'page'; isItemPage: boolean; item: PageItem | null; tabId: number };

/** The page the user is looking at: the active tab, or the most recent vinted.fr tab when ERA itself is focused. */
function usePageContext(): [Ctx, () => void] {
  const [ctx, setCtx] = useState<Ctx>({ status: 'loading' });
  const load = useCallback(async () => {
    try {
      const [active] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
      let tab = active;
      if (!tab?.url?.startsWith('https://www.vinted.fr/')) {
        const vinted = await browser.tabs.query({ url: 'https://www.vinted.fr/*' });
        tab = vinted.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0] ?? tab;
      }
      if (!tab?.id || !tab.url?.startsWith('https://www.vinted.fr/')) return setCtx({ status: 'none' });
      const page = await readPageContext(tab.id);
      setCtx(page ? { status: 'page', isItemPage: page.isItemPage, item: page.item, tabId: tab.id } : { status: 'none' });
    } catch {
      setCtx({ status: 'none' });
    }
  }, []);
  useEffect(() => {
    void load();
    const on = () => void load();
    browser.tabs.onActivated.addListener(on);
    const onUpd = (_id: number, info: { status?: string }) => info.status === 'complete' && on();
    browser.tabs.onUpdated.addListener(onUpd);
    return () => {
      browser.tabs.onActivated.removeListener(on);
      browser.tabs.onUpdated.removeListener(onUpd);
    };
  }, [load]);
  return [ctx, load];
}

function openDashboard(hash = 'today') {
  void browser.tabs.create({ url: `${browser.runtime.getURL('/dashboard.html')}#/${hash}` });
}

export function Companion({ mode }: { mode: 'popup' | 'panel' }) {
  const { t } = useI18n();
  const era = useEra();
  const [ctx] = usePageContext();
  const [ownItemId, setOwnItemId] = useState<string | null>(null);

  useEffect(() => {
    if (ctx.status !== 'page' || !ctx.item?.platformListingId) return setOwnItemId(null);
    const pid = ctx.item.platformListingId;
    void db.listings
      .filter((l) => l.platformListingId === pid)
      .first()
      .then((l) => setOwnItemId(l?.inventoryItemId ?? null));
  }, [ctx]);

  const own = ownItemId ? (era.intelById.get(ownItemId) ?? null) : null;
  const urgent = era.priorities.filter((p) => p.tone === 'risk' || p.tone === 'warning');

  return (
    <div className={`compact-app ${mode === 'popup' ? 'popup' : ''}`}>
      <header className="row-between">
        <span className="row" style={{ gap: 10 }}>
          <LogoMark size={28} />
          <span style={{ lineHeight: 1.1 }}>
            <span className="sidebar__brand-name" style={{ display: 'block' }}>
              ERA
            </span>
            <span className="t-faint" style={{ fontSize: 11 }}>
              {era.mode === 'empty' ? t('data.stateEmpty') : t('data.stateLocal', { n: era.views.filter((v) => v.inStock).length })}
            </span>
          </span>
        </span>
        <span className="row" style={{ gap: 6 }}>
          {era.mode === 'demo' && <DemoBadge />}
          {era.mode === 'real' && <VintedImportButton size="sm" label="short" />}
          <button type="button" className="icon-btn" aria-label={t('app.openEra')} onClick={() => openDashboard()}>
            <Icon name="external" size={16} />
          </button>
        </span>
      </header>

      {era.mode !== 'real' && (
        <section className="card" style={{ padding: 14 }}>
          <p className="t-small t-muted" style={{ marginBottom: 10 }}>
            {era.mode === 'demo' ? t('vinted.replaceDemo') : t('vinted.importHint')}
          </p>
          <VintedImportButton variant="primary" block />
        </section>
      )}

      <section className="card" style={{ padding: 14 }} aria-label={t('popup.context')}>
        <div className="t-caption" style={{ marginBottom: 8 }}>
          {t('popup.context')}
        </div>
        {ctx.status === 'loading' ? (
          <span className="skeleton" style={{ display: 'block', height: 44 }} />
        ) : ctx.status === 'none' ? (
          <p className="t-small t-muted row" style={{ gap: 8, alignItems: 'flex-start' }}>
            <Icon name="info" size={15} /> {t('popup.noContext')}
          </p>
        ) : !ctx.item ? (
          <p className="t-small t-muted">{t('popup.notRecognized')}</p>
        ) : (
          <div className="stack-3">
            <div className="row" style={{ gap: 10 }}>
              <Thumb photoUrl={ctx.item.photoUrl} category={categoriesInTitle(normalizeText(ctx.item.title))[0] ?? 'OTHER'} alt={ctx.item.title} />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="clamp-1" style={{ fontWeight: 600 }}>
                  {ctx.item.title}
                </div>
                <div className="t-small t-muted">
                  {ctx.item.brand ?? '—'} · <Money cents={ctx.item.priceCents} />
                </div>
              </div>
            </div>
            {own ? <OwnItem mode={mode} itemId={own.view.item.id} /> : <BuyQuick mode={mode} item={ctx.item} />}
          </div>
        )}
      </section>

      {!own && era.mode !== 'empty' && (
        <section className="card" style={{ padding: 14 }}>
          <div className="row-between" style={{ marginBottom: 8 }}>
            <span className="t-caption">{t('today.priorities')}</span>
            <span className="t-small t-faint">{urgent.length ? t('popup.attention', { n: urgent.length }) : t('popup.allGood')}</span>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            {era.priorities.slice(0, mode === 'popup' ? 3 : 6).map((p) => (
              <button key={p.code} type="button" className="choice" style={{ padding: '8px 10px' }} onClick={() => openDashboard('today')}>
                <IconTile name={p.tone === 'risk' ? 'hourglass' : p.tone === 'positive' ? 'trendUp' : p.tone === 'info' ? 'info' : 'capital'} tone={p.tone === 'risk' ? 'coral' : p.tone === 'positive' ? 'emerald' : p.tone === 'info' ? 'cyan' : 'amber'} size="sm" />
                <span className="t-small grow">
                  {p.code === 'CAPITAL_AGED'
                    ? t('today.P_CAPITAL_AGED', { amount: p.amount && p.amount.status !== 'unknown' ? p.amount.value : null })
                    : p.code === 'NICHE'
                      ? t('today.P_NICHE', { label: p.label ?? '' })
                      : t(`today.P_${p.code}`, { n: p.count })}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      <footer className="row" style={{ gap: 8 }}>
        <Button variant="primary" block icon="today" onClick={() => openDashboard()}>
          {t('app.openEra')}
        </Button>
        {mode === 'popup' && (
          <Button
            icon="panel"
            onClick={async () => {
              const win = await browser.windows.getCurrent();
              await browser.sidePanel?.open?.({ windowId: win.id! });
              window.close();
            }}
          >
            {t('popup.openPanel')}
          </Button>
        )}
      </footer>
    </div>
  );
}

function OwnItem({ itemId, mode }: { itemId: string; mode: 'popup' | 'panel' }) {
  const { t } = useI18n();
  const era = useEra();
  const intel = era.intelById.get(itemId);
  if (!intel) return null;
  return (
    <div className="stack-3">
      <div className="row-between">
        <span className="row" style={{ gap: 6 }}>
          <Badge tone="violet">{t('popup.inStock')}</Badge>
          <StatusBadge status={intel.view.item.status} />
        </span>
        <RecoChip r={intel.recommendation} />
      </div>
      {mode === 'panel' && intel.recommendation && <RecommendationCard r={intel.recommendation} compact />}
      {intel.view.askPrice !== null && <OfferCalculator intel={intel} compact />}
      <Button size="sm" variant="ghost" iconRight="chevronRight" onClick={() => openDashboard(`item/${itemId}`)}>
        {t('item.overview')}
      </Button>
    </div>
  );
}

type Stage = 'COLLECTING' | 'COMPARING' | 'READY';

function BuyQuick({ item, mode }: { item: PageItem; mode: 'popup' | 'panel' }) {
  const { t, money, pct } = useI18n();
  const era = useEra();
  const [stage, setStage] = useState<Stage | null>(null);
  const [res, setRes] = useState<BuyAnalysis | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const brand = item.brand ?? '';
  const category = categoriesInTitle(normalizeText(item.title))[0] ?? 'OTHER';
  // Buying on Vinted: the listed price plus buyer protection is the real cost (shipping not included).
  const cost = item.priceCents === null ? null : vintedLandedCost(item.priceCents, null);

  const run = async () => {
    if (cost === null || !brand) return;
    setErr(null);
    try {
      const input = { title: item.title, brand, model: null, category, gender: null, size: null, condition: item.condition, purchasePriceCents: cost, url: item.url };
      const analysis = await repo.analyzeMarket(marketAdapter(era.mode, false), buySubject(input), null, setStage);
      const personal = personalEvidence(era.model, { brand, model: null, category });
      setRes(analyzeBuy(input, analysis, era.model, personal, era.learning.priceCorrection));
      await repo.track('first_buy_analysis');
    } catch (e) {
      setStage(null);
      setErr(e);
    }
  };

  const prefill = `buy?title=${encodeURIComponent(item.title)}&brand=${encodeURIComponent(brand)}&category=${category}&price=${item.priceCents ?? ''}&vinted=1`;

  if (!res) {
    return (
      <div className="stack">
        {cost !== null && (
          <p className="t-small t-muted">
            {t('buy.landedCost')} <b className="num">{money(cost)}</b> <span className="t-faint">({t('panel.noShipping')})</span>
          </p>
        )}
        <div className="row" style={{ gap: 8 }}>
          <Button size="sm" variant="primary" icon="target" disabled={!brand || cost === null} loading={stage !== null && stage !== 'READY'} onClick={run}>
            {t('panel.analyze')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => openDashboard(prefill)}>
            {t('buy.title')}
          </Button>
        </div>
        {stage && <Stages stages={['COLLECTING', 'COMPARING', 'READY'] as Stage[]} current={stage} labelKey={(s) => t(`buy.stage${s}`)} />}
        {err != null && <ErrorState error={err} />}
      </div>
    );
  }

  const bal = res.pricing.options.find((o) => o.strategy === 'BALANCED');
  const fast = res.pricing.options.find((o) => o.strategy === 'FAST');
  return (
    <div className="stack-3" style={{ animation: 'reveal var(--t-slow) var(--ease) both' }}>
      <div className="row" style={{ gap: 14 }}>
        {res.dealScore && (
          <Ring value={res.dealScore.total} max={100} size={mode === 'popup' ? 64 : 76} stroke={7}>
            <span className="num" style={{ fontWeight: 700, fontSize: 18 }}>
              {res.dealScore.total}
            </span>
          </Ring>
        )}
        <div>
          <div className="t-h3">{t(`buy.verdict.${res.verdict}`)}</div>
          <div className="t-small t-muted">{t(`buy.verdictHint.${res.verdict}`, { price: res.maxBuyCents })}</div>
        </div>
      </div>
      <dl className="reco__grid" style={{ margin: 0, gridTemplateColumns: '1fr auto', rowGap: 6 }}>
        <dt className="t-small t-muted">{t('panel.comparableRange')}</dt>
        <dd className="num" style={{ margin: 0, textAlign: 'right' }}>
          {fast && bal ? `${money(fast.range.min)} – ${money(bal.range.max)}` : '—'}
        </dd>
        <dt className="t-small t-muted">{t('panel.potentialProfit')}</dt>
        <dd className="num" style={{ margin: 0, textAlign: 'right' }}>
          {res.profit ? `${money(res.profit.min)} – ${money(res.profit.max)}` : '—'}
        </dd>
        <dt className="t-small t-muted">ROI</dt>
        <dd className="num" style={{ margin: 0, textAlign: 'right' }}>
          {res.roi ? `${pct(res.roi.min)} – ${pct(res.roi.max)}` : '—'}
        </dd>
        <dt className="t-small t-muted">{t('buy.maxBuy')}</dt>
        <dd className="num" style={{ margin: 0, textAlign: 'right', fontWeight: 600 }}>
          {money(res.maxBuyCents)}
        </dd>
        <dt className="t-small t-muted">{t('market.quality')}</dt>
        <dd style={{ margin: 0, textAlign: 'right' }}>
          {t(`compQuality.${res.analysis.quality}`)} · <Sample n={res.analysis.keptCount} />
        </dd>
      </dl>
      {res.analysis.source === 'DEMO' && (
        <p className="t-small row" style={{ gap: 6 }}>
          <DemoBadge /> <span className="t-faint">{t('market.sourceDEMO')}</span>
        </p>
      )}
    </div>
  );
}
