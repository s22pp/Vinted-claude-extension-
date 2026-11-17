import { useState } from 'react';
import type { EraMessage } from '@/data/adapters/vinted/protocol';
import { useI18n } from '@/i18n';
import { useToast } from '@/ui/components/overlays';
import { Button } from '@/ui/components/primitives';
import { updateNow, useUpdateState } from './update-banner';

const INSTALL = 'curl -fsSL https://raw.githubusercontent.com/s22pp/Vinted-claude-extension-/refs/heads/claude/adoring-keller-jahd0y/scripts/mac/install-auto-update.sh | bash';

/** Updates without a ZIP: the version running, the one in ERA's folder, one click, and the seller's choice of "by itself". */
export function UpdateCard() {
  const { t } = useI18n();
  const toast = useToast();
  const s = useUpdateState();
  const [auto, setAuto] = useState<boolean | null>(null);
  const on = auto ?? s?.auto ?? false;
  return (
    <div className="stack-3" data-testid="update-card">
      <p className="t-small t-muted" style={{ margin: 0 }}>
        {s ? (s.folder ? (s.ready ? t('update.stateReady', { current: s.running, next: s.onDisk! }) : t('update.stateCurrent', { current: s.running })) : t('update.stateStore', { current: s.running })) : '…'}
      </p>
      {s?.ready && (
        <div>
          <Button size="sm" variant="primary" icon="repost" onClick={() => void updateNow(t, toast)}>
            {t('update.now')}
          </Button>
        </div>
      )}
      {s?.folder && (
        <label htmlFor="upd-auto" className="row" style={{ gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
          <input
            id="upd-auto"
            type="checkbox"
            className="checkbox"
            checked={on}
            onChange={(e) => {
              setAuto(e.target.checked);
              void browser.runtime.sendMessage({ type: 'era:update:auto', on: e.target.checked } satisfies EraMessage).catch(() => undefined);
            }}
            style={{ marginTop: 2 }}
          />
          <span>
            {t('update.auto')} <span className="t-small t-faint">{t('update.autoHint')}</span>
          </span>
        </label>
      )}
      <p className="t-small t-muted" style={{ margin: 0 }}>{t('update.howTo')}</p>
      <code className="listing-box" style={{ wordBreak: 'break-all' }}>{INSTALL}</code>
      <p className="t-small t-faint" style={{ margin: 0 }}>{t('update.howTo2')}</p>
      <div>
        <Button size="sm" icon="repost" onClick={() => browser.runtime.reload()}>
          {t('settings.reload')}
        </Button>
      </div>
    </div>
  );
}
