import { useEffect, useState } from 'react';
import { GEMINI_STORE, type GeminiConfig, clearGemini, geminiConfig, geminiWrite, keyHint, saveGemini, testGeminiKey } from '@/data/gemini';
import { useI18n } from '@/i18n';
import { type DraftFacts, type DraftIssue, type ReplyDecision, checkDraft, cleanDraft, factLines, offerInMessage, replyRequest } from '@/intelligence/ai-draft';
import type { ItemIntel } from '@/intelligence/decision';
import { evaluateOffer } from '@/intelligence/offer';
import { stagnationThreshold } from '@/intelligence/stagnation';
import { useToast } from '@/ui/components/overlays';
import { Badge, Button, Card, Field, Input, Select } from '@/ui/components/primitives';
import { useEra } from '../state';
import { replyContextOf } from '../reply-kit';
import { useMoneyField } from './forms';
import { CopyButton } from './tools';

/** The saved Gemini settings, following changes made in another ERA window. undefined: still reading. */
export function useGeminiConfig(): GeminiConfig | null | undefined {
  const [c, setC] = useState<GeminiConfig | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    const read = () => void geminiConfig().then((x) => live && setC(x));
    read();
    const on = (changes: Record<string, unknown>, area: string) => {
      if (area === 'local' && GEMINI_STORE in changes) read();
    };
    browser.storage.onChanged.addListener(on);
    return () => {
      live = false;
      browser.storage.onChanged.removeListener(on);
    };
  }, []);
  return c;
}

