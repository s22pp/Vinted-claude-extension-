import { useEffect, useState } from 'react';
import type { EraMessage } from '@/data/adapters/vinted/protocol';
import { useI18n } from '@/i18n';
import type { ItemView } from '@/intelligence/portfolio';
import { NOW_STEPS, REPOST_NOW_KEY, type RepostNow, publishedAgo, stepStatuses } from '@/intelligence/repost-now';
import { Modal } from '@/ui/components/overlays';
import { Button } from '@/ui/components/primitives';
import '@/ui/styles/repost-now.css';

/** A repost takes a few minutes at most (the writes are spaced); past this, one still « en cours » was interrupted. */
const STALE_MS = 15 * 60_000;

/** The repost under way (or the last one) for this article, as the background writes it. */
export function useRepostNow(itemId: string): RepostNow | null {
  const [r, setR] = useState<RepostNow | null>(null);
  useEffect(() => {
    let alive = true;
    const read = (v: unknown) => {
      const x = v as RepostNow | undefined;
      if (alive) setR(x && x.itemId === itemId ? x : null);
    };
    void browser.storage.session
      .get(REPOST_NOW_KEY)
      .then((v) => read(v[REPOST_NOW_KEY]))
      .catch(() => undefined);
    const on = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === 'session' && REPOST_NOW_KEY in changes) read(changes[REPOST_NOW_KEY]!.newValue);
    };
    browser.storage.onChanged.addListener(on);
    return () => {
      alive = false;
      browser.storage.onChanged.removeListener(on);
    };
  }, [itemId]);
  return r;
}

/**
 * « Republier maintenant »: the cost of the gesture first (views and favourites the old listing loses), the seller's
 * decision, then the three steps live — from the stock, the article or the popup, whether the Pilote is on or off.
 * The dialog can be closed: the repost goes on, and its state stays on the article.
 */
export function RepostNowDialog({ v, open, onClose }: { v: ItemView; open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const raw = useRepostNow(v.item.id);
  // Still « en cours » long after any repost ends (Chrome closed, extension reloaded): said, never left spinning.
  const live = raw && raw.outcome === 'RUNNING' && Date.now() - raw.startedAt > STALE_MS ? { ...raw, outcome: 'FAILED' as const, detail: t('repostNow.stale'), resumable: false } : raw;
  const [started, setStarted] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const running = live?.outcome === 'RUNNING';
  const showProgress = started || running;
  const views = v.current?.views ?? null;
  const favs = v.current?.favorites ?? null;
  const when = v.current?.listedAtKnown === false ? null : publishedAgo(v.current?.listedAt ?? null, Date.now());
  const close = () => {
    if (!running) {
      setStarted(false);
      setSendError(null);
    }
    onClose();
  };
  const go = async () => {
    setStarted(true);
    setSendError(null);
    try {
      const r = (await browser.runtime.sendMessage({ type: 'era:repost:now', itemId: v.item.id, acceptFavourites: Math.max(0, favs ?? 0) } satisfies EraMessage)) as RepostNow | { ok: false; code: string; detail?: string };
      if (r && 'ok' in r && r.ok === false) setSendError(`${r.code}${r.detail ? ` · ${r.detail}` : ''}`);
    } catch (e) {
      setSendError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <Modal open={open} onClose={close} title={showProgress ? t('repostNow.progressTitle') : t('repostNow.title')}>
      <div className="repost-now" data-testid="repost-now">
        <div className="repost-now__item">
          <strong>{v.current?.title ?? v.item.title}</strong>
          <span className="t-small t-muted">{[v.item.size ? t('repostNow.size', { size: v.item.size }) : null, when ? t('repostNow.published', { when: when.toLowerCase() }) : null].filter(Boolean).join(' / ')}</span>
        </div>
        {!showProgress ? (
          <>
            <div className="repost-now__cost" data-testid="repost-now-cost">
              <p className="repost-now__warn">{t('repostNow.reset')}</p>
              <div className="repost-now__figures">
                <span>
                  <b className="num">{views ?? '—'}</b> {t('repostNow.views')}
                </span>
                <span>
                  <b className="num">{favs ?? '—'}</b> {t('repostNow.favs')}
                </span>
              </div>
            </div>
            <p className="t-small" style={{ margin: 0 }}>
              {t('repostNow.check')}
            </p>
            <p className="t-small t-faint" style={{ margin: 0 }}>
              {t('repostNow.experimental')}
            </p>
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
            <ol className="repost-now__steps" aria-live="polite">
              {(live ? stepStatuses(live) : NOW_STEPS.map((step, i) => ({ step, status: i === 0 ? ('run' as const) : ('wait' as const) }))).map((s) => (
                <li key={s.step} data-step={s.step} data-status={s.status}>
                  <span className="repost-now__dot" aria-hidden="true" />
                  <span>
                    <b>{t(`repostNow.step.${s.step}`)}</b>
                    <span className="t-small t-muted">{t(`repostNow.stepHint.${s.step}`)}</span>
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
            <div className="repost-now__actions">
              {live?.newListingId && live.outcome !== 'RUNNING' && (
                <Button variant="ghost" icon="external" onClick={() => window.open(`https://www.vinted.fr/items/${live.newListingId}`, '_blank', 'noopener')}>
                  {t('repostNow.openNew')}
                </Button>
              )}
              {live?.outcome === 'FAILED' && live.resumable && (
                <Button variant="ghost" onClick={go}>
                  {t('repostNow.resume')}
                </Button>
              )}
              <Button variant={running ? 'ghost' : 'primary'} onClick={close}>
                {running ? t('repostNow.closeRunning') : t('common.close')}
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
 * repost runs, the button says so and reopens the steps.
 */
export function RepostNowButton({ v, size, block, variant = 'primary' }: { v: ItemView; size?: 'sm'; block?: boolean; variant?: 'primary' | 'default' }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const live = useRepostNow(v.item.id);
  const running = live?.outcome === 'RUNNING' && Date.now() - live.startedAt <= STALE_MS;
  if (!canRepostNow(v) && !running && !open) return null;
  return (
    <>
      <Button size={size} block={block} variant={variant} icon="repost" onClick={() => setOpen(true)} data-testid="repost-now-button">
        {running ? t('repostNow.running') : t('repostNow.button')}
      </Button>
      <RepostNowDialog v={v} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
