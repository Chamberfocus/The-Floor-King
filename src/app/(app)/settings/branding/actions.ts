"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

export interface BrandingState {
  error: string | null;
  ok?: boolean;
}

/** Save branding. The logo is uploaded client-side; we just store its URL. */
export async function saveBranding(
  _prev: BrandingState,
  formData: FormData,
): Promise<BrandingState> {
  const supabase = await createClient();

  const update: Record<string, unknown> = {
    company_name: str(formData.get("company_name")) || "Cleveland Floor King",
    primary_color: str(formData.get("primary_color")) || null,
    phone: str(formData.get("phone")) || null,
    email: str(formData.get("email")) || null,
    address: str(formData.get("address")) || null,
    website: str(formData.get("website")) || null,
    financing_url: str(formData.get("financing_url")) || null,
    google_review_url: str(formData.get("google_review_url")) || null,
    card_processing_url: str(formData.get("card_processing_url")) || null,
    ach_destination_routing: str(formData.get("ach_destination_routing")) || null,
    ach_company_id: str(formData.get("ach_company_id")) || null,
    ach_odfi_routing: str(formData.get("ach_odfi_routing")) || null,
    ach_company_name: str(formData.get("ach_company_name")) || null,
    updated_at: new Date().toISOString(),
  };
  const logoUrl = str(formData.get("logo_url"));
  if (logoUrl) update.logo_url = logoUrl;

  let { error } = await supabase
    .from("org_settings")
    .update(update)
    .eq("id", "default");
  // Columns added by later migrations (website=0102, card_processing_url=0129, ach=0515).
  // If one hasn't run yet, drop it and retry so branding still saves.
  let achMissing = false;
  if (error && /website|card_processing_url|ach_destination_routing|ach_company_id|ach_odfi_routing|ach_company_name/i.test(error.message)) {
    achMissing = /ach_destination_routing|ach_company_id|ach_odfi_routing|ach_company_name/i.test(error.message);
    delete update.website;
    delete update.card_processing_url;
    delete update.ach_destination_routing;
    delete update.ach_company_id;
    delete update.ach_odfi_routing;
    delete update.ach_company_name;
    ({ error } = await supabase
      .from("org_settings")
      .update(update)
      .eq("id", "default"));
  }
  if (error) return { error: error.message };
  const askedAch = ["ach_destination_routing", "ach_company_id", "ach_odfi_routing", "ach_company_name"].some(
    (key) => str(formData.get(key)),
  );
  if (achMissing && askedAch) {
    return { error: "The rest of branding saved. Apply SQL 0515 in Supabase before the PNC numbers can be stored." };
  }

  revalidatePath("/settings/branding");
  revalidatePath("/", "layout");
  return { error: null, ok: true };
}
