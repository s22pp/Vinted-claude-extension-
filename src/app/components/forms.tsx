import { useState } from 'react';
import { CATEGORIES, CONDITIONS, type Category, type Condition, type Gender } from '@/domain/entities';
import { parseMoneyInput } from '@/domain/money';
import { mapCsv, parseCsv } from '@/data/import-csv';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import { Drawer, Modal, useToast } from '@/ui/components/overlays';
import { Button, Field, Input, Select, Stages } from '@/ui/components/primitives';

export function useMoneyField(initial: number | null) {
  const { num } = useI18n();
  const [raw, setRaw] = useState(initial === null ? '' : num(initial / 100, 2));
  const parsed = parseMoneyInput(raw);
  return { raw, setRaw, cents: parsed === undefined ? null : parsed, invalid: parsed === undefined };
}

export function CategorySelect({ value, onChange, id }: { value: Category; onChange: (c: Category) => void; id?: string }) {
  const { t } = useI18n();
  return <Select id={id} value={value} onChange={(e) => onChange(e.target.value as Category)} options={CATEGORIES.map((c) => ({ value: c, label: t(`category.${c}`) }))} />;
}

export function ConditionSelect({ value, onChange, id }: { value: Condition | ''; onChange: (c: Condition | '') => void; id?: string }) {
  const { t } = useI18n();
  return (
    <Select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value as Condition | '')}
      options={[{ value: '', label: '—' }, ...CONDITIONS.map((c) => ({ value: c, label: t(`condition.${c}`) }))]}
    />
  );
}

export function AddItemDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [category, setCategory] = useState<Category>('JACKET');
  const [size, setSize] = useState('');
  const [condition, setCondition] = useState<Condition | ''>('VERY_GOOD');
  const cost = useMoneyField(null);
  const price = useMoneyField(null);
  const [date, setDate] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [touched, setTouched] = useState(false);
  const valid = title.trim() && brand.trim() && !cost.invalid && !price.invalid;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    setState('saving');
    await repo.addItem({
      title: title.trim(),
      brand: brand.trim(),
      model: model.trim() || null,
      category,
      gender: 'MEN' as Gender,
      size: size.trim() || null,
      condition: condition || null,
      purchasePriceCents: cost.cents,
      purchaseDate: date ? new Date(date).getTime() : null,
      purchaseSource: null,
      priceCents: price.cents,
      listedAt: null,
      views: null,
      favorites: null,
      url: null,
    });
    setState('saved');
    toast('success', t('add.saved'), title);
    setTimeout(() => {
      setState('idle');
      setTitle('');
      setModel('');
      setSize('');
      cost.setRaw('');
      price.setRaw('');
      setTouched(false);
      onClose();
    }, 450);
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={t('add.title')}
      footer={
        <>
          <Button variant="ghost" type="button" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" type="submit" form="add-item" loading={state === 'saving'} icon={state === 'saved' ? 'check' : 'plus'}>
            {state === 'saving' ? t('add.saving') : state === 'saved' ? t('common.saved') : t('add.submit')}
          </Button>
        </>
      }
    >
      <form id="add-item" className="stack-4" onSubmit={submit} noValidate>
        <Field label={t('buy.fTitle')} htmlFor="f-title" error={touched && !title.trim() ? t('add.required') : null}>
          <Input id="f-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Veste Harrington Ralph Lauren" aria-invalid={touched && !title.trim()} />
        </Field>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <Field label={t('buy.fBrand')} htmlFor="f-brand" error={touched && !brand.trim() ? t('add.required') : null}>
            <Input id="f-brand" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Ralph Lauren" aria-invalid={touched && !brand.trim()} />
          </Field>
          <Field label={t('buy.fModel')} optional htmlFor="f-model">
            <Input id="f-model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="Harrington" />
          </Field>
          <Field label={t('buy.fCategory')} htmlFor="f-cat">
            <CategorySelect id="f-cat" value={category} onChange={setCategory} />
          </Field>
          <Field label={t('buy.fSize')} optional htmlFor="f-size">
            <Input id="f-size" value={size} onChange={(e) => setSize(e.target.value)} placeholder="M" />
          </Field>
          <Field label={t('buy.fCondition')} htmlFor="f-cond">
            <ConditionSelect id="f-cond" value={condition} onChange={setCondition} />
          </Field>
          <Field label={t('item.field.purchaseDate')} optional htmlFor="f-date">
            <Input id="f-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={t('item.field.purchasePrice')} optional htmlFor="f-cost" error={cost.invalid ? t('add.invalidAmount') : null}>
            <Input id="f-cost" money value={cost.raw} onChange={(e) => cost.setRaw(e.target.value)} placeholder="—" aria-invalid={cost.invalid} />
          </Field>
          <Field label={t('add.listedPrice')} optional htmlFor="f-price" error={price.invalid ? t('add.invalidAmount') : null}>
            <Input id="f-price" money value={price.raw} onChange={(e) => price.setRaw(e.target.value)} placeholder="—" aria-invalid={price.invalid} />
          </Field>
        </div>
        <p className="t-small t-faint">{t('onboarding.s3Body')}</p>
      </form>
    </Drawer>
  );
}

