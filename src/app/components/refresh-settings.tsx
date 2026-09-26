import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import type { EraMessage } from '@/data/adapters/vinted/protocol';
import { REFRESH_DEFAULTS, REFRESH_KEY, type RefreshConfig } from '@/data/refresh';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import { Select } from '@/ui/components/primitives';

/** Automatic read-only refresh (a vinted.fr tab already open) and its notifications. Off until switched on. */
export function RefreshSettings() {
  const { t } = useI18n();
  const stored = useLiveQuery(() => repo.getSetting<Partial<RefreshConfig> | null>(REFRESH_KEY, null), []);
  // The box follows the click at once; the stored copy follows.
  const [local, setLocal] = useState<RefreshConfig | null>(null);
  if (stored === undefined) return null;
  const cfg: RefreshConfig = local ?? { ...REFRESH_DEFAULTS, ...stored };
  const save = async (patch: Partial<RefreshConfig>) => {
    const next = { ...cfg, ...patch };
    setLocal(next);
    await repo.setSetting(REFRESH_KEY, next);
    await browser.runtime.sendMessage({ type: 'era:refresh:schedule' } satisfies EraMessage).catch(() => undefined);
  };
  return (
    <div className="stack" style={{ gap: 8 }} data-testid="refresh-settings">
      <label htmlFor="rf-on" className="row" style={{ gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
        <input id="rf-on" type="checkbox" className="checkbox" checked={cfg.enabled} onChange={(e) => void save({ enabled: e.target.checked })} style={{ marginTop: 2 }} />
        <span>
          <span style={{ fontWeight: 600 }}>{t('refresh.enable')}</span>
          <span className="t-small t-faint" style={{ display: 'block' }}>
            {t('refresh.hint')}
          </span>
        </span>
      </label>
      {cfg.enabled && (
        <div className="row wrap" style={{ gap: 12, paddingLeft: 28, alignItems: 'center' }}>
          <Select
            aria-label={t('refresh.every')}
            value={String(cfg.everyHours)}
            onChange={(e) => void save({ everyHours: Number(e.target.value) })}
            options={[3, 6, 12, 24].map((h) => ({ value: String(h), label: t('refresh.hours', { n: h }) }))}
          />
          <label htmlFor="rf-notify" className="row t-small" style={{ gap: 8, cursor: 'pointer' }}>
            <input id="rf-notify" type="checkbox" className="checkbox" checked={cfg.notify} onChange={(e) => void save({ notify: e.target.checked })} />
            {t('refresh.notify')}
          </label>
        </div>
      )}
    </div>
  );
}
