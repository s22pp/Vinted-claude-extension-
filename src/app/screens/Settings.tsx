import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import type { BudgetStatus } from '@/data/adapters/vinted/protocol';
import { budgetStatus } from '@/data/adapters/vinted/vinted-adapter';
import { type DiagStep, runVintedDiagnostic } from '@/data/adapters/vinted/diagnose';
import { type DataMode, repo } from '@/data/repo';
import { type Locale, useI18n } from '@/i18n';
import { LogoMark } from '@/ui/components/Logo';
import { Modal, useToast } from '@/ui/components/overlays';
import { Badge, Button, Card, DemoBadge, Segmented } from '@/ui/components/primitives';
import { type ThemeSetting, setTheme } from '../providers';
import { PageHead } from '../Shell';
import { VintedImportButton } from '../components/vinted-import';
import { go, useEra } from '../state';

export function Settings() {
  const i = useI18n();
  const { t } = i;
  const era = useEra();
  const toast = useToast();
  const theme = useLiveQuery(() => repo.getSetting<ThemeSetting>('theme', 'dark'), []) ?? 'dark';
  const locale = useLiveQuery(() => repo.getSetting<Locale>('locale', 'fr'), []) ?? 'fr';
  const lastImport = useLiveQuery(() => repo.getSetting<number | null>('lastVintedImport', null), []);
  const wardrobeKeys = useLiveQuery(() => repo.getSetting<string[] | null>('vintedWardrobeKeys', null), []);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [budget, setBudget] = useState<BudgetStatus | null>(null);
  useEffect(() => {
    void budgetStatus().then(setBudget);
  }, [busy]);

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
            <p className="t-small t-faint" style={{ marginTop: 12 }}>
              {t('settings.motionHint')}
            </p>
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
                </p>
              )}
              {lastImport ? <p className="t-small t-faint">{t('vinted.lastImport', { when: i.relative(lastImport, era.now) })}</p> : null}
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
            </div>
          </Card>
          <DiagnosticCard />
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

export type { DataMode };

function DiagnosticCard() {
  const { t } = useI18n();
  const toast = useToast();
  const [steps, setSteps] = useState<DiagStep[]>([]);
  const [running, setRunning] = useState(false);
  const [lastError, setLastError] = useState<{ code: string; detail?: string; at: number } | null>(null);
  useEffect(() => {
    void browser.storage.local.get('eraLastImportError').then((r) => setLastError((r.eraLastImportError as typeof lastError) ?? null));
  }, [running]);
  const report = () =>
    [
      `ERA v${browser.runtime.getManifest().version} · ${navigator.userAgent}`,
      ...steps.map((s) => `${s.ok ? '✓' : '✗'} ${t(`vinted.diagStep.${s.key}`)} — ${s.info}`),
      lastError ? `Dernière erreur d’import (${new Date(lastError.at).toLocaleString()}) : ${lastError.code} · ${lastError.detail ?? ''}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  return (
    <Card title={t('vinted.diagTitle')} icon="target" tone="cyan" id="diagnostic">
      <p className="t-small t-muted" style={{ marginBottom: 12 }}>
        {t('vinted.diagHint')}
      </p>
      <div className="row wrap" style={{ marginBottom: steps.length ? 12 : 0 }}>
        <Button
          variant="primary"
          icon="target"
          loading={running}
          onClick={async () => {
            setRunning(true);
            setSteps([]);
            await runVintedDiagnostic((s) => setSteps((xs) => [...xs, s]));
            setRunning(false);
          }}
        >
          {t('vinted.diagRun')}
        </Button>
        {(steps.length > 0 || lastError) && (
          <Button
            icon="layers"
            onClick={async () => {
              await navigator.clipboard.writeText(report()).catch(() => undefined);
              toast('success', t('vinted.diagCopied'));
            }}
          >
            {t('vinted.diagCopy')}
          </Button>
        )}
      </div>
      {steps.length > 0 && (
        <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-live="polite">
          {steps.map((s) => (
            <li key={s.key} className="row t-small" style={{ alignItems: 'flex-start', gap: 8 }}>
              <Badge tone={s.ok ? 'emerald' : 'coral'}>{s.ok ? '✓' : '✗'}</Badge>
              <span>
                <b>{t(`vinted.diagStep.${s.key}`)}</b> <span className="t-muted" style={{ wordBreak: 'break-word' }}>— {s.info}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {lastError && (
        <p className="t-small t-faint" style={{ marginTop: 10, wordBreak: 'break-word' }}>
          {t('vinted.lastError')} : {lastError.code} · {lastError.detail}
        </p>
      )}
    </Card>
  );
}
