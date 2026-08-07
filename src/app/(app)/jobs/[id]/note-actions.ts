"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/auth";
import { sendEmail, emailLayout, siteUrl } from "@/lib/notify";
import { sendSms } from "@/lib/sms";
import { getBusinessSettings } from "@/lib/data/business-settings";

/**
 * Work notes — one log, three targets.
 *
 * Deliberately NOT jobs.notes: that field is structured (buildJobScope parses it
 * into job conditions and per-room prep, and the questionnaire writes it), so
 * typing "customer moved the fridge" in there gets swallowed or breaks the
 * parse. These are ordered, attributed, and each one says who it's for.
 *
 * A note hangs off a JOB, a PURCHASE ORDER, or neither — the last being a
 * shop-wide note. Three targets, one log, rather than three inboxes nobody
 * remembers to check.
 */

const INTERNAL = [
  "admin", "office", "sales_manager", "salesman", "scheduler", "crew", "warehouse",
];

export interface NoteResult {
  error: string | null;
}

export interface WorkNote {
  id: string;
  body: string;
  on_work_order: boolean;
  for_warehouse: boolean;
  urgent: boolean;
  job_id: string | null;
  po_id: string | null;
  created_at: string;
  authorName: string;
}

/**
 * Tell the warehouse a note landed for them.
 *
 * Email by default; urgent ones also text, because "the colour is wrong, don't
 * stage it" is worth interrupting someone for and "check the dye lot" isn't.
 * Respects the notify_staff switch so this can be turned off wholesale.
 */
async function notifyWarehouse(note: {
  id: string;
  body: string;
  urgent: boolean;
  jobId: string | null;
  authorName: string;
}): Promise<void> {
  try {
    const biz = await getBusinessSettings();
    if (!biz?.notify_staff) return;

    const admin = createAdminClient();
    const { data: people } = await admin
      .from("profiles")
      .select("email, phone")
      .in("role", ["warehouse", "admin"])
      .eq("active", true);

    const link = note.jobId
      ? `${siteUrl()}/jobs/${note.jobId}`
      : `${siteUrl()}/warehouse`;

    for (const p of people ?? []) {
      if (p.email) {
        await sendEmail({
          to: p.email as string,
          subject: note.urgent
            ? "URGENT — note for the warehouse"
            : "Note for the warehouse",
          html: emailLayout(
            note.urgent ? "Urgent note for the warehouse" : "Note for the warehouse",
            `<p>${note.body.replace(/</g, "&lt;")}</p><p style="color:#666">— ${note.authorName}</p>`,
            { label: "Open it", url: link },
          ),
        });
      }
      // Only urgent notes are worth a text.
      if (note.urgent && p.phone) {
        await sendSms(
          p.phone as string,
          `Cleveland Floor King — URGENT: ${note.body.slice(0, 240)}`,
        );
      }
    }

    await admin
      .from("work_notes")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", note.id);
  } catch (err) {
    // A failed message must never lose the note itself.
    console.error("[notifyWarehouse]", err);
  }
}

function refresh(jobId: string | null, poId: string | null) {
  if (jobId) revalidatePath(`/jobs/${jobId}`);
  if (poId) revalidatePath(`/purchase-orders/${poId}`);
  revalidatePath("/warehouse");
  revalidatePath("/installer");
}

