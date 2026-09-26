import { useI18n } from '@/i18n';
import type { ComparableAnalysis } from '@/intelligence/comparables';

/** Which searches ran and what each brought back — so "nothing comparable" can be checked, not just believed. */
export function SearchTrace({ analysis }: { analysis: ComparableAnalysis }) {
  const { t } = useI18n();
  const rows = analysis.queryStats ?? analysis.queries.map((text) => ({ text, returned: null as number | null, total: null as number | null }));
  if (!rows.length) return null;
  return (
    <div className="stack t-small" data-testid="search-trace" style={{ marginTop: 12 }}>
      <span className="t-caption">{t('market.trace')}</span>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {rows.map((r, i) => (
          <li key={i}>
            « {r.text} » → {r.returned === null ? '—' : t('market.traceRow', { n: r.returned })}
            {r.total !== null && r.total !== r.returned ? ` ${t('market.traceTotal', { n: r.total })}` : ''}
          </li>
        ))}
      </ul>
      <span className="t-faint">{t('market.traceHint')}</span>
    </div>
  );
}
