/**
 * fcB2B — the flooring industry's own B2B standard.
 *
 * Two generations exist side by side, and a supplier may offer either:
 *
 *  • X12-derived DOCUMENTS, exchanged as files. 832 Price Catalog, 850
 *    Purchase Order, 855 PO Acknowledgement, 856 Advance Ship Notice, 810
 *    Invoice, 997 Functional Acknowledgement. Tuned for flooring — dye lots,
 *    roll widths, piece dimensions.
 *
 *  • RESTful WEB SERVICES (spec v1.0, Jan 2024) for near-real-time questions:
 *    stock check, inventory inquiry, price inquiry, related items, solution
 *    check/inquiry, document service.
 *
 * Every request carries the same four parameters, and the spec is explicit that
 * ClientIdentifier is a code the SUPPLIER issues for electronic exchange — it
 * warns against reusing the account number.
 */

import { normalizeUnit } from "@/lib/units";

export const FCB2B_DOCUMENTS = [
  { code: "832", name: "Product Price Catalog", why: "Their price list. This is what keeps our costs current." },
  { code: "850", name: "Purchase Order", why: "Our order, sent electronically instead of by phone or email." },
  { code: "855", name: "PO Acknowledgement", why: "Their confirmation — what they accepted, at what price, and when it ships." },
  { code: "856", name: "Advance Ship Notice", why: "What actually shipped, with dye lots and roll numbers, before it arrives." },
  { code: "810", name: "Invoice", why: "Their bill, matched automatically against the PO and the receipt." },
  { code: "997", name: "Functional Acknowledgement", why: "A receipt for the exchange itself, so nothing is silently lost." },
] as const;

export const FCB2B_SERVICES = [
  { path: "/services", name: "Service Discovery", why: "Which of the services below you support." },
  { path: "/stockcheck", name: "Stock Check", why: "Is this item available right now?" },
  { path: "/inventoryinquiry", name: "Inventory Inquiry", why: "All availability for an item." },
  { path: "/relateditems", name: "Related Items", why: "Trims, mouldings and accessories that go with an item." },
  { path: "/solutioncheck", name: "Solution Check", why: "Availability filtered by dye lot or shade." },
  { path: "/solutioninquiry", name: "Solution Inquiry", why: "Every roll or carton matching a constraint." },
  { path: "/documentservice", name: "Document Service", why: "Spec sheets, warranties and images for an item." },
] as const;

/** The four parameters every fcB2B web-service request carries. */
export const FCB2B_REQUEST_PARAMS = [
  { name: "ClientIdentifier", meaning: "The buyer code you assign us. The spec recommends this NOT be our account number." },
  { name: "SupplierItemSKU", meaning: "Your SKU for the item, the same one used on the 832 catalog and 850 order." },
  { name: "TimeStamp", meaning: "ISO 8601 date-time." },
  { name: "GlobalIdentifier", meaning: "A UUID we generate, echoed back so the response can be matched to the request." },
] as const;

/** What we need FROM a supplier before anything can be switched on. */
export const ONBOARDING_ASKS = [
  {
    q: "Do you support fcB2B?",
    detail: "If yes, which documents (832 / 850 / 855 / 856 / 810) and do you offer the RESTful web services?",
  },
  {
    q: "What ClientIdentifier will you issue us?",
    detail: "The buyer code for electronic exchange. Per the fcB2B spec this should be separate from our account number.",
  },
  {
    q: "How is the price catalog delivered?",
    detail: "An 832 document, a CSV/Excel file, or a REST price-inquiry endpoint — and how often it is refreshed.",
  },
  {
    q: "How do we connect?",
    detail: "AS2, SFTP, HTTPS endpoint or email drop — plus the endpoint URL and how we authenticate.",
  },
  {
    q: "Which SKU appears on the catalog?",
    detail: "So it matches the SKU on your invoices and our purchase orders. A mismatch here is the usual reason a feed doesn't line up.",
  },
  {
    q: "Is pricing customer-specific?",
    detail: "Does the catalog carry OUR negotiated cost, or list price we discount from? If it's list, we need the discount basis.",
  },
  {
    q: "Who is the technical contact?",
    detail: "The person who actually configures the connection, not the sales rep.",
  },
] as const;

/** A UUID for the GlobalIdentifier parameter. */
export function globalIdentifier(): string {
  return crypto.randomUUID();
}

/* ==========================================================================
 * Reading a supplier's prices
 *
 * Two shapes arrive here — an 832 document (a file) and a REST price answer
 * (per item) — and both leave as the SAME normalized row, so everything
 * downstream (matching, review, apply) is written once.
 * ======================================================================== */

