import { useState } from 'react';
import { useI18n } from '@/i18n';
import { Thumb } from '@/ui/components/Thumb';

/**
 * The article's photo, large, in 3:4 (v4.0 item page): the one Vinted shows, as is (never retouched); a demo piece
 * shows its category's glyph; no photo, or one Vinted no longer serves, says so — never an invented image.
 */
export function ItemPhoto({ photoUrl, category, title }: { photoUrl: string | null; category: string; title: string }) {
  const { t } = useI18n();
  const [failed, setFailed] = useState<string | null>(null);
  const real = photoUrl && !photoUrl.startsWith('demo:') && failed !== photoUrl ? photoUrl : null;
  return (
    <figure className="item-photo" data-testid="item-photo">
      {real ? (
        <img src={real} alt={title} decoding="async" onError={() => setFailed(real)} />
      ) : photoUrl?.startsWith('demo:') ? (
        <span className="look__glyph">
          <Thumb photoUrl={photoUrl} category={category} alt={title} size="lg" />
        </span>
      ) : (
        <span className="look__none num">{t('vitrine.noPhoto')}</span>
      )}
    </figure>
  );
}
