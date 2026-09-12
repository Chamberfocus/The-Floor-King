"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { aiText } from "@/lib/ai";
import { getCustomer, listActivities } from "@/lib/data/customers";
import { listEstimatesForCustomer } from "@/lib/data/estimates";
import { listJobsForCustomer } from "@/lib/data/jobs";
import { listInvoicesForCustomer, invoiceAmountDue } from "@/lib/data/invoices";
import { getOrgSettings } from "@/lib/data/org";
import { optionTotals } from "@/lib/estimate-calc";
import { formatMoney } from "@/lib/format";

export type MessageIntent =
  | "followup"
  | "quote_nudge"
  | "appointment_confirm"
  | "payment_reminder"
  | "review_request"
  | "thank_you";

const INTENT_GUIDE: Record<MessageIntent, string> = {
  followup: "a friendly check-in that naturally nudges the next step",
  quote_nudge:
    "a warm follow-up on the quote we sent — ask if they have questions and if they'd like to move forward, no pressure",
  appointment_confirm:
    "a short, friendly confirmation of their upcoming appointment (restate the day/time if it's in the data)",
  payment_reminder:
    "a polite, warm reminder about their outstanding balance — never aggressive; thank them and offer easy ways to pay",
  review_request:
    "a warm thank-you for their business and a friendly ask for a Google review; include the review link if provided",
  thank_you: "a warm, genuine thank-you for their business",
};

const SYSTEM = `You write short, warm, professional customer messages for Cleveland Floor King, a family-owned flooring company in Cleveland, Ohio. Tone: friendly, helpful, local small business — never pushy or corporate. Do NOT invent prices, dates, measurements, or facts that aren't given. Keep it tight and ready to send. Output ONLY the message itself, no preamble or notes.`;

export interface DraftResult {
  text: string;
  error: string | null;
}

/** Draft a context-aware customer message (text or email) by intent. */
export async function draftMessage(
  customerId: string,
  channel: "text" | "email",
  intent: MessageIntent = "followup",
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

  // Intent-specific extras.
  if (intent === "payment_reminder") {
    const invoices = await listInvoicesForCustomer(customerId);
    const balance = invoices
      .filter((i) => i.status !== "void")
      .reduce((s, i) => s + invoiceAmountDue(i), 0);
    if (balance > 0.5)
      ctx.push(`Outstanding balance owed: ${formatMoney(balance)}`);
  }
  let reviewUrl: string | null = null;
  if (intent === "review_request") {
    const org = await getOrgSettings();
    reviewUrl = org.google_review_url ?? null;
    if (reviewUrl) ctx.push(`Google review link: ${reviewUrl}`);
  }

  const shape =
    channel === "text"
      ? "a short SMS text message, 2–4 sentences, no subject line"
      : "a brief email — start with a line 'Subject: ...' then the body";

  const { text, error } = await aiText({
    system: SYSTEM,
    maxTokens: 500,
    prompt: `Write ${shape} for this customer. Purpose: ${INTENT_GUIDE[intent]}. Sign off as "Cleveland Floor King" without inventing a personal name.${
      intent === "review_request" && reviewUrl
        ? ` Include this exact review link: ${reviewUrl}`
        : ""
    }\n\nSITUATION:\n${ctx.join("\n")}`,
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
