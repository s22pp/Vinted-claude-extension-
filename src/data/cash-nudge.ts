import { NUDGE_SENT_KEY } from '@/intelligence/cash-nudge';
import { MarketplaceError, errorInfo } from './adapters/marketplace';
import { VintedTabAdapter } from './adapters/vinted/vinted-adapter';
import { recordContact } from './contacts';
import { journal } from './journal';
import { repo } from './repo';
import { vintedWrite } from './vinted-write';

const replyBody = (body: string) => ({ reply: { body, photo_temp_uuids: null, is_personal_data_sharing_check_skipped: false } });

/**
 * Background-only. « Relance déblocage trésorerie », the seller's click: the message sent in the order's conversation,
 * once per sale — saved as sent at once (never twice, whatever the read-back says), then looked for in the
 * conversation: shown there → done; not shown → sent, not confirmed. Through the same pacing as every write.
 */
export async function sendCashNudge(saleId: string, conversationId: string, text: string, title: string, now = Date.now()): Promise<{ ok: true; unconfirmed: boolean } | { ok: false; detail: string }> {
  const body = text.trim();
  if (!body) return { ok: false, detail: 'message vide' };
  if (!/^\d+$/.test(conversationId)) return { ok: false, detail: 'conversation Vinted inconnue pour cette vente' };
  const sent = new Set(await repo.getSetting<string[]>(NUDGE_SENT_KEY, []));
  if (sent.has(saleId)) return { ok: false, detail: 'relance déjà envoyée pour cette vente' };
  try {
    await vintedWrite('POST', `/api/v2/conversations/${conversationId}/replies`, replyBody(body), { spaced: false });
  } catch (e) {
    const { code, detail } = errorInfo(e);
    await journal({ kind: 'CASH_NUDGE', dryRun: false, ok: false, target: title, detail: `${code}${detail ? ` · ${detail}` : ''}` });
    return { ok: false, detail: e instanceof MarketplaceError ? `${code}${detail ? ` · ${detail}` : ''}` : String(e) };
  }
  sent.add(saleId);
  await repo.setSetting(NUDGE_SENT_KEY, [...sent].slice(-500));
  let shown = false;
  try {
    shown = JSON.stringify(await new VintedTabAdapter().rawGet(`/api/v2/conversations/${conversationId}`)).includes(JSON.stringify(body.slice(0, 60)).slice(1, -1));
  } catch {
    /* not read back: said as not confirmed */
  }
  await journal({ kind: 'CASH_NUDGE', dryRun: false, ok: true, unconfirmed: !shown, target: title, detail: `« ${body} »${shown ? ' · relu dans la conversation' : ' · envoyé, pas relu dans la conversation (non confirmé)'}` });
  await recordContact({ at: now, kind: 'REPLY', conversationId, itemId: null, title, variant: 'Relance validation de commande', askCents: null, offerCents: null, delayMs: null }).catch(() => undefined);
  return { ok: true, unconfirmed: !shown };
}
