/**
 * ERA illustration library — geometric, editorial, dark-tech. Pure SVG, theme-aware via CSS vars.
 * No robots, brains, rockets or sparkles.
 */
const S = { stroke: 'var(--border-strong)', fill: 'none', strokeWidth: 1.2 } as const;

function Frame({ children, vb = '0 0 320 224' }: { children: React.ReactNode; vb?: string }) {
  return (
    <svg viewBox={vb} width="100%" height="100%" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="il-brand" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8f6dff" />
          <stop offset="1" stopColor="#2a66ff" />
        </linearGradient>
        <linearGradient id="il-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8f6dff" stopOpacity=".35" />
          <stop offset="1" stopColor="#8f6dff" stopOpacity="0" />
        </linearGradient>
        <pattern id="il-dots" width="12" height="12" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="1" fill="var(--grid-dot)" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#il-dots)" opacity=".9" />
      {children}
    </svg>
  );
}

/** Stacked archive cards: the stock. */
export function IllustrationStock() {
  return (
    <Frame>
      <g transform="translate(92 40)">
        <rect x="24" y="0" width="120" height="150" rx="10" {...S} fill="var(--surface-sunken)" opacity=".5" />
        <rect x="12" y="12" width="120" height="150" rx="10" {...S} fill="var(--surface-sunken)" opacity=".75" />
        <rect x="0" y="24" width="120" height="150" rx="10" fill="var(--surface-solid)" stroke="var(--border-strong)" />
        <path d="M34 60 l26 -12 26 12 v16 h-10 v40 h-32 v-40 h-10z" fill="none" stroke="url(#il-brand)" strokeWidth="2" strokeLinejoin="round" />
        <rect x="16" y="140" width="56" height="6" rx="3" fill="var(--border-strong)" />
        <rect x="16" y="152" width="34" height="6" rx="3" fill="var(--border)" />
        <circle cx="100" cy="148" r="6" fill="url(#il-brand)" />
      </g>
    </Frame>
  );
}

/** Distribution curve with a question mark gap: no comparables. */
export function IllustrationNoComparables() {
  return (
    <Frame>
      <line x1="40" y1="176" x2="280" y2="176" stroke="var(--border-strong)" />
      <path d="M40 176 C 110 176, 120 70, 160 70 S 210 176, 280 176" fill="url(#il-fade)" stroke="url(#il-brand)" strokeWidth="2" strokeDasharray="4 6" />
      {[70, 100, 130, 190, 220, 250].map((x, i) => (
        <circle key={x} cx={x} cy={176 - (i % 2 ? 18 : 10)} r="3.5" fill="var(--text-3)" opacity=".5" />
      ))}
      <circle cx="160" cy="118" r="22" fill="var(--surface-solid)" stroke="var(--border-strong)" />
      <path d="M153 112a7 7 0 1 1 10 6c-2 1-3 2-3 5M160 128h.01" stroke="var(--text-2)" strokeWidth="2.2" strokeLinecap="round" fill="none" />
    </Frame>
  );
}

/** Price ladder + target: first analysis. */
export function IllustrationAnalysis() {
  return (
    <Frame>
      <g transform="translate(60 44)">
        {[0, 1, 2, 3, 4].map((i) => (
          <rect key={i} x={i * 42} y={120 - [40, 78, 112, 88, 52][i]!} width="26" height={[40, 78, 112, 88, 52][i]} rx="5" fill={i === 2 ? 'url(#il-brand)' : 'var(--surface-solid)'} stroke="var(--border-strong)" />
        ))}
        <line x1="-10" y1="30" x2="210" y2="30" stroke="#8f6dff" strokeDasharray="3 5" />
        <circle cx="97" cy="8" r="7" fill="var(--bg)" stroke="url(#il-brand)" strokeWidth="2.5" />
        <line x1="0" y1="126" x2="200" y2="126" stroke="var(--border-strong)" />
      </g>
    </Frame>
  );
}

