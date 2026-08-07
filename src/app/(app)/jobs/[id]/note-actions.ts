"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";

/**
 * Notes on a work order.
 *
 * Deliberately NOT jobs.notes — that field is structured (buildJobScope parses
 * it into job conditions and per-room prep, and the questionnaire writes it), so
 * typing "customer moved the fridge" in there gets swallowed or breaks the
 * parse. These are ordered, attributed, and each decides whether the crew sees
 * it on the sheet they carry.
 */

const INTERNAL = ["admin", "office", "sales_manager", "salesman", "scheduler", "crew", "warehouse"];

export interface NoteResult {
  error: string | null;
}

/** Anyone on the job can add one; the crew is often who has something to say. */
export async function addJobNote(formData: FormData): Promise<NoteResult> {
  const profile = await getProfile();
  if (!profile || !INTERNAL.includes(profile.role)) {
    return { error: "Not authorized." };
  }

  const jobId = String(formData.get("job_id") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  // The crew's notes always reach the work order — they're writing from site,
  // about the work. Only office staff get the choice.
  const onWorkOrder =
    profile.role === "crew" ? true : String(formData.get("on_work_order") ?? "") === "on";

  if (!jobId) return { error: "Missing the job." };
  if (!body) return { error: "Type the note first." };

  const supabase = await createClient();
  const { error } = await supabase.from("job_notes").insert({
    job_id: jobId,
    body,
    on_work_order: onWorkOrder,
    author_id: profile.id,
  });
  if (error) {
    console.error("[addJobNote]", error.code, error.message);
    return { error: "Couldn't save the note. Try again." };
  }

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/installer");
  return { error: null };
}

export async function updateJobNote(formData: FormData): Promise<NoteResult> {
  const profile = await getProfile();
  if (!profile) return { error: "Not authorized." };

  const id = String(formData.get("id") ?? "");
  const jobId = String(formData.get("job_id") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  const onWorkOrder = String(formData.get("on_work_order") ?? "") === "on";
  if (!id || !body) return { error: "Type the note first." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("job_notes")
    .update({ body, on_work_order: onWorkOrder })
    .eq("id", id);
  if (error) {
    console.error("[updateJobNote]", error.code, error.message);
    return { error: "Couldn't save the change." };
  }

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/installer");
  return { error: null };
}

export async function deleteJobNote(formData: FormData): Promise<NoteResult> {
  const profile = await getProfile();
  if (!profile) return { error: "Not authorized." };

  const id = String(formData.get("id") ?? "");
  const jobId = String(formData.get("job_id") ?? "");
  if (!id) return { error: "Missing the note." };

  const supabase = await createClient();
  const { error } = await supabase.from("job_notes").delete().eq("id", id);
  if (error) {
    console.error("[deleteJobNote]", error.code, error.message);
    return { error: "Couldn't remove the note." };
  }

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/installer");
  return { error: null };
}

export interface JobNote {
  id: string;
  body: string;
  on_work_order: boolean;
  created_at: string;
  authorName: string;
}

export async function listJobNotes(jobId: string): Promise<JobNote[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("job_notes")
    .select("id, body, on_work_order, created_at, author:profiles(full_name, email)")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false });

  const one = <T,>(v: T | T[] | null | undefined): T | null =>
    v == null ? null : Array.isArray(v) ? (v[0] ?? null) : v;

  return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => {
    const a = one(
      r.author as { full_name?: string; email?: string } | { full_name?: string; email?: string }[] | null,
    );
    return {
      id: r.id as string,
      body: r.body as string,
      on_work_order: Boolean(r.on_work_order),
      created_at: r.created_at as string,
      authorName: a?.full_name ?? a?.email ?? "Someone",
    };
  });
}
