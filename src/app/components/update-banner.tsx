import { useEffect, useState } from 'react';
import type { EraMessage } from '@/data/adapters/vinted/protocol';
import type { UpdateState } from '@/data/self-update';
import { useI18n } from '@/i18n';
import { useToast } from '@/ui/components/overlays';
import { Button } from '@/ui/components/primitives';

/** The update state from ERA's worker, read now and every minute. */
export function useUpdateState(): UpdateState | null {
  const [s, setS] = useState<UpdateState | null>(null);
  useEffect(() => {
    let live = true;
    const read = () =>
      void browser.runtime
        .sendMessage({ type: 'era:update:status' } satisfies EraMessage)
        .then((r: UpdateState) => live && r && typeof r.running === 'string' && setS(r))
        .catch(() => undefined);
    read();
    const id = setInterval(read, 60_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);
  return s;
}

export async function updateNow(t: (k: string, p?: Record<string, string | number>) => string, toast: ReturnType<typeof useToast>): Promise<void> {
  const r = (await browser.runtime.sendMessage({ type: 'era:update:now' } satisfies EraMessage).catch((e) => ({ ok: false, detail: String(e) }))) as { ok: boolean; detail?: string };
  if (!r.ok) toast('error', t('update.notNow'), r.detail ?? '');
}

/** A new version waits in ERA's folder: one click takes it (ERA reloads and opens again here). */
export function UpdateBanner() {
  const { t } = useI18n();
  const toast = useToast();
  const s = useUpdateState();
  const [busy, setBusy] = useState(false);
  if (!s?.ready || !s.onDisk) return null;
  return (
    <div className="demo-banner" role="status" data-testid="update-banner" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <span className="grow">{t('update.ready', { next: s.onDisk, current: s.running })}</span>
      <Button
        size="sm"
        variant="primary"
        icon="repost"
        loading={busy}
        onClick={() => {
          setBusy(true);
          void updateNow(t, toast).finally(() => setBusy(false));
        }}
      >
        {t('update.now')}
      </Button>
    </div>
  );
}
