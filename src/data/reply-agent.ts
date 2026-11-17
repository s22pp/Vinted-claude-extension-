import { checkDraft, cleanDraft, replyRequest } from '@/intelligence/ai-draft';
import { type PendingReply, mergePending, planReply, prunePending, readConversation, replyKey, replyVerdict, REPLY_MAX_AGE_MS } from '@/intelligence/buyer-messages';
import { inboxActivity } from '@/intelligence/outcomes';
import { MarketplaceError, errorInfo } from './adapters/marketplace';
import { currentUserId } from './adapters/vinted/parse';
import type { AutoRunResult } from './adapters/vinted/protocol';
import { VintedTabAdapter } from './adapters/vinted/vinted-adapter';
import { markReplied, noteInbox, recentInbox, recordContact } from './contacts';
import { geminiConfig, geminiWrite } from './gemini';
import { journal } from './journal';
import { replyFacts } from './reply-facts';
import { repo } from './repo';
import { vintedWrite } from './vinted-write';

/**
 * The buyers' messages agent (EXPERIMENTAL: Vinted's inbox and conversation fields are UNVERIFIED on the seller's
 * account). Plain questions about a listing get an answer written by Gemini (the seller's key) from ERA's facts only,
 * checked, and sent by itself only when nothing in it is unsure. Everything else — a problem with an order, contact off
 * Vinted, an amount, an unsure draft — waits in ERA with a drafted answer when one is possible: the seller reads it,
 * edits it and sends it from ERA, without opening Vinted. Within the automations' limits (12 s apart, 40 a day).
 */

export const REPLIES_DONE_KEY = 'autoRepliesDone';
export const REPLIES_PENDING_KEY = 'autoRepliesPending';
/** Conversations read in one pass, answers sent in one pass. */
const READ_MAX = 4;
const SEND_MAX = 3;
const STOPPING = new Set(['NETWORK_403', 'RATE_LIMITED', 'NOT_LOGGED_IN', 'BUDGET_EXHAUSTED', 'NO_VINTED_TAB']);
const VARIANT = 'Réponse rédigée par Gemini (faits d’ERA, vérifiée)';

const replyBody = (body: string) => ({ reply: { body, photo_temp_uuids: null, is_personal_data_sharing_check_skipped: false } });

export type RepliesResult = AutoRunResult & { left: number };

