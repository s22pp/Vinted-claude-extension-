import { useId } from 'react';

/**
 * ERA mark: an "E" whose middle arm stops short of a detached point — the decision.
 * Same geometry as assets/era-mark.svg (used for the Chrome icons).
 */
export function LogoMark({ size = 28, title }: { size?: number; title?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#8f6dff" />
          <stop offset="0.5" stopColor="#5a5cff" />
          <stop offset="1" stopColor="#2a66ff" />
        </linearGradient>
        <linearGradient id={`${id}s`} x1="0" y1="0" x2="0" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity=".22" />
          <stop offset=".5" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8.5" fill={`url(#${id}g)`} />
      <rect x=".5" y=".5" width="31" height="31" rx="8" fill={`url(#${id}s)`} stroke="#fff" strokeOpacity=".18" />
      <g fill="#fff">
        <rect x="8" y="7.6" width="3.6" height="16.8" rx="1.8" />
        <rect x="8" y="7.6" width="16" height="3.6" rx="1.8" />
        <rect x="8" y="14.2" width="8.4" height="3.6" rx="1.8" />
        <rect x="8" y="20.8" width="16" height="3.6" rx="1.8" />
        <circle className="logo-dot" cx="21.6" cy="16" r="2.3" />
      </g>
    </svg>
  );
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="row" style={{ gap: 10 }}>
      <LogoMark size={compact ? 24 : 30} />
      {!compact && (
        <span className="sidebar__brand-text" style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
          <span className="sidebar__brand-name">ERA</span>
          <span className="sidebar__brand-sub">Intelligence</span>
        </span>
      )}
    </span>
  );
}
