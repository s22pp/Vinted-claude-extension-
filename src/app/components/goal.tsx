import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import { type MonthlyGoal, goalProgress } from '@/intelligence/goal';
import { IconTile } from '@/ui/components/icons';
import { Button, Input, QualityTag, Segmented } from '@/ui/components/primitives';
import { useMoneyField } from './forms';
import { go, useEra } from '../state';

/** Monthly goal: pace, projection and what it takes, from the seller's own numbers. */
export function GoalCard() {
  const { t, money } = useI18n();
  const era = useEra();
  const goal = useLiveQuery(() => repo.getSetting<MonthlyGoal | null>('monthlyGoal', null), []);
  const [editing, setEditing] = useState(false);
  if (goal === undefined) return null;
  if (!goal || editing) return <GoalForm initial={goal} onDone={() => setEditing(false)} />;
  const g = goalProgress(goal, era.sales, era.views, era.now);
  const waiting = era.workshop.toList.length;
  return (
    <section className="goal" aria-label={t('goal.title')}>
      <div className="goal__head">
        <IconTile name="target" tone={g.onTrack ? 'emerald' : 'amber'} size="sm" />
        <span className="goal__title">
          {t(`goal.kind.${goal.kind}`)} · {t('goal.target', { amount: goal.cents })}
        </span>
        <span className="grow" />
        <Button size="sm" variant="ghost" icon="edit" onClick={() => setEditing(true)}>
          {t('goal.edit')}
        </Button>
      </div>
      <div className="goal__bar" aria-hidden="true">
        <span className="goal__fill" style={{ width: `${Math.min(100, g.ratio * 100)}%` }} />
        <span className="goal__pace" style={{ left: `${Math.min(100, (g.elapsedDays / g.daysInMonth) * 100)}%` }} title={t('goal.today')} />
      </div>
      <div className="goal__facts">
        <span>
          <b className="num">{money(g.currentCents)}</b> {t('goal.soFar', { n: g.salesSoFar })}
          {g.partial && <QualityTag quality="PARTIAL" text={t('goal.partial')} />}
        </span>
        <span className={g.onTrack ? 't-pos' : 't-warn'}>{t('goal.projection', { amount: g.projectedCents })}</span>
        {g.remainingCents > 0 && g.perSale && (
          <span>{t('goal.needed', { n: g.salesNeeded ?? 0, per: money(g.perSale.cents), k: g.perSale.n })}</span>
        )}
        {g.remainingCents === 0 && <span className="t-pos">{t('goal.reached')}</span>}
      </div>
      {g.salesGap !== null && g.salesGap > 0 && (
        <p className="goal__lever t-small">
          {g.extraListings !== null && g.listingsPerSale
            ? t('goal.lever', { expected: g.salesExpected, gap: g.salesGap, listings: g.extraListings, ratio: Math.round(g.listingsPerSale.n), s: g.listingsPerSale.sales30 })
            : t('goal.leverNoRate', { expected: g.salesExpected, gap: g.salesGap })}{' '}
          {waiting > 0 && (
            <button type="button" className="linklike" onClick={() => go('workshop')}>
              {t('goal.workshop', { n: waiting })} →
            </button>
          )}
        </p>
      )}
    </section>
  );
}

function GoalForm({ initial, onDone }: { initial: MonthlyGoal | null; onDone: () => void }) {
  const { t } = useI18n();
  const [kind, setKind] = useState<MonthlyGoal['kind']>(initial?.kind ?? 'REVENUE');
  const amount = useMoneyField(initial?.cents ?? null);
  return (
    <form
      className="goal goal--form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (amount.cents === null || amount.invalid) return;
        await repo.setSetting('monthlyGoal', { kind, cents: amount.cents } satisfies MonthlyGoal);
        onDone();
      }}
    >
      <IconTile name="target" tone="violet" size="sm" />
      <span className="goal__title">{t('goal.set')}</span>
      <Segmented
        label={t('goal.title')}
        value={kind}
        onChange={setKind}
        options={[
          { value: 'REVENUE', label: t('goal.kind.REVENUE') },
          { value: 'PROFIT', label: t('goal.kind.PROFIT') },
        ]}
      />
      <Input money value={amount.raw} onChange={(e) => amount.setRaw(e.target.value)} placeholder="2000" style={{ width: 120 }} aria-label={t('goal.amount')} />
      <Button type="submit" size="sm" variant="primary" disabled={amount.cents === null || amount.invalid}>
        {t('common.save')}
      </Button>
      {initial && (
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          {t('common.cancel')}
        </Button>
      )}
    </form>
  );
}
