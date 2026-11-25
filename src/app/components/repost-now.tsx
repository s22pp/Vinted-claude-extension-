import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import type { EraMessage } from '@/data/adapters/vinted/protocol';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import type { ItemView } from '@/intelligence/portfolio';
import { DEFAULT_WAIT, NOW_STEPS, REPOST_JOBS_KEY, REPOST_WAIT_KEY, type RepostNow, type WaitWindow, clampWindow, isActive, leftText, publishedAgo, stepStatuses } from '@/intelligence/repost-now';
import { Modal } from '@/ui/components/overlays';
import { Button, Field, Input } from '@/ui/components/primitives';
import '@/ui/styles/repost-now.css';
import { UntilProven } from './verify-flag';

const PAUSE_KEY = 'eraRepostPause';

/** The reposts list, as the worker writes it (storage.local): every view of ERA follows the same one. */
export function useRepostJobs(): RepostNow[] {
  const [jobs, setJobs] = useState<RepostNow[]>([]);
  useEffect(() => {
    let alive = true;
    const read = (v: unknown) => alive && setJobs(Array.isArray(v) ? (v as RepostNow[]) : []);
    void browser.storage.local
      .get(REPOST_JOBS_KEY)
      .then((v) => read(v[REPOST_JOBS_KEY]))
      .catch(() => undefined);
    const on = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === 'local' && REPOST_JOBS_KEY in changes) read(changes[REPOST_JOBS_KEY]!.newValue);
    };
    browser.storage.onChanged.addListener(on);
    return () => {
      alive = false;
      browser.storage.onChanged.removeListener(on);
    };
  }, []);
  return jobs;
}

/** This article's repost (under way, or the last one). */
export function useRepostNow(itemId: string): RepostNow | null {
  return useRepostJobs().find((j) => j.itemId === itemId) ?? null;
}

/** The list paused by a stop concerning the account (403, 429, logged out, budget spent). */
function useRepostPause(): { detail: string } | null {
  const [p, setP] = useState<{ detail: string } | null>(null);
  useEffect(() => {
    let alive = true;
    const read = (v: unknown) => alive && setP(v && typeof v === 'object' ? (v as { detail: string }) : null);
    void browser.storage.local
      .get(PAUSE_KEY)
      .then((v) => read(v[PAUSE_KEY]))
      .catch(() => undefined);
    const on = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === 'local' && PAUSE_KEY in changes) read(changes[PAUSE_KEY]!.newValue);
    };
    browser.storage.onChanged.addListener(on);
    return () => {
      alive = false;
      browser.storage.onChanged.removeListener(on);
    };
  }, []);
  return p;
}

/** A clock for the countdowns, ticking only while one is shown. */
function useNow(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [on]);
  return now;
}

const send = (msg: EraMessage) => browser.runtime.sendMessage(msg) as Promise<{ ok: boolean; code?: string; detail?: string; queued?: number }>;

/** One article's line in a list of several: where it stands, in words, and what can be done. */
function QueueRow({ j, now }: { j: RepostNow; now: number }) {
  const { t } = useI18n();
  const state =
    j.outcome === 'QUEUED'
      ? t('repostNow.queued')
      : j.outcome === 'WAITING'
        ? t('repostNow.left', { left: leftText((j.waitUntil ?? now) - now) })
        : j.outcome === 'RUNNING'
          ? t(`repostNow.rowStep.${j.step === 'wait' || j.step === 'done' ? 'publish' : j.step}`)
          : j.outcome === 'DONE'
            ? t('repostNow.rowDone')
            : j.outcome === 'UNCERTAIN'
              ? t('repostNow.rowUncertain')
              : t('repostNow.rowFailed');
  return (
    <li className="repost-queue__row" data-item={j.itemId} data-outcome={j.outcome} data-step={j.step}>
      <span className="repost-queue__dot" aria-hidden="true" />
      <span className="repost-queue__main">
        <b>{j.title}</b>
        {j.detail && <span className="t-small t-muted">{j.detail}</span>}
      </span>
      <span className="repost-queue__state num">{state}</span>
      <span className="repost-queue__acts">
        {j.outcome === 'WAITING' && (
          <Button size="sm" variant="ghost" onClick={() => void send({ type: 'era:repost:skipWait', itemId: j.itemId })}>
            {t('repostNow.skipWait')}
          </Button>
        )}
        {(j.outcome === 'FAILED' || j.outcome === 'UNCERTAIN') && j.resumable && (
          <Button size="sm" variant="ghost" onClick={() => void send({ type: 'era:repost:resume', itemId: j.itemId })}>
            {t('repostNow.resume')}
          </Button>
        )}
      </span>
    </li>
  );
}

