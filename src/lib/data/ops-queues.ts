/**
 * Today's operational queues — derived from live records, not a second SoT.
 */
import { createClient } from "@/lib/supabase/server";
import { listOpenServiceCallbacks } from "@/lib/data/ops-glue";
import { loadInvoiceArReductions } from "@/lib/data/invoices";
import { dayTaskCollectAmountDue, type PaymentLike } from "@/lib/payment-safety";
import { classifyInvoiceCollection, hasActiveDepositOnFile } from "@/lib/ops-followup";
import { opsQueueGroup } from "@/lib/job-operational-state";
import { getJobOperationalStateForJob } from "@/lib/data/job-ops-state";
import {
  officeCustomerOrderQueueHint,
  orderDisplayNumber,
} from "@/lib/order-warehouse-gates";

export interface OpsQueueItem {
  id: string;
  title: string;
  href: string;
  hint?: string | null;
}

export interface OpsQueue {
  id: import("@/lib/ops-followup").OpsQueueId;
  items: OpsQueueItem[];
}

function ymd(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

export async function getOpsTodayQueues(): Promise<OpsQueue[]> {
  const supabase = await createClient();
  const today = ymd();
  const now = new Date();

  const follow_up: OpsQueue = { id: "follow_up", items: [] };
  const deposit: OpsQueue = { id: "deposit", items: [] };
  const order: OpsQueue = { id: "order", items: [] };
  const material: OpsQueue = { id: "material", items: [] };
  const schedule: OpsQueue = { id: "schedule", items: [] };
  const install_today: OpsQueue = { id: "install_today", items: [] };
  const collect: OpsQueue = { id: "collect", items: [] };
  const callback: OpsQueue = { id: "callback", items: [] };
  const customer_order: OpsQueue = { id: "customer_order", items: [] };

  const followSeen = new Set<string>();
  const { data: leads } = await supabase
    .from("customers")
    .select("id, full_name, next_action_due, stage:workflow_stages(name, next_action)")
    .is("cancelled_at", null)
    .not("next_action_due", "is", null)
    .lte("next_action_due", `${today}T23:59:59Z`)
    .order("next_action_due", { ascending: true })
    .limit(12);
  for (const l of leads ?? []) {
    followSeen.add(l.id as string);
    const s = l.stage as unknown as { next_action?: string; name?: string } | null;
    follow_up.items.push({
      id: l.id as string,
      title: (l.full_name as string) || "Customer",
      href: `/customers/${l.id}`,
      hint: s?.next_action ?? s?.name ?? "Follow up",
    });
  }

  const { data: sent } = await supabase
    .from("estimates")
    .select("id, title, customer_id, customer:customers(full_name)")
    .eq("status", "sent")
    .order("sent_at", { ascending: true })
    .limit(12);
  for (const e of sent ?? []) {
    const cid = e.customer_id as string | null;
    if (cid && followSeen.has(cid)) continue;
    if (cid) followSeen.add(cid);
    const c = e.customer as unknown as { full_name?: string } | null;
    follow_up.items.push({
      id: `est-${e.id}`,
      title: c?.full_name || (e.title as string) || "Estimate",
      href: `/estimates/${e.id}`,
      hint: "Estimate out — follow up",
    });
  }

  const { data: approved } = await supabase
    .from("estimates")
    .select("id, title, customer_id, customer:customers(full_name)")
    .eq("status", "approved")
    .order("updated_at", { ascending: false })
    .limit(24);
  const approvedCustIds = [
    ...new Set(
      (approved ?? [])
        .map((e) => e.customer_id as string | null)
        .filter((id): id is string => !!id),
    ),
  ];
  const depositOnFile = new Set<string>();
  if (approvedCustIds.length) {
    const { data: depRows } = await supabase
      .from("customer_deposits")
      .select("customer_id, amount, status")
      .in("customer_id", approvedCustIds);
    const totals = new Map<string, { available: number; applied: number }>();
    for (const d of depRows ?? []) {
      if ((d.status as string) === "void") continue;
      const id = d.customer_id as string;
      const prev = totals.get(id) ?? { available: 0, applied: 0 };
      prev.available += Number(d.amount) || 0;
      totals.set(id, prev);
    }
    for (const [id, t] of totals) {
      if (
        hasActiveDepositOnFile({
          availableDeposit: t.available,
          appliedDeposit: t.applied,
        })
      ) {
        depositOnFile.add(id);
      }
    }
  }
  for (const e of approved ?? []) {
    const cid = e.customer_id as string | null;
    if (cid && depositOnFile.has(cid)) continue;
    const c = e.customer as unknown as { full_name?: string } | null;
    deposit.items.push({
      id: `dep-${e.id}`,
      title: c?.full_name || (e.title as string) || "Approved estimate",
      href: `/estimates/${e.id}`,
      hint: "Approved — deposit still due",
    });
  }

  const { data: jobs } = await supabase
    .from("jobs")
    .select(
      "id, title, status, scheduled_date, warehouse_ready_at, estimate_id, customer:customers(full_name)",
    )
    .in("status", ["unscheduled", "scheduled", "in_progress"])
    .or("delivery_type.is.null,delivery_type.neq.cash_carry")
    .order("scheduled_date", { ascending: true, nullsFirst: true })
    .limit(20);

  for (const j of jobs ?? []) {
    const name =
      (j.customer as unknown as { full_name?: string } | null)?.full_name ||
      (j.title as string) ||
      "Job";
    const href = `/jobs/${j.id}`;
    if ((j.scheduled_date as string | null)?.slice(0, 10) === today) {
      install_today.items.push({
        id: `inst-${j.id}`,
        title: name,
        href,
        hint: "On the calendar today",
      });
    }
    const ops = await getJobOperationalStateForJob({
      id: j.id as string,
      status: j.status as string,
      scheduled_date: (j.scheduled_date as string | null) ?? null,
      warehouse_ready_at: (j.warehouse_ready_at as string | null) ?? null,
      estimate_id: (j.estimate_id as string | null) ?? null,
    }).catch(() => null);
    if (!ops) continue;
    const group = opsQueueGroup(ops.state);
    const item = { id: j.id as string, title: name, href, hint: ops.state.nextAction };
    if (group === "needs_purchasing") order.items.push(item);
    else if (group === "waiting_on_material") material.items.push(item);
    else if (group === "ready_to_schedule") schedule.items.push(item);
  }

  const { data: invs } = await supabase
    .from("invoices")
    .select(
      "id, number, tax_rate, status, due_date, customer_id, customer:customers(full_name, cancelled_at), items:invoice_items(quantity, rate), payments(amount, status), credit_applications(amount, status)",
    )
    .in("status", ["sent", "partial"])
    .limit(40);
  const reductions = await loadInvoiceArReductions(
    (invs ?? []).map((i) => i.id as string),
  ).catch(() => new Map());
  for (const inv of invs ?? []) {
    const cust = inv.customer as unknown as {
      full_name?: string;
      cancelled_at?: string | null;
    } | null;
    if (cust?.cancelled_at) continue;
    const red = reductions.get(inv.id as string);
    const bal = dayTaskCollectAmountDue({
      items: (inv.items as { quantity: number; rate: number }[]) ?? [],
      taxRate: inv.tax_rate as number,
      payments: (inv.payments as PaymentLike[] | null) ?? [],
      creditApplications:
        (inv.credit_applications as
          | { amount: number; status?: string | null }[]
          | null) ?? [],
      appliedDeposits: red?.deposited ?? 0,
      appliedWriteOffs: red?.writtenOff ?? 0,
    });
    const bucket = classifyInvoiceCollection({
      status: inv.status as string,
      dueDate: inv.due_date as string | null,
      balance: bal,
      now,
    });
    if (bucket === "paid") continue;
    collect.items.push({
      id: inv.id as string,
      title: cust?.full_name || `Invoice ${inv.number ?? ""}`,
      href: `/invoices/${inv.id}`,
      hint: bucket === "overdue" ? "Overdue" : `Balance due`,
    });
  }
  collect.items.sort((a, b) => {
    const ao = a.hint === "Overdue" ? 0 : 1;
    const bo = b.hint === "Overdue" ? 0 : 1;
    return ao - bo;
  });

  const { data: submittedOrders } = await supabase
    .from("orders")
    .select("id, status, stock_status, contact_name, customer:customers(full_name)")
    .eq("status", "submitted")
    .order("created_at", { ascending: false })
    .limit(24);
  const seenOrder = new Set<string>();
  for (const o of submittedOrders ?? []) {
    const oid = o.id as string;
    if (seenOrder.has(oid)) continue;
    seenOrder.add(oid);
    const hint = officeCustomerOrderQueueHint({
      status: o.status as string,
      stockStatus: o.stock_status as string,
    });
    if (!hint) continue;
    const c = o.customer as unknown as { full_name?: string } | null;
    customer_order.items.push({
      id: `corder-${oid}`,
      title: c?.full_name || (o.contact_name as string) || orderDisplayNumber(oid),
      href: "/orders",
      hint,
    });
  }

  const cbs = await listOpenServiceCallbacks().catch(() => []);
  for (const c of cbs.slice(0, 12)) {
    callback.items.push({
      id: c.id,
      title: c.customer_name || c.category.replace(/_/g, " "),
      href: c.job_id ? `/jobs/${c.job_id}` : `/customers/${c.customer_id}`,
      hint: c.category.replace(/_/g, " "),
    });
  }

  const cap = (q: OpsQueue, n: number): OpsQueue => ({
    ...q,
    items: q.items.slice(0, n),
  });

  return [
    cap(follow_up, 8),
    cap(deposit, 8),
    cap(order, 8),
    cap(material, 8),
    cap(schedule, 8),
    cap(install_today, 8),
    cap(collect, 8),
    cap(callback, 8),
    cap(customer_order, 8),
  ];
}

export async function listJobPurchasingFacts(jobId: string): Promise<
  {
    id: string;
    po_number: string | number | null;
    supplier: string | null;
    eta_date: string | null;
    backordered: boolean | null;
    status: string | null;
  }[]
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("purchase_orders")
    .select("id, po_number, supplier, eta_date, backordered, status")
    .eq("job_id", jobId)
    .not("status", "in", "(void,cancelled)")
    .order("created_at", { ascending: false })
    .limit(8);
  return (data ?? []) as {
    id: string;
    po_number: string | number | null;
    supplier: string | null;
    eta_date: string | null;
    backordered: boolean | null;
    status: string | null;
  }[];
}
