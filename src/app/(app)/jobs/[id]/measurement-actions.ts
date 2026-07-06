"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export interface UploadState {
  error: string | null;
  ok?: boolean;
}

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Field upload of a measurement photo/diagram, attached to the job's customer
 * as a measurement document. Runs through the service-role client because crew
 * (the field techs) are blocked from the documents table by RLS — but we verify
 * the caller is a signed-in internal user first, so it's not open.
 */
export async function uploadJobMeasurement(
  _prev: UploadState,
  formData: FormData,
): Promise<UploadState> {
  const jobId = str(formData.get("job_id"));
  const file = formData.get("file");
  if (!jobId) return { error: "Missing job." };
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a photo or file." };
  }
  if (file.size > 20 * 1024 * 1024) {
    return { error: "File is too large (max 20 MB)." };
  }

  // Only signed-in internal users (not portal customers) may attach.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in again." };
  const { data: prof } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!prof || prof.role === "customer") return { error: "Not allowed." };

  // Staff write directly — same proven path as the customer file's uploader.
  // Only crew (blocked from the documents table by RLS) need the service role.
  let db = supabase;
  if (prof.role === "crew") {
    try {
      db = createAdminClient() as unknown as typeof supabase;
    } catch {
      return { error: "Server isn't set up for crew uploads." };
    }
  }

  const { data: job } = await db
    .from("jobs")
    .select("customer_id")
    .eq("id", jobId)
    .maybeSingle();
  const customerId = job?.customer_id as string | null;
  if (!customerId) return { error: "This job has no customer linked." };

  const bytes = Buffer.from(await file.arrayBuffer());
  const path = `customer/${customerId}/${crypto.randomUUID()}-${file.name}`;
  const { error: upErr } = await db.storage
    .from("documents")
    .upload(path, bytes, {
      contentType: file.type || "application/octet-stream",
    });
  if (upErr) return { error: upErr.message };

  const { error } = await db.from("documents").insert({
    customer_id: customerId,
    uploaded_by: user.id,
    name: file.name,
    path,
    mime: file.type || null,
    kind: "measurement",
  });
  if (error) return { error: error.message };

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/customers/${customerId}`);
  return { error: null, ok: true };
}
