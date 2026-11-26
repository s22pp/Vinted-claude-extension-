import { Suspense, lazy, useState } from 'react';
import { useI18n } from '@/i18n';
import { type IconName, IconTile, type TileTone } from '@/ui/components/icons';
import { Modal } from '@/ui/components/overlays';
import { Button, Field, Select } from '@/ui/components/primitives';
import { ListingAssistant, OfferCalculator, ShieldChecker, useBulkAnalyze } from '../components/tools';
import { PhotoCheck } from '../components/photo-check';
import { Replies } from '../components/replies';
import { TextSeries } from '../components/text-series';
import { CashNudges } from '../components/cash-nudge';
import { ListingGenerator } from '../components/listing-gen';
import { SourcingSimulator } from '../components/sourcing-sim';
import { go, useEra } from '../state';
import { PageHead } from '../Shell';

// The photo studio (canvas, image decoding) is its own chunk, loaded when the Outils page asks for it.
const PhotoStudio = lazy(() => import('../components/photo-studio').then((m) => ({ default: m.PhotoStudio })));

type ToolKey = 'today' | 'bulk' | 'offer' | 'replies' | 'automations' | 'listing' | 'series' | 'shield' | 'photo' | 'buy' | 'market' | 'capital' | 'learning' | 'niches' | 'timing' | 'import';

const TOOLS: { key: ToolKey; icon: IconName; tone: TileTone; href?: string }[] = [
  { key: 'today', icon: 'today', tone: 'violet', href: 'today' },
  { key: 'bulk', icon: 'market', tone: 'cobalt' },
  { key: 'offer', icon: 'scale', tone: 'amber' },
  { key: 'replies', icon: 'book', tone: 'cyan' },
  { key: 'automations', icon: 'repost', tone: 'coral', href: 'automations' },
  { key: 'listing', icon: 'edit', tone: 'pink' },
  { key: 'series', icon: 'edit', tone: 'cobalt' },
  { key: 'shield', icon: 'alert', tone: 'coral' },
  { key: 'photo', icon: 'eye', tone: 'cyan' },
  { key: 'buy', icon: 'buy', tone: 'violet', href: 'buy' },
  { key: 'market', icon: 'target', tone: 'cyan', href: 'market' },
  { key: 'capital', icon: 'trap', tone: 'amber', href: 'capital' },
  { key: 'learning', icon: 'scale', tone: 'pink', href: 'insights' },
  { key: 'niches', icon: 'trendUp', tone: 'emerald', href: 'insights' },
  { key: 'timing', icon: 'calendar', tone: 'cyan', href: 'insights' },
  { key: 'import', icon: 'repost', tone: 'cobalt', href: 'settings' },
];

