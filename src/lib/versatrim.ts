/**
 * Versatrim is the first place Floor King looks for a matching stair nose,
 * end cap, T-mold, and reducer. The public catalog is searched by the flooring
 * color. A listing is used only when that color is on the Versatrim title.
 * No price and no SKU is invented when the search comes back empty.
 */

export const VERSATRIM_SEARCH_ORIGIN = "https://versatrim.com/search.php";

export const VERSATRIM_PROFILES = ["stair_nose", "end_cap", "t_mold", "reducer"] as const;

export type VersatrimProfile = (typeof VERSATRIM_PROFILES)[number];

export const VERSATRIM_PROFILE_LABEL: Record<VersatrimProfile, string> = {
  stair_nose: "Stair nose",
  end_cap: "End cap",
  t_mold: "T-mold",
  reducer: "Reducer",
};

export interface VersatrimQuery {
  manufacturer?: string | null;
  style?: string | null;
  color?: string | null;
  label?: string | null;
}

export interface VersatrimListing {
  sku: string;
  title: string;
  url: string;
  brand: string;
  profile: VersatrimProfile | "slim_trim" | "versaedge" | "other";
}

export interface VersatrimHit {
  sku: string;
  title: string;
  url: string;
  brand: string;
  /**
   * SlimTrim covers end cap, T-mold, and reducer.
   * VersaEdge is used for stair nose only when no stair-nose listing exists.
   */
  via: "listed" | "slim_trim" | "versaedge";
}

export interface VersatrimMatch {
  ok: boolean;
  term: string | null;
  searchUrl: string | null;
  /** Set when Versatrim could not be checked, or the color is too broad to trust. */
  message: string | null;
  profiles: Record<VersatrimProfile, VersatrimHit | null>;
}

const GENERIC_COLOR = new Set([
  "oak",
  "gray",
  "grey",
  "white",
  "black",
  "beige",
  "natural",
  "brown",
  "tan",
  "walnut",
  "maple",
  "hickory",
  "cherry",
  "ash",
  "pine",
]);

function clean(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s+/g, " ").trim();
}

export function versatrimSearchTerm(input: VersatrimQuery): string | null {
  const color = clean(input.color);
  const style = clean(input.style);
  if (color.length >= 3) return color;
  if (style.length >= 3) return style;
  return null;
}

export function versatrimSearchUrl(term: string, page = 1): string {
  const params = new URLSearchParams({
    search_query: term,
    limit: "100",
  });
  if (page > 1) params.set("page", String(page));
  return `${VERSATRIM_SEARCH_ORIGIN}?${params.toString()}`;
}

