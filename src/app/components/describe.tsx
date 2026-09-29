import { useEffect, useMemo, useState } from 'react';
import type { DescEditResult, EraMessage } from '@/data/adapters/vinted/protocol';
import { useI18n } from '@/i18n';
import { completeDescription } from '@/intelligence/listing-quality';
import { Modal, useErrorToast, useToast } from '@/ui/components/overlays';
import { Button, Flag } from '@/ui/components/primitives';
import { useEra } from '../state';
import { CopyButton } from './tools';

/**
 * Complete a live listing's description: the seller's text kept as it is, what is missing added below from what ERA
 * knows, "__" where only the seller can fill (a measure read on the garment). Copy it, or — EXPERIMENTAL, one
 * listing, on a click, once no blank is left — replace it on Vinted, read back before saying it is done.
 */
export function DescriptionModal({ itemId, open, onClose }: { itemId: string; open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const era = useEra();
  const toast = useToast();
  const errorToast = useErrorToast();
  const v = era.viewById.get(itemId);
  const listingId = v?.current?.platformListingId ?? null;
  const current = v?.current?.description ?? '';
  const proposal = useMemo(
    () => (v ? completeDescription(current, v.item, era.preps.get(itemId) ?? null, (k) => t(`workshop.m.${k}`)) : null),
    [v, current, era.preps, itemId, t],
  );
  const [text, setText] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open && proposal) {
      setText(proposal.text);
      setConfirming(false);
    }
  }, [open, proposal]);
  if (!v || !proposal) return null;
  const blanks = (text.match(/__/g) ?? []).length;
  const unchanged = text.trim() === current.trim();
  const canSend = era.mode === 'real' && !!listingId && /^\d+$/.test(listingId) && blanks === 0 && !unchanged && text.trim().length > 0;

  const send = async () => {
    setBusy(true);
    let r: DescEditResult;
    try {
      r = (await browser.runtime.sendMessage({ type: 'era:desc:edit', platformListingId: listingId!, text } satisfies EraMessage)) as DescEditResult;
    } catch (e) {
      r = { ok: false, code: 'UNAVAILABLE', detail: `service worker : ${e instanceof Error ? e.message : String(e)}` };
    }
    setBusy(false);
    setConfirming(false);
    if (r.ok) {
      toast('success', t('describe.done'), t('describe.verified'));
      onClose();
    } else errorToast(r);
  };

  return (
    <Modal open={open} onClose={() => !busy && onClose()} title={t('describe.title')}>
      <p className="t-small t-muted">{v.item.title}</p>
      <details className="t-small">
        <summary style={{ cursor: 'pointer' }}>{t('describe.current', { n: current.trim().length })}</summary>
        <pre className="wdesc" style={{ marginTop: 6 }}>{current.trim() || t('describe.empty')}</pre>
      </details>
      <label className="stack" style={{ gap: 4 }}>
        <span className="t-small">
          {proposal.added.length ? t('describe.added', { what: proposal.added.map((a) => t(`describe.a.${a}`)).join(', ') }) : t('describe.nothing')}
        </span>
        <textarea className="input wdesc" rows={10} value={text} onChange={(e) => setText(e.target.value)} disabled={busy} aria-label={t('describe.proposal')} data-testid="describe-text" />
      </label>
      {blanks > 0 ? <p className="t-small t-warn">{t('describe.blanks', { n: blanks })}</p> : <p className="t-small t-faint">{t('describe.own')}</p>}
      {confirming && (
        <div className="stack" style={{ gap: 6 }}>
          <p className="t-small">
            <b>{t('describe.confirm')}</b>
          </p>
          <ul className="t-small t-faint stack" style={{ margin: 0, paddingLeft: 18 }}>
            <li>{t('describe.safe1')}</li>
            <li>{t('describe.safe2')}</li>
          </ul>
        </div>
      )}
      <div className="row wrap" style={{ justifyContent: 'flex-end', gap: 8 }}>
        <CopyButton text={text} />
        {listingId && /^\d+$/.test(listingId) && (
          <Button variant="ghost" icon="external" onClick={() => window.open(`https://www.vinted.fr/items/${listingId}/edit`, '_blank', 'noopener')}>
            {t('describe.open')}
          </Button>
        )}
        {era.mode === 'real' &&
          (confirming ? (
            <Button variant="primary" icon="check" loading={busy} disabled={!canSend} onClick={() => void send()}>
              {t('describe.send')}
            </Button>
          ) : (
            <Button variant="primary" icon="upload" disabled={!canSend} onClick={() => setConfirming(true)}>
              {t('describe.replace')} <Flag kind="EXPERIMENTAL" />
            </Button>
          ))}
      </div>
    </Modal>
  );
}
