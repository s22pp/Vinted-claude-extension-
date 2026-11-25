import { useLayoutEffect, useRef } from 'react';
import { useI18n } from '@/i18n';
import { boxInitials, parcelBoard } from '@/intelligence/parcel-board';
import type { Parcel } from '@/intelligence/parcels';

const reducedMotion = () => document.documentElement.dataset.motion === 'reduced' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * No cut (skill « era-visuel »): a box that changed station slides from where it was to where it is (FLIP), instead of
 * jumping. Reduced motion: it just is where it is.
 */
function useSlide(container: React.RefObject<HTMLDivElement | null>, keys: string) {
  const last = useRef(new Map<string, DOMRect>());
  useLayoutEffect(() => {
    const el = container.current;
    if (!el) return;
    const boxes = [...el.querySelectorAll<HTMLElement>('[data-box]')];
    const next = new Map(boxes.map((b) => [b.dataset.box!, b.getBoundingClientRect()]));
    if (!reducedMotion())
      for (const b of boxes) {
        const before = last.current.get(b.dataset.box!);
        const now = next.get(b.dataset.box!)!;
        if (!before || (before.left === now.left && before.top === now.top)) continue;
        b.animate([{ transform: `translate(${before.left - now.left}px, ${before.top - now.top}px)` }, { transform: 'translate(0, 0)' }], { duration: 600, easing: 'cubic-bezier(0.65, 0, 0.35, 1)' });
      }
    last.current = next;
  }, [container, keys]);
}

/**
 * « Le tapis des colis »: two lanes (my sales, my purchases), five stations, every parcel a box at its station — the
 * late ones in coral. A click on a box goes to its line below. From the statuses Vinted gave at the last import.
 */
export function ParcelBoard({ parcels }: { parcels: readonly Parcel[] }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const lanes = parcelBoard(parcels).filter((l) => l.count > 0);
  useSlide(ref, parcels.map((p) => `${p.key}:${p.stage}`).join('|'));
  if (!lanes.length) return null;
  const goTo = (p: Parcel) => {
    const row = document.getElementById(`parcel-${p.key}`);
    row?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' });
    row?.animate?.([{ outline: '2px solid var(--cobalt)' }, { outline: '2px solid transparent' }], { duration: 1600 });
  };
  return (
    <div ref={ref} className="stack-3" data-testid="parcel-board">
      {lanes.map((lane) => (
        <section key={lane.direction} aria-label={t(`parcelboard.lane.${lane.direction}`, { n: lane.count })}>
          <div className="row" style={{ gap: 8, alignItems: 'baseline', marginBottom: 6 }}>
            <strong className="t-small">{t(`parcelboard.lane.${lane.direction}`, { n: lane.count })}</strong>
            {lane.late > 0 && <span className="t-small" style={{ color: 'var(--coral)' }}>{t('parcelboard.late', { n: lane.late })}</span>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 6, position: 'relative' }}>
            {/* The conveyor: one belt under the five stations. */}
            <div aria-hidden="true" className="pbelt__line" />
            {lane.stations.map((st) => (
              <div key={st.stage} className="stack" style={{ gap: 6, alignItems: 'center', minWidth: 0 }} data-station={st.stage}>
                <span className="t-small t-muted" style={{ textAlign: 'center', minHeight: 22 }}>
                  {t(`parcelmap.step.${st.stage}`)} · {st.parcels.length}
                </span>
                <div className="row wrap pbelt__boxes" style={{ gap: 6, justifyContent: 'center', position: 'relative' }}>
                  {st.parcels.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      data-box={p.key}
                      onClick={() => goTo(p)}
                      title={`${p.title} — ${p.status ?? t(`parcelmap.step.${p.stage}`)}${p.days !== null ? ` · ${t('parcelmap.since', { n: p.days })}` : ''}`}
                      aria-label={`${p.title}, ${t(`parcelmap.step.${p.stage}`)}${p.late ? `, ${t('parcelboard.lateOne')}` : ''}`}
                      className="pbelt__box"
                      data-late={p.late || undefined}
                    >
                      {/* « SN · 3j » inside the box: nothing sticks out over the belt. */}
                      <span className="pbelt__code num">
                        {boxInitials(p.title)}
                        {p.days !== null && <span className="pbelt__age"> · {p.days}j</span>}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
