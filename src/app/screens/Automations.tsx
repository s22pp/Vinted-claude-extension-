import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import type { AutoRunResult, EraMessage } from '@/data/adapters/vinted/protocol';
import { db } from '@/data/db';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import { type AutoConfig, type FavMode, withDefaults } from '@/intelligence/automation';
import { useToast } from '@/ui/components/overlays';
import { Badge, Button, Card, Field, Flag, Input, Segmented, Select } from '@/ui/components/primitives';
import { useMoneyField } from '../components/forms';
import { PageHead } from '../Shell';
import { useEra } from '../state';
import { type MessageExample, MessagePicker } from '../components/fav-messages';

/** The offer shown in previews: the discount on the price, rounded up to the euro (the real one also respects the floor). */
const favoriteOfferPreview = (price: number, pct: number) => Math.ceil((price * (1 - pct / 100)) / 100) * 100;

/** Settings + manual runs + journal of the seller's automations. Everything is off until switched on. */
export function Automations() {
  const { t } = useI18n();
  const toast = useToast();
  const era = useEra();
  const stored = useLiveQuery(() => repo.getSetting<Partial<AutoConfig> | null>('automations', null), []);
  const [cfg, setCfg] = useState<AutoConfig | null>(null);
  const margin = useMoneyField(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (stored === undefined || cfg) return;
    const c = withDefaults(stored);
    setCfg(c);
    margin.setRaw(String(c.minMarginCents / 100).replace('.', ','));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored]);

  const log = useLiveQuery(() => db.autoLog.orderBy('at').reverse().limit(60).toArray(), []);
  if (!cfg) return null;
  // Previews use one of the seller's own listings (the most favourited), else a plain example.
  const listed = era.views.filter((v) => v.current && !v.item.isDemo).sort((a, b) => (b.current!.favorites ?? 0) - (a.current!.favorites ?? 0))[0];
  const example: MessageExample = listed
    ? { title: listed.item.title, brand: listed.item.brand, priceCents: listed.current!.priceCents, offerCents: favoriteOfferPreview(listed.current!.priceCents, cfg.fav.discountPct) }
    : { title: 'Veste Harrington Ralph Lauren M', brand: 'Ralph Lauren', priceCents: 5900, offerCents: favoriteOfferPreview(5900, cfg.fav.discountPct) };

  const set = (patch: (c: AutoConfig) => AutoConfig) => {
    setCfg(patch(cfg));
    setDirty(true);
  };
  const num = (v: string, lo: number, hi: number, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback;
  };

  const save = async (): Promise<AutoConfig> => {
    const next = { ...cfg, minMarginCents: margin.cents ?? cfg.minMarginCents };
    await repo.setSetting('automations', next);
    await browser.runtime.sendMessage({ type: 'era:auto:schedule' } satisfies EraMessage).catch(() => undefined);
    setCfg(next);
    setDirty(false);
    return next;
  };

  const run = async (kind: 'FAV' | 'OFFERS', dryRun: boolean) => {
    setBusy(`${kind}:${dryRun}`);
    try {
      await save();
      const r = (await browser.runtime.sendMessage({ type: 'era:auto:run', kind, dryRun } satisfies EraMessage)) as AutoRunResult;
      const line = t(dryRun ? 'auto.resultDry' : 'auto.result', { done: r.done, skipped: r.skipped, failed: r.failed });
      if (r.stopped) toast('error', t('auto.stopped'), `${line} · ${r.stopped}`);
      else toast('success', t(kind === 'FAV' ? 'auto.fav.title' : 'auto.offers.title'), line);
    } catch (e) {
      toast('error', t('auto.stopped'), e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const runButtons = (kind: 'FAV' | 'OFFERS', enabled: boolean) => (
    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      <Button size="sm" variant="ghost" icon="eye" loading={busy === `${kind}:true`} disabled={!!busy} onClick={() => run(kind, true)}>
        {t('auto.simulate')}
      </Button>
      <Button size="sm" variant="primary" icon="check" loading={busy === `${kind}:false`} disabled={!!busy || !enabled} onClick={() => run(kind, false)}>
        {t('auto.runNow')}
      </Button>
    </div>
  );

  const check = (id: string, checked: boolean, onChange: (v: boolean) => void, label: string) => (
    <label htmlFor={id} className="row" style={{ gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
      <input id={id} type="checkbox" className="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 2 }} />
      <span style={{ fontWeight: 600 }}>{label}</span>
    </label>
  );

  return (
    <>
      <PageHead title={t('auto.title')} sub={t('auto.sub')} />
      <div className="grid-12">
        <Card className="span-12" title={t('auto.warnTitle')} icon="alert" tone="coral">
          <div className="stack">
            <p className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <Flag kind="EXPERIMENTAL" /> <Flag kind="UNVERIFIED" />
            </p>
            <p className="t-small">{t('auto.warnBody')}</p>
            <ul className="t-small t-muted stack" style={{ margin: 0, paddingLeft: 18 }}>
              <li>{t('auto.guard1')}</li>
              <li>{t('auto.guard2')}</li>
              <li>{t('auto.guard3')}</li>
              <li>{t('auto.guard4')}</li>
            </ul>
          </div>
        </Card>

        <Card className="span-6" title={t('auto.fav.title')} hint={t('auto.fav.hint')} icon="heart" tone="pink">
          <div className="stack-3">
            {check('a-fav', cfg.fav.enabled, (v) => set((c) => ({ ...c, fav: { ...c.fav, enabled: v } })), t('auto.fav.enable'))}
            <Segmented<FavMode>
              label={t('auto.fav.mode')}
              value={cfg.fav.mode}
              onChange={(v) => set((c) => ({ ...c, fav: { ...c.fav, mode: v } }))}
              options={(['MESSAGE_OFFER', 'MESSAGE', 'OFFER'] as FavMode[]).map((m) => ({ value: m, label: t(`auto.fav.mode${m}`) }))}
            />
            <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              <Field label={t('auto.fav.discount')} htmlFor="a-disc">
                <Input id="a-disc" type="number" min={1} max={50} value={cfg.fav.discountPct} onChange={(e) => set((c) => ({ ...c, fav: { ...c.fav, discountPct: num(e.target.value, 1, 50, 10) } }))} />
              </Field>
              <Field label={t('auto.fav.delay')} htmlFor="a-delay">
                <Input id="a-delay" type="number" min={5} max={720} value={cfg.fav.minDelayMin} onChange={(e) => set((c) => ({ ...c, fav: { ...c.fav, minDelayMin: num(e.target.value, 5, 720, 15) } }))} />
              </Field>
              <Field label={t('auto.fav.perDay')} htmlFor="a-day">
                <Input id="a-day" type="number" min={1} max={30} value={cfg.fav.perDay} onChange={(e) => set((c) => ({ ...c, fav: { ...c.fav, perDay: num(e.target.value, 1, 30, 15) } }))} />
              </Field>
            </div>
            {cfg.fav.mode !== 'OFFER' && (
              <>
                <MessagePicker offer value={cfg.fav.templates} onChange={(v) => set((c) => ({ ...c, fav: { ...c.fav, templates: v } }))} example={example} />
                <MessagePicker offer={false} value={cfg.fav.templatesNoOffer} onChange={(v) => set((c) => ({ ...c, fav: { ...c.fav, templatesNoOffer: v } }))} example={example} />
                <p className="t-small t-faint">{t('auto.vars')}</p>
              </>
            )}
            {runButtons('FAV', cfg.fav.enabled)}
          </div>
        </Card>

        <Card className="span-6" title={t('auto.offers.title')} hint={t('auto.offers.hint')} icon="scale" tone="amber">
          <div className="stack-3">
            {check('a-off', cfg.offers.enabled, (v) => set((c) => ({ ...c, offers: { ...c.offers, enabled: v } })), t('auto.offers.enable'))}
            <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              <Field label={t('auto.offers.accept')} htmlFor="a-acc">
                <Input id="a-acc" type="number" min={50} max={100} value={cfg.offers.acceptPct} onChange={(e) => set((c) => ({ ...c, offers: { ...c.offers, acceptPct: num(e.target.value, 50, 100, 90) } }))} />
              </Field>
              <Field label={t('auto.offers.counter')} htmlFor="a-ctr">
                <Input id="a-ctr" type="number" min={50} max={100} value={cfg.offers.counterPct} onChange={(e) => set((c) => ({ ...c, offers: { ...c.offers, counterPct: num(e.target.value, 50, 100, 92) } }))} />
              </Field>
              <Field label={t('auto.offers.reject')} htmlFor="a-rej">
                <Input id="a-rej" type="number" min={0} max={95} value={cfg.offers.rejectBelowPct} onChange={(e) => set((c) => ({ ...c, offers: { ...c.offers, rejectBelowPct: num(e.target.value, 0, 95, 60) } }))} />
              </Field>
            </div>
            <p className="t-small t-muted">{t('auto.offers.rule', { a: cfg.offers.acceptPct, c: cfg.offers.counterPct, r: cfg.offers.rejectBelowPct })}</p>
            <Field label={t('auto.offers.acceptMessage')} htmlFor="a-accmsg" optional>
              <textarea id="a-accmsg" className="input" rows={2} style={{ height: 'auto', resize: 'vertical' }} value={cfg.offers.acceptMessage} onChange={(e) => set((c) => ({ ...c, offers: { ...c.offers, acceptMessage: e.target.value } }))} />
            </Field>
            {runButtons('OFFERS', cfg.offers.enabled)}
          </div>
        </Card>

        <Card className="span-12" title={t('auto.schedule.title')} icon="calendar" tone="cobalt">
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14, alignItems: 'end' }}>
            {check('a-on', cfg.enabled, (v) => set((c) => ({ ...c, enabled: v })), t('auto.schedule.enable'))}
            <Field label={t('auto.schedule.every')} htmlFor="a-every">
              <Select id="a-every" value={String(cfg.everyMinutes)} onChange={(e) => set((c) => ({ ...c, everyMinutes: Number(e.target.value) }))} options={[15, 30, 60, 120].map((m) => ({ value: String(m), label: t('auto.schedule.minutes', { n: m }) }))} />
            </Field>
            <Field label={t('auto.margin')} htmlFor="a-margin" error={margin.invalid ? t('add.invalidAmount') : null}>
              <Input id="a-margin" money value={margin.raw} onChange={(e) => (margin.setRaw(e.target.value), setDirty(true))} />
            </Field>
            <Button variant={dirty ? 'primary' : 'ghost'} icon="check" disabled={!dirty || margin.invalid} onClick={() => void save().then(() => toast('success', t('auto.saved'), cfg.enabled ? t('auto.savedOn', { n: cfg.everyMinutes }) : t('auto.savedOff')))}>
              {t('auto.save')}
            </Button>
          </div>
          <p className="t-small t-faint" style={{ marginTop: 10 }}>
            {t('auto.schedule.hint')} {t('auto.marginHint')}
          </p>
        </Card>

        <Card className="span-12" title={t('auto.log.title')} hint={t('auto.log.hint')} icon="book" tone="cyan">
          {!log?.length ? (
            <p className="t-small t-muted">{t('auto.log.empty')}</p>
          ) : (
            <div className="table-wrap">
              <table className="dt dt--compact" data-testid="auto-log">
                <thead>
                  <tr>
                    <th>{t('auto.log.when')}</th>
                    <th>{t('auto.log.what')}</th>
                    <th>{t('auto.log.target')}</th>
                    <th>{t('auto.log.detail')}</th>
                  </tr>
                </thead>
                <tbody>
                  {log.map((r) => (
                    <tr key={r.id}>
                      <td className="num t-small">{new Date(r.at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                      <td>
                        <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                          <Badge tone={!r.ok ? 'coral' : r.kind === 'SKIP' || r.kind === 'RUN' ? 'neutral' : 'emerald'} dot>
                            {t(`auto.kind.${r.kind}`)}
                          </Badge>
                          {r.dryRun && <Badge tone="cyan">{t('auto.log.dry')}</Badge>}
                        </span>
                      </td>
                      <td className="t-small">{r.target}</td>
                      <td className="t-small t-muted">{r.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
