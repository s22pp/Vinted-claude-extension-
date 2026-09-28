import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { type ExpenseRow, db, uid } from '@/data/db';
import { useI18n } from '@/i18n';
import { EXPENSE_CATEGORIES, type ExpenseCategory, expenseSummary, yearOf } from '@/intelligence/accounting';
import type { MoneyMetric } from '@/domain/money';
import { downloadText } from '@/lib/download';
import { Button, Card, Field, Input, MetricValue, Money, Select } from '@/ui/components/primitives';
import { useMoneyField } from './forms';

/** Expenses of the year (packaging, boosts, trips…): entered by hand, removed from the margin for a real net profit. */
export function ExpensesCard({ year, grossMargin }: { year: number; grossMargin: MoneyMetric }) {
  const { t, date, money } = useI18n();
  const all = useLiveQuery(() => db.expenses.orderBy('date').reverse().toArray(), []) ?? [];
  const rows = all.filter((e) => yearOf(e.date) === year);
  const sum = expenseSummary(all, year, grossMargin);
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState<ExpenseCategory>('PACKAGING');
  const [note, setNote] = useState('');
  const amount = useMoneyField(null);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (amount.cents === null || amount.invalid || amount.cents <= 0) return;
    const row: ExpenseRow = { id: uid('exp'), date: new Date(`${day}T12:00:00`).getTime(), amountCents: amount.cents, category, note: note.trim() };
    await db.expenses.put(row);
    amount.setRaw('');
    setNote('');
  };
  const csv = () =>
    downloadText(
      `era-depenses-${year}.csv`,
      ['date;categorie;montant;note', ...rows.map((r) => [new Date(r.date).toISOString().slice(0, 10), t(`expenses.c.${r.category}`), (r.amountCents / 100).toFixed(2).replace('.', ','), `"${r.note.replaceAll('"', '""')}"`].join(';'))].join('\n'),
    );

  return (
    <Card title={t('expenses.title')} hint={t('expenses.hint')} icon="box" tone="amber" actions={rows.length ? <Button size="sm" variant="ghost" onClick={csv}>{t('expenses.csv')}</Button> : null}>
      <div className="stack-3" data-testid="expenses">
        <div className="row wrap" style={{ gap: 24 }}>
          <span>
            <span className="t-small t-muted">{t('expenses.total', { year })}</span>
            <br />
            <b className="num">{money(sum.totalCents)}</b>
          </span>
          <span>
            <span className="t-small t-muted">{t('expenses.net')}</span>
            <br />
            <b className="num" data-testid="net-profit">
              <MetricValue metric={sum.net} sign />
            </b>
          </span>
          {sum.byCategory.length > 0 && <span className="t-small t-muted">{sum.byCategory.map((c) => `${t(`expenses.c.${c.category}`)} ${money(c.cents)}`).join(' · ')}</span>}
        </div>
        <form className="row wrap" style={{ gap: 8, alignItems: 'flex-end' }} onSubmit={add}>
          <Field label={t('expenses.date')} htmlFor="ex-date">
            <Input id="ex-date" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          </Field>
          <Field label={t('expenses.category')} htmlFor="ex-cat">
            <Select id="ex-cat" value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)} options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: t(`expenses.c.${c}`) }))} />
          </Field>
          <Field label={t('expenses.amount')} htmlFor="ex-amount" error={amount.invalid ? t('add.invalidAmount') : null}>
            <Input id="ex-amount" money value={amount.raw} onChange={(e) => amount.setRaw(e.target.value)} style={{ width: 100 }} />
          </Field>
          <Field label={t('expenses.note')} htmlFor="ex-note" optional>
            <Input id="ex-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('expenses.notePh')} />
          </Field>
          <Button type="submit" icon="plus" disabled={amount.cents === null || amount.invalid}>
            {t('expenses.add')}
          </Button>
        </form>
        {rows.length > 0 && (
          <table className="dt dt--compact">
            <tbody>
              {rows.slice(0, 20).map((r) => (
                <tr key={r.id}>
                  <td className="num">{date(r.date)}</td>
                  <td>{t(`expenses.c.${r.category}`)}</td>
                  <td className="t-muted">{r.note}</td>
                  <td className="num">
                    <Money cents={r.amountCents} />
                  </td>
                  <td>
                    <Button size="sm" variant="ghost" icon="x" aria-label={t('expenses.remove')} onClick={() => void db.expenses.delete(r.id)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
}