function decodeEntities(raw: string): string {
  return raw
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function textOf(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

export function versatrimProfile(title: string): VersatrimListing["profile"] {
  const t = title.toLowerCase();
  if (/stair\s*nose/.test(t)) return "stair_nose";
  if (/versa\s*edge|versaedge/.test(t)) return "versaedge";
  if (/end\s*cap|slim\s*cap/.test(t)) return "end_cap";
  if (/t-?\s*mold/.test(t)) return "t_mold";
  if (/\breducer\b/.test(t)) return "reducer";
  if (/slim\s*trim|slimtrim/.test(t)) return "slim_trim";
  return "other";
}

function skuFromTitle(title: string): string {
  const first = title.split(",")[0]?.trim() ?? "";
  return /^[A-Z0-9]+(?:-[A-Z0-9]+)+$/i.test(first) ? first : "";
}

function canonicalUrl(href: string): string {
  const decoded = decodeEntities(href);
  try {
    const url = new URL(decoded, "https://versatrim.com");
    return `${url.origin}${url.pathname}`;
  } catch {
    return decoded.split("?")[0] || decoded;
  }
}

export function parseVersatrimSearchHtml(html: string): {
  listings: VersatrimListing[];
  resultCount: number | null;
} {
  const countMatch = html.match(/(\d+)\s+results/i);
  const resultCount = countMatch ? Number(countMatch[1]) : null;
  const chunks = html.split(/<article\b/i).slice(1);
  const listings: VersatrimListing[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    const titleMatch = chunk.match(/class="card-title">\s*<a\b([^>]*)>([\s\S]*?)<\/a>/i);
    if (!titleMatch) continue;
    const title = textOf(titleMatch[2]);
    if (!title) continue;
    const hrefMatch = titleMatch[1].match(/\bhref="([^"]+)"/i);
    const brandMatch = chunk.match(/class="card-text brand-name"[^>]*>([\s\S]*?)<\/p>/i);
    const sku = skuFromTitle(title);
    const key = sku || title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    listings.push({
      sku,
      title,
      url: hrefMatch ? canonicalUrl(hrefMatch[1]) : "",
      brand: brandMatch ? textOf(brandMatch[1]) : "",
      profile: versatrimProfile(title),
    });
  }
  return { listings, resultCount };
}

function words(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** The flooring color is on this title as its own words, not inside a longer color. */
export function versatrimTitleHasColor(title: string, term: string): boolean {
  const color = words(term);
  const hay = words(title);
  if (color.length < 3 || !hay) return false;
  return new RegExp(`(?:^| )${color.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?: |$)`).test(hay);
}

function colorIsTooBroad(term: string): boolean {
  const parts = words(term).split(" ").filter(Boolean);
  return parts.length === 1 && GENERIC_COLOR.has(parts[0]);
}

function brandScore(manufacturer: string, brand: string): number {
  const mill = words(manufacturer);
  const listed = words(brand);
  if (!listed) return 0;
  if (listed === "versatrim") return 2;
  if (mill && (listed.includes(mill) || mill.includes(listed))) return 3;
  return 1;
}

function emptyProfiles(): VersatrimMatch["profiles"] {
  return { stair_nose: null, end_cap: null, t_mold: null, reducer: null };
}

export function matchVersatrimListings(
  listings: VersatrimListing[],
  input: VersatrimQuery,
): VersatrimMatch {
  const term = versatrimSearchTerm(input);
  if (!term) {
    return {
      ok: true,
      term: null,
      searchUrl: null,
      message: "Add the flooring color. Versatrim is checked from that color.",
      profiles: emptyProfiles(),
    };
  }
  const searchUrl = versatrimSearchUrl(term);
  if (colorIsTooBroad(term)) {
    return {
      ok: true,
      term,
      searchUrl,
      message: `“${term}” matches too many Versatrim colors. Use the full color name from the floor.`,
      profiles: emptyProfiles(),
    };
  }
  const hits = listings.filter((item) => versatrimTitleHasColor(item.title, term));
  const profiles = emptyProfiles();
  const manufacturer = clean(input.manufacturer);
  const pick = (candidates: VersatrimListing[], via: VersatrimHit["via"]): VersatrimHit | null => {
    if (!candidates.length) return null;
    const ranked = [...candidates].sort(
      (a, b) => brandScore(manufacturer, b.brand) - brandScore(manufacturer, a.brand),
    );
    const best = ranked[0];
    return {
      sku: best.sku,
      title: best.title,
      url: best.url,
      brand: best.brand,
      via,
    };
  };
  for (const profile of VERSATRIM_PROFILES) {
    profiles[profile] = pick(
      hits.filter((item) => item.profile === profile),
      "listed",
    );
  }
  if (!profiles.stair_nose) {
    profiles.stair_nose = pick(
      hits.filter((item) => item.profile === "versaedge"),
      "versaedge",
    );
  }
  const slim = pick(
    hits.filter((item) => item.profile === "slim_trim"),
    "slim_trim",
  );
  if (slim) {
    for (const profile of ["end_cap", "t_mold", "reducer"] as const) {
      if (!profiles[profile]) profiles[profile] = slim;
    }
  }
  return { ok: true, term, searchUrl, message: null, profiles };
}

export function versatrimTrimProfile(type: string): VersatrimProfile | null {
  const t = type || "";
  if (/stair\s*-?\s*nose|stairnose/i.test(t)) return "stair_nose";
  if (/end\s*cap/i.test(t)) return "end_cap";
  if (/t-?\s*mold/i.test(t)) return "t_mold";
  if (/reducer/i.test(t)) return "reducer";
  return null;
}
