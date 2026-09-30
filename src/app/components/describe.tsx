import { useEffect, useMemo, useState } from 'react';
import type { DescEditResult, EraMessage } from '@/data/adapters/vinted/protocol';
import { useI18n } from '@/i18n';
import { completeDescription } from '@/intelligence/listing-quality';
import { Modal, useErrorToast, useToast } from '@/ui/components/overlays';
import { Button } from '@/ui/components/primitives';
import { useEra } from '../state';
import { CopyButton } from './tools';
import { RouteFlag } from './route-flag';
import { DraftIssues, factsOf, useGeminiConfig } from './gemini';
import { geminiWrite } from '@/data/gemini';
import { checkDraft, cleanDraft, descriptionRequest, factLines, nothingToAdd } from '@/intelligence/ai-draft';
import { replyContextOf } from '../reply-kit';

/**
 * Complete a live listing's description: the seller's text kept as it is, what is missing added below from what ERA
 * knows, "__" where only the seller can fill (a measure read on the garment). Copy it, or — EXPERIMENTAL, one
 * listing, on a click, once no blank is left — replace it on Vinted, read back before saying it is done.
 */
export function DescriptionModal({ queue, startId, onClose }: { queue: readonly string[]; startId: string; onClose: () => void }) {
  const { t, money } = useI18n();
  const era = useEra();
  const toast = useToast();
  const errorToast = useErrorToast();
  const [itemId, setItemId] = useState(startId);
  const v = era.viewById.get(itemId);
  const listingId = v?.current?.platformListingId ?? null;
  const current = v?.current?.description ?? '';
  const proposal = useMemo(
    () => (v ? completeDescription(current, v.item, era.preps.get(itemId) ?? null, (k) => t(`workshop.m.${k}`)) : null),
    [v, current, era.preps, itemId, t],
  );
  // What the seller typed is theirs: a data refresh while the window is open never puts the proposal back.
  const [edited, setEdited] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const gemini = useGeminiConfig();
  const [aiUsed, setAiUsed] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [ack, setAck] = useState(false);
  useEffect(() => {
    setEdited(null);
    setConfirming(false);
    setAiUsed(false);
    setAck(false);
  }, [itemId]);
  if (!v || !proposal) return null;
  const text = edited ?? proposal.text;
  const setText = setEdited;
  const blanks = (text.match(/__/g) ?? []).length;
  const unchanged = text.trim() === current.trim();
  const intel = era.intelById.get(itemId) ?? null;
  const facts = intel ? factsOf(intel, replyContextOf(intel, era.preps, era.model, { t, money }), era.preps.get(itemId)?.material.trim() || v.item.material || null) : null;
  // A text Gemini wrote in: what it says beyond ERA's facts and the seller's own text is flagged, to be acknowledged.
  const issues = aiUsed && facts ? checkDraft(text, `${factLines(facts).join('\n')}\n${current}`, v.item.brand) : [];
  const canSend = era.mode === 'real' && !!listingId && /^\d+$/.test(listingId) && blanks === 0 && !unchanged && text.trim().length > 0 && (issues.length === 0 || ack);
  const writeWithGemini = async () => {
    if (!facts) return;
    setAiBusy(true);
    const r = await geminiWrite(descriptionRequest(facts, current));
    setAiBusy(false);
    if (!r.ok) return toast('error', t('gemini.failed'), r.detail);
    const added = cleanDraft(r.text);
    if (nothingToAdd(added)) return toast('info', t('gemini.nothing'), t('gemini.nothingHint'));
    setEdited(current.trim() ? `${current.trim()}\n\n${added}` : added);
    setAiUsed(true);
    setAck(false);
    setConfirming(false);
  };
  const next = queue[queue.indexOf(itemId) + 1] ?? null;
  const position = queue.indexOf(itemId) + 1;

  const send = async () => {
    setBusy(true);
    let r: DescEditResult;
    try {
      r = (await browser.runtime.sendMessage({ type: 'era:desc:edit', platformListingId: listingId!, text, expectBefore: current } satisfies EraMessage)) as DescEditResult;
    } catch (e) {
      r = { ok: false, code: 'UNAVAILABLE', detail: `service worker : ${e instanceof Error ? e.message : String(e)}` };
    }
    setBusy(false);
    setConfirming(false);
    if (r.ok) {
      toast('success', t('describe.done'), t('describe.verified'));
      // The next listing to complete, right away; the last one closes the window.
      if (next) setItemId(next);
      else onClose();
    } else errorToast(r);
  };

  return (
    <Modal open onClose={() => !busy && onClose()} title={t('describe.title')}>
      <p className="t-small t-muted">
        {v.item.title}
        {queue.length > 1 && position > 0 && <span className="t-faint"> · {t('describe.position', { n: position, total: queue.length })}</span>}
      </p>
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
      {aiUsed && <DraftIssues issues={issues} ack={ack} onAck={setAck} />}
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
        {next && (
          <Button variant="ghost" icon="chevronRight" disabled={busy} onClick={() => setItemId(next)}>
            {t('describe.next')}
          </Button>
        )}
        {gemini && facts && (
          <Button variant="ghost" icon="edit" loading={aiBusy} disabled={busy} onClick={() => void writeWithGemini()}>
            {t('gemini.writeDesc')}
          </Button>
        )}
        {(issues.length === 0 || ack) && <CopyButton text={text} />}
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
              {t('describe.replace')} <RouteFlag kinds={['DESCRIPTION']} />
            </Button>
          ))}
      </div>
    </Modal>
  );
}
