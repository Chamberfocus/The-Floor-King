/**
 * How a flooring person searches the catalog.
 *
 * One query plan feeds the picker, the catalog page, global search, and
 * inventory. Words can arrive in any order. "8lb pad", "cushion", "RS-2044",
 * "coretech", and "t mold" are the same kind of question: find the product
 * they meant, with the closest match first.
 *
 * Retrieval needles are allowed to be a little generous. Ranking is strict:
 * every required word accounted for beats a partial, and a real word beats a
 * typo.
 */

export interface RankableProduct {
  id?: string;
  name?: string | null;
  sku?: string | null;
  manufacturer?: string | null;
  style?: string | null;
  color?: string | null;
  supplier?: string | null;
  category?: string | null;
  notes?: string | null;
  fiber?: string | null;
  species?: string | null;
  search_text?: string | null;
  active?: boolean | null;
}

export interface CatalogToken {
  /** What they typed, after phrase folding ("t mold" → tmold). */
  raw: string;
  /**
   * Spellings that count as the word itself: the typed form, 1/2 ↔ 0.5,
   * 8lb ↔ 8 lb, and known brand typos (coretech → coretec).
   */
  forms: string[];
  /** Longer trade synonyms (padding, rebond). Short ones stay retrieval-only. */
  synonyms: string[];
  /** Category enum values that satisfy this word (pad → underlayment). */
  categories: string[];
  /** ILIKE needles. Includes forms, synonyms, and a few typo expansions. */
  needles: string[];
  /**
   * "carpet" in "carpet pad" describes the pad. It boosts a pad whose name
   * says carpet, and it does not hide pads that don't.
   */
  optional: boolean;
}

interface TradeGroup {
  keys: string[];
  categories: string[];
  /** Words long enough to count as a match on their own. */
  synonyms: string[];
  /** Extra literals for retrieval, including short ones ("pad"). */
  needles: string[];
}

const TRADE: TradeGroup[] = [
  {
    keys: ["pad", "pads", "padding", "cushion", "cushions", "rebond", "underlay", "underlayment"],
    categories: ["underlayment"],
    synonyms: ["padding", "cushion", "rebond", "underlayment"],
    needles: ["pad", "padding", "cushion", "rebond", "underlayment"],
  },
  {
    keys: ["glue", "glues", "adhesive", "adhesives", "mastic"],
    categories: [],
    synonyms: ["adhesive", "mastic"],
    needles: ["glue", "adhesive", "mastic"],
  },
  {
    keys: ["lvp", "lvt", "lvf"],
    categories: ["lvp"],
    synonyms: [],
    needles: ["lvp", "lvt"],
  },
  {
    keys: ["plank", "planks"],
    categories: ["lvp"],
    synonyms: ["plank"],
    needles: ["plank"],
  },
  {
    keys: ["hardwood"],
    categories: ["hardwood"],
    synonyms: ["hardwood"],
    needles: ["hardwood"],
  },
  {
    keys: ["wood"],
    categories: ["hardwood"],
    synonyms: ["wood"],
    needles: ["wood"],
  },
  {
    keys: ["carpet", "carpets"],
    categories: ["carpet"],
    synonyms: ["carpet"],
    needles: ["carpet"],
  },
  {
    keys: ["laminate"],
    categories: ["laminate"],
    synonyms: ["laminate"],
    needles: ["laminate"],
  },
  {
    keys: ["tile", "tiles", "ceramic", "porcelain"],
    categories: ["tile"],
    synonyms: ["ceramic", "porcelain"],
    needles: ["tile", "ceramic", "porcelain"],
  },
  {
    keys: ["vinyl", "vinal", "vynil"],
    categories: ["lvp", "vinyl"],
    synonyms: ["vinyl"],
    needles: ["vinyl", "lvp"],
  },
  {
    keys: ["trim", "molding", "moulding", "moldings", "mouldings"],
    categories: ["trim"],
    synonyms: ["molding", "moulding"],
    needles: ["trim", "molding", "moulding"],
  },
  {
    keys: ["transition", "transitions", "reducer", "reducers", "threshold", "thresholds"],
    categories: ["trim"],
    synonyms: ["transition", "reducer", "threshold"],
    needles: ["transition", "reducer", "threshold"],
  },
  {
    keys: ["tmold", "tmolding", "tmould"],
    categories: ["trim"],
    synonyms: ["tmolding", "molding"],
    needles: ["tmold", "t-mold", "t mold", "t-molding", "t molding", "tmolding"],
  },
  {
    keys: ["quarterround"],
    categories: ["trim"],
    synonyms: ["quarterround"],
    needles: ["quarter round", "quarter-round", "quarterround", "qtr round"],
  },
  {
    keys: ["endcap"],
    categories: ["trim"],
    synonyms: ["endcap"],
    needles: ["end cap", "end-cap", "endcap"],
  },
  {
    keys: ["jchannel"],
    categories: ["trim"],
    synonyms: ["jchannel"],
    needles: ["j-channel", "j channel", "jchannel"],
  },
  {
    keys: ["revwood"],
    categories: [],
    synonyms: ["revwood"],
    needles: ["revwood", "rev wood", "revo wood", "revowood"],
  },
  {
    keys: ["shoemold"],
    categories: ["trim"],
    synonyms: ["shoemold"],
    needles: ["shoe mold", "shoe mould", "shoemold"],
  },
  {
    keys: ["stairnose"],
    categories: ["trim"],
    synonyms: ["stairnose"],
    needles: ["stair nose", "stairnose", "stair nosing"],
  },
  {
    keys: ["coretec"],
    categories: [],
    synonyms: ["coretec"],
    needles: ["coretec", "core tec"],
  },
];

