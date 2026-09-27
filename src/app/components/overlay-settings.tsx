import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n';
import { OVERLAY_KEY, OVERLAY_ON_KEY } from '@/intelligence/overlay';
import { Flag } from '@/ui/components/primitives';

/** On/off for ERA's marks on vinted.fr pages, and how many of your niches they use. */
export function OverlaySettings() {
  const { t } = useI18n();
  const [on, setOn] = useState<boolean | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    void browser.storage.local.get([OVERLAY_ON_KEY, OVERLAY_KEY]).then((r) => {
      setOn(r[OVERLAY_ON_KEY] !== false);
      setN(Array.isArray(r[OVERLAY_KEY]) ? (r[OVERLAY_KEY] as unknown[]).length : 0);
    });
  }, []);
  if (on === null) return null;
  return (
    <label htmlFor="ov-on" className="row" style={{ gap: 10, alignItems: 'flex-start', cursor: 'pointer' }} data-testid="overlay-settings">
      <input
        id="ov-on"
        type="checkbox"
        className="checkbox"
        checked={on}
        onChange={(e) => {
          setOn(e.target.checked);
          void browser.storage.local.set({ [OVERLAY_ON_KEY]: e.target.checked });
        }}
        style={{ marginTop: 2 }}
      />
      <span>
        <span style={{ fontWeight: 600 }}>{t('overlay.enable')}</span> <Flag kind="EXPERIMENTAL" />
        <span className="t-small t-faint" style={{ display: 'block' }}>
          {n > 0 ? t('overlay.hint', { n }) : t('overlay.none')}
        </span>
      </span>
    </label>
  );
}
