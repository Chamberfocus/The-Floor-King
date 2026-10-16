/**
 * Customer address autocomplete.
 * Ranking, unit handling, and outage copy are covered here so a missing maps
 * key cannot silently hide suggestions again. The Northeast Ohio index is the
 * Census street-range file shipped with the app; these tests do not call Google.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { localAddressSuggestions } from "@/lib/address-index";
import {
  addressServiceError,
  fillStreet,
  legacyAutocompleteQuery,
  noteForDelivery,
  partsFromComponents,
  partsFromDescription,
  prepareAddressIndex,
  resolveAddressLookup,
  searchAddressIndex,
  splitUnit,
  type AddressSuggestion,
} from "@/lib/address-suggest";

const fields = readFileSync("src/app/(app)/customers/address-fields.tsx", "utf8");
const actions = readFileSync("src/app/(app)/customers/property-actions.ts", "utf8");
const sources = readFileSync("src/app/(app)/customers/source-fields.tsx", "utf8");

const sample = prepareAddressIndex({
  v: 1,
  z: {
    "44103": ["Cleveland", 41.51632, -81.64291],
    "44113": ["Cleveland", 41.48324, -81.69717],
    "44003": ["Andover", 41.618, -80.572],
  },
  r: [
    ["Euclid Ave", 4100, 4598, "44103"],
    ["Euclid Ave", 4001, 8399, "44103"],
    ["Public Sq", 1, 99, "44113"],
    ["Public Sq", 2, 98, "44003"],
  ],
});

describe("address autocomplete", () => {
  it("keeps a typed apartment and does not replace it", () => {
    expect(splitUnit("4500 Euclid Ave Apt 4B")).toEqual({
      line: "4500 Euclid Ave",
      unit: "Apt 4B",
    });
    expect(fillStreet("4500 Euclid Ave", "9", "4500 Euclid Ave Apt 4B")).toBe(
      "4500 Euclid Ave Apt 4B",
    );
    expect(fillStreet("4500 Euclid Ave", "4B", "4500 Euclid Ave")).toBe("4500 Euclid Ave Apt 4B");
    expect(fillStreet("Public Sq", null, "50 Public Sq #2")).toBe("50 Public Sq #2");
  });

  it("biases US street lookup to Northeast Ohio and never puts the key in the query", () => {
    const query = legacyAutocompleteQuery("4500 Euclid");
    expect(query).toContain("components=country%3Aus");
    expect(query).toContain("41.4993");
    expect(query).toContain("-81.6944");
    expect(query).not.toContain("key=");
  });

  it("reads street, city, state, ZIP, and unit from provider components", () => {
    const parts = partsFromComponents([
      { long_name: "4500", short_name: "4500", types: ["street_number"] },
      { long_name: "Euclid Avenue", short_name: "Euclid Ave", types: ["route"] },
      { long_name: "4B", short_name: "4B", types: ["subpremise"] },
      { long_name: "Cleveland", short_name: "Cleveland", types: ["locality", "political"] },
      { long_name: "Ohio", short_name: "OH", types: ["administrative_area_level_1", "political"] },
      { long_name: "44103", short_name: "44103", types: ["postal_code"] },
    ]);
    expect(parts).toMatchObject({
      street: "4500 Euclid Avenue",
      subpremise: "4B",
      city: "Cleveland",
      state: "OH",
      zip: "44103",
    });
    expect(partsFromDescription("4500 Euclid Ave, Cleveland, OH 44103, USA")).toMatchObject({
      street: "4500 Euclid Ave",
      city: "Cleveland",
      state: "OH",
      zip: "44103",
    });
  });

  it("distinguishes a recognized street from a deliverable address", () => {
    expect(noteForDelivery({ recognized: true, deliverable: null })).toMatch(/not checked/i);
    expect(noteForDelivery({ recognized: true, deliverable: true, dpv: "Y" })).toBe("Deliverable address.");
    expect(noteForDelivery({ recognized: true, deliverable: null, dpv: "D" })).toMatch(/apartment or suite/i);
    expect(noteForDelivery({ recognized: false, deliverable: false, dpv: "N" })).toMatch(/not confirmed/i);
    expect(noteForDelivery({ recognized: false, deliverable: null })).toMatch(/confirm/i);
  });

  it("says when the maps service is denied or down, without echoing a key", () => {
    expect(addressServiceError("REQUEST_DENIED")).toMatch(/denied/i);
    expect(addressServiceError("OVER_QUERY_LIMIT")).toMatch(/limit/i);
    expect(addressServiceError("ZERO_RESULTS")).toBeNull();
    expect(addressServiceError("REQUEST_DENIED")).not.toMatch(/AIza|key=/i);
  });

  it("ranks a Cleveland street ahead of the same name far outside the metro", () => {
    const hits = searchAddressIndex(sample, "50 Public Sq");
    expect(hits[0]).toMatchObject({
      street: "50 Public Sq",
      city: "Cleveland",
      state: "OH",
      zip: "44113",
      recognized: false,
    });
    expect(hits.some((hit) => hit.city === "Andover")).toBe(false);
  });

  it("recognizes an even Cleveland range and an odd one, and keeps the unit out of the search", () => {
    const even = searchAddressIndex(sample, "4500 Euclid Ave Apt 4B");
    expect(even[0]).toMatchObject({
      street: "4500 Euclid Ave",
      city: "Cleveland",
      state: "OH",
      zip: "44103",
      recognized: true,
    });
    const odd = searchAddressIndex(sample, "4601 Euclid");
    expect(odd[0]).toMatchObject({ zip: "44103", recognized: true, street: "4601 Euclid Ave" });
    const wrongSide = searchAddressIndex(sample, "4600 Euclid");
    expect(wrongSide[0]).toMatchObject({ city: "Cleveland", zip: "44103", recognized: false });
  });

  it("shows a clear error when no address source is available and local matches when maps fail", async () => {
    const down = await resolveAddressLookup("4500 Euclid", {
      google: null,
      local: () => {
        throw new Error("missing index");
      },
    });
    expect(down.suggestions).toEqual([]);
    expect(down.error).toMatch(/not available/i);

    const fallback = await resolveAddressLookup("4500 Euclid", {
      google: async () => ({ suggestions: [], error: "Address suggestions are unavailable because the maps service denied the request. You can still type the address." }),
      local: () => searchAddressIndex(sample, "4500 Euclid"),
    });
    expect(fallback.error).toBeNull();
    expect(fallback.suggestions[0]?.city).toBe("Cleveland");
    expect(fallback.notice).toMatch(/denied/i);

    const live = await resolveAddressLookup("4500 Euclid", {
      google: async () => ({
        suggestions: [
          {
            description: "4500 Euclid Ave, Cleveland, OH 44103, USA",
            placeId: "google-1",
            street: "4500 Euclid Ave",
            city: "Cleveland",
            state: "OH",
            zip: "44103",
            recognized: false,
            hint: "Suggestion selected. Delivery is checked after you choose it.",
          } satisfies AddressSuggestion,
        ],
        error: null,
      }),
      local: () => [],
    });
    expect(live.suggestions[0]?.placeId).toBe("google-1");
    expect(live.notice).toBeNull();
  });

  it("finds a real Northeast Ohio address in the shipped street index", () => {
    const hits = localAddressSuggestions("4500 Euclid Ave");
    expect(hits[0]).toMatchObject({
      street: "4500 Euclid Ave",
      city: "Cleveland",
      state: "OH",
      zip: "44103",
      recognized: true,
    });
    const downtown = localAddressSuggestions("50 Public Square");
    expect(downtown[0]?.city).toBe("Cleveland");
    expect(downtown[0]?.state).toBe("OH");
    expect(downtown[0]?.zip).toBe("44113");
  });

  it("keeps suggestion taps working inside a card and does not change the referral picker", () => {
    expect(fields).toContain("onMouseDown={(e) => e.preventDefault()}");
    expect(fields).toContain('role="alert"');
    expect(fields).toContain('name="street"');
    expect(fields).toContain('name="city"');
    expect(fields).toContain('name="state"');
    expect(fields).toContain('name="zip"');
    expect(fields).not.toContain("absolute ");
    expect(fields).not.toContain("GOOGLE_MAPS_API_KEY");
    expect(actions).toContain("maps.googleapis.com");
    expect(actions).toContain("addressvalidation.googleapis.com");
    expect(actions).not.toContain("NEXT_PUBLIC_GOOGLE_MAPS_KEY");
    expect(sources).toContain("SearchPicker");
    expect(sources).toContain('name="source_id"');
  });
});
