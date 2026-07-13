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
  const street = str(formData.get("street")) || null;
  const city = str(formData.get("city")) || null;
  const state = str(formData.get("state")) || null;
  const zip = str(formData.get("zip")) || null;
  await supabase
    .from("service_addresses")
    .update({
      label: str(formData.get("label")) || null,
      street,
      city,
      state,
      zip,
      notes: str(formData.get("notes")) || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  // This is a PROJECT (job-site) address — distinct from the customer's BILLING
  // address (edited on the customer record). Correcting it should flow to the
  // jobs that use it and are still active, so the work order, staging sheet, and
  // driving list show the right place. Completed jobs keep their historical site.
  const { data: activeJobs } = await supabase
    .from("jobs")
    .select("id")
    .eq("service_address_id", id)
    .neq("status", "completed");
  if (activeJobs && activeJobs.length) {
    await supabase
      .from("jobs")
      .update({ site_street: street, site_city: city, site_state: state, site_zip: zip })
      .eq("service_address_id", id)
      .neq("status", "completed");
    for (const j of activeJobs) revalidatePath(`/jobs/${j.id}`);
    revalidatePath("/jobs");
    revalidatePath("/warehouse");
  }
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
