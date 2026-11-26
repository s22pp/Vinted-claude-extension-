import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import type { EraMessage } from '@/data/adapters/vinted/protocol';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import { DEFAULT_NUDGE, NUDGE_SENT_KEY, nudgeCandidates } from '@/intelligence/cash-nudge';
import { useToast } from '@/ui/components/overlays';
import { Button } from '@/ui/components/primitives';
import { useEra } from '../state';
import { CopyButton } from './tools';

/**
 * « Relance déblocage trésorerie »: the sales delivered more than 24 h ago and not validated yet, each with the courteous
 * message — copied, or sent in the order's conversation on the seller's click (once per sale, read back on Vinted).
 */
export function CashNudges({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const era = useEra();
  const toast = useToast();
  const sent = useLiveQuery(async () => new Set(await repo.getSetting<string[]>(NUDGE_SENT_KEY, [])), []) ?? new Set<string>();
  const [busy, setBusy] = useState<string | null>(null);
  const list = nudgeCandidates(
    era.sales.map((s) => ({ id: s.sale.id, title: s.item.title, status: s.sale.status, vintedStatus: s.sale.vintedStatus, vintedStatusSince: s.sale.vintedStatusSince, vintedConversationId: s.sale.vintedConversationId })),
    sent,
    era.now,
  );
  const send = async (saleId: string, conversationId: string, title: string) => {
    setBusy(saleId);
    try {
      const r = (await browser.runtime.sendMessage({ type: 'era:nudge:send', saleId, conversationId, text: DEFAULT_NUDGE, title } satisfies EraMessage)) as { ok: true; unconfirmed: boolean } | { ok: false; detail: string };
      if (r.ok) toast('success', t('nudge.sent'), r.unconfirmed ? t('nudge.unconfirmed') : t('nudge.verified'));
      else toast('error', t('nudge.failed'), r.detail);
    } catch (e) {
      toast('error', t('nudge.failed'), e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="stack-3" data-testid="cash-nudges">
      {!compact && <p className="t-small t-muted">{t('nudge.intro')}</p>}
      {list.length === 0 ? (
        <p className="t-small t-faint">{t('nudge.none')}</p>
      ) : (
        <ul className="nudge-list">
          {list.map((c) => (
            <li key={c.saleId} className="nudge-row">
              <span className="nudge-row__title">{c.title}</span>
              <span className="num t-small t-muted">{t('nudge.since', { h: c.hours })}</span>
              <span className="row" style={{ gap: 6 }}>
                <CopyButton text={DEFAULT_NUDGE} />
                {era.mode === 'real' && c.conversationId && (
                  <Button size="sm" variant="primary" icon="check" loading={busy === c.saleId} onClick={() => void send(c.saleId, c.conversationId!, c.title)}>
                    {t('nudge.send')}
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <details className="t-small">
        <summary style={{ cursor: 'pointer' }}>{t('nudge.text')}</summary>
        <p className="reply-text" style={{ marginTop: 6 }}>{DEFAULT_NUDGE}</p>
      </details>
    </div>
  );
}
