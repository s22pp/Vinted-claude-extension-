import { useState } from 'react';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import { MARKDOWN_KEY, type MarkdownPlan, type MarkdownStep, type PlannedStep, normalizeSteps } from '@/intelligence/markdown';
import type { ItemView } from '@/intelligence/portfolio';
import { Badge, Button, Input } from '@/ui/components/primitives';
import { useEra } from '../state';
import { PriceOnVintedButton } from './vinted-price';

/** The step of a plan the seller can act on now (the price to apply), null otherwise. */
export function dueStep(p: MarkdownPlan | undefined): PlannedStep | null {
  return p?.status === 'DUE' ? p.step : null;
}

/** One line: "J+30 · −10 % → 45 €". */
export function StepLine({ s }: { s: PlannedStep }) {
  const { t, money } = useI18n();
  return <>{t('markdown.step', { day: s.day, pct: s.pct, price: money(s.targetCents) })}</>;
}

/** Plan de baisse of one listing: its calendar, the step due now and its one-click (confirmed) apply. */
export function MarkdownPlanView({ v, onAddCost }: { v: ItemView; onAddCost: () => void }) {
  const { t, money, date } = useI18n();
  const era = useEra();
  const [edit, setEdit] = useState(false);
  const plan = era.markdown.get(v.item.id);
  if (!plan || plan.status === 'NONE') {
    return (
      <div className="stack" style={{ gap: 8 }} data-testid="markdown">
        <p className="t-small t-muted">{era.markdownSteps.length ? t('markdown.none') : t('markdown.off')}</p>
        <StepsEditor open={edit} onToggle={() => setEdit(!edit)} />
      </div>
    );
  }
  const floor = plan.status === 'NO_COST' ? null : plan.floorCents;
  const state = (s: PlannedStep) => (s.done ? 'done' : s.at <= era.now ? 'due' : 'later');
  return (
    <div className="stack" style={{ gap: 10 }} data-testid="markdown">
      <p className="t-small t-muted">{t('markdown.basis', { start: money(plan.startCents), floor: floor === null ? t('markdown.floorUnknown') : money(floor) })}</p>
      <table className="dt dt--compact">
        <tbody>
          {plan.steps.map((s) => (
            <tr key={s.day} data-state={state(s)}>
              <td className="num">{t('markdown.day', { n: s.day })}</td>
              <td className="num">−{s.pct} %</td>
              <td className="num">
                <b>{money(s.targetCents)}</b>
                {s.clamped && <span className="t-faint"> ({t('markdown.clamped')})</span>}
              </td>
              <td className="t-small t-muted">{date(s.at)}</td>
              <td>
                <Badge tone={s.done ? 'emerald' : s.at <= era.now ? 'amber' : 'neutral'}>{t(`markdown.state.${state(s)}`)}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {plan.status === 'DUE' && (
        <div className="stack" style={{ gap: 6 }}>
          <p className="t-small" style={{ fontWeight: 600 }}>
            {t('markdown.dueNow', { from: money(v.askPrice ?? 0), to: money(plan.step.targetCents) })}
          </p>
          <div>
            <PriceOnVintedButton v={v} suggested={plan.step.targetCents} variant="primary" size="sm" label={t('markdown.apply', { price: money(plan.step.targetCents) })} />
          </div>
        </div>
      )}
      {plan.status === 'WAIT' && <p className="t-small t-muted">{t('markdown.next', { when: date(plan.next.at), price: money(plan.next.targetCents) })}</p>}
      {plan.status === 'DONE' && <p className="t-small t-muted">{plan.atFloor ? t('markdown.atFloor') : t('markdown.done')}</p>}
      {plan.status === 'NO_COST' && (
        <p className="t-small t-muted">
          {t('markdown.noCost')}{' '}
          <Button size="sm" variant="ghost" onClick={onAddCost}>
            {t('markdown.addCost')}
          </Button>
        </p>
      )}
      <StepsEditor open={edit} onToggle={() => setEdit(!edit)} />
    </div>
  );
}

/** The calendar itself (the same for every listing): up to 4 steps, days online → % off the starting price. */
function StepsEditor({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { t } = useI18n();
  const era = useEra();
  const [rows, setRows] = useState<{ day: string; pct: string }[] | null>(null);
  const current = rows ?? era.markdownSteps.map((s) => ({ day: String(s.day), pct: String(s.pct) }));
  const clean = normalizeSteps(current.map((r) => ({ day: Number(r.day), pct: Number(r.pct) })));
  const save = async () => {
    await repo.setSetting(MARKDOWN_KEY, clean satisfies MarkdownStep[]);
    setRows(null);
    onToggle();
  };
  if (!open) {
    return (
      <div>
        <Button size="sm" variant="ghost" icon="edit" onClick={onToggle}>
          {t('markdown.edit')}
        </Button>
      </div>
    );
  }
  const set = (i: number, patch: Partial<{ day: string; pct: string }>) => setRows(current.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="stack" style={{ gap: 8 }} data-testid="markdown-editor">
      <p className="t-small t-faint">{t('markdown.editHint')}</p>
      {current.map((r, i) => (
        <div key={i} className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span className="t-small">{t('markdown.after')}</span>
          <Input aria-label={t('markdown.daysLabel', { i: i + 1 })} inputMode="numeric" value={r.day} onChange={(e) => set(i, { day: e.target.value })} style={{ width: 64 }} />
          <span className="t-small">{t('markdown.daysOnline')}</span>
          <Input aria-label={t('markdown.pctLabel', { i: i + 1 })} inputMode="numeric" value={r.pct} onChange={(e) => set(i, { pct: e.target.value })} style={{ width: 56 }} />
          <span className="t-small">%</span>
          <Button size="sm" variant="ghost" icon="x" aria-label={t('markdown.removeStep')} onClick={() => setRows(current.filter((_, j) => j !== i))} />
        </div>
      ))}
      <div className="row wrap" style={{ gap: 8 }}>
        {current.length < 4 && (
          <Button size="sm" variant="ghost" icon="plus" onClick={() => setRows([...current, { day: '', pct: '' }])}>
            {t('markdown.addStep')}
          </Button>
        )}
        <Button size="sm" variant="primary" onClick={() => void save()}>
          {clean.length ? t('markdown.save', { n: clean.length }) : t('markdown.saveOff')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setRows(null);
            onToggle();
          }}
        >
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  );
}
