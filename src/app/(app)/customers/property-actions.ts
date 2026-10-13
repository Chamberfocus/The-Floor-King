"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { employeeDbError } from "@/lib/employee-error";
import { localAddressSuggestions } from "@/lib/address-index";
import type { AddressLookup, AddressSuggestion, ResolvedAddress } from "@/lib/address-suggest";
import {
  addressServiceError,
  deliverableFromDpv,
  legacyAutocompleteQuery,
  fillStreet,
  noteForDelivery,
  partsFromComponents,
  partsFromDescription,
  placesAutocompleteBody,
  readLocalPlaceId,
  resolveAddressLookup,
} from "@/lib/address-suggest";

const GOOGLE = () => process.env.GOOGLE_MAPS_API_KEY;
const RENTCAST = () => process.env.RENTCAST_API_KEY;

export interface AddressDetails {
  street: string;
  city: string;
  state: string;
  zip: string;
  subpremise: string;
  lat: number | null;
  lng: number | null;
  recognized: boolean;
  deliverable: boolean | null;
  deliveryNote: string;
}

/**
 * Street suggestions. Google Places is used when a server-only maps key is
 * configured. Otherwise Northeast Ohio street ranges are matched on this
 * server — the typed address is not sent to another company.
 */
export async function addressSuggestions(input: string): Promise<AddressLookup> {
  const key = GOOGLE();
  return resolveAddressLookup(input, {
    google: key ? () => googleSuggestions(key, input) : null,
    local: () => localAddressSuggestions(input),
  });
}

/** Resolve a picked suggestion. A typed apartment/suite is kept. */
export async function addressDetails(
  placeId: string,
  typedStreet = "",
): Promise<AddressDetails | null> {
  const local = readLocalPlaceId(placeId);
  if (local) {
    const street = fillStreet(local.street, null, typedStreet);
    return {
      street,
      city: local.city,
      state: local.state,
      zip: local.zip,
      subpremise: "",
      lat: null,
      lng: null,
      recognized: local.recognized,
      deliverable: null,
      deliveryNote: noteForDelivery({ recognized: local.recognized, deliverable: null }),
    };
  }
  const key = GOOGLE();
  if (!key || !placeId) return null;
  try {
    const resolved = await googleDetails(key, placeId);
    if (!resolved) return null;
    const checked = await googleDeliveryCheck(
      key,
      fillStreet(resolved.street, resolved.subpremise, typedStreet),
      resolved,
    );
    const street = fillStreet(checked.street || resolved.street, checked.subpremise || resolved.subpremise, typedStreet);
    return { ...checked, street };
  } catch {
    return null;
  }
}

async function googleSuggestions(
  key: string,
  input: string,
): Promise<{ suggestions: AddressSuggestion[]; error: string | null }> {
  const legacy = await legacySuggestions(key, input);
  if (legacy.suggestions.length > 0 || !legacy.denied) return legacy;
  return placesNewSuggestions(key, input);
}

async function legacySuggestions(
  key: string,
  input: string,
): Promise<{ suggestions: AddressSuggestion[]; error: string | null; denied: boolean }> {
  const url =
    "https://maps.googleapis.com/maps/api/place/autocomplete/json" +
    `?${legacyAutocompleteQuery(input)}&key=${encodeURIComponent(key)}`;
  const res = await fetch(url, { cache: "no-store" });
  const data = (await res.json()) as {
    status?: string;
    predictions?: { description: string; place_id: string }[];
  };
  const error = addressServiceError(data.status);
  const suggestions = (data.predictions ?? []).map((prediction) =>
    suggestionFromDescription(prediction.description, prediction.place_id),
  );
  return { suggestions, error, denied: data.status === "REQUEST_DENIED" };
}

async function placesNewSuggestions(
  key: string,
  input: string,
): Promise<{ suggestions: AddressSuggestion[]; error: string | null }> {
  const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
    },
    body: JSON.stringify(placesAutocompleteBody(input)),
  });
  if (!res.ok) {
    const status = res.status === 403 ? "REQUEST_DENIED" : res.status === 429 ? "OVER_QUERY_LIMIT" : "UNKNOWN";
    return { suggestions: [], error: addressServiceError(status) };
  }
  const data = (await res.json()) as {
    suggestions?: { placePrediction?: { placeId?: string; text?: { text?: string } } }[];
  };
  const suggestions = (data.suggestions ?? [])
    .map((row) => {
      const prediction = row.placePrediction;
      const description = prediction?.text?.text ?? "";
      const placeId = prediction?.placeId ?? "";
      if (!description || !placeId) return null;
      return suggestionFromDescription(description, placeId);
    })
    .filter((row): row is AddressSuggestion => row != null);
  return { suggestions, error: null };
}

function suggestionFromDescription(description: string, placeId: string): AddressSuggestion {
  const parts = partsFromDescription(description);
  return {
    description,
    placeId,
    street: parts.street,
    city: parts.city,
    state: parts.state,
    zip: parts.zip,
    recognized: false,
    hint: "Suggestion selected. Delivery is checked after you choose it.",
  };
}

async function googleDetails(key: string, placeId: string): Promise<ResolvedAddress | null> {
  const legacy = await legacyDetails(key, placeId);
  if (legacy) return legacy;
  return placesNewDetails(key, placeId);
}

