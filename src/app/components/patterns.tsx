import { useMemo, useState } from 'react';
import { useI18n } from '@/i18n';
import { type Pattern, type PatternKind, minePatterns } from '@/intelligence/patterns';
import { Icon, type IconName, IconTile, type TileTone } from '@/ui/components/icons';
import { Badge, Card, ConfidenceMeter, Sample } from '@/ui/components/primitives';
import { useEra } from '../state';

const KIND: Record<PatternKind, { icon: IconName; tone: TileTone }> = {
  SPEED: { icon: 'clock', tone: 'cyan' },
  PROFIT: { icon: 'trendUp', tone: 'emerald' },
  DISCOUNT: { icon: 'scale', tone: 'amber' },
  REFUND: { icon: 'alert', tone: 'coral' },
  STOCK_GAP: { icon: 'layers', tone: 'violet' },
  SWEET_SPOT: { icon: 'target', tone: 'pink' },
  CONDITION: { icon: 'tag', tone: 'cobalt' },
  TIMING: { icon: 'calendar', tone: 'cyan' },
};

function Compare({ p }: { p: Pattern }) {
  const { t, num } = useI18n();
  const max = Math.max(p.value, p.baseline) || 1;
  const fmt = (v: number) => (p.unit === 'days' ? `${Math.round(v)} j` : p.unit === 'pct' ? `${Math.round(v)} %` : `${num(v / (p.kind === 'CONDITION' ? 1 : 100), p.kind === 'CONDITION' ? 0 : 2)} €`);
  const rows: [string, number, string][] = [
    [String(p.params.label ?? p.params.band ?? p.params.a ?? ''), p.value, p.tone === 'warning' ? 'var(--amber)' : 'var(--violet)'],
    [t('patterns.rest'), p.baseline, 'var(--border-strong)'],
  ];
  return (
    <div className="stack" style={{ gap: 6 }} aria-hidden="true">
      {rows.map(([label, v, color]) => (
        <div key={label} className="row" style={{ gap: 8 }}>
          <span className="t-small t-faint clamp-1" style={{ width: 110 }}>
            {label}
          </span>
          <span className="grow meter" style={{ height: 8 }}>
            <span className="meter__fill" style={{ display: 'block', width: `${(v / max) * 100}%`, background: color }} />
          </span>
          <span className="t-small num" style={{ width: 64, textAlign: 'right' }}>
            {fmt(v)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function PatternsCard() {
  const { t } = useI18n();
  const era = useEra();
  const patterns = useMemo(() => minePatterns(era.sales, era.views, { category: (c) => t(`category.${c}`) }), [era.sales, era.views, t]);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Card title={t('patterns.title')} hint={t('patterns.hint')} icon="insights" tone="violet" id="patterns">
      {patterns.length === 0 ? (
        <p className="t-muted">{t('patterns.none')}</p>
      ) : (
        <>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
            {patterns.map((p, k) => {
              const kind = KIND[p.kind];
              const expanded = open === p.id;
              return (
                <article key={p.id} className="strategy" style={{ animationDelay: `${k * 40}ms`, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
                    <IconTile name={kind.icon} tone={kind.tone} />
                    <div className="grow">
                      <div className="row wrap" style={{ gap: 6, marginBottom: 4 }}>
                        <Badge tone={p.tone === 'positive' ? 'emerald' : p.tone === 'warning' ? 'amber' : 'cyan'}>{t(`patterns.kind.${p.kind}`)}</Badge>
                        <Sample n={p.sample} />
                      </div>
                      <p style={{ fontWeight: 600, lineHeight: 1.4 }}>{t(`patterns.p.${p.code}`, p.params)}</p>
                    </div>
                  </div>
                  <Compare p={p} />
                  <button type="button" className="btn btn--ghost btn--sm" style={{ alignSelf: 'flex-start', paddingLeft: 0 }} aria-expanded={expanded} onClick={() => setOpen(expanded ? null : p.id)}>
                    <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={14} /> {t('patterns.why')} · {t('patterns.todo')}
                  </button>
                  {expanded && (
                    <dl className="reco__grid" style={{ margin: 0, gridTemplateColumns: '1fr', gap: 4 }}>
                      <dt className="reco__k">{t('patterns.why')}</dt>
                      <dd style={{ margin: 0 }} className="t-small">
                        {t(`patterns.w.${p.kind}`)}
                      </dd>
                      {p.action && (
                        <>
                          <dt className="reco__k" style={{ marginTop: 6 }}>
                            {t('patterns.todo')}
                          </dt>
                          <dd style={{ margin: 0 }} className="t-small">
                            {t(`patterns.a.${p.action}`, p.params)}
                          </dd>
                        </>
                      )}
                      <dt className="reco__k" style={{ marginTop: 6 }}>
                        {t('confidence.label')}
                      </dt>
                      <dd style={{ margin: 0 }}>
                        <ConfidenceMeter level={p.confidence} />
                      </dd>
                    </dl>
                  )}
                </article>
              );
            })}
          </div>
          <p className="t-small t-faint" style={{ marginTop: 12 }}>
            {t('patterns.caveat')}
          </p>
        </>
      )}
    </Card>
  );
}
