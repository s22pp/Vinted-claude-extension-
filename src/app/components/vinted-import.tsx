import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import type { EraMessage, ImportResult, ImportStage } from '@/data/adapters/vinted/protocol';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import { useToast } from '@/ui/components/overlays';
import { Button } from '@/ui/components/primitives';

/**
 * One-click Vinted import. The work runs in the background worker (it survives the popup closing),
 * opens a vinted.fr tab by itself when none is open, and reports its stages back here.
 */
export function useVintedImport(onDone?: (r: Extract<ImportResult, { ok: true }>) => void) {
  const { t } = useI18n();
  const toast = useToast();
  const [stage, setStage] = useState<ImportStage | null>(null);
  const lastImport = useLiveQuery(() => repo.getSetting<number | null>('lastVintedImport', null), []);

  useEffect(() => {
    const on = (msg: EraMessage) => {
      if (msg.type === 'era:import:stage') setStage(msg.stage);
    };
    browser.runtime.onMessage.addListener(on);
    return () => browser.runtime.onMessage.removeListener(on);
  }, []);

  const run = async () => {
    setStage('CONNECTING');
    let r: ImportResult;
    try {
      r = (await browser.runtime.sendMessage({ type: 'era:import' } satisfies EraMessage)) as ImportResult;
    } catch {
      r = { ok: false, code: 'UNAVAILABLE' };
    }
    if (r.ok) {
      toast('success', t('vinted.stageCOMPLETE'), t('vinted.imported', { n: r.items, updated: r.updated, sales: r.sales }));
      onDone?.(r);
    } else {
      toast('error', t(`errors.${r.code}`), `${t(`errors.hint.${r.code}`)}${r.detail ? ` (${r.detail})` : ''}`);
    }
    setTimeout(() => setStage(null), r.ok ? 900 : 0);
  };

  return { stage, busy: stage !== null && stage !== 'COMPLETE', lastImport: lastImport ?? null, run };
}

export function VintedImportButton({ variant = 'default', size = 'md', block, onDone, label }: { variant?: 'default' | 'primary' | 'ghost'; size?: 'sm' | 'md' | 'lg'; block?: boolean; onDone?: () => void; label?: 'long' | 'short' }) {
  const { t } = useI18n();
  const imp = useVintedImport(onDone);
  const text = imp.stage && imp.stage !== 'COMPLETE' ? t(`vinted.stage${imp.stage}`) : imp.lastImport ? t('vinted.refreshShort') : label === 'short' ? t('vinted.importShort') : t('vinted.import');
  return (
    <Button variant={variant} size={size} block={block} icon="repost" loading={imp.busy} onClick={imp.run} title={t('vinted.importHint')} aria-live="polite">
      {text}
    </Button>
  );
}
