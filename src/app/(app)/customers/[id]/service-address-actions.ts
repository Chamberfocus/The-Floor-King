"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function addServiceAddress(formData: FormData): Promise<void> {
  const customerId = str(formData.get("customer_id"));
  if (!customerId) return;
  // Need at least a label or a street so we don't create blank rows.
  const label = str(formData.get("label"));
  const street = str(formData.get("street"));
  if (!label && !street) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await supabase.from("service_addresses").insert({
    customer_id: customerId,
    label: label || null,
    street: street || null,
    city: str(formData.get("city")) || null,
    state: str(formData.get("state")) || null,
    zip: str(formData.get("zip")) || null,
    notes: str(formData.get("notes")) || null,
    created_by: user?.id ?? null,
  });
  revalidatePath(`/customers/${customerId}`);
}

export async function updateServiceAddress(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  const customerId = str(formData.get("customer_id"));
  if (!id) return;
  const supabase = await createClient();
  await supabase
    .from("service_addresses")
    .update({
      label: str(formData.get("label")) || null,
      street: str(formData.get("street")) || null,
      city: str(formData.get("city")) || null,
      state: str(formData.get("state")) || null,
      zip: str(formData.get("zip")) || null,
      notes: str(formData.get("notes")) || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (customerId) revalidatePath(`/customers/${customerId}`);
}

export async function deleteServiceAddress(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  const customerId = str(formData.get("customer_id"));
  if (!id) return;
  const supabase = await createClient();
  // Jobs/estimates referencing it are set-null by the FK; they keep their
  // copied site_* fields, so nothing loses its address.
  await supabase.from("service_addresses").delete().eq("id", id);
  if (customerId) revalidatePath(`/customers/${customerId}`);
}
