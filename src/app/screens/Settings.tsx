import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import type { BudgetStatus } from '@/data/adapters/vinted/protocol';
import { budgetStatus } from '@/data/adapters/vinted/vinted-adapter';
import { type DiagStep, runVintedDiagnostic } from '@/data/adapters/vinted/diagnose';
import { type DataMode, repo } from '@/data/repo';
import { type Locale, useI18n } from '@/i18n';
import { LogoMark } from '@/ui/components/Logo';
import { Modal, useToast } from '@/ui/components/overlays';
import { Badge, Button, Card, DemoBadge, Flag, Segmented } from '@/ui/components/primitives';
import { ERROR_LOG_KEY, SEARCH_TEMPLATE_KEY, type VintedErrorEntry } from '@/data/adapters/vinted/vinted-adapter';
import { type SellerIdentity, db } from '@/data/db';
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
  const purchasesError = useLiveQuery(() => repo.getSetting<string | null>('purchasesError', null), []);
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
            </div>
          </Card>
          <IntegrationsCard />
          <SellerIdentityCard />
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
  const journal = useLiveQuery(() => repo.getSetting<VintedErrorEntry[]>(ERROR_LOG_KEY, []), []) ?? [];
  useEffect(() => {
    void browser.storage.local.get('eraLastImportError').then((r) => setLastError((r.eraLastImportError as typeof lastError) ?? null));
  }, [running]);
  const report = () =>
    [
      `ERA v${browser.runtime.getManifest().version} · ${navigator.userAgent}`,
      ...steps.map((s) => `${s.ok ? '✓' : '✗'} ${t(`vinted.diagStep.${s.key}`)} — ${s.info}`),
      lastError ? `Dernière erreur d’import (${new Date(lastError.at).toLocaleString()}) : ${lastError.code} · ${lastError.detail ?? ''}` : '',
      ...journal.map((j) => `${new Date(j.at).toLocaleString()} · ${j.code} · ${j.detail} (${j.path})`),
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
        {(steps.length > 0 || lastError || journal.length > 0) && (
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
      {journal.length > 0 && (
        <div className="journal">
          <div className="t-caption" style={{ margin: '12px 0 6px' }}>
            {t('vinted.journal')}
          </div>
          <ul>
            {journal.slice(0, 6).map((j) => (
              <li key={j.at + j.path} className="t-small">
                <span className="t-faint num">{new Date(j.at).toLocaleString()}</span> <b>{j.code}</b> <span className="t-muted">{j.detail}</span>
              </li>
            ))}
          </ul>
          <p className="t-small t-faint">{t('vinted.journalHint')}</p>
        </div>
      )}
    </Card>
  );
}

/**
 * What of the Vinted integration has actually been observed working on THIS device, and what has not.
 * Fixture tests prove ERA's logic; they never prove the real Vinted integration.
 */
function IntegrationsCard() {
  const { t } = useI18n();
  const ev = useLiveQuery(async () => {
    const listings = await db.listings.filter((l) => !l.isDemo && /^\d+$/.test(l.platformListingId ?? '')).count();
    const reserved = await db.items.filter((i) => !i.isDemo && i.status === 'RESERVED' && i.meta.status?.p === 'OBSERVED').count();
    const sold = await db.events.where('type').equals('ITEM_SOLD').filter((e) => !e.isDemo && e.provenance === 'OBSERVED').count();
    const searches = await db.analyses.filter((a) => !a.isDemo && a.analysis.source === 'VINTED' && a.analysis.keptCount > 0).count();
    const learned = !!(await db.settings.get(SEARCH_TEMPLATE_KEY))?.value;
    const purchases = await db.purchases.count();
    return { listings, reserved, sold, searches, learned, purchases };
  }, []);
  const rows: { key: string; n: number | null; flag?: 'EXPERIMENTAL' | 'UNVERIFIED' }[] = ev
    ? [
        { key: 'stock', n: ev.listings },
        { key: 'sold', n: ev.sold },
        { key: 'reserved', n: ev.reserved },
        { key: 'search', n: ev.searches, flag: ev.learned ? 'UNVERIFIED' : undefined },
        { key: 'purchases', n: ev.purchases },
        { key: 'priceEdit', n: null, flag: 'EXPERIMENTAL' },
      ]
    : [];
  return (
    <Card title={t('integrations.title')} hint={t('integrations.hint')} icon="lock" tone="pink" id="integrations">
      <div className="integ">
        {rows.map((r) => (
          <div key={r.key} className="integ__row">
            <div className="grow">
              <div className="integ__name">{t(`integrations.${r.key}`)}</div>
              <div className="t-small t-faint">{t(`integrations.${r.key}Hint`)}</div>
            </div>
            <div className="integ__status">
              {r.flag === 'EXPERIMENTAL' ? (
                <Flag kind="EXPERIMENTAL" />
              ) : r.n && r.n > 0 ? (
                <>
                  <Badge tone="emerald" dot>
                    {t('integrations.observed', { n: r.n })}
                  </Badge>
                  {r.flag && <Flag kind={r.flag} title={t('flag.learnedEndpoint')} />}
                </>
              ) : (
                <Flag kind="UNVERIFIED" />
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="t-small t-muted" style={{ marginTop: 12 }}>
        {t('integrations.freeze')}
      </p>
      <p className="t-small t-faint" style={{ marginTop: 6 }}>
        {t('integrations.tests')}
      </p>
    </Card>
  );
}

/** Printed on invoices. Local only; ERA sends it nowhere. */
function SellerIdentityCard() {
  const { t } = useI18n();
  const toast = useToast();
  const saved = useLiveQuery(() => repo.getSetting<SellerIdentity | null>('sellerIdentity', null), []);
  const [v, setV] = useState<SellerIdentity>({ name: '', address: '', siret: '', email: '', vatExempt: false });
  useEffect(() => {
    if (saved) setV(saved);
  }, [saved]);
  const set = (k: keyof SellerIdentity) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV((x) => ({ ...x, [k]: k === 'vatExempt' ? (e.target as HTMLInputElement).checked : e.target.value }));
  return (
    <Card title={t('identity.title')} hint={t('identity.hint')} icon="book" tone="emerald" id="identity">
      <form
        className="stack-3"
        onSubmit={async (e) => {
          e.preventDefault();
          await repo.setSetting('sellerIdentity', v);
          toast('success', t('common.saved'));
        }}
      >
        <label className="stack" style={{ gap: 4 }}>
          <span className="t-small t-muted">{t('identity.name')}</span>
          <input className="input" value={v.name} onChange={set('name')} />
        </label>
        <label className="stack" style={{ gap: 4 }}>
          <span className="t-small t-muted">{t('identity.address')}</span>
          <textarea className="input" rows={3} value={v.address} onChange={set('address')} />
        </label>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label className="stack" style={{ gap: 4 }}>
            <span className="t-small t-muted">{t('identity.siret')}</span>
            <input className="input" value={v.siret} onChange={set('siret')} inputMode="numeric" />
          </label>
          <label className="stack" style={{ gap: 4 }}>
            <span className="t-small t-muted">{t('identity.email')}</span>
            <input className="input" type="email" value={v.email} onChange={set('email')} />
          </label>
        </div>
        <label className="row t-small" style={{ cursor: 'pointer' }}>
          <input type="checkbox" className="checkbox" checked={v.vatExempt} onChange={set('vatExempt')} />
          {t('identity.vatExempt')}
        </label>
        <div>
          <Button type="submit" variant="primary" size="sm" icon="check">
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
