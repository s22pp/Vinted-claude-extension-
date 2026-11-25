import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import type { BudgetStatus, EraMessage } from '@/data/adapters/vinted/protocol';
import { budgetStatus } from '@/data/adapters/vinted/vinted-adapter';
import { isUnlimited } from '@/data/budget-plan';
import { db } from '@/data/db';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import { type AutoConfig, FAV_QUEUE_KEY, type FavMode, type FavQueued } from '@/intelligence/automation';
import { type QueueEntry, controlQueue, dueText } from '@/intelligence/control-room';
import { FOLLOWED_KEY, FOLLOW_MAX_H, followUpCandidates } from '@/intelligence/follow-up';
import { PILOT_KEY, type PilotConfig, nextPilotAt, pilotConfig } from '@/intelligence/pilot';
import { useRepostJobs } from './repost-now';

/** The clock, ticking each second only while something on screen counts down. */
function useTick(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [on]);
  return now;
}

/** The session's requests and any Vinted block, followed live. */
function useBudget(): BudgetStatus | null {
  const [b, setB] = useState<BudgetStatus | null>(null);
  useEffect(() => {
    const load = () => void budgetStatus().then(setB);
    load();
    const on = (changes: Record<string, unknown>, area: string) => {
      if ((area === 'session' && 'eraBudget' in changes) || (area === 'local' && 'eraHalt' in changes)) load();
    };
    browser.storage.onChanged.addListener(on);
    return () => browser.storage.onChanged.removeListener(on);
  }, []);
  return b;
}

const DONE_KINDS = new Set(['FAV_MESSAGE', 'FAV_OFFER', 'FAV_BUNDLE', 'OFFER_ACCEPT', 'OFFER_REJECT', 'OFFER_COUNTER', 'DELIVERED_MESSAGE', 'FOLLOW_UP', 'REPLY', 'REPOST', 'DELETE', 'PUBLISH', 'PRICE', 'LABEL']);

/**
 * The Pilote as a control room, three ruled columns: the rules switched on (each applied at once), what ERA will do
 * next and when (with « Annuler » where it can be undone), and what it did — with the session's health: requests sent,
 * and a coral « pause de sécurité » while Vinted has asked for one.
 */