export async function runReplies(dryRun: boolean, now = Date.now()): Promise<RepliesResult> {
  const out: RepliesResult = { ok: true, kind: 'REPLIES', dryRun, done: 0, skipped: 0, failed: 0, stopped: null, left: 0 };
  const hasKey = !!(await geminiConfig());
  const adapter = new VintedTabAdapter();
  const done = new Set(await repo.getSetting<string[]>(REPLIES_DONE_KEY, []));
  let pending = await repo.getSetting<PendingReply[]>(REPLIES_PENDING_KEY, []);
  const wait = (p: PendingReply) => {
    pending = mergePending(pending, p, now);
  };
  try {
    let inbox = recentInbox(now);
    if (!inbox) {
      const me = currentUserId(await adapter.rawGet('/api/v2/users/current'));
      const json = await adapter.rawGet('/api/v2/inbox?page=1&per_page=20');
      noteInbox(json, me, now);
      inbox = { at: now, json, me };
    }
    const activity = inboxActivity(inbox.json, inbox.me);
    pending = prunePending(pending, activity, now);
    const candidates = [...activity.entries()]
      .filter(([, a]) => a.updatedAt !== null && now - a.updatedAt <= REPLY_MAX_AGE_MS && (a.fromOther === true || (a.fromOther === null && a.unread === true)))
      .sort((a, b) => b[1].updatedAt! - a[1].updatedAt!)
      .slice(0, READ_MAX);
    for (const [convId] of candidates) {
      const conv = readConversation(await adapter.rawGet(`/api/v2/conversations/${convId}`), inbox.me);
      const last = conv.messages[conv.messages.length - 1];
      // The conversation read: an answer to an earlier contact is settled for sure.
      const lastBuyer = [...conv.messages].reverse().find((m) => !m.fromMe);
      if (lastBuyer?.at) await markReplied(convId, lastBuyer.at).catch(() => undefined);
      const plan = planReply(conv, convId, done, now);
      if (!plan.send) {
        if (last && !last.fromMe && (plan.reason === 'SENSITIVE' || plan.reason === 'CONTACT' || plan.reason === 'OFFER' || plan.reason === 'ORDER')) {
          const key = replyKey(convId, last);
          if (!pending.some((p) => p.key === key)) wait({ key, conversationId: convId, at: last.at ?? now, title: null, buyer: conv.messages.filter((m) => !m.fromMe).slice(-3).map((m) => m.body).join('\n'), draft: null, why: plan.reason });
          out.left++;
        } else out.skipped++;
        continue;
      }
      const key = replyKey(convId, last!);
      if (pending.some((p) => p.key === key)) {
        out.left++;
        continue;
      }
      const facts = conv.itemVintedId ? await replyFacts(conv.itemVintedId) : null;
      const base = { key, conversationId: convId, at: last!.at ?? now, title: facts?.facts.title ?? null, buyer: plan.buyerText };
      if (!facts) {
        wait({ ...base, draft: null, why: 'NO_ITEM' });
        out.left++;
        continue;
      }
      if (!hasKey) {
        wait({ ...base, draft: null, why: 'NO_KEY' });
        out.left++;
        continue;
      }
      const g = await geminiWrite(replyRequest(facts.facts, plan.buyerText, { verdict: 'NONE' }));
      if (!g.ok) {
        wait({ ...base, draft: null, why: 'AI_FAILED', issues: [g.detail] });
        out.left++;
        continue;
      }
      const draft = cleanDraft(g.text);
      const issues = checkDraft(draft, `${facts.known}\n${plan.buyerText}`, facts.facts.brand, facts.priced);
      const verdict = replyVerdict(draft, issues);
      if (verdict !== 'OK' || out.done >= SEND_MAX) {
        wait({ ...base, draft, why: verdict === 'OK' ? 'UNSURE' : verdict, issues: issues.map((i) => `${i.kind} : ${i.text}`) });
        out.left++;
        continue;
      }
      const target = `${facts.facts.title} · « ${plan.buyerText.slice(0, 80)} »`;
      if (dryRun) {
        await journal({ kind: 'REPLY', dryRun, ok: true, target, detail: `« ${draft} »` });
        out.done++;
        continue;
      }
      try {
        await vintedWrite('POST', `/api/v2/conversations/${convId}/replies`, replyBody(draft));
        done.add(key);
        await repo.setSetting(REPLIES_DONE_KEY, [...done].slice(-500));
        await journal({ kind: 'REPLY', dryRun, ok: true, target, detail: `« ${draft} »` });
        await recordContact({ at: now, kind: 'REPLY', conversationId: convId, itemId: null, title: facts.facts.title, variant: VARIANT, askCents: null, offerCents: null, delayMs: last!.at ? now - last!.at : null }).catch(() => undefined);
        out.done++;
      } catch (e) {
        out.failed++;
        const { code, detail } = errorInfo(e);
        await journal({ kind: 'REPLY', dryRun, ok: false, target, detail: `${code}${detail ? ` · ${detail}` : ''}` });
        if (STOPPING.has(code)) {
          out.stopped = `${code}${detail ? ` · ${detail}` : ''}`;
          break;
        }
        wait({ ...base, draft, why: 'UNSURE', issues: [`envoi refusé : ${code}`] });
      }
    }
  } catch (e) {
    const { code, detail } = errorInfo(e);
    out.ok = false;
    out.stopped = `${code}${detail ? ` · ${detail}` : ''}`;
  }
  if (!dryRun) await repo.setSetting(REPLIES_PENDING_KEY, pending);
  await journal({ kind: out.stopped && !out.ok ? 'STOP' : 'RUN', dryRun, ok: out.ok, target: 'Messages des acheteurs', detail: `${out.done} réponse(s) envoyée(s) · ${out.left} message(s) à voir dans ERA${out.stopped ? ` · arrêt : ${out.stopped}` : ''}` });
  return out;
}

/** The seller's click in ERA: their answer (ERA's draft, edited or not) sent in the conversation, the message settled. */
export async function sendPendingReply(key: string, text: string, now = Date.now()): Promise<{ ok: true } | { ok: false; detail: string }> {
  const body = text.trim();
  if (!body) return { ok: false, detail: 'message vide' };
  const pending = await repo.getSetting<PendingReply[]>(REPLIES_PENDING_KEY, []);
  const p = pending.find((x) => x.key === key);
  if (!p) return { ok: false, detail: 'ce message n’attend plus de réponse' };
  try {
    await vintedWrite('POST', `/api/v2/conversations/${p.conversationId}/replies`, replyBody(body));
  } catch (e) {
    const { code, detail } = errorInfo(e);
    await journal({ kind: 'REPLY', dryRun: false, ok: false, target: p.title ?? `conversation ${p.conversationId}`, detail: `${code}${detail ? ` · ${detail}` : ''}` });
    return { ok: false, detail: e instanceof MarketplaceError ? `${code}${detail ? ` · ${detail}` : ''}` : String(e) };
  }
  const done = new Set(await repo.getSetting<string[]>(REPLIES_DONE_KEY, []));
  done.add(key);
  await repo.setSetting(REPLIES_DONE_KEY, [...done].slice(-500));
  await repo.setSetting(REPLIES_PENDING_KEY, pending.filter((x) => x.key !== key));
  await journal({ kind: 'REPLY', dryRun: false, ok: true, target: p.title ?? `conversation ${p.conversationId}`, detail: `« ${body} » · envoyé depuis ERA` });
  await recordContact({ at: now, kind: 'REPLY', conversationId: p.conversationId, itemId: null, title: p.title ?? 'message', variant: body === p.draft ? VARIANT : 'Réponse écrite ou modifiée par vous', askCents: null, offerCents: null, delayMs: now - p.at }).catch(() => undefined);
  return { ok: true };
}

/** The seller set a message aside (answered elsewhere, nothing to say): it leaves the list. */
export async function dismissPendingReply(key: string): Promise<void> {
  const pending = await repo.getSetting<PendingReply[]>(REPLIES_PENDING_KEY, []);
  await repo.setSetting(REPLIES_PENDING_KEY, pending.filter((x) => x.key !== key));
}
