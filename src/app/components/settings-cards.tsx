import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { ACCOUNT_CHECK_KEY, type AccountCheck, type DiagKey, type DiagStep, SEARCH_PROBE_KEY, type SearchProbe, runVintedDiagnostic } from '@/data/adapters/vinted/diagnose';
import { DEFAULT_SEARCH_TEMPLATE, ERROR_LOG_KEY, PLAIN_SEARCH_TEMPLATE, SEARCH_DOWN_KEY, SEARCH_MODE_KEY, SEARCH_OK_KEY, SEARCH_PAUSE_MS, SEARCH_TEMPLATE_KEY, type SearchOk, type VintedErrorEntry } from '@/data/adapters/vinted/vinted-adapter';
import { type IntegStatus, type IntegrationRecords, integrationStatus } from '@/data/integrations';
import { type SellerIdentity, db } from '@/data/db';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import { useToast } from '@/ui/components/overlays';
import { Badge, Button, Card, Flag } from '@/ui/components/primitives';
import { type UiError, readUiErrors } from './error-boundary';

/** Checks what ERA can read on Vinted from this browser, and a report to copy when something fails. */
export function DiagnosticCard() {
  const { t } = useI18n();
  const toast = useToast();
  const [steps, setSteps] = useState<DiagStep[]>([]);
  const [running, setRunning] = useState(false);
  const [lastError, setLastError] = useState<{ code: string; detail?: string; at: number } | null>(null);
  const journal = useLiveQuery(() => repo.getSetting<VintedErrorEntry[]>(ERROR_LOG_KEY, []), []) ?? [];
  const [uiErrors, setUiErrors] = useState<UiError[]>([]);
  useEffect(() => {
    void browser.storage.local.get('eraLastImportError').then((r) => setLastError((r.eraLastImportError as typeof lastError) ?? null));
    void readUiErrors().then(setUiErrors);
  }, [running]);
  const report = () =>
    [
      `ERA v${browser.runtime.getManifest().version} · ${navigator.userAgent}`,
      ...steps.map((s) => `${s.ok ? '✓' : '✗'} ${t(`vinted.diagStep.${s.key}`)} — ${s.info}`),
      lastError ? `Dernière erreur d’import (${new Date(lastError.at).toLocaleString()}) : ${lastError.code} · ${lastError.detail ?? ''}` : '',
      ...journal.map((j) => `${new Date(j.at).toLocaleString()} · ${j.code} · ${j.detail} (${j.path})${j.count && j.count > 1 ? ` · ×${j.count} depuis ${new Date(j.first ?? j.at).toLocaleString()}` : ''}`),
      // ERA's own errors (a screen that failed, a service worker operation that threw), newest first.
      ...uiErrors.slice(0, 5).map((e) => `${e.where.startsWith('service-worker') ? 'Erreur interne' : 'Affichage'} ${new Date(e.at).toLocaleString()} · ${e.where} · ${e.message}\n${e.stack.split('\n').slice(0, 6).join('\n')}`),
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
        <Button
          icon="check"
          loading={running}
          onClick={async () => {
            setRunning(true);
            setSteps([]);
            const all = await runVintedDiagnostic((s) => setSteps((xs) => [...xs, s]), true);
            // What each read gave on THIS account, shown next to each integration.
            await repo.setSetting(ACCOUNT_CHECK_KEY, { at: Date.now(), steps: all } satisfies AccountCheck);
            setRunning(false);
          }}
        >
          {t('vinted.checkRun')}
        </Button>
        {(steps.length > 0 || lastError || journal.length > 0 || uiErrors.length > 0) && (
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
                {j.count && j.count > 1 ? <span className="t-faint num"> · ×{j.count}</span> : null}
              </li>
            ))}
          </ul>
          <p className="t-small t-faint">{t('vinted.journalHint')}</p>
        </div>
      )}
    </Card>
  );
}

/** Which read of the account check backs each integration. */
const PROBES: Record<string, DiagKey[]> = { stock: ['wardrobe'], sold: ['sold'], reserved: ['wardrobe'], search: ['catalog'], purchases: ['purchases'], auto: ['notifications', 'inbox'], draft: ['brands', 'sizes'], repost: ['listing'], label: ['conversation', 'address'], description: ['listing'], titleEdit: ['listing'], priceEdit: ['listing'], hide: ['listing'] };