/** One price line, normalized from whatever the supplier actually sent. */
export interface CatalogPriceRow {
  /** The supplier's own SKU — the only thing we can match on. */
  supplierSku: string;
  description: string | null;
  /** Their price per `uom`. Null means they sent the item but no usable price. */
  cost: number | null;
  /** Normalized to our unit vocabulary where we recognise it. */
  uom: string | null;
  /** The unit code exactly as they sent it, for when the mapping is wrong. */
  rawUom: string | null;
  /** Which price this is (their qualifier code) — net cost vs list matters. */
  priceQualifier: string | null;
  effectiveDate: string | null; // ISO yyyy-mm-dd
  /** Broadloom roll dimensions, when the mill states them in feet. */
  rollWidthFt: number | null;
  rollLengthFt: number | null;
  /** Everything we saw for this item, so a bad import is diagnosable. */
  raw: Record<string, unknown>;
}

/**
 * X12 price qualifiers, best first.
 *
 * An 832 routinely carries SEVERAL prices for one item — your net cost, the
 * list price, an MSRP. Taking whichever came first would quietly load list
 * price in as our cost and inflate every estimate built afterwards, so the
 * qualifier decides, and the one we used is shown on the review screen.
 *
 * Codes vary by supplier. If Shaw's file uses something not listed here the
 * import still works (any priced CTP is better than none) but it lands at the
 * bottom of the preference order and the row is flagged for a human.
 */
export const COST_QUALIFIERS = ["NET", "UCP", "CST", "DEA", "DIS", "WHL"] as const;
export const LIST_QUALIFIERS = ["MSR", "RES", "CAT", "LST", "SRP"] as const;

/**
 * Observed in the wild: Shaw sends every price as `LPR`, and confirmed in
 * writing that it is "the price on the agreement that was added by your Shaw
 * sales rep" — i.e. our negotiated cost. It is left UNRANKED rather than added
 * to COST_QUALIFIERS, because the same three letters at another mill may well
 * mean list price, and a wrong guess there loads retail in as cost.
 */

/**
 * Identifiers a mill may hang the item's SKU on, best first.
 *
 * Shaw's 832 carries no VP at all: the style is on `ST` (and mirrored on GS,
 * MS and UX), while `SK` inside the SLN sublines is the colour-level code. Our
 * catalog stores STYLE numbers, and the price is quoted per style, so ST is
 * what we match on — checked against a real file: 176 of our 177 Shaw SKUs are
 * styles, and none are colour codes.
 */
const SKU_QUALIFIERS = ["ST", "GS", "MS", "UX", "VP", "SK", "BP", "UP", "IN"] as const;

/**
 * X12 unit-of-measure codes → the words this app's catalog already uses.
 *
 * The right-hand side is deliberately fed through `normalizeUnit` afterwards
 * so there is ONE unit vocabulary in the app, not a second one that drifts.
 */
const UOM_MAP: Record<string, string> = {
  SF: "sqft", SQ: "sqft",
  SY: "sqyd", SX: "sqyd",
  LF: "lnft", FT: "lnft",
  EA: "each", PZ: "each",
  PC: "pc",
  CA: "box", CT: "box", BX: "box", CTN: "box",
  RL: "roll",
  BG: "bag",
  SH: "sheet",
  GL: "gal",
};

/**
 * Map a supplier's unit code onto ours.
 *
 * This matters more than it looks: a Shaw price quoted per SQUARE YARD landing
 * on a product we sell by the square FOOT is a 9× error in our cost, and it
 * would flow straight into every estimate margin. The import compares this
 * against the product's own unit and refuses to move silently when they differ.
 */
export function normalizeUom(code: string | null | undefined): string | null {
  const c = (code ?? "").trim().toUpperCase();
  if (!c) return null;
  return normalizeUnit(UOM_MAP[c] ?? c) || null;
}

interface X12Separators {
  element: string;
  segment: string;
  component: string;
}

/**
 * Read the separators out of the ISA envelope rather than assuming `*` and `~`.
 * They are declared positionally: ISA is a fixed 106 characters, the element
 * separator is the 4th character, ISA16 holds the component separator, and the
 * segment terminator is whatever follows it.
 */
export function x12Separators(raw: string): X12Separators {
  if (raw.startsWith("ISA") && raw.length > 105) {
    return { element: raw[3], component: raw[104], segment: raw[105] };
  }
  return { element: "*", component: ">", segment: "~" };
}

