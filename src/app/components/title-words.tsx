import { useMemo } from 'react';
import { useI18n } from '@/i18n';
import type { ItemIntel } from '@/intelligence/decision';
import { TITLE_MAX } from '@/intelligence/listing';
import { MIN_BASE, missingTitleWords } from '@/intelligence/title-words';
import { Badge, Button } from '@/ui/components/primitives';

/**
 * Words the comparable listings use in their titles and yours does not, from the article's last market analysis.
 * With `onAdd` (workshop), a click puts the word in the title; otherwise (a live listing) the list is for reading:
 * ERA never changes a title on Vinted.
 */
export function TitleWords({
  intel,
  title,
  brand,
  onAdd,
  withWordFn,
  onAnalyze,
  analyzing,
}: {
  intel: ItemIntel | null;
  title: string;
  brand: string | null;
  onAdd?: (word: string) => void;
  withWordFn?: (word: string) => string;
  onAnalyze?: () => void;
  analyzing?: boolean;
}) {
  const { t, pct, date } = useI18n();
  const analysis = intel?.analysis ?? null;
  const r = useMemo(() => (analysis ? missingTitleWords(title, brand, analysis.comparables.filter((c) => c.kept).map((c) => c.candidate)) : null), [analysis, title, brand]);
  if (!analysis || !r) {
    return (
      <div className="row wrap" style={{ gap: 8, alignItems: 'center' }} data-testid="title-words">
        <span className="t-small t-faint">{t('tw.noAnalysis')}</span>
        {onAnalyze && (
          <Button size="sm" variant="ghost" icon="market" loading={analyzing} onClick={onAnalyze}>
            {t('workshop.analyze')}
          </Button>
        )}
      </div>
    );
  }
  return (
    <div className="stack" style={{ gap: 6 }} data-testid="title-words">
      <span className="t-small t-muted">{t('tw.label', { n: r.base, when: date(analysis.at) })}</span>
      {r.base < MIN_BASE ? (
        <p className="t-small t-faint">{t('tw.few', { n: r.base })}</p>
      ) : r.words.length === 0 ? (
        <p className="t-small t-faint">{t('tw.none')}</p>
      ) : (
        <div className="row wrap" style={{ gap: 6 }}>
          {r.words.map((w) => {
            const text = `${w.word} · ${pct(w.share)}`;
            const tip = t(`tw.kind.${w.kind}`, { n: w.count, base: r.base });
            if (!onAdd) return <Badge key={w.word} tone={w.kind === 'WORD' ? 'violet' : 'amber'} title={tip}>{text}</Badge>;
            const tooLong = (withWordFn?.(w.word) ?? `${title} ${w.word}`).length > TITLE_MAX;
            return (
              <Button key={w.word} size="sm" variant="ghost" icon="plus" disabled={tooLong} title={tooLong ? t('tw.tooLong') : tip} aria-label={t('tw.add', { word: w.word })} onClick={() => onAdd(w.word)}>
                {text}
              </Button>
            );
          })}
        </div>
      )}
      {/* A colour or a claim ("vintage", "rare") goes in only if it is true: said in plain sight, not only on hover. */}
      {r.words.some((w) => w.kind !== 'WORD') && (
        <p className="t-small t-warn">
          {t('tw.checkFirst', { words: r.words.filter((w) => w.kind !== 'WORD').map((w) => `« ${w.word} »`).join(', ') })}
        </p>
      )}
      <p className="t-small t-faint">{onAdd ? t('tw.onlyTrue') : t('tw.onlyTrueLive')}</p>
    </div>
  );
}
