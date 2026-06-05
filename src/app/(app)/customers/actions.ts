"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  LEAD_STAGE_LABELS,
  type ActivityType,
  type LeadSource,
  type LeadStage,
} from "@/lib/types";

export interface CustomerFormState {
  error: string | null;
  ok?: boolean;
}

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}
function nullable(v: FormDataEntryValue | null): string | null {
  return str(v) || null;
}

function refreshCustomerViews(id?: string) {
  if (id) revalidatePath(`/customers/${id}`);
  revalidatePath("/customers");
  revalidatePath("/leads");
  revalidatePath("/dashboard");
}

function readCustomerFields(formData: FormData) {
  return {
    full_name: str(formData.get("full_name")),
    company: nullable(formData.get("company")),
    email: nullable(formData.get("email")),
    phone: nullable(formData.get("phone")),
    street: nullable(formData.get("street")),
    city: nullable(formData.get("city")),
    state: nullable(formData.get("state")),
    zip: nullable(formData.get("zip")),
    source: (nullable(formData.get("source")) as LeadSource | null) ?? null,
    notes: nullable(formData.get("notes")),
  };
}

export async function createCustomer(
  _prev: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  const fields = readCustomerFields(formData);
  if (!fields.full_name) return { error: "A name is required." };

  const stage = (str(formData.get("stage")) || "new") as LeadStage;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("customers")
    .insert({
      ...fields,
      stage,
      created_by: user?.id ?? null,
      assigned_to: user?.id ?? null,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  refreshCustomerViews();
  redirect(`/customers/${data.id}`);
}

export async function updateCustomer(
  _prev: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  const id = str(formData.get("id"));
  if (!id) return { error: "Missing customer id." };

  const fields = readCustomerFields(formData);
  if (!fields.full_name) return { error: "A name is required." };

  const supabase = await createClient();
  const { error } = await supabase.from("customers").update(fields).eq("id", id);
  if (error) return { error: error.message };

  refreshCustomerViews(id);
  return { error: null, ok: true };
}

/** Used as a form `action` from the stage dropdown — no return state needed. */
export async function changeStage(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  const stage = str(formData.get("stage")) as LeadStage;
  if (!id || !stage) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: current } = await supabase
    .from("customers")
    .select("stage")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase
    .from("customers")
    .update({ stage })
    .eq("id", id);
  if (error) return;

  const previous = current?.stage as LeadStage | undefined;
  if (previous && previous !== stage) {
    await supabase.from("activities").insert({
      customer_id: id,
      user_id: user?.id ?? null,
      type: "stage_change",
      body: `Stage changed from ${LEAD_STAGE_LABELS[previous]} to ${LEAD_STAGE_LABELS[stage]}`,
    });
  }

  refreshCustomerViews(id);
}

/** Create a customer portal login linked to this customer record. */
export async function inviteCustomerToPortal(
  _prev: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  const customerId = str(formData.get("customer_id"));
  const email = str(formData.get("email")).toLowerCase();
  const password = str(formData.get("password"));
  if (!customerId || !email) return { error: "Email is required." };
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  const supabase = await createClient();
  const { data: customer } = await supabase
    .from("customers")
    .select("full_name")
    .eq("id", customerId)
    .maybeSingle();

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return {
      error:
        "Portal invites need the Supabase secret key configured on the server.",
    };
  }

  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: (customer?.full_name as string) ?? null,
      role: "customer",
    },
  });
  if (error || !created.user) {
    return { error: error?.message ?? "Could not create the login." };
  }

  // Link the new login to this customer (and ensure the customer role).
  await admin
    .from("profiles")
    .update({ customer_id: customerId, role: "customer" })
    .eq("id", created.user.id);

  revalidatePath(`/customers/${customerId}`);
  return { error: null, ok: true };
}

export async function addActivity(
  _prev: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  const customerId = str(formData.get("customer_id"));
  const body = str(formData.get("body"));
  const type = (str(formData.get("type")) || "note") as ActivityType;
  if (!customerId) return { error: "Missing customer." };
  if (!body) return { error: "Write something first." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("activities").insert({
    customer_id: customerId,
    user_id: user?.id ?? null,
    type,
    body,
  });
  if (error) return { error: error.message };

  revalidatePath(`/customers/${customerId}`);
  return { error: null, ok: true };
}
