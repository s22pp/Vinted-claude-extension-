import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import type { EraMessage, PendingRepost, RepostFinishResult, RepostResult, PublishResult } from '@/data/adapters/vinted/protocol';
import { db } from '@/data/db';
import { repo } from '@/data/repo';
import { isLiveListing } from '@/domain/status';
import { useI18n } from '@/i18n';
import type { ItemView } from '@/intelligence/portfolio';
import { Modal, useErrorToast, useToast } from '@/ui/components/overlays';
import { Button, Card, Field, Input } from '@/ui/components/primitives';
import { useEra } from '../state';
import { useMoneyField } from './forms';
import { dueStep } from './markdown';
import { vintedIdOf } from './vinted-price';
import { RouteFlag } from './route-flag';
import { UntilProven } from './verify-flag';
import { ChooseRepostsModal } from './repost-list';

/** Same key as the background's (vinted-repost.ts); read here without pulling the Vinted write code in. */
const PENDING_KEY = 'pendingReposts';

export function usePendingRepost(itemId: string): PendingRepost | null {
  const row = useLiveQuery(() => db.settings.get(PENDING_KEY), []);
  const list = Array.isArray(row?.value) ? (row.value as PendingRepost[]) : [];
  return list.find((p) => p.itemId === itemId) ?? null;
}

const openOnVinted = (id: string) => window.open(`https://www.vinted.fr/items/${id}/edit`, '_blank', 'noopener');

/**
 * "Republier sans rien perdre": a draft copy, same fields and photos. A listing with favourites is the seller's call: the
 * loss is said in numbers and accepted once (for that many favourites at most), then the copy is made now — or the
 * article goes on the « À republier » list, for the Pilote's next rounds.
 */
export function RepostButton({ v }: { v: ItemView }) {
  const { t, money } = useI18n();
  const toast = useToast();
  const errorToast = useErrorToast();
  const era = useEra();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [toList, setToList] = useState(false);
  const price = useMoneyField(v.askPrice);
  const pending = usePendingRepost(v.item.id);
  const favs = v.current?.favorites ?? null;
  if (!vintedIdOf(v) || v.item.status !== 'LISTED' || pending) return null;
  // The planned price cut due now, offered for the copy (never applied without the seller choosing it).
  const cut = dueStep(era.markdown.get(v.item.id));
  const newPrice = price.cents !== null && price.cents !== v.askPrice ? price.cents : null;
  const hasFavs = favs !== null && favs > 0;
  return (
    <>
      <Button icon="repost" title={hasFavs ? t('repost.hasFavs', { n: favs }) : undefined} onClick={() => setOpen(true)}>
        {t('repost.button')}
      </Button>
      <ChooseRepostsModal views={[v]} open={toList} onClose={() => setToList(false)} />
      <Modal open={open} onClose={() => !busy && setOpen(false)} title={t('repost.title')}>
        <p className="t-small t-muted">{v.item.title}</p>
        {hasFavs && (
          <div className="stack" style={{ gap: 8, padding: 12, borderRadius: 12, border: '1px solid var(--amber)', background: 'var(--amber-soft)' }} data-testid="repost-loss">
            <p className="t-small" style={{ margin: 0 }}>
              {t('repost.loss', { favs: favs ?? 0, views: v.current?.views ?? 0 })}
            </p>
            <label className="row t-small" style={{ gap: 8, alignItems: 'flex-start' }}>
              <input type="checkbox" className="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} style={{ marginTop: 2 }} />
              <span>{t('repostList.accept', { favs: favs ?? 0 })}</span>
            </label>
          </div>
        )}
        <p className="t-small">{t('repost.intro')}</p>
        <ol className="t-small stack" style={{ margin: 0, paddingLeft: 18 }}>
          <li>{t('repost.step1')}</li>
          <li>{t('repost.step2')}</li>
          <li>{t('repost.step3')}</li>
        </ol>
        <Field label={t('repost.price')} htmlFor="repost-price" error={price.invalid ? t('add.invalidAmount') : null}>
          <Input id="repost-price" money value={price.raw} onChange={(e) => price.setRaw(e.target.value)} disabled={busy} style={{ width: 140 }} />
        </Field>
        {cut && cut.targetCents !== price.cents && (
          <p className="t-small t-muted row wrap" style={{ gap: 8 }}>
            <span>{t('repost.cut', { price: money(cut.targetCents) })}</span>
            <Button size="sm" variant="ghost" onClick={() => price.setRaw(String(cut.targetCents / 100).replace('.', ','))}>
              {t('repost.useCut')}
            </Button>
          </p>
        )}
        <p className="t-small t-faint">{newPrice !== null ? t('repost.priceNew', { from: money(v.askPrice ?? 0), to: money(newPrice) }) : t('repost.priceSame')}</p>
        <p className="t-small t-faint">{t('repost.budget')}</p>
        <p className="t-small t-faint row" style={{ gap: 6 }}>
          <RouteFlag kinds={['REPOST', 'DELETE']} />
          <UntilProven proof="repost">{t('repost.experimental')}</UntilProven>
        </p>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="ghost"
            icon="repost"
            disabled={busy}
            onClick={() => {
              setOpen(false);
              setToList(true);
            }}
          >
            {t('repost.toList')}
          </Button>
          <Button
            variant="primary"
            icon="check"
            loading={busy}
            disabled={price.invalid || (hasFavs && !accepted)}
            onClick={async () => {
              setBusy(true);
              try {
                const r = (await browser.runtime.sendMessage({ type: 'era:repost:create', itemId: v.item.id, ...(newPrice !== null ? { priceCents: newPrice } : {}), ...(hasFavs ? { acceptFavourites: favs ?? 0 } : {}) } satisfies EraMessage)) as RepostResult;
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
  const [publishing, setPublishing] = useState(false);
  // « Republier maintenant » (old listing already deleted, the copy waiting its time) is followed in its own dialog.
  if (!pending || pending.deletedAt) return null;
  const live = v.listings.some((l) => l.platformListingId === pending.draftId && isLiveListing(l.status));
  const text = pending.deleteSentAt ? t('repost.pendingSent') : live ? t('repost.pendingLive') : t('repost.pendingDraft', { date: date(pending.at) });
  return (
    <Card title={t('repost.pendingTitle')} icon="repost" tone="cobalt" actions={<RouteFlag kinds={['REPOST', 'DELETE']} />}>
      <div className="stack-3" data-testid="repost-pending">
        <p className="t-small">{text}</p>
        <div className="row wrap" style={{ gap: 8 }}>
          {!live && !pending.deleteSentAt && (
            <Button
              size="sm"
              variant="primary"
              icon="upload"
              loading={publishing}
              disabled={publishing}
              onClick={async () => {
                setPublishing(true);
                try {
                  const r = (await browser.runtime.sendMessage({ type: 'era:draft:publish', draftId: pending.draftId, itemId: v.item.id } satisfies EraMessage)) as PublishResult;
                  if (!r.ok) errorToast(r);
                  else toast('success', t('repost.copyPublished'), t('repost.copyPublishedHint'));
                } finally {
                  setPublishing(false);
                }
              }}
            >
              {t('repost.publishCopy')}
            </Button>
          )}
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
