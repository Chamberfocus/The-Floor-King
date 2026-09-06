"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { DOCUMENTS_STORAGE_JWT_ROLES } from "@/lib/job-warehouse";

export interface DocState {
  error: string | null;
  ok?: boolean;
}

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

async function requireDocumentsJwtRole(): Promise<
  | { ok: true; supabase: Awaited<ReturnType<typeof createClient>>; userId: string }
  | { ok: false; error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  const { data: prof } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (
    !prof ||
    !(DOCUMENTS_STORAGE_JWT_ROLES as readonly string[]).includes(
      prof.role as string,
    )
  ) {
    return { ok: false, error: "Not allowed." };
  }
  return { ok: true, supabase, userId: user.id };
}

export async function uploadCustomerDocument(
  _prev: DocState,
  formData: FormData,
): Promise<DocState> {
  const customerId = str(formData.get("customer_id"));
  const file = formData.get("file");
  const rawKind = str(formData.get("kind"));
  const kind =
    rawKind === "measurement" ? "measurement" : rawKind === "photo" ? "photo" : "other";
  if (!customerId) return { error: "Missing customer." };
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file to upload." };
  }
  if (file.size > 20 * 1024 * 1024) {
    return { error: "File is too large (max 20 MB)." };
  }

  const gate = await requireDocumentsJwtRole();
  if (!gate.ok) return { error: gate.error };
  const { supabase, userId } = gate;
  const bytes = Buffer.from(await file.arrayBuffer());
  const path = `customer/${customerId}/${crypto.randomUUID()}-${file.name}`;

  const { error: upErr } = await supabase.storage
    .from("documents")
    .upload(path, bytes, {
      contentType: file.type || "application/octet-stream",
    });
  if (upErr) return { error: upErr.message };

  const { error } = await supabase.from("documents").insert({
    customer_id: customerId,
    uploaded_by: userId,
    name: file.name,
    path,
    mime: file.type || null,
    kind,
  });
  if (error) return { error: error.message };

  revalidatePath(`/customers/${customerId}`);
  return { error: null, ok: true };
}

/**
 * Save one or more generated diagrams (e.g. carpet seam plans) as measurement
 * documents, so they show on the installer's job view next to the sketch.
 */
export async function saveMeasurementDiagram(
  formData: FormData,
): Promise<DocState> {
  const customerId = str(formData.get("customer_id"));
  if (!customerId) return { error: "Missing customer." };
  const files = formData
    .getAll("file")
    .filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return { error: "Nothing to save." };

  const gate = await requireDocumentsJwtRole();
  if (!gate.ok) return { error: gate.error };
  const { supabase, userId } = gate;
  for (const file of files) {
    if (file.size > 20 * 1024 * 1024) continue;
    const bytes = Buffer.from(await file.arrayBuffer());
    const path = `customer/${customerId}/${crypto.randomUUID()}-${file.name}`;
    const { error: upErr } = await supabase.storage
      .from("documents")
      .upload(path, bytes, { contentType: file.type || "image/svg+xml" });
    if (upErr) return { error: upErr.message };
    const { error } = await supabase.from("documents").insert({
      customer_id: customerId,
      uploaded_by: userId,
      name: file.name,
      path,
      mime: file.type || "image/svg+xml",
      kind: "measurement",
    });
    if (error) return { error: error.message };
  }
  revalidatePath(`/customers/${customerId}`);
  return { error: null, ok: true };
}

export async function deleteCustomerDocument(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  const path = str(formData.get("path"));
  const customerId = str(formData.get("customer_id"));
  if (!id) return;
  const gate = await requireDocumentsJwtRole();
  if (!gate.ok) return;
  const { supabase } = gate;
  if (path) await supabase.storage.from("documents").remove([path]);
  await supabase.from("documents").delete().eq("id", id);
  revalidatePath(`/customers/${customerId}`);
}
