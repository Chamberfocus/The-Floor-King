"use server";

import { getProfile } from "@/lib/auth";
import { aiText } from "@/lib/ai";
import { listJobs } from "@/lib/data/jobs";
import { listCustomers } from "@/lib/data/customers";
import { ROLE_LABELS } from "@/lib/types";

const fmtDate = (d: string | null) => {
  if (!d) return "unscheduled";
  const t = new Date(d);
  return Number.isNaN(t.getTime())
    ? d
    : t.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};

/**
 * Field assistant: answers a team member's question using their OWN jobs and
 * customers (everything is fetched with the RLS-scoped client, so they only
 * ever see what they're allowed to). Read-only — it never changes data.
 */
export async function askAssistant(
  question: string,
): Promise<{ text: string; error: string | null }> {
  const q = (question ?? "").trim();
  if (q.length < 2) return { text: "", error: "Ask a question first." };

  const profile = await getProfile();
  if (!profile) return { text: "", error: "Please sign in." };

  const today = new Date();
  const todayStr = today.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  // Gather context — each source is independent and never throws the request.
  const lines: string[] = [];
  lines.push(`Today: ${todayStr}.`);
  lines.push(`User: ${profile.full_name || profile.email}, role ${ROLE_LABELS[profile.role]}.`);

  try {
    // The user's own jobs first; office/admin see the shop's via RLS.
    const mine = await listJobs({ assignedTo: profile.id });
    const jobs = (mine.length ? mine : await listJobs()).slice(0, 40);
    // Upcoming/active first: sort by scheduled date, unscheduled last.
    jobs.sort((a, b) => {
      const ax = a.scheduled_date ? Date.parse(a.scheduled_date) : Infinity;
      const bx = b.scheduled_date ? Date.parse(b.scheduled_date) : Infinity;
      return ax - bx;
    });
    const top = jobs
      .filter((j) => j.status !== "completed" && j.status !== "cancelled")
      .slice(0, 12);
    if (top.length) {
      lines.push("\nJobs:");
      for (const j of top) {
        const where = [j.site_city, j.site_state].filter(Boolean).join(", ");
        lines.push(
          `- ${j.customer_name ?? "Customer"}${j.title ? ` (${j.title})` : ""} — ${j.status}, ${fmtDate(j.scheduled_date)}${where ? `, ${where}` : ""}`,
        );
      }
    }
  } catch {
    /* role may not have job access — skip */
  }

  try {
    const customers = (await listCustomers()).slice(0, 15);
    if (customers.length) {
      lines.push("\nRecent customers:");
      for (const c of customers) {
        const due = c.next_action_due ? `, follow-up ${fmtDate(c.next_action_due)}` : "";
        const where = [c.city, c.state].filter(Boolean).join(", ");
        lines.push(
          `- ${c.full_name}${c.phone ? ` ${c.phone}` : ""} — ${c.stage}${where ? `, ${where}` : ""}${due}`,
        );
      }
    }
  } catch {
    /* role may not have customer access — skip */
  }

  let context = lines.join("\n");
  if (context.length > 7000) context = context.slice(0, 7000) + "\n…";

  return aiText({
    temperature: 0.4,
    maxTokens: 700,
    system: `You are the field assistant for Cleveland Floor King's CRM — used on phones by the crew and sales team while they're out working. Be the sharp, practical right-hand: answer in a few tight sentences or a short list a person can read at a glance on a phone.

You can see the user's current jobs and customers in CONTEXT below — use them to answer real questions ("what's my next job", "who do I need to follow up with", "where am I headed today"). If they ask how to do something in the system (record a deposit, build an estimate, make a PO, capture a signature), give the quick steps. You also know flooring trade math (waste %, sq yd, transitions, pad) — help with that too.

Rules: rely only on the CONTEXT for customer/job facts — never invent names, addresses, prices, or dates that aren't there. If the answer isn't in the context, say what you'd need or where to look. No fluff, no sign-off.`,
    prompt: `CONTEXT\n${context}\n\nQUESTION\n${q}`,
  });
}
