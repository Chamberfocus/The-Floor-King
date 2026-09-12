"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { jobFilesObjectPathError } from "@/lib/job-files-path";
import type { JobFileKind } from "@/lib/types";

export async function recordJobFile(args: {
  jobId: string;
  path: string;
  kind: JobFileKind;
  caption?: string;
  signerName?: string;
}): Promise<{ error: string | null }> {
  if (!args.jobId || !args.path) return { error: "Missing file info." };
  const pathErr = jobFilesObjectPathError(args.jobId, args.path);
  if (pathErr) return { error: pathErr };

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

  const { error } = await supabase.from("job_files").insert({
    job_id: args.jobId,
    path: args.path,
    kind: args.kind,
    caption: args.caption || null,
    signer_name: args.signerName || null,
    uploaded_by: user.id,
  });
  if (error) return { error: error.message };

  revalidatePath(`/jobs/${args.jobId}`);
  return { error: null };
}

export async function deleteJobFile(formData: FormData): Promise<void> {
  const id = typeof formData.get("id") === "string" ? String(formData.get("id")) : "";
  const jobId =
    typeof formData.get("job_id") === "string"
      ? String(formData.get("job_id"))
      : "";
  const path =
    typeof formData.get("path") === "string"
      ? String(formData.get("path"))
      : "";
  if (!id) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  const { data: prof } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (prof?.role !== "admin" && prof?.role !== "office") return;
  if (path && jobId && jobFilesObjectPathError(jobId, path)) return;

  if (path) await supabase.storage.from("job-files").remove([path]);
  await supabase.from("job_files").delete().eq("id", id);

  if (jobId) revalidatePath(`/jobs/${jobId}`);
}
