/**
 * ERA mark, « l'étiquette coupée »: a clothes tag (its point and eyelet), the E cut out of it. The tag takes the action
 * colour (Bleu poudre on night blue, slate on Papier) and the E the colour written on it.
 * Same geometry as assets/era-mark.svg (used for the Chrome icons).
 */
export function LogoMark({ size = 28, title }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} className="logo-mark">
      <path d="M1.5 16 L9.5 5 H30.5 V27 H9.5 Z" style={{ fill: 'var(--accent, #B8D8F2)' }} />
      <g style={{ fill: 'var(--on-accent, #101923)' }}>
        <circle cx="8.6" cy="16" r="1.9" />
        <rect x="14.2" y="9.6" width="3.4" height="12.8" />
        <rect x="14.2" y="9.6" width="11.6" height="3.2" />
        <rect x="14.2" y="14.4" width="8.6" height="3.2" />
        <rect x="14.2" y="19.2" width="11.6" height="3.2" />
      </g>
    </svg>
  );
}
