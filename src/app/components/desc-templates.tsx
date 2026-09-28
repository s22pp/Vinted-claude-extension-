import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { uid } from '@/data/db';
import { repo } from '@/data/repo';
import { CATEGORIES, type Category, type Prep } from '@/domain/entities';
import { useI18n } from '@/i18n';
import { DESC_TEMPLATES_KEY, DESC_VARS, type DescTemplate, STARTER_TEMPLATE, matchTemplate } from '@/intelligence/workshop';
import { Modal } from '@/ui/components/overlays';
import { Badge, Button, Field, Input, Select } from '@/ui/components/primitives';

export function useDescTemplates(): DescTemplate[] {
  return useLiveQuery(() => repo.getSetting<DescTemplate[]>(DESC_TEMPLATES_KEY, []), []) ?? [];
}

/** The sheet's description template: the best match by default, another one, or ERA's standard description. */
export function DescTemplatePicker({ item, prep, description, templates, onPick }: { item: { category: Category; brand: string }; prep: Prep; description: string; templates: DescTemplate[]; onPick: (id: string | null) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const match = matchTemplate(templates, item);
  const value = prep.descTemplateId ?? 'AUTO';
  return (
    <div className="row wrap" style={{ gap: 8, alignItems: 'center', marginBottom: 8 }} data-testid="desc-templates">
      {templates.length > 0 && (
        <Select
          aria-label={t('dtpl.pick')}
          value={value}
          disabled={!!prep.descriptionOverride}
          title={prep.descriptionOverride ? t('dtpl.overridden') : undefined}
          onChange={(e) => onPick(e.target.value === 'AUTO' ? null : e.target.value)}
          options={[
            { value: 'AUTO', label: t('dtpl.auto', { name: match?.name ?? t('dtpl.standard') }) },
            ...templates.map((x) => ({ value: x.id, label: x.name })),
            { value: 'ERA', label: t('dtpl.standard') },
          ]}
        />
      )}
      <Button size="sm" variant="ghost" icon="book" onClick={() => setOpen(true)}>
        {templates.length ? t('dtpl.manage', { n: templates.length }) : t('dtpl.create')}
      </Button>
      {open && <DescTemplatesModal onClose={() => setOpen(false)} templates={templates} from={{ category: item.category, brand: item.brand, description }} />}
    </div>
  );
}

type Draft = { id: string | null; name: string; category: Category | ''; brand: string; text: string };

function DescTemplatesModal({ onClose, templates, from }: { onClose: () => void; templates: DescTemplate[]; from: { category: Category; brand: string; description: string } }) {
  const { t } = useI18n();
  const blank = (): Draft => ({ id: null, name: `${t(`category.${from.category}`)} ${from.brand}`.trim(), category: from.category, brand: from.brand, text: STARTER_TEMPLATE });
  const [draft, setDraft] = useState<Draft | null>(templates.length ? null : blank());
  const [confirm, setConfirm] = useState<string | null>(null);
  const store = (next: DescTemplate[]) => repo.setSetting(DESC_TEMPLATES_KEY, next);
  const save = async () => {
    if (!draft || !draft.name.trim() || !draft.text.trim()) return;
    const row: DescTemplate = { id: draft.id ?? uid('dt'), name: draft.name.trim(), category: draft.category || null, brand: draft.brand.trim() || null, text: draft.text };
    await store(draft.id ? templates.map((x) => (x.id === draft.id ? row : x)) : [...templates, row]);
    setDraft(null);
  };
  const scope = (x: DescTemplate) => [x.category ? t(`category.${x.category}`) : t('dtpl.anyCategory'), x.brand ?? t('dtpl.anyBrand')].join(' · ');
  return (
    <Modal open onClose={onClose} title={t('dtpl.title')}>
      <div className="stack-3" data-testid="desc-templates-modal">
        <p className="t-small t-muted">{t('dtpl.hint')}</p>
        {!draft && (
          <>
            {templates.map((x) => (
              <div key={x.id} className="row" style={{ gap: 8, alignItems: 'center' }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{x.name}</div>
                  <div className="t-small t-faint">{scope(x)}</div>
                </div>
                <Button size="sm" variant="ghost" icon="edit" onClick={() => setDraft({ id: x.id, name: x.name, category: x.category ?? '', brand: x.brand ?? '', text: x.text })}>
                  {t('common.edit')}
                </Button>
                {confirm === x.id ? (
                  <Button size="sm" variant="ghost" onClick={() => void store(templates.filter((y) => y.id !== x.id)).then(() => setConfirm(null))}>
                    {t('dtpl.confirmDelete')}
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" icon="x" aria-label={t('dtpl.delete', { name: x.name })} onClick={() => setConfirm(x.id)} />
                )}
              </div>
            ))}
            <div>
              <Button size="sm" variant="primary" icon="plus" onClick={() => setDraft(blank())}>
                {t('dtpl.new')}
              </Button>
            </div>
          </>
        )}
        {draft && (
          <>
            <Field label={t('dtpl.name')} htmlFor="dt-name">
              <Input id="dt-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
            <div className="row wrap" style={{ gap: 8 }}>
              <Field label={t('dtpl.category')} htmlFor="dt-cat">
                <Select id="dt-cat" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as Category | '' })} options={[{ value: '', label: t('dtpl.anyCategory') }, ...CATEGORIES.map((c) => ({ value: c, label: t(`category.${c}`) }))]} />
              </Field>
              <Field label={t('dtpl.brand')} htmlFor="dt-brand" optional>
                <Input id="dt-brand" value={draft.brand} placeholder={t('dtpl.anyBrand')} onChange={(e) => setDraft({ ...draft, brand: e.target.value })} />
              </Field>
            </div>
            <Field label={t('dtpl.text')} htmlFor="dt-text">
              <textarea id="dt-text" className="input wdesc" rows={11} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
            </Field>
            <div className="row wrap" style={{ gap: 4 }}>
              {DESC_VARS.map((v) => (
                <Badge key={v} tone="neutral" title={t(`dtpl.var.${v}`)}>{`{${v}}`}</Badge>
              ))}
            </div>
            <p className="t-small t-faint">{t('dtpl.varsHint')}</p>
            <div className="row wrap" style={{ gap: 8, justifyContent: 'flex-end' }}>
              <Button size="sm" variant="ghost" onClick={() => setDraft({ ...draft, text: from.description })}>
                {t('dtpl.fromSheet')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => (templates.length ? setDraft(null) : onClose())}>
                {t('common.cancel')}
              </Button>
              <Button size="sm" variant="primary" onClick={() => void save()} disabled={!draft.name.trim() || !draft.text.trim()}>
                {t('common.save')}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
