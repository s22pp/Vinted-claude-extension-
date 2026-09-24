import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  forwardRef,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { Confidence } from '@/domain/entities';
import type { MoneyMetric } from '@/domain/money';
import type { DataQuality } from '@/domain/provenance';
import { useI18n } from '@/i18n';
import { Icon, type IconName, IconTile, type TileTone } from './icons';

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  block?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button(
  { variant = 'default', size = 'md', icon, iconRight, loading, block, className = '', children, disabled, ...rest },
  ref,
) {
  const cls = ['btn', variant !== 'default' && `btn--${variant}`, size !== 'md' && `btn--${size}`, block && 'btn--block', className]
    .filter(Boolean)
    .join(' ');
  return (
    <button ref={ref} className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <span className="btn__spinner" aria-hidden="true" /> : icon ? <Icon name={icon} size={size === 'sm' ? 14 : 16} /> : null}
      {children}
      {iconRight && <Icon name={iconRight} size={14} />}
    </button>
  );
});

export function IconButton({ icon, label, ...rest }: { icon: IconName; label: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <Tooltip content={label}>
      <button type="button" className="icon-btn" aria-label={label} {...rest}>
        <Icon name={icon} size={17} />
      </button>
    </Tooltip>
  );
}

export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <span className="tip">
      {children}
      <span className="tip__bubble" role="tooltip">
        {content}
      </span>
    </span>
  );
}