/**
 * « Republier maintenant », for one article or several: the cost first (views and favourites lost), the seller's wait
 * window, then each article copied, deleted, waited for and published again — live. The dialog can be closed: the
 * list goes on in the background, the wait included, and every view of ERA follows it.
 */
export function RepostNowDialog({ views, open, onClose }: { views: readonly ItemView[]; open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const jobs = useRepostJobs();
  const pause = useRepostPause();
  const saved = useLiveQuery(() => repo.getSetting<WaitWindow>(REPOST_WAIT_KEY, DEFAULT_WAIT), []);
  const [win, setWin] = useState<{ min: string; max: string } | null>(null);
  const [started, setStarted] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const ids = new Set(views.map((v) => v.item.id));
  const mine = jobs.filter((j) => ids.has(j.itemId));
  const one = views.length === 1 ? views[0]! : null;
  const live = one ? (mine[0] ?? null) : null;
  const anyActive = mine.some(isActive);
  const showProgress = started || anyActive;
  const now = useNow(open && mine.some((j) => j.outcome === 'WAITING'));
  const w = clampWindow(saved ?? DEFAULT_WAIT);
  const minText = win?.min ?? String(w.minMin);
  const maxText = win?.max ?? String(w.maxMin);
  const totalViews = views.reduce((s, v) => s + (v.current?.views ?? 0), 0);
  const totalFavs = views.reduce((s, v) => s + (v.current?.favorites ?? 0), 0);
  const allDone = mine.length > 0 && mine.length === views.length && mine.every((j) => j.outcome === 'DONE');
  const anyFailed = mine.some((j) => j.outcome === 'FAILED') || !!sendError;
  const anyUncertain = mine.some((j) => j.outcome === 'UNCERTAIN');
  const close = () => {
    if (!anyActive) {
      setStarted(false);
      setSendError(null);
      setWin(null);
    }
    onClose();
  };
  const go = async () => {
    setStarted(true);
    setSendError(null);
    const window = clampWindow({ minMin: Number(minText.replace(',', '.')), maxMin: Number(maxText.replace(',', '.')) });
    try {
      const r = await send({ type: 'era:repost:now', items: views.map((v) => ({ itemId: v.item.id, acceptFavourites: Math.max(0, v.current?.favorites ?? 0) })), waitMin: window.minMin, waitMax: window.maxMin });
      if (r && r.ok === false) setSendError(`${r.code ?? ''}${r.detail ? ` · ${r.detail}` : ''}`);
    } catch (e) {
      setSendError(e instanceof Error ? e.message : String(e));
    }
  };
  const title = !showProgress
    ? one
      ? t('repostNow.title')
      : t('repostNow.titleMany', { n: views.length })
    : allDone
      ? one
        ? t('repostNow.doneTitle')
        : t('repostNow.doneTitleMany')
      : anyActive
        ? t('repostNow.progressTitle')
        : anyUncertain
          ? t('repostNow.uncertainTitle')
          : anyFailed
            ? t('repostNow.failedTitle')
            : t('repostNow.progressTitle');
  return (
    <Modal open={open} onClose={close} title={title}>
      <div className="repost-now" data-testid="repost-now">
        {one && (
          <div className="repost-now__item">
            <strong>{one.current?.title ?? one.item.title}</strong>
            <span className="t-small t-muted">
              {[one.item.size ? t('repostNow.size', { size: one.item.size }) : null, (() => {
                const when = one.current?.listedAtKnown === false ? null : publishedAgo(one.current?.listedAt ?? null, Date.now());
                return when ? t('repostNow.published', { when: when.toLowerCase() }) : null;
              })()]
                .filter(Boolean)
                .join(' / ')}
            </span>
          </div>
        )}
        {!showProgress ? (
          <>
            <div className="repost-now__cost" data-testid="repost-now-cost">
              <p className="repost-now__warn">{one ? t('repostNow.reset') : t('repostNow.resetMany')}</p>
              <div className="repost-now__figures">
                <span>
                  <b className="num">{one ? (one.current?.views ?? '—') : totalViews}</b> {t('repostNow.views')}
                </span>
                <span>
                  <b className="num">{one ? (one.current?.favorites ?? '—') : totalFavs}</b> {t('repostNow.favs')}
                </span>
              </div>
            </div>
            {!one && (
              <ol className="repost-queue repost-queue--plan">
                {views.map((v) => (
                  <li key={v.item.id} className="repost-queue__row">
                    <span className="repost-queue__main">
                      <b>{v.current?.title ?? v.item.title}</b>
                    </span>
                    <span className="repost-queue__state num t-small t-muted">
                      {v.current?.views ?? '—'} {t('repostNow.views')} · {v.current?.favorites ?? '—'} {t('repostNow.favs')}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            <p className="t-small" style={{ margin: 0 }}>
              {t('repostNow.order')}
            </p>
            <fieldset className="repost-now__wait" data-testid="repost-now-wait">
              <legend className="t-caption">{t('repostNow.waitLegend')}</legend>
              <div className="row" style={{ gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <Field label={t('repostNow.waitMin')} htmlFor="repost-wait-min">
                  <Input id="repost-wait-min" inputMode="numeric" value={minText} onChange={(e) => setWin({ min: e.target.value, max: maxText })} style={{ width: 96 }} />
                </Field>
                <Field label={t('repostNow.waitMax')} htmlFor="repost-wait-max">
                  <Input id="repost-wait-max" inputMode="numeric" value={maxText} onChange={(e) => setWin({ min: minText, max: e.target.value })} style={{ width: 96 }} />
                </Field>
              </div>
              <p className="t-small t-muted" style={{ margin: 0 }}>
                {t('repostNow.offline')} {t('repostNow.waitHint')}
              </p>
            </fieldset>
            <UntilProven proof="repost">
              <p className="t-small t-faint" style={{ margin: 0 }}>
                {t('repostNow.experimental')}
              </p>
            </UntilProven>
            <div className="repost-now__actions">
              <Button variant="ghost" onClick={close}>
                {t('common.cancel')}
              </Button>
              <Button variant="primary" onClick={go}>
                {t('repostNow.confirm')}
              </Button>
            </div>
          </>
        ) : (
          <>
            {pause && <p className="t-small repost-now__error">{t('repostNow.paused', { detail: pause.detail })}</p>}
            {one ? (
              <>
                <ol className="repost-now__steps" aria-live="polite">
                  {(live ? stepStatuses(live) : NOW_STEPS.map((step, i) => ({ step, status: i === 0 ? ('run' as const) : ('wait' as const) }))).map((s) => (
                    <li key={s.step} data-step={s.step} data-status={s.status}>
                      <span className="repost-now__dot" aria-hidden="true" />
                      <span>
                        <b>{t(`repostNow.step.${s.step}`)}</b>
                        <span className="t-small t-muted">
                          {s.step === 'wait' && live?.outcome === 'WAITING' ? <span className="num" data-testid="repost-now-left">{t('repostNow.left', { left: leftText((live.waitUntil ?? now) - now) })}</span> : t(`repostNow.stepHint.${s.step}`)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
                {live?.outcome === 'DONE' && (
                  <p className="t-small" data-testid="repost-now-done" style={{ margin: 0 }}>
                    {t('repostNow.done')}
                  </p>
                )}
                {live?.outcome === 'UNCERTAIN' && (
                  <p className="t-small t-warn" data-testid="repost-now-uncertain" style={{ margin: 0 }}>
                    {t('repostNow.uncertain', { detail: live.detail ?? '' })}
                  </p>
                )}
                {(live?.outcome === 'FAILED' || sendError) && (
                  <p className="t-small repost-now__error" data-testid="repost-now-failed" style={{ margin: 0 }}>
                    {t('repostNow.failed', { detail: sendError ?? live?.detail ?? '' })}
                    {live?.resumable ? ` ${t('repostNow.resumable')}` : ''}
                  </p>
                )}
              </>
            ) : (
              <>
                <ol className="repost-queue" aria-live="polite" data-testid="repost-queue">
                  {views.map((v) => {
                    const j = mine.find((x) => x.itemId === v.item.id);
                    return j ? <QueueRow key={v.item.id} j={j} now={now} /> : null;
                  })}
                </ol>
                {allDone && (
                  <p className="t-small" data-testid="repost-now-done" style={{ margin: 0 }}>
                    {t('repostNow.doneMany', { n: mine.length })}
                  </p>
                )}
                {sendError && (
                  <p className="t-small repost-now__error" data-testid="repost-now-failed" style={{ margin: 0 }}>
                    {t('repostNow.failed', { detail: sendError })}
                  </p>
                )}
              </>
            )}
            <div className="repost-now__actions">
              {one && live?.outcome === 'WAITING' && (
                <Button variant="ghost" onClick={() => void send({ type: 'era:repost:skipWait', itemId: live.itemId })}>
                  {t('repostNow.skipWait')}
                </Button>
              )}
              {one && live?.newListingId && live.outcome === 'DONE' && (
                <Button variant="ghost" icon="external" onClick={() => window.open(`https://www.vinted.fr/items/${live.newListingId}`, '_blank', 'noopener')}>
                  {t('repostNow.openNew')}
                </Button>
              )}
              {one && live && (live.outcome === 'FAILED' || live.outcome === 'UNCERTAIN') && live.resumable && (
                <Button variant="ghost" onClick={() => void send({ type: 'era:repost:resume', itemId: live.itemId })}>
                  {t('repostNow.resume')}
                </Button>
              )}
              <Button variant={anyActive ? 'ghost' : 'primary'} onClick={close}>
                {anyActive ? t('repostNow.closeRunning') : t('common.close')}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/** Online on Vinted (a listing id ERA knows): the only articles « Republier maintenant » applies to. */
export function canRepostNow(v: ItemView | undefined): boolean {
  const id = v?.current?.platformListingId ?? null;
  return !!v && v.item.status === 'LISTED' && !!id && /^\d+$/.test(id);
}

/**
 * The gesture, wherever the seller is (stock, article, popup): one button, the dialog behind it. While this article's
 * repost runs or waits, the button says so and reopens the steps.
 */
export function RepostNowButton({ v, size, block, variant = 'primary' }: { v: ItemView; size?: 'sm'; block?: boolean; variant?: 'primary' | 'default' }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const live = useRepostNow(v.item.id);
  const active = !!live && isActive(live);
  const now = useNow(live?.outcome === 'WAITING');
  if (!canRepostNow(v) && !active && !open) return null;
  return (
    <>
      <Button size={size} block={block} variant={variant} icon="repost" onClick={() => setOpen(true)} data-testid="repost-now-button">
        {live?.outcome === 'WAITING' ? t('repostNow.waitingShort', { left: leftText((live.waitUntil ?? now) - now) }) : active ? t('repostNow.running') : t('repostNow.button')}
      </Button>
      <RepostNowDialog views={[v]} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** Several articles chosen in the stock: reposted one after the other, each with its own wait. */
export function RepostNowManyButton({ views }: { views: readonly ItemView[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ok = views.filter((v) => canRepostNow(v));
  const [chosen, setChosen] = useState<readonly ItemView[]>([]);
  if (ok.length < 2 && !open) return null;
  return (
    <>
      <Button
        variant="primary"
        icon="repost"
        onClick={() => {
          setChosen(ok);
          setOpen(true);
        }}
        data-testid="repost-now-many"
      >
        {t('repostNow.buttonMany', { n: ok.length })}
      </Button>
      <RepostNowDialog views={chosen} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