export function ControlRoom({ cfg, onChange }: { cfg: AutoConfig; onChange: (patch: (c: AutoConfig) => AutoConfig) => Promise<void> }) {
  const { t } = useI18n();
  const reposts = useRepostJobs();
  const fav = useLiveQuery(() => repo.getSetting<FavQueued[]>(FAV_QUEUE_KEY, []), []) ?? [];
  const pilot = pilotConfig(useLiveQuery(() => repo.getSetting<Partial<PilotConfig> | null>(PILOT_KEY, null), []));
  const followUps =
    useLiveQuery(async () => {
      if (!cfg.followUp.enabled) return [];
      const now = Date.now();
      const followed = new Set((await repo.getSetting<string[]>(FOLLOWED_KEY, [])) ?? []);
      return followUpCandidates(await db.contacts.where('at').above(now - FOLLOW_MAX_H * 3_600_000).toArray(), followed, now);
    }, [cfg.followUp.enabled]) ?? [];
  const journal = useLiveQuery(async () => (await db.autoLog.orderBy('at').reverse().limit(80).toArray()).filter((r) => r.ok && !r.dryRun && DONE_KINDS.has(r.kind)).slice(0, 8), []) ?? [];
  const b = useBudget();
  const live = fav.length > 0 || followUps.length > 0 || reposts.some((r) => r.outcome === 'WAITING') || pilot.enabled;
  const now = useTick(live);
  const queue = controlQueue({ fav: fav.filter((f) => f.dueAt > now - 2 * 3_600_000), followUps, reposts, nextRound: pilot.enabled ? nextPilotAt(now, pilot.hours) : null, now });

  const offerOn = cfg.fav.enabled && cfg.fav.mode !== 'MESSAGE';
  const messageOn = cfg.fav.enabled && cfg.fav.mode !== 'OFFER';
  const favMode = (offer: boolean, message: boolean): { enabled: boolean; mode: FavMode } => ({ enabled: offer || message, mode: offer && message ? 'MESSAGE_OFFER' : offer ? 'OFFER' : 'MESSAGE' });

  const cancel = async (e: QueueEntry) => {
    const c = e.cancel;
    if (!c) return;
    if (c.type === 'fav') {
      const seen = (await repo.getSetting<string[]>('autoFavSeen', [])) ?? [];
      await repo.setSetting('autoFavSeen', [...seen, c.key].slice(-1000));
      await repo.setSetting(FAV_QUEUE_KEY, fav.filter((f) => f.key !== c.key));
    } else if (c.type === 'followup') {
      const done = (await repo.getSetting<string[]>(FOLLOWED_KEY, [])) ?? [];
      await repo.setSetting(FOLLOWED_KEY, [...done, c.conversationId].slice(-1000));
    } else await browser.runtime.sendMessage({ type: 'era:repost:forget', itemId: c.itemId } satisfies EraMessage).catch(() => undefined);
  };

  const rule = (id: string, on: boolean, label: string, hint: string, set: (v: boolean) => Promise<void>, extra?: React.ReactNode) => (
    <li className="ctrl__rule" data-on={on}>
      <label className="ctrl__switch" htmlFor={id}>
        <input id={id} type="checkbox" role="switch" checked={on} onChange={(e) => void set(e.target.checked)} />
        <span className="ctrl__track" aria-hidden="true" />
        <span className="ctrl__rule-text">
          <span className="ctrl__rule-label">{label}</span>
          <span className="ctrl__rule-hint">{hint}</span>
        </span>
      </label>
      {extra}
    </li>
  );

  const halted = !!b?.halted;
  const sent = Object.values(b?.uses ?? {}).reduce<number>((s, n) => s + (n ?? 0), 0);
  return (
    <section className="ctrl span-12" aria-label={t('ctrl.title')} data-testid="control-room">
      <div className="ctrl__col" data-testid="ctrl-rules">
        <h2 className="ctrl__head">{t('ctrl.rules')}</h2>
        <ul className="ctrl__rules">
          {rule(
            'ctrl-offer',
            offerOn,
            t('ctrl.offer'),
            t('ctrl.offerHint', { lo: cfg.fav.minDelayMin, hi: cfg.fav.minDelayMin + 8 }),
            (v) => onChange((c) => ({ ...c, fav: { ...c.fav, ...favMode(v, messageOn) } })),
            offerOn && (
              <span className="ctrl__pcts" role="group" aria-label={t('ctrl.pct')}>
                {[10, 15].map((p) => (
                  <button key={p} type="button" aria-pressed={cfg.fav.discountPct === p} onClick={() => void onChange((c) => ({ ...c, fav: { ...c.fav, discountPct: p } }))}>
                    −{p} %
                  </button>
                ))}
              </span>
            ),
          )}
          {rule('ctrl-message', messageOn, t('ctrl.message'), t('ctrl.messageHint'), (v) => onChange((c) => ({ ...c, fav: { ...c.fav, ...favMode(offerOn, v) } })))}
          {rule('ctrl-offers', cfg.offers.enabled, t('ctrl.offers'), t('ctrl.offersHint', { accept: cfg.offers.acceptPct, counter: cfg.offers.counterPct }), (v) => onChange((c) => ({ ...c, offers: { ...c.offers, enabled: v } })))}
          {rule('ctrl-delivered', cfg.delivered.enabled, t('ctrl.delivered'), t('ctrl.deliveredHint'), (v) => onChange((c) => ({ ...c, delivered: { ...c.delivered, enabled: v } })))}
          {rule('ctrl-follow', cfg.followUp.enabled, t('ctrl.follow'), t('ctrl.followHint'), (v) => onChange((c) => ({ ...c, followUp: { enabled: v } })))}
        </ul>
      </div>
      <div className="ctrl__col" data-testid="ctrl-queue">
        <h2 className="ctrl__head">{t('ctrl.queue')}</h2>
        {queue.length === 0 ? (
          <p className="ctrl__empty">{t('ctrl.queueEmpty')}</p>
        ) : (
          <ol className="ctrl__list" aria-live="polite">
            {queue.map((e) => (
              <li key={e.id} className="ctrl__item" data-kind={e.kind} data-running={e.running || undefined}>
                <span className="ctrl__what">
                  <b>{e.action}</b> → {e.target}
                </span>
                <span className="ctrl__when num">{dueText(e.at, now, e.running)}</span>
                {e.cancel && (
                  <button type="button" className="ctrl__cancel" onClick={() => void cancel(e)} aria-label={`${t('ctrl.cancel')} : ${e.action} → ${e.target}`}>
                    {t('ctrl.cancel')}
                  </button>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className="ctrl__col" data-testid="ctrl-health">
        <h2 className="ctrl__head">{t('ctrl.health')}</h2>
        {halted ? (
          <p className="ctrl__halt" role="status" data-testid="ctrl-halt">
            <b>{t('ctrl.haltTitle')}</b> {t('ctrl.halt', { at: b?.haltedUntil ? new Date(b.haltedUntil).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—' })}
          </p>
        ) : (
          <div className="ctrl__gauge">
            <span className="ctrl__gauge-n num">{b && !isUnlimited(b.remaining) ? t('ctrl.budgetPrudent', { n: sent, total: sent + b.remaining }) : t('ctrl.budgetDirect', { n: sent })}</span>
            <span className="ctrl__gauge-bar" aria-hidden="true">
              <i style={{ width: b && !isUnlimited(b.remaining) ? `${Math.min(100, (sent / Math.max(1, sent + b.remaining)) * 100)}%` : `${Math.min(100, sent)}%` }} />
            </span>
            <span className="ctrl__gauge-mode">{b?.mode === 'PRUDENT' ? t('ctrl.modePrudent') : t('ctrl.modeDirect')}</span>
          </div>
        )}
        {journal.length === 0 ? (
          <p className="ctrl__empty">{t('ctrl.journalEmpty')}</p>
        ) : (
          <ol className="ctrl__list">
            {journal.map((r) => (
              <li key={r.id} className="ctrl__item ctrl__item--log">
                <span className="ctrl__when num">{new Date(r.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                <span className="ctrl__what">
                  <b>{t(`auto.kind.${r.kind}`)}</b> · {r.target}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