const TRADE_BY_KEY = new Map<string, TradeGroup>();
for (const group of TRADE) {
  for (const key of group.keys) TRADE_BY_KEY.set(key, group);
}

/** Brand and color misspellings we see on the floor. Value is the real spelling. */
const TYPOS: Record<string, string> = {
  coretech: "coretec",
  cortech: "coretec",
  coreteck: "coretec",
  coretek: "coretec",
  dreamweever: "dreamweaver",
  dreamwever: "dreamweaver",
  dreamweavor: "dreamweaver",
  acaia: "acacia",
  accacia: "acacia",
  acaciaa: "acacia",
  carpett: "carpet",
  mohak: "mohawk",
  mohwak: "mohawk",
  shaww: "shaw",
  laminat: "laminate",
  lamiante: "laminate",
  hardwod: "hardwood",
  hardwoord: "hardwood",
  quater: "quarter",
  quartr: "quarter",
  transistion: "transition",
  transiton: "transition",
  porcelin: "porcelain",
  porcelian: "porcelain",
  vinal: "vinyl",
  vynil: "vinyl",
  underlay: "underlayment",
};

const PHRASES: [RegExp, string][] = [
  [/\brevo[\s-]?woods?\b/gi, " revwood "],
  [/\brev[\s-]?woods?\b/gi, " revwood "],
  [/\bcore[\s-]?tec\b/gi, " coretec "],
  [/\bt[\s-]?mould(?:ing)?s?\b/gi, " tmold "],
  [/\bt[\s-]?mold(?:ing)?s?\b/gi, " tmold "],
  [/\bquarter[\s-]?rounds?\b/gi, " quarterround "],
  [/\bqtr[\s-]?rounds?\b/gi, " quarterround "],
  [/\b1\s*\/\s*4[\s-]?rounds?\b/gi, " quarterround "],
  [/\bend[\s-]?caps?\b/gi, " endcap "],
  [/\bj[\s-]?channels?\b/gi, " jchannel "],
  [/\bshoe[\s-]?mo[u]?lds?\b/gi, " shoemold "],
  [/\bstair[\s-]?nose\b/gi, " stairnose "],
];

function squash(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9./]+/g, "");
}

function wordsOf(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9./]+/).filter(Boolean);
}

/**
 * Fractions and pad weights. "1/2" and "8lb" are how the catalog is searched
 * out loud; the row may say 0.5, .5, 8 lb, or 8#.
 */
