import type { SVGProps } from 'react';

/** One icon family: 24px grid, 1.75 stroke, round caps. No brains, robots, rockets or sparkles. */
const PATHS = {
  today: 'M4 5.5h16M4 12h10M4 18.5h6M18 15.5v6M15 18.5h6',
  stock: 'M3.5 8 12 3.8 20.5 8 12 12.2 3.5 8ZM3.5 12.2 12 16.4l8.5-4.2M3.5 16.2 12 20.4l8.5-4.2',
  market: 'M4 20V10M9.3 20V4M14.6 20v-7M20 20v-11M2.5 20h19',
  buy: 'M3.5 12.3V4.5a1 1 0 0 1 1-1h7.8l8.3 8.3a1.4 1.4 0 0 1 0 2l-6.2 6.2a1.4 1.4 0 0 1-2 0L3.5 12.3ZM8 8h.01',
  sales: 'M3.5 16.5 9 11l3.5 3.5 8-8M15 6.5h5.5V12',
  insights: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12 13h.01M12 12l6.5-6.5',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  search: 'M11 18.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15ZM20.5 20.5 16.3 16.3',
  plus: 'M12 5v14M5 12h14',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6 6 18',
  chevronRight: 'm9.5 6 6 6-6 6',
  chevronLeft: 'm14.5 6-6 6 6 6',
  chevronDown: 'm6 9.5 6 6 6-6',
  arrowUp: 'M12 19V5M6 11l6-6 6 6',
  arrowDown: 'M12 5v14M6 13l6 6 6-6',
  arrowUpRight: 'M7 17 17 7M8.5 7H17v8.5',
  alert: 'M12 9v4.5M12 17h.01M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5.5M12 7.5h.01',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3.5 2',
  eye: 'M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12ZM12 14.8a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6Z',
  heart: 'M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20Z',
  capital: 'M4 9.5 12 4l8 5.5M5.5 10v7.5M9.8 10v7.5M14.2 10v7.5M18.5 10v7.5M3.5 20.5h17',
  trap: 'M12 3.5v4M12 21a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM12 11.5v3l2 1.5',
  repost: 'M4.5 11a7.5 7.5 0 0 1 13-4.7L20 9M20 4.5V9h-4.5M19.5 13a7.5 7.5 0 0 1-13 4.7L4 15M4 19.5V15h4.5',
  calendar: 'M4 6.5a1.5 1.5 0 0 1 1.5-1.5h13A1.5 1.5 0 0 1 20 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-12ZM4 10h16M8.5 3v4M15.5 3v4',
  upload: 'M12 15.5V4M7 8.5l5-5 5 5M4.5 15v3.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V15',
  columns: 'M4 5h16v14H4zM9.5 5v14M14.5 5v14',
  rows: 'M4 6h16M4 12h16M4 18h16',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z',
  monitor: 'M3.5 5.5h17v11h-17zM8.5 20h7M12 16.5V20',
  external: 'M14 4h6v6M20 4l-8.5 8.5M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10',
  panel: 'M4 5h16v14H4zM14.5 5v14',
  trendUp: 'M3.5 17 9.5 11l3.5 3.5L20.5 7',
  trendDown: 'M3.5 7 9.5 13l3.5-3.5L20.5 17',
  price: 'M12 3.5v17M16.5 7H10a2.8 2.8 0 0 0 0 5.5h4a2.8 2.8 0 0 1 0 5.5H7',
  tag: 'M3.5 12.3V4.5a1 1 0 0 1 1-1h7.8l8.3 8.3a1.4 1.4 0 0 1 0 2l-6.2 6.2a1.4 1.4 0 0 1-2 0L3.5 12.3ZM8 8h.01',
  layers: 'M3.5 8 12 3.8 20.5 8 12 12.2 3.5 8ZM3.5 12.2 12 16.4l8.5-4.2',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 12h.01',
  filter: 'M4 5h16l-6.2 7.5v5.5l-3.6 2v-7.5L4 5Z',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  hourglass: 'M6.5 3.5h11M6.5 20.5h11M7.5 3.5c0 5 9 5 9 8.5s-9 3.5-9 8.5M16.5 3.5c0 3-3 4.5-4.5 5.5',
  scale: 'M12 4v16M5 20h14M5.5 8h13M5.5 8 3 14a3 3 0 0 0 5 0L5.5 8ZM18.5 8 16 14a3 3 0 0 0 5 0l-2.5-6ZM12 4l-1.5 1.5M12 4l1.5 1.5',
  book: 'M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5v-15ZM5 19.5A1.5 1.5 0 0 0 6.5 21H19',
  dot: 'M12 12.01h.01',
  edit: 'M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4ZM13.5 6.5l4 4',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, strokeWidth = 1.75, ...rest }: { name: IconName; size?: number; strokeWidth?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

export type TileTone = 'violet' | 'cobalt' | 'emerald' | 'amber' | 'coral' | 'cyan' | 'pink' | 'neutral';

export function IconTile({ name, tone, size = 'md', label }: { name: IconName; tone: TileTone; size?: 'sm' | 'md' | 'lg'; label?: string }) {
  const px = size === 'lg' ? 18 : size === 'sm' ? 13 : 15;
  return (
    <span className={`icon-tile icon-tile--${size} tile-${tone}`} role={label ? 'img' : undefined} aria-label={label}>
      <Icon name={name} size={px} strokeWidth={size === 'sm' ? 2 : 1.9} />
    </span>
  );
}

/** Section → tone mapping, shared by nav, cards and priorities. */
export const SECTION_TONE = {
  today: 'violet',
  stock: 'cobalt',
  market: 'cobalt',
  buy: 'violet',
  sales: 'emerald',
  insights: 'cyan',
  capital: 'amber',
  warning: 'coral',
} as const satisfies Record<string, TileTone>;
