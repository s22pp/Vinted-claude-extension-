import { useState } from 'react';
import { useI18n } from '@/i18n';
import { IllustrationAnalysis } from '@/ui/components/illustrations';
import { useErrorToast } from '@/ui/components/overlays';
import { Button, Card, EmptyState, ErrorState, Select, Stages } from '@/ui/components/primitives';
import { AnalysisView } from '../components/analysis-view';
import { analyzeItem } from '../market-run';
import { useBulkAnalyze } from '../components/tools';
import { PageHead } from '../Shell';
import { go, type Route, useEra } from '../state';

type Stage = 'COLLECTING' | 'COMPARING' | 'READY';

export function Market({ route }: { route: Route }) {
  const { t } = useI18n();
  const era = useEra();
  const errorToast = useErrorToast();
  const candidates = era.intel.filter((x) => x.view.current).sort((a, b) => (b.recommendation?.priority ?? 0) - (a.recommendation?.priority ?? 0));
  const itemId = route.query.get('item') ?? candidates.find((c) => c.analysis)?.view.item.id ?? candidates[0]?.view.item.id ?? null;
  const intel = itemId ? (era.intelById.get(itemId) ?? null) : null;
  const [stage, setStage] = useState<Stage | null>(null);
  const [error, setError] = useState<unknown>(null);
  const bulk = useBulkAnalyze();

  const run = async () => {
    if (!intel) return;
    setError(null);
    try {
      await analyzeItem(intel.view, era.mode, era.model, era.learning, setStage);
      setTimeout(() => setStage(null), 900);
    } catch (e) {
      setStage(null);
      setError(e);
      errorToast(e);
    }
  };

  return (
    <>
      <PageHead
        title={t('market.title')}
        sub={t('market.subtitle')}
        actions={
          bulk.pending > 0 ? (
            <Button icon="layers" loading={!!bulk.busy} onClick={() => bulk.run()}>
              {bulk.busy ? `${bulk.busy.done}/${bulk.busy.total}` : t('today.analyzeStock', { n: bulk.pending })}
            </Button>
          ) : null
        }
      />
      <Card style={{ marginBottom: 16 }}>
        <div className="row wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
          <div className="field grow" style={{ minWidth: 260 }}>
            <label className="field__label" htmlFor="mk-item">
              {t('market.pickItem')}
            </label>
            <Select
              id="mk-item"
              value={itemId ?? ''}
              onChange={(e) => go(`market?item=${e.target.value}`)}
              options={[
                { value: '', label: t('market.pickPlaceholder') },
                ...candidates.map((c) => ({ value: c.view.item.id, label: `${c.view.item.title}${c.analysis ? ' ·  ✓' : ''}` })),
              ]}
            />
          </div>
          <Button variant="primary" icon="market" disabled={!intel} loading={stage !== null && stage !== 'READY'} onClick={run}>
            {t('market.run')}
          </Button>
          {stage && <Stages stages={['COLLECTING', 'COMPARING', 'READY'] as Stage[]} current={stage} labelKey={(s) => t(`market.stage${s}`)} />}
        </div>
      </Card>
      {error != null && (
        <div style={{ marginBottom: 16 }}>
          <ErrorState error={error} onRetry={run} />
        </div>
      )}
      {!intel?.analysis ? (
        <Card>
          <EmptyState art={<IllustrationAnalysis />} title={t('market.empty')} why={t('market.emptyWhy')} action={intel ? <Button variant="primary" onClick={run}>{t('market.run')}</Button> : null} />
        </Card>
      ) : (
        <AnalysisView analysis={intel.analysis} pricing={intel.pricing} current={intel.view.askPrice} onRetry={() => document.getElementById('mk-item')?.focus()} />
      )}
    </>
  );
}
