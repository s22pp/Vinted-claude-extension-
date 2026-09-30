import { useEffect, useMemo, useState } from 'react';
import { WRITE_MAX, WRITE_SPACING_MS } from '@/data/adapters/vinted/budget-store';
import type { EraMessage, TextEditResult } from '@/data/adapters/vinted/protocol';
import { useI18n } from '@/i18n';
import { type TextField, type TextOp, applyTextOp, textOpProblem } from '@/intelligence/text-edit';
import { shieldCheck } from '@/intelligence/listing';
import type { ItemView } from '@/intelligence/portfolio';
import { useErrorToast, useToast } from '@/ui/components/overlays';
import { Badge, Button, Field, Flag, Input, Select } from '@/ui/components/primitives';
import { useEra } from '../state';
import { RouteFlag } from './route-flag';

type OpKind = TextOp['kind'];
type Outcome = { itemId: string; state: 'DONE' | 'ALREADY' | 'FAILED' | 'SKIPPED'; detail?: string };

const liveId = (v: ItemView) => {
  const id = v.current?.platformListingId ?? null;
  return v.item.status === 'LISTED' && !v.item.isDemo && id && /^\d+$/.test(id) ? id : null;
};

/**
 * Titles or descriptions of several listings changed the same way (a word added at the start or the end, a word
 * replaced) — EXPERIMENTAL. Prepared for all at once, sent ONE listing per click: Vinted blocked the account after
 * chained automated saves, so nothing here chains them. Each change is applied to what Vinted's edit page holds
 * and read back on Vinted; within ERA's write limits (15 per session, 20 s apart).
 */
