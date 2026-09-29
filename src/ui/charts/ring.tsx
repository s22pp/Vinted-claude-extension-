import type { ReactNode } from 'react';

// Its own module: the popup shows a ring and nothing else from the charts, so it does not load them.
// No animated arc (it would move the stroke, not a transform): the ring shows its value as it is.
export function Ring({ value, max, size = 64, stroke = 6, children, color = 'url(#ring-grad)' }: { value: number; max: number; size?: number; stroke?: number; children?: ReactNode; color?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, value / (max || 1)));
  return (
    <span style={{ position: 'relative', display: 'inline-grid', placeItems: 'center', width: size, height: size }}>
      <svg width={size} height={size} aria-hidden="true" style={{ transform: 'rotate(-90deg)' }}>
        <defs>
          <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#8f6dff" />
            <stop offset="1" stopColor="#2a66ff" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-sunken)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - f)}
        />
      </svg>
      <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>{children}</span>
    </span>
  );
}
