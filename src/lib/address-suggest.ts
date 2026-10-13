/**
 * Address suggestion helpers. Pure functions so tests can cover parsing,
 * Northeast Ohio ranking, unit handling, and outage messages without calling
 * Google or any other address service.
 */

export const NORTHEAST_OHIO = {
  lat: 41.4993,
  lng: -81.6944,
  /** About 50 miles — Cuyahoga and the adjoining counties. */
  radiusMeters: 80000,
} as const;

const WORD: Record<string, string> = {
  north: "n",
  south: "s",
  east: "e",
  west: "w",
  northeast: "ne",
  northwest: "nw",
  southeast: "se",
  southwest: "sw",
  street: "st",
  avenue: "ave",
  boulevard: "blvd",
  road: "rd",
  drive: "dr",
  lane: "ln",
  court: "ct",
  circle: "cir",
  place: "pl",
  parkway: "pkwy",
  highway: "hwy",
  terrace: "ter",
  trail: "trl",
  square: "sq",
};

const UNIT_RE =
  /(?:^|[\s,]+)((?:apt|apartment|suite|ste|unit|bldg|building|fl|floor|#)\s*[A-Za-z0-9-]+)\s*$/i;

export interface AddressSuggestion {
  description: string;
  placeId: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  /** A street range contains this house number. Not a USPS delivery check. */
  recognized: boolean;
  hint: string;
}

export interface AddressLookup {
  suggestions: AddressSuggestion[];
  error: string | null;
  notice: string | null;
}

export interface AddressParts {
  street: string;
  subpremise: string;
  city: string;
  state: string;
  zip: string;
}

export interface ResolvedAddress extends AddressParts {
  lat: number | null;
  lng: number | null;
  recognized: boolean;
  /** True/false only after a delivery check. Null means it was not checked. */
  deliverable: boolean | null;
  deliveryNote: string;
}

type Component = {
  long_name?: string;
  short_name?: string;
  longText?: string;
  shortText?: string;
  types?: string[];
};

export type AddressIndex = {
  v: number;
  z: Record<string, [string, number, number]>;
  r: [string, number, number, string][];
};

type Range = {
  name: string;
  from: number;
  to: number;
  zip: string;
  city: string;
  lat: number;
  lng: number;
  tokens: string[];
  parity: -1 | 0 | 1;
};

export type PreparedIndex = {
  ranges: Range[];
  postings: Map<string, number[]>;
};

const UNAVAILABLE =
  "Address suggestions are not available right now. Type the street, city, state, and ZIP yourself.";
const UNREACHABLE =
  "Address suggestions could not be reached. You can still type the address.";
const NO_MATCH = "No matching addresses. You can type the address yourself.";
const RECOGNIZED = "Recognized street address. Mail delivery was not checked.";
const CONFIRM =
  "Suggestion selected. Confirm the house number, city, state, and ZIP.";

export function canonToken(raw: string): string {
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!cleaned) return "";
  const mapped = WORD[cleaned];
  if (mapped) return mapped;
  const ordinal = cleaned.match(/^(\d+)(st|nd|rd|th)$/);
  if (ordinal) return ordinal[1];
  return cleaned;
}

export function splitUnit(street: string): { line: string; unit: string | null } {
  const trimmed = street.trim();
  const match = trimmed.match(UNIT_RE);
  if (!match || match.index == null) return { line: trimmed, unit: null };
  return {
    line: trimmed.slice(0, match.index).replace(/[\s,]+$/, ""),
    unit: match[1].replace(/\s+/g, " ").trim(),
  };
}

/**
 * Apply a suggestion to what was typed.
 * A house number or unit the employee already entered is kept when the
 * suggestion does not include one. A typed unit is never replaced.
 */
export function fillStreet(
  resolvedStreet: string,
  subpremise: string | null | undefined,
  typedStreet: string,
): string {
  const typed = splitUnit(typedStreet);
  const resolved = splitUnit(resolvedStreet);
  let base = resolved.line || resolvedStreet.trim();
  const typedNumber = parseAddressQuery(typed.line).number;
  const resolvedNumber = parseAddressQuery(base).number;
  if (typedNumber != null && resolvedNumber == null && base) {
    base = `${typedNumber} ${base}`;
  }
  return mergeStreetUnit(base, subpremise, typedStreet);
}

/** Keep a unit the employee already typed. Never replace it with a different one. */
export function mergeStreetUnit(
  resolvedStreet: string,
  subpremise: string | null | undefined,
  typedStreet: string,
): string {
  const typed = splitUnit(typedStreet);
  const base = splitUnit(resolvedStreet).line || resolvedStreet.trim();
  if (!base) return typed.unit ? typedStreet.trim() : "";
  if (typed.unit) return `${base} ${typed.unit}`.trim();
  const sub = (subpremise ?? "").trim();
  if (!sub) return base;
  if (/^(apt|apartment|suite|ste|unit|#|bldg|building|fl|floor)\b/i.test(sub)) {
    return `${base} ${sub}`.trim();
  }
  return `${base} Apt ${sub}`.trim();
}

export function parseAddressQuery(input: string): {
  number: number | null;
  tokens: string[];
  unit: string | null;
} {
  const { line, unit } = splitUnit(input.trim());
  const bits = line.split(/[\s,]+/).filter(Boolean);
  let number: number | null = null;
  const tokens: string[] = [];
  bits.forEach((bit, index) => {
    if (index === 0 && /^\d+[a-zA-Z-]*$/.test(bit)) {
      const parsed = Number.parseInt(bit, 10);
      if (parsed > 0) number = parsed;
      return;
    }
    const token = canonToken(bit);
    if (token) tokens.push(token);
  });
  return { number, tokens, unit };
}

export function addressServiceError(status: string | null | undefined): string | null {
  switch ((status ?? "").trim().toUpperCase()) {
    case "":
    case "OK":
    case "ZERO_RESULTS":
    case "INVALID_REQUEST":
      return null;
    case "REQUEST_DENIED":
    case "PERMISSION_DENIED":
      return "Address suggestions are unavailable because the maps service denied the request. You can still type the address.";
    case "OVER_QUERY_LIMIT":
    case "RESOURCE_EXHAUSTED":
      return "Address suggestions are temporarily unavailable because the lookup limit was reached. You can still type the address.";
    default:
      return UNREACHABLE;
  }
}

export function legacyAutocompleteQuery(input: string): string {
  const params = new URLSearchParams({
    input,
    types: "address",
    components: "country:us",
    language: "en",
    location: `${NORTHEAST_OHIO.lat},${NORTHEAST_OHIO.lng}`,
    radius: String(NORTHEAST_OHIO.radiusMeters),
  });
  return params.toString();
}

export function placesAutocompleteBody(input: string): {
  input: string;
  includedRegionCodes: string[];
  includedPrimaryTypes: string[];
  languageCode: string;
  locationBias: {
    circle: { center: { latitude: number; longitude: number }; radius: number };
  };
} {
  return {
    input,
    includedRegionCodes: ["us"],
    includedPrimaryTypes: ["street_address", "premise", "subpremise"],
    languageCode: "en",
    locationBias: {
      circle: {
        center: { latitude: NORTHEAST_OHIO.lat, longitude: NORTHEAST_OHIO.lng },
        radius: NORTHEAST_OHIO.radiusMeters,
      },
    },
  };
}

function componentText(component: Component, short: boolean): string {
  if (short) return component.shortText || component.short_name || component.longText || component.long_name || "";
  return component.longText || component.long_name || component.shortText || component.short_name || "";
}

export function partsFromComponents(components: Component[]): AddressParts {
  const get = (type: string, short = false) => {
    const found = components.find((component) => component.types?.includes(type));
    return found ? componentText(found, short) : "";
  };
  const zip = get("postal_code");
  const suffix = get("postal_code_suffix");
  return {
    street: [get("street_number"), get("route")].filter(Boolean).join(" "),
    subpremise: get("subpremise"),
    city:
      get("locality") ||
      get("postal_town") ||
      get("sublocality") ||
      get("administrative_area_level_3") ||
      get("neighborhood"),
    state: get("administrative_area_level_1", true),
    zip: zip && suffix ? `${zip}-${suffix}` : zip,
  };
}

/** Best-effort split of a Google prediction label. Fields stay blank when it does not fit. */
export function partsFromDescription(description: string): AddressParts {
  const match = description
    .trim()
    .match(/^(.+?),\s*([^,]+),\s*([A-Za-z]{2})(?:\s+(\d{5}(?:-\d{4})?))?(?:,\s*(?:USA|United States))?$/i);
  if (!match) {
    return { street: description.split(",")[0]?.trim() ?? "", subpremise: "", city: "", state: "", zip: "" };
  }
  return {
    street: match[1].trim(),
    subpremise: "",
    city: match[2].trim(),
    state: match[3].toUpperCase(),
    zip: match[4] ?? "",
  };
}

export function noteForDelivery(input: {
  recognized: boolean;
  deliverable: boolean | null;
  dpv?: string | null;
}): string {
  const dpv = (input.dpv ?? "").toUpperCase();
  if (dpv === "Y") return "Deliverable address.";
  if (dpv === "D") return "The street is deliverable. Add the apartment or suite if there is one.";
  if (dpv === "S") return "The street is recognized. Check the apartment or suite.";
  if (dpv === "N" || input.deliverable === false) {
    return "This address was not confirmed as deliverable. You can still save it.";
  }
  if (input.deliverable === true) return "Deliverable address.";
  if (input.recognized) return RECOGNIZED;
  return CONFIRM;
}

export function deliverableFromDpv(code: string | null | undefined): boolean | null {
  switch ((code ?? "").toUpperCase()) {
    case "Y":
      return true;
    case "N":
      return false;
    default:
      return null;
  }
}

export function localPlaceId(parts: {
  street: string;
  city: string;
  state: string;
  zip: string;
  recognized: boolean;
}): string {
  return `local:${encodeURIComponent(JSON.stringify(parts))}`;
}

export function readLocalPlaceId(placeId: string): {
  street: string;
  city: string;
  state: string;
  zip: string;
  recognized: boolean;
} | null {
  if (!placeId.startsWith("local:")) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(placeId.slice("local:".length))) as {
      street?: string;
      city?: string;
      state?: string;
      zip?: string;
      recognized?: boolean;
    };
    if (!parsed.street || !parsed.city || !parsed.state) return null;
    return {
      street: parsed.street,
      city: parsed.city,
      state: parsed.state,
      zip: parsed.zip ?? "",
      recognized: Boolean(parsed.recognized),
    };
  } catch {
    return null;
  }
}

