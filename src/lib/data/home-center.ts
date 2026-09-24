/**
 * Home action center loader.
 *
 * A fixed set of bounded queries against tables the signed-in user can already
 * read through RLS. Role filters below match the navigation the user can open.
 * This does not write, and it does not recompute money, inventory, or schedule.
 */
import { createClient } from "@/lib/supabase/server";
import { dayTaskCollectAmountDue, type PaymentLike } from "@/lib/payment-safety";
import { loadInvoiceArReductions } from "@/lib/data/invoices";
import { isMaterialLine } from "@/lib/job-scope";
import { formatMoney } from "@/lib/format";
import {
  buildHomeCenter,
  type HomeCallback,
  type HomeCenter,
  type HomeDeposit,
  type HomeEstimate,
  type HomeFollowUp,
  type HomeInstall,
  type HomeInvoice,
  type HomeMeasure,
  type HomeSignals,
  type HomeTask,
  type HomeUnscheduled,
} from "@/lib/home-actions";
import { hasActiveDepositOnFile } from "@/lib/ops-followup";
import type { UserRole } from "@/lib/types";

const SALES_VIEW: UserRole[] = ["admin", "office", "sales_manager", "salesman", "scheduler"];
const ESTIMATE_ROLES: UserRole[] = ["admin", "office", "sales_manager", "salesman"];
const MONEY_ROLES: UserRole[] = ["admin", "office", "sales_manager", "salesman"];
const JOB_ROLES: UserRole[] = ["admin", "office", "sales_manager", "salesman", "scheduler", "crew"];
const SERVICE_ROLES: UserRole[] = ["admin", "office", "sales_manager", "salesman", "scheduler"];

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