export function Tools() {
  const { t } = useI18n();
  const era = useEra();
  const bulk = useBulkAnalyze();
  const [open, setOpen] = useState<ToolKey | null>(null);
  const listed = era.intel.filter((i) => i.view.current);
  const [itemId, setItemId] = useState<string>(listed[0]?.view.item.id ?? '');
  const intel = era.intelById.get(itemId) ?? null;

  const picker = (
    <Field label={t('offer.pick')} htmlFor="tool-item">
      <Select id="tool-item" value={itemId} onChange={(e) => setItemId(e.target.value)} options={listed.map((i) => ({ value: i.view.item.id, label: i.view.item.title }))} />
    </Field>
  );

  return (
    <>
      <PageHead
        title={t('tools.title')}
        sub={t('tools.sub')}
        actions={
          <Button variant="primary" icon="market" loading={!!bulk.busy} disabled={bulk.pending === 0} onClick={() => bulk.run()}>
            {bulk.busy ? `${bulk.busy.done}/${bulk.busy.total}` : t('today.analyzeStock', { n: bulk.pending })}
          </Button>
        }
      />
      <section className="hub" aria-label={t('hub.label')}>
        <HubPanel n="01" id="hub-generator" title={t('hub.gen.title')} sub={t('hub.gen.sub')}>
          <ListingGenerator />
        </HubPanel>
        <HubPanel n="02" id="hub-sourcing" title={t('hub.sim.title')} sub={t('hub.sim.sub')}>
          <SourcingSimulator />
        </HubPanel>
        <HubPanel n="03" id="hub-studio" title={t('hub.studio.title')} sub={t('hub.studio.sub')}>
          <Suspense fallback={<div className="skeleton" style={{ height: 160 }} aria-label={t('common.loading')} />}>
            <PhotoStudio />
          </Suspense>
        </HubPanel>
        <HubPanel n="04" id="hub-replies" title={t('hub.replies.title')} sub={t('hub.replies.sub')}>
          {listed.length > 0 ? (
            <>
              <Field label={t('offer.pick')} htmlFor="hub-reply-item">
                <Select id="hub-reply-item" value={itemId} onChange={(e) => setItemId(e.target.value)} options={listed.map((i) => ({ value: i.view.item.id, label: i.view.item.title }))} />
              </Field>
              {intel && <Replies key={`hub-${itemId}`} intel={intel} />}
            </>
          ) : (
            <p className="t-small t-faint">{t('hub.replies.none')}</p>
          )}
          <h3 className="hub__sub-head">{t('nudge.title')}</h3>
          <CashNudges />
        </HubPanel>
      </section>

      <h2 className="hub__all">{t('hub.all')}</h2>
      <div className="tools-grid">
        {TOOLS.map((tool, k) => (
          <button
            key={tool.key}
            type="button"
            className="tool"
            style={{ animationDelay: `${k * 35}ms` }}
            onClick={() => {
              if (tool.key === 'bulk') return void bulk.run();
              if (tool.href) return go(tool.href);
              setOpen(tool.key);
            }}
          >
            <IconTile name={tool.icon} tone={tool.tone} size="lg" />
            <span className="tool__title">{t(`tools.t.${tool.key}.0`)}</span>
            <span className="tool__sub">{t(`tools.t.${tool.key}.1`)}</span>
          </button>
        ))}
      </div>
      <section className="not-included" aria-labelledby="ni-h">
        <h2 className="t-h3" id="ni-h">
          {t('tools.notIncluded')}
        </h2>
        <p className="t-small t-muted" style={{ marginTop: 4 }}>
          {t('tools.notIncludedWhy')}
        </p>
        <ul className="stack t-small t-muted" style={{ marginTop: 12, paddingLeft: 18 }}>
          <li>{t('tools.ni.photos')}</li>
          <li>{t('tools.ni.automation')}</li>
          <li>{t('tools.ni.bypass')}</li>
          <li>{t('tools.ni.chained')}</li>
        </ul>
      </section>

      <Modal open={open === 'offer'} onClose={() => setOpen(null)} title={t('offer.title')}>
        {picker}
        {intel && <OfferCalculator key={itemId} intel={intel} />}
      </Modal>
      <Modal open={open === 'replies'} onClose={() => setOpen(null)} title={t('replies.title')}>
        {picker}
        {intel && <Replies key={itemId} intel={intel} />}
      </Modal>
      <Modal open={open === 'listing'} onClose={() => setOpen(null)} title={t('listing.title')}>
        {picker}
        {intel && <ListingAssistant intel={intel} />}
      </Modal>
      <Modal open={open === 'photo'} onClose={() => setOpen(null)} title={t('tools.t.photo.0')}>
        <PhotoCheck />
      </Modal>
      <Modal open={open === 'series'} onClose={() => setOpen(null)} title={t('tools.t.series.0')}>
        <TextSeries />
      </Modal>
      <Modal open={open === 'shield'} onClose={() => setOpen(null)} title={t('tools.t.shield.0')}>
        <ShieldChecker />
      </Modal>
    </>
  );
}

/** One tool of the hub: its number and name in the Locomotive way (mono caps over a serif title), then the tool itself. */
function HubPanel({ n, id, title, sub, children }: { n: string; id: string; title: string; sub: string; children: React.ReactNode }) {
  return (
    <section className="hub__panel" id={id} aria-labelledby={`${id}-h`}>
      <p className="hub__num">{n}</p>
      <h2 className="hub__title" id={`${id}-h`}>
        {title}
      </h2>
      <p className="hub__lede">{sub}</p>
      <div className="hub__body">{children}</div>
    </section>
  );
}
