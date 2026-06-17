"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { aiText } from "@/lib/ai";
import { getCustomer, listActivities } from "@/lib/data/customers";
import { listEstimatesForCustomer } from "@/lib/data/estimates";
import { listJobsForCustomer } from "@/lib/data/jobs";
import { optionTotals } from "@/lib/estimate-calc";
import { formatMoney } from "@/lib/format";

const SYSTEM = `You write short, warm, professional customer messages for Cleveland Floor King, a family-owned flooring company in Cleveland, Ohio. Tone: friendly, helpful, local small business — never pushy or corporate. Do NOT invent prices, dates, measurements, or facts that aren't given. Keep it tight and ready to send. Output ONLY the message itself, no preamble or notes.`;

export interface DraftResult {
  text: string;
  error: string | null;
}

/** Draft a context-aware follow-up (text or email) for this customer. */
export async function draftFollowup(
  customerId: string,
  channel: "text" | "email",
): Promise<DraftResult> {
  const customer = await getCustomer(customerId);
  if (!customer) return { text: "", error: "Customer not found." };

  const [activities, estimates, jobs] = await Promise.all([
    listActivities(customerId),
    listEstimatesForCustomer(customerId),
    listJobsForCustomer(customerId),
  ]);

  // Current pipeline stage name + its prescribed next action.
  let stageName: string | null = null;
  let nextAction: string | null = null;
  if (customer.workflow_stage_id) {
    const supabase = await createClient();
    const { data: st } = await supabase
      .from("workflow_stages")
      .select("name, next_action")
      .eq("id", customer.workflow_stage_id)
      .maybeSingle();
    stageName = (st?.name as string) ?? null;
    nextAction = (st?.next_action as string) ?? null;
  }

  const ctx: string[] = [];
  ctx.push(
    `Customer: ${customer.full_name}${customer.company ? ` (${customer.company})` : ""}`,
  );
  if (customer.city) ctx.push(`Location: ${customer.city}, ${customer.state ?? "OH"}`);
  if (stageName) ctx.push(`Where they are: ${stageName}`);
  if (nextAction) ctx.push(`Our next step: ${nextAction}`);

  if (estimates.length) {
    const e = estimates[0];
    const opt =
      (e.accepted_option_id &&
        e.options?.find((o) => o.id === e.accepted_option_id)) ||
      e.options?.[0];
    const total = opt ? optionTotals(opt.line_items ?? [], e.tax_rate).total : 0;
    ctx.push(
      `Latest quote: "${e.title || "Estimate"}" — status ${e.status}${
        total ? `, about ${formatMoney(total)}` : ""
      }`,
    );
  }
  if (jobs.length) {
    const j = jobs[0];
    ctx.push(
      `Job: "${j.title || "Job"}" — ${j.status}${
        j.scheduled_date ? `, scheduled ${j.scheduled_date}` : ""
      }`,
    );
  }
  if (activities.length) {
    ctx.push("Recent history (newest first):");
    for (const a of activities.slice(0, 6)) {
      if (a.body) ctx.push(`- [${a.type}] ${a.body}`);
    }
  }

  const shape =
    channel === "text"
      ? "a short SMS text message, 2–4 sentences, no subject line"
      : "a brief email — start with a line 'Subject: ...' then the body";

  const { text, error } = await aiText({
    system: SYSTEM,
    maxTokens: 500,
    prompt: `Write ${shape} to follow up with this customer and naturally move them toward the next step. Sign off as "Cleveland Floor King" (or the rep) without inventing a personal name.\n\nSITUATION:\n${ctx.join("\n")}`,
  });
  return { text, error };
}

/** Log a sent follow-up to the customer's timeline. */
export async function logFollowup(
  customerId: string,
  channel: "text" | "email",
  body: string,
): Promise<{ error: string | null }> {
  if (!customerId || !body.trim()) return { error: "Nothing to log." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from("activities").insert({
    customer_id: customerId,
    user_id: user?.id ?? null,
    type: channel,
    body: body.trim(),
  });
  if (error) return { error: error.message };
  revalidatePath(`/customers/${customerId}`);
  return { error: null };
}
