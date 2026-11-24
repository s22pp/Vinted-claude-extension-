import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n';
import { LIVE_ROUND_KEY, type LiveRound, ROUND_STEPS, type RoundStep, currentStep, progress, showLive } from '@/intelligence/round-live';
import '@/ui/styles/round-live.css';

const hhmm = (t: number) => {
  const d = new Date(t);
  return `${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`;
};

/**
 * The round, live, on the Pilote panel: each step lights up as ERA does it, what it did appears as soon as it is done,
 * and the Vinted requests it uses tick up. Read from what the background writes as the round goes (nothing guessed);
 * a finished round stays a quarter of an hour, then the panel's usual summary takes over.
 */
export function RoundLive({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const [live, setLive] = useState<LiveRound | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let alive = true;
    void browser.storage.session
      .get(LIVE_ROUND_KEY)
      .then((v) => alive && setLive((v[LIVE_ROUND_KEY] as LiveRound | undefined) ?? null))
      .catch(() => undefined);
    const on = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === 'session' && LIVE_ROUND_KEY in changes) {
        setLive((changes[LIVE_ROUND_KEY]!.newValue as LiveRound | undefined) ?? null);
        setNow(Date.now());
      }
    };
    browser.storage.onChanged.addListener(on);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      alive = false;
      browser.storage.onChanged.removeListener(on);
      clearInterval(tick);
    };
  }, []);
  if (!showLive(live, now)) return null;
  const running = live.endedAt === null;
  const cur = currentStep(live);
  const { done, total } = progress(live);
  const title = running
    ? t(live.dryRun ? 'pilot.live.simRunning' : 'pilot.live.running')
    : live.stopped
      ? t('pilot.live.stoppedAt', { at: hhmm(live.endedAt!) })
      : t(live.dryRun ? 'pilot.live.simDoneAt' : 'pilot.live.doneAt', { at: hhmm(live.endedAt!) });
  const stateText = (s: RoundStep) => {
    const x = live.steps[s];
    return t(`pilot.live.state.${x.state}`) + (x.state === 'DONE' && x.n !== null ? ` · ${x.n}` : '');
  };
  return (
    <section className={`round-live${compact ? ' round-live--compact' : ''}`} data-testid="round-live" data-running={running ? 'true' : 'false'} aria-label={t('pilot.live.aria')}>
      <div className="row" style={{ gap: 10, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <strong className="t-small">{title}</strong>
        <span className="t-small t-faint num" data-testid="round-live-calls">
          {t('pilot.live.calls', { n: live.calls })} · {t('pilot.live.steps', { done, total })}
        </span>
      </div>
      <div className="round-live__bar" aria-hidden="true">
        <span style={{ width: `${Math.round((done / total) * 100)}%` }} />
      </div>
      <ol className="round-live__track">
        {ROUND_STEPS.map((s) => {
          const x = live.steps[s];
          return (
            <li key={s} className="round-live__step" data-step={s} data-state={x.state} aria-label={`${t(`pilot.live.step.${s}`)} : ${stateText(s)}`} title={`${t(`pilot.live.step.${s}`)} : ${stateText(s)}`}>
              <span className="round-live__dot" aria-hidden="true">
                {x.state === 'DONE' ? (x.n !== null ? x.n : '✓') : x.state === 'STOP' ? '!' : x.state === 'SKIP' ? '–' : ''}
              </span>
              <span className="round-live__label">{t(`pilot.live.step.${s}`)}</span>
            </li>
          );
        })}
      </ol>
      <p className="t-small t-faint" style={{ margin: 0 }} aria-live="polite">
        {running ? (cur ? t('pilot.live.now', { step: t(`pilot.live.step.${cur}`) }) : t('pilot.live.between')) : live.stopped ? t('pilot.live.why', { why: live.stopped }) : ''}
      </p>
    </section>
  );
}
