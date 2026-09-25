import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import type { EraMessage, PendingRepost, RepostFinishResult, RepostResult } from '@/data/adapters/vinted/protocol';
import { db } from '@/data/db';
import { repo } from '@/data/repo';
import { isLiveListing } from '@/domain/status';
import { useI18n } from '@/i18n';
import type { ItemView } from '@/intelligence/portfolio';
import { Modal, useErrorToast, useToast } from '@/ui/components/overlays';
import { Button, Card, Flag } from '@/ui/components/primitives';
import { vintedIdOf } from './vinted-price';

/** Same key as the background's (vinted-repost.ts); read here without pulling the Vinted write code in. */
const PENDING_KEY = 'pendingReposts';

export function usePendingRepost(itemId: string): PendingRepost | null {
  const row = useLiveQuery(() => db.settings.get(PENDING_KEY), []);
  const list = Array.isArray(row?.value) ? (row.value as PendingRepost[]) : [];
  return list.find((p) => p.itemId === itemId) ?? null;
}

const openOnVinted = (id: string) => window.open(`https://www.vinted.fr/items/${id}/edit`, '_blank', 'noopener');

/** "Republier sans rien perdre": a draft copy, same fields and photos; refused when the listing has favourites. */
export function RepostButton({ v }: { v: ItemView }) {
  const { t } = useI18n();
  const toast = useToast();
  const errorToast = useErrorToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = usePendingRepost(v.item.id);
  const favs = v.current?.favorites ?? null;
  if (!vintedIdOf(v) || v.item.status !== 'LISTED' || pending) return null;
  const blocked = favs !== null && favs > 0;
  return (
    <>
      <Button icon="repost" disabled={blocked} title={blocked ? t('repost.hasFavs', { n: favs }) : undefined} onClick={() => setOpen(true)}>
        {t('repost.button')}
      </Button>
      <Modal open={open} onClose={() => !busy && setOpen(false)} title={t('repost.title')}>
        <p className="t-small t-muted">{v.item.title}</p>
        <p className="t-small">{t('repost.intro')}</p>
        <ol className="t-small stack" style={{ margin: 0, paddingLeft: 18 }}>
          <li>{t('repost.step1')}</li>
          <li>{t('repost.step2')}</li>
          <li>{t('repost.step3')}</li>
        </ol>
        <p className="t-small t-faint">{t('repost.budget')}</p>
        <p className="t-small t-faint row" style={{ gap: 6 }}>
          <Flag kind="EXPERIMENTAL" /> {t('repost.experimental')}
        </p>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            icon="check"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = (await browser.runtime.sendMessage({ type: 'era:repost:create', itemId: v.item.id } satisfies EraMessage)) as RepostResult;
                if (!r.ok) {
                  errorToast(r);
                  return;
                }
                setOpen(false);
                toast(
                  'success',
                  t('repost.created'),
                  r.photosBack !== null && r.photosBack !== r.photos ? t('repost.photosMismatch', { back: r.photosBack, n: r.photos }) : t('repost.createdHint', { n: r.photos }),
                );
                openOnVinted(r.draftId);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('repost.create')}
          </Button>
        </div>
      </Modal>
    </>
  );
}

/** A copy waiting: open it, then delete the old listing (checked again on Vinted), or give up. */
export function RepostPending({ v }: { v: ItemView }) {
  const { t, date } = useI18n();
  const toast = useToast();
  const errorToast = useErrorToast();
  const pending = usePendingRepost(v.item.id);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!pending) return null;
  const live = v.listings.some((l) => l.platformListingId === pending.draftId && isLiveListing(l.status));
  const text = pending.deleteSentAt ? t('repost.pendingSent') : live ? t('repost.pendingLive') : t('repost.pendingDraft', { date: date(pending.at) });
  return (
    <Card title={t('repost.pendingTitle')} icon="repost" tone="cobalt" actions={<Flag kind="EXPERIMENTAL" />}>
      <div className="stack-3" data-testid="repost-pending">
        <p className="t-small">{text}</p>
        <div className="row wrap" style={{ gap: 8 }}>
          <Button size="sm" variant="ghost" icon="external" onClick={() => openOnVinted(pending.draftId)}>
            {t('repost.openDraft')}
          </Button>
          <Button size="sm" variant={live ? 'primary' : 'default'} icon="x" onClick={() => setConfirm(true)}>
            {t('repost.deleteOld')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              const list = await repo.getSetting<PendingRepost[]>(PENDING_KEY, []);
              await repo.setSetting(PENDING_KEY, list.filter((p) => p.itemId !== v.item.id));
              toast('success', t('repost.dropped'), t('repost.droppedHint'));
            }}
          >
            {t('repost.drop')}
          </Button>
        </div>
      </div>
      <Modal open={confirm} onClose={() => !busy && setConfirm(false)} title={t('repost.deleteTitle')}>
        <p className="t-small t-muted">{pending.title}</p>
        <p className="t-small">{t('repost.deleteBody')}</p>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={() => setConfirm(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            icon="check"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = (await browser.runtime.sendMessage({ type: 'era:repost:finish', itemId: v.item.id } satisfies EraMessage)) as RepostFinishResult;
                if (!r.ok) {
                  errorToast(r);
                  return;
                }
                setConfirm(false);
                toast('success', t(r.verified ? 'repost.deleted' : 'repost.deletedUnverified'), t(r.verified ? 'repost.deletedHint' : 'repost.deletedUnverifiedHint'));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('repost.deleteOld')}
          </Button>
        </div>
      </Modal>
    </Card>
  );
}
