import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { ACCOUNT_CHECK_KEY, type AccountCheck, type DiagKey, type DiagStep, runVintedDiagnostic } from '@/data/adapters/vinted/diagnose';
import { ERROR_LOG_KEY, SEARCH_MODE_KEY, SEARCH_TEMPLATE_KEY, type VintedErrorEntry } from '@/data/adapters/vinted/vinted-adapter';
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
      ...journal.map((j) => `${new Date(j.at).toLocaleString()} · ${j.code} · ${j.detail} (${j.path})`),
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
const PROBES: Record<string, DiagKey[]> = { stock: ['wardrobe'], sold: ['sold'], reserved: ['wardrobe'], search: ['catalog'], purchases: ['purchases'], auto: ['notifications', 'inbox'], draft: ['listing'], repost: ['listing'] };

/**
 * What of the Vinted integration has actually been observed working on THIS device, and what has not.
 * Fixture tests prove ERA's logic; they never prove the real Vinted integration.
 */
export function IntegrationsCard() {
  const i18n = useI18n();
  const { t } = i18n;
  const ev = useLiveQuery(async () => {
    const listings = await db.listings.filter((l) => !l.isDemo && /^\d+$/.test(l.platformListingId ?? '')).count();
    const reserved = await db.items.filter((i) => !i.isDemo && i.status === 'RESERVED' && i.meta.status?.p === 'OBSERVED').count();
    const sold = await db.events.where('type').equals('ITEM_SOLD').filter((e) => !e.isDemo && e.provenance === 'OBSERVED').count();
    const searches = await db.analyses.filter((a) => !a.isDemo && a.analysis.source === 'VINTED' && a.analysis.keptCount > 0).count();
    const learned = !!(await db.settings.get(SEARCH_TEMPLATE_KEY))?.value || !!(await db.settings.get(SEARCH_MODE_KEY))?.value;
    const purchases = await db.purchases.count();
    // Writes: only what Vinted accepted here, as the journal recorded it (simulations excluded).
    const okLog = await db.autoLog.filter((r) => r.ok && !r.dryRun).toArray();
    const done = (...kinds: string[]) => okLog.filter((r) => kinds.includes(r.kind)).length;
    return {
      listings,
      reserved,
      sold,
      searches,
      learned,
      purchases,
      draft: done('DRAFT'),
      label: done('LABEL'),
      hide: done('HIDE', 'UNHIDE'),
      repost: done('REPOST', 'DELETE'),
      auto: done('FAV_MESSAGE', 'FAV_OFFER', 'FAV_BUNDLE', 'OFFER_ACCEPT', 'OFFER_REJECT', 'OFFER_COUNTER'),
      description: done('DESCRIPTION'),
    };
  }, []);
  const rows: { key: string; n: number | null; flag?: 'EXPERIMENTAL' | 'UNVERIFIED' }[] = ev
    ? [
        { key: 'stock', n: ev.listings },
        { key: 'sold', n: ev.sold },
        { key: 'reserved', n: ev.reserved },
        { key: 'search', n: ev.searches, flag: ev.learned ? 'UNVERIFIED' : undefined },
        { key: 'purchases', n: ev.purchases },
        { key: 'priceEdit', n: null, flag: 'EXPERIMENTAL' },
        { key: 'description', n: ev.description, flag: 'EXPERIMENTAL' },
        { key: 'draft', n: ev.draft, flag: 'EXPERIMENTAL' },
        { key: 'label', n: ev.label, flag: 'EXPERIMENTAL' },
        { key: 'hide', n: ev.hide, flag: 'EXPERIMENTAL' },
        { key: 'repost', n: ev.repost, flag: 'EXPERIMENTAL' },
        { key: 'auto', n: ev.auto, flag: 'EXPERIMENTAL' },
      ]
    : [];
  const check = useLiveQuery(() => repo.getSetting<AccountCheck | null>(ACCOUNT_CHECK_KEY, null), []);
  const probed = (key: string) => {
    if (!check) return null;
    const got = (PROBES[key] ?? []).map((k) => check.steps.find((x) => x.key === k)).filter((x): x is DiagStep => !!x);
    if (!got.length) return null;
    if (key === 'reserved') return { ok: got[0]!.ok && /is_reserved présent/.test(got[0]!.info), info: got[0]!.info };
    return { ok: got.every((x) => x.ok), info: got.map((x) => x.info).join(' · ') };
  };
  return (
    <Card title={t('integrations.title')} hint={t('integrations.hint')} icon="lock" tone="pink" id="integrations">
      <div className="integ">
        {rows.map((r) => (
          <div key={r.key} className="integ__row">
            <div className="grow">
              <div className="integ__name">{t(`integrations.${r.key}`)}</div>
              <div className="t-small t-faint">{t(`integrations.${r.key}Hint`)}</div>
              {(() => {
                const p = probed(r.key);
                return p && check ? (
                  <div className={`t-small ${p.ok ? 't-pos' : 't-warn'}`} title={p.info} style={{ overflowWrap: 'anywhere' }}>
                    {t(p.ok ? 'integrations.checkOk' : 'integrations.checkFail', { date: i18n.date(check.at) })}
                  </div>
                ) : null;
              })()}
            </div>
            <div className="integ__status">
              {r.n && r.n > 0 ? (
                <>
                  <Badge tone="emerald" dot>
                    {t('integrations.observed', { n: r.n })}
                  </Badge>
                  {r.flag && <Flag kind={r.flag} title={r.flag === 'UNVERIFIED' ? t('flag.learnedEndpoint') : undefined} />}
                </>
              ) : r.flag === 'EXPERIMENTAL' ? (
                <Flag kind="EXPERIMENTAL" />
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