/** Tag + scale: buy analyzer. */
export function IllustrationBuy() {
  return (
    <Frame>
      <g transform="translate(78 36)">
        <path d="M20 20 h72 l52 52 a8 8 0 0 1 0 11 l-50 50 a8 8 0 0 1 -11 0 l-52 -52 v-72 a0 0 0 0 1 0 0z" transform="translate(0 0)" fill="var(--surface-solid)" stroke="var(--border-strong)" />
        <circle cx="46" cy="46" r="8" fill="none" stroke="url(#il-brand)" strokeWidth="2.5" />
        <rect x="62" y="82" width="46" height="7" rx="3.5" fill="url(#il-brand)" />
        <rect x="62" y="96" width="30" height="7" rx="3.5" fill="var(--border-strong)" />
        <text x="120" y="160" fill="var(--text-2)" fontSize="15" fontFamily="var(--font-serif)" fontStyle="italic">
          82 / 100
        </text>
      </g>
    </Frame>
  );
}

/** Rising steps with a check: activation complete. */
export function IllustrationDone() {
  return (
    <Frame>
      <g transform="translate(70 40)">
        {[0, 1, 2, 3, 4].map((i) => (
          <rect key={i} x={i * 36} y={130 - i * 24} width="30" height={14 + i * 24} rx="5" fill={i === 4 ? 'url(#il-brand)' : 'var(--surface-solid)'} stroke="var(--border-strong)" />
        ))}
        <circle cx="160" cy="18" r="18" fill="var(--emerald)" opacity=".15" />
        <path d="M151 18l6 6 12-12" stroke="var(--emerald)" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </Frame>
  );
}

/** Empty ledger: no sales. */
export function IllustrationNoSales() {
  return (
    <Frame>
      <g transform="translate(70 36)">
        <rect x="0" y="0" width="180" height="150" rx="12" fill="var(--surface-solid)" stroke="var(--border-strong)" />
        {[30, 58, 86, 114].map((y) => (
          <g key={y}>
            <rect x="20" y={y} width="70" height="7" rx="3.5" fill="var(--border)" />
            <rect x="130" y={y} width="30" height="7" rx="3.5" fill="var(--border)" />
          </g>
        ))}
        <path d="M20 132 L60 118 L100 124 L160 96" stroke="url(#il-brand)" strokeWidth="2" fill="none" strokeDasharray="4 5" />
      </g>
    </Frame>
  );
}

/** Onboarding hero: layered archive + trajectory + decision point. */
export function IllustrationWelcome() {
  return (
    <svg viewBox="0 0 400 400" width="100%" aria-hidden="true">
      <defs>
        <linearGradient id="w-brand" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#9a7bff" />
          <stop offset="1" stopColor="#2a66ff" />
        </linearGradient>
        <radialGradient id="w-glow" cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#7c5cff" stopOpacity=".45" />
          <stop offset="1" stopColor="#7c5cff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="200" cy="200" r="170" fill="url(#w-glow)" />
      <circle cx="200" cy="200" r="150" fill="none" stroke="var(--border)" />
      <circle cx="200" cy="200" r="104" fill="none" stroke="var(--border)" strokeDasharray="2 6" />
      {[0, 1, 2].map((i) => (
        <rect key={i} x={112 + i * 14} y={128 + i * 14} width="150" height="104" rx="14" fill="var(--surface-solid)" stroke="var(--border-strong)" opacity={0.45 + i * 0.27} />
      ))}
      <g transform="translate(140 170)">
        <path d="M0 50 L30 38 L56 44 L86 18 L118 26" fill="none" stroke="url(#w-brand)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="chart-draw" style={{ ['--len' as string]: 160 }} />
        <circle cx="118" cy="26" r="7" fill="var(--bg)" stroke="url(#w-brand)" strokeWidth="3" />
        <rect x="0" y="64" width="48" height="6" rx="3" fill="var(--border-strong)" />
        <rect x="0" y="76" width="30" height="6" rx="3" fill="var(--border)" />
      </g>
      <g fontFamily="var(--font-sans)" fontSize="11" fill="var(--text-2)">
        <rect x="262" y="96" width="92" height="30" rx="8" fill="var(--surface-solid)" stroke="var(--border-strong)" />
        <circle cx="277" cy="111" r="4" fill="var(--emerald)" />
        <text x="288" y="115">+36 € profit</text>
        <rect x="46" y="272" width="104" height="30" rx="8" fill="var(--surface-solid)" stroke="var(--border-strong)" />
        <circle cx="61" cy="287" r="4" fill="var(--amber)" />
        <text x="72" y="291">83 j · capital</text>
      </g>
    </svg>
  );
}
