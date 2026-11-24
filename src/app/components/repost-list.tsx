import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import type { PendingRepost } from '@/data/adapters/vinted/protocol';
import { db } from '@/data/db';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import type { ItemView } from '@/intelligence/portfolio';
import { CHOSEN_REPOSTS_KEY, type ChosenFacts, type ChosenRepost, addChosen, lossOf, planChosen, removeChosen } from '@/intelligence/repost-choice';
import { Modal, useToast } from '@/ui/components/overlays';
import { Button, Card } from '@/ui/components/primitives';
import { useEra } from '../state';

/** The seller's « À republier » list, live. */
export function useChosen(): ChosenRepost[] {
  return useLiveQuery(() => repo.getSetting<ChosenRepost[]>(CHOSEN_REPOSTS_KEY, []), []) ?? [];
}

function usePending(): PendingRepost[] {
  const row = useLiveQuery(() => db.settings.get('pendingReposts'), []);
  return Array.isArray(row?.value) ? (row.value as PendingRepost[]) : [];
}

/** What the list needs to know of an article, from ERA's last import. */
export function factsOf(v: ItemView, pending: readonly PendingRepost[]): ChosenFacts {
  return {
    itemId: v.item.id,
    title: v.current?.title ?? v.item.title,
    status: v.item.status,
    live: v.current?.status === 'ACTIVE',
    favourites: v.current?.favorites ?? null,
    views: v.current?.views ?? null,
    pending: pending.some((p) => p.itemId === v.item.id),
  };
}

/** Can go on the list now: online on Vinted, neither reserved nor hidden, no copy already waiting. */
const repostable = (f: ChosenFacts) => f.status === 'LISTED' && f.live && !f.pending;

/**
 * Adding articles to the list: what a repost of them would lose, in numbers (favourites, views), accepted once by the
 * seller when there is anything to lose. The Pilote then reposts them one per round, in this order.
 */
