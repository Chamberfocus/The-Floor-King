"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { assertRole } from "@/lib/auth";
import { employeeDbError } from "@/lib/employee-error";

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}
function nullable(v: FormDataEntryValue | null): string | null {
  return str(v) || null;
}

export async function createCustomerFast(formData: FormData): Promise<void> {
  const profile = await assertRole(["admin", "office", "sales_manager", "salesman", "scheduler"]);
  const fullName = str(formData.get("full_name"));
  if (!fullName) throw new Error("A name is required.");

  const supabase = await createClient();
  const row = {
    full_name: fullName,
    company: nullable(formData.get("company")),
    email: nullable(formData.get("email")),
    phone: nullable(formData.get("phone")),
    street: nullable(formData.get("street")),
    city: nullable(formData.get("city")),
    state: nullable(formData.get("state")),
    zip: nullable(formData.get("zip")),
    notes: nullable(formData.get("notes")),
    stage: "new",
    created_by: profile.id,
    assigned_to: profile.id,
    source: null,
    source_id: null,
    source_detail_id: null,
    source_detail_text: null,
    referred_by_customer_id: null,
  };

  const { data, error } = await supabase
    .from("customers")
    .insert(row)
    .select("id")
    .single();

  if (error || !data?.id) {
    throw new Error(employeeDbError(error?.message ?? "", "This customer could not be created."));
  }

  redirect(`/customers/${data.id}?new=1`);
}