export function TextSeries() {
  const { t } = useI18n();
  const era = useEra();
  const errorToast = useErrorToast();
  const [field, setField] = useState<TextField>('title');
  const [kind, setKind] = useState<OpKind>('suffix');
  const [text, setText] = useState('');
  const [find, setFind] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [queue, setQueue] = useState<string[] | null>(null);
  const [done, setDone] = useState<Outcome[]>([]);
  const [busy, setBusy] = useState(false);
  const [readyAt, setReadyAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (readyAt <= now) return;
    const h = setTimeout(() => setNow(Date.now()), 1000);
    return () => clearTimeout(h);
  }, [readyAt, now]);

  const live = useMemo(() => era.views.filter((v) => liveId(v) !== null).sort((a, b) => a.item.title.localeCompare(b.item.title, 'fr')), [era.views]);
  const op: TextOp = kind === 'replace' ? { kind, find, text } : { kind, text };
  const problem = textOpProblem(field, op);
  /** What ERA's copy says it would become (a title is read from the wardrobe; a description may be unknown here). */
  const preview = (v: ItemView): { after: string | null; known: boolean } => {
    const cur = field === 'title' ? v.current?.title : v.current?.description;
    if (cur === undefined || cur === null || (field === 'description' && !cur.trim())) return { after: null, known: false };
    return { after: problem ? null : applyTextOp(cur, op, field), known: true };
  };

  /** A word that gets listings removed (counterfeit term, another brand, contact off Vinted): never sent. */
  const blocked = (v: ItemView): string | null => {
    const p = preview(v);
    const text = field === 'title' && p.after ? p.after : op.text;
    return shieldCheck(text, v.item.brand).find((i) => i.severity === 'block')?.match ?? null;
  };

  if (era.mode !== 'real') return <p className="t-small t-muted">{t('series.demo')}</p>;

  if (queue) {
    const itemId = queue[0] ?? null;
    const v = itemId ? era.viewById.get(itemId) : undefined;
    const wait = Math.max(0, Math.ceil((readyAt - now) / 1000));
    const send = async () => {
      if (!v || !itemId) return;
      const id = liveId(v);
      setBusy(true);
      let r: TextEditResult;
      try {
        r = id
          ? ((await browser.runtime.sendMessage({ type: 'era:text:edit', platformListingId: id, field, op } satisfies EraMessage)) as TextEditResult)
          : { ok: false, code: 'NOT_APPLIED', detail: t('series.notLive') };
      } catch (e) {
        r = { ok: false, code: 'UNAVAILABLE', detail: `service worker : ${e instanceof Error ? e.message : String(e)}` };
      }
      setBusy(false);
      const at = Date.now();
      setReadyAt(at + WRITE_SPACING_MS);
      setNow(at);
      if (r.ok) {
        setDone((d) => [...d, { itemId, state: r.changed ? 'DONE' : 'ALREADY', detail: r.after }]);
        setQueue(queue.slice(1));
      } else {
        // A stop on Vinted's side or one of ERA's limits: the series pauses on this listing (never skipped silently).
        if (r.code !== 'WRITE_COOLDOWN') setDone((d) => [...d, { itemId, state: 'FAILED', detail: `${r.code}${r.detail ? ` · ${r.detail}` : ''}` }]);
        errorToast(r);
        if (r.code === 'NETWORK_403' || r.code === 'RATE_LIMITED' || r.code === 'BUDGET_EXHAUSTED' || r.code === 'NOT_LOGGED_IN') setQueue([]);
        else if (r.code !== 'WRITE_COOLDOWN') setQueue(queue.slice(1));
      }
    };
    const p = v ? preview(v) : null;
    return (
      <div className="stack" style={{ gap: 12 }} data-testid="series-run">
        {v && itemId ? (
          <>
            <p className="t-small">
              <b>{t('series.position', { n: done.length + 1, total: done.length + queue.length })}</b> · {v.item.title}
            </p>
            <p className="t-small t-muted" data-testid="series-preview">
              {p?.known ? (p.after === null ? t('series.already') : t('series.becomes', { text: p.after })) : t('series.readOnVinted')}
            </p>
            <div className="row wrap" style={{ gap: 8 }}>
              <Button variant="primary" icon="upload" loading={busy} disabled={busy || wait > 0} onClick={() => void send()} data-testid="series-send">
                {wait > 0 ? t('series.wait', { s: wait }) : t('series.send')} <RouteFlag kinds={[field === 'title' ? 'TITLE' : 'DESCRIPTION']} />
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setDone((d) => [...d, { itemId, state: 'SKIPPED' }]);
                  setQueue(queue.slice(1));
                }}
              >
                {t('series.skip')}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setQueue([])}>
                {t('series.stop')}
              </Button>
            </div>
            <p className="t-small t-faint">{t('series.oneByOne', { max: WRITE_MAX, s: WRITE_SPACING_MS / 1000 })}</p>
          </>
        ) : (
          <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
            <p className="t-small">{t('series.finished')}</p>
            <Button
              variant="ghost"
              onClick={() => {
                setQueue(null);
                setDone([]);
              }}
            >
              {t('series.again')}
            </Button>
          </div>
        )}
        {done.length > 0 && (
          <ul className="stack t-small" style={{ gap: 4, margin: 0, paddingLeft: 18 }} data-testid="series-done">
            {done.map((o, i) => (
              <li key={`${o.itemId}-${i}`}>
                <Badge tone={o.state === 'DONE' ? 'emerald' : o.state === 'FAILED' ? 'coral' : 'neutral'}>{t(`series.state.${o.state}`)}</Badge> {era.viewById.get(o.itemId)?.item.title ?? o.itemId}
                {o.detail && <span className="t-faint"> · {o.detail}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const chosen = live.filter((v) => picked.has(v.item.id));
  // Titles ERA already sees with the change are left out; a description is read on Vinted, whatever ERA's copy says.
  const toSend = chosen.filter((v) => {
    const p = preview(v);
    return !(p.known && p.after === null && field === 'title') && blocked(v) === null;
  });
  const toggle = (id: string) => setPicked((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));
  return (
    <div className="stack" style={{ gap: 12 }} data-testid="series">
      <p className="t-small t-muted">
        {t('series.intro')} <Flag kind="EXPERIMENTAL" />
      </p>
      <div className="row wrap" style={{ gap: 8 }}>
        <Field label={t('series.field')} htmlFor="series-field">
          <Select id="series-field" value={field} onChange={(e) => setField(e.target.value as TextField)} options={(['title', 'description'] as const).map((f) => ({ value: f, label: t(`series.f.${f}`) }))} />
        </Field>
        <Field label={t('series.op')} htmlFor="series-op">
          <Select id="series-op" value={kind} onChange={(e) => setKind(e.target.value as OpKind)} options={(['suffix', 'prefix', 'replace'] as const).map((k) => ({ value: k, label: t(`series.k.${k}`) }))} />
        </Field>
      </div>
      {kind === 'replace' && (
        <Field label={t('series.find')} htmlFor="series-find">
          <Input id="series-find" value={find} onChange={(e) => setFind(e.target.value)} />
        </Field>
      )}
      <Field label={kind === 'replace' ? t('series.by') : t('series.text')} htmlFor="series-text">
        {field === 'description' && kind !== 'replace' ? (
          <textarea id="series-text" className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
        ) : (
          <Input id="series-text" value={text} onChange={(e) => setText(e.target.value)} />
        )}
      </Field>
      {problem && (text || find) && <p className="t-small t-warn">{problem}</p>}
      <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
        <span className="t-small">{t('series.picked', { n: chosen.length, of: live.length })}</span>
        <Button size="sm" variant="ghost" onClick={() => setPicked(new Set(live.map((v) => v.item.id)))}>
          {t('series.all')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>
          {t('series.none')}
        </Button>
      </div>
      {live.length === 0 ? (
        <p className="t-small t-muted">{t('series.noLive')}</p>
      ) : (
        <ul className="stack" style={{ gap: 6, margin: 0, padding: 0, listStyle: 'none', maxHeight: 280, overflowY: 'auto' }}>
          {live.map((v) => {
            const p = preview(v);
            return (
              <li key={v.item.id} className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
                <input id={`series-${v.item.id}`} type="checkbox" className="checkbox" checked={picked.has(v.item.id)} onChange={() => toggle(v.item.id)} style={{ marginTop: 3 }} />
                <label htmlFor={`series-${v.item.id}`} className="t-small" style={{ minWidth: 0 }}>
                  {v.item.title}
                  {!problem && picked.has(v.item.id) && (
                    <span className="t-faint" style={{ display: 'block' }}>
                      {p.known ? (p.after === null ? t('series.already') : t('series.becomes', { text: p.after.length > 140 ? `${p.after.slice(0, 140)}…` : p.after })) : t('series.readOnVinted')}
                    </span>
                  )}
                  {!problem && picked.has(v.item.id) && blocked(v) && (
                    <span className="t-warn" style={{ display: 'block' }}>
                      {t('series.blocked', { word: blocked(v)! })}
                    </span>
                  )}
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {toSend.length > WRITE_MAX && <p className="t-small t-warn">{t('series.overCap', { n: toSend.length, max: WRITE_MAX })}</p>}
      <div>
        <Button
          variant="primary"
          icon="check"
          disabled={!!problem || toSend.length === 0}
          onClick={() => {
            setDone([]);
            setQueue(toSend.slice(0, WRITE_MAX).map((v) => v.item.id));
          }}
          data-testid="series-start"
        >
          {t('series.start', { n: Math.min(toSend.length, WRITE_MAX) })}
        </Button>
      </div>
      <p className="t-small t-faint">{t('series.oneByOne', { max: WRITE_MAX, s: WRITE_SPACING_MS / 1000 })}</p>
    </div>
  );
}

/**
 * The title ERA proposes, put on the live listing in place of the current one — EXPERIMENTAL, one click, confirmed,
 * read back on Vinted. Never with a word the shield blocks.
 */
export function TitleOnVinted({ v, title }: { v: ItemView; title: string }) {
  const { t } = useI18n();
  const era = useEra();
  const toast = useToast();
  const errorToast = useErrorToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const id = liveId(v);
  if (era.mode !== 'real' || !id) return null;
  const same = (v.current?.title ?? '').replace(/\s+/g, ' ').trim() === title.replace(/\s+/g, ' ').trim();
  const block = shieldCheck(title, v.item.brand).find((i) => i.severity === 'block');
  const send = async () => {
    setBusy(true);
    let r: TextEditResult;
    try {
      r = (await browser.runtime.sendMessage({ type: 'era:text:edit', platformListingId: id, field: 'title', op: { kind: 'set', text: title } } satisfies EraMessage)) as TextEditResult;
    } catch (e) {
      r = { ok: false, code: 'UNAVAILABLE', detail: `service worker : ${e instanceof Error ? e.message : String(e)}` };
    }
    setBusy(false);
    setConfirming(false);
    if (r.ok) toast('success', r.changed ? t('series.titleDone') : t('series.already'), r.after);
    else errorToast(r);
  };
  if (same) return null;
  return (
    <div className="stack" style={{ gap: 6 }} data-testid="title-on-vinted">
      {block && <p className="t-small t-warn">{t('series.blocked', { word: block.match })}</p>}
      {confirming && <p className="t-small">{t('series.titleConfirm', { from: v.current?.title ?? '', to: title })}</p>}
      <div>
        {confirming ? (
          <Button size="sm" variant="primary" icon="check" loading={busy} disabled={!!block} onClick={() => void send()}>
            {t('series.titleSend')}
          </Button>
        ) : (
          <Button size="sm" variant="ghost" icon="upload" disabled={!!block} onClick={() => setConfirming(true)}>
            {t('series.titleReplace')} <RouteFlag kinds={['TITLE']} />
          </Button>
        )}
      </div>
    </div>
  );
}