function num(v: string | undefined): number | null {
  if (v == null || v.trim() === "") return null;
  const n = Number(v.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** X12 dates are CCYYMMDD (or YYMMDD on older partners). */
function x12Date(v: string | undefined): string | null {
  const s = (v ?? "").trim();
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (/^\d{6}$/.test(s)) {
    const yy = Number(s.slice(0, 2));
    const century = yy > 70 ? "19" : "20";
    return `${century}${s.slice(0, 2)}-${s.slice(2, 4)}-${s.slice(4, 6)}`;
  }
  return null;
}

/**
 * X12 hangs identifiers off a segment as qualifier/value PAIRS.
 *
 * `from` differs by segment — LIN starts them at element 2, SLN at 9 — and
 * empty pairs are common padding, so the alignment must be kept by stepping in
 * twos rather than by skipping blanks.
 */
function qualifierPairs(el: string[], from: number): Record<string, string> {
  const pairs: Record<string, string> = {};
  for (let i = from; i + 1 < el.length; i += 2) {
    const q = (el[i] ?? "").toUpperCase();
    if (q && !(q in pairs)) pairs[q] = el[i + 1] ?? "";
  }
  return pairs;
}

/** Rank a CTP price qualifier — lower is better. */
function qualifierRank(q: string | null): number {
  if (!q) return 50;
  const up = q.toUpperCase();
  const cost = (COST_QUALIFIERS as readonly string[]).indexOf(up);
  if (cost >= 0) return cost;
  const list = (LIST_QUALIFIERS as readonly string[]).indexOf(up);
  if (list >= 0) return 100 + list; // usable, but it is NOT our cost
  return 50;
}

/** Is this qualifier a list/retail price rather than our cost? */
export function isListPrice(q: string | null): boolean {
  return !!q && (LIST_QUALIFIERS as readonly string[]).includes(q.toUpperCase());
}

export interface Parsed832 {
  rows: CatalogPriceRow[];
  /** The catalog's own effective date from the header, if it carried one. */
  catalogDate: string | null;
  /** Things a human needs to know — never thrown away silently. */
  warnings: string[];
}

/**
 * Parse an fcB2B / X12 832 Product Price Catalog.
 *
 * Structure: a LIN segment opens each item, and the PID / CTP / DTM / PO4
 * segments that follow describe it until the next LIN.
 */
export function parse832(raw: string): Parsed832 {
  const warnings: string[] = [];
  const text = raw.replace(/\r/g, "");
  const sep = x12Separators(text);
  const segments = text
    .split(sep.segment)
    .map((s) => s.trim().replace(/\n/g, ""))
    .filter(Boolean);

  if (!segments.length) return { rows: [], catalogDate: null, warnings: ["The file had no segments — is it really an 832?"] };

  const hasCatalog = segments.some((s) => s.startsWith(`BCT${sep.element}`));
  if (!hasCatalog) {
    warnings.push(
      "No BCT segment found — this may not be an 832 Price Catalog. Parsed what was there anyway.",
    );
  }

  const rows: CatalogPriceRow[] = [];
  let catalogDate: string | null = null;

  // The item being built up, plus the best price seen for it so far.
  let cur: CatalogPriceRow | null = null;
  let curRank = Number.POSITIVE_INFINITY;
  // The colourway currently being described, when we are inside an SLN.
  let curColor: { sku: string | null; name: string | null; code: string | null } | null = null;
  const allPrices: {
    qualifier: string | null;
    price: number | null;
    uom: string | null;
    basis?: string | null;
  }[] = [];

  const flush = () => {
    if (!cur) return;
    cur.raw.prices = [...allPrices];
    cur.raw.color_count = (cur.raw.colors as unknown[])?.length ?? 0;
    if (!cur.supplierSku) {
      warnings.push(`An item was skipped because it carried no SKU: ${cur.description ?? "(no description)"}`);
    } else {
      rows.push(cur);
    }
    cur = null;
    curColor = null;
    curRank = Number.POSITIVE_INFINITY;
    allPrices.length = 0;
  };

  for (const segment of segments) {
    const el = segment.split(sep.element);
    const tag = el[0];

    switch (tag) {
      case "BCT":
        // The catalog header. Its date is the fallback effective date.
        catalogDate = x12Date(el[5]) ?? catalogDate;
        break;

      case "LIN": {
        flush();
        const pairs = qualifierPairs(el, 2);
        let sku = "";
        for (const q of SKU_QUALIFIERS) {
          if (pairs[q]?.trim()) {
            sku = pairs[q].trim();
            break;
          }
        }
        cur = {
          supplierSku: sku,
          // The mill's own name for the item (LIN `MN`) is a better starting
          // point than nothing, and PID*TRN usually replaces it below.
          description: pairs.MN?.trim() || null,
          cost: null,
          uom: null,
          rawUom: null,
          priceQualifier: null,
          effectiveDate: null,
          rollWidthFt: null,
          rollLengthFt: null,
          raw: { lin: pairs, manufacturer: pairs.MF?.trim() || null, colors: [] },
        };
        curColor = null;
        break;
      }

      case "SLN": {
        /**
         * A subline: one colourway of the style above it.
         *
         * Shaw prices the STYLE, then lists every colour it comes in — a dozen
         * or more, each with its own SK code. We don't price from these (our
         * catalog is keyed on the style), but carrying them makes the review
         * screen able to say what a single price actually covers.
         */
        if (!cur) break;
        const pairs = qualifierPairs(el, 9);
        curColor = { sku: pairs.SK?.trim() || null, name: null, code: null };
        (cur.raw.colors as unknown[]).push(curColor);
        break;
      }

      case "PID": {
        if (!cur) break;
        const kind = (el[2] ?? "").toUpperCase();
        const value = (el[5] ?? "").trim();
        if (!value) break;
        if (curColor) {
          // Inside a colourway: 73 is its name, 35 its number.
          if (kind === "73") curColor.name = value;
          else if (kind === "35") curColor.code = value;
          break;
        }
        // At item level, TRN is the trade name — the one a human recognises.
        // The others are classifications; keep them, but out of the title.
        if (kind === "TRN") cur.description = value;
        else {
          const cls = (cur.raw.classifications as Record<string, string>) ?? {};
          cls[kind] = value;
          cur.raw.classifications = cls;
        }
        break;
      }

      case "CTP": {
        if (!cur) break;
        const qualifier = (el[2] ?? "").trim().toUpperCase() || null;
        const price = num(el[3]);
        // CTP05 is a composite: the UOM code is its first component.
        const uomRaw = (el[5] ?? "").split(sep.component)[0]?.trim() || null;
        allPrices.push({ qualifier, price, uom: uomRaw, basis: (el[9] ?? "").trim() || null });
        // A zero is not a price. Shaw sends a second CTP per style carrying
        // 0 — taking it would wipe the item's cost to nothing.
        if (price == null || price === 0) break;
        const rank = qualifierRank(qualifier);
        // Keep the best-ranked price. Ties keep the first, which is the order
        // the supplier chose to send them in.
        if (rank < curRank) {
          curRank = rank;
          cur.cost = price;
          cur.priceQualifier = qualifier;
          if (uomRaw) {
            cur.rawUom = uomRaw;
            cur.uom = normalizeUom(uomRaw);
          }
        }
        break;
      }

      case "PO4": {
        // Physical details — the pack UOM, used only when no price carried one.
        if (cur && !cur.uom && el[3]) {
          cur.rawUom = el[3];
          cur.uom = normalizeUom(el[3]);
        }
        break;
      }

      case "MEA": {
        // Measurements. Keep them all — mills disagree on qualifiers — but
        // promote the two we can actually use: a roll's width and length.
        // Only when stated in FEET; the same WD/LN qualifiers also arrive in
        // other units for trims, where they describe a moulding, not a roll.
        if (!cur) break;
        const qualifier = (el[2] ?? "").toUpperCase();
        const value = num(el[3]);
        const uom = ((el[4] ?? "").split(sep.component)[0] ?? "").toUpperCase();
        const list = (cur.raw.measurements as unknown[]) ?? [];
        list.push({ qualifier, value, uom });
        cur.raw.measurements = list;
        if (uom === "FT" && value != null) {
          if (qualifier === "WD") cur.rollWidthFt = value;
          else if (qualifier === "LN") cur.rollLengthFt = value;
        }
        break;
      }

      case "DTM": {
        // 007 = effective, 008 = purchase order, 036 = expiration.
        const d = x12Date(el[2]);
        if (!d) break;
        if (cur && (el[1] === "007" || el[1] === "")) cur.effectiveDate = d;
        else if (!cur && el[1] === "007") catalogDate = d;
        break;
      }
    }
  }
  flush();

  for (const r of rows) if (!r.effectiveDate) r.effectiveDate = catalogDate;

  const priced = rows.filter((r) => r.cost != null).length;
  if (rows.length && !priced) {
    warnings.push(
      "Items parsed but not one carried a price — the CTP segments are missing or shaped differently than expected.",
    );
  }
  const listOnly = rows.filter((r) => isListPrice(r.priceQualifier)).length;
  if (listOnly) {
    warnings.push(
      `${listOnly} item${listOnly === 1 ? "" : "s"} priced from a LIST/retail qualifier, not a net cost. Check these before applying — loading list price in as cost inflates every estimate.`,
    );
  }
  return { rows, catalogDate, warnings };
}

/* ---------------------------------------------------------------------------
 * REST web services
 * ------------------------------------------------------------------------ */

export interface FeedConnection {
  endpoint_url: string | null;
  client_identifier: string | null;
  credential_key: string | null;
}

/**
 * The credential itself lives in a Vercel env var; the feed record only names
 * which one. `user:pass` is sent as Basic, anything else as a Bearer token.
 */
function authHeader(credentialKey: string | null | undefined): Record<string, string> {
  if (!credentialKey) return {};
  const value = process.env[credentialKey];
  if (!value) return {};
  if (value.includes(":")) {
    return { Authorization: `Basic ${Buffer.from(value).toString("base64")}` };
  }
  return { Authorization: `Bearer ${value}` };
}

export interface Fcb2bResponse {
  ok: boolean;
  status: number;
  body: string;
  url: string;
  error: string | null;
}

/** Call one fcB2B web service. Never throws — a dead supplier is a result. */
export async function fcb2bRequest(
  feed: FeedConnection,
  service: string,
  supplierItemSku: string,
  timeoutMs = 15_000,
): Promise<Fcb2bResponse> {
  const base = feed.endpoint_url?.trim();
  if (!base) {
    return { ok: false, status: 0, body: "", url: "", error: "No endpoint URL is configured for this supplier." };
  }
  const url = fcb2bUrl(base, service, feed.client_identifier ?? "", supplierItemSku, new Date());
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/xml, application/json;q=0.9, */*;q=0.1", ...authHeader(feed.credential_key) },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    const body = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      body,
      url,
      error: res.ok ? null : `${res.status} ${res.statusText}`.trim(),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // The URL carries no secret (the credential rides in the header), so it is
    // safe to hand back — it is the first thing you need when this fails.
    return { ok: false, status: 0, body: "", url, error: msg };
  }
}

/** Ask the supplier which services they actually expose. */
export async function discoverServices(feed: FeedConnection): Promise<Fcb2bResponse> {
  return fcb2bRequest(feed, "/services", "", 10_000);
}

/** Pull the first value of any tag/key whose name matches, XML or JSON. */
function findValue(body: string, pattern: RegExp): string | null {
  const xml = new RegExp(`<([A-Za-z0-9_:.-]*${pattern.source}[A-Za-z0-9_:.-]*)\\b[^>]*>([^<]+)</\\1>`, "i");
  const m = body.match(xml);
  if (m?.[2]) return m[2].trim();
  const json = new RegExp(`"([A-Za-z0-9_.-]*${pattern.source}[A-Za-z0-9_.-]*)"\\s*:\\s*"?([^",}\\]]+)"?`, "i");
  const j = body.match(json);
  return j?.[2]?.trim() ?? null;
}

/**
 * Read a price out of a REST answer.
 *
 * The v1.0 services are XML, but suppliers ship JSON too, and the tag names
 * differ between them. Rather than hard-code one supplier's shape, this looks
 * for the tag by MEANING and keeps the whole payload on the import line — so
 * the first real Shaw response tells us exactly what to tighten, instead of the
 * import silently coming back empty.
 */
export function priceFromResponse(body: string, supplierSku: string): CatalogPriceRow {
  const cost = num(findValue(body, /price|cost|amount/) ?? undefined);
  const uomRaw = findValue(body, /uom|unitofmeasure|unitcode/);
  const desc = findValue(body, /description|itemname|productname/);
  const eff = findValue(body, /effective/);
  return {
    supplierSku,
    description: desc,
    cost,
    uom: normalizeUom(uomRaw),
    rawUom: uomRaw,
    priceQualifier: null,
    effectiveDate: eff && /^\d{4}-\d{2}-\d{2}/.test(eff) ? eff.slice(0, 10) : x12Date(eff ?? undefined),
    rollWidthFt: null,
    rollLengthFt: null,
    raw: { body: body.slice(0, 4000) },
  };
}

/** Build an fcB2B web-service request URL with the four required parameters. */
export function fcb2bUrl(
  base: string,
  service: string,
  clientIdentifier: string,
  supplierItemSku: string,
  now: Date,
): string {
  const root = base.replace(/\/+$/, "");
  const path = service.startsWith("/") ? service : `/${service}`;
  const qs = new URLSearchParams({
    ClientIdentifier: clientIdentifier,
    SupplierItemSKU: supplierItemSku,
    TimeStamp: now.toISOString(),
    GlobalIdentifier: globalIdentifier(),
  });
  return `${root}${path}?${qs.toString()}`;
}
