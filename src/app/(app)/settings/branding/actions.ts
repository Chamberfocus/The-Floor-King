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
    financing_url: str(formData.get("financing_url")) || null,
    google_review_url: str(formData.get("google_review_url")) || null,
    updated_at: new Date().toISOString(),
  };
  const logoUrl = str(formData.get("logo_url"));
  if (logoUrl) update.logo_url = logoUrl;

  const { error } = await supabase
    .from("org_settings")
    .update(update)
    .eq("id", "default");
  if (error) return { error: error.message };

  revalidatePath("/settings/branding");
  revalidatePath("/", "layout");
  return { error: null, ok: true };
}
