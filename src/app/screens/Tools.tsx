import { useState } from 'react';
import { useI18n } from '@/i18n';
import { type IconName, IconTile, type TileTone } from '@/ui/components/icons';
import { Modal } from '@/ui/components/overlays';
import { Button, Field, Select } from '@/ui/components/primitives';
import { ListingAssistant, OfferCalculator, ShieldChecker, useBulkAnalyze } from '../components/tools';
import { PhotoCheck } from '../components/photo-check';
import { Replies } from '../components/replies';
import { go, useEra } from '../state';

type ToolKey = 'today' | 'bulk' | 'offer' | 'replies' | 'automations' | 'listing' | 'shield' | 'photo' | 'buy' | 'market' | 'capital' | 'learning' | 'niches' | 'timing' | 'import';

const TOOLS: { key: ToolKey; icon: IconName; tone: TileTone; href?: string }[] = [
  { key: 'today', icon: 'today', tone: 'violet', href: 'today' },
  { key: 'bulk', icon: 'market', tone: 'cobalt' },
  { key: 'offer', icon: 'scale', tone: 'amber' },
  { key: 'replies', icon: 'book', tone: 'cyan' },
  { key: 'automations', icon: 'repost', tone: 'coral', href: 'automations' },
  { key: 'listing', icon: 'edit', tone: 'pink' },
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
      <section className="tools-hero">
        <div>
          <span className="pill">{t('tools.eyebrow')}</span>
          <h1 className="tools-hero__title">
            {t('tools.headline')} <span className="t-accent">{t('tools.headlineItalic')}</span>
          </h1>
          <p className="t-muted" style={{ fontSize: 16, marginTop: 10, maxWidth: 560 }}>
            {t('tools.sub')}
          </p>
        </div>
        <Button variant="primary" size="lg" icon="market" loading={!!bulk.busy} disabled={bulk.pending === 0} onClick={() => bulk.run()}>
          {bulk.busy ? `${bulk.busy.done}/${bulk.busy.total}` : t('today.analyzeStock', { n: bulk.pending })}
        </Button>
      </section>
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
      <Modal open={open === 'shield'} onClose={() => setOpen(null)} title={t('tools.t.shield.0')}>
        <ShieldChecker />
      </Modal>
    </>
  );
}