/** Réglages → the key (kept in this browser only), tested by listing the models it may use, and the model picked. */
export function GeminiCard() {
  const { t, date } = useI18n();
  const cfg = useGeminiConfig();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  const test = async (k: string) => {
    setBusy(true);
    setFail(null);
    const r = await testGeminiKey(k);
    setBusy(false);
    if (!r.ok) return setFail(r.detail);
    await saveGemini({ key: k.trim(), model: r.model, models: r.models, testedAt: Date.now() });
    setKey('');
  };
  return (
    <Card title={t('gemini.title')} hint={t('gemini.hint')} icon="edit" tone="violet">
      <div className="stack-3" data-testid="gemini-card">
        {cfg ? (
          <>
            <p className="t-small">
              <Badge tone="emerald">{t('gemini.saved', { hint: keyHint(cfg.key) })}</Badge>{' '}
              {cfg.testedAt && <span className="t-muted">{t('gemini.tested', { date: date(cfg.testedAt), n: cfg.models.length })}</span>}
            </p>
            {cfg.models.length > 0 && (
              <Field label={t('gemini.model')} htmlFor="gemini-model">
                <Select
                  id="gemini-model"
                  value={cfg.model ?? ''}
                  onChange={(e) => void saveGemini({ ...cfg, model: e.target.value })}
                  options={cfg.models.map((m) => ({ value: m, label: m.replace(/^models\//, '') }))}
                />
              </Field>
            )}
            <div className="row wrap" style={{ gap: 8 }}>
              <Button size="sm" variant="ghost" loading={busy} onClick={() => void test(cfg.key)}>
                {t('gemini.retest')}
              </Button>
              <Button size="sm" variant="ghost" icon="x" onClick={() => void clearGemini()}>
                {t('gemini.clear')}
              </Button>
            </div>
          </>
        ) : (
          <form
            className="stack"
            style={{ gap: 8 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (key.trim()) void test(key);
            }}
          >
            <Field label={t('gemini.key')} htmlFor="gemini-key">
              <Input id="gemini-key" type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} />
            </Field>
            <div>
              <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!key.trim()}>
                {t('gemini.saveTest')}
              </Button>
            </div>
          </form>
        )}
        {fail && <p className="t-small t-warn">{fail}</p>}
        <ul className="t-small t-faint stack" style={{ margin: 0, paddingLeft: 18, gap: 4 }}>
          <li>{t('gemini.where')}</li>
          <li>{t('gemini.what')}</li>
          <li>{t('gemini.never')}</li>
        </ul>
      </div>
    </Card>
  );
}

/** What a draft says that ERA's facts do not: shown, and to be acknowledged before the text is used. */
export function DraftIssues({ issues, ack, onAck }: { issues: DraftIssue[]; ack: boolean; onAck: (v: boolean) => void }) {
  const { t } = useI18n();
  if (!issues.length) return <p className="t-small t-faint">{t('gemini.checked')}</p>;
  return (
    <div className="stack" style={{ gap: 6 }} data-testid="draft-issues">
      <p className="t-small t-warn">{t('gemini.issues', { list: issues.map((i) => `${t(`gemini.issue.${i.kind}`)} « ${i.text} »`).join(', ') })}</p>
      <label className="row t-small" style={{ gap: 8, alignItems: 'flex-start' }}>
        <input type="checkbox" className="checkbox" checked={ack} onChange={(e) => onAck(e.target.checked)} style={{ marginTop: 2 }} />
        <span>{t('gemini.ack')}</span>
      </label>
    </div>
  );
}

/** Facts of a listing as Gemini receives them: only what ERA knows. */
export function factsOf(intel: ItemIntel, ctx: ReturnType<typeof replyContextOf>, material: string | null): DraftFacts {
  const it = intel.view.item;
  return { title: it.title, brand: it.brand, size: ctx.size, condition: ctx.condition, defects: ctx.defects, material, measures: ctx.measures, price: ctx.price };
}

/**
 * A reply to a buyer's message, drafted by Gemini: the offer in the message is read, ERA's offer rules decide
 * (accept, counter at which price, decline), Gemini only words it. Checked against the facts; copied by the seller.
 */
export function AiReply({ intel }: { intel: ItemIntel }) {
  const { t, money } = useI18n();
  const era = useEra();
  const toast = useToast();
  const cfg = useGeminiConfig();
  const [buyer, setBuyer] = useState('');
  const offer = useMoneyField(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [issues, setIssues] = useState<DraftIssue[]>([]);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const detected = offerInMessage(buyer);
  // The amount typed wins over the one read in the message.
  const offerCents = offer.raw.trim() ? offer.cents : detected;
  if (cfg === undefined) return null;
  if (cfg === null) return <p className="t-small t-faint">{t('gemini.none')}</p>;
  const v = intel.view;
  const decide = (): ReplyDecision => {
    if (offerCents === null || v.askPrice === null) return { verdict: 'NONE' };
    const d = evaluateOffer(offerCents, { ask: v.askPrice, cost: v.cost, pricing: intel.pricing, daysListed: intel.stagnation?.daysListed ?? v.daysListed, favorites: v.current?.favorites ?? null, thresholdDays: stagnationThreshold(era.model) });
    if (d.verdict === 'ACCEPT') return { verdict: 'ACCEPT', offer: money(offerCents) };
    if (d.verdict === 'COUNTER' && d.counter !== null) return { verdict: 'COUNTER', offer: money(offerCents), counter: money(d.counter) };
    return { verdict: 'DECLINE', offer: money(offerCents), ask: money(v.askPrice) };
  };
  const decision = decide();
  const write = async () => {
    const ctx = replyContextOf(intel, era.preps, era.model, { t, money });
    const facts = factsOf(intel, ctx, era.preps.get(v.item.id)?.material.trim() || v.item.material || null);
    setBusy(true);
    const r = await geminiWrite(replyRequest(facts, buyer, decision));
    setBusy(false);
    if (!r.ok) return toast('error', t('gemini.failed'), r.detail);
    const text = cleanDraft(r.text);
    const priced = [...factLines(facts), JSON.stringify(decision)].join('\n');
    setDraft(text);
    // The buyer's message may be quoted, never its prices: a price must be ERA's.
    setIssues(checkDraft(text, `${priced}\n${buyer}`, v.item.brand, priced));
    setAck(false);
  };
  return (
    <div className="stack-3" data-testid="ai-reply">
      <Field label={t('gemini.buyer')} htmlFor="ai-buyer">
        <textarea id="ai-buyer" className="input" rows={3} value={buyer} onChange={(e) => setBuyer(e.target.value)} />
      </Field>
      <div className="row wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
        <Field label={t('gemini.offer')} htmlFor="ai-offer" error={offer.invalid ? t('add.invalidAmount') : null}>
          <Input id="ai-offer" money value={offer.raw} onChange={(e) => offer.setRaw(e.target.value)} placeholder={detected !== null ? String(detected / 100).replace('.', ',') : ''} style={{ width: 120 }} />
        </Field>
        <p className="t-small t-muted grow" data-testid="ai-decision">
          {t(`gemini.decision.${decision.verdict}`, decision.verdict === 'NONE' ? {} : { offer: decision.offer, counter: decision.verdict === 'COUNTER' ? decision.counter : '', ask: decision.verdict === 'DECLINE' ? decision.ask : '' })}
        </p>
      </div>
      <div>
        <Button size="sm" variant="primary" icon="edit" loading={busy} disabled={!buyer.trim() || offer.invalid} onClick={() => void write()}>
          {t('gemini.writeReply')}
        </Button>
      </div>
      {draft !== null && (
        <>
          <textarea className="input" rows={4} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={t('gemini.draft')} data-testid="ai-draft" />
          <DraftIssues issues={issues} ack={ack} onAck={setAck} />
          <div className="row" style={{ gap: 8 }}>{(issues.length === 0 || ack) && <CopyButton text={draft} />}</div>
        </>
      )}
      <p className="t-small t-faint">{t('gemini.replyNever')}</p>
    </div>
  );
}
