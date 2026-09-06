"use server";

import { revalidatePath } from "next/cache";
import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { aiText } from "@/lib/ai";
import { listJobs, getJob } from "@/lib/data/jobs";
import { listCustomers } from "@/lib/data/customers";
import { ROLE_LABELS } from "@/lib/types";
import { setJobStatus } from "@/app/(app)/jobs/actions";
import { addActivity } from "@/app/(app)/customers/actions";
import { notifyOnTheWay } from "@/app/(app)/customers/[id]/onway-actions";
import { createDraftEstimateFromText } from "@/app/(app)/estimates/ai-actions";

const fmtDate = (d: string | null) => {
  if (!d) return "unscheduled";
  const t = new Date(d);
  return Number.isNaN(t.getTime())
    ? d
    : t.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};

/** Inches → feet'inches" for reading measurements back to the crew. */
function ftIn(inches: number | null): string {
  const n = Number(inches) || 0;
  if (n <= 0) return "";
  const ft = Math.floor(n / 12);
  const inch = Math.round(n % 12);
  return inch > 0 ? `${ft}'${inch}"` : `${ft}'`;
}

// --- Action contract the assistant can propose (executed only on confirm) ----

export type AssistantAction =
  | { type: "complete_job"; jobId: string; label: string }
  | { type: "set_job_status"; jobId: string; status: string; label: string }
  | { type: "reschedule_job"; jobId: string; date: string; label: string }
  | { type: "add_note"; customerId: string; note: string; label: string }
  | { type: "set_followup"; customerId: string; date: string; label: string }
  | { type: "on_my_way"; customerId: string; label: string }
  | { type: "create_estimate"; customerId: string; description: string; label: string }
  | { type: "navigate"; url: string; label: string };

export interface AssistantReply {
  reply: string;
  action: AssistantAction | null;
  error: string | null;
}

const JOB_STATUSES = [
  "unscheduled",
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
] as const;
const NAV_PREFIXES = [
  "/customers", "/jobs", "/estimates", "/calendar", "/schedule", "/catalog",
  "/purchase-orders", "/invoices", "/board", "/inventory", "/pulse",
  "/dashboard", "/reports", "/warehouse", "/client-status",
];