export function ChooseRepostsModal({ views, open, onClose, onDone }: { views: readonly ItemView[]; open: boolean; onClose: () => void; onDone?: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const pending = usePending();
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const facts = views.map((v) => factsOf(v, pending));
  const ok = facts.filter(repostable);
  const skipped = facts.length - ok.length;
  const loss = lossOf(ok);
  const mustAccept = loss.favourites > 0;
  const close = () => {
    setAccepted(false);
    onClose();
  };
  return (
    <Modal open={open} onClose={() => !busy && close()} title={t('repostList.addTitle', { n: ok.length })}>
      <div className="stack-3" data-testid="choose-reposts">
        <p className="t-small">{t('repostList.addIntro')}</p>
        {ok.length > 0 && (
          <ul className="t-small stack" style={{ margin: 0, paddingLeft: 18, gap: 2, maxHeight: 180, overflow: 'auto' }}>
            {ok.map((f) => (
              <li key={f.itemId}>
                {f.title}
                {(f.favourites ?? 0) > 0 && <span className="t-warn"> · {t('repostList.favs', { n: f.favourites ?? 0 })}</span>}
                {f.views !== null && <span className="t-faint"> · {t('repostList.views', { n: f.views })}</span>}
              </li>
            ))}
          </ul>
        )}
        {skipped > 0 && <p className="t-small t-faint">{t('repostList.skipped', { n: skipped })}</p>}
        {ok.length > 0 &&
          (mustAccept ? (
            <div className="stack" style={{ gap: 8, padding: 12, borderRadius: 12, border: '1px solid var(--amber)', background: 'var(--amber-soft)' }} data-testid="repost-loss">
              <p className="t-small" style={{ margin: 0 }}>
                {t('repostList.loss', { favs: loss.favourites, n: loss.withFavourites, views: loss.views })}
              </p>
              <label className="row t-small" style={{ gap: 8, alignItems: 'flex-start' }}>
                <input type="checkbox" className="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} style={{ marginTop: 2 }} />
                <span>{t('repostList.accept', { favs: loss.favourites })}</span>
              </label>
            </div>
          ) : (
            <p className="t-small t-muted" data-testid="repost-loss">
              {t('repostList.noLoss', { views: loss.views })}
            </p>
          ))}
        {loss.unknown > 0 && <p className="t-small t-faint">{t('repostList.unknown', { n: loss.unknown })}</p>}
        <p className="t-small t-faint">{t('repostList.pace')}</p>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="ghost" onClick={close} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            icon="repost"
            loading={busy}
            disabled={ok.length === 0 || (mustAccept && !accepted)}
            onClick={async () => {
              setBusy(true);
              try {
                const list = await repo.getSetting<ChosenRepost[]>(CHOSEN_REPOSTS_KEY, []);
                await repo.setSetting(CHOSEN_REPOSTS_KEY, addChosen(list, ok, Date.now()));
                toast('success', t('repostList.added', { n: ok.length }), t('repostList.addedHint'));
                close();
                onDone?.();
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('repostList.add', { n: ok.length })}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** The list on the Pilote screen: the next one, those waiting (and why), those to confirm again; each can be taken off. */
export function ChosenRepostsCard() {
  const { t } = useI18n();
  const era = useEra();
  const list = useChosen();
  const pending = usePending();
  const [again, setAgain] = useState<ItemView | null>(null);
  if (!list.length || era.mode !== 'real') return null;
  const byId = new Map(era.views.map((v) => [v.item.id, v]));
  const facts = era.views.map((v) => factsOf(v, pending));
  const plan = planChosen(list, facts);
  const state = (itemId: string) => {
    if (plan.pick?.itemId === itemId) return { key: 'next', text: t('repostList.next') };
    const b = plan.blocked.find((x) => x.itemId === itemId);
    if (b?.why === 'MORE_FAVOURITES') return { key: 'again', text: t('repostList.again', { n: b.favourites ?? 0 }) };
    if (b?.why === 'NOT_LIVE') return { key: 'wait', text: t('repostList.notLive') };
    if (pending.some((p) => p.itemId === itemId)) return { key: 'copy', text: t('repostList.copying') };
    if (plan.drop.includes(itemId)) return { key: 'gone', text: t('repostList.gone') };
    return { key: 'queued', text: t('repostList.queued') };
  };
  return (
    <Card className="span-12" title={t('repostList.title', { n: list.length })} hint={t('repostList.hint')} icon="repost" tone="cyan">
      <ol className="stack" style={{ margin: 0, paddingLeft: 18, gap: 6 }} data-testid="chosen-reposts">
        {list.map((c) => {
          const v = byId.get(c.itemId);
          const s = state(c.itemId);
          return (
            <li key={c.itemId} data-state={s.key}>
              <span className="row wrap" style={{ gap: 8 }}>
                <span className="t-small grow">
                  <b>{v?.current?.title ?? v?.item.title ?? c.itemId}</b> <span className={s.key === 'again' ? 't-warn' : 't-faint'}>· {s.text}</span>
                  {c.acceptFavourites > 0 && <span className="t-faint"> · {t('repostList.acceptedFavs', { n: c.acceptFavourites })}</span>}
                </span>
                {s.key === 'again' && v && (
                  <Button size="sm" variant="ghost" onClick={() => setAgain(v)}>
                    {t('repostList.confirmAgain')}
                  </Button>
                )}
                <Button size="sm" variant="ghost" aria-label={t('repostList.removeAria', { title: v?.item.title ?? c.itemId })} onClick={async () => repo.setSetting(CHOSEN_REPOSTS_KEY, removeChosen(await repo.getSetting<ChosenRepost[]>(CHOSEN_REPOSTS_KEY, []), c.itemId))}>
                  {t('repostList.remove')}
                </Button>
              </span>
            </li>
          );
        })}
      </ol>
      <ChooseRepostsModal views={again ? [again] : []} open={!!again} onClose={() => setAgain(null)} />
    </Card>
  );
}
