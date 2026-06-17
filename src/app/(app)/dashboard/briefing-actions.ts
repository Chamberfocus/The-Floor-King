"use server";

import { createClient } from "@/lib/supabase/server";
import { aiText } from "@/lib/ai";
import { getOutstandingAR, getPeriodSummary } from "@/lib/data/finance";
import { formatMoney } from "@/lib/format";

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export interface BriefingResult {
  text: string;
  error: string | null;
}

/** Read today's signals across the business and write a plain-English brief. */
export async function generateBriefing(): Promise<BriefingResult> {
  const supabase = await createClient();
  const now = new Date();
  const today = ymd(now);
  const weekStart = ymd(new Date(now.getTime() - 6 * 86400000));
  const in7 = ymd(new Date(now.getTime() + 7 * 86400000));

  // Leads that are due or overdue.
  const { data: leads } = await supabase
    .from("customers")
    .select("full_name, next_action_due, stage:workflow_stages(name, next_action)")
    .not("workflow_stage_id", "is", null)
    .is("cancelled_at", null)
    .not("next_action_due", "is", null)
    .lte("next_action_due", `${today}T23:59:59Z`)
    .order("next_action_due", { ascending: true })
    .limit(12);

  // Today's appointments.
  const { data: appts } = await supabase
    .from("appointments")
    .select("starts_at, contact_name, customer:customers(full_name), type:appointment_types(name)")
    .gte("starts_at", `${today}T00:00:00Z`)
    .lte("starts_at", `${today}T23:59:59Z`)
    .neq("status", "cancelled")
    .order("starts_at", { ascending: true });

  // Jobs scheduled / in progress in the next week.
  const { data: jobs } = await supabase
    .from("jobs")
    .select("title, scheduled_date, status, customer:customers(full_name)")
    .gte("scheduled_date", today)
    .lte("scheduled_date", in7)
    .in("status", ["scheduled", "in_progress"])
    .order("scheduled_date", { ascending: true })
    .limit(10);

  const [ar, week] = await Promise.all([
    getOutstandingAR(),
    getPeriodSummary(weekStart, today),
  ]);

  // Build the context for the model.
  const ctx: string[] = [];
  ctx.push(`Date: ${today}`);

  const overdue = (leads ?? []).filter(
    (l) => l.next_action_due && new Date(l.next_action_due as string) < now,
  );
  if (overdue.length) {
    ctx.push(`OVERDUE leads (need attention now): ${overdue.length}`);
    for (const l of overdue.slice(0, 8)) {
      const s = l.stage as unknown as { name?: string; next_action?: string } | null;
      ctx.push(`- ${l.full_name} — ${s?.name ?? "?"}${s?.next_action ? ` (${s.next_action})` : ""}`);
    }
  }
  const dueToday = (leads ?? []).filter((l) => !overdue.includes(l));
  if (dueToday.length) {
    ctx.push(`Leads due today: ${dueToday.length}`);
    for (const l of dueToday.slice(0, 6)) {
      const s = l.stage as unknown as { name?: string } | null;
      ctx.push(`- ${l.full_name} — ${s?.name ?? "?"}`);
    }
  }

  if (appts && appts.length) {
    ctx.push(`Appointments today: ${appts.length}`);
    for (const a of appts) {
      const c = a.customer as unknown as { full_name?: string } | null;
      const t = a.type as unknown as { name?: string } | null;
      const time = new Date(a.starts_at as string);
      const hh = String(time.getUTCHours()).padStart(2, "0");
      const mm = String(time.getUTCMinutes()).padStart(2, "0");
      ctx.push(`- ${hh}:${mm} ${c?.full_name ?? a.contact_name ?? "Walk-in"} (${t?.name ?? "appointment"})`);
    }
  } else {
    ctx.push("Appointments today: none");
  }

  if (jobs && jobs.length) {
    ctx.push(`Jobs this week: ${jobs.length}`);
    for (const j of jobs) {
      const c = j.customer as unknown as { full_name?: string } | null;
      ctx.push(`- ${j.scheduled_date} ${c?.full_name ?? ""} — ${j.title} (${j.status})`);
    }
  }

  ctx.push(`Money: collected this week ${formatMoney(week.collected)}.`);
  if (ar.total > 0) {
    ctx.push(
      `Owed to us: ${formatMoney(ar.total)} (${formatMoney(ar.d90plus)} is 90+ days overdue).`,
    );
  }

  const { text, error } = await aiText({
    system: `You are the sharp, encouraging operations assistant for the owner of Cleveland Floor King, a flooring company. Write a brief, scannable morning briefing. Lead with what makes or protects money today (overdue follow-ups, money owed, today's appointments/installs). Use short bullet points, name names and dollar amounts. Be specific and action-oriented — tell them what to DO, not just what exists. No fluff, no restating the raw data. End with one short encouraging line. Plain text only.`,
    maxTokens: 600,
    prompt: `Write today's briefing from this data:\n\n${ctx.join("\n")}`,
  });
  return { text, error };
}
