import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import type { BudgetStatus } from '@/data/adapters/vinted/protocol';
import { budgetStatus } from '@/data/adapters/vinted/vinted-adapter';
import { repo } from '@/data/repo';
import { type Locale, useI18n } from '@/i18n';
import { LogoMark } from '@/ui/components/Logo';
import { Modal, useToast } from '@/ui/components/overlays';
import { Button, Card, DemoBadge, Segmented } from '@/ui/components/primitives';
import { type MotionSetting, type ThemeSetting, setMotion, setTheme } from '../providers';
import { PageHead } from '../Shell';
import { VintedImportButton } from '../components/vinted-import';
import { BackupCard } from '../components/backup';
import { GeminiCard } from '../components/gemini';
import { RefreshSettings } from '../components/refresh-settings';
import { OverlaySettings, RepliesSettings } from '../components/overlay-settings';
import { DiagnosticCard, IntegrationsCard, SellerIdentityCard } from '../components/settings-cards';
import { go, useEra } from '../state';

export function Settings() {
  const i = useI18n();
  const { t } = i;
  const era = useEra();
  const toast = useToast();
  const theme = useLiveQuery(() => repo.getSetting<ThemeSetting>('theme', 'dark'), []) ?? 'dark';
  const motion = useLiveQuery(() => repo.getSetting<MotionSetting>('motion', 'system'), []) ?? 'system';
  const locale = useLiveQuery(() => repo.getSetting<Locale>('locale', 'fr'), []) ?? 'fr';
  const lastImport = useLiveQuery(() => repo.getSetting<number | null>('lastVintedImport', null), []);
  const wardrobeKeys = useLiveQuery(() => repo.getSetting<string[] | null>('vintedWardrobeKeys', null), []);
  const purchasesError = useLiveQuery(() => repo.getSetting<string | null>('purchasesError', null), []);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [budget, setBudget] = useState<BudgetStatus | null>(null);
  useEffect(() => {
    void budgetStatus().then(setBudget);
  }, [busy]);
  // Calls made elsewhere (a check, a search, the scheduled refresh) move the budget too: follow it.
  useEffect(() => {
    const onChange = (changes: Record<string, unknown>, area: string) => {
      if (area === 'session' && 'eraBudget' in changes) void budgetStatus().then(setBudget);
    };
    browser.storage.onChanged.addListener(onChange);
    return () => browser.storage.onChanged.removeListener(onChange);
  }, []);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHead title={t('settings.title')} />
      <div className="grid-12">
        {/* Yours: look, language, your data and identity, the app itself. */}
        <div className="span-6 stack-4">
          <Card title={t('settings.theme')} icon="sun" tone="violet">
            <Segmented
              label={t('settings.theme')}
              value={theme}
              onChange={(v) => void setTheme(v)}
              options={[
                { value: 'dark', label: t('settings.themeDark') },
                { value: 'light', label: t('settings.themeLight') },
                { value: 'system', label: t('settings.themeSystem') },
              ]}
            />
            <div className="stack" style={{ gap: 8, marginTop: 16, alignItems: 'flex-start' }}>
              <span className="t-small">{t('settings.motion')}</span>
              <Segmented
                label={t('settings.motion')}
                value={motion}
                onChange={(v) => void setMotion(v)}
                options={[
                  { value: 'system', label: t('settings.motionSystem') },
                  { value: 'reduced', label: t('settings.motionReduced') },
                ]}
              />
              <p className="t-small t-faint">{t('settings.motionHint')}</p>
            </div>
          </Card>
          <Card title={t('settings.language')} icon="book" tone="cyan">
            <Segmented
              label={t('settings.language')}
              value={locale}
              onChange={(v) => void repo.setSetting('locale', v)}
              options={[
                { value: 'fr', label: 'Français' },
                { value: 'en', label: 'English' },
              ]}
            />
          </Card>
          <BackupCard />
          <SellerIdentityCard />
          <GeminiCard />
          <Card title={t('settings.data')} icon="stock" tone="amber">
            <p className="t-small t-muted" style={{ marginBottom: 14 }}>
              {t('settings.dataLocal')}
            </p>
            <div className="row wrap">
              {era.mode !== 'demo' ? (
                <Button icon="layers" loading={busy === 'demo'} disabled={era.mode === 'real'} onClick={() => run('demo', async () => { await repo.loadDemo(); toast('success', t('onboarding.loaded')); })}>
                  {t('settings.loadDemo')} <DemoBadge />
                </Button>
              ) : (
                <Button icon="x" loading={busy === 'clear'} onClick={() => run('clear', async () => { await repo.clearDemo(); toast('info', t('settings.clearDemo')); })}>
                  {t('settings.clearDemo')}
                </Button>
              )}
              <Button variant="danger" icon="alert" onClick={() => setConfirm(true)}>
                {t('settings.reset')}
              </Button>
            </div>
          </Card>
          <Card title={t('settings.update')} icon="repost" tone="cobalt">
            <p className="t-small t-muted" style={{ marginBottom: 12 }}>
              {t('settings.updateHint')}
            </p>
            <code className="listing-box" style={{ marginBottom: 12 }}>
              cd ~/ERA && git pull
            </code>
            <Button icon="repost" onClick={() => browser.runtime.reload()}>
              {t('settings.reload')}
            </Button>
          </Card>
          <Card title={t('settings.about')} icon="info" tone="neutral">
            <div className="row" style={{ gap: 14 }}>
              <LogoMark size={44} />
              <div>
                <div className="t-h3">{t('app.fullName')}</div>
                <p className="t-small t-muted">
                  {t('app.tagline')} <span className="t-serif">{t('app.taglineItalic')}</span>
                </p>
                <p className="t-small t-faint">v{browser.runtime.getManifest().version}</p>
              </div>
            </div>
          </Card>
        </div>
        {/* Vinted's side: the source, what is verified on it, the connection test. */}
        <div className="span-6 stack-4">
          <Card title={t('settings.marketplace')} icon="repost" tone="cobalt">
            <div className="stack-3">
              <p className="t-small t-muted">{t('vinted.importHint')}</p>
              <p className="t-small t-faint">{t('settings.budget')}</p>
              {budget && (
                <p className="t-small">
                  {budget.halted && budget.haltedUntil
                    ? t('vinted.halted', { time: new Date(budget.haltedUntil).toLocaleTimeString(i.locale) })
                    : t('vinted.budget', { n: budget.remaining })}
                  {budget.uses && Object.keys(budget.uses).length > 0 && (
                    <span className="t-faint" data-testid="budget-uses">
                      {' · '}
                      {t('vinted.budgetUsed', {
                        list: Object.entries(budget.uses)
                          .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
                          .map(([k, n]) => `${t(`vinted.use.${k}`)} ${n}`)
                          .join(' · '),
                      })}
                    </span>
                  )}
                </p>
              )}
              {lastImport ? <p className="t-small t-faint">{t('vinted.lastImport', { when: i.relative(lastImport, era.now) })}</p> : null}
              {purchasesError && <p className="t-small" style={{ color: 'var(--amber)', wordBreak: 'break-word' }}>{t('purchases.error', { detail: purchasesError })}</p>}
              {wardrobeKeys && wardrobeKeys.length > 0 && (
                <details className="t-small">
                  <summary className="t-muted" style={{ cursor: 'pointer' }}>
                    {t('vinted.diagnostic')}
                  </summary>
                  <p style={{ marginTop: 6 }}>{t('vinted.reservedFlag', { state: wardrobeKeys.includes('is_reserved') ? t('vinted.reservedYes') : t('vinted.reservedNo') })}</p>
                  <p className="t-faint" style={{ marginTop: 4, wordBreak: 'break-word' }}>
                    {t('vinted.keysSeen', { keys: wardrobeKeys.join(', ') })}
                  </p>
                </details>
              )}
              <div>
                <VintedImportButton variant="primary" onDone={() => void budgetStatus().then(setBudget)} />
              </div>
              <RefreshSettings />
              <OverlaySettings />
              <RepliesSettings />
            </div>
          </Card>
          <IntegrationsCard />
          <DiagnosticCard />
        </div>
      </div>
      <Modal open={confirm} onClose={() => setConfirm(false)} title={t('settings.reset')}>
        <p className="t-muted">{t('settings.resetConfirm')}</p>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={() => setConfirm(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              await repo.resetAll();
              setConfirm(false);
              toast('info', t('settings.resetDone'));
              go('onboarding');
              location.reload();
            }}
          >
            {t('common.confirm')}
          </Button>
        </div>
      </Modal>
    </>
  );
}