function keysFor(token: string): string[] {
  if (token.length <= 3) return [token];
  const keys: string[] = [];
  for (let size = 3; size <= token.length; size += 1) keys.push(token.slice(0, size));
  return keys;
}

export function prepareAddressIndex(raw: AddressIndex): PreparedIndex {
  const ranges: Range[] = [];
  const postings = new Map<string, number[]>();
  for (const [name, from, to, zip] of raw.r) {
    const place = raw.z[zip];
    if (!place) continue;
    const [city, lat, lng] = place;
    const tokens = name
      .split(/[^A-Za-z0-9]+/)
      .map(canonToken)
      .filter(Boolean);
    const index = ranges.length;
    const parity: -1 | 0 | 1 = from % 2 === to % 2 ? ((from % 2) as 0 | 1) : -1;
    ranges.push({ name, from, to, zip, city, lat, lng, tokens, parity });
    const seen = new Set<string>();
    for (const token of tokens) {
      for (const key of keysFor(token)) {
        if (seen.has(key)) continue;
        seen.add(key);
        const list = postings.get(key);
        if (list) list.push(index);
        else postings.set(key, [index]);
      }
    }
  }
  return { ranges, postings };
}

function milesFromCleveland(lat: number, lng: number): number {
  const dlat = (lat - NORTHEAST_OHIO.lat) * 69;
  const dlng = (lng - NORTHEAST_OHIO.lng) * 53;
  return Math.hypot(dlat, dlng);
}

