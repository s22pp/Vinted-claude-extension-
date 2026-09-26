import { useState } from 'react';
import { useI18n } from '@/i18n';
import { fillTemplate } from '@/intelligence/automation';
import { FAV_PRESETS, articleOf, cleanTitle } from '@/intelligence/fav-messages';
import { Badge, Button } from '@/ui/components/primitives';

export interface MessageExample {
  title: string;
  brand: string | null;
  priceCents: number;
  offerCents: number;
}

/**
 * Tick the messages that sound like you; several = ERA picks one per member. Each shows as it would be sent,
 * on one of your own listings. Your own messages can be added next to the ready-made ones.
 */
export function MessagePicker({ offer, value, onChange, example }: { offer: boolean; value: string[]; onChange: (v: string[]) => void; example: MessageExample }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState('');
  const presets = FAV_PRESETS.filter((p) => p.offer === offer);
  const own = value.filter((v) => !presets.some((p) => p.text === v));
  const preview = (tpl: string) =>
    fillTemplate(tpl, { pseudo: null, titre: cleanTitle(example.title), article: articleOf(example.title, example.brand), prix: example.priceCents, prixOffre: offer ? example.offerCents : null });
  const toggle = (text: string, on: boolean) => onChange(on ? [...value, text] : value.filter((v) => v !== text));
  const id = offer ? 'msg-o' : 'msg-n';

  const row = (key: string, text: string, checked: boolean, tag: React.ReactNode, extra?: React.ReactNode) => (
    <label key={key} htmlFor={`${id}-${key}`} className="row" style={{ gap: 10, alignItems: 'flex-start', cursor: 'pointer', padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border)', background: checked ? 'var(--surface-hover)' : 'transparent' }}>
      <input id={`${id}-${key}`} type="checkbox" className="checkbox" checked={checked} onChange={(e) => toggle(text, e.target.checked)} style={{ marginTop: 3 }} />
      <span className="stack" style={{ gap: 4, minWidth: 0 }}>
        <span className="t-small" style={{ overflowWrap: 'anywhere' }}>
          {preview(text)}
        </span>
        <span className="row" style={{ gap: 6 }}>
          {tag}
          {extra}
        </span>
      </span>
    </label>
  );

  return (
    <div className="stack" data-testid={offer ? 'messages-offer' : 'messages-no-offer'}>
      <div>
        <div style={{ fontWeight: 600 }}>{t(offer ? 'auto.msg.withOffer' : 'auto.msg.withoutOffer')}</div>
        <div className="t-small t-faint">{t('auto.msg.hint', { n: value.length })}</div>
      </div>
      {presets.map((p) => row(p.id, p.text, value.includes(p.text), <Badge tone="neutral">{t(`auto.msg.tone.${p.tone}`)}</Badge>))}
      {own.map((text, i) =>
        row(
          `own${i}`,
          text,
          true,
          <Badge tone="cobalt">{t('auto.msg.mine')}</Badge>,
          <Button size="sm" variant="ghost" onClick={(e) => (e.preventDefault(), onChange(value.filter((v) => v !== text)))}>
            {t('auto.msg.remove')}
          </Button>,
        ),
      )}
      {value.length === 0 && <p className="t-small t-warn">{t('auto.msg.none')}</p>}
      <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
        <textarea
          aria-label={t(offer ? 'auto.msg.addOffer' : 'auto.msg.addNoOffer')}
          className="input grow"
          rows={2}
          style={{ height: 'auto', resize: 'vertical' }}
          placeholder={t(offer ? 'auto.msg.placeholderOffer' : 'auto.msg.placeholder')}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button
          size="sm"
          icon="plus"
          disabled={!draft.trim() || value.includes(draft.trim())}
          onClick={() => {
            onChange([...value, draft.trim()]);
            setDraft('');
          }}
        >
          {t('auto.msg.add')}
        </Button>
      </div>
    </div>
  );
}