async function legacyDetails(key: string, placeId: string): Promise<ResolvedAddress | null> {
  const url =
    "https://maps.googleapis.com/maps/api/place/details/json" +
    `?place_id=${encodeURIComponent(placeId)}&fields=address_component,geometry&key=${encodeURIComponent(key)}`;
  const res = await fetch(url, { cache: "no-store" });
  const data = (await res.json()) as {
    status?: string;
    result?: {
      address_components?: { long_name: string; short_name: string; types: string[] }[];
      geometry?: { location?: { lat: number; lng: number } };
    };
  };
  if (data.status && data.status !== "OK") return null;
  const parts = partsFromComponents(data.result?.address_components ?? []);
  if (!parts.street && !parts.city) return null;
  return {
    ...parts,
    lat: data.result?.geometry?.location?.lat ?? null,
    lng: data.result?.geometry?.location?.lng ?? null,
    recognized: true,
    deliverable: null,
    deliveryNote: noteForDelivery({ recognized: true, deliverable: null }),
  };
}

async function placesNewDetails(key: string, placeId: string): Promise<ResolvedAddress | null> {
  const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    cache: "no-store",
    headers: {
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "addressComponents,location",
    },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    addressComponents?: { longText?: string; shortText?: string; types?: string[] }[];
    location?: { latitude?: number; longitude?: number };
  };
  const parts = partsFromComponents(data.addressComponents ?? []);
  if (!parts.street && !parts.city) return null;
  return {
    ...parts,
    lat: data.location?.latitude ?? null,
    lng: data.location?.longitude ?? null,
    recognized: true,
    deliverable: null,
    deliveryNote: noteForDelivery({ recognized: true, deliverable: null }),
  };
}

async function googleDeliveryCheck(
  key: string,
  line: string,
  resolved: ResolvedAddress,
): Promise<ResolvedAddress> {
  try {
    const res = await fetch("https://addressvalidation.googleapis.com/v1:validateAddress", {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
      },
      body: JSON.stringify({
        address: {
          regionCode: "US",
          addressLines: [line],
          locality: resolved.city,
          administrativeArea: resolved.state,
          postalCode: resolved.zip,
        },
      }),
    });
    if (!res.ok) return resolved;
    const data = (await res.json()) as {
      result?: {
        verdict?: { addressComplete?: boolean };
        uspsData?: { dpvConfirmation?: string };
      };
    };
    const dpv = data.result?.uspsData?.dpvConfirmation ?? null;
    const deliverable = deliverableFromDpv(dpv);
    const recognized = resolved.recognized || Boolean(data.result?.verdict?.addressComplete);
    return {
      ...resolved,
      recognized,
      deliverable,
      deliveryNote: noteForDelivery({ recognized, deliverable, dpv }),
    };
  } catch {
    return resolved;
  }
}

/** Look up the customer's home value + details (RentCast) and cache them. */
export async function lookupCustomerProperty(
  customerId: string,
): Promise<{ error: string | null }> {
  if (!customerId) return { error: "Missing customer." };
  const key = RENTCAST();
  if (!key) return { error: "Property data isn't set up (RENTCAST_API_KEY)." };

  const supabase = await createClient();
  const { data: c } = await supabase
    .from("customers")
    .select("street, city, state, zip, latitude, longitude")
    .eq("id", customerId)
    .maybeSingle();
  if (!c?.street) return { error: "Add a street address first." };
  const address = [c.street, c.city, c.state, c.zip].filter(Boolean).join(", ");
  const headers = { "X-Api-Key": key, Accept: "application/json" };

  const patch: Record<string, unknown> = {
    property_checked_at: new Date().toISOString(),
  };
  try {
    // Property characteristics.
    const pRes = await fetch(
      `https://api.rentcast.io/v1/properties?address=${encodeURIComponent(address)}`,
      { headers, cache: "no-store" },
    );
    const pData = (await pRes.json()) as
      | { bedrooms?: number; bathrooms?: number; squareFootage?: number; yearBuilt?: number; propertyType?: string; latitude?: number; longitude?: number }[]
      | { bedrooms?: number; bathrooms?: number; squareFootage?: number; yearBuilt?: number; propertyType?: string; latitude?: number; longitude?: number };
    const p = Array.isArray(pData) ? pData[0] : pData;
    if (p) {
      if (p.bedrooms != null) patch.property_beds = Math.round(p.bedrooms);
      if (p.bathrooms != null) patch.property_baths = p.bathrooms;
      if (p.squareFootage != null) patch.property_sqft = Math.round(p.squareFootage);
      if (p.yearBuilt != null) patch.property_year = Math.round(p.yearBuilt);
      if (p.propertyType) patch.property_type = String(p.propertyType);
      if (p.latitude != null) patch.latitude = p.latitude;
      if (p.longitude != null) patch.longitude = p.longitude;
    }
  } catch {
    /* details optional */
  }
  try {
    // Estimated value (AVM).
    const vRes = await fetch(
      `https://api.rentcast.io/v1/avm/value?address=${encodeURIComponent(address)}`,
      { headers, cache: "no-store" },
    );
    const vData = (await vRes.json()) as { price?: number };
    if (vData?.price != null) patch.property_value = Math.round(vData.price);
  } catch {
    /* value optional */
  }

  if (patch.property_value == null && patch.property_sqft == null) {
    await supabase.from("customers").update(patch).eq("id", customerId);
    return { error: "No property record found for that address." };
  }
  const { error } = await supabase.from("customers").update(patch).eq("id", customerId);
  if (error) {
    console.error("[savePropertyLookup]", error.code);
    return {
      error: employeeDbError(error.message, "This property could not be saved. Refresh and try again."),
    };
  }
  revalidatePath(`/customers/${customerId}`);
  return { error: null };
}
