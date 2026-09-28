import { useState } from 'react';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import type { ItemIntel } from '@/intelligence/decision';
import { DEFAULT_REPLIES, REPLY_KEYS, type ReplyKey, fillReply, hasBlanks } from '@/intelligence/replies';
import { Button, Select } from '@/ui/components/primitives';
import { CopyButton } from './tools';
import { useEra } from '../state';
import { replyContextOf, useCustomReplies } from '../reply-kit';

/** Answer a buyer in seconds: pick a template, ERA fills what it knows, you copy it into Vinted. */
export function Replies({ intel }: { intel: ItemIntel }) {
  const { t, money } = useI18n();
  const era = useEra();
  const [key, setKey] = useState<ReplyKey>('MEASURES');
  const [editing, setEditing] = useState(false);
  const custom = useCustomReplies() ?? {};
  const template = custom[key] ?? DEFAULT_REPLIES[key];
  const text = fillReply(template, replyContextOf(intel, era.preps, era.model, { t, money }));
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
