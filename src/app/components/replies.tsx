import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import type { ItemIntel } from '@/intelligence/decision';
import { stagnationThreshold } from '@/intelligence/stagnation';
import { offerLadder } from '@/intelligence/offer';
import { DEFAULT_REPLIES, REPLY_KEYS, type ReplyKey, fillReply, hasBlanks } from '@/intelligence/replies';
import { measureFields } from '@/intelligence/workshop';
import { Button, Select } from '@/ui/components/primitives';
import { CopyButton } from './tools';
import { useEra } from '../state';

/** Answer a buyer in seconds: pick a template, ERA fills what it knows, you copy it into Vinted. */
export function Replies({ intel }: { intel: ItemIntel }) {
  const { t, money } = useI18n();
  const era = useEra();
  const [key, setKey] = useState<ReplyKey>('MEASURES');
  const [editing, setEditing] = useState(false);
  const custom = useLiveQuery(() => repo.getSetting<Partial<Record<ReplyKey, string>>>('replyTemplates', {}), []) ?? {};
  const v = intel.view;
  const prep = era.preps.get(v.item.id);
  const measures = prep
    ? measureFields(v.item.category)
        .filter((k) => prep.measures[k]?.trim())
        .map((k) => `${t(`workshop.m.${k}`).toLowerCase()} ${prep.measures[k]!.trim()} cm`)
        .join(' · ') || null
    : null;
  const ladder = v.askPrice !== null ? offerLadder({ ask: v.askPrice, cost: v.cost, pricing: intel.pricing, daysListed: v.daysListed, favorites: v.current?.favorites ?? null, thresholdDays: stagnationThreshold(era.model) }) : null;
  const template = custom[key] ?? DEFAULT_REPLIES[key];
  const text = fillReply(template, {
    title: v.item.title,
    size: v.item.size,
    condition: v.item.condition ? t(`condition.${v.item.condition}`).toLowerCase() : null,
    defects: prep?.defects.trim() || null,
    measures,
    price: v.askPrice !== null ? money(v.askPrice) : null,
    counter: ladder ? money(ladder.acceptFrom) : null,
  });
  const [draft, setDraft] = useState(template);
  return (
    <div className="stack-3">
      <Select value={key} onChange={(e) => { setKey(e.target.value as ReplyKey); setEditing(false); }} options={REPLY_KEYS.map((k) => ({ value: k, label: t(`replies.k.${k}`) }))} aria-label={t('replies.pick')} />
      {editing ? (
        <>
          <textarea className="input" rows={4} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <p className="t-small t-faint">{t('replies.vars')}</p>
          <div className="row" style={{ gap: 8 }}>
            <Button size="sm" variant="primary" onClick={async () => { await repo.setSetting('replyTemplates', { ...custom, [key]: draft }); setEditing(false); }}>
              {t('common.save')}
            </Button>
            <Button size="sm" variant="ghost" onClick={async () => { const next = { ...custom }; delete next[key]; await repo.setSetting('replyTemplates', next); setDraft(DEFAULT_REPLIES[key]); setEditing(false); }}>
              {t('replies.reset')}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="reply-text">{text}</p>
          {hasBlanks(text) && <p className="t-small t-warn">{t('replies.blanks')}</p>}
          <div className="row" style={{ gap: 8 }}>
            <CopyButton text={text} />
            <Button size="sm" variant="ghost" icon="edit" onClick={() => { setDraft(template); setEditing(true); }}>
              {t('replies.editTemplate')}
            </Button>
          </div>
        </>
      )}
      <p className="t-small t-faint">{t('replies.never')}</p>
    </div>
  );
}
