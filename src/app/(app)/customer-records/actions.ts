"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { assertRole } from "@/lib/auth";
import { employeeDbError } from "@/lib/employee-error";
import { decideArchive, decideRestore } from "@/lib/customer-lifecycle";
import { revalidateOperationalSurfaces } from "@/lib/revalidate-operational";

export type CustomerRecordActionState = {
  ok: boolean;
  error?: string;
};

function customerId(formData: FormData): string {
  const v = formData.get("customer_id");
  return typeof v === "string" ? v.trim() : "";
}

function refresh(customerId?: string) {
  revalidateOperationalSurfaces(customerId ? [`/customers/${customerId}`] : []);
}

export async function archiveCustomerRecord(
  _prev: CustomerRecordActionState,
  formData: FormData,
): Promise<CustomerRecordActionState> {
  await assertRole(["admin", "office"]);
  const id = customerId(formData);
  if (!id) return { ok: false, error: "Missing customer." };

  const supabase = await createClient();
  const { data: existing, error: readError } = await supabase
    .from("customers")
    .select("cancelled_at")
    .eq("id", id)
    .maybeSingle();
  if (readError || !existing) {
    return { ok: false, error: "This customer could not be archived." };
  }
  const decision = decideArchive(existing.cancelled_at as string | null, new Date().toISOString());
  if (decision.action === "noop") {
    refresh(id);
    return { ok: true };
  }

  // Archive leaves jobs, tasks, callbacks, invoices, and payments unchanged.
  // A second click matches cancelled_at is null, so it cannot stamp twice.
  const { error } = await supabase
    .from("customers")
    .update({
      cancelled_at: decision.cancelledAt,
      cancel_reason: "Archived from customer records",
    })
    .eq("id", id)
    .is("cancelled_at", null);

  if (error) {
    return {
      ok: false,
      error: employeeDbError(error.message, "This customer could not be archived."),
    };
  }

  refresh(id);
  return { ok: true };
}

export async function restoreCustomerRecord(
  _prev: CustomerRecordActionState,
  formData: FormData,
): Promise<CustomerRecordActionState> {
  await assertRole(["admin", "office"]);
  const id = customerId(formData);
  if (!id) return { ok: false, error: "Missing customer." };

  const supabase = await createClient();
  const { data: existing, error: readError } = await supabase
    .from("customers")
    .select("cancelled_at")
    .eq("id", id)
    .maybeSingle();
  if (readError || !existing) {
    return { ok: false, error: "This customer could not be restored." };
  }
  if (decideRestore(existing.cancelled_at as string | null).action === "noop") {
    refresh(id);
    return { ok: true };
  }

  // Restore clears the archive flag only. It does not insert jobs, tasks, or money.
  const { error } = await supabase
    .from("customers")
    .update({ cancelled_at: null, cancel_reason: null })
    .eq("id", id)
    .not("cancelled_at", "is", null);

  if (error) {
    return {
      ok: false,
      error: employeeDbError(error.message, "This customer could not be restored."),
    };
  }
  refresh(id);
  return { ok: true };
}

export async function deleteCustomerForever(
  _prev: CustomerRecordActionState,
  formData: FormData,
): Promise<CustomerRecordActionState> {
  await assertRole(["admin"]);
  const id = customerId(formData);
  const confirmation =
    typeof formData.get("confirmation") === "string"
      ? String(formData.get("confirmation")).trim()
      : "";

  if (!id) return { ok: false, error: "Missing customer." };
  if (confirmation !== "DELETE") {
    return { ok: false, error: "Type DELETE to permanently delete this customer." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("delete_customer_if_unused", {
    p_customer_id: id,
  });

  if (error) {
    const message =
      error.message?.includes("Could not find the function") ||
      error.message?.includes("delete_customer_if_unused")
        ? "Safe Delete is not installed yet. Apply migration 0482 first."
        : employeeDbError(error.message, "This customer could not be deleted.");
    return { ok: false, error: message };
  }

  const result = (data ?? {}) as {
    ok?: boolean;
    error?: string;
    blockers?: string[];
    already_deleted?: boolean;
  };

  if (result.already_deleted) {
    refresh(id);
    redirect("/customer-records");
  }

  if (!result.ok) {
    if (result.error === "has_dependencies") {
      const blockers = Array.isArray(result.blockers) ? result.blockers : [];
      return {
        ok: false,
        error:
          blockers.length > 0
            ? `Cannot delete permanently. This customer still has linked records: ${blockers.join(", ")}. Archive the customer instead.`
            : "Cannot delete permanently because linked history exists. Archive the customer instead.",
      };
    }
    if (result.error === "not_authorized") {
      return { ok: false, error: "Only an administrator can delete forever." };
    }
    return { ok: false, error: "This customer could not be deleted." };
  }

  refresh(id);
  redirect("/customer-records");
}