export function CostEditor({ itemId, initial, onDone }: { itemId: string; initial: number | null; onDone?: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const cost = useMoneyField(initial);
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cost.invalid) return;
    setState('saving');
    await repo.setPurchasePrice(itemId, cost.cents);
    setState('saved');
    toast('success', t('common.saved'));
    setTimeout(() => {
      setState('idle');
      onDone?.();
    }, 600);
  };
  return (
    <form className="row" onSubmit={save} style={{ alignItems: 'flex-end' }}>
      <Field label={t('item.field.purchasePrice')} htmlFor={`cost-${itemId}`} error={cost.invalid ? t('add.invalidAmount') : null}>
        <Input id={`cost-${itemId}`} money value={cost.raw} onChange={(e) => cost.setRaw(e.target.value)} placeholder="18" style={{ width: 120 }} aria-invalid={cost.invalid} />
      </Field>
      <Button type="submit" variant="primary" loading={state === 'saving'} icon={state === 'saved' ? 'check' : undefined}>
        {state === 'saving' ? t('common.saving') : state === 'saved' ? t('common.saved') : t('item.saveCost')}
      </Button>
    </form>
  );
}

export function SaleModal({ open, onClose, itemId, suggested }: { open: boolean; onClose: () => void; itemId: string; suggested: number | null }) {
  const { t } = useI18n();
  const toast = useToast();
  const price = useMoneyField(suggested);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (price.invalid || price.cents === null) return;
    setBusy(true);
    await repo.recordSale(itemId, price.cents, new Date(date).getTime() + 12 * 3600_000);
    setBusy(false);
    toast('success', t('item.sold'));
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title={t('item.recordSale')}>
      <form className="stack-4" onSubmit={submit}>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <Field label={t('item.salePrice')} htmlFor="sale-price" error={price.invalid ? t('add.invalidAmount') : null}>
            <Input id="sale-price" money value={price.raw} onChange={(e) => price.setRaw(e.target.value)} aria-invalid={price.invalid} />
          </Field>
          <Field label={t('sales.col.date')} htmlFor="sale-date">
            <Input id="sale-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" loading={busy} icon="check" disabled={price.cents === null}>
            {t('item.confirmSale')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function ImportCsvModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [stage, setStage] = useState<'READING' | 'MATCHING' | 'COMPLETE' | null>(null);
  const [result, setResult] = useState<{ n: number; skipped: number } | null>(null);
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      setStage('READING');
      const text = await f.text();
      setStage('MATCHING');
      const { items, skipped } = mapCsv(parseCsv(text));
      for (const it of items) await repo.addItem({ ...it });
      setStage('COMPLETE');
      setResult({ n: items.length, skipped });
      toast('success', t('import.result', { n: items.length, skipped }));
    } catch {
      setStage(null);
      toast('error', t('import.error'));
    }
  };
  return (
    <Modal
      open={open}
      onClose={() => {
        setStage(null);
        setResult(null);
        onClose();
      }}
      title={t('import.title')}
    >
      <p className="t-muted t-small">{t('import.body')}</p>
      <label className="choice" style={{ justifyContent: 'center' }}>
        <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
        <span className="btn btn--primary">{t('import.pick')}</span>
      </label>
      {stage && <Stages stages={['READING', 'MATCHING', 'COMPLETE']} current={stage} labelKey={(s) => t(`import.stage${s}`)} />}
      {result && <p className="t-small">{t('import.result', result)}</p>}
    </Modal>
  );
}
