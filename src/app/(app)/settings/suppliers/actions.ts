"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}
function numv(v: FormDataEntryValue | null): number {
  const n = parseFloat(str(v));
  return Number.isFinite(n) ? n : 0;
}

export interface PricingState {
  error: string | null;
  ok?: boolean;
}

/** Global fuel surcharge + quote terms (org_settings). */
export async function savePricingSettings(
  _prev: PricingState,
  formData: FormData,
): Promise<PricingState> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("org_settings")
    .update({
      fuel_surcharge_pct: numv(formData.get("fuel_surcharge_pct")),
      quote_valid_days: Math.max(0, Math.round(numv(formData.get("quote_valid_days")))),
      freight_disclaimer: str(formData.get("freight_disclaimer")) || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", "default");
  if (error) return { error: error.message };
  revalidatePath("/settings/suppliers");
  return { error: null, ok: true };
}

function supplierKind(v: FormDataEntryValue | null): "manufacturer" | "distributor" {
  return str(v) === "manufacturer" ? "manufacturer" : "distributor";
}

export async function addSupplier(formData: FormData): Promise<void> {
  const name = str(formData.get("name"));
  if (!name) return;
  const supabase = await createClient();
  await supabase.from("suppliers").insert({
    name,
    kind: supplierKind(formData.get("kind")),
    freight_pct: numv(formData.get("freight_pct")),
  });
  revalidatePath("/settings/suppliers");
  revalidatePath("/purchase-orders");
}

export async function updateSupplier(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  if (!id) return;
  const supabase = await createClient();
  await supabase
    .from("suppliers")
    .update({
      name: str(formData.get("name")),
      kind: supplierKind(formData.get("kind")),
      freight_pct: numv(formData.get("freight_pct")),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  revalidatePath("/settings/suppliers");
  revalidatePath("/purchase-orders");
}

export async function deleteSupplier(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("suppliers").delete().eq("id", id);
  revalidatePath("/settings/suppliers");
}
