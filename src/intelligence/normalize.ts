import type { Category, Condition, Gender } from '@/domain/entities';

export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Canonical brand → aliases as they appear in titles (normalized). Longest aliases first when matching. */
const BRAND_ALIASES: Record<string, string[]> = {
  'ralph lauren': ['polo ralph lauren', 'polo by ralph lauren', 'ralph lauren', 'polo sport', 'rlx'],
  carhartt: ['carhartt wip', 'carhartt'],
  levis: ['levi strauss', 'levis', 'levi s'],
  nike: ['nike acg', 'nike'],
  adidas: ['adidas originals', 'adidas'],
  'the north face': ['the north face', 'north face', 'tnf'],
  'stone island': ['stone island'],
  lacoste: ['lacoste'],
  'tommy hilfiger': ['tommy hilfiger', 'tommy jeans', 'hilfiger'],
  burberry: ['burberrys', 'burberry'],
  barbour: ['barbour'],
  patagonia: ['patagonia'],
  arcteryx: ['arcteryx', 'arc teryx'],
  marlboro: ['marlboro classics', 'marlboro'],
  quiksilver: ['quiksilver'],
  asics: ['asics'],
  schott: ['schott nyc', 'schott'],
  dickies: ['dickies'],
  stussy: ['stussy'],
  'massimo dutti': ['massimo dutti'],
  napapijri: ['napapijri'],
  'fred perry': ['fred perry'],
  // Common on the French second-hand market: without them, "Chemise Pierre Cardin" had no brand.
  'pierre cardin': ['pierre cardin'],
  'daniel hechter': ['daniel hechter'],
  cerruti: ['cerruti 1881', 'cerruti'],
  'hugo boss': ['hugo boss', 'boss orange', 'boss black', 'boss'],
  'calvin klein': ['calvin klein jeans', 'calvin klein'],
  armani: ['emporio armani', 'armani exchange', 'armani jeans', 'giorgio armani', 'armani'],
  'yves saint laurent': ['yves saint laurent', 'saint laurent', 'ysl'],
  dior: ['christian dior', 'dior'],
  gucci: ['gucci'],
  prada: ['prada'],
  versace: ['versace'],
  'dolce gabbana': ['dolce gabbana', 'dolce and gabbana'],
  lanvin: ['lanvin'],
  givenchy: ['givenchy'],
  balenciaga: ['balenciaga'],
  kenzo: ['kenzo'],
  guess: ['guess'],
  diesel: ['diesel'],
  gant: ['gant'],
  hackett: ['hackett london', 'hackett'],
  faconnable: ['faconnable'],
  'eden park': ['eden park'],
  'serge blanco': ['serge blanco'],
  'armor lux': ['armor lux'],
  'saint james': ['saint james'],
  'petit bateau': ['petit bateau'],
  aigle: ['aigle'],
  timberland: ['timberland'],
  'new balance': ['new balance'],
  'le coq sportif': ['le coq sportif'],
  'sergio tacchini': ['sergio tacchini'],
  'lee cooper': ['lee cooper'],
  lee: ['lee'],
  wrangler: ['wrangler'],
  'g star': ['g star raw', 'g star'],
  replay: ['replay'],
  chevignon: ['chevignon'],
  redskins: ['redskins'],
  nautica: ['nautica'],
  columbia: ['columbia'],
  quechua: ['quechua'],
  salomon: ['salomon'],
  mammut: ['mammut'],
  moncler: ['moncler'],
  'canada goose': ['canada goose'],
  woolrich: ['woolrich'],
  belstaff: ['belstaff'],
  'paul smith': ['paul smith'],
  'ted baker': ['ted baker'],
  'ben sherman': ['ben sherman'],
  'lyle scott': ['lyle and scott', 'lyle scott'],
  oxbow: ['oxbow'],
  billabong: ['billabong'],
  'rip curl': ['rip curl'],
  oneill: ['oneill'],
  supreme: ['supreme'],
  palace: ['palace'],
  obey: ['obey'],
  fjallraven: ['fjallraven', 'fjall raven'],
  'helly hansen': ['helly hansen'],
  'k way': ['k way', 'kway'],
  'agnes b': ['agnes b'],
  apc: ['a p c', 'apc'],
  sandro: ['sandro'],
  maje: ['maje'],
  'the kooples': ['the kooples', 'kooples'],
  'zadig voltaire': ['zadig voltaire', 'zadig et voltaire'],
  'comptoir des cotonniers': ['comptoir des cotonniers'],
  'scotch soda': ['scotch soda', 'scotch and soda'],
  'dr martens': ['dr martens', 'doc martens'],
  clarks: ['clarks'],
  birkenstock: ['birkenstock'],
  champion: ['champion'],
  kappa: ['kappa'],
  fila: ['fila'],
  puma: ['puma'],
  reebok: ['reebok'],
  vans: ['vans'],
  converse: ['converse'],
  umbro: ['umbro'],
  ellesse: ['ellesse'],
  kangol: ['kangol'],
  superdry: ['superdry'],
  hollister: ['hollister'],
  'abercrombie fitch': ['abercrombie fitch', 'abercrombie and fitch', 'abercrombie'],
  gap: ['gap'],
  uniqlo: ['uniqlo'],
  zara: ['zara'],
  'h m': ['h m', 'hm'],
  celio: ['celio'],
  jules: ['jules'],
  kiabi: ['kiabi'],
  bershka: ['bershka'],
  'pull bear': ['pull bear', 'pull and bear'],
  springfield: ['springfield'],
  devred: ['devred'],
  brice: ['brice'],
  'teddy smith': ['teddy smith'],
  kaporal: ['kaporal'],
  'pepe jeans': ['pepe jeans'],
  'jack jones': ['jack jones', 'jack and jones'],
  'vero moda': ['vero moda'],
  promod: ['promod'],
  mango: ['mango'],
};

