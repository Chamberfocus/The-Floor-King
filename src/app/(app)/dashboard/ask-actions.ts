"use server";

import { aiText } from "@/lib/ai";
import { getBusinessPulse } from "@/lib/data/pulse";
import { getTodayTasks } from "@/lib/data/day-tasks";
import { formatMoney } from "@/lib/format";

export interface AskResult {
  answer: string;
  error: string | null;
}

/** Answer an owner's question about the business from live data. */
export async function askBusiness(question: string): Promise<AskResult> {
  const q = (question ?? "").trim();
  if (q.length < 3) return { answer: "", error: "Ask a question first." };

  let ctx: string[] = [];
  try {
    const [pulse, tasks] = await Promise.all([
      getBusinessPulse(),
      getTodayTasks(),
    ]);

    ctx.push(`Month: ${pulse.monthLabel}`);
    ctx.push(
      `This month — collected ${formatMoney(pulse.thisMonth.collected)}, net profit ${formatMoney(pulse.thisMonth.net)} (last month net ${formatMoney(pulse.lastMonth.net)}).`,
    );
    ctx.push(
      `Owed to us (AR): ${formatMoney(pulse.ar.total)} across ${pulse.ar.count} invoices; ${formatMoney(pulse.ar.d90plus)} is 90+ days overdue.`,
    );
    ctx.push(
      `Average job margin: ${Math.round(pulse.avgJobMargin)}% (target ${Math.round(pulse.settings.target_gross_margin_pct)}%).`,
    );
    if (pulse.bestSeller)
      ctx.push(
        `Best-selling product: ${pulse.bestSeller.name} — ${formatMoney(pulse.bestSeller.revenue)} across ${pulse.bestSeller.jobs} jobs.`,
      );
    if (pulse.worstMarginSeller)
      ctx.push(
        `Lowest-margin product sold: ${pulse.worstMarginSeller.name} at ${Math.round(pulse.worstMarginSeller.margin)}% margin.`,
      );
    if (pulse.deadStockValue > 0)
      ctx.push(
        `Dead stock (90+ days idle): ${formatMoney(pulse.deadStockValue)} across ${pulse.deadStockCount} products.`,
      );
    if (pulse.losingJobs.length) {
      ctx.push(`Jobs that lost money:`);
      for (const j of pulse.losingJobs.slice(0, 5))
        ctx.push(`- ${j.customer ?? j.title}: ${formatMoney(j.profit)}`);
    }

    const collect = tasks.filter((t) => t.kind === "collect");
    if (collect.length) {
      ctx.push(`Customers who owe money right now:`);
      for (const t of collect.slice(0, 10))
        ctx.push(`- ${t.title.replace("Collect from ", "")}: ${formatMoney(t.amount ?? 0)}`);
    }
    const followups = tasks.filter((t) => t.kind === "followup");
    if (followups.length) {
      ctx.push(`Leads needing follow-up (overdue marked):`);
      for (const t of followups.slice(0, 10))
        ctx.push(`- ${t.title.replace("Follow up with ", "")}${t.urgent ? " (overdue)" : ""}`);
    }
    const appts = tasks.filter((t) => t.kind === "appointment");
    if (appts.length) {
      ctx.push(`Appointments today:`);
      for (const t of appts) ctx.push(`- ${t.title}`);
    }
  } catch {
    ctx = ["(Some business data could not be loaded.)"];
  }

  const { text, error } = await aiText({
    system: `You are the business assistant for the owner of Cleveland Floor King, a flooring company. Answer the owner's question using ONLY the DATA below. Be concise, direct, and specific — use names and exact dollar amounts. If the data doesn't contain the answer, say so plainly and suggest where in the app to look (e.g. Business Pulse, Reports, a customer's file). Never invent numbers. Plain text, a few sentences max.`,
    maxTokens: 500,
    prompt: `QUESTION: ${q}\n\nDATA:\n${ctx.join("\n")}`,
  });
  if (error) return { answer: "", error };
  return { answer: text, error: null };
}
