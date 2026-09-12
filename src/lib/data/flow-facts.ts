import type { FlowFacts } from "@/lib/job-flow";
import { effectiveInvoiceBalance } from "@/lib/credit-ar";
import { listCreditApplicationsForInvoices } from "@/lib/data/credits";
import { loadInvoiceArReductions } from "@/lib/data/invoices";
import type { Invoice } from "@/lib/types";

/**
 * Record-backed FlowFacts for a customer — used by workflowAdvanceGate.
 */
export async function loadCustomerFlowFacts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  customerId: string,
): Promise<FlowFacts> {
  const [
    { count: activityCount },
    { count: apptCount },
    { data: estimates },
    { data: jobs },
    { data: invoices },
  ] = await Promise.all([
    db
      .from("activities")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", customerId),
    db
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", customerId),
    db.from("estimates").select("id, status").eq("customer_id", customerId),
    db
      .from("jobs")
      .select("id, status, scheduled_date, warehouse_ready_at")
      .eq("customer_id", customerId)
      .neq("status", "cancelled"),
    db
      .from("invoices")
      .select("id, status, tax_rate, items:invoice_items(*), payments(*)")
      .eq("customer_id", customerId),
  ]);

  const ests = (estimates ?? []) as { id: string; status: string }[];
  const jobRows = (jobs ?? []) as {
    id: string;
    status: string | null;
    scheduled_date: string | null;
    warehouse_ready_at: string | null;
  }[];
  const invs = (invoices ?? []) as Invoice[];

  let satisfactionSigned = false;
  if (jobRows[0]) {
    const { data: sat } = await db
      .from("job_satisfaction")
      .select("id")
      .in(
        "job_id",
        jobRows.map((j) => j.id),
      )
      .limit(1)
      .maybeSingle();
    satisfactionSigned = !!sat;
  }

  let creditedByInv = new Map<string, number>();
  let reductions = new Map<string, { deposited: number; writtenOff: number }>();
  if (invs.length) {
    const ids = invs.map((i) => i.id);
    const apps = await listCreditApplicationsForInvoices(ids, db);
    for (const a of apps) {
      if ((a.status ?? "active") === "void") continue;
      creditedByInv.set(
        a.invoice_id,
        (creditedByInv.get(a.invoice_id) ?? 0) + (Number(a.amount) || 0),
      );
    }
    reductions = await loadInvoiceArReductions(ids);
  }

  const depositPaid = invs.some((i) =>
    (i.payments ?? []).some(
      (p) => ((p.status as string) ?? "active") !== "void" && Number(p.amount) > 0,
    ),
  );
  const outstanding = invs
    .filter((i) => i.status !== "void")
    .reduce((sum, i) => {
      const paid = (i.payments ?? [])
        .filter((p) => ((p.status as string) ?? "active") !== "void")
        .reduce((s, p) => s + (Number(p.amount) || 0), 0);
      return (
        sum +
        effectiveInvoiceBalance({
          items: i.items ?? [],
          taxRate: i.tax_rate,
          amountPaid: paid,
          appliedCredits: creditedByInv.get(i.id) ?? 0,
          appliedDeposits: reductions.get(i.id)?.deposited ?? 0,
          appliedWriteOffs: reductions.get(i.id)?.writtenOff ?? 0,
        }).amountDue
      );
    }, 0);

  return {
    hasActivity: (activityCount ?? 0) > 0,
    estimateBooked: (apptCount ?? 0) > 0,
    hasEstimate: ests.length > 0,
    estimateSent: ests.some((e) => e.status === "sent" || e.status === "approved"),
    estimateApproved: ests.some((e) => e.status === "approved"),
    depositPaid,
    workOrderExists: jobRows.length > 0,
    materialsStaged: jobRows.some((j) => !!j.warehouse_ready_at),
    installBooked: jobRows.some((j) => !!j.scheduled_date),
    installComplete: jobRows.some((j) => j.status === "completed"),
    balancePaid: outstanding <= 0.005,
    satisfactionSigned,
  };
}