function inRange(range: Range, number: number): boolean {
  if (number < range.from || number > range.to) return false;
  if (range.parity === -1) return true;
  return number % 2 === range.parity;
}

function tokenFit(token: string, range: Range): "street" | "city" | "zip" | "skip" | "no" {
  if (token === "oh" || token === "ohio" || token === "usa" || token === "unitedstates") return "skip";
  if (/^\d{5}$/.test(token)) return token === range.zip ? "zip" : "no";
  if (range.tokens.some((street) => street === token || (token.length >= 2 && street.startsWith(token)))) {
    return "street";
  }
  const cityTokens = range.city.split(/[^A-Za-z0-9]+/).map(canonToken).filter(Boolean);
  if (cityTokens.some((city) => city === token || (token.length >= 3 && city.startsWith(token)))) {
    return "city";
  }
  return "no";
}

type Hit = Range & { miles: number; numberInRange: boolean; numberDistance: number };

export function searchAddressIndex(prepared: PreparedIndex, input: string, limit = 8): AddressSuggestion[] {
  const query = parseAddressQuery(input);
  if (query.tokens.length === 0) return [];
  const lists = query.tokens
    .map((token) => prepared.postings.get(token))
    .filter((list): list is number[] => Boolean(list && list.length));
  if (lists.length === 0) return [];
  lists.sort((a, b) => a.length - b.length);
  const seen = new Set<number>();
  const hits: Hit[] = [];
  for (const index of lists[0]) {
    if (seen.has(index)) continue;
    seen.add(index);
    const range = prepared.ranges[index];
    let streetHits = 0;
    let rejected = false;
    for (const token of query.tokens) {
      const kind = tokenFit(token, range);
      if (kind === "no") {
        rejected = true;
        break;
      }
      if (kind === "street") streetHits += 1;
    }
    if (rejected || streetHits === 0) continue;
    const numberInRange = query.number != null && inRange(range, query.number);
    let numberDistance = 0;
    if (query.number != null) {
      if (query.number < range.from) numberDistance = range.from - query.number;
      else if (query.number > range.to) numberDistance = query.number - range.to;
    }
    hits.push({
      ...range,
      miles: milesFromCleveland(range.lat, range.lng),
      numberInRange,
      numberDistance,
    });
  }
  if (hits.length === 0) return [];
  const best = Math.min(...hits.map((hit) => hit.miles));
  const near = hits.filter((hit) => hit.miles <= best + 12);
  near.sort((a, b) => a.miles - b.miles || a.numberDistance - b.numberDistance || a.name.localeCompare(b.name));

  const deduped = new Map<string, Hit>();
  for (const hit of near) {
    const key = hit.numberInRange
      ? `${hit.name}|${hit.city}|${hit.zip}|1`
      : `${hit.name}|${hit.city}|0`;
    const prev = deduped.get(key);
    if (!prev || hit.numberDistance < prev.numberDistance || (hit.numberDistance === prev.numberDistance && hit.miles < prev.miles)) {
      deduped.set(key, hit);
    }
  }
  return [...deduped.values()]
    .sort((a, b) => a.miles - b.miles || Number(b.numberInRange) - Number(a.numberInRange) || a.numberDistance - b.numberDistance)
    .slice(0, limit)
    .map((hit) => {
      const recognized = query.number != null && hit.numberInRange;
      const street = query.number != null ? `${query.number} ${hit.name}` : hit.name;
      const state = "OH";
      return {
        description: `${street}, ${hit.city}, ${state} ${hit.zip}`,
        placeId: localPlaceId({ street, city: hit.city, state, zip: hit.zip, recognized }),
        street,
        city: hit.city,
        state,
        zip: hit.zip,
        recognized,
        hint: recognized ? RECOGNIZED : CONFIRM,
      };
    });
}

