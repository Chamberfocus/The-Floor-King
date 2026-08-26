"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assertRole } from "@/lib/auth";
import type { UserRole } from "@/lib/types";

/**
 * Editing what the crew is actually doing.
 *
 * The work order's scope is its own now (migration 0152), so these change the
 * JOB and never the customer's approved estimate. That's the whole point: the
 * measurement is off by a closet, there's a second layer of subfloor, a room
 * gets dropped — the work order says what's really happening, and the signed
 * quote stays as signed.
 */

const STAFF: UserRole[] = ["admin", "office", "sales_manager", "salesman", "scheduler"];

const str = (v: FormDataEntryValue | null): string =>
  typeof v === "string" ? v.trim() : "";
const numOrNull = (v: FormDataEntryValue | null): number | null => {
  const n = parseFloat(str(v));
  return Number.isFinite(n) ? n : null;
};

/**
 * Make sure the job has its OWN lines before editing one.
 *
 * A job created before 0152 still reads the estimate's lines as a fallback.
 * Editing must never write back to those, so the first edit takes the copy the
 * backfill would have taken.
 */
async function ensureOwnLines(
  supabase: Awaited<ReturnType<typeof createClient>>,
  jobId: string,
): Promise<void> {
  const { count } = await supabase
    .from("job_line_items")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId);
  if ((count ?? 0) > 0) return;

  const { data: job } = await supabase
    .from("jobs")
    .select("option_id")
    .eq("id", jobId)
    .maybeSingle();
  if (!job?.option_id) return;

  const { data: lines } = await supabase
    .from("estimate_line_items")
    .select("*")
    .eq("option_id", job.option_id)
    .order("position", { ascending: true });
  if (!lines?.length) return;

  await supabase
    .from("job_line_items")
    .insert(lines.map((l) => ({ ...l, job_id: jobId })));
}

/** Change one line's scope — what it is, where, how much, and a note. */
export async function updateJobLine(formData: FormData): Promise<void> {
  const jobId = str(formData.get("job_id"));
  const lineId = str(formData.get("line_id"));
  if (!jobId || !lineId) return;
  await assertRole(STAFF);
  const supabase = await createClient();
  await ensureOwnLines(supabase, jobId);

  const patch: Record<string, unknown> = {
    description: str(formData.get("description")) || null,
    room: str(formData.get("room")) || null,
    note: str(formData.get("note")) || null,
  };
  // Only touch a measurement when one was actually typed, so clearing the box
  // doesn't silently zero a line that's priced off it.
  const sqft = numOrNull(formData.get("sqft"));
  const qty = numOrNull(formData.get("quantity"));
  if (sqft !== null) patch.sqft = sqft;
  if (qty !== null) patch.quantity = qty;

  await supabase.from("job_line_items").update(patch).eq("id", lineId).eq("job_id", jobId);

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/staging-sheet`);
  revalidatePath("/warehouse");
}

/** Add a line the estimate never had — the extra closet, the second layer. */
export async function addJobLine(formData: FormData): Promise<void> {
  const jobId = str(formData.get("job_id"));
  const description = str(formData.get("description"));
  if (!jobId || !description) return;
  await assertRole(STAFF);
  const supabase = await createClient();
  await ensureOwnLines(supabase, jobId);

  const { data: last } = await supabase
    .from("job_line_items")
    .select("position")
    .eq("job_id", jobId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  await supabase.from("job_line_items").insert({
    job_id: jobId,
    description,
    room: str(formData.get("room")) || null,
    note: str(formData.get("note")) || null,
    sqft: numOrNull(formData.get("sqft")),
    quantity: numOrNull(formData.get("quantity")),
    unit: str(formData.get("unit")) || "sqft",
    category: str(formData.get("category")) || "other",
    line_type: "mat_labor",
    position: ((last?.position as number) ?? -1) + 1,
  });

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/staging-sheet`);
  revalidatePath("/warehouse");
}

/** Drop a line from the work order. The estimate keeps its copy. */
export async function removeJobLine(formData: FormData): Promise<void> {
  const jobId = str(formData.get("job_id"));
  const lineId = str(formData.get("line_id"));
  if (!jobId || !lineId) return;
  await assertRole(STAFF);
  const supabase = await createClient();
  await ensureOwnLines(supabase, jobId);

  await supabase.from("job_line_items").delete().eq("id", lineId).eq("job_id", jobId);

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/staging-sheet`);
  revalidatePath("/warehouse");
}
