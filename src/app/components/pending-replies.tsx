import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import type { EraMessage } from '@/data/adapters/vinted/protocol';
import { REPLIES_PENDING_KEY } from '@/data/reply-agent';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import type { PendingReply } from '@/intelligence/buyer-messages';
import { useToast } from '@/ui/components/overlays';
import { Badge, Button, Card } from '@/ui/components/primitives';

/**
 * The buyers' messages ERA did not answer by itself, with its drafted answer when one is possible: read, edit, send —
 * from ERA, without opening Vinted. A problem with an order (refund, damage, lost parcel) never gets a machine answer:
 * the seller writes it here.
 */
export function PendingReplies() {
  const { t, relative } = useI18n();
  const list = useLiveQuery(() => repo.getSetting<PendingReply[]>(REPLIES_PENDING_KEY, []), []);
  if (!list) return null;
  return (
    <Card className="span-12" title={t('replies2.title', { n: list.length })} hint={t('replies2.hint')} icon="info" tone={list.length ? 'amber' : 'neutral'}>
      <div className="stack-3" data-testid="pending-replies">
        {list.length === 0 && <p className="t-small t-muted">{t('replies2.none')}</p>}
        {list.map((p) => (
          <PendingOne key={p.key} p={p} when={relative(p.at)} />
        ))}
      </div>
    </Card>
  );
}

function PendingOne({ p, when }: { p: PendingReply; when: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const [text, setText] = useState(p.draft ?? '');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      const r = (await browser.runtime.sendMessage({ type: 'era:reply:send', key: p.key, text } satisfies EraMessage)) as { ok: boolean; detail?: string };
      if (r.ok) toast('success', t('replies2.sent'), p.title ?? '');
      else toast('error', t('replies2.notSent'), r.detail ?? '');
    } catch (e) {
      toast('error', t('replies2.notSent'), e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack" style={{ gap: 8, paddingBottom: 12, borderBottom: '1px solid var(--border)' }} data-testid="pending-reply">
      <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
        <strong className="t-small">{p.title ?? t('replies2.conversation')}</strong>
        <Badge tone={p.why === 'SENSITIVE' ? 'coral' : 'amber'}>{t(`replies2.why.${p.why}`)}</Badge>
        <span className="t-small t-faint">{when}</span>
      </div>
      <blockquote className="t-small" style={{ margin: 0, paddingLeft: 10, borderLeft: '3px solid var(--border-strong, var(--border))', whiteSpace: 'pre-wrap' }}>
        {p.buyer}
      </blockquote>
      {p.issues?.length ? <p className="t-small t-warn">{t('replies2.issues', { list: p.issues.join(' · ') })}</p> : null}
      <textarea className="input" rows={3} style={{ height: 'auto', resize: 'vertical' }} value={text} placeholder={t('replies2.placeholder')} aria-label={t('replies2.answer')} onChange={(e) => setText(e.target.value)} />
      <div className="row wrap" style={{ gap: 8 }}>
        <Button size="sm" variant="primary" icon="check" loading={busy} disabled={busy || !text.trim()} onClick={() => void send()}>
          {t('replies2.send')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void browser.runtime.sendMessage({ type: 'era:reply:dismiss', key: p.key } satisfies EraMessage).catch(() => undefined)}>
          {t('replies2.dismiss')}
        </Button>
      </div>
    </div>
  );
}
