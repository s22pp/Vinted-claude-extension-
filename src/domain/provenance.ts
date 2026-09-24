export const PROVENANCES = ['USER_PROVIDED', 'OBSERVED', 'DERIVED', 'INFERRED', 'PREDICTED', 'UNKNOWN'] as const;
export type Provenance = (typeof PROVENANCES)[number];

export interface FieldMeta {
  p: Provenance;
  at: number;
  /** 0..1 when meaningful (e.g. inference confidence) */
  q?: number;
}

/** UI-facing data quality state. Never conveyed by colour alone. */
export type DataQuality = 'KNOWN' | 'PARTIAL' | 'INFERRED' | 'PREDICTED' | 'UNKNOWN';

export function qualityOf(value: unknown, meta?: FieldMeta): DataQuality {
  if (value === null || value === undefined || meta?.p === 'UNKNOWN') return 'UNKNOWN';
  if (!meta) return 'KNOWN';
  if (meta.p === 'INFERRED') return 'INFERRED';
  if (meta.p === 'PREDICTED') return 'PREDICTED';
  return 'KNOWN';
}