/** Pull the first JSON object out of the model's reply, tolerantly. */
function parseObj(text: string): Record<string, unknown> | null {
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try {
    return JSON.parse(text.slice(s, e + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Validate a model-proposed action — never trust it blind. */
function sanitizeAction(raw: unknown): AssistantAction | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const label = typeof o.label === "string" ? o.label : "";
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  switch (o.type) {
    case "complete_job":
      return str(o.jobId) ? { type: "complete_job", jobId: str(o.jobId), label } : null;
    case "set_job_status":
      return str(o.jobId) && (JOB_STATUSES as readonly string[]).includes(str(o.status))
        ? { type: "set_job_status", jobId: str(o.jobId), status: str(o.status), label }
        : null;
    case "reschedule_job":
      return str(o.jobId) && /^\d{4}-\d{2}-\d{2}$/.test(str(o.date))
        ? { type: "reschedule_job", jobId: str(o.jobId), date: str(o.date), label }
        : null;
    case "add_note":
      return str(o.customerId) && str(o.note)
        ? { type: "add_note", customerId: str(o.customerId), note: str(o.note), label }
        : null;
    case "set_followup":
      return str(o.customerId) && /^\d{4}-\d{2}-\d{2}$/.test(str(o.date))
        ? { type: "set_followup", customerId: str(o.customerId), date: str(o.date), label }
        : null;
    case "on_my_way":
      return str(o.customerId)
        ? { type: "on_my_way", customerId: str(o.customerId), label }
        : null;
    case "create_estimate":
      return str(o.customerId) && str(o.description).length >= 4
        ? { type: "create_estimate", customerId: str(o.customerId), description: str(o.description), label }
        : null;
    case "navigate": {
      const url = str(o.url);
      return url.startsWith("/") && NAV_PREFIXES.some((p) => url.startsWith(p))
        ? { type: "navigate", url, label }
        : null;
    }
    default:
      return null;
  }
}

/**
 * Field assistant: answers from the user's OWN jobs/customers (RLS-scoped) and
 * may PROPOSE one action. Nothing is executed here — the action is returned for
 * the user to confirm, then run via runAssistantAction.
 */
export async function askAssistant(question: string): Promise<AssistantReply> {
  const q = (question ?? "").trim();
  if (q.length < 2) return { reply: "", action: null, error: "Ask a question first." };

  const profile = await getProfile();
  if (!profile || profile.role === "customer")
    return { reply: "", action: null, error: "Not available for this account." };

  const today = new Date();
  const todayStr = today.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
  const todayISO = today.toISOString().slice(0, 10);

  const lines: string[] = [];
  lines.push(`Today: ${todayStr} (${todayISO}).`);
  lines.push(`User: ${profile.full_name || profile.email}, role ${ROLE_LABELS[profile.role]}.`);

  try {
    const mine = await listJobs({ assignedTo: profile.id });
    const jobs = (mine.length ? mine : await listJobs()).slice(0, 40);
    jobs.sort((a, b) => {
      const ax = a.scheduled_date ? Date.parse(a.scheduled_date) : Infinity;
      const bx = b.scheduled_date ? Date.parse(b.scheduled_date) : Infinity;
      return ax - bx;
    });
    const top = jobs
      .filter((j) => j.status !== "completed" && j.status !== "cancelled")
      .slice(0, 12);
    if (top.length) {
      lines.push("\nJobs (use jobId for job actions, customerId for messaging):");
      for (const j of top) {
        const where = [j.site_city, j.site_state].filter(Boolean).join(", ");
        lines.push(
          `- jobId=${j.id} customerId=${j.customer_id} | ${j.customer_name ?? "Customer"}${j.title ? ` (${j.title})` : ""} — ${j.status}, ${fmtDate(j.scheduled_date)}${where ? `, ${where}` : ""}`,
        );
      }

      // Full work order for the next couple of jobs, so the crew can have it
      // read back to them on site (rooms, measurements, materials, notes).
      for (const j of top.slice(0, 2)) {
        try {
          const d = await getJob(j.id);
          if (!d) continue;
          const addr = [d.site_street, d.site_city, d.site_state, d.site_zip]
            .filter(Boolean)
            .join(", ");
          const wo: string[] = [
            `\nWork order (jobId=${j.id}) — ${d.customer?.full_name ?? "Customer"}${d.customer?.phone ? `, ${d.customer.phone}` : ""}`,
          ];
          if (addr) wo.push(`  Address: ${addr}`);
          wo.push(`  Scheduled: ${fmtDate(d.scheduled_date)}, status ${d.status}`);
          for (const li of d.line_items.slice(0, 30)) {
            const meas =
              li.length_in && li.width_in
                ? `${ftIn(li.length_in)} x ${ftIn(li.width_in)}`
                : li.sqft
                  ? `${li.sqft} sq ft`
                  : li.quantity
                    ? `${li.quantity} ${li.unit ?? ""}`.trim()
                    : "";
            wo.push(
              `  - ${li.room ? `${li.room}: ` : ""}${li.description ?? "Item"}${meas ? ` (${meas})` : ""}`,
            );
          }
          if (d.notes) wo.push(`  Notes: ${d.notes}`);
          lines.push(wo.join("\n"));
        } catch {
          /* skip a job we can't fully load */
        }
      }
    }
  } catch {
    /* no job access for this role */
  }

  try {
    const customers = (await listCustomers()).slice(0, 20);
    if (customers.length) {
      lines.push("\nCustomers (use customerId for customer actions):");
      for (const c of customers) {
        const due = c.next_action_due ? `, follow-up ${fmtDate(c.next_action_due)}` : "";
        const where = [c.city, c.state].filter(Boolean).join(", ");
        lines.push(
          `- customerId=${c.id} | ${c.full_name}${c.phone ? ` ${c.phone}` : ""} — ${c.stage}${where ? `, ${where}` : ""}${due}`,
        );
      }
    }
  } catch {
    /* no customer access for this role */
  }

  let context = lines.join("\n");
  if (context.length > 11000) context = context.slice(0, 11000) + "\n…";

  const { text, error } = await aiText({
    temperature: 0.3,
    maxTokens: 800,
    system: `You are the field assistant for Cleveland Floor King's CRM, used on phones by the crew and sales team out in the field. Be sharp and practical — phone-sized answers.

You can SEE the user's jobs and customers in CONTEXT (each carries a jobId / customerId), including full WORK ORDERS for the next couple of jobs (address, rooms, measurements, materials, notes) — read those back clearly when the crew asks "what's on the next job" or for measurements/materials. Use the context to answer questions AND, when the user clearly asks to DO something, to propose ONE action for them to confirm.

Reply with ONLY this JSON (no prose, no code fences):
{ "reply": string, "action": null | { "type": ..., ...params, "label": "<plain-English confirmation>" } }

Action types:
- complete_job    { "jobId", "label" }                          — mark a job done
- set_job_status  { "jobId", "status", "label" }                — status ∈ unscheduled|scheduled|in_progress|completed|cancelled
- reschedule_job  { "jobId", "date" (YYYY-MM-DD), "label" }      — move a job to a new date (resolve "Friday"/"next week" from Today)
- add_note        { "customerId", "note", "label" }             — log a note on a customer
- set_followup    { "customerId", "date" (YYYY-MM-DD), "label" } — set a follow-up date (resolve "tomorrow"/"Friday" to an absolute date from Today)
- on_my_way       { "customerId", "label" }                     — text + email the customer "we're on our way" with a live ETA (use the job's customerId)
- create_estimate { "customerId", "description", "label" }      — build a draft estimate from a plain-English job description (put the full description in "description")
- navigate        { "url", "label" }                            — open a page, e.g. "/customers/<id>", "/jobs/<id>"

Rules:
- Only include an action when the user is clearly asking to perform it; otherwise "action": null and just answer in "reply".
- Use EXACT ids from CONTEXT. If you can't find the person/job they mean, set action null and ask which one in "reply".
- "label" is a short confirmation the user will see on a button, e.g. "Mark the Johnson job complete" or "Follow up with Maria on Jun 25".
- Keep "reply" to a sentence or two. Never invent customer facts not in CONTEXT.
- For trade math or how-to questions, just answer in "reply" with action null.`,
    prompt: `CONTEXT\n${context}\n\nQUESTION\n${q}`,
  });

  if (error) return { reply: "", action: null, error };
  const obj = parseObj(text);
  if (!obj) return { reply: text || "Sorry, try that again.", action: null, error: null };
  const reply = typeof obj.reply === "string" ? obj.reply : "";
  const action = sanitizeAction(obj.action);
  return { reply: reply || (action ? action.label : "Done."), action, error: null };
}

/**
 * Execute a confirmed action. Re-validates everything and runs through the
 * existing, tested server actions / RLS-scoped client — so the assistant can
 * never do more than the signed-in user could do by hand.
 */
export async function runAssistantAction(
  action: AssistantAction,
): Promise<{ ok: boolean; message: string; url?: string }> {
  const profile = await getProfile();
  if (!profile || profile.role === "customer")
    return { ok: false, message: "Not allowed." };

  const safe = sanitizeAction(action);
  if (!safe) return { ok: false, message: "That action wasn't understood." };

  const supabase = await createClient();

  switch (safe.type) {
    case "complete_job":
    case "set_job_status": {
      const status = safe.type === "complete_job" ? "completed" : safe.status;
      const { data: job } = await supabase
        .from("jobs")
        .select("id, customer:customers(full_name)")
        .eq("id", safe.jobId)
        .maybeSingle();
      if (!job) return { ok: false, message: "I couldn't find that job (or you don't have access)." };
      const fd = new FormData();
      fd.set("id", safe.jobId);
      fd.set("status", status);
      await setJobStatus(fd); // reuses the workflow-advance + revalidation
      const who =
        (job.customer as unknown as { full_name?: string } | null)?.full_name ?? "the job";
      return { ok: true, message: `Marked ${who}'s job ${status.replace("_", " ")}.`, url: `/jobs/${safe.jobId}` };
    }
    case "reschedule_job": {
      const { data: job } = await supabase
        .from("jobs")
        .select("id, status, assigned_to, assigned_crew_id, customer:customers(full_name)")
        .eq("id", safe.jobId)
        .maybeSingle();
      if (!job) return { ok: false, message: "I couldn't find that job (or you don't have access)." };
      const { data: schedRes, error: schedErr } = await supabase.rpc(
        "schedule_job_install_safe",
        {
          p_job_id: safe.jobId,
          p_scheduled_date: safe.date,
          p_scheduled_end: safe.date,
          p_assigned_to: (job.assigned_to as string | null) ?? null,
          p_assigned_crew_id: (job.assigned_crew_id as string | null) ?? null,
          p_set_arrival_window: false,
          p_open_for_claim: false,
        },
      );
      if (schedErr) {
        return {
          ok: false,
          message:
            /schedule_job_install_safe|does not exist|PGRST202/i.test(schedErr.message)
              ? "Scheduling is locked until the office schedule function is available."
              : "That date could not be booked. Pick another date.",
        };
      }
      const body = schedRes as { ok?: boolean; error?: string; code?: string } | null;
      if (body && body.ok === false) {
        return {
          ok: false,
          message:
            body.code === "SCHEDULE_CONFLICT"
              ? "That installer or crew is already booked on overlapping dates."
              : body.error || "That date could not be booked.",
        };
      }
      revalidatePath(`/jobs/${safe.jobId}`);
      revalidatePath("/jobs");
      revalidatePath("/calendar");
      revalidatePath("/client-status");
      revalidatePath("/dashboard");
      const when = new Date(safe.date + "T00:00:00").toLocaleDateString("en-US", {
        weekday: "short", month: "short", day: "numeric",
      });
      const who =
        (job.customer as unknown as { full_name?: string } | null)?.full_name ?? "the job";
      return { ok: true, message: `Moved ${who}'s job to ${when}.`, url: `/jobs/${safe.jobId}` };
    }
    case "add_note": {
      const { data: c } = await supabase
        .from("customers")
        .select("id, full_name")
        .eq("id", safe.customerId)
        .maybeSingle();
      if (!c) return { ok: false, message: "I couldn't find that customer (or you don't have access)." };
      const fd = new FormData();
      fd.set("customer_id", safe.customerId);
      fd.set("body", safe.note);
      fd.set("type", "note");
      const res = await addActivity({ error: null }, fd);
      if (res.error) return { ok: false, message: res.error };
      return { ok: true, message: `Logged a note on ${c.full_name}.`, url: `/customers/${safe.customerId}` };
    }
    case "set_followup": {
      const { data: c } = await supabase
        .from("customers")
        .select("id, full_name")
        .eq("id", safe.customerId)
        .maybeSingle();
      if (!c) return { ok: false, message: "I couldn't find that customer (or you don't have access)." };
      const { error } = await supabase
        .from("customers")
        .update({ next_action_due: safe.date })
        .eq("id", safe.customerId);
      if (error) return { ok: false, message: error.message };
      revalidatePath(`/customers/${safe.customerId}`);
      revalidatePath("/client-status");
      const when = new Date(safe.date + "T00:00:00").toLocaleDateString("en-US", {
        weekday: "short", month: "short", day: "numeric",
      });
      return { ok: true, message: `Set a follow-up with ${c.full_name} for ${when}.`, url: `/customers/${safe.customerId}` };
    }
    case "on_my_way": {
      const { data: c } = await supabase
        .from("customers")
        .select("id, full_name, phone, email")
        .eq("id", safe.customerId)
        .maybeSingle();
      if (!c) return { ok: false, message: "I couldn't find that customer (or you don't have access)." };
      const res = await notifyOnTheWay(safe.customerId);
      if (res.error) return { ok: false, message: res.error };
      const how = c.phone ? "texted" : c.email ? "emailed" : "notified";
      return {
        ok: true,
        message: `On-my-way ${how} to ${c.full_name}${res.eta && res.eta !== "sent" ? ` — ETA about ${res.eta}` : ""}.`,
        url: `/customers/${safe.customerId}`,
      };
    }
    case "create_estimate": {
      const { data: c } = await supabase
        .from("customers")
        .select("id, full_name")
        .eq("id", safe.customerId)
        .maybeSingle();
      if (!c) return { ok: false, message: "I couldn't find that customer (or you don't have access)." };
      const res = await createDraftEstimateFromText(safe.customerId, safe.description);
      if (res.error || !res.estimateId)
        return { ok: false, message: res.error || "Couldn't build the estimate." };
      return {
        ok: true,
        message: `Drafted an estimate for ${c.full_name} — open it to review the pricing.`,
        url: `/estimates/${res.estimateId}/edit`,
      };
    }
    case "navigate":
      return { ok: true, message: "Opening…", url: safe.url };
  }
}