export async function resolveAddressLookup(
  input: string,
  deps: {
    google: (() => Promise<{ suggestions: AddressSuggestion[]; error: string | null }>) | null;
    local: () => AddressSuggestion[];
  },
): Promise<AddressLookup> {
  const q = input.trim();
  if (q.length < 3) return { suggestions: [], error: null, notice: null };
  if (deps.google) {
    try {
      const google = await deps.google();
      if (google.suggestions.length > 0) {
        return { suggestions: google.suggestions, error: null, notice: null };
      }
      const local = safeLocal(deps.local);
      if (local.suggestions.length > 0) {
        return {
          suggestions: local.suggestions,
          error: null,
          notice: google.error,
        };
      }
      if (google.error) return { suggestions: [], error: google.error, notice: null };
    } catch {
      const local = safeLocal(deps.local);
      if (local.suggestions.length > 0) {
        return {
          suggestions: local.suggestions,
          error: null,
          notice: "The maps service could not be reached. Showing recognized Northeast Ohio street matches instead.",
        };
      }
      return { suggestions: [], error: UNREACHABLE, notice: null };
    }
  }
  const local = safeLocal(deps.local);
  if (local.error) return { suggestions: [], error: local.error, notice: null };
  if (local.suggestions.length > 0) return { suggestions: local.suggestions, error: null, notice: null };
  return { suggestions: [], error: null, notice: NO_MATCH };
}

function safeLocal(local: () => AddressSuggestion[]): { suggestions: AddressSuggestion[]; error: string | null } {
  try {
    return { suggestions: local(), error: null };
  } catch {
    return { suggestions: [], error: UNAVAILABLE };
  }
}