export async function addWorkNote(formData: FormData): Promise<NoteResult> {
  const profile = await getProfile();
  if (!profile || !INTERNAL.includes(profile.role)) {
    return { error: "Not authorized." };
  }

  const jobId = String(formData.get("job_id") ?? "") || null;
  const poId = String(formData.get("po_id") ?? "") || null;
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return { error: "Type the note first." };

  // The crew writes from site about the work, so theirs always reach the sheet.
  const onWorkOrder =
    profile.role === "crew" ? true : String(formData.get("on_work_order") ?? "") === "on";
  const forWarehouse = String(formData.get("for_warehouse") ?? "") === "on";
  const urgent = String(formData.get("urgent") ?? "") === "on";

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("work_notes")
    .insert({
      job_id: jobId,
      po_id: poId,
      body,
      on_work_order: onWorkOrder,
      for_warehouse: forWarehouse,
      urgent,
      author_id: profile.id,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[addWorkNote]", error.code, error.message);
    return { error: "Couldn't save the note. Try again." };
  }

  if (forWarehouse) {
    await notifyWarehouse({
      id: data.id as string,
      body,
      urgent,
      jobId,
      authorName: profile.full_name ?? profile.email,
    });
  }

  refresh(jobId, poId);
  return { error: null };
}

export async function updateWorkNote(formData: FormData): Promise<NoteResult> {
  const profile = await getProfile();
  if (!profile) return { error: "Not authorized." };

  const id = String(formData.get("id") ?? "");
  const jobId = String(formData.get("job_id") ?? "") || null;
  const poId = String(formData.get("po_id") ?? "") || null;
  const body = String(formData.get("body") ?? "").trim();
  if (!id || !body) return { error: "Type the note first." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("work_notes")
    .update({
      body,
      on_work_order: String(formData.get("on_work_order") ?? "") === "on",
      for_warehouse: String(formData.get("for_warehouse") ?? "") === "on",
      urgent: String(formData.get("urgent") ?? "") === "on",
    })
    .eq("id", id);

  if (error) {
    console.error("[updateWorkNote]", error.code, error.message);
    return { error: "Couldn't save the change." };
  }

  refresh(jobId, poId);
  return { error: null };
}

export async function deleteWorkNote(formData: FormData): Promise<NoteResult> {
  const profile = await getProfile();
  if (!profile) return { error: "Not authorized." };

  const id = String(formData.get("id") ?? "");
  const jobId = String(formData.get("job_id") ?? "") || null;
  const poId = String(formData.get("po_id") ?? "") || null;
  if (!id) return { error: "Missing the note." };

  const supabase = await createClient();
  const { error } = await supabase.from("work_notes").delete().eq("id", id);
  if (error) {
    console.error("[deleteWorkNote]", error.code, error.message);
    return { error: "Couldn't remove the note." };
  }

  refresh(jobId, poId);
  return { error: null };
}

const one = <T,>(v: T | T[] | null | undefined): T | null =>
  v == null ? null : Array.isArray(v) ? (v[0] ?? null) : v;

function shape(rows: Record<string, unknown>[]): WorkNote[] {
  return rows.map((r) => {
    const a = one(
      r.author as
        | { full_name?: string; email?: string }
        | { full_name?: string; email?: string }[]
        | null,
    );
    return {
      id: r.id as string,
      body: r.body as string,
      on_work_order: Boolean(r.on_work_order),
      for_warehouse: Boolean(r.for_warehouse),
      urgent: Boolean(r.urgent),
      job_id: (r.job_id as string | null) ?? null,
      po_id: (r.po_id as string | null) ?? null,
      created_at: r.created_at as string,
      authorName: a?.full_name ?? a?.email ?? "Someone",
    };
  });
}

const COLUMNS =
  "id, body, on_work_order, for_warehouse, urgent, job_id, po_id, created_at, author:profiles(full_name, email)";

export async function listJobNotes(jobId: string): Promise<WorkNote[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("work_notes")
    .select(COLUMNS)
    .eq("job_id", jobId)
    .order("created_at", { ascending: false });
  return shape((data ?? []) as unknown as Record<string, unknown>[]);
}

export async function listPoNotes(poId: string): Promise<WorkNote[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("work_notes")
    .select(COLUMNS)
    .eq("po_id", poId)
    .order("created_at", { ascending: false });
  return shape((data ?? []) as unknown as Record<string, unknown>[]);
}

/** Shop-wide notes — attached to nothing, aimed at everyone. */
export async function listBoardNotes(): Promise<WorkNote[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("work_notes")
    .select(COLUMNS)
    .is("job_id", null)
    .is("po_id", null)
    .order("created_at", { ascending: false })
    .limit(50);
  return shape((data ?? []) as unknown as Record<string, unknown>[]);
}

/** Everything aimed at the warehouse, for their queue. */
export async function listWarehouseNotes(): Promise<WorkNote[]> {
  const db = createAdminClient();
  const { data } = await db
    .from("work_notes")
    .select(COLUMNS)
    .eq("for_warehouse", true)
    .order("created_at", { ascending: false })
    .limit(100);
  return shape((data ?? []) as unknown as Record<string, unknown>[]);
}
