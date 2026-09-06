"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorizeJobMeasurementUpload } from "@/lib/job-warehouse";

export interface UploadState {
  error: string | null;
  ok?: boolean;
}

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Field upload of a measurement photo/diagram attached to the job's customer.
 * Admin/office/sales JWT write the documents bucket directly. Crew (assigned)
 * and warehouse (job visible under RLS) use the server-only service_role client
 * after authorization — never returned to the browser.
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

  // Authenticate first; authorize from the caller's JWT session (RLS), then
  // elevate to service_role only for crew/warehouse after that check.
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

  const { data: job } = await supabase
    .from("jobs")
    .select("customer_id, assigned_to")
    .eq("id", jobId)
    .maybeSingle();
  const authz = authorizeJobMeasurementUpload({
    role: prof.role as string,
    userId: user.id,
    jobAssignedTo: (job?.assigned_to as string | null) ?? null,
    jobVisible: !!job,
  });
  if (!authz.ok) return { error: authz.error };

  let db = supabase;
  if (authz.useAdmin) {
    try {
      db = createAdminClient() as unknown as typeof supabase;
    } catch {
      return { error: "Server isn't set up for field uploads." };
    }
  }

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
