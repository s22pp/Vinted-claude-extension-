import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useI18n } from '@/i18n';
import { Button, Card } from '@/ui/components/primitives';
import { recordError } from '@/data/error-journal';

export { ERROR_JOURNAL_KEY as UI_ERRORS_KEY, type JournalError as UiError, readErrors as readUiErrors } from '@/data/error-journal';

interface Props {
  /** Where the error happened (a screen, a page of the extension): written in the report. */
  where: string;
  /** A new value (another screen, another item) clears the error: navigating away always works. */
  resetKey?: string;
  children: ReactNode;
  /** The whole page failed (outside a screen): the fallback offers a reload only. */
  page?: boolean;
}

/**
 * A display error stays where it happened: the screen shows what went wrong and how to go on, the menu and the
 * other screens keep working. Nothing is sent anywhere: the error is kept locally for the diagnostic report.
 */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    void recordError(this.props.where, error, info.componentStack ?? '');
  }

  override componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return <Fallback error={this.state.error} page={!!this.props.page} onRetry={() => this.setState({ error: null })} />;
  }
}

function Fallback({ error, page, onRetry }: { error: Error; page: boolean; onRetry: () => void }) {
  const { t } = useI18n();
  // A screen that fails to load after an update (its file changed): only a reload brings the new one.
  const chunk = /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(error.message);
  return (
    <div className="stack-4" role="alert" data-testid="error-boundary" style={page ? { padding: 24, maxWidth: 640, margin: '0 auto' } : undefined}>
      <Card title={t('boundary.title')} icon="info" tone="coral">
        <div className="stack-3">
          <p className="t-small">{chunk ? t('boundary.chunk') : page ? t('boundary.page') : t('boundary.hint')}</p>
          <pre className="t-small t-muted" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
            {error.message}
          </pre>
          <div className="row wrap" style={{ gap: 8 }}>
            {!page && !chunk && (
              <Button size="sm" variant="primary" onClick={onRetry}>
                {t('boundary.retry')}
              </Button>
            )}
            {!page && (
              <Button size="sm" variant="ghost" onClick={() => (location.hash = '#/today')}>
                {t('boundary.home')}
              </Button>
            )}
            <Button size="sm" variant={page || chunk ? 'primary' : 'ghost'} onClick={() => location.reload()}>
              {t('boundary.reload')}
            </Button>
          </div>
          <p className="t-small t-faint">{t('boundary.report')}</p>
        </div>
      </Card>
    </div>
  );
}