export function Field({ label, optional, error, children, htmlFor }: { label: string; optional?: boolean; error?: string | null; children: ReactNode; htmlFor?: string }) {
  const { t } = useI18n();
  return (
    <div className="field">
      <label className="field__label" htmlFor={htmlFor}>
        {label}
        {optional && <span className="field__opt">· {t('buy.optional')}</span>}
      </label>
      {children}
      {error && (
        <span className="field__error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { money?: boolean }>(function Input(
  { money, className = '', ...rest },
  ref,
) {
  return <input ref={ref} className={`input ${money ? 'input--money' : ''} ${className}`} inputMode={money ? 'decimal' : rest.inputMode} {...rest} />;
});

export function Select({ options, className = '', ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[] }) {
  return (
    <select className={`select ${className}`} {...rest}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function SearchInput({ value, onChange, placeholder, inputRef }: { value: string; onChange: (v: string) => void; placeholder: string; inputRef?: React.Ref<HTMLInputElement> }) {
  return (
    <div className="search">
      <span className="search__icon">
        <Icon name="search" size={15} />
      </span>
      <input ref={inputRef} className="input" type="search" value={value} placeholder={placeholder} aria-label={placeholder} onChange={(e) => onChange(e.target.value)} />
      <span className="search__kbd">
        <kbd className="kbd">/</kbd>
      </span>
    </div>
  );
}

/** Segmented control with a sliding thumb. */
export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
    if (el) setThumb({ x: el.offsetLeft, w: el.offsetWidth });
  }, [value, options.length]);
  return (
    <div className="seg" role="group" aria-label={label} ref={ref}>
      {thumb && <span className="seg__thumb" style={{ transform: `translateX(${thumb.x - 3}px)`, width: thumb.w, left: 3 }} />}
      {options.map((o) => (
        <button key={o.value} type="button" className="seg__btn" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs, label }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode }[]; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button key={tab.value} role="tab" type="button" className="tabs__btn" aria-selected={tab.value === value} onClick={() => onChange(tab.value)}>
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export type BadgeTone = 'violet' | 'cobalt' | 'emerald' | 'amber' | 'coral' | 'cyan' | 'neutral';
export function Badge({ tone = 'neutral', dot, children, title }: { tone?: BadgeTone; dot?: boolean; children: ReactNode; title?: string }) {
  return (
    <span className={`badge b-${tone}`} title={title}>
      {dot && <span className="badge-dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

export function DemoBadge() {
  const { t } = useI18n();
  return (
    <span className="badge badge--demo" title={t('app.demoBanner')}>
      {t('app.demoBadge')}
    </span>
  );
}

export function Card({ title, hint, icon, tone, actions, children, className = '', flush, as: As = 'section', ...rest }: {
  title?: ReactNode;
  hint?: ReactNode;
  icon?: IconName;
  tone?: TileTone;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  flush?: boolean;
  as?: 'section' | 'div' | 'article';
} & React.HTMLAttributes<HTMLElement>) {
  const id = useId();
  return (
    <As className={`card ${flush ? 'card--flush' : ''} ${className}`} aria-labelledby={title ? id : undefined} {...rest}>
      {(title || actions) && (
        <header className="card__head" style={flush ? { padding: 'var(--s-5) var(--s-5) 0' } : undefined}>
          {icon && <IconTile name={icon} tone={tone ?? 'violet'} />}
          <div className="grow">
            {title && (
              <h2 className="card__title" id={id}>
                {title}
              </h2>
            )}
            {hint && <p className="card__hint">{hint}</p>}
          </div>
          {actions && <div className="card__actions">{actions}</div>}
        </header>
      )}
      {children}
    </As>
  );
}

/** Money that may be unknown. Unknown is rendered as a labelled dash, never as 0 €. */
export function Money({ cents, sign, className = '', unknownLabel, compact }: { cents: number | null | undefined; sign?: boolean; className?: string; unknownLabel?: string; compact?: boolean }) {
  const { money, t } = useI18n();
  if (cents === null || cents === undefined) {
    if (compact)
      return (
        <span className={`unknown ${className}`} title={unknownLabel ?? t('data.unknown')}>
          <span aria-hidden="true">—</span>
          <span className="sr-only">{unknownLabel ?? t('data.unknown')}</span>
        </span>
      );
    return (
      <span className={`unknown ${className}`}>
        <span aria-hidden="true">—</span>
        <span className="unknown__label">{unknownLabel ?? t('data.unknown')}</span>
      </span>
    );
  }
  const tone = sign ? (cents > 0 ? 't-pos' : cents < 0 ? 't-neg' : '') : '';
  return <span className={`num ${tone} ${className}`}>{money(cents, { sign })}</span>;
}

export function MetricValue({ metric, sign }: { metric: MoneyMetric; sign?: boolean }) {
  const { money, t } = useI18n();
  if (metric.status === 'unknown') {
    return (
      <span className="unknown">
        <span aria-hidden="true">—</span>
        <span className="unknown__label">{t('data.unknown')}</span>
      </span>
    );
  }
  return <span>{money(metric.value, { sign })}</span>;
}

export function MetricFootPartial({ metric }: { metric: MoneyMetric }) {
  const { t } = useI18n();
  if (metric.status !== 'partial') return null;
  return <QualityTag quality="PARTIAL" text={t('data.partial', { n: metric.missing })} />;
}

export function Metric({ label, icon, tone, value, foot, small, help }: { label: ReactNode; icon?: IconName; tone?: TileTone; value: ReactNode; foot?: ReactNode; small?: boolean; help?: string }) {
  return (
    <div className="metric">
      <div className="metric__label">
        {icon && <IconTile name={icon} tone={tone ?? 'violet'} size="sm" />}
        {label}
        {help && (
          <Tooltip content={help}>
            <span tabIndex={0} aria-label={help} style={{ display: 'inline-flex', color: 'var(--text-3)' }}>
              <Icon name="info" size={13} />
            </span>
          </Tooltip>
        )}
      </div>
      <div className={`metric__value ${small ? 'metric__value--sm' : ''}`}>{value}</div>
      <div className="metric__foot">{foot}</div>
    </div>
  );
}

export function Delta({ value, suffix, invert }: { value: number | null; suffix?: string; invert?: boolean }) {
  const { pct } = useI18n();
  if (value === null || !Number.isFinite(value)) return null;
  const good = invert ? value < 0 : value > 0;
  const cls = value === 0 ? '' : good ? 'delta--up' : 'delta--down';
  return (
    <span className={`delta ${cls}`}>
      {value !== 0 && <Icon name={value > 0 ? 'arrowUp' : 'arrowDown'} size={12} strokeWidth={2.2} />}
      <span className="num">{pct(Math.abs(value))}</span>
      {suffix && <span className="t-faint" style={{ fontWeight: 400 }}>{suffix}</span>}
    </span>
  );
}

const Q_GLYPH: Record<DataQuality, string> = { KNOWN: '●', PARTIAL: '◐', INFERRED: '◌', PREDICTED: '◇', UNKNOWN: '○' };
/** Data quality is shown as glyph + text, never colour alone. */
export function QualityTag({ quality, text }: { quality: DataQuality; text?: string }) {
  const { t } = useI18n();
  return (
    <span className="dq" data-quality={quality}>
      <span className="dq__glyph" aria-hidden="true">
        {Q_GLYPH[quality]}
      </span>
      {text ?? t(`quality.${quality}`)}
    </span>
  );
}

export function ConfidenceMeter({ level, tone }: { level: Confidence; tone?: string }) {
  const { t } = useI18n();
  const on = level === 'HIGH' ? 3 : level === 'MEDIUM' ? 2 : 1;
  return (
    <span className="conf" style={tone ? ({ '--tone': tone } as React.CSSProperties) : undefined}>
      <span className="conf__bars" aria-hidden="true">
        {[1, 2, 3].map((i) => (
          <span key={i} className={`conf__bar ${i <= on ? 'on' : ''}`} />
        ))}
      </span>
      <span>{t(`confidence.${level}`)}</span>
    </span>
  );
}

export function Skeleton({ w = '100%', h = 14, r }: { w?: number | string; h?: number | string; r?: number }) {
  return <span className="skeleton" style={{ display: 'block', width: w, height: h, borderRadius: r }} aria-hidden="true" />;
}

export function EmptyState({ art, title, why, action, compact }: { art?: ReactNode; title: string; why: string; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={`empty ${compact ? 'empty--compact' : ''}`}>
      {art && <div className="empty__art">{art}</div>}
      <h3 className="empty__title">{title}</h3>
      <p className="empty__why">{why}</p>
      {action}
    </div>
  );
}

export function ErrorState({ code, onRetry }: { code: string; onRetry?: () => void }) {
  const { t } = useI18n();
  const known = ['NETWORK_403', 'RATE_LIMITED', 'BUDGET_EXHAUSTED', 'UNAVAILABLE', 'NOT_IMPLEMENTED'].includes(code);
  return (
    <div className="error-box" role="alert">
      <IconTile name="alert" tone="coral" />
      <div className="grow">
        <div className="t-h3">{known ? t(`errors.${code}`) : t('errors.generic')}</div>
        <p className="t-small t-muted">{t('errors.keepLocal')}</p>
        <details>
          <summary>{t('common.details')}</summary>
          <code>{code}</code>
        </details>
      </div>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      )}
    </div>
  );
}

export function Stages<S extends string>({ stages, current, labelKey }: { stages: S[]; current: S | null; labelKey: (s: S) => string }) {
  const idx = current ? stages.indexOf(current) : -1;
  return (
    <div className="stages" role="status" aria-live="polite">
      {stages.map((s, i) => (
        <span key={s} className="row" style={{ gap: 8 }}>
          {i > 0 && <span className="stage__line" aria-hidden="true" />}
          <span className={`stage ${i < idx || (i === idx && i === stages.length - 1) ? 'is-done' : i === idx ? 'is-active' : ''}`}>
            <span className="stage__dot" aria-hidden="true" />
            {labelKey(s)}
          </span>
        </span>
      ))}
    </div>
  );
}

export function Sample({ n }: { n: number }) {
  const { t } = useI18n();
  return <span className="t-faint t-small num">{t('data.sample', { n })}</span>;
}
