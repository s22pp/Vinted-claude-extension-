import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/data/db';
import { repo } from '@/data/repo';
import { type AutoConfig, withDefaults } from '@/intelligence/automation';
import { type LearnStatus, learningStatus, variantStats } from '@/intelligence/message-learning';
import { useI18n } from '@/i18n';
import { type Rate, delayTable, messageTable, offerTable, repostTable } from '@/intelligence/outcomes';
import { bestLines } from '@/intelligence/outcomes-summary';
import { Card } from '@/ui/components/primitives';
import { VerifyFlag } from './verify-flag';

/**
 * What makes buyers answer and buy, from the contacts database: messages wording by wording, offers by depth, the delay
 * from a favourite to the message, and reposts by how long the previous listing was online. No rate below 5 contacts.
 */
export function OutcomesCard() {
  const { t } = useI18n();
  const data = useLiveQuery(async () => ({ contacts: await db.contacts.toArray(), listings: await db.listings.filter((l) => !l.isDemo).toArray(), auto: withDefaults(await repo.getSetting<Partial<AutoConfig> | null>('automations', null)) }), []);
  if (!data) return null;
  const now = Date.now();
  const messages = messageTable(data.contacts, now);
  const offers = offerTable(data.contacts, now);
  const delays = delayTable(data.contacts, now);
  const reposts = repostTable(data.listings, now);
  const cell = (k: number, n: number, pct: number | null) => (n === 0 ? '—' : pct !== null ? `${pct} % (${k}/${n})` : `${k}/${n}`);
  const wait = (r: Rate) => (r.n - r.replyN > 0 ? ` · ${t('outcomes.waiting', { n: r.n - r.replyN })}` : '');
  const short = (s: string) => (s.length > 90 ? `${s.slice(0, 88)}…` : s);
  const best = bestLines(data.contacts, data.listings, now, t);
  // Where ERA's learning of the favourite messages stands (with an offer, without one): what it now sends, or why not yet.
  const favStats = variantStats(data.contacts, 'FAV_MESSAGE', now);
  const learn = (
    [
      ['withOffer', learningStatus(data.auto.fav.templates, favStats)],
      ['noOffer', learningStatus(data.auto.fav.templatesNoOffer, favStats)],
    ] as const
  ).filter((x): x is readonly ['withOffer' | 'noOffer', LearnStatus] => x[1] !== null);
  const learnText = (which: 'withOffer' | 'noOffer', l: LearnStatus) =>
    `${t(`outcomes.learn.${which}`)} ${l.state === 'BEST' ? t('outcomes.learn.best', { text: short(l.tpl), pct: l.pct, sample: l.sample, next: l.nextPct }) : l.state === 'TIE' ? t('outcomes.learn.tie') : t('outcomes.learn.measuring', { least: l.least, need: l.need })}`;
  const table = (head: string[], rows: (string | number)[][], testid: string) => (
    <div style={{ overflowX: 'auto' }}>
      <table className="dt dt--compact" data-testid={testid}>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((x, j) => (
                <td key={j}>{x}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <Card className="span-12" title={t('outcomes.title')} hint={t('outcomes.hint')} icon="trendUp" tone="emerald" actions={<VerifyFlag proof="auto" />}>
      <div className="stack-3" data-testid="outcomes">
        {best.length > 0 ? (
          <ul className="t-small stack" style={{ margin: 0, paddingLeft: 18, gap: 4 }} data-testid="outcomes-best">
            {best.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        ) : (
          <p className="t-small t-muted">{data.contacts.length ? t('outcomes.tooFew') : t('outcomes.empty')}</p>
        )}
        {learn.length > 0 && (
          <ul className="t-small stack" style={{ margin: 0, paddingLeft: 18, gap: 4 }} data-testid="outcomes-learning">
            {learn.map(([which, l]) => (
              <li key={which} data-state={l.state}>
                {learnText(which, l)}
              </li>
            ))}
          </ul>
        )}
        {messages.length > 0 && (
          <>
            <h4 className="t-small" style={{ margin: 0 }}>{t('outcomes.messages')}</h4>
            {table(
              [t('outcomes.col.kind'), t('outcomes.col.message'), t('outcomes.col.sent'), t('outcomes.col.replied'), t('outcomes.col.sold')],
              messages.map((m) => [t(`outcomes.kind.${m.kind}`), short(m.variant), m.n, cell(m.replied, m.replyN, m.replyPct) + wait(m), cell(m.sold, m.soldN, m.soldPct)]),
              'outcomes-messages',
            )}
          </>
        )}
        {offers.length > 0 && (
          <>
            <h4 className="t-small" style={{ margin: 0 }}>{t('outcomes.offers')}</h4>
            {table(
              [t('outcomes.col.kind'), t('outcomes.col.depth'), t('outcomes.col.sent'), t('outcomes.col.sold')],
              offers.map((o) => [t(`outcomes.kind.${o.kind}`), t(`outcomes.bracket.${o.bracket}`), o.n, cell(o.sold, o.soldN, o.soldPct)]),
              'outcomes-offers',
            )}
          </>
        )}
        {delays.length > 0 && (
          <>
            <h4 className="t-small" style={{ margin: 0 }}>{t('outcomes.delays')}</h4>
            {table(
              [t('outcomes.col.delay'), t('outcomes.col.sent'), t('outcomes.col.replied'), t('outcomes.col.sold')],
              delays.map((d) => [t(`outcomes.delay.${d.bucket}`), d.n, cell(d.replied, d.replyN, d.replyPct), cell(d.sold, d.soldN, d.soldPct)]),
              'outcomes-delays',
            )}
          </>
        )}
        {reposts.length > 0 && (
          <>
            <h4 className="t-small" style={{ margin: 0 }}>{t('outcomes.reposts')}</h4>
            {table(
              [t('outcomes.col.gap'), t('outcomes.col.reposts'), t('outcomes.col.sold14'), t('outcomes.col.median')],
              reposts.map((r) => [t(`outcomes.gap.${r.bucket}`), r.n, cell(r.sold, r.n, r.soldPct), r.medianDays === null ? '—' : t('outcomes.days', { n: r.medianDays })]),
              'outcomes-reposts',
            )}
          </>
        )}
        <p className="t-small t-faint">{t('outcomes.note')}</p>
      </div>
    </Card>
  );
}
