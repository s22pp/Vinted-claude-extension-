import { CATEGORIES, CONDITIONS, type Category, type Condition, type ItemStatus } from '@/domain/entities';
import { parseMoneyInput } from '@/domain/money';
import { categoriesInTitle, normalizeText } from '@/intelligence/normalize';

/** Minimal RFC-4180 CSV parser; auto-detects `;` (French Excel) vs `,`. */
export function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

const HEADERS: Record<string, string[]> = {
  title: ['titre', 'title', 'article', 'nom'],
  brand: ['marque', 'brand'],
  model: ['modele', 'model', 'ligne'],
  category: ['categorie', 'category', 'type'],
  size: ['taille', 'size'],
  condition: ['etat', 'condition', 'state'],
  purchasePrice: ['prix achat', 'prix_achat', 'achat', 'cout', 'purchase price', 'cost'],
  purchaseDate: ['date achat', 'date_achat', 'purchase date'],
  purchaseSource: ['source', 'source achat', 'source_achat'],
  price: ['prix', 'price', 'prix vente', 'prix affiche'],
  views: ['vues', 'views'],
  favorites: ['favoris', 'favorites', 'likes'],
  listedAt: ['date publication', 'date_publication', 'publie le', 'listed at'],
  status: ['statut', 'status', 'etat annonce'],
  url: ['url', 'lien', 'link'],
};

const CONDITION_WORDS: [RegExp, Condition][] = [
  [/neuf avec|with tags|nwt/, 'NEW_WITH_TAGS'],
  [/neuf|new/, 'NEW_WITHOUT_TAGS'],
  [/tres bon|very good/, 'VERY_GOOD'],
  [/bon|good/, 'GOOD'],
  [/satisf/, 'SATISFACTORY'],
];

function parseDate(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const fr = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (fr) {
    const y = Number(fr[3]!.length === 2 ? `20${fr[3]}` : fr[3]);
    return new Date(y, Number(fr[2]) - 1, Number(fr[1])).getTime();
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

function parseIntOrNull(raw: string): number | null {
  const n = Number.parseInt(raw.replace(/\s/g, ''), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const STATUS_WORDS: [RegExp, ItemStatus][] = [
  [/vendu|sold/, 'SOLD'],
  [/reserv/, 'RESERVED'],
  [/masqu|hidden/, 'HIDDEN'],
  [/brouillon|draft|non poste/, 'DRAFT'],
  [/en ligne|poste|actif|active|listed/, 'LISTED'],
];

export interface CsvItem {
  title: string;
  brand: string;
  model: string | null;
  category: Category;
  gender: null;
  size: string | null;
  condition: Condition | null;
  purchasePriceCents: number | null;
  purchaseDate: number | null;
  purchaseSource: string | null;
  priceCents: number | null;
  listedAt: number | null;
  views: number | null;
  favorites: number | null;
  url: string | null;
  status: ItemStatus | null;
}

export function mapCsv(rows: string[][]): { items: CsvItem[]; skipped: number } {
  const [head, ...body] = rows;
  if (!head) return { items: [], skipped: 0 };
  const idx: Partial<Record<keyof typeof HEADERS, number>> = {};
  head.forEach((h, i) => {
    const n = normalizeText(h).replace(/_/g, ' ');
    for (const [key, aliases] of Object.entries(HEADERS)) {
      if (idx[key as keyof typeof HEADERS] === undefined && aliases.some((a) => normalizeText(a) === n)) idx[key as keyof typeof HEADERS] = i;
    }
  });
  const get = (r: string[], k: keyof typeof HEADERS) => (idx[k] === undefined ? '' : (r[idx[k]!] ?? '').trim());
  const items: CsvItem[] = [];
  let skipped = 0;
  for (const r of body) {
    const title = get(r, 'title');
    const brand = get(r, 'brand');
    if (!title || !brand) {
      skipped++;
      continue;
    }
    const catRaw = get(r, 'category').toUpperCase();
    const category: Category = (CATEGORIES as readonly string[]).includes(catRaw) ? (catRaw as Category) : (categoriesInTitle(normalizeText(`${catRaw} ${title}`))[0] ?? 'OTHER');
    const condRaw = normalizeText(get(r, 'condition'));
    const condition = (CONDITIONS as readonly string[]).includes(get(r, 'condition').toUpperCase())
      ? (get(r, 'condition').toUpperCase() as Condition)
      : (CONDITION_WORDS.find(([re]) => re.test(condRaw))?.[1] ?? null);
    const money = (k: keyof typeof HEADERS) => {
      const v = parseMoneyInput(get(r, k));
      return v === undefined ? null : v;
    };
    items.push({
      title,
      brand,
      model: get(r, 'model') || null,
      category,
      gender: null,
      size: get(r, 'size') || null,
      condition,
      purchasePriceCents: money('purchasePrice'),
      purchaseDate: parseDate(get(r, 'purchaseDate')),
      purchaseSource: get(r, 'purchaseSource') || null,
      priceCents: money('price'),
      listedAt: parseDate(get(r, 'listedAt')),
      views: parseIntOrNull(get(r, 'views')),
      favorites: parseIntOrNull(get(r, 'favorites')),
      url: get(r, 'url') || null,
      status: STATUS_WORDS.find(([re]) => re.test(normalizeText(get(r, 'status'))))?.[1] ?? null,
    });
  }
  return { items, skipped };
}