/** How a canonical brand key is written for people (keys are normalised: no accents, no "&"). */
const BRAND_DISPLAY: Record<string, string> = {
  levis: 'Levi’s',
  'h m': 'H&M',
  'jack jones': 'Jack & Jones',
  'dolce gabbana': 'Dolce & Gabbana',
  'zadig voltaire': 'Zadig & Voltaire',
  'abercrombie fitch': 'Abercrombie & Fitch',
  'pull bear': 'Pull&Bear',
  'scotch soda': 'Scotch & Soda',
  'lyle scott': 'Lyle & Scott',
  'g star': 'G-Star',
  'dr martens': 'Dr. Martens',
  'agnes b': 'agnès b.',
  oneill: 'O’Neill',
  arcteryx: 'Arc’teryx',
  stussy: 'Stüssy',
  apc: 'A.P.C.',
  faconnable: 'Façonnable',
  fjallraven: 'Fjällräven',
  'k way': 'K-Way',
  'the north face': 'The North Face',
};

export function brandDisplay(key: string): string {
  return BRAND_DISPLAY[key] ?? key.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** "Inconnue", "Sans marque", empty…: not a brand — never a search term, never a filter. */
export function isUnknownBrand(brand: string | null | undefined): boolean {
  if (!brand) return true;
  return /^(|inconnue|inconnu|unknown|sans marque|no brand|autre|autres|other|marque inconnue)$/.test(normalizeText(brand));
}

/** A brand ERA knows, written in the title as a whole phrase (canonical key), or null. */
export function brandInTitle(title: string): string | null {
  const n = normalizeText(title);
  for (const { alias, brand } of ALIAS_INDEX) if (hasPhrase(n, alias)) return brand;
  return null;
}

const NOISE = new Set(['taille', 'tres', 'bon', 'etat', 'neuf', 'neuve', 'avec', 'sans', 'etiquette', 'etiquettes', 'homme', 'femme', 'mixte', 'unisexe', 'de', 'du', 'des', 'la', 'le', 'les', 'en', 'et', 'a', 'pour', 'tbe', 'be', 'ref']);
// Sizes (M, W32, 42…) and ERA references (E1C4G); a 3-digit number is a model (501, 574), kept.
const SIZE_TOKEN = /^(xxs|xs|s|m|l|xl|xxl|xxxl|[2-5]xl|w\d{2}|l\d{2}|\d{2}|t\d|e(?=[a-z]*\d)[0-9a-z]{4})$/;

/** The words of a title that describe the article: no sizes, no ERA reference, no condition filler. */
export function titleKeywords(title: string, max = 5): string {
  const words = normalizeText(title)
    .split(' ')
    .filter((w) => w && !NOISE.has(w) && !SIZE_TOKEN.test(w));
  return words.slice(0, max).join(' ');
}

const ALIAS_INDEX: { alias: string; brand: string }[] = Object.entries(BRAND_ALIASES)
  .flatMap(([brand, aliases]) => aliases.map((alias) => ({ alias, brand })))
  .sort((a, b) => b.alias.length - a.alias.length);

/** Pure and called with the same few brands thousands of times per render: remembered (bounded). */
const brandKeyCache = new Map<string, string>();

export function brandKey(raw: string): string {
  const hit = brandKeyCache.get(raw);
  if (hit !== undefined) return hit;
  const key = computeBrandKey(raw);
  if (brandKeyCache.size >= 5000) brandKeyCache.clear();
  brandKeyCache.set(raw, key);
  return key;
}

function computeBrandKey(raw: string): string {
  const n = normalizeText(raw);
  for (const { alias, brand } of ALIAS_INDEX) if (n === alias) return brand;
  for (const { alias, brand } of ALIAS_INDEX) if (hasPhrase(n, alias)) return brand;
  return n;
}

function hasPhrase(haystack: string, phrase: string): boolean {
  return ` ${haystack} `.includes(` ${phrase} `);
}

export function brandAliases(key: string): string[] {
  return BRAND_ALIASES[key] ?? [key];
}

export function titleHasBrand(title: string, key: string): boolean {
  const n = normalizeText(title);
  return brandAliases(key).some((a) => hasPhrase(n, a));
}

/** Title with brand phrases removed — "Polo Ralph Lauren" must not read as the category POLO. */
export function stripBrands(normTitle: string): string {
  let out = ` ${normTitle} `;
  for (const { alias } of ALIAS_INDEX) out = out.split(` ${alias} `).join(' ');
  return out.trim();
}

const CATEGORY_TERMS: Record<Category, RegExp> = {
  JACKET: /\b(veste|vestes|jacket|blouson|harrington|bomber|coach|trucker|windbreaker|coupe vent|doudoune|puffer|softshell|fleece|polaire)\b/,
  COAT: /\b(manteau|parka|trench|caban|coat|duffle)\b/,
  SWEATSHIRT: /\b(sweat|sweatshirt|hoodie|capuche|crewneck|zip)\b/,
  KNIT: /\b(pull|pullover|tricot|maille|cardigan|knit|jumper|col roule)\b/,
  SHIRT: /\b(chemise|oxford|overshirt|surchemise|flanelle)\b/,
  POLO: /\b(polo)\b/,
  TSHIRT: /\b(t shirt|tshirt|tee|debardeur)\b/,
  JEANS: /\b(jean|jeans|denim)\b/,
  TROUSERS: /\b(pantalon|chino|cargo|trousers|jogging)\b/,
  SHORTS: /\b(short|bermuda)\b/,
  SHOES: /\b(chaussures|baskets|sneakers|boots|bottes|mocassins|derbies)\b/,
  ACCESSORY: /\b(casquette|bonnet|ceinture|sac|echarpe|cap|gants)\b/,
  OTHER: /$^/,
};

const RELATED: Partial<Record<Category, Category[]>> = {
  JACKET: ['COAT'],
  COAT: ['JACKET'],
  SWEATSHIRT: ['KNIT'],
  KNIT: ['SWEATSHIRT'],
  SHIRT: ['POLO'],
  POLO: ['SHIRT', 'TSHIRT'],
  TSHIRT: ['POLO'],
  JEANS: ['TROUSERS'],
  TROUSERS: ['JEANS'],
};

export function categoriesInTitle(normTitle: string): Category[] {
  const t = stripBrands(normTitle);
  return (Object.keys(CATEGORY_TERMS) as Category[]).filter((c) => CATEGORY_TERMS[c].test(t));
}

export function categoryAffinity(a: Category, b: Category): number {
  if (a === b) return 1;
  return RELATED[a]?.includes(b) ? 0.5 : 0;
}

/** Terms that signal a different product: lots, kids, empty boxes, replicas. */
export const EXCLUDED_TERMS =
  /\b(lot|lots|enfant|enfants|bebe|\d+\s*ans|\d+\s*mois|kid|kids|junior|garcon|fillette|poupee|miniature|boite vide|replica|copie|contrefacon|inspired|type|facon|sans marque)\b/;

const WOMEN_TERMS = /\b(femme|woman|women|womens|fille)\b/;
const MEN_TERMS = /\b(homme|man|men|mens)\b/;

export function genderFromTitle(normTitle: string): Gender | null {
  if (WOMEN_TERMS.test(normTitle)) return 'WOMEN';
  if (MEN_TERMS.test(normTitle)) return 'MEN';
  return null;
}

const COLOURS = new Set(
  'noir black blanc white bleu blue marine navy rouge red vert green gris grey gray beige kaki khaki marron brown jaune yellow orange rose pink violet purple bordeaux camel creme ecru turquoise multicolore ciel fonce clair'.split(
    ' ',
  ),
);
const FILLER = new Set(
  'homme femme taille size tbe tres bon etat neuf new vintage authentique original vtg avec sans de du la le les et en a pour tailles xs s m l xl xxl xxxl t coupe regular fit slim'.split(
    ' ',
  ),
);

/** Tokens that describe the model/line of an article (no brand, colour, size, filler). */
export function modelTokens(normTitle: string): Set<string> {
  const t = stripBrands(normTitle);
  const out = new Set<string>();
  for (const tok of t.split(' ')) {
    if (tok.length < 2 || COLOURS.has(tok) || FILLER.has(tok) || /^\d{1,2}$/.test(tok)) continue;
    out.add(tok);
  }
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

const SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];

export function normalizeSize(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.toUpperCase().replace(/\s+/g, '').replace(/^TAILLE/, '');
  if (s === '2XL') return 'XXL';
  if (s === '3XL') return 'XXXL';
  return s;
}

export function sizeAffinity(a: string | null, b: string | null): number {
  const x = normalizeSize(a);
  const y = normalizeSize(b);
  if (!x || !y) return 0.5;
  if (x === y) return 1;
  const i = SIZE_ORDER.indexOf(x);
  const j = SIZE_ORDER.indexOf(y);
  if (i >= 0 && j >= 0) return Math.abs(i - j) === 1 ? 0.6 : 0.15;
  const nx = Number.parseFloat(x.replace(/^W/, ''));
  const ny = Number.parseFloat(y.replace(/^W/, ''));
  if (Number.isFinite(nx) && Number.isFinite(ny)) return Math.abs(nx - ny) <= 1 ? 0.6 : Math.abs(nx - ny) <= 2 ? 0.35 : 0.1;
  return 0.2;
}

export const CONDITION_RANK: Record<Condition, number> = {
  NEW_WITH_TAGS: 0,
  NEW_WITHOUT_TAGS: 1,
  VERY_GOOD: 2,
  GOOD: 3,
  SATISFACTORY: 4,
};

export function conditionAffinity(a: Condition | null, b: Condition | null): number {
  if (!a || !b) return 0.6;
  const d = Math.abs(CONDITION_RANK[a] - CONDITION_RANK[b]);
  return [1, 0.75, 0.4, 0.15, 0.1][d] ?? 0.1;
}

export function genderAffinity(a: Gender | null, b: Gender | null): number {
  if (!a || !b) return 0.7;
  if (a === b) return 1;
  if (a === 'UNISEX' || b === 'UNISEX') return 0.8;
  return 0;
}
