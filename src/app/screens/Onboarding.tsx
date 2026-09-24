import { useState } from 'react';
import { MarketplaceError } from '@/data/adapters/marketplace';
import { importFromVinted } from '@/data/vinted-import';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import { Icon, IconTile } from '@/ui/components/icons';
import { IllustrationAnalysis, IllustrationBuy, IllustrationDone, IllustrationStock, IllustrationWelcome } from '@/ui/components/illustrations';
import { LogoMark } from '@/ui/components/Logo';
import { useToast } from '@/ui/components/overlays';
import { Button, DemoBadge } from '@/ui/components/primitives';
import { AddItemDrawer, ImportCsvModal } from '../components/forms';
import { go } from '../state';

const ART = [IllustrationWelcome, IllustrationStock, IllustrationAnalysis, IllustrationBuy, IllustrationDone];

export function Onboarding() {
  const { t } = useI18n();
  const toast = useToast();
  const [step, setStep] = useState(() => {
    try {
      return Number(localStorage.getItem('era.onb.step') ?? 0) || 0;
    } catch {
      return 0;
    }
  });
  const [csv, setCsv] = useState(false);
  const [add, setAdd] = useState(false);
  const [busy, setBusy] = useState<'demo' | 'vinted' | null>(null);
  const total = 5;
  const setS = (n: number) => {
    setStep(n);
    try {
      localStorage.setItem('era.onb.step', String(n)); // resumable
    } catch {
      /* ignore */
    }
  };
  const finish = async () => {
    await repo.setSetting('onboardingDone', true);
    setS(0);
    go('today');
  };
  const Art = ART[step]!;

  const loadDemo = async () => {
    setBusy('demo');
    await repo.loadDemo();
    await repo.track('inventory_imported');
    setBusy(null);
    toast('success', t('onboarding.loaded'), t('app.demoBanner'));
    setS(2);
  };
  const fromVinted = async () => {
    setBusy('vinted');
    try {
      const r = await importFromVinted();
      toast('success', t('vinted.imported', { n: r.items, sales: r.sales }));
      setS(2);
    } catch (e) {
      const code = e instanceof MarketplaceError ? (e.message === 'NO_VINTED_TAB' ? 'NO_VINTED_TAB' : e.code) : 'UNAVAILABLE';
      toast('error', t(`errors.${code}`), t('errors.keepLocal'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="onb">
      <div className="era-backdrop" aria-hidden="true" />
      <div className="onb__card" role="dialog" aria-labelledby="onb-title" aria-describedby="onb-body">
        <div className="onb__art" key={step} style={{ animation: 'fade var(--t-slow) var(--ease) both' }}>
          <Art />
        </div>
        <div className="onb__body">
          <div className="row-between">
            <span className="row" style={{ gap: 10 }}>
              <LogoMark size={26} />
              <span className="t-caption">{t('onboarding.step', { n: step + 1, total })}</span>
            </span>
            <Button variant="ghost" size="sm" onClick={finish}>
              {t('onboarding.skip')}
            </Button>
          </div>
          <div className="onb__dots" aria-hidden="true">
            {Array.from({ length: total }, (_, k) => (
              <span key={k} className={`onb__dot ${k <= step ? 'is-on' : ''}`} />
            ))}
          </div>
          <div key={step} className="stack-3" style={{ animation: 'rise var(--t-slow) var(--ease) both' }}>
            {step === 0 && (
              <p className="t-display" style={{ fontSize: 38 }}>
                {t('app.tagline')}
                <br />
                <span className="t-serif" style={{ fontSize: 42, background: 'var(--brand-grad)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>
                  {t('app.taglineItalic')}
                </span>
              </p>
            )}
            <h1 className="t-h1" id="onb-title">
              {t(`onboarding.s${step + 1}Title`)}
            </h1>
            <p className="t-muted" id="onb-body" style={{ fontSize: 15 }}>
              {t(`onboarding.s${step + 1}Body`)}
            </p>
            {step === 1 && (
              <div className="onb__choices">
                <button type="button" className="choice" onClick={fromVinted} disabled={busy !== null}>
                  <IconTile name="repost" tone="cobalt" />
                  <span className="grow">
                    <b>{t('vinted.import')}</b>
                    <span className="t-small t-faint" style={{ display: 'block' }}>
                      {t('vinted.importHint')}
                    </span>
                  </span>
                  {busy === 'vinted' ? <span className="btn__spinner" /> : <Icon name="chevronRight" size={16} />}
                </button>
                <button type="button" className="choice" onClick={() => setCsv(true)}>
                  <IconTile name="upload" tone="violet" />
                  <span className="grow">
                    <b>{t('onboarding.s2Csv')}</b>
                  </span>
                  <Icon name="chevronRight" size={16} />
                </button>
                <button type="button" className="choice" onClick={() => setAdd(true)}>
                  <IconTile name="plus" tone="emerald" />
                  <span className="grow">
                    <b>{t('onboarding.s2Manual')}</b>
                  </span>
                  <Icon name="chevronRight" size={16} />
                </button>
                <button type="button" className="choice" onClick={loadDemo} disabled={busy !== null}>
                  <IconTile name="layers" tone="amber" />
                  <span className="grow">
                    <b>{t('onboarding.s2Demo')}</b> <DemoBadge />
                    <span className="t-small t-faint" style={{ display: 'block' }}>
                      {t('onboarding.s2DemoHint')}
                    </span>
                  </span>
                  {busy === 'demo' ? <span className="btn__spinner" /> : <Icon name="chevronRight" size={16} />}
                </button>
              </div>
            )}
          </div>
          <div className="row" style={{ marginTop: 'auto', paddingTop: 16 }}>
            {step > 0 && (
              <Button variant="ghost" icon="chevronLeft" onClick={() => setS(step - 1)}>
                {t('onboarding.back')}
              </Button>
            )}
            <span className="grow" />
            {step < total - 1 ? (
              <Button variant="primary" iconRight="chevronRight" onClick={() => setS(step + 1)}>
                {t('onboarding.next')}
              </Button>
            ) : (
              <Button variant="primary" iconRight="chevronRight" onClick={finish}>
                {t('onboarding.finish')}
              </Button>
            )}
          </div>
        </div>
      </div>
      <ImportCsvModal
        open={csv}
        onClose={() => {
          setCsv(false);
          setS(2);
        }}
      />
      <AddItemDrawer open={add} onClose={() => setAdd(false)} />
    </div>
  );
}
