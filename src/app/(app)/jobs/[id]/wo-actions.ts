"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export interface WOState {
  error: string | null;
  ok?: boolean;
}

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

/** The caller's profile + a DB client that can write this job's rows: staff use
 *  their own (RLS-guarded) client; the assigned installer (crew) uses the
 *  service-role client after we verify they own the job. */
async function jobWriter(jobId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in again." as string };
  const { data: prof } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (!prof || prof.role === "customer") return { error: "Not allowed." as string };
  const isStaff = prof.role === "admin" || prof.role === "office";
  if (!isStaff) {
    // Non-staff must be the installer assigned to this job.
    const { data: job } = await supabase.from("jobs").select("assigned_to").eq("id", jobId).maybeSingle();
    if (!job || job.assigned_to !== user.id) return { error: "Not your job." as string };
  }
  let db = supabase;
  if (!isStaff) {
    try {
      db = createAdminClient() as unknown as typeof supabase;
    } catch {
      return { error: "Server isn't set up for crew actions." as string };
    }
  }
  return { db, userId: user.id, isStaff };
}

/** Staff-only: toggle whether prices show on this work order. */
export async function setJobShowPrices(formData: FormData): Promise<void> {
  const jobId = str(formData.get("job_id"));
  const show = str(formData.get("show")) === "1";
  if (!jobId) return;
  const supabase = await createClient();
  await supabase.from("jobs").update({ show_prices: show }).eq("id", jobId);
  revalidatePath(`/jobs/${jobId}`);
}

/** Staff-only: per-job override of whether the installer collects the balance.
 *  "" clears the override (inherit the global setting). */
export async function setJobCollectsBalance(formData: FormData): Promise<void> {
  const jobId = str(formData.get("job_id"));
  const val = str(formData.get("value")); // "yes" | "no" | ""
  if (!jobId) return;
  const supabase = await createClient();
  const collects = val === "yes" ? true : val === "no" ? false : null;
  await supabase.from("jobs").update({ installer_collects_balance: collects }).eq("id", jobId);
  revalidatePath(`/jobs/${jobId}`);
}

/** Upload a completed-job photo, attached to this work order. Installer-friendly. */
export async function uploadJobPhoto(_prev: WOState, formData: FormData): Promise<WOState> {
  const jobId = str(formData.get("job_id"));
  const file = formData.get("file");
  if (!jobId) return { error: "Missing job." };
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a photo." };
  if (file.size > 25 * 1024 * 1024) return { error: "That photo is too large (max 25 MB)." };

  const w = await jobWriter(jobId);
  if ("error" in w) return { error: w.error ?? null };
  const { db, userId } = w;

  const { data: job } = await db.from("jobs").select("customer_id").eq("id", jobId).maybeSingle();
  const customerId = (job?.customer_id as string | null) ?? null;

  const bytes = Buffer.from(await file.arrayBuffer());
  const path = `jobs/${jobId}/${crypto.randomUUID()}-${file.name}`;
  const { error: upErr } = await db.storage
    .from("documents")
    .upload(path, bytes, { contentType: file.type || "image/jpeg" });
  if (upErr) return { error: upErr.message };

  const { error } = await db.from("documents").insert({
    customer_id: customerId,
    job_id: jobId,
    uploaded_by: userId,
    name: file.name,
    path,
    mime: file.type || null,
    kind: "completed",
  });
  if (error) return { error: error.message };
  revalidatePath(`/jobs/${jobId}`);
  return { error: null, ok: true };
}

/** Save the customer satisfaction sign-off to this work order. */
export async function saveJobSatisfaction(_prev: WOState, formData: FormData): Promise<WOState> {
  const jobId = str(formData.get("job_id"));
  if (!jobId) return { error: "Missing job." };
  const signature = str(formData.get("signature"));
  const signedName = str(formData.get("signed_name"));
  if (!signature) return { error: "Please have the customer sign before saving." };

  const w = await jobWriter(jobId);
  if ("error" in w) return { error: w.error ?? null };
  const { db, userId } = w;

  const ratingRaw = parseInt(str(formData.get("rating")), 10);
  const rating = Number.isFinite(ratingRaw) && ratingRaw >= 1 && ratingRaw <= 5 ? ratingRaw : null;
  const { error } = await db.from("job_satisfaction").insert({
    job_id: jobId,
    rating,
    comments: str(formData.get("comments")) || null,
    signature,
    signed_name: signedName || null,
    created_by: userId,
  });
  if (error) return { error: error.message };
  revalidatePath(`/jobs/${jobId}`);
  return { error: null, ok: true };
}
