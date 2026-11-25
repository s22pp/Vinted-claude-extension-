import { useEffect, useState } from 'react';
import { DEFAULT_EXEC_MODE, EXEC_MODE_KEY, type ExecMode, isExecMode } from '@/data/budget-plan';
import { useI18n } from '@/i18n';
import { Segmented } from '@/ui/components/primitives';

/** The seller's execution mode (storage.local, shared with the worker), followed live. */
export function useExecMode(): ExecMode {
  const [mode, setMode] = useState<ExecMode>(DEFAULT_EXEC_MODE);
  useEffect(() => {
    let alive = true;
    const read = () =>
      void browser.storage.local
        .get(EXEC_MODE_KEY)
        .then((v) => alive && setMode(isExecMode(v[EXEC_MODE_KEY]) ? v[EXEC_MODE_KEY] : DEFAULT_EXEC_MODE))
        .catch(() => undefined);
    read();
    const on = (changes: Record<string, unknown>, area: string) => area === 'local' && EXEC_MODE_KEY in changes && read();
    browser.storage.onChanged.addListener(on);
    return () => {
      alive = false;
      browser.storage.onChanged.removeListener(on);
    };
  }, []);
  return mode;
}

const MODES: readonly ExecMode[] = ['DIRECT', 'PRUDENT'];

/** Réglages: Direct (no local cap, the default) or Prudent (the measured limits), one click. */
export function ExecModeSwitch() {
  const { t } = useI18n();
  const mode = useExecMode();
  return (
    <div className="stack-2" data-testid="exec-mode">
      <p className="t-small" data-testid="exec-mode-line">
        {t('vinted.modeLine', { mode: mode === 'DIRECT' ? `${t('vinted.modeDIRECT')} sans limite locale` : t('vinted.modePRUDENT') })}
      </p>
      <div>
        <Segmented<ExecMode> label={t('vinted.mode')} value={mode} options={MODES.map((m) => ({ value: m, label: t(`vinted.mode${m}`) }))} onChange={(m) => void browser.storage.local.set({ [EXEC_MODE_KEY]: m })} />
      </div>
      <p className="t-small t-faint">{t(`vinted.mode${mode}_hint`)}</p>
    </div>
  );
}
