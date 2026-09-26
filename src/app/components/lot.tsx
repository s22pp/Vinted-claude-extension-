import { useMemo, useState } from 'react';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import { expectedValue, parseLot, splitLot } from '@/intelligence/lot';
import { Drawer, useToast } from '@/ui/components/overlays';
import { Badge, Button, Field, Input, Money, Segmented } from '@/ui/components/primitives';
import { go, useEra } from '../state';
import { useMoneyField } from './forms';

/**
 * "Ajouter un lot": one line per article, as you would say it; the price paid split between them (equally, or in
 * proportion to what such articles sell for YOU). Every line becomes a sheet in the workshop.
 */
export function LotDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const era = useEra();
  const toast = useToast();
  const [text, setText] = useState('');
  const total = useMoneyField(null);
  const [date, setDate] = useState('');
  const [source, setSource] = useState('');
  const [mode, setMode] = useState<'VALUE' | 'EQUAL'>('VALUE');
  const [busy, setBusy] = useState(false);
  const lines = useMemo(() => parseLot(text), [text]);
  const values = useMemo(() => lines.map((l) => expectedValue(era.model, l)), [lines, era.model]);
  const costs = total.cents === null ? lines.map(() => null) : splitLot(total.cents, values, mode);
  const history = values.some((v) => v !== null);

  const create = async () => {
    setBusy(true);
    try {
      const ids = await repo.addLot(lines, { costs, purchaseDate: date ? new Date(`${date}T12:00:00`).getTime() : null, source: source.trim() || null, totalCents: total.cents });
      toast('success', t('lot.done', { n: ids.length }), t('lot.doneHint'));
      setText('');
      onClose();
      go(`workshop/${ids[0]}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={() => !busy && onClose()}
      title={t('lot.title')}
      footer={
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" icon="check" loading={busy} disabled={!lines.length || total.invalid} onClick={create}>
            {t('lot.create', { n: lines.length })}
          </Button>
        </div>
      }
    >
      <div className="stack-3">
        <p className="t-small t-muted">{t('lot.intro')}</p>
        <Field label={t('lot.lines')} htmlFor="lot-lines">
          <textarea id="lot-lines" className="input" rows={7} style={{ height: 'auto', resize: 'vertical' }} placeholder={t('lot.placeholder')} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <p className="t-small t-faint" style={{ marginTop: -6 }}>{t('lot.linesHint')}</p>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 10 }}>
          <Field label={t('lot.total')} htmlFor="lot-total" optional error={total.invalid ? t('add.invalidAmount') : null}>
            <Input id="lot-total" money value={total.raw} onChange={(e) => total.setRaw(e.target.value)} />
          </Field>
          <Field label={t('lot.date')} htmlFor="lot-date" optional>
            <Input id="lot-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={t('lot.source')} htmlFor="lot-src" optional>
            <Input id="lot-src" value={source} placeholder={t('lot.sourcePh')} onChange={(e) => setSource(e.target.value)} />
          </Field>
        </div>
        {total.cents !== null && lines.length > 1 && (
          <div className="stack" style={{ gap: 4 }}>
            <Segmented<'VALUE' | 'EQUAL'> label={t('lot.split')} value={mode} onChange={setMode} options={[{ value: 'VALUE', label: t('lot.splitValue') }, { value: 'EQUAL', label: t('lot.splitEqual') }]} />
            <span className="t-small t-faint">{mode === 'VALUE' ? t(history ? 'lot.splitValueHint' : 'lot.splitNoHistory') : t('lot.splitEqualHint')}</span>
          </div>
        )}
        {lines.length > 0 && (
          <div className="table-wrap" data-testid="lot-preview">
            <table className="dt dt--compact">
              <thead>
                <tr>
                  <th>{t('lot.colArticle')}</th>
                  <th>{t('lot.colBrand')}</th>
                  <th>{t('lot.colSize')}</th>
                  <th>{t('lot.colCondition')}</th>
                  <th className="num">{t('lot.colCost')}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td>
                      {l.title}
                      <div className="t-small t-faint">{t(`category.${l.category}`)}</div>
                    </td>
                    <td>{l.brandKnown ? l.brand : <Badge tone="amber">{t('lot.brandUnknown')}</Badge>}</td>
                    <td>{l.size ?? '—'}</td>
                    <td>{l.condition ? t(`condition.${l.condition}`) : '—'}</td>
                    <td className="num">
                      <Money cents={costs[i] ?? null} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Drawer>
  );
}
