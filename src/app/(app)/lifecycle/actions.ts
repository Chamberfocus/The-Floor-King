"use server";

import { revalidatePath } from "next/cache";
import { assertRole } from "@/lib/auth";
import { employeeDbError } from "@/lib/employee-error";
import {
  assessLifecycle,
  auditDetail,
  isLifecycleRecordType,
  LIFECYCLE_ARCHIVE_ROLES,
  LIFECYCLE_DELETE_ROLES,
  phraseMatches,
  type LifecycleRecordType,
} from "@/lib/record-lifecycle";
import {
  drainLifecycleStorage,
  lifecycleSchemaReady,
  loadLifecycleFacts,
  previewLifecycle,
} from "@/lib/record-lifecycle-db";
import { createClient } from "@/lib/supabase/server";

export type LifecycleActionResult = {
  ok: boolean;
  status?: string;
  error?: string;
  impact?: Awaited<ReturnType<typeof previewLifecycle>>;
};

function readType(value: FormDataEntryValue | null): LifecycleRecordType | null {
  const raw = String(value ?? "");
  return isLifecycleRecordType(raw) ? raw : null;
}

function readId(value: FormDataEntryValue | null): string {
  const id = String(value ?? "").trim();
  return /^[0-9a-f-]{36}$/i.test(id) ? id : "";
}

async function requireReady() {
  if (!(await lifecycleSchemaReady())) {
    return "Record lifecycle is not installed on this database yet.";
  }
  return null;
}

export async function previewDeleteForever(
  recordType: string,
  recordId: string,
): Promise<LifecycleActionResult> {
  try {
    await assertRole([...LIFECYCLE_DELETE_ROLES]);
  } catch {
    return { ok: false, error: "Only an administrator can review permanent deletion." };
  }
  const pending = await requireReady();
  if (pending) return { ok: false, error: pending };
  if (!isLifecycleRecordType(recordType) || !readId(recordId)) {
    return { ok: false, error: "That record could not be checked." };
  }
  try {
    const impact = await previewLifecycle(recordType, recordId);
    return { ok: true, impact };
  } catch (error) {
    console.error("[lifecycle.preview]", error instanceof Error ? error.name : "error");
    return { ok: false, error: "The delete impact could not be calculated. Nothing was deleted." };
  }
}

export async function archiveRecord(formData: FormData): Promise<LifecycleActionResult> {
  await assertRole([...LIFECYCLE_ARCHIVE_ROLES]);
  const pending = await requireReady();
  if (pending) return { ok: false, error: pending };
  const recordType = readType(formData.get("record_type"));
  const recordId = readId(formData.get("record_id"));
  if (!recordType || recordType === "payment" || !recordId) {
    return { ok: false, error: "That record cannot be archived." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("lifecycle_set_archived", {
    p_type: recordType,
    p_id: recordId,
    p_archive: true,
  });
  if (error) {
    console.error("[lifecycle.archive]", error.code);
    return {
      ok: false,
      error: employeeDbError(error.message, "This record could not be archived."),
    };
  }
  revalidateLifecycle(recordType, recordId);
  return { ok: true, status: String((data as { status?: string } | null)?.status ?? "archived") };
}

export async function restoreRecord(formData: FormData): Promise<LifecycleActionResult> {
  await assertRole([...LIFECYCLE_ARCHIVE_ROLES]);
  const pending = await requireReady();
  if (pending) return { ok: false, error: pending };
  const recordType = readType(formData.get("record_type"));
  const recordId = readId(formData.get("record_id"));
  if (!recordType || recordType === "payment" || !recordId) {
    return { ok: false, error: "That record cannot be restored." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("lifecycle_set_archived", {
    p_type: recordType,
    p_id: recordId,
    p_archive: false,
  });
  if (error) {
    console.error("[lifecycle.restore]", error.code);
    return {
      ok: false,
      error: employeeDbError(error.message, "This record could not be restored."),
    };
  }
  revalidateLifecycle(recordType, recordId);
  return { ok: true, status: String((data as { status?: string } | null)?.status ?? "restored") };
}

export async function deleteForever(formData: FormData): Promise<LifecycleActionResult> {
  const profile = await assertRole([...LIFECYCLE_DELETE_ROLES]);
  const pending = await requireReady();
  if (pending) return { ok: false, error: pending };
  const recordType = readType(formData.get("record_type"));
  const recordId = readId(formData.get("record_id"));
  const phrase = String(formData.get("confirm") ?? "");
  if (!recordType || !recordId) return { ok: false, error: "That record cannot be deleted." };
  if (profile.role !== "admin") return { ok: false, error: "Only an administrator can delete forever." };

  const facts = await loadLifecycleFacts(recordType, recordId);
  const impact = assessLifecycle(facts);
  if (!facts.exists) return { ok: true, status: "already_deleted" };
  if (!phraseMatches(impact.confirmPhrase, phrase)) {
    return { ok: false, error: `Type ${impact.confirmPhrase} to confirm. Nothing was deleted.`, impact };
  }
  if (!impact.canDeleteForever) {
    const supabase = await createClient();
    await supabase.from("record_lifecycle_events").insert({
      action: "delete_blocked",
      record_type: recordType,
      record_id: recordId,
      performed_by: profile.id,
      detail: auditDetail(impact),
    });
    return {
      ok: false,
      error: impact.blockingReasons[0] ?? "Permanent deletion is blocked. Nothing was deleted.",
      impact,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("lifecycle_commit_delete", {
    p_type: recordType,
    p_id: recordId,
    p_phrase: phrase,
  });
  if (error) {
    console.error("[lifecycle.delete]", error.code);
    return {
      ok: false,
      error: employeeDbError(error.message, "This record was not deleted."),
      impact,
    };
  }
  const body = (data ?? {}) as { ok?: boolean; status?: string; error?: string; blocked?: string[] };
  if (!body.ok) {
    return {
      ok: false,
      error:
        body.error === "confirmation"
          ? "Confirmation did not match. Nothing was deleted."
          : body.error === "not_authorized"
            ? "Only an administrator can delete forever."
            : "Permanent deletion is blocked because a protected record exists. Nothing was deleted.",
      impact,
    };
  }
  await drainLifecycleStorage(supabase);
  revalidateLifecycle(recordType, recordId);
  return { ok: true, status: body.status ?? "deleted" };
}

function revalidateLifecycle(type: LifecycleRecordType, id: string) {
  revalidatePath("/customers");
  revalidatePath("/estimates");
  revalidatePath("/jobs");
  revalidatePath("/invoices");
  revalidatePath("/catalog");
  revalidatePath("/settings/suppliers");
  revalidatePath("/settings/team");
  revalidatePath("/install-scheduler");
  if (type === "customer") revalidatePath(`/customers/${id}`);
  if (type === "estimate") revalidatePath(`/estimates/${id}`);
  if (type === "job") revalidatePath(`/jobs/${id}`);
  if (type === "invoice") revalidatePath(`/invoices/${id}`);
  if (type === "product") revalidatePath(`/catalog/${id}`);
  if (type === "supplier") revalidatePath(`/settings/suppliers/${id}`);
}