const STATE_TONE = { VERIFIED: 'emerald', PARTIAL: 'amber', FAILING: 'coral', UNAVAILABLE: 'neutral' } as const;

const isLearned = (t: string | null) => !!t && t !== DEFAULT_SEARCH_TEMPLATE && t !== PLAIN_SEARCH_TEMPLATE;

/** Everything ERA recorded on this device that says whether a Vinted route works. */
async function integrationRecords(): Promise<IntegrationRecords> {
  const setting = async <T,>(key: string, fallback: T) => ((await db.settings.get(key))?.value as T | undefined) ?? fallback;
  const analyses = await db.analyses.filter((a) => !a.isDemo && a.analysis.source === 'VINTED' && a.analysis.keptCount > 0).toArray();
  const probe = await setting<SearchProbe | null>(SEARCH_PROBE_KEY, null);
  const down = await setting<{ until: number; detail: string } | null>(SEARCH_DOWN_KEY, null);
  const { eraLastImportError } = (await browser.storage.local.get('eraLastImportError')) as { eraLastImportError?: { at: number; code: string; detail?: string } };
  return {
    now: Date.now(),
    listings: await db.listings.filter((l) => !l.isDemo && /^\d+$/.test(l.platformListingId ?? '')).count(),
    lastImport: await setting<number | null>('lastVintedImport', null),
    importError: eraLastImportError ?? null,
    sold: await db.events.where('type').equals('ITEM_SOLD').filter((e) => !e.isDemo && e.provenance === 'OBSERVED').count(),
    reserved: await db.items.filter((i) => !i.isDemo && i.status === 'RESERVED' && i.meta.status?.p === 'OBSERVED').count(),
    wardrobeKeys: await setting<string[] | null>('vintedWardrobeKeys', null),
    searches: [...analyses.map((a) => ({ at: a.at, via: a.analysis.via ?? null })), ...(probe ? [probe] : [])],
    searchOk: await setting<SearchOk>(SEARCH_OK_KEY, {}),
    // A stored template is a learned address only when it is neither of ERA's own two forms (default, plain).
    searchMode: (await setting(SEARCH_MODE_KEY, null)) ? 'PAGE' : isLearned(await setting<string | null>(SEARCH_TEMPLATE_KEY, null)) ? 'LEARNED' : 'API',
    searchDown: down ? { ...down, at: down.until - SEARCH_PAUSE_MS } : null,
    errors: await setting<VintedErrorEntry[]>(ERROR_LOG_KEY, []),
    purchases: await db.purchases.count(),
    purchasesError: await setting<string | null>('purchasesError', null),
    log: await db.autoLog.toArray(),
  };
}

/**
 * What of the Vinted integration has actually been observed working on THIS device, route by route, and what has
 * not — with the last failure when it is the current state. Fixture tests prove ERA's logic; never the real integration.
 */
