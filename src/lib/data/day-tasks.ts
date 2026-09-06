import { createClient } from "@/lib/supabase/server";
import {
  dayTaskCollectAmountDue,
  type PaymentLike,
} from "@/lib/payment-safety";

export type DayTaskKind =
  | "followup"
  | "appointment"
  | "collect"
  | "schedule";

export interface DayTask {
  id: string; // stable id for check-off (record-based)
  kind: DayTaskKind;
  title: string;
  sub: string | null;
  href: string;
  urgent: boolean;
  amount: number | null;
}

/** Re-export for callers/tests that want the Day Briefing collect helper. */
export { dayTaskCollectAmountDue } from "@/lib/payment-safety";

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Today's action list, DERIVED from live data — so it stays in sync on its own:
 * follow up with a lead and it advances out of here; record a payment and the
 * "collect" item disappears; schedule a job and it drops off.
 */
export async function getTodayTasks(): Promise<DayTask[]> {
  const supabase = await createClient();
  const now = new Date();
  const today = ymd(now);
  const tasks: DayTask[] = [];

  // 1) Follow-ups: leads due or overdue.
  const { data: leads } = await supabase
    .from("customers")
    .select("id, full_name, next_action_due, stage:workflow_stages(name, next_action)")
    .not("workflow_stage_id", "is", null)
    .is("cancelled_at", null)
    .not("next_action_due", "is", null)
    .lte("next_action_due", `${today}T23:59:59Z`)
    .order("next_action_due", { ascending: true })
    .limit(15);
  for (const l of leads ?? []) {
    const s = l.stage as unknown as { name?: string; next_action?: string } | null;
    tasks.push({
      id: `lead-${l.id}`,
      kind: "followup",
      title: `Follow up with ${l.full_name}`,
      sub: s?.next_action ?? s?.name ?? null,
      href: `/customers/${l.id}`,
      urgent: !!l.next_action_due && new Date(l.next_action_due as string) < now,
      amount: null,
    });
  }

  // 2) Appointments today.
  const { data: appts } = await supabase
    .from("appointments")
    .select("id, starts_at, contact_name, customer_id, customer:customers(full_name), type:appointment_types(name)")
    .gte("starts_at", `${today}T00:00:00Z`)
    .lte("starts_at", `${today}T23:59:59Z`)
    .neq("status", "cancelled")
    .order("starts_at", { ascending: true });
  for (const a of appts ?? []) {
    const c = a.customer as unknown as { full_name?: string } | null;
    const t = a.type as unknown as { name?: string } | null;
    const d = new Date(a.starts_at as string);
    const hh = d.getUTCHours();
    const mm = String(d.getUTCMinutes()).padStart(2, "0");
    const ap = hh >= 12 ? "pm" : "am";
    const h12 = hh % 12 === 0 ? 12 : hh % 12;
    tasks.push({
      id: `appt-${a.id}`,
      kind: "appointment",
      title: `${h12}:${mm}${ap} — ${c?.full_name ?? a.contact_name ?? "Walk-in"}`,
      sub: t?.name ?? "Appointment",
      href: a.customer_id ? `/customers/${a.customer_id}` : "/calendar",
      urgent: false,
      amount: null,
    });
  }

  // 3) Collect: open invoices with a balance (active payments + applied credits).
  const { data: invs } = await supabase
    .from("invoices")
    .select(
      "id, number, tax_rate, status, customer_id, customer:customers(full_name, cancelled_at), items:invoice_items(quantity, rate), payments(amount, status), credit_applications(amount, status)",
    )
    .in("status", ["sent", "partial"]);
  for (const inv of invs ?? []) {
    const cust = inv.customer as unknown as {
      full_name?: string;
      cancelled_at?: string | null;
    } | null;
    if (cust?.cancelled_at) continue;
    const bal = dayTaskCollectAmountDue({
      items: (inv.items as { quantity: number; rate: number }[]) ?? [],
      taxRate: inv.tax_rate as number,
      payments: (inv.payments as PaymentLike[] | null) ?? [],
      creditApplications:
        (inv.credit_applications as
          | { amount: number; status?: string | null }[]
          | null) ?? [],
    });
    if (bal <= 0.5) continue;
    tasks.push({
      id: `inv-${inv.id}`,
      kind: "collect",
      title: `Collect from ${cust?.full_name ?? "customer"}`,
      sub: inv.number ? `Invoice ${inv.number}` : null,
      href: `/invoices/${inv.id}`,
      urgent: false,
      amount: Math.round(bal * 100) / 100,
    });
  }

  // 4) Schedule: jobs not yet on the calendar.
  const { data: jobs } = await supabase
    .from("jobs")
    .select("id, title, customer:customers(full_name)")
    .eq("status", "unscheduled")
    .limit(10);
  for (const j of jobs ?? []) {
    const c = j.customer as unknown as { full_name?: string } | null;
    tasks.push({
      id: `job-${j.id}`,
      kind: "schedule",
      title: `Schedule install — ${c?.full_name ?? "job"}`,
      sub: (j.title as string) ?? null,
      href: `/jobs/${j.id}`,
      urgent: false,
      amount: null,
    });
  }

  // Urgent first, then by kind.
  const order: DayTaskKind[] = ["followup", "collect", "appointment", "schedule"];
  return tasks.sort((a, b) => {
    if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
    return order.indexOf(a.kind) - order.indexOf(b.kind);
  });
}
