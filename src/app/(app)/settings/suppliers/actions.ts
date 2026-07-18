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
      freight_markup_pct: numv(formData.get("freight_markup_pct")),
      quote_valid_days: Math.max(0, Math.round(numv(formData.get("quote_valid_days")))),
      freight_disclaimer: str(formData.get("freight_disclaimer")) || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", "default");
  if (error) return { error: error.message };
  revalidatePath("/settings/suppliers");
  return { error: null, ok: true };
}

/**
 * Set the next PO number to be issued. Can only move FORWARD past the highest
 * number already used, so an issued number is never reused or overwritten.
 */
export async function setPoNextNumber(
  _prev: PricingState,
  formData: FormData,
): Promise<PricingState> {
  const n = Math.round(numv(formData.get("next_number")));
  if (!Number.isFinite(n) || n < 1) return { error: "Enter a valid starting number." };
  const supabase = await createClient();
  const { data: mx } = await supabase
    .from("purchase_orders")
    .select("po_number")
    .order("po_number", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  const maxIssued = Number(mx?.po_number) || 0;
  if (n <= maxIssued) {
    return {
      error: `Next number must be greater than the highest issued PO (PO-${maxIssued}).`,
    };
  }
  const { error } = await supabase
    .from("po_counter")
    .update({ next_number: n, updated_at: new Date().toISOString() })
    .eq("id", "default");
  if (error) return { error: error.message };
  revalidatePath("/settings/suppliers");
  return { error: null, ok: true };
}

function supplierKind(v: FormDataEntryValue | null): "manufacturer" | "distributor" {
  return str(v) === "manufacturer" ? "manufacturer" : "distributor";
}

/** The full AP vendor record read from a form (used by add + edit). */
function vendorFields(formData: FormData) {
  return {
    name: str(formData.get("name")),
    kind: supplierKind(formData.get("kind")),
    contact_name: str(formData.get("contact_name")) || null,
    phone: str(formData.get("phone")) || null,
    email: str(formData.get("email")) || null,
    address: str(formData.get("address")) || null,
    account_number: str(formData.get("account_number")) || null,
    payment_terms: str(formData.get("payment_terms")) || null,
    freight_pct: numv(formData.get("freight_pct")),
    notes: str(formData.get("notes")) || null,
  };
}

function refreshVendors() {
  revalidatePath("/settings/suppliers");
  revalidatePath("/purchase-orders");
}

export interface VendorState {
  error: string | null;
  ok?: boolean;
  id?: string;
}

export async function addSupplier(
  _prev: VendorState,
  formData: FormData,
): Promise<VendorState> {
  const fields = vendorFields(formData);
  if (!fields.name) return { error: "Give the vendor a name." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("suppliers")
    .insert({ ...fields, active: true })
    .select("id")
    .single();
  if (error) return { error: error.message };
  refreshVendors();
  return { error: null, ok: true, id: data?.id as string };
}

/**
 * Create a vendor inline (from the PO builder's “＋ New vendor”) and return its
 * id so it can be selected immediately — vendors stay real records, never typed.
 */
export async function createVendorInline(
  name: string,
  kind: "manufacturer" | "distributor" = "distributor",
): Promise<{ id: string | null; error: string | null }> {
  const clean = name.trim();
  if (!clean) return { id: null, error: "Enter a vendor name." };
  const supabase = await createClient();
  // Reuse an existing record with the same name (case-insensitive) so a quick
  // add can't create a duplicate spelling.
  const { data: existing } = await supabase
    .from("suppliers")
    .select("id")
    .ilike("name", clean)
    .maybeSingle();
  if (existing) {
    await supabase.from("suppliers").update({ active: true }).eq("id", existing.id);
    refreshVendors();
    return { id: existing.id as string, error: null };
  }
  const { data, error } = await supabase
    .from("suppliers")
    .insert({ name: clean, kind, active: true })
    .select("id")
    .single();
  if (error) return { id: null, error: error.message };
  refreshVendors();
  return { id: (data?.id as string) ?? null, error: null };
}

export async function updateSupplier(
  _prev: VendorState,
  formData: FormData,
): Promise<VendorState> {
  const id = str(formData.get("id"));
  if (!id) return { error: "Missing vendor." };
  const fields = vendorFields(formData);
  if (!fields.name) return { error: "Name can't be empty." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("suppliers")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };
  refreshVendors();
  return { error: null, ok: true };
}

/**
 * Deactivate / reactivate a vendor. We NEVER delete — a vendor is tied to PO
 * history that must stay intact. Deactivating just hides it from the pickers.
 */
export async function setSupplierActive(id: string, active: boolean): Promise<void> {
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("suppliers").update({ active }).eq("id", id);
  refreshVendors();
}