export function IntegrationsCard() {
  const i18n = useI18n();
  const { t } = i18n;
  const [checking, setChecking] = useState(false);
  const rows = useLiveQuery(async () => integrationStatus(await integrationRecords()), [checking]) ?? [];
  const check = useLiveQuery(() => repo.getSetting<AccountCheck | null>(ACCOUNT_CHECK_KEY, null), []);
  const probed = (key: string) => {
    if (!check) return null;
    const got = (PROBES[key] ?? []).map((k) => check.steps.find((x) => x.key === k)).filter((x): x is DiagStep => !!x);
    if (!got.length) return null;
    if (key === 'reserved') return { ok: got[0]!.ok && /is_reserved présent/.test(got[0]!.info), info: got[0]!.info };
    return { ok: got.every((x) => x.ok), info: got.map((x) => x.info).join(' · ') };
  };
  const when = (at: number | null) => (at === null ? '' : i18n.date(at));
  const verified = rows.filter((r) => r.state === 'VERIFIED').length;
  const failing = rows.filter((r) => r.state === 'FAILING').length;
  const status = (r: IntegStatus) => {
    const unverifiedFlag = r.write ? 'EXPERIMENTAL' : 'UNVERIFIED';
    switch (r.state) {
      case 'VERIFIED':
        return (
          <Badge tone="emerald" dot>
            {t('integrations.verified', { n: r.n })}
          </Badge>
        );
      case 'PARTIAL':
        return (
          <>
            <Badge tone="amber" dot>
              {r.key === 'reserved' ? t('integrations.fieldRead') : t('integrations.partial', { ok: r.routes.filter((x) => x.ok > 0).length, of: r.routes.length })}
            </Badge>
            <Flag kind={unverifiedFlag} title={t('integrations.partialHint')} />
          </>
        );
      case 'FAILING':
        return (
          <Badge tone="coral" dot>
            {r.lastFail?.at ? t('integrations.failedOn', { date: when(r.lastFail.at) }) : t('integrations.failed')}
          </Badge>
        );
      case 'UNAVAILABLE':
        return <Badge tone={STATE_TONE.UNAVAILABLE}>{t('integrations.unavailable')}</Badge>;
      default:
        return <Flag kind={unverifiedFlag} title={t(r.write ? 'integrations.untestedWrite' : 'integrations.untestedRead')} />;
    }
  };
  const routeText = (r: IntegStatus['routes'][number]) =>
    r.ok > 0
      ? t('integrations.routeOk', { n: r.ok })
      : r.unconfirmed > 0
        ? t('integrations.routeUnconfirmed', { n: r.unconfirmed })
        : r.lastFail
          ? t('integrations.routeFailed', { date: when(r.lastFail.at) })
          : t('integrations.routeNever');
  return (
    <Card title={t('integrations.title')} hint={t('integrations.hint')} icon="lock" tone="pink" id="integrations">
      <div className="row-between wrap" style={{ gap: 10, marginBottom: 8 }}>
        <span className="t-small t-muted" data-testid="integ-summary">
          {t('integrations.summary', { ok: verified, of: rows.length })}
          {failing > 0 && ` · ${t('integrations.summaryFailing', { n: failing })}`}
        </span>
        <Button
          size="sm"
          icon="check"
          loading={checking}
          onClick={async () => {
            setChecking(true);
            try {
              const all = await runVintedDiagnostic(() => undefined, true);
              await repo.setSetting(ACCOUNT_CHECK_KEY, { at: Date.now(), steps: all } satisfies AccountCheck);
            } finally {
              setChecking(false);
            }
          }}
        >
          {t('integrations.checkNow')}
        </Button>
      </div>
      <div className="integ">
        {rows.map((r) => {
          const p = probed(r.key);
          return (
            <div key={r.key} className="integ__row" data-state={r.state}>
              <div className="integ__name">{t(`integrations.${r.key}`)}</div>
              <div className="integ__status">{status(r)}</div>
              <div className="integ__body">
                <div className="t-small t-faint">{t(`integrations.${r.key}Hint`)}</div>
                {r.routes.length > 1 && (
                  <ul className="integ__routes">
                    {r.routes.map((x) => (
                      <li key={x.key} className={x.ok > 0 ? 't-pos' : x.lastFail ? 't-warn' : 't-faint'} title={x.lastFail ? x.lastFail.detail : undefined}>
                        {t(`integrations.route.${x.key}`)} · {routeText(x)}
                      </li>
                    ))}
                  </ul>
                )}
                {r.note && <div className="t-small t-muted">{t(`integrations.note.${r.note.key}`, { ...r.note.params, until: r.note.params?.until ? new Date(Number(r.note.params.until)).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '' })}</div>}
                {r.state === 'FAILING' && r.lastFail ? (
                  <div className="t-small t-warn" style={{ overflowWrap: 'anywhere' }}>
                    {t('integrations.lastFail', { detail: r.lastFail.detail })}
                  </div>
                ) : (
                  r.lastOk !== null && <div className="t-small t-faint">{t('integrations.lastOk', { date: when(r.lastOk) })}</div>
                )}
                {p && check && (
                  <div className={`t-small ${p.ok ? 't-pos' : 't-warn'}`} title={p.info} style={{ overflowWrap: 'anywhere' }}>
                    {t(p.ok ? 'integrations.checkOk' : 'integrations.checkFail', { date: i18n.date(check.at) })}
                  </div>
                )}
              </div>
            </div>
          );
        })}
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
export function SellerIdentityCard() {
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
