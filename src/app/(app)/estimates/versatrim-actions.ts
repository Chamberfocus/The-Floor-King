"use server";

import {
  matchVersatrimListings,
  parseVersatrimSearchHtml,
  versatrimSearchTerm,
  versatrimSearchUrl,
  type VersatrimListing,
  type VersatrimMatch,
  type VersatrimQuery,
} from "@/lib/versatrim";

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; listings: VersatrimListing[] }>();

async function fetchSearchPage(term: string, page: number): Promise<string> {
  const response = await fetch(versatrimSearchUrl(term, page), {
    headers: {
      Accept: "text/html",
      "User-Agent": "FloorKingCRM/1.0 (transition check)",
    },
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Versatrim answered ${response.status}`);
  return response.text();
}

async function listingsFor(term: string): Promise<VersatrimListing[]> {
  const cached = cache.get(term.toLowerCase());
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.listings;
  const firstHtml = await fetchSearchPage(term, 1);
  const first = parseVersatrimSearchHtml(firstHtml);
  const listings = [...first.listings];
  const wanted = first.resultCount ?? listings.length;
  for (let page = 2; page <= 4 && listings.length < wanted; page += 1) {
    const next = parseVersatrimSearchHtml(await fetchSearchPage(term, page));
    if (!next.listings.length) break;
    listings.push(...next.listings);
  }
  const unique = new Map<string, VersatrimListing>();
  for (const item of listings) unique.set(item.sku || item.title.toLowerCase(), item);
  const out = [...unique.values()];
  cache.set(term.toLowerCase(), { at: Date.now(), listings: out });
  return out;
}

/** Look up stair nose, end cap, T-mold, and reducer on Versatrim for one floor. */
export async function lookupVersatrimTransitions(input: VersatrimQuery): Promise<VersatrimMatch> {
  const term = versatrimSearchTerm(input);
  const unmatched = matchVersatrimListings([], input);
  if (!term || unmatched.message) return unmatched;
  try {
    const listings = await listingsFor(term);
    return matchVersatrimListings(listings, input);
  } catch {
    return {
      ok: false,
      term,
      searchUrl: versatrimSearchUrl(term),
      message: "Versatrim did not answer. Open their search and check this color before you order.",
      profiles: unmatched.profiles,
    };
  }
}