export function measurementAliases(token: string): string[] {
  const out = new Set<string>([token]);
  const t = token.trim().toLowerCase();

  const frac = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (frac) {
    const v = Number(frac[1]) / Number(frac[2]);
    if (Number.isFinite(v) && v > 0) {
      out.add(String(v));
      out.add(String(v).replace(/^0/, ""));
    }
  }
  const dec = /^0?\.(\d+)$/.exec(t);
  if (dec) {
    const v = Number(`0.${dec[1]}`);
    for (const d of [2, 4, 8, 16]) {
      const n = v * d;
      if (Math.abs(n - Math.round(n)) < 1e-9) out.add(`${Math.round(n)}/${d}`);
    }
  }

  const wt = /^(\d+(?:\.\d+)?)\s*(?:lbs?|#)$/.exec(t);
  const bare = /^(\d+(?:\.\d+)?)$/.exec(t);
  const n = wt?.[1] ?? bare?.[1];
  if (n) {
    out.add(`${n}lb`);
    out.add(`${n} lb`);
    out.add(`${n}lbs`);
    out.add(`${n}#`);
  }
  return [...out];
}

function usableNeedle(needle: string): boolean {
  const n = needle.trim().toLowerCase();
  if (n.length >= 3) return true;
  if (n.length === 2 && /\d/.test(n)) return true;
  return false;
}

function typoNeedles(token: string): string[] {
  const out: string[] = [];
  if (token.length >= 8) out.push(token.slice(0, 6));
  else if (token.length >= 6) out.push(token.slice(0, 5));
  if (token.length >= 5 && token.length <= 14) {
    const dropped: string[] = [];
    for (let i = 1; i < token.length && dropped.length < 6; i++) {
      dropped.push(token.slice(0, i) + token.slice(i + 1));
    }
    out.push(...dropped);
    for (let i = 0; i < token.length - 1 && out.length < 12; i++) {
      if (token[i] === token[i + 1]) continue;
      out.push(token.slice(0, i) + token[i + 1] + token[i] + token.slice(i + 2));
    }
  }
  return out.filter((n) => usableNeedle(n) && n !== token);
}

function foldPhrases(query: string): string {
  let q = ` ${query} `;
  for (const [re, to] of PHRASES) q = q.replace(re, to);
  return q;
}

function buildToken(raw: string): CatalogToken {
  const forms = new Set<string>();
  if (usableNeedle(raw)) forms.add(raw);
  for (const alias of measurementAliases(raw)) {
    if (usableNeedle(alias)) forms.add(alias);
  }
  const corrected = TYPOS[raw];
  if (corrected) forms.add(corrected);

  const group = TRADE_BY_KEY.get(raw) ?? (corrected ? TRADE_BY_KEY.get(corrected) : undefined);
  const synonyms = new Set<string>();
  const categories = new Set<string>();
  const needles = new Set<string>();

  for (const form of forms) {
    if (usableNeedle(form) || form.includes(" ")) needles.add(form);
  }
  if (group) {
    for (const cat of group.categories) categories.add(cat);
    for (const word of group.synonyms) {
      if (word.length >= 5 && word !== raw) synonyms.add(word);
    }
    for (const needle of group.needles) if (usableNeedle(needle)) needles.add(needle);
  }
  for (const extra of typoNeedles(raw)) needles.add(extra);
  if (corrected) {
    for (const extra of typoNeedles(corrected)) needles.add(extra);
    if (usableNeedle(corrected)) needles.add(corrected);
  }

  return {
    raw,
    forms: [...forms],
    synonyms: [...synonyms],
    categories: [...categories],
    needles: [...needles].slice(0, 14),
    optional: false,
  };
}

/**
 * Split a catalog query into the words that have to be found.
 * Empty when the box is blank or only punctuation.
 */
export function parseCatalogQuery(query: string): CatalogToken[] {
  const folded = foldPhrases(query.trim().toLowerCase());
  const parts = folded
    .split(/[^a-z0-9/#.-]+/)
    .map((part) => part.replace(/^[-.]+|[-.]+$/g, ""))
    .filter((part) => part.length > 0);
  const tokens = parts.map(buildToken);
  const pad = tokens.find((t) => t.categories.includes("underlayment"));
  const carpet = tokens.find((t) => t.raw === "carpet" || t.raw === "carpett" || TYPOS[t.raw] === "carpet" || t.categories.includes("carpet") && t.forms.includes("carpet"));
  // "carpet pad" / "carpett pad" is a pad search. Carpet is a hint, not a second category.
  if (pad && carpet && pad !== carpet) carpet.optional = true;
  return tokens;
}

/** PostgREST `.or()` fragment. Quoted so "1/2" and "8 lb" stay one pattern. */
export function postgrestIlike(token: string): string {
  const esc = token.replace(/[\\%_]/g, (m) => `\\${m}`);
  return `"%${esc}%"`;
}

/** One token, OR'd across columns and its categories. AND tokens by calling this once each. */
export function tokenMatchOr(
  token: CatalogToken,
  columns: readonly string[],
): string {
  const parts: string[] = [];
  for (const needle of token.needles) {
    const pat = postgrestIlike(needle);
    for (const column of columns) parts.push(`${column}.ilike.${pat}`);
  }
  for (const category of token.categories) parts.push(`category.eq.${category}`);
  return parts.join(",");
}

type HitKind = "sku" | "word" | "prefix" | "category" | "contains" | "fuzzy" | "none";

const HIT_POINTS: Record<HitKind, number> = {
  sku: 900,
  word: 420,
  prefix: 280,
  category: 500,
  contains: 180,
  fuzzy: 110,
  none: 0,
};

function withinEdit(a: string, b: string, max: number): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return false;
  let prev = Array.from({ length: lb + 1 }, (_, i) => i);
  for (let i = 1; i <= la; i++) {
    const cur = [i];
    let rowMin = cur[0];
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return false;
    prev = cur;
  }
  return prev[lb] <= max;
}

function fieldBlob(p: RankableProduct): string {
  return [p.name, p.sku, p.manufacturer, p.style, p.color, p.supplier, p.fiber, p.species, p.notes, p.search_text]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function formHit(form: string, blob: string, ws: string[]): HitKind {
  const low = form.toLowerCase();
  if (!low) return "none";
  if (ws.includes(low)) return "word";
  if (low.includes(" ") && blob.includes(low)) return "word";
  const squashed = squash(low);
  if (squashed.length >= 3 && ws.some((w) => squash(w) === squashed)) return "word";
  if (low.length >= 2 && ws.some((w) => w.startsWith(low))) return "prefix";
  if (low.length >= 3 && blob.includes(low)) return "contains";
  if (squashed.length >= 4 && squash(blob).includes(squashed)) return "contains";
  return "none";
}

function bestFormHit(forms: string[], blob: string, ws: string[]): HitKind {
  let best: HitKind = "none";
  let bestPts = 0;
  for (const form of forms) {
    const hit = formHit(form, blob, ws);
    if (HIT_POINTS[hit] > bestPts) {
      best = hit;
      bestPts = HIT_POINTS[hit];
    }
  }
  return best;
}

function tokenHit(p: RankableProduct, token: CatalogToken): { kind: HitKind; points: number } {
  const blob = fieldBlob(p);
  const ws = wordsOf(blob);
  const sku = (p.sku ?? "").toLowerCase();
  const skuNorm = squash(sku);
  const rawNorm = squash(token.raw);
  if (sku && rawNorm.length >= 2 && (sku === token.raw || skuNorm === rawNorm)) {
    return { kind: "sku", points: HIT_POINTS.sku + 400 };
  }
  if (sku && rawNorm.length >= 3 && (sku.includes(token.raw) || skuNorm.includes(rawNorm))) {
    const rest = bestFormHit(token.forms, blob, ws);
    return { kind: "sku", points: HIT_POINTS.sku + Math.min(HIT_POINTS[rest], 200) };
  }

  const direct = bestFormHit(token.forms, blob, ws);
  const onCategory = token.categories.includes(p.category ?? "");
  const synonym = bestFormHit(token.synonyms, blob, ws);
  // A pad whose name says "pad" leads the padding list. A mop that merely
  // contains the word stays below every real pad. A trim whose name actually
  // says "t-mold" leads the other trim.
  if ((direct === "word" || direct === "prefix") && onCategory) {
    return { kind: "word", points: HIT_POINTS.word + 160 };
  }
  if (direct === "word" || direct === "prefix") return { kind: direct, points: HIT_POINTS[direct] };
  // "tmold" sits inside "T-Molding". That is the typed word, so it beats
  // every other trim row that only shares the category.
  if (direct === "contains" && onCategory) {
    return { kind: "contains", points: HIT_POINTS.category + 80 };
  }
  if (direct === "contains") return { kind: "contains", points: HIT_POINTS.contains };
  if ((synonym === "word" || synonym === "prefix") && onCategory) {
    return { kind: "word", points: HIT_POINTS.word + 80 };
  }
  if (synonym === "word" || synonym === "prefix") {
    return { kind: "word", points: HIT_POINTS.word - 40 };
  }
  if (synonym === "contains" && onCategory) {
    return { kind: "contains", points: HIT_POINTS.category + 40 };
  }
  if (onCategory) return { kind: "category", points: HIT_POINTS.category };
  if (synonym === "contains") return { kind: "contains", points: HIT_POINTS.contains - 20 };

  if (token.raw.length >= 5) {
    const max = 1;
    for (const word of ws) {
      if (word.length < 4) continue;
      if (word[0] !== token.raw[0]) continue;
      if (Math.abs(word.length - token.raw.length) > 1) continue;
      if (withinEdit(token.raw, word, max)) return { kind: "fuzzy", points: HIT_POINTS.fuzzy };
    }
  }
  return { kind: "none", points: 0 };
}

/**
 * Higher is better. Exact SKU, then a name that contains every word,
 * then manufacturer + product, then a typo. A product that misses a
 * required word stays below every product that has them all.
 */
export function scoreCatalogProduct(p: RankableProduct, query: string): number {
  const tokens = parseCatalogQuery(query);
  if (!tokens.length) return p.active === false ? 0 : 1;

  const required = tokens.filter((t) => !t.optional);
  const name = (p.name ?? "").toLowerCase();
  const sku = squash(p.sku ?? "");
  const queryNorm = squash(query);
  let score = 0;
  let covered = 0;
  let fuzzy = 0;

  if (sku && queryNorm && sku === queryNorm) score += 10000;
  else if (sku && queryNorm.length >= 3 && sku.startsWith(queryNorm)) score += 2500;
  if (name && name === query.trim().toLowerCase()) score += 8000;
  else if (name && name.startsWith(query.trim().toLowerCase())) score += 1400;

  const consider = required.length ? required : tokens;
  for (const token of consider) {
    const hit = tokenHit(p, token);
    if (hit.kind === "none") continue;
    covered += 1;
    score += hit.points;
    if (hit.kind === "fuzzy") fuzzy += 1;
  }
  for (const token of tokens) {
    if (!token.optional) continue;
    const hit = tokenHit(p, token);
    if (hit.kind !== "none") score += Math.round(hit.points / 3);
  }

  if (consider.length && covered === consider.length) score += fuzzy ? 1200 : 2200;
  else if (covered > 0) score += covered * 25;

  if (p.active === false) score -= 30;
  else score += 8;
  return score;
}

export function rankCatalogProducts<T extends RankableProduct>(rows: T[], query: string): T[] {
  const q = query.trim();
  if (!q) return rows;
  const tokens = parseCatalogQuery(q);
  if (!tokens.length) return rows;
  return rows
    .map((p) => ({ p, s: scoreCatalogProduct(p, q) }))
    .filter((row) => row.s > 8)
    .sort((a, b) => b.s - a.s || (a.p.name ?? "").localeCompare(b.p.name ?? ""))
    .map((row) => row.p);
}