function plusDays(day: string, days: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function loadHomeCenter(args: {
  role: UserRole;
  userId: string;
  firstName: string;
  now?: Date;
}): Promise<HomeCenter> {
  const now = args.now ?? new Date();
  const today = ymd(now);
  const week = plusDays(today, 7);
  const supabase = await createClient();
  const mine = args.role === "salesman" || args.role === "crew";

  const signals: HomeSignals = {
    now,
    role: args.role,
    userId: args.userId,
    firstName: args.firstName,
  };

  const tasks: HomeTask[] = [];
  const { data: taskRows } = await supabase
    .from("office_tasks")
    .select("id, title, status, due_at, customer_id, job_id")
    .eq("assigned_to", args.userId)
    .in("status", ["open", "in_progress"])
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(20);
  for (const row of taskRows ?? []) {
    const customerId = row.customer_id as string | null;
    const jobId = row.job_id as string | null;
    const href = customerId
      ? `/customers/${customerId}`
      : jobId && JOB_ROLES.includes(args.role)
        ? `/jobs/${jobId}`
        : args.role === "admin" || args.role === "office" || args.role === "sales_manager"
          ? "/dashboard"
          : null;
    if (!href) continue;
    if (href.startsWith("/customers") && !SALES_VIEW.includes(args.role)) continue;
    tasks.push({
      id: row.id as string,
      title: (row.title as string) || "Task",
      dueAt: (row.due_at as string | null) ?? null,
      status: row.status as string,
      href,
    });
  }
  signals.tasks = tasks;

  if (SALES_VIEW.includes(args.role)) {
    let q = supabase
      .from("customers")
      .select("id, full_name, next_action_due, assigned_to, stage:workflow_stages(next_action, auto_action)")
      .is("cancelled_at", null)
      .not("next_action_due", "is", null)
      .lte("next_action_due", `${week}T23:59:59Z`)
      .order("next_action_due", { ascending: true })
      .limit(30);
    if (args.role === "salesman") {
      q = q.or(`assigned_to.eq.${args.userId},workflow_owner_id.eq.${args.userId}`);
    }
    const { data } = await q;
    signals.followUps = ((data ?? []) as unknown as {
      id: string;
      full_name: string;
      next_action_due: string;
      assigned_to: string | null;
      stage: { next_action?: string; auto_action?: string | null } | null;
    }[]).map((row) => ({
      id: row.id,
      name: row.full_name || "Customer",
      dueAt: row.next_action_due,
      nextAction: row.stage?.next_action ?? null,
      stageAction: row.stage?.auto_action ?? null,
      ownerId: row.assigned_to,
    })) satisfies HomeFollowUp[];

    const { data: appts } = await supabase
      .from("appointments")
      .select("id, starts_at, customer_id, salesperson_id, customer:customers(full_name, assigned_to)")
      .gte("starts_at", `${today}T00:00:00Z`)
      .lte("starts_at", `${week}T23:59:59Z`)
      .neq("status", "cancelled")
      .order("starts_at", { ascending: true })
      .limit(20);
    signals.measures = ((appts ?? []) as unknown as {
      id: string;
      starts_at: string;
      customer_id: string | null;
      salesperson_id: string | null;
      customer: { full_name?: string; assigned_to?: string | null } | null;
    }[])
      .filter((row) => {
        if (args.role !== "salesman") return true;
        return row.salesperson_id === args.userId || row.customer?.assigned_to === args.userId;
      })
      .map((row) => ({
        id: row.id,
        name: row.customer?.full_name || "Measure",
        startsAt: row.starts_at,
        ownerName: null,
        href: row.customer_id ? `/customers/${row.customer_id}` : "/calendar",
      })) satisfies HomeMeasure[];
  }

  if (ESTIMATE_ROLES.includes(args.role)) {
    const { data: sent } = await supabase
      .from("estimates")
      .select("id, sent_at, customer_id, customer:customers(full_name, assigned_to)")
      .eq("status", "sent")
      .order("sent_at", { ascending: true })
      .limit(20);
    signals.sentEstimates = ((sent ?? []) as unknown as {
      id: string;
      sent_at: string | null;
      customer_id: string | null;
      customer: { full_name?: string; assigned_to?: string | null } | null;
    }[]).map((row) => ({
      id: row.id,
      name: row.customer?.full_name || "Estimate",
      sentAt: row.sent_at,
      totalLabel: null,
      customerId: row.customer_id,
      ownerId: row.customer?.assigned_to ?? null,
    })) satisfies HomeEstimate[];

    const { data: approved } = await supabase
      .from("estimates")
      .select("id, updated_at, customer_id, customer:customers(full_name, assigned_to)")
      .eq("status", "approved")
      .order("updated_at", { ascending: false })
      .limit(20);
    const approvedRows = (approved ?? []) as unknown as {
      id: string;
      updated_at: string | null;
      customer_id: string | null;
      customer: { full_name?: string; assigned_to?: string | null } | null;
    }[];
    const customerIds = [...new Set(approvedRows.map((row) => row.customer_id).filter((id): id is string => !!id))];
    const depositOnFile = new Set<string>();
    if (customerIds.length) {
      const { data: deps } = await supabase
        .from("customer_deposits")
        .select("customer_id, amount, status")
        .in("customer_id", customerIds);
      const totals = new Map<string, number>();
      for (const dep of deps ?? []) {
        if ((dep.status as string) === "void") continue;
        const id = dep.customer_id as string;
        totals.set(id, (totals.get(id) ?? 0) + (Number(dep.amount) || 0));
      }
      for (const [id, amount] of totals) {
        if (hasActiveDepositOnFile({ availableDeposit: amount, appliedDeposit: 0 })) depositOnFile.add(id);
      }
    }
    signals.deposits = approvedRows
      .filter((row) => !row.customer_id || !depositOnFile.has(row.customer_id))
      .map((row) => ({
        id: row.id,
        name: row.customer?.full_name || "Approved estimate",
        approvedAt: row.updated_at,
        amountLabel: null,
        customerId: row.customer_id,
        ownerId: row.customer?.assigned_to ?? null,
      })) satisfies HomeDeposit[];
  }

  if (MONEY_ROLES.includes(args.role)) {
    const { data: invs } = await supabase
      .from("invoices")
      .select(
        "id, number, tax_rate, due_date, customer_id, customer:customers(full_name, cancelled_at, assigned_to), items:invoice_items(quantity, rate), payments(amount, status), credit_applications(amount, status)",
      )
      .in("status", ["sent", "partial"])
      .limit(25);
    const reductions = await loadInvoiceArReductions((invs ?? []).map((row) => row.id as string)).catch(
      () => new Map(),
    );
    const invoices: HomeInvoice[] = [];
    for (const inv of invs ?? []) {
      const cust = inv.customer as unknown as {
        full_name?: string;
        cancelled_at?: string | null;
        assigned_to?: string | null;
      } | null;
      if (cust?.cancelled_at) continue;
      const red = reductions.get(inv.id as string);
      const bal = dayTaskCollectAmountDue({
        items: (inv.items as { quantity: number; rate: number }[]) ?? [],
        taxRate: inv.tax_rate as number,
        payments: (inv.payments as PaymentLike[] | null) ?? [],
        creditApplications:
          (inv.credit_applications as { amount: number; status?: string | null }[] | null) ?? [],
        appliedDeposits: red?.deposited ?? 0,
        appliedWriteOffs: red?.writtenOff ?? 0,
      });
      if (bal <= 0.5) continue;
      invoices.push({
        id: inv.id as string,
        name: cust?.full_name || "Invoice",
        number: (inv.number as string | null) ?? null,
        dueAt: (inv.due_date as string | null) ?? null,
        balanceLabel: formatMoney(bal),
        ownerId: cust?.assigned_to ?? null,
      });
    }
    signals.invoices = invoices;
  }

  if (JOB_ROLES.includes(args.role) || args.role === "warehouse") {
    let q = supabase
      .from("jobs")
      .select(
        "id, title, status, scheduled_date, warehouse_ready_at, assigned_to, customer_id, customer:customers(full_name, assigned_to)",
      )
      .in("status", ["unscheduled", "scheduled", "in_progress"])
      .or("delivery_type.is.null,delivery_type.neq.cash_carry")
      .order("scheduled_date", { ascending: true, nullsFirst: false })
      .limit(30);
    if (args.role === "crew") q = q.eq("assigned_to", args.userId);
    const { data: jobs } = await q;
    const jobRows = (jobs ?? []) as unknown as {
      id: string;
      title: string | null;
      status: string;
      scheduled_date: string | null;
      warehouse_ready_at: string | null;
      assigned_to: string | null;
      customer_id: string | null;
      customer: { full_name?: string; assigned_to?: string | null } | null;
    }[];
    const ids = jobRows.map((row) => row.id);
    const materialJobs = new Set<string>();
    if (ids.length) {
      const { data: lines } = await supabase
        .from("job_line_items")
        .select("job_id, line_type, category")
        .in("job_id", ids)
        .limit(400);
      for (const line of lines ?? []) {
        if (isMaterialLine(line as { line_type?: string | null; category?: string | null })) {
          materialJobs.add(line.job_id as string);
        }
      }
    }
    const installs: HomeInstall[] = [];
    const unscheduled: HomeUnscheduled[] = [];
    for (const row of jobRows) {
      const name = row.customer?.full_name || row.title || "Job";
      const ownerId = row.customer?.assigned_to ?? null;
      if (mine && args.role === "salesman" && ownerId !== args.userId) continue;
      if (row.scheduled_date) {
        installs.push({
          id: row.id,
          name,
          scheduledDate: row.scheduled_date.slice(0, 10),
          assigneeId: row.assigned_to,
          customerId: row.customer_id,
          customerOwnerId: ownerId,
          warehouseReadyAt: row.warehouse_ready_at,
          hasMaterialNeed: materialJobs.has(row.id),
          href: `/jobs/${row.id}`,
        });
      } else if (row.status === "unscheduled") {
        unscheduled.push({
          id: row.id,
          name,
          assigneeId: row.assigned_to,
          customerId: row.customer_id,
          customerOwnerId: ownerId,
          hasMaterialNeed: materialJobs.has(row.id),
          warehouseReadyAt: row.warehouse_ready_at,
          href: `/jobs/${row.id}`,
        });
      }
    }
    signals.installs = installs;
    if (args.role !== "crew" && args.role !== "warehouse") signals.unscheduled = unscheduled;
  }

  if (SERVICE_ROLES.includes(args.role)) {
    const { data } = await supabase
      .from("service_callbacks")
      .select("id, follow_up_at, customer_id, customer:customers(full_name, assigned_to)")
      .in("status", ["open", "scheduled", "in_progress", "waiting"])
      .order("follow_up_at", { ascending: true, nullsFirst: false })
      .limit(20);
    signals.callbacks = ((data ?? []) as unknown as {
      id: string;
      follow_up_at: string | null;
      customer_id: string | null;
      customer: { full_name?: string; assigned_to?: string | null } | null;
    }[])
      .filter((row) => args.role !== "salesman" || row.customer?.assigned_to === args.userId)
      .map((row) => ({
        id: row.id,
        name: row.customer?.full_name || "Service",
        followUpAt: row.follow_up_at,
        href: "/service",
      })) satisfies HomeCallback[];
  }

  return buildHomeCenter(signals);
}
