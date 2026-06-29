"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const GOOGLE = () => process.env.GOOGLE_MAPS_API_KEY;
const RENTCAST = () => process.env.RENTCAST_API_KEY;

export interface AddressSuggestion {
  description: string;
  placeId: string;
}
export interface AddressDetails {
  street: string;
  city: string;
  state: string;
  zip: string;
  lat: number | null;
  lng: number | null;
}

/** Google Places autocomplete — US street addresses. Empty list if no key. */
export async function addressSuggestions(
  input: string,
): Promise<AddressSuggestion[]> {
  const key = GOOGLE();
  const q = input.trim();
  if (!key || q.length < 3) return [];
  try {
    const url =
      "https://maps.googleapis.com/maps/api/place/autocomplete/json" +
      `?input=${encodeURIComponent(q)}&types=address&components=country:us&key=${key}`;
    const res = await fetch(url, { cache: "no-store" });
    const data = (await res.json()) as {
      predictions?: { description: string; place_id: string }[];
    };
    return (data.predictions ?? []).map((p) => ({
      description: p.description,
      placeId: p.place_id,
    }));
  } catch {
    return [];
  }
}

/** Resolve a picked place into structured address parts + lat/lng. */
export async function addressDetails(
  placeId: string,
): Promise<AddressDetails | null> {
  const key = GOOGLE();
  if (!key || !placeId) return null;
  try {
    const url =
      "https://maps.googleapis.com/maps/api/place/details/json" +
      `?place_id=${encodeURIComponent(placeId)}&fields=address_component,geometry&key=${key}`;
    const res = await fetch(url, { cache: "no-store" });
    const data = (await res.json()) as {
      result?: {
        address_components?: { long_name: string; short_name: string; types: string[] }[];
        geometry?: { location?: { lat: number; lng: number } };
      };
    };
    const comps = data.result?.address_components ?? [];
    const get = (type: string, short = false) => {
      const c = comps.find((x) => x.types.includes(type));
      return c ? (short ? c.short_name : c.long_name) : "";
    };
    const streetNo = get("street_number");
    const route = get("route");
    return {
      street: [streetNo, route].filter(Boolean).join(" "),
      city: get("locality") || get("sublocality") || get("postal_town"),
      state: get("administrative_area_level_1", true),
      zip: get("postal_code"),
      lat: data.result?.geometry?.location?.lat ?? null,
      lng: data.result?.geometry?.location?.lng ?? null,
    };
  } catch {
    return null;
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
  if (error) return { error: error.message };
  revalidatePath(`/customers/${customerId}`);
  return { error: null };
}
