/** Article thumbnail. Real photos when available; otherwise a neutral garment glyph (never a fake photo). */
const GLYPHS: Record<string, string> = {
  jacket: 'M18 14l8-5h12l8 5 6 10-6 3v25H18V27l-6-3z M32 9v43',
  coat: 'M19 12l8-4h10l8 4 5 12-5 2v30H19V26l-5-2z M32 8v48 M27 30h2 M27 38h2',
  sweat: 'M17 17l9-6h12l9 6 5 12-6 2v22H18V31l-6-2z M26 11c2 4 10 4 12 0',
  shirt: 'M18 15l9-5 5 5 5-5 9 5 5 11-6 2v26H19V28l-6-2z M32 15v39',
  polo: 'M18 16l9-6 5 3 5-3 9 6 4 10-6 2v24H20V28l-6-2z M32 13v9',
  pants: 'M22 10h20l3 44h-9l-4-30-4 30h-9z',
  jeans: 'M22 10h20l3 44h-9l-4-30-4 30h-9z M22 16h20',
  fleece: 'M17 17l9-6h12l9 6 5 12-6 2v22H18V31l-6-2z M32 11v42 M29 18h6',
  knit: 'M17 17l9-6h12l9 6 5 12-6 2v22H18V31l-6-2z M26 11l6 8 6-8 M20 46h24',
  default: 'M20 14h24v38H20z',
};

const CATEGORY_GLYPH: Record<string, string> = {
  JACKET: 'jacket',
  COAT: 'coat',
  SWEATSHIRT: 'sweat',
  KNIT: 'knit',
  SHIRT: 'shirt',
  POLO: 'polo',
  TSHIRT: 'polo',
  JEANS: 'jeans',
  TROUSERS: 'pants',
  SHORTS: 'pants',
};

const HUES = [252, 226, 200, 280, 170, 30];

export function Thumb({ photoUrl, category, size = 'md', alt }: { photoUrl: string | null; category: string; size?: 'sm' | 'md' | 'lg'; alt: string }) {
  const cls = `thumb ${size !== 'md' ? `thumb--${size}` : ''}`;
  if (photoUrl && !photoUrl.startsWith('demo:')) {
    return (
      <span className={cls}>
        <img src={photoUrl} alt={alt} loading="lazy" />
      </span>
    );
  }
  const [, kind, v] = photoUrl?.split(':') ?? [];
  const glyph = GLYPHS[kind ?? CATEGORY_GLYPH[category] ?? 'default'] ?? GLYPHS.default!;
  const hue = HUES[Number(v ?? 0) % HUES.length]!;
  return (
    <span className={cls} role="img" aria-label={alt}>
      <svg viewBox="0 0 64 64">
        <rect width="64" height="64" fill={`hsl(${hue} 45% 50% / .12)`} />
        <path d={glyph} fill={`hsl(${hue} 55% 62% / .22)`} stroke={`hsl(${hue} 70% 72%)`} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </span>
  );
}
